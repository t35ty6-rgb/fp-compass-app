#!/bin/bash
# ============================================================
# Skeleton Amazon Label Auto-Print Installer
#   実行:  bash <(curl -s https://app.skeleton-inc.jp/setup-amazon-auto-print.sh)
#   効果:  ~/Downloads/amazon-labels-print/ に PDF 保存 され た 30秒 以内 に
#         デフォルト プリンター で 自動 印刷 → archive/ 移動
# ============================================================
set -e

DIR="$HOME/.skeleton-amazon-print"
PLIST="$HOME/Library/LaunchAgents/com.skeleton.amazon-label-printer.plist"
PRINT_FOLDER="$HOME/Downloads/amazon-labels-print"

echo "==> Skeleton Amazon Label Auto-Print Installer"

# 1. dir setup
mkdir -p "$DIR"
mkdir -p "$PRINT_FOLDER/archive"
echo "  ok: $DIR + $PRINT_FOLDER/archive"

# 2. watcher.sh 作成
cat > "$DIR/watcher.sh" << 'WATCHER_EOF'
#!/bin/bash
# watcher: 30秒 毎 に PDF 検知 → lpr 送信 → archive 移動
FOLDER="$HOME/Downloads/amazon-labels-print"
mkdir -p "$FOLDER/archive"
cd "$FOLDER" || exit 0

for f in *.pdf; do
  [ -f "$f" ] || continue
  ts=$(date '+%Y-%m-%d %H:%M:%S')
  echo "$ts printing: $f"
  # lpr 実行 (失敗 して も archive に 移動 して 再試行 loop に 陥ら ない)
  if lpr "$f" 2>/dev/null; then
    mv "$f" "archive/$(date '+%Y%m%d_%H%M%S')_$f"
    echo "$ts   → archived"
  else
    echo "$ts   ✗ lpr fail (デフォルト プリンター 未設定?)、 file 保持"
    # 失敗 file は 15分 以上 経ってたら archive/failed に (無限 retry 防止)
    if [ $(($(date +%s) - $(stat -f %m "$f"))) -gt 900 ]; then
      mkdir -p archive/failed
      mv "$f" "archive/failed/$(date '+%Y%m%d_%H%M%S')_$f"
      echo "$ts   → moved to archive/failed/ (15分 経過)"
    fi
  fi
done
WATCHER_EOF
chmod +x "$DIR/watcher.sh"
echo "  ok: watcher.sh"

# 3. plist 作成
cat > "$PLIST" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.skeleton.amazon-label-printer</string>
  <key>ProgramArguments</key><array><string>$DIR/watcher.sh</string></array>
  <key>StartInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$DIR/watcher.log</string>
  <key>StandardErrorPath</key><string>$DIR/watcher.err</string>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST_EOF
echo "  ok: plist"

# 4. LaunchAgent load
launchctl unload -w "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
echo "  ok: LaunchAgent loaded"

# 5. デフォルト プリンター 確認
DEFAULT_PRINTER=$(lpstat -d 2>/dev/null | grep -oE 'system default destination: .*' | sed 's/system default destination: //')
if [ -z "$DEFAULT_PRINTER" ]; then
  echo ""
  echo "  ⚠  警告: デフォルト プリンター が 設定 されて い ません"
  echo "     システム設定 → プリンタ で プリンター 追加 + デフォルト 指定 して"
else
  echo "  ok: デフォルト プリンター = $DEFAULT_PRINTER"
fi

echo ""
echo "================================================================="
echo "✓ Amazon Auto-Print インストール 完了"
echo "  監視 folder: $PRINT_FOLDER"
echo "  ログ      : $DIR/watcher.log (tail -f で 見れ る)"
echo "  archive   : $PRINT_FOLDER/archive/"
echo "  停止 は  : launchctl unload -w $PLIST"
echo "================================================================="
