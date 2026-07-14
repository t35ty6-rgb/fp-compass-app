#!/bin/zsh
# FP Compass Chrome拡張 install ガイド TTS v2 (音声 二重感 修正)
# 変更点:
#  - URL 分解 → まとめ発音
#  - 1.15x → 1.0x (自然速度)
#  - 単語間 pause 削減、 流暢 に
set -e
VOICE="ja-JP-Neural2-C"
RATE="1.0"
PROJECT="skeleton-pricer-130118"
OUT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$OUT_DIR"

declare -A NARR=(
  ["01-open-chrome"]="まず、 クローム を 開きます。 画面 下 の ドック から、 ぐーぐる クローム の アイコン を クリック して ください。"

  ["02-extensions-url"]="次 に、 上 の アドレス バー に、 コピー した 文字列 を 貼り付けて、 エンター キー を 押します。 これ が カクチョウキノウ の 管理 画面 です。"

  ["03-developer-mode"]="画面 の 右上 に、 でべろっぱー もーど の スイッチ が あります。 これ を クリック して オン に して ください。 スイッチ が 青く なれば オン 状態 です。"

  ["04-load-folder"]="次 に、 左上 に 現れた、 パッケージ化 されて いない カクチョウキノウ を、 読み込む、 という ボタン を クリック します。 フォルダ 選択 の 画面 が 開いた ら、 デスクトップ に ある、 えふぴー コンパス カクチョウキノウ、 の フォルダ を 選んで、 選択 を 押して ください。"

  ["05-pin"]="カクチョウキノウ が 一覧 に 追加 されました。 続いて、 クローム 右上 に ある、 パズル ピース の アイコン を クリック します。 えふぴー コンパス 議事録 レコーダー の 横 の、 ピン の アイコン を クリック する と、 ツール バー に 常に 表示 されます。"

  ["06-test"]="最後 に、 動作 確認 です。 ユーチューブ を 開いて、 動画 を 再生 して ください。 カクチョウキノウ の アイコン を クリック し、 録音 開始 を 押して、 ユーチューブ の タブ を 選択 し、 十 秒 ほど 待って、 停止 を 押します。 これ で、 えふぴー コンパス クローム カクチョウキノウ の セットアップ は 完了 です。"
)

gen() {
  local n="$1" text="$2"
  printf "  [%s] %4d文字 → " "$n" "${#text}"
  python3 -c "
import json
print(json.dumps({
    'input': {'text': '''$text'''},
    'voice': {'languageCode': 'ja-JP', 'name': '$VOICE'},
    'audioConfig': {'audioEncoding': 'MP3', 'speakingRate': $RATE, 'sampleRateHertz': 44100, 'pitch': 0.0}
}, ensure_ascii=False))" > /tmp/fpc_tts.json
  TOKEN=$(gcloud auth print-access-token)
  resp=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json; charset=utf-8" \
    -H "x-goog-user-project: $PROJECT" \
    -d @/tmp/fpc_tts.json \
    "https://texttospeech.googleapis.com/v1/text:synthesize")
  echo "$resp" | python3 -c "
import json, sys, base64
d = json.load(sys.stdin)
if 'audioContent' in d:
    open('$n.mp3','wb').write(base64.b64decode(d['audioContent']))
    print('✓')
else:
    print('✗ ' + str(d.get('error',{}).get('message','?'))[:120])
    sys.exit(1)"
}

ONLY="${1:-}"
for n in $(echo "${(k)NARR[@]}" | tr ' ' '\n' | sort); do
  if [ -n "$ONLY" ] && [[ "$n" != *"$ONLY"* ]]; then continue; fi
  gen "$n" "${NARR[$n]}"
done

echo ""
for f in *.mp3; do
  dur=$(ffprobe -i "$f" -show_entries format=duration -v quiet -of csv="p=0" 2>/dev/null)
  printf "  %s: %.1fs\n" "$f" "$dur"
done
