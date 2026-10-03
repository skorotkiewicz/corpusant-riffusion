#!/usr/bin/env python3
"""Download M4A audio from songs.json and embed each song's title."""
import json
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID


def download_audio(source=Path("songs.json"), directory=Path("downloads")):
    if not shutil.which("ffmpeg"):
        raise OSError("ffmpeg is required to write M4A title metadata")
    clips = json.loads(source.read_text(encoding="utf-8"))["clips"]
    directory.mkdir(parents=True, exist_ok=True)
    for index, clip in enumerate(clips, 1):
        url = clip.get("audio_url")
        if not url:
            print(f"[{index}/{len(clips)}] No audio URL: {clip['id']}", flush=True)
            continue
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError(f"Expected an HTTPS audio URL for {clip['id']}")
        # IDs keep duplicate titles distinct and cannot escape the output directory.
        output = directory / f"{UUID(clip['id'])}.m4a"
        if output.exists():
            print(f"[{index}/{len(clips)}] Already saved: {output.name}", flush=True)
            continue
        title = clip.get("title") or "Untitled"
        partial = output.with_suffix(".part.m4a")
        print(f"[{index}/{len(clips)}] Downloading: {title}", flush=True)
        subprocess.run([
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-rw_timeout", "60000000", "-i", url,
            "-map", "0:a:0", "-c", "copy", "-metadata", f"title={title}",
            "-f", "ipod", str(partial),
        ], check=True)
        partial.replace(output)
    print(f"Finished. Audio saved in {directory}", flush=True)


if __name__ == "__main__":
    try:
        download_audio()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        sys.exit(f"Download stopped: {error}. Rerun to resume; completed files are kept.")
