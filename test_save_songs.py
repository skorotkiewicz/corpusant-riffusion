import base64
import json
import tempfile
from io import StringIO
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse

from save_songs import LIMIT, auth_cookie, collect, fetch_page, main


def jwt_token(padding=""):
    claims = {"exp": 2000000000, "padding": padding}
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return "eyJhbGciOiJIUzI1NiJ9." + payload + ".test-signature"


def test_token_auth():
    for padding in ("", "x" * 5000):
        token = jwt_token(padding)

        def response(request, timeout):
            assert request.get_header("Authorization") == "Bearer " + token
            chunks = [item.split("=", 1) for item in request.get_header("Cookie").split("; ")]
            names = [name for name, _ in chunks]
            assert names == (["sb-sb-auth-token"] if not padding else [f"sb-sb-auth-token.{i}" for i in range(len(chunks))])
            assert all(len(value) <= 3180 for _, value in chunks)
            encoded = "".join(value for _, value in chunks)
            assert encoded.startswith("base64-")
            payload = encoded[len("base64-"):]
            session = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            assert session == {"access_token": token, "refresh_token": "", "expires_at": 2000000000}
            assert timeout == 60
            return StringIO('{"clips": []}')

        with patch("save_songs.urlopen", side_effect=response):
            assert fetch_page(token, 0) == []

    for invalid in ("", "Bearer " + jwt_token(), "eyJ.bad.signature", "eyJ.e30.signature", "eyJ.W10.signature", "eyJ.eyJleHAiOiJub3QtaW50In0.signature"):
        try:
            auth_cookie(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError("Expected invalid-token error")

    token = jwt_token()
    for code in (401, 403):
        error = HTTPError("https://example.test", code, "Unauthorized", {}, None)
        with patch.dict("os.environ", {"FLOW_TOKEN": token}, clear=True), patch("sys.argv", ["save_songs.py", "--update"]):
            with patch("save_songs.collect", side_effect=error) as collect_mock:
                try:
                    main()
                except SystemExit as result:
                    assert str(result).startswith(f"HTTP {code}:")
                    assert "expired" not in str(result) and token not in str(result)
                else:
                    raise AssertionError("Expected authentication failure")
                collect_mock.assert_called_once_with(token, update=True)


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


def test_update():
    def response(request, timeout):
        query = parse_qs(urlparse(request.full_url).query)
        assert query["limit"] == ["100"] and query["offset"] == ["7"]
        return StringIO('{"clips": []}')

    with patch("save_songs.urlopen", side_effect=response):
        assert fetch_page(jwt_token(), 7) == []

    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / "songs.json"
        old = {"id": "old", "title": "Keep existing metadata"}
        output.write_text(json.dumps({"clips": [old], "next_offset": 529, "complete": True}))
        new_page = [{"id": f"new-{i}"} for i in range(LIMIT)]

        def expired(token, offset):
            if offset == 0:
                return new_page
            assert offset == LIMIT
            raise HTTPError("https://example.test", 401, "Expired", {}, None)

        try:
            collect("test-token", output, expired, update=True)
        except HTTPError:
            pass
        else:
            raise AssertionError("Expected expired-token error")
        state = json.loads(output.read_text())
        assert len(state["clips"]) == LIMIT + 1 and not state["complete"]
        assert state["update_known_ids"] == ["old"]

        # Another song arrives during token renewal; rescan from zero without stopping early.
        arrived = {"id": "arrived-during-renewal"}
        older_new = {"id": "older-new", "audio_url": "song.m4a"}
        offsets = []
        def resumed(token, offset):
            offsets.append(offset)
            return {0: [arrived] + new_page[:-1], LIMIT: [new_page[-1], older_new, old]}[offset]

        collect("fresh-token", output, resumed)
        state = json.loads(output.read_text())
        assert offsets == [0, LIMIT]
        assert len(state["clips"]) == LIMIT + 3 and state["complete"]
        assert "update_known_ids" not in state
        assert state["clips"][0] == old and state["clips"][-1] == older_new
        assert len({clip["id"] for clip in state["clips"]}) == len(state["clips"])

        offsets.clear()
        previous = state["clips"]
        collect("fresh-token", output, resumed, update=True)
        assert offsets == [0]  # Nothing new: stop after the first page.
        assert json.loads(output.read_text())["clips"] == previous

        # An initial export must finish before early-stop updates are safe.
        output.write_text(json.dumps({"clips": [old], "next_offset": 1, "complete": False}))
        try:
            collect("test-token", output, resumed, update=True)
        except ValueError:
            pass
        else:
            raise AssertionError("Cannot early-stop an incomplete initial export")


if __name__ == "__main__":
    test_token_auth()
    test_resume()
    test_update()
    print("PASS: JWT session cookies, validation, auth errors, limit 100, pagination, updates, deduplication, and resume")
