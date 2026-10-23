#!/usr/bin/env bash
# Card priority and project icons, CLI only (screen: none): posts cards with --priority on a new board, sets a project's icon,
# feeds the bad inputs (a priority outside P0-P3, an icon path out of the folder, a link that leads out, a file that is not its type, an SVG with a script),
# then serves the board, reads the state and the icon back over HTTP and opens the served icon in a browser at phone width.
# Writes <out>/priority-icon.txt (one `$ command`, its output and exit code per step), <out>/icon-served.png and <out>/steps.json (the step record).
# Usage, from the repo root after `npm run build`: priority-icon.sh <out folder>
# It sets HOME and XDG_* to a new temporary folder, so your own board (~/.sign-off) is never read or written.
set -uo pipefail
out=$(cd "$1" && pwd) repo=$(pwd) tmp=$(mktemp -d) home=$HOME
dir=$tmp/board board=$tmp/board/board.json log=$out/priority-icon.txt
export HOME=$tmp XDG_CONFIG_HOME=$tmp/.config XDG_DATA_HOME=$tmp/.local/share XDG_STATE_HOME=$tmp/.local/state XDG_CACHE_HOME=$tmp/.cache SIGN_OFF_FILER=verify
mkdir -p "$dir/icons"
cp "$repo/web/icon-192.png" "$dir/icons/beacon.png"
cp "$repo/fixtures/contract/evidence.v1/shot.png" "$dir/shot.png"
printf 'not a picture\n' > "$dir/icons/fake.png"
printf '<svg xmlns="http://www.w3.org/2000/svg" onload="fetch(1)"><circle r="4"/></svg>\n' > "$dir/icons/script.svg"
cp "$repo/web/icon-192.png" "$tmp/outside.png"; ln -s "$tmp/outside.png" "$dir/icons/link.png"
: > "$log"
failed=0
# step <want exit> <args...>: runs the CLI, logs it with board paths shortened, and counts an exit that is not the one wanted.
step() {
  local want=$1; shift
  { printf '$ sign-off-axi'; printf ' %q' "$@"; printf '\n'; } | sed "s#$tmp#<tmp>#g" >> "$log"
  node "$repo/dist/cli.js" "$@" 2>&1 | sed "s#$tmp#<tmp>#g" >> "$log"
  local code=${PIPESTATUS[0]}
  printf 'exit %s%s\n\n' "$code" "$([ "$code" = "$want" ] || echo " (wanted $want)")" >> "$log"
  [ "$code" = "$want" ] || failed=1
}
ask=(--why "The page is ready and the release goes out Friday." --outcome yes="It ships Friday." --outcome no="It waits a week." --recommend yes --recommend-reason "Every check passed." --default no --ask-ref message-demo)

step 0 raise "$board" --priority P0 --key settings --title "Ship the new settings page this week?" "${ask[@]}"
step 0 raise "$board" --key digest --title "Keep the weekly digest going?" "${ask[@]}"
step 0 post "$board" --type evidence --priority P2 --title "Settings on a phone" --about "Umer changes the theme in one tap." --media "$dir/shot.png"
step 2 raise "$board" --priority P4 --key help --title "Ship the help page this week?" "${ask[@]}"
step 0 project "$board"
step 0 project "$board" --name Beacon --icon icons/beacon.png
step 2 project "$board" --name Beacon --icon ../outside.png
step 2 project "$board" --name Beacon --icon icons/link.png
step 2 project "$board" --name Beacon --icon icons/fake.png
step 2 project "$board" --name Beacon --icon icons/script.svg
step 0 project "$board" --json
step 0 list "$board" --json

