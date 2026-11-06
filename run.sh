#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

python3 save_songs.py --update --prompt-token
cp songs.json viewer/public/songs.json
python3 build_timing.py --api-url "${TRANSCRIBE_URL:-http://192.168.0.124:8055/transcribe}"

if command -v ding >/dev/null 2>&1; then
    ding
else
    printf '\a'
fi
