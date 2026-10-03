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
    for tool in ("curl", "exiftool"):
        if not shutil.which(tool):
            raise OSError(f"{tool} is required to download and tag M4A audio")
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
            "curl", "--fail", "--location", "--silent", "--show-error",
            "--proto", "=https", "--proto-redir", "=https",
            "--connect-timeout", "30", "--speed-limit", "1", "--speed-time", "60",
            "--output", str(partial), "--", url,
        ], check=True)
        subprocess.run([
            "exiftool", "-q", "-overwrite_original", f"-ItemList:Title={title}", str(partial),
        ], check=True)
        partial.replace(output)
    print(f"Finished. Audio saved in {directory}", flush=True)


if __name__ == "__main__":
    try:
        download_audio()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        sys.exit(f"Download stopped: {error}. Rerun to resume; completed files are kept.")
