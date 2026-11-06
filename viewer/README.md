# Sleeve Notes

A music library for your Flow Music export with searchable songs, original audio, cover art, song details, and lyrics highlighted using saved timing markers.

```bash
cd viewer
bun install
cp ../songs.json public/songs.json
bun run dev
```

Open the local URL printed by Vite. After exporting new songs, copy `songs.json` again and refresh the page.

Open `?id=<song-id>` to select a song without autoplay, or use the copy-link button beside M4A/WAV to share it.

To load a remote export instead, create `viewer/.env`:

```dotenv
VITE_SONGS_URL="https://example.com/songs.json"
```

Restart Vite after changing it, or rebuild for production. If unset or empty, the viewer uses its local `songs.json`. The remote server must allow CORS. This URL is public in the browser, so do not put secrets in it.

```bash
bun test
bun run build
bun run preview
```

Untimed songs show plain lyrics. Favorites come from the export. M4A/WAV links open the original files.

## Additional lyric timing

From the repository folder, run `python3 build_timing.py` with your transcription API running. See the root README for endpoint configuration and requirements. Results are saved after each song to `timing.json` and copied to `viewer/public/timing.json`. Refresh the viewer to load them.

The viewer uses the export's original timing first, then matching song IDs and audio URLs from the timing file. The fallback displays the recognized words as **Transcribed lyrics**; it does not replace the export's written lyrics. Both sources appear in the **Synced lyrics** filter. Words stop highlighting at their end timestamps, including pauses between words.

The local `timing.json` is optional. Missing timing leaves the original library usable. For a remote timing file, set `VITE_TIMING_URL` in `viewer/.env`; its server must allow CORS. An empty value loads the local file even when `VITE_SONGS_URL` is set. Invalid or unavailable timing shows a message while songs remain playable.

Production builds include `public/timing.json` when present at build time. Rebuild after adding results. GitHub Pages can use repository variable `VITE_TIMING_URL` for a hosted timing file. To bundle the generated local file in a deployment, deliberately add `viewer/public/timing.json` to Git; it is ignored by default and contains transcription data and audio URLs.

## GitHub Pages

1. Push this repository to GitHub.
2. In Settings → Pages, select **GitHub Actions** as the source.
3. For a remote export, add repository variable `VITE_SONGS_URL` under Settings → Secrets and variables → Actions → Variables. Its server must allow CORS.
4. Push to `main` or run **Deploy viewer to GitHub Pages** manually in Actions.

The workflow builds `viewer/` with Bun and sets the correct Pages base path, including custom domains. Environment URLs are embedded at build time; rerun the workflow after changing the variable.

Song exports are ignored by Git. If using the local fallback instead of a remote URL, you must intentionally track `viewer/public/songs.json` for it to be deployed.

Privacy: GitHub Pages publishes the viewer and any bundled export. A track's private/unlisted label is metadata, not access control. Never publish an export you want to keep private.
