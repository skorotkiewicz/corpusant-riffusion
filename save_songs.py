#!/usr/bin/env python3
"""Fetch Flow generations; use --update to append new songs to songs.json."""
import argparse
import base64
import getpass
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

OUTPUT = Path("songs.json")
LIMIT = 100


def auth_cookie(token):
    parts = token.split(".")
    if len(parts) != 3 or not all(parts) or not token.startswith("eyJ"):
        raise ValueError("Supply only the JWT starting with eyJ")
    try:
        claims = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
        expiry = claims["exp"]
        if type(expiry) is not int:
            raise ValueError("Invalid JWT expiry")
    except (ValueError, KeyError, TypeError) as error:
        raise ValueError("Invalid JWT: expected an exp claim") from error
    # Flow's proxy reads a Supabase session cookie; JWT verification stays on the server.
    session = {"access_token": token, "refresh_token": "", "expires_at": expiry}
    value = "base64-" + base64.urlsafe_b64encode(json.dumps(session, separators=(",", ":")).encode()).decode().rstrip("=")
    name = "sb-sb-auth-token"
    if len(value) <= 3180:
        return name + "=" + value
    return "; ".join(f"{name}.{i // 3180}={value[i:i + 3180]}" for i in range(0, len(value), 3180))


def fetch_page(token, offset):
    query = urlencode({"limit": LIMIT, "offset": offset, "filter": "generations", "include_disliked": "false"})
    request = Request("https://www.flowmusic.app/__api/clips/auth-user?" + query, headers={
        "Authorization": "Bearer " + token,
        "Cookie": auth_cookie(token),
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


def collect(token, output=OUTPUT, fetch=fetch_page, update=False):
    state = json.loads(output.read_text()) if output.exists() else {"clips": [], "next_offset": 0, "complete": False}
    if update and not state["complete"] and state["clips"] and "update_known_ids" not in state:
        raise ValueError("Finish the incomplete initial export before using --update")
    updating = update or "update_known_ids" in state
    if state["complete"] and not updating:
        print(f"Already complete: {len(state['clips'])} songs in {output}", flush=True)
        return
    if updating:
        # Keep the original baseline: songs saved before token expiry aren't a stop signal.
        state.setdefault("update_known_ids", [clip["id"] for clip in state["clips"]])
        state["complete"] = False
        state["next_offset"] = 0
    known = set(state.get("update_known_ids", []))
    save(state, output)
    seen = {clip["id"] for clip in state["clips"]}
    pages = set()
    while True:
        page = fetch(token, state["next_offset"])
        page_ids = tuple(clip["id"] for clip in page)
        if page_ids in pages:
            raise ValueError("API repeated a page; stopped without marking the export complete")
        pages.add(page_ids)
        new = [clip for clip in page if clip["id"] not in seen]
        if page and not new and not updating:
            raise ValueError("API repeated a page; stopped without marking the export complete")
        for clip in new:
            if clip["id"] not in seen:
                state["clips"].append(clip)
                seen.add(clip["id"])
        state["next_offset"] += len(page)
        # ponytail: early stop assumes newest-first ordering; full scan if API ordering changes.
        if not page or (updating and known.intersection(page_ids)):
            state["complete"] = True
            state.pop("update_known_ids", None)
        save(state, output)
        if state["complete"]:
            print(f"Complete: {len(state['clips'])} songs in {output}", flush=True)
            return
        print(f"Saved {len(state['clips'])} songs; next offset {state['next_offset']}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update", action="store_true", help="Append new songs, stopping at previously saved IDs")
    args = parser.parse_args()
    token = os.environ.get("FLOW_TOKEN") or getpass.getpass("Flow token: ")
    if not token.strip():
        sys.exit("A bearer token is required")
    try:
        collect(token.strip(), update=args.update)
    except HTTPError as error:
        if error.code in (401, 403):
            sys.exit(f"HTTP {error.code}: authentication rejected. Progress is saved in songs.json; rerun to resume.")
        sys.exit(f"HTTP {error.code}. Progress is saved; rerun to resume.")
    except (OSError, ValueError) as error:
        sys.exit(f"{error}. Progress is saved; rerun to resume.")


if __name__ == "__main__":
    main()
