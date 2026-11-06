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

Use `python3 save_songs.py --update --prompt-token` to ask for a token even when `FLOW_TOKEN` is set. You can also run `./save_songs.py` directly.

For the full update workflow, run `./run.sh`. It prompts for a token, updates the song export, copies it into the viewer, and builds missing timing. Set `TRANSCRIBE_URL` to select your transcription endpoint. The launcher stops if a step fails and uses `ding` when available, otherwise a terminal bell, when finished.

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

# eg
python3 build_timing.py --api-url http://localhost:8055/transcribe
```

The default endpoint is `http://localhost:8055/transcribe`. Use `--api-url` or `TRANSCRIBE_URL` for another endpoint. `--limit 1` processes one song as a first check; omit it to process all remaining songs.

The script skips songs with usable timing in the export and results already saved for the same song ID and audio URL. It downloads one song into a temporary directory, converts the entire song to MP3, checks that it is smaller than 25,000,000 bytes, and submits it for word timestamps. Oversized MP3s are re-encoded at lower bitrates, never truncated. Temporary audio is removed before starting the next song.

Each successful API response and its normalized words are saved atomically in `timing.json`, indexed by song ID. A copy is saved to `viewer/public/timing.json` for the viewer. Empty transcriptions are saved as `no_speech` and skipped on reruns. Songs rejected with HTTP 400, 413, or 415 are saved as `failed`, skipped, and the next song is processed. These failures are also skipped on normal reruns; add `--retry-failed` to try them again. A changed audio URL makes a song eligible for another attempt. Failed songs receive no lyric highlighting.

Connection errors, authentication failures, rate limits, and server failures still stop the run. Rerun the same command to resume from the last saved song. Ctrl+C also keeps saved results.

Options include `--source`, `--output`, and `--viewer-output` to change the default `songs.json`, `timing.json`, and `viewer/public/timing.json` paths. Both timing files are ignored by Git.

Refresh the viewer to load newly saved timing. Original export timing takes priority. Songs without it match the API's word timestamps to the original lyrics, preserving all wording, punctuation, section headings, and line breaks. One matched word is enough to highlight its whole written line. Missing words or untimed neighboring lines do not force a whole-paragraph highlight. Paragraph highlighting is used only when timing spans multiple lines and cannot be assigned to an individual line. Text without matching timing stays visible without highlighting. If a song has no written lyrics, the recognized text is displayed as **Transcribed lyrics**.
