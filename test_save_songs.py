import json
import tempfile
from pathlib import Path
from urllib.error import HTTPError

from save_songs import collect


def test_resume():
    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / "songs.json"
        song = {"id": "20", "title": "Real title", "image_url": "cover.jpg", "audio_url": "song.m4a", "wav_url": "song.wav"}
        pages = {0: [{"id": str(i)} for i in range(20)], 20: [{"id": "19"}, song]}

        def expired(token, offset):
            assert token == "test-token"
            if offset == 22:
                raise HTTPError("https://example.test", 401, "Expired", {}, None)
            return pages[offset]

        try:
            collect("test-token", output, expired)
        except HTTPError as error:
            assert error.code == 401
        else:
            raise AssertionError("Expected expired-token error")
        state = json.loads(output.read_text())
        assert len(state["clips"]) == 21
        assert state["clips"][-1] == song
        assert state["next_offset"] == 22 and not state["complete"]

        offsets = []
        def resumed(token, offset):
            offsets.append(offset)
            return [{"id": "21"}] if offset == 22 else []

        collect("fresh-token", output, resumed)
        state = json.loads(output.read_text())
        assert offsets == [22, 23]
        assert len(state["clips"]) == 22 and state["complete"]
        assert len({c["id"] for c in state["clips"]}) == 22
        collect("fresh-token", output, lambda *_: (_ for _ in ()).throw(AssertionError("Refetched completed export")))


if __name__ == "__main__":
    test_resume()
    print("PASS: pagination, metadata, deduplication, token-expiry saving, and resume")
