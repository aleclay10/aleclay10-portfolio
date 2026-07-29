#!/bin/bash
# Regenerate public/resume.pdf from the /resume page.
#
# The page is the single source of truth: this script builds the site, serves
# dist/ with `astro preview`, and prints /resume to PDF through headless Chrome
# using the @media print block in src/styles/global.css. Run it whenever résumé
# content or the print styles change, then commit the resulting PDF.
#
#   npm run resume:pdf
#
# Deliberately NOT wired into `npm run build`. The deploy runs unattended on the
# mini via launchd, and a headless-Chrome dependency in that path would risk
# taking the live site down for a file that changes a few times a year.
set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=4331
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/public/resume.pdf"

[ -x "$CHROME" ] || { echo "FATAL: Google Chrome not found at $CHROME" >&2; exit 1; }

cd "$ROOT"

SERVER_PID=""
CHROME_PID=""
cleanup() {
  [ -n "$CHROME_PID" ] && kill "$CHROME_PID" 2>/dev/null || true
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  # astro preview spawns children; take the whole group down so nothing lingers.
  pkill -f "astro preview --port $PORT" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> building site"
npm run build >/dev/null

echo "==> serving dist/ on :$PORT"
npx astro preview --port "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!

# Wait for the port to actually answer rather than sleeping a guess.
# Note: `astro preview` binds IPv6 [::1] only, so probe `localhost`, not 127.0.0.1.
ready=""
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "http://localhost:$PORT/resume/"; then ready=1; break; fi
  sleep 0.25
done
[ -n "$ready" ] || { echo "FATAL: preview server never answered on :$PORT" >&2; exit 1; }

echo "==> printing /resume to PDF"
rm -f "$OUT"
TMP_PROFILE="$(mktemp -d)"

# Headless Chrome writes the PDF and then frequently fails to exit. Run it in the
# background, wait for the file to appear AND stop growing, then kill it. Polling
# the artifact is what makes this deterministic — never `wait` on Chrome.
"$CHROME" \
  --headless \
  --disable-gpu \
  --no-first-run \
  --no-pdf-header-footer \
  --user-data-dir="$TMP_PROFILE" \
  --print-to-pdf="$OUT" \
  "http://localhost:$PORT/resume/" >/dev/null 2>&1 &
CHROME_PID=$!

size=0
stable=0
for _ in $(seq 1 120); do
  sleep 0.5
  if [ -s "$OUT" ]; then
    new="$(wc -c <"$OUT" | tr -d ' ')"
    if [ "$new" = "$size" ]; then
      stable=$((stable + 1))
      [ "$stable" -ge 2 ] && break   # same size across ~1s — write is complete
    else
      stable=0
      size="$new"
    fi
  fi
done

kill "$CHROME_PID" 2>/dev/null || true
# Chrome flushes its profile cache asynchronously. Wait for the process to really
# exit before removing the temp profile, or rm races it and leaves the dir behind.
for _ in $(seq 1 20); do
  kill -0 "$CHROME_PID" 2>/dev/null || break
  sleep 0.25
done
CHROME_PID=""
rm -rf "$TMP_PROFILE" 2>/dev/null || true

[ -s "$OUT" ] || { echo "FATAL: no PDF produced at $OUT" >&2; exit 1; }

# Sanity-check it is a real PDF and report the page count. Read it from the page
# tree's /Count rather than `mdls` (Spotlight indexes asynchronously and returns
# null for a file this fresh) or raw greps for /Type /Page (compressed streams).
head -c 5 "$OUT" | grep -q '%PDF-' || { echo "FATAL: $OUT is not a PDF" >&2; exit 1; }
pages="$(python3 -c "
import re, sys
d = open(sys.argv[1], 'rb').read()
counts = [int(m) for m in re.findall(rb'/Count\s+(\d+)', d)]
print(max(counts) if counts else '?')
" "$OUT" 2>/dev/null || echo '?')"
echo "==> wrote $OUT ($(du -h "$OUT" | cut -f1 | tr -d ' '), $pages pages)"
[ "$pages" = "1" ] || [ "$pages" = "2" ] \
  || echo "WARN: expected a 1-2 page résumé, got $pages — check the @media print block" >&2
