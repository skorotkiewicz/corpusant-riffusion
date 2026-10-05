# Sleeve Notes

A listening room for your Flow Music export: searchable records, original audio, covers, generation notes, and lyrics highlighted using saved timing markers.

```bash
cd viewer
bun install
cp ../songs.json public/songs.json
bun run dev
```

Open the local URL printed by Vite. After exporting new songs, copy `songs.json` again and refresh the page.

Open `?id=<song-id>` to select a pressing without autoplay, or use the copy-link button beside M4A/WAV to share it.

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

## GitHub Pages

1. Push this repository to GitHub.
2. In Settings → Pages, select **GitHub Actions** as the source.
3. For a remote export, add repository variable `VITE_SONGS_URL` under Settings → Secrets and variables → Actions → Variables. Its server must allow CORS.
4. Push to `main` or run **Deploy viewer to GitHub Pages** manually in Actions.

The workflow builds `viewer/` with Bun and sets the correct Pages base path, including custom domains. Environment URLs are embedded at build time; rerun the workflow after changing the variable.

Song exports are ignored by Git. If using the local fallback instead of a remote URL, you must intentionally track `viewer/public/songs.json` for it to be deployed.

Privacy: GitHub Pages publishes the viewer and any bundled export. A track's private/unlisted label is metadata, not access control. Never publish an export you want to keep private.