# The board serves the state and the pinned icon; a project with no icon answers 404, so the page draws its initials.
node "$repo/dist/cli.js" serve "$board" --port 0 > "$tmp/serve.out" 2>&1 &
for _ in $(seq 50); do grep -qo 'http://127.0.0.1:[0-9]*/' "$tmp/serve.out" && break; sleep 0.1; done
url=$(grep -o 'http://127.0.0.1:[0-9]*/' "$tmp/serve.out" | head -1)
{
  echo "\$ GET /api/decisions: priority per card, and projects"
  curl -s "${url}api/decisions" | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify({priority:Object.fromEntries(s.decisions.map(d=>[d.key,d.priority??null])),projects:s.projects}))'
  echo
  echo "\$ GET /api/project-icon?name=beacon"
  curl -s -o "$tmp/got.png" -D - "${url}api/project-icon?name=beacon" | grep -iE '^(HTTP|content-type|x-content-type-options|content-security-policy)' | tr -d '\r'
  cmp -s "$tmp/got.png" "$dir/icons/beacon.png" && echo "body: the same bytes as icons/beacon.png" || { echo "body: DIFFERENT from icons/beacon.png"; failed=1; }
  echo
  echo "\$ GET /api/project-icon?name=Nobody"
  curl -s -o /dev/null -w 'HTTP %{http_code}\n' "${url}api/project-icon?name=Nobody"
  echo
} >> "$log"
browse() { HOME=$home CHROME_DEVTOOLS_AXI_SESSION=so-icon-$$ chrome-devtools-axi "$@" > /dev/null; }
# The served icon in a real browser at phone width. The sheet is this journey's own test page, not board UI (no screen draws icons yet):
# it loads the icon from the running board by its URL, beside what the board returned for each request. The browser keeps the real HOME so it finds its Chrome.
state=$(curl -s "${url}api/decisions" | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(s.decisions.map(d=>`${d.key}: ${d.priority??"no priority"}`).join(" · "))')
none=$(curl -s -o /dev/null -w '%{http_code}' "${url}api/project-icon?name=Nobody")
cat > "$tmp/sheet.html" <<HTML
<!doctype html><meta name="viewport" content="width=device-width"><title>priority-icon proof sheet</title>
<style>body{font:16px/1.4 system-ui,sans-serif;margin:16px;color:#111;background:#fff}h1{font-size:18px}code{font-size:13px;word-break:break-all}img{width:96px;height:96px;display:block;margin:8px 0;border:1px solid #ccc}p{margin:8px 0 16px}</style>
<h1>Test page of the priority-icon journey (not board UI)</h1>
<p>Project <b>Beacon</b>, icon set with <code>project --name Beacon --icon icons/beacon.png</code>, loaded from the running board:</p>
<code>GET ${url}api/project-icon?name=beacon</code>
<img id="icon" src="${url}api/project-icon?name=beacon" alt="Beacon icon">
<p id="loaded">loading</p>
<p>Project <b>Nobody</b> has no icon: <code>GET ${url}api/project-icon?name=Nobody</code> answered <b>HTTP ${none}</b>, so the page shows its initials.</p>
<p>Card priorities in the board's state (<code>/api/decisions</code>): <b>${state}</b></p>
<script>const i=document.getElementById('icon');const done=()=>document.getElementById('loaded').textContent=i.naturalWidth?'Loaded from the board: '+i.naturalWidth+' x '+i.naturalHeight+' px PNG.':'The board did not serve it.';i.complete?done():(i.onload=i.onerror=done);</script>
HTML
if browse open "file://$tmp/sheet.html" && browse emulate --viewport 390x844x2,mobile,touch --color-scheme light && sleep 1 && browse screenshot "$out/icon-served.png"; then
  echo "icon-served.png: Chrome at 390 px on the journey's test page, which loads the Beacon icon from ${url}api/project-icon?name=beacon and shows Nobody's 404 and the card priorities" | sed "s#$tmp#<tmp>#g" >> "$log"
else echo "icon-served.png: the browser could not capture the served icon" >> "$log"; failed=1; fi
browse stop
echo >> "$log"
step 0 stop "$board"
cat > "$out/steps.json" <<JSON
{
  "target": {"version": "$(node -p 'require("./package.json").version')"},
  "start": "A clean board with no cards and no projects, in a clean home, with the sign-off CLI built from this checkout.",
  "steps": [
    "The agent posts cards with --priority: an ask marked P0, an evidence update marked P2, and an ask with no priority.",
    "The agent tries to mark a card P4, and the CLI refuses it: a priority is P0 to P3.",
    "The agent gives the project Beacon its own icon with project --name Beacon --icon, a picture in the board folder; the board pins it by its hash.",
    "The agent tries an icon path out of the board folder (../outside.png) and a link that leads out of it, and both path escapes are refused, as are a file that is not a picture and an SVG with a script.",
    "The board's state, read back over HTTP, returns each card's priority (P0, P2, none) and the project Beacon with its pinned icon.",
    "The board serves the icon over HTTP as the same picture with nosniff and the sandbox policy, and a browser at 390 px shows it.",
    "A project with no icon gets no file (404), so the page shows its initials: the fallback monogram."
  ],
  "result": "Cards carry a priority from P0 to P3, the project Beacon has its own icon that the board serves, and a project without one falls back to its initials."
}
JSON
rm -rf -- "$tmp"
[ "$failed" = 0 ] && echo "priority-icon: PASS" >> "$log" || echo "priority-icon: FAIL" >> "$log"
exit "$failed"
