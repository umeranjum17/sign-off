#!/usr/bin/env bash
# Design reviews stay off Decide: on a copy of a board folder, Decide, Designs and Today at 390x844 (2x) and 1280x800, light,
# with what each counts (the Decide badge, Decide's rows and the count waiting on you, Today's two tiles, Up next, the Designs and Answered rows in Today's More) in counts.<width>w.json.
# Usage, from the repo root after npm run build: designs-off-decide.sh <board folder> <out folder> [board file name, default board.json]
# The folder is served as it is, so give it a copy (cp -a --reflink=auto) of a real board, never the board itself.
# HOME and XDG_* point at a new temp folder; the board is served and stopped inside this command. Run it on a base build into before/ and on this build into after/.
set -euo pipefail
src=$(cd "$1" && pwd) out=$2 board=$src/${3:-board.json}
export PATH=/usr/bin:$PATH CHROME_DEVTOOLS_AXI_SESSION=designs-off-decide-$$
mkdir -p "$out"
t=$(mktemp -d)
export HOME=$t XDG_CONFIG_HOME=$t/.config XDG_DATA_HOME=$t/.local/share XDG_STATE_HOME=$t/.local/state XDG_CACHE_HOME=$t/.cache
node dist/cli.js serve "$board" --port 0 > "$t/serve.log" 2>&1 &
server=$!
cleanup() { chrome-devtools-axi stop >/dev/null 2>&1 || true; kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true; rm -rf -- "$t"; }
trap cleanup EXIT
for _ in $(seq 100); do url=$(grep -o 'http://127.0.0.1:[0-9]*/' "$t/serve.log" | head -1) && [ -n "$url" ] && break; sleep 0.2; done
[ -n "${url:-}" ] || { cat "$t/serve.log"; exit 1; }
ax() { chrome-devtools-axi "$@" >/dev/null; }
pause() { ax eval "() => new Promise((ok) => setTimeout(ok, $1))"; }
go() { ax open "$url#$1"; ax eval "() => { location.reload(); return 1 }"; pause 2500; }
counts='() => { const txt = (s) => document.querySelector(s)?.textContent.trim() ?? ""; const badge = [...document.querySelectorAll("#nav a, #tabs a")].find((a) => a.getAttribute("href") === "#waiting")?.querySelector(".n, .bd")?.textContent ?? "0";
  return { hash: location.hash, decide_badge: Number(badge), rows: document.querySelectorAll(".dl-row").length, design_rows: document.querySelectorAll(".dl-row a[href^=\"#designs/\"], a.dl-face[href^=\"#designs/\"]").length,
    waiting: txt(".decide-list .ui-hero .big"), tiles: [...document.querySelectorAll(".t-tiles .ui-stat")].map((t) => t.getAttribute("aria-label")), up_next: txt(".t-up .q"),
    more: (document.querySelector(".t-more-line")?.click(), [...document.querySelectorAll("#t-more .ui-pr")].map((a) => a.textContent.replace(/\s+/g, " ").trim())), designs_listed: document.querySelectorAll(".designs li").length } }'
ax open "$url"
for w in 390 1280; do
  vp=390x844x2,mobile,touch; [ "$w" = 1280 ] && vp=1280x800x1
  ax emulate --viewport $vp --color-scheme light
  printf '[' > "$out/counts.${w}w.json"
  sep=''
  for page in waiting designs ''; do
    go "$page"
    name=${page:-today}; [ "$page" = waiting ] && name=decide
    ax screenshot "$out/$name.light.${w}w.png"
    printf '%s%s' "$sep" "$(chrome-devtools-axi eval "$counts" | sed -n 's/^result: //p' | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")))')" >> "$out/counts.${w}w.json"
    sep=','
  done
  printf ']\n' >> "$out/counts.${w}w.json"
done
ls "$out"
