#!/usr/bin/env python3
"""Transcribe untimed songs sequentially, saving resumable word timing."""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

MAX_MP3_BYTES = 25_000_000
DEFAULT_API_URL = "http://localhost:8055/transcribe"


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def has_export_timing(clip):
    lyrics = (clip.get("lyrics") or {}).get("value") or {}
    text = lyrics.get("text")
    timing = clip.get("lyrics_timing") or {}
    value = timing.get("value") or {}
    markers = value.get("markers")
    if not (isinstance(text, str) and text and timing.get("status") == "completed"
            and value.get("lyrics_id") == lyrics.get("id")
            and isinstance(markers, list) and markers):
        return False
    # Export offsets use JavaScript's UTF-16 string indices.
    length = len(text.encode("utf-16-le")) // 2
    previous_offset, previous_time = -1, -1
    for marker in markers:
        if not (isinstance(marker, list) and len(marker) == 2):
            return False
        offset, time = marker
        if not (type(offset) is int and previous_offset < offset <= length
                and number(time) and time >= 0 and time >= previous_time):
            return False
        previous_offset, previous_time = offset, time
    return markers[0][0] < length


def validate_words(words):
    if not isinstance(words, list):
        raise ValueError("Expected an array of word timestamps")
    result = []
    previous = -1
    for word in words:
        if not isinstance(word, dict):
            raise ValueError("Expected word objects with word, start, and end")
        text = word.get("word", word.get("text"))
        start, end = word.get("start"), word.get("end")
        if not (isinstance(text, str) and text.strip() and number(start) and number(end)
                and 0 <= start <= end and start >= previous):
            raise ValueError("Invalid or unordered word timestamps in transcription")
        result.append({"word": text.strip(), "start": start, "end": end})
        previous = start
    return result


def transcription_words(response):
    if not isinstance(response, dict):
        raise ValueError("Expected a JSON object from the transcription API")
    if isinstance(response.get("words"), list):
        words = response["words"]
    elif isinstance(response.get("segments"), list):
        words = []
        for segment in response["segments"]:
            if not isinstance(segment, dict) or not isinstance(segment.get("words"), list):
                raise ValueError("API returned segments without word timestamps")
            words.extend(segment["words"])
    else:
        raise ValueError("API did not return words or segments with word timestamps")
    words = validate_words(words)
    if not words and str(response.get("text") or "").strip():
        raise ValueError("API returned text without word timestamps")
    return words


def cached(clip, entry):
    if not isinstance(entry, dict) or entry.get("audio_url") != clip.get("audio_url"):
        return False
    try:
        words = validate_words(entry.get("words"))
    except ValueError:
        return False
    return (entry.get("status") == "completed" and bool(words)
            or entry.get("status") == "no_speech" and not words)


