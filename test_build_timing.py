import json
import subprocess
import wave
from pathlib import Path
from unittest.mock import patch

import pytest

from build_timing import (
    MAX_MP3_BYTES, build_timing, cached, convert_mp3, has_export_timing,
    transcribe, transcription_words,
)


def test_export_timing_and_word_validation():
    clip = {
        "lyrics": {"value": {"id": "lyrics", "text": "🌑 Hello"}},
        "lyrics_timing": {"status": "completed", "value": {"lyrics_id": "lyrics", "markers": [[3, 1]]}},
    }
    assert has_export_timing(clip)
    clip["lyrics_timing"]["value"]["lyrics_id"] = "other"
    assert not has_export_timing(clip)
    words = [{"word": " Hello ", "start": 1.5, "end": 2}]
    assert transcription_words({"words": words}) == [{"word": "Hello", "start": 1.5, "end": 2}]
    assert transcription_words({"segments": [{"words": words}]})[0]["word"] == "Hello"
    assert transcription_words({"text": "", "segments": []}) == []
    for response in [
        {}, {"text": "Hello", "words": []}, {"segments": [{"text": "Hello"}]},
        {"words": [{"word": "Hello", "start": -1, "end": 2}]},
        {"words": [{"word": "Hello", "start": 2, "end": 1}]},
        {"words": [{"word": "Hello", "start": float("nan"), "end": 2}]},
        {"words": [{"word": "Hello", "start": True, "end": 2}]},
    ]:
        with pytest.raises(ValueError):
            transcription_words(response)


def test_real_ffmpeg_conversion(tmp_path):
    source, target = tmp_path / "original.wav", tmp_path / "audio.mp3"
    with wave.open(str(source), "wb") as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(44100)
        audio.writeframes(b"\x00" * 44100 * 4)
    convert_mp3(source, target)
    assert 0 < target.stat().st_size < MAX_MP3_BYTES
    # Decode the MP3 and check that normal conversion preserves stereo/sample rate.
    decoded = tmp_path / "decoded.wav"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(target), str(decoded)], check=True)
    with wave.open(str(decoded), "rb") as audio:
        assert audio.getnchannels() == 2
        assert audio.getframerate() == 44100


def test_bitrate_fallback_and_upload_limit(tmp_path):
    mp3 = tmp_path / "audio.mp3"
    bitrates = []

    def encode(command, **kwargs):
        bitrates.append(command[command.index("-b:a") + 1] if "-b:a" in command else "default")
        mp3.write_bytes(b"x" * (20 if len(bitrates) == 1 else 5))

    with patch("build_timing.MAX_MP3_BYTES", 10), patch("build_timing.subprocess.run", side_effect=encode):
        convert_mp3(tmp_path / "original", mp3)
    assert bitrates == ["default", "96k"]
    mp3.write_bytes(b"x" * 10)
    with patch("build_timing.MAX_MP3_BYTES", 10), patch("build_timing.subprocess.run") as run:
        with pytest.raises(ValueError, match="smaller than 25 MB"):
            transcribe("http://localhost/transcribe", mp3, tmp_path / "response.json")
        run.assert_not_called()


def test_sequential_checkpoints_resume_and_cleanup(tmp_path):
    source, output, viewer = (tmp_path / name for name in ("songs.json", "timing.json", "public/timing.json"))
    native = {
        "id": "native", "audio_url": "https://example.test/native.m4a",
        "lyrics": {"value": {"id": "lyrics", "text": "Hello"}},
        "lyrics_timing": {"status": "completed", "value": {"lyrics_id": "lyrics", "markers": [[0, 0]]}},
    }
    clips = [native, {"id": "missing"}] + [
        {"id": name, "audio_url": f"https://example.test/{name}.m4a"} for name in ("one", "two", "silent")
    ]
    source.write_text(json.dumps({"clips": clips}))
    downloaded, temporary_paths = [], []
    fail_second = True

    def download(url, target):
        # No next download until the previous song is saved and cleaned up.
        assert all(not path.exists() for path in temporary_paths)
        if url.endswith("two.m4a"):
            assert "one" in json.loads(output.read_text())["songs"]
            assert json.loads(output.read_text()) == json.loads(viewer.read_text())
        downloaded.append(url)
        temporary_paths.append(target.parent)
        target.write_bytes(b"source")

    def convert(source, target):
        assert source.exists()
        target.write_bytes(b"mp3")

    def api(url, mp3, response):
        assert mp3.exists()
        if downloaded[-1].endswith("two.m4a") and fail_second:
            raise RuntimeError("API offline")
        return {"text": "", "segments": []} if downloaded[-1].endswith("silent.m4a") else {
            "words": [{"word": "Hello", "start": 1, "end": 2}], "language": "en",
        }

    with patch("build_timing.download", side_effect=download), \
            patch("build_timing.convert_mp3", side_effect=convert), \
            patch("build_timing.transcribe", side_effect=api), \
            patch("build_timing.shutil.which", return_value="tool"):
        with pytest.raises(RuntimeError, match="API offline"):
            build_timing(source, output, viewer_output=viewer)
        assert list(json.loads(output.read_text())["songs"]) == ["one"]
        fail_second = False
        state = build_timing(source, output, viewer_output=viewer)
        assert list(state["songs"]) == ["one", "two", "silent"]
        assert state["songs"]["one"]["response"]["language"] == "en"
        assert state["songs"]["silent"]["status"] == "no_speech"
        # Recover a missing viewer copy without repeating requests.
        viewer.unlink()
        build_timing(source, output, viewer_output=viewer)
        assert json.loads(viewer.read_text()) == state
    assert len(downloaded) == 4
    assert all(not path.exists() for path in temporary_paths)
    assert cached(clips[2], state["songs"]["one"])
    assert not cached({**clips[2], "audio_url": "https://example.test/changed.m4a"}, state["songs"]["one"])


def test_malformed_state(tmp_path):
    source = tmp_path / "songs.json"
    output = tmp_path / "timing.json"
    source.write_text(json.dumps({"clips": [{"id": "one"}, {"id": "one"}]}))
    with pytest.raises(ValueError, match="unique"):
        build_timing(source, output, viewer_output=output)
    source.write_text(json.dumps({"clips": []}))
    output.write_text("{}")
    with pytest.raises(ValueError, match="version 1"):
        build_timing(source, output, viewer_output=output)
    with pytest.raises(ValueError, match="overwrite"):
        build_timing(source, source, viewer_output=output)


def test_limit_saves_one_song(tmp_path):
    source, output = tmp_path / "songs.json", tmp_path / "timing.json"
    source.write_text(json.dumps({"clips": [
        {"id": name, "audio_url": f"https://example.test/{name}.m4a"} for name in ("one", "two")
    ]}))
    with patch("build_timing.download"), \
            patch("build_timing.convert_mp3", side_effect=lambda source, target: target.write_bytes(b"mp3")), \
            patch("build_timing.transcribe", return_value={"words": [{"word": "Hi", "start": 0, "end": 1}]}) as api, \
            patch("build_timing.shutil.which", return_value="tool"):
        state = build_timing(source, output, viewer_output=output, limit=1)
    assert list(state["songs"]) == ["one"]
    api.assert_called_once()

