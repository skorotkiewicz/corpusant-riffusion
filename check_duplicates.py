#!/usr/bin/env python3
import json
from collections import Counter
from pathlib import Path

clips = json.loads(Path("songs.json").read_text(encoding="utf-8"))["clips"]
counts = Counter(clip["id"] for clip in clips)
print(json.dumps({
    "total_clips": len(clips),
    "unique_ids": len(counts),
    "duplicate_ids": {clip_id: count for clip_id, count in counts.items() if count > 1},
}, indent=2))
