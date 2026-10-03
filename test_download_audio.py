import json
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch

from download_audio import download_audio


def test_download():
    run = subprocess.run
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        fixture = root / "fixture.m4a"
        # Minimal MP4 container for a real ExifTool metadata round trip.
        fixture.write_bytes(
            b"\x00\x00\x00\x18ftypM4A \x00\x00\x00\x00M4A isom"
            b"\x00\x00\x00\x08moov"
        )
        title = 'Iron & Amber / "quoted" ♥'
        clips = [{
            "id": f"00000000-0000-0000-0000-{number:012d}",
            "title": title,
            "audio_url": f"https://example.test/{number}.m4a",
            "wav_url": "https://example.test/never.wav",
            "image_url": "https://example.test/never.jpg",
        } for number in (1, 2)]
        source = root / "songs.json"
        source.write_text(json.dumps({"clips": clips}))
        output = root / "downloads"
        urls = []

        def offline_download(command, **kwargs):
            if command[0] == "curl":
                urls.append(command[-1])
                target = Path(command[command.index("--output") + 1])
                target.write_bytes(fixture.read_bytes())
                return subprocess.CompletedProcess(command, 0)
            return run(command, **kwargs)

        with patch("download_audio.subprocess.run", side_effect=offline_download):
            download_audio(source, output)
            download_audio(source, output)
        assert urls == [clip["audio_url"] for clip in clips]
        assert len(list(output.glob("*.m4a"))) == 2
        for clip in clips:
            audio = output / (clip["id"] + ".m4a")
            probe = run(["exiftool", "-j", "-ItemList:Title", str(audio)], check=True, capture_output=True, text=True)
            assert json.loads(probe.stdout)[0]["Title"] == title
        assert not list(output.glob("*_original"))

        broken = {**clips[0], "id": "00000000-0000-0000-0000-000000000003"}
        source.write_text(json.dumps({"clips": [broken]}))
        for tool in ("curl", "exiftool"):
            def failed(command, **kwargs):
                if command[0] == tool:
                    raise subprocess.CalledProcessError(1, command)
                return offline_download(command, **kwargs)

            with patch("download_audio.subprocess.run", side_effect=failed):
                try:
                    download_audio(source, output)
                except subprocess.CalledProcessError:
                    pass
                else:
                    raise AssertionError("Failed downloads or tagging must not be marked complete")
            assert not (output / (broken["id"] + ".m4a")).exists()
            assert all((output / (clip["id"] + ".m4a")).exists() for clip in clips)


if __name__ == "__main__":
    test_download()
    print("PASS: audio-only URLs, embedded titles, duplicate titles, resume, and failure safety")
