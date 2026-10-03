#!/usr/bin/env python3
import json
from pathlib import Path

source = json.loads(Path("songs.json").read_text(encoding="utf-8"))
fields = ("title", "audio_url", "wav_url", "image_url")
songs = [{field: song.get(field) for field in fields} for song in source["clips"]]
Path("songs-list.json").write_text(
    json.dumps(songs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(f"Saved {len(songs)} songs to songs-list.json")
