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
    # token = os.environ.get("FLOW_TOKEN") or getpass.getpass("Flow bearer token: ")
    token = "eyJhbGciOiJIUzI1NiIsImtpZCI6IllvMDR4Zm5kZWNDcktOd2ciLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2VkbmpjY3FjbWJ4ZWF4YmlkaW5yLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI0MWQ0YTY1OS0xZjYxLTQ0YWUtOTY0ZC1jZWQ1ODM0YjhjYWMiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzkxMDQ1NDQ1LCJpYXQiOjE3OTEwNDE4NDUsImVtYWlsIjoic2tvcm90a2lld2ljekBnbWFpbC5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6Imdvb2dsZSIsInByb3ZpZGVycyI6WyJnb29nbGUiXX0sInVzZXJfbWV0YWRhdGEiOnsiYXZhdGFyX3VybCI6Imh0dHBzOi8vbGgzLmdvb2dsZXVzZXJjb250ZW50LmNvbS9hL0FDZzhvY0pqMmlwVTdpZnpGd2pIZ0hZUTBkUkkwOFplVHJxWlFuOWtrNWdIVGxQZmxDOERjaXVLPXM5Ni1jIiwiZW1haWwiOiJza29yb3RraWV3aWN6QGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJmdWxsX25hbWUiOiJTZWJhc3RpYW4gS29yb3RraWV3aWN6IiwiaXNzIjoiaHR0cHM6Ly9hY2NvdW50cy5nb29nbGUuY29tIiwibmFtZSI6IlNlYmFzdGlhbiBLb3JvdGtpZXdpY3oiLCJwaG9uZV92ZXJpZmllZCI6ZmFsc2UsInBpY3R1cmUiOiJodHRwczovL2xoMy5nb29nbGV1c2VyY29udGVudC5jb20vYS9BQ2c4b2NKajJpcFU3aWZ6RndqSGdIWVEwZFJJMDhaZVRycVpRbjlrazVnSFRsUGZsQzhEY2l1Sz1zOTYtYyIsInByb3ZpZGVyX2lkIjoiMTAwMTI5NTI4MTA0MzcyMDIyNTQ0Iiwic3ViIjoiMTAwMTI5NTI4MTA0MzcyMDIyNTQ0In0sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoib2F1dGgiLCJ0aW1lc3RhbXAiOjE3ODY5MTQ0NDh9XSwic2Vzc2lvbl9pZCI6IjUzYjgzZTE3LTQyZTItNGU0MC04YWZmLTk0NTg0MWUyMmU1NCIsImlzX2Fub255bW91cyI6ZmFsc2V9.ut3wZJBpahxYj72WG4SbS7KI9hUzu_F1rwM9eetR5F4"
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
