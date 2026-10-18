#!/usr/bin/env bash
# Fills a new board with one real posted item of each kind, then serves it.
# Usage, from the repo root after `npm run build`: seed-board.sh <empty folder>
# It sets HOME and XDG_* to that folder, so your own board (~/.sign-off) is never read or written.
# Prints the board URL; stop the server it started with: kill "$(cat <folder>/serve.pid)"
set -euo pipefail
dir=$(cd "$1" && pwd) repo=$(pwd) board="$1/board.json"
export HOME=$dir XDG_CONFIG_HOME=$dir/.config XDG_DATA_HOME=$dir/.local/share XDG_STATE_HOME=$dir/.local/state XDG_CACHE_HOME=$dir/.cache SIGN_OFF_FILER=verify
so() { node "$repo/dist/cli.js" "$@"; }
f=$repo/fixtures/contract
mkdir -p "$dir/mocks" "$dir/page"
# Real phone screens from the README, so every card shows a picture a person can read.
cp "$repo/docs/media/phone-light.webp" "$dir/mocks/a.webp"; cp "$repo/docs/media/phone-dark.webp" "$dir/mocks/b.webp"; cp "$repo/docs/media/phone-light.webp" "$dir/shot.webp"
cp "$f/report.v2/page/"* "$dir/page/"
cp "$f/plan.v1/page/index.html" "$dir/page/plan.html"
sed 's#"page/index.html"#"page/plan.html"#' "$f/plan.v1/valid-full.json" > "$dir/plan.json"

so post "$board" --title "Keep the weekly digest?" --about "Open rate held steady at about a third for two months." --why "Open rate held steady for two months." --outcome yes="It keeps going out each week." --outcome no="It stops after this week." --recommend yes --recommend-reason "Readers still open it." --default yes
so post "$board" --key ship --title "When should the new settings page ship?" --about "No new bug reports for three weeks." --why "No new bug reports for three weeks." \
  --option friday=Friday --option next-week="Next week" --outcome friday="The page ships Friday." --outcome next-week="The page ships next week." --recommend friday --recommend-reason "Three quiet weeks support shipping." --default next-week
# A design pick takes mocks and a tradeoff; the question standard (--why, --outcome) is for --type decision only.
so post "$board" --type design --key look --title "Which settings layout should ship?" --option a="A: one column" --option b="B: two columns" \
  --mock a=mocks/a.webp --mock b=mocks/b.webp --tradeoff "B scans faster; A is simpler." --recommend b
so post "$board" --type signin --key npm --service "npm" --link https://example.com/login --unlocks "Publishing the release" --waits "Release agent" --expires 2h
so post "$board" --kind plan --from "$dir/plan.json"
so post "$board" --type evidence --title "Sign-in screen on a phone" --about "Umer checks the new layout." --media "$dir/shot.webp" --link https://example.com/pr/4
so post "$board" --kind report --from "$f/report.v2/valid-full.json" || \
  so post "$board" --type report --title "Sign-in now takes 2 steps" --about "Why the code step moved first." --view page/index.html --preview page/preview.svg
so post "$board" --key digest-old --title "Send the digest on Mondays?" --why "Choose the weekly digest schedule." --outcome yes="The digest goes out Mondays." --outcome no="The digest is paused." --recommend yes --recommend-reason "A weekly update stays useful." --default yes

node "$repo/dist/cli.js" serve "$board" --port 0 > "$dir/serve.log" 2>&1 &
echo $! > "$dir/serve.pid"
for _ in $(seq 50); do url=$(grep -o 'http://127.0.0.1:[0-9]*/' "$dir/serve.log" | head -1) && [ -n "$url" ] && break; sleep 0.2; done
if [ -z "${url:-}" ]; then
  printf 'Server failed to start:\n' >&2
  cat "$dir/serve.log" >&2
  exit 1
fi
# One answered item, answered through the page's own API as a tap would.
curl -sf "${url}api/answers" -H 'content-type: application/json' -d '{"key":"digest-old","answer":"yes","note":""}' >/dev/null
echo "$url"
