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
        run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=duration=0.1", "-c:a", "aac", str(fixture)], check=True)
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
            command = list(command)
            position = command.index("-i") + 1
            urls.append(command[position])
            command[position] = str(fixture)
            return run(command, **kwargs)

        with patch("download_audio.subprocess.run", side_effect=offline_download):
            download_audio(source, output)
            download_audio(source, output)
        assert urls == [clip["audio_url"] for clip in clips]
        assert len(list(output.glob("*.m4a"))) == 2
        for clip in clips:
            audio = output / (clip["id"] + ".m4a")
            probe = run(["ffprobe", "-v", "error", "-show_entries", "format_tags=title", "-of", "json", str(audio)], check=True, capture_output=True, text=True)
            assert json.loads(probe.stdout)["format"]["tags"]["title"] == title

        broken = {**clips[0], "id": "00000000-0000-0000-0000-000000000003"}
        source.write_text(json.dumps({"clips": [broken]}))
        with patch("download_audio.subprocess.run", side_effect=subprocess.CalledProcessError(1, "ffmpeg")):
            try:
                download_audio(source, output)
            except subprocess.CalledProcessError:
                pass
            else:
                raise AssertionError("Failed downloads must not be marked complete")
        assert not (output / (broken["id"] + ".m4a")).exists()
        assert len(list(output.glob("*.m4a"))) == 2


if __name__ == "__main__":
    test_download()
    print("PASS: audio-only URLs, embedded titles, duplicate titles, resume, and failure safety")
