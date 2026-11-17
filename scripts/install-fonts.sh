#!/bin/bash
# ============================================================
# install-fonts.sh — коллекция шрифтов (кириллица + латиница) для монтажа
#
#   Список:   fonts/fonts.list           (в git; дописать строку → перезапустить)
#   Скачано:  fonts/google/<папка>/      (TTF + лицензия; не в git)
#   Свои:     fonts/custom/              (кладите любые .ttf/.otf; не в git)
#   Каталог:  fonts/fonts.css            (@font-face для HTML: file:///opt/fonts/fonts.css)
#             fonts/fonts.json           (семейство, категория, начертания — для агентов/воркфлоу)
#
#   В контейнерах: /opt/fonts (n8n, n8n-worker, n8n-media-render, n8n-tools)
#   + fontconfig (media-render: /opt/fonts, tools: /usr/share/fonts/n8n) → Chromium, ffmpeg/libass видят по имени.
#
# Источник — github.com/google/fonts (sparse-клон: качаются только нужные папки).
# Запуск: bash scripts/install-fonts.sh   (идемпотентно; повторный запуск обновит шрифты)
# ============================================================
set -euo pipefail

BASE_DIR="${BASE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
FONTS="$BASE_DIR/fonts"
LIST="$FONTS/fonts.list"
OUT="$FONTS/google"
SRC="$FONTS/.src"
CSS="$FONTS/fonts.css"
JSON="$FONTS/fonts.json"
REPO="${FONTS_REPO:-https://github.com/google/fonts.git}"

log() { echo "[fonts] $*"; }

[ -f "$LIST" ] || { log "нет $LIST"; exit 1; }
command -v git >/dev/null || { log "нужен git"; exit 1; }
mkdir -p "$OUT" "$FONTS/custom"

mapfile -t ENTRIES < <(sed 's/#.*//' "$LIST" | awk 'NF{print $1" "($2?$2:"other")}')
PATHS=(); for e in "${ENTRIES[@]}"; do PATHS+=("${e%% *}"); done
log "в списке ${#PATHS[@]} семейств"

# 1. sparse-клон google/fonts (только папки из списка, без истории)
rm -rf "$SRC"
git clone -q --depth 1 --filter=blob:none --sparse "$REPO" "$SRC"
git -C "$SRC" sparse-checkout set "${PATHS[@]}"

# разбор METADATA.pb: строки "F|файл|style|weight", "A|tag|min|max", "N|имя"
parse_meta() {
  awk '
    /^name:/            { gsub(/^name: "|"$/,""); print "N|"$0 }
    /^subsets: "cyrillic"/ { print "C|1" }
    /^fonts \{/         { inf=1; f=""; s="normal"; w=400; next }
    inf && /style:/     { gsub(/.*style: "|".*/,""); s=$0 }
    inf && /weight:/    { gsub(/.*weight: /,""); w=$0 }
    inf && /filename:/  { gsub(/.*filename: "|".*/,""); f=$0 }
    inf && /^\}/        { print "F|"f"|"s"|"w; inf=0 }
    /^axes \{/          { ina=1; t=""; mn=""; mx=""; next }
    ina && /tag:/       { gsub(/.*tag: "|".*/,""); t=$0 }
    ina && /min_value:/ { gsub(/.*min_value: /,""); mn=int($0) }
    ina && /max_value:/ { gsub(/.*max_value: /,""); mx=int($0) }
    ina && /^\}/        { print "A|"t"|"mn"|"mx; ina=0 }
  ' "$1"
}
urlenc() { local s="$1"; s="${s//%/%25}"; s="${s//[/%5B}"; s="${s//]/%5D}"; s="${s//,/%2C}"; s="${s// /%20}"; printf '%s' "$s"; }

# 2. копирование + каталоги
rm -rf "$OUT"; mkdir -p "$OUT"
{
  echo "/* Сгенерировано scripts/install-fonts.sh — не править руками. Подключение: <link rel=\"stylesheet\" href=\"file:///opt/fonts/fonts.css\"> */"
} > "$CSS"
json_items=(); ok=0; miss=(); nocyr=()
for e in "${ENTRIES[@]}"; do
  p="${e%% *}"; cat="${e##* }"; dir="$SRC/$p"; name="$(basename "$p")"
  meta="$dir/METADATA.pb"
  if [ ! -f "$meta" ]; then miss+=("$p"); continue; fi
  mkdir -p "$OUT/$name"
  cp -f "$dir"/*.txt "$OUT/$name/" 2>/dev/null || true   # OFL.txt / LICENSE.txt
  cyr=false; family=""; wmin=""; wmax=""; files=(); weights=(); italic=false
  while IFS='|' read -r k a b c; do
    case "$k" in
      N) family="$a" ;;
      C) cyr=true ;;
      A) [ "$a" = "wght" ] && { wmin="$b"; wmax="$c"; } ;;
      F) [ -f "$dir/$a" ] || continue
         cp -f "$dir/$a" "$OUT/$name/"
         files+=("\"$a\""); [ "$b" = "italic" ] && italic=true
         weights+=("$c")
         echo "$a|$b|$c" >> "$OUT/$name/.faces" ;;
    esac
  done < <(parse_meta "$meta")
  [ ${#files[@]} -gt 0 ] || { miss+=("$p"); rm -rf "$OUT/$name"; continue; }
  variable=false; [ -n "$wmin" ] && variable=true
  # @font-face
  while IFS='|' read -r f st wt; do
    range="$wt"; $variable && range="$wmin $wmax"
    printf "@font-face{font-family:'%s';src:url('file:///opt/fonts/google/%s/%s') format('truetype');font-weight:%s;font-style:%s;font-display:block}\n" \
      "$family" "$name" "$(urlenc "$f")" "$range" "$st" >> "$CSS"
  done < "$OUT/$name/.faces"
  rm -f "$OUT/$name/.faces"
  if $variable; then wjson="\"$wmin-$wmax\""; else wjson="\"$(printf '%s\n' "${weights[@]}" | sort -nu | paste -sd, -)\""; fi
  json_items+=("{\"family\":\"$family\",\"dir\":\"google/$name\",\"category\":\"$cat\",\"cyrillic\":$cyr,\"variable\":$variable,\"weights\":$wjson,\"italic\":$italic,\"files\":[$(IFS=,; echo "${files[*]}")]}")
  $cyr || nocyr+=("$family")
  ok=$((ok+1))
done
{ echo "{\"generated\":\"$(date -u +%FT%TZ)\",\"root\":\"/opt/fonts\",\"css\":\"file:///opt/fonts/fonts.css\",\"custom\":\"/opt/fonts/custom\",\"families\":["
  (IFS=$'\n'; echo "${json_items[*]}") | paste -sd, -
  echo "]}"; } > "$JSON"
rm -rf "$SRC"

log "готово: $ok семейств, $(find "$OUT" -name '*.ttf' | wc -l) файлов, $(du -sh "$OUT" | cut -f1)"
[ ${#nocyr[@]} -eq 0 ] || log "⚠ без кириллицы: ${nocyr[*]}"
[ ${#miss[@]} -eq 0 ] || log "⚠ не найдены в google/fonts: ${miss[*]}"

# 3. кэш fontconfig в контейнерах (если уже запущены)
if command -v docker >/dev/null; then
  for c in n8n-media-render n8n-tools; do
    docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$c" && docker exec "$c" fc-cache -f >/dev/null 2>&1 && log "fc-cache: $c" || true
  done
fi
