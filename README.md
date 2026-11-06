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

Paste only the JWT starting with `eyJ` when prompted; input is hidden. You can also supply it through `FLOW_TOKEN`, which overrides the prompt. The script builds Flow's Supabase session cookie automatically from that token, without another environment variable or saving credentials. If it expires, rerun with a fresh token. Saved progress is kept.

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

## Add word timing

Requires Python 3, curl, FFmpeg with the `libmp3lame` encoder, and a running transcription API that accepts `file` and `timestamps=word` multipart fields. Run from the repository folder:

```bash
python3 build_timing.py --limit 1
python3 build_timing.py
```

The default endpoint is `http://localhost:8055/transcribe`. Use `--api-url` or `TRANSCRIBE_URL` for another endpoint. `--limit 1` processes one song as a first check; omit it to process all remaining songs.

The script skips songs with usable timing in the export and results already saved for the same song ID and audio URL. It downloads one song into a temporary directory, converts the entire song to MP3, checks that it is smaller than 25,000,000 bytes, and submits it for word timestamps. Oversized MP3s are re-encoded at lower bitrates, never truncated. Temporary audio is removed before starting the next song.

Each successful API response and its normalized words are saved atomically in `timing.json`, indexed by song ID. A copy is saved to `viewer/public/timing.json` for the viewer. Empty transcriptions are saved as `no_speech` and skipped on reruns. Errors stop the run; rerun the same command to resume from the last saved song. Ctrl+C also keeps saved results.

Options include `--source`, `--output`, and `--viewer-output` to change the default `songs.json`, `timing.json`, and `viewer/public/timing.json` paths. Both timing files are ignored by Git.

Refresh the viewer to load newly saved timing. Original export timing takes priority. Songs without it use the API's transcribed words, labeled **Transcribed lyrics** because speech recognition may differ from the original lyrics. The export's written lyrics remain intact.
