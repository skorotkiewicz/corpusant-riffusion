# Sleeve Notes

A listening room for your Flow Music export: searchable records, original audio, covers, generation notes, and lyrics highlighted using saved timing markers.

```bash
cd viewer
bun install
cp ../songs.json public/songs.json
bun run dev
```

Open the local URL printed by Vite. After exporting new songs, copy `songs.json` again and refresh the page.

```bash
bun test
bun run build
bun run preview
```

Untimed songs show plain lyrics. Favorites come from the export. M4A/WAV links open the original files.

Privacy: the entire `public/songs.json` export is served to visitors. A track's private/unlisted label is metadata, not access control. Keep this viewer local or protect it before hosting.
