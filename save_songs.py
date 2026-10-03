#!/usr/bin/env python3
"""Fetch all Flow generations. Rerun with a fresh token to resume songs.json."""
import getpass
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

OUTPUT = Path("songs.json")
LIMIT = 20


def fetch_page(token, offset):
    query = urlencode({"limit": LIMIT, "offset": offset, "filter": "generations", "include_disliked": "false"})
    request = Request("https://www.flowmusic.app/__api/clips/auth-user?" + query, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.flowmusic.app/library/my-songs",
    })
    with urlopen(request, timeout=60) as response:
        data = json.load(response)
    clips = data.get("clips")
    if not isinstance(clips, list) or any(not isinstance(c, dict) or not c.get("id") for c in clips):
        raise ValueError("Unexpected API response: expected clips with IDs")
    return clips


def save(state, output):
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(output)


def collect(token, output=OUTPUT, fetch=fetch_page):
    state = json.loads(output.read_text()) if output.exists() else {"clips": [], "next_offset": 0, "complete": False}
    if state["complete"]:
        print(f"Already complete: {len(state['clips'])} songs in {output}", flush=True)
        return
    save(state, output)
    seen = {clip["id"] for clip in state["clips"]}
    while True:
        page = fetch(token, state["next_offset"])
        if not page:
            state["complete"] = True
            save(state, output)
            print(f"Complete: {len(state['clips'])} songs in {output}", flush=True)
            return
        new = [clip for clip in page if clip["id"] not in seen]
        if not new:
            raise ValueError("API repeated a page; stopped without marking the export complete")
        for clip in new:
            if clip["id"] not in seen:
                state["clips"].append(clip)
                seen.add(clip["id"])
        state["next_offset"] += len(page)
        save(state, output)
        print(f"Saved {len(state['clips'])} songs; next offset {state['next_offset']}", flush=True)


def main():
    token = os.environ.get("FLOW_TOKEN") or getpass.getpass("Flow bearer token: ")
    if not token.strip():
        sys.exit("A bearer token is required")
    try:
        collect(token.strip())
    except HTTPError as error:
        if error.code in (401, 403):
            sys.exit("Authentication rejected (token may have expired). Progress is saved in songs.json. Supply a fresh token and rerun to resume.")
        sys.exit(f"HTTP {error.code}. Progress is saved; rerun to resume.")
    except (OSError, ValueError) as error:
        sys.exit(f"{error}. Progress is saved; rerun to resume.")


if __name__ == "__main__":
    main()
