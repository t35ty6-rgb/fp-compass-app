#!/bin/zsh
# _all.webm + _timeline.json → 各 章 mp4 (音声マージ + tpad 尺揃え) → final.mp4 連結
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

WEBM="_all.webm"
TL="_timeline.json"
AUDIO_DIR="../audio"

[ ! -f "$WEBM" ] && { echo "✗ no $WEBM"; exit 1; }
[ ! -f "$TL" ] && { echo "✗ no $TL"; exit 1; }

python3 << 'PYEOF' > /tmp/_fpc_split.sh
import json, os, subprocess
with open('_timeline.json') as f: timeline = json.load(f)
audio_dir = '../audio'
lines = []
for entry in timeline:
    n = entry['name']
    vid_start = entry['start']
    vid_dur = entry['end'] - entry['start']
    mp3 = f'{audio_dir}/{n}.mp3'
    if not os.path.exists(mp3):
        print(f"# SKIP {n}: no mp3", flush=True)
        continue
    nar_dur = float(subprocess.check_output(['ffprobe','-i',mp3,'-show_entries','format=duration','-v','quiet','-of','csv=p=0']).strip())
    diff = nar_dur - vid_dur
    if diff > 0.3:
        vf = f"tpad=stop_mode=clone:stop_duration={diff:.2f},format=yuv420p"
    else:
        vf = "format=yuv420p"
    lines.append(f'echo "→ {n} (vid {vid_dur:.1f}s, nar {nar_dur:.1f}s, pad {max(diff,0):.1f}s)"')
    lines.append(f'ffmpeg -y -ss {vid_start:.3f} -t {vid_dur:.3f} -i "_all.webm" -i "{mp3}" -c:v libx264 -preset fast -crf 22 -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -vf "{vf}" -movflags +faststart "{n}.mp4" 2>/dev/null')
print('\n'.join(lines))
PYEOF

bash /tmp/_fpc_split.sh

# 全 章 を 連結 → final.mp4
echo ""
echo "→ concat → final.mp4"
CONCAT_LIST=/tmp/_fpc_concat.txt
> "$CONCAT_LIST"
for mp4 in $(ls [0-9]*.mp4 | sort); do
  echo "file '$DIR/$mp4'" >> "$CONCAT_LIST"
done
cat "$CONCAT_LIST"

# 章間で resolution 一致してるので concat demuxer で 一発 (再エンコード無し)
ffmpeg -y -f concat -safe 0 -i "$CONCAT_LIST" -c copy final.mp4 2>/dev/null || {
  # copy失敗時は 再エンコード fallback
  ffmpeg -y -f concat -safe 0 -i "$CONCAT_LIST" -c:v libx264 -preset fast -crf 22 -c:a aac -b:a 128k final.mp4 2>/dev/null
}

echo ""
ls -la *.mp4 2>/dev/null | awk '{print $9, $5}'

# 目的地 に copy
DEST=/Users/tsukasayoshida/Desktop/fp-compass-app/chrome-ext-install-video.mp4
cp final.mp4 "$DEST"
echo ""
echo "✅ 完成: $DEST"
ffprobe -i "$DEST" -show_entries format=duration,size -v quiet -of default=noprint_wrappers=1
