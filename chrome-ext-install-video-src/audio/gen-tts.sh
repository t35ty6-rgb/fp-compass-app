#!/bin/zsh
# FP Compass Chrome拡張 install ガイド TTS (Neural2-C 1.15x, 荒島 と同 pipeline)
set -e
VOICE="ja-JP-Neural2-C"
RATE="1.15"
PROJECT="skeleton-pricer-130118"
OUT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$OUT_DIR"

# 誤読対策:
#  「chrome://extensions/」→ 「くろーむ、コロン、スラッシュスラッシュ、いくすてんしょんず、スラッシュ」
#  「デベロッパーモード」→ ひらがな
#  「パッケージ化されていない」→ ひらがな
#  「ピン留め」→ 「ぴんどめ」
#  「拡張機能」→ 「かくちょうきのう」明示
#  「Dock」→ 「ドック」
#  「YouTube」→ 「ユーチューブ」

declare -A NARR=(
  ["01-open-chrome"]="まず、 グーグル クローム を ひらきます。 がめん した の ドック に ある、 くろーむ の アイコン を クリック して ください。"

  ["02-extensions-url"]="つぎ に、 うえ の アドレス バー に、 くろーむ、 コロン、 スラッシュ スラッシュ、 いくすてんしょんず、 スラッシュ、 と 入力 して、 エンター キー を おします。 これ が、 かくちょうきのう の 管理 がめん です。"

  ["03-developer-mode"]="がめん の みぎうえ に、 でべろっぱー もーど の スイッチ が あります。 これ を クリック して、 オン に して ください。 スイッチ が あお く なれ ば、 オン じょうたい です。"

  ["04-load-folder"]="つぎ に、 ひだり うえ に あらわれた、 ぱっけーじか されて いない かくちょうきのう を、 よみこむ、 と いう ボタン を クリック します。 フォルダ せんたく の まど が ひらく ので、 デスクトップ に ある、 F P コンパス かくちょうきのう、 と いう フォルダ を えらんで、 せんたく を おします。"

  ["05-pin"]="かくちょうきのう が、 いちらん に ついか されました。 つぎ に、 くろーむ の みぎ うえ に ある、 パズル ピース の アイコン を クリック します。 F P コンパス ぎじろく レコーダー の よこ の、 ぴん の アイコン を クリック する と、 ツール バー に じょうじ、 ひょうじ されます。"

  ["06-test"]="さいご に、 どうさ かくにん です。 ユーチューブ を ひらいて、 どうが を さいせい して ください。 かくちょうきのう の アイコン を クリック して、 ろくおん かいし、 を おし、 ユーチューブ の タブ を えらび、 じゅう びょう ほど まって、 ていし、 を おします。 これ で、 F P コンパス Chrome かくちょうきのう の セットアップ は かんりょう です。"
)

gen() {
  local n="$1" text="$2"
  printf "  [%s] %4d文字 → " "$n" "${#text}"
  python3 -c "
import json
print(json.dumps({
    'input': {'text': '''$text'''},
    'voice': {'languageCode': 'ja-JP', 'name': '$VOICE'},
    'audioConfig': {'audioEncoding': 'MP3', 'speakingRate': $RATE, 'sampleRateHertz': 44100}
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