def save_json(state, output):
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent,
                                         prefix=f".{output.name}.", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(state, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def download(url, target):
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("Expected an HTTP(S) audio URL")
    subprocess.run([
        "curl", "--fail", "--location", "--silent", "--show-error",
        "--proto", "=http,https", "--proto-redir", "=http,https",
        "--connect-timeout", "30", "--max-time", "600",
        "--output", str(target), "--", url,
    ], check=True)


def convert_mp3(source, output):
    # Mono, 16 kHz MP3 is sufficient for speech recognition. Never truncate audio.
    for bitrate in (64, 48, 32, 24, 16, 8):
        subprocess.run([
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(source), "-map", "0:a:0", "-vn", "-map_metadata", "-1",
            "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", f"{bitrate}k",
            str(output),
        ], check=True)
        size = output.stat().st_size
        if 0 < size < MAX_MP3_BYTES:
            return
        if size == 0:
            raise ValueError("FFmpeg produced an empty MP3")
    raise ValueError("Full MP3 still exceeds 25 MB at the lowest bitrate; nothing uploaded")


def transcribe(api_url, mp3, response_file):
    if not 0 < mp3.stat().st_size < MAX_MP3_BYTES:
        raise ValueError("MP3 must be nonempty and smaller than 25 MB; nothing uploaded")
    parsed = urlparse(api_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("Expected an HTTP(S) transcription API URL")
    result = subprocess.run([
        "curl", "--fail-with-body", "--silent", "--show-error",
        "--connect-timeout", "30", "--max-time", "1800",
        "--form", f"file=@{mp3};type=audio/mpeg", "--form", "timestamps=word",
        "--output", str(response_file), "--", api_url,
    ], check=False)
    if result.returncode:
        detail = response_file.read_text(encoding="utf-8", errors="replace")[:500] if response_file.exists() else ""
        raise RuntimeError(f"Transcription request failed, curl exit {result.returncode}: {detail}")
    return json.loads(response_file.read_text(encoding="utf-8"))


def build_timing(source=Path("songs.json"), output=Path("timing.json"),
                 api_url=DEFAULT_API_URL, viewer_output=Path("viewer/public/timing.json"), limit=None):
    if source.resolve() in {output.resolve(), viewer_output.resolve()}:
        raise ValueError("Timing outputs must not overwrite the song export")
    data = json.loads(source.read_text(encoding="utf-8"))
    clips = data.get("clips") if isinstance(data, dict) else None
    if not isinstance(clips, list):
        raise ValueError("Expected a songs.json export containing a clips array")
    seen = set()
    for clip in clips:
        if not isinstance(clip, dict) or not isinstance(clip.get("id"), str) or not clip["id"] or clip["id"] in seen:
            raise ValueError("Every song must have a unique, nonempty string ID")
        seen.add(clip["id"])
    state = json.loads(output.read_text(encoding="utf-8")) if output.exists() else {"version": 1, "songs": {}}
    if not isinstance(state, dict) or state.get("version") != 1 or not isinstance(state.get("songs"), dict):
        raise ValueError("Expected timing.json with version 1 and a songs object")
    # Repair the viewer copy even when a previous run stopped just after saving.
    if output.exists() and output.resolve() != viewer_output.resolve():
        save_json(state, viewer_output)
    pending = [clip for clip in clips if not has_export_timing(clip)
               and not cached(clip, state["songs"].get(clip["id"])) and clip.get("audio_url")]
    print(f"{len(pending)} songs need transcription", flush=True)
    if limit is not None:
        pending = pending[:limit]
    if pending:
        for tool in ("curl", "ffmpeg"):
            if not shutil.which(tool):
                raise OSError(f"{tool} is required to build word timing")
    for index, clip in enumerate(pending, 1):
        title = clip.get("title") or clip["id"]
        print(f"[{index}/{len(pending)}] Downloading: {title}", flush=True)
        with tempfile.TemporaryDirectory(prefix="song-timing-") as temporary:
            work = Path(temporary)
            original, mp3 = work / "original.audio", work / "audio.mp3"
            download(clip["audio_url"], original)
            print("  Converting to MP3…", flush=True)
            convert_mp3(original, mp3)
            print(f"  Transcribing {mp3.stat().st_size / 1_000_000:.2f} MB…", flush=True)
            response = transcribe(api_url, mp3, work / "response.json")
            words = transcription_words(response)
            entry = {
                "status": "completed" if words else "no_speech",
                "audio_url": clip["audio_url"],
                "created_at": datetime.now(timezone.utc).isoformat(),
                "text": " ".join(word["word"] for word in words),
                "words": words,
                "response": response,
            }
            state["songs"][clip["id"]] = entry
            save_json(state, output)
            if output.resolve() != viewer_output.resolve():
                save_json(state, viewer_output)
            print(f"  Saved {len(words)} words" if words else "  Saved: no speech detected", flush=True)
        # Temporary audio is removed before the next song is downloaded.
    print(f"Done. {len(state['songs'])} saved results in {output}", flush=True)
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("songs.json"))
    parser.add_argument("--output", type=Path, default=Path("timing.json"))
    parser.add_argument("--viewer-output", type=Path, default=Path("viewer/public/timing.json"))
    parser.add_argument("--api-url", default=os.environ.get("TRANSCRIBE_URL") or DEFAULT_API_URL,
                        help="Transcription endpoint, or set TRANSCRIBE_URL")
    parser.add_argument("--limit", type=int, help="Process at most this many songs this run")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be at least 1")
    try:
        build_timing(args.source, args.output, args.api_url, args.viewer_output, args.limit)
    except KeyboardInterrupt:
        sys.exit("Stopped. Saved results are kept; rerun the same command to resume.")
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        sys.exit(f"Timing stopped: {error}. Saved results are kept; rerun to resume.")


if __name__ == "__main__":
    main()
