#!/bin/bash
LOG="$HOME/Desktop/fp-compass-app/_claude_push.log"
exec > >(tee "$LOG") 2>&1
echo "===== START $(date '+%H:%M:%S') ====="
cd "$HOME/Desktop/fp-compass-app" || exit 99
git add styles-v8-workspace.css index.html
git -c user.name="Skeleton" -c user.email="t3.5ty6@gmail.com" commit -m "顧客一覧: タグが3つ以上ある行で下段が切れていたのを修正 (旧 max-height:90px の残り) + ver 20260915A"
git push origin main
echo ""; echo "===== DONE rc=$? $(date '+%H:%M:%S') ====="
