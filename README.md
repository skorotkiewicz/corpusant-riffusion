# Download your Flow Music songs

Back up your own songs as M4A files with embedded titles.

Requires Python 3, curl, and ExifTool.

## Quick start

1. Install dependencies. On Arch Linux: `sudo pacman -S curl exiftool`.
2. Log in to Flow Music and open your song library. In browser DevTools → Network, find the `clips/auth-user` request and copy its Authorization token, without the `Bearer ` prefix.
3. Run these commands from the repository folder:

```bash
python3 save_songs.py
python3 download_audio.py
```

Paste the token when prompted; input is hidden. Keep it private. If it expires, rerun with a fresh token. Saved progress is kept.

## Get new songs

```bash
python3 save_songs.py --update
python3 download_audio.py
```

## How it works

- `save_songs.py` fetches 100 clips per request into `songs.json`, saving each page. Disliked songs are excluded. Updates append new IDs and stop at saved IDs using newest-first ordering.
- `download_audio.py` downloads only `audio_url` with curl and embeds `title` using ExifTool. Files go in `downloads/`, named by clip ID. Completed files are skipped on reruns.

Optional helpers:

```bash
python3 extract_songs.py     # Create songs-list.json with titles and media URLs
python3 check_duplicates.py  # Check songs.json for duplicate clip IDs
```
