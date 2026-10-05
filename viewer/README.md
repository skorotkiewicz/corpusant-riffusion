# Sleeve Notes

A listening room for your Flow Music export: searchable records, original audio, covers, generation notes, and lyrics highlighted using saved timing markers.

```bash
cd viewer
bun install
cp ../songs.json public/songs.json
bun run dev
```

Open the local URL printed by Vite. After exporting new songs, copy `songs.json` again and refresh the page.

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

Privacy: the entire `public/songs.json` export is served to visitors. A track's private/unlisted label is metadata, not access control. Keep this viewer local or protect it before hosting.
