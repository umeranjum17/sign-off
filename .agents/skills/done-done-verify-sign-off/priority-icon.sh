#!/usr/bin/env bash
# Card priority and project icons, CLI only (screen: none): posts cards with --priority on a new board, sets a project's icon,
# feeds the bad inputs (a priority outside P0-P3, an icon path out of the folder, a link that leads out, a file that is not its type, an SVG with a script),
# then serves the board and reads the state and the icon back over HTTP. Writes <out>/priority-icon.txt, one `$ command`, its output and exit code per step.
# Usage, from the repo root after `npm run build`: priority-icon.sh <out folder>
# It sets HOME and XDG_* to a new temporary folder, so your own board (~/.sign-off) is never read or written.
set -uo pipefail
out=$(cd "$1" && pwd) repo=$(pwd) tmp=$(mktemp -d)
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
step 0 stop "$board"
rm -rf -- "$tmp"
[ "$failed" = 0 ] && echo "priority-icon: PASS" >> "$log" || echo "priority-icon: FAIL" >> "$log"
exit "$failed"
