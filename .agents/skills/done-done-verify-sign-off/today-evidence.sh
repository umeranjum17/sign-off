#!/usr/bin/env bash
# Evidence keeps every proof and Today's Proven today counts only the passed ones of the last day: seeds a board with two passed updates (one three days old),
# a repost of one card under its key, a pull request proof with no run and a plain one, captures Today and Evidence at 390 in light and dark,
# and writes counts.txt (the numbers, as text) and steps.json. Usage, from the repo root after `npm run build`: today-evidence.sh <evidence folder>
set -euo pipefail
out=$(cd "$1" && pwd) repo=$(pwd) d=$(mktemp -d)
export CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-today-evidence-$$}
stop() { chrome-devtools-axi stop >/dev/null 2>&1 || true; HOME=$d XDG_CONFIG_HOME=$d/.config XDG_DATA_HOME=$d/.local/share XDG_STATE_HOME=$d/.local/state XDG_CACHE_HOME=$d/.cache node "$repo/dist/cli.js" stop "$d/board.json" >/dev/null 2>&1 || true; }
trap stop EXIT
"$repo/.agents/skills/done-done-verify-sign-off/seed-board.sh" "$d" > "$d/seed.out"
url=$(grep -o 'http://127.0.0.1:[0-9]*/' "$d/seed.out" | head -1)
so() { HOME=$d XDG_CONFIG_HOME=$d/.config XDG_DATA_HOME=$d/.local/share XDG_STATE_HOME=$d/.local/state XDG_CACHE_HOME=$d/.cache SIGN_OFF_FILER=verify node "$repo/dist/cli.js" "$@"; }
sed 's/The sign-in screen fits a phone/Settings page fits a phone/' "$d/evidence-run.json" > "$d/ev2.json"
sed 's/The sign-in screen fits a phone/Last week passed check/' "$d/evidence-run.json" > "$d/ev3.json"
so post "$d/board.json" --kind evidence --from "$d/ev3.json" > /dev/null
so post "$d/board.json" --kind evidence --from "$d/ev2.json" > /dev/null
sleep 1; so post "$d/board.json" --type evidence --title "Plan to cap lanes, not run yet" --about "Not run." --media "$d/shot.webp" > /dev/null
# One card posted twice under a key with a changed title: the second post replaces the first (the base refuses it, exit 2), and no dismissal line is written.
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));j.key="repost-demo";j.title="Repost demo, first take";require("fs").writeFileSync(process.argv[2],JSON.stringify(j))' "$d/evidence-run.json" "$d/ev4.json"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));j.title="Repost demo, second take";require("fs").writeFileSync(process.argv[2],JSON.stringify(j))' "$d/ev4.json" "$d/ev5.json"
so post "$d/board.json" --kind evidence --from "$d/ev4.json" > /dev/null
set +e; so post "$d/board.json" --kind evidence --from "$d/ev5.json" > "$d/repost.out" 2>&1; repost=$?; set -e
so post "$d/board.json" --type evidence --title "Chat proof for the muxr pull request" --about "Umer reads the chat on a phone." --media "$d/shot.webp" --link https://github.com/umeranjum17/muxr/pull/809 > /dev/null
node -e 'const f=process.argv[1],fs=require("fs"),j=JSON.parse(fs.readFileSync(f)),i=j.items.find((x)=>x.title==="Last week passed check");if(!i)throw new Error("no old item");i.filed=new Date(Date.now()-3*864e5).toISOString();fs.writeFileSync(f,JSON.stringify(j))' "$d/board.json"
chrome-devtools-axi open "$url" >/dev/null
for theme in light dark; do
  chrome-devtools-axi emulate --viewport 390x1700x1,mobile,touch --color-scheme "$theme" >/dev/null
  for s in today evidence; do
    chrome-devtools-axi open "$url$([ $s = evidence ] && echo '#evidence')" >/dev/null
    chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 800))" >/dev/null
    chrome-devtools-axi screenshot "$out/$s.$theme.390w.png" >/dev/null
  done
done
num() { chrome-devtools-axi eval "$1" | grep -o '[0-9][0-9]*' | head -1; }
chrome-devtools-axi open "$url#evidence" >/dev/null; chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 800))" >/dev/null
evcards=$(num '() => document.querySelectorAll(".ev-card").length'); repostcards=$(num '() => [...document.querySelectorAll(".ev-card .t")].filter((t) => t.textContent.startsWith("Repost demo")).length')
muxr=$(num '() => [...document.querySelectorAll(".ev-group")].filter((g) => g.querySelector("h2").textContent === "muxr").reduce((n, g) => n + g.querySelectorAll(".ev-card").length, 0)')
chrome-devtools-axi open "$url" >/dev/null; chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 800))" >/dev/null
tile=$(num '() => document.querySelector(".tile.i-evidence .n").textContent'); row=$(num '() => document.querySelectorAll(".ev-scroll-row .ev-card").length')
glance=$(chrome-devtools-axi eval '() => document.querySelector(".glance")?.textContent' | tr '\n' ' ')
{
  echo "version $(node -p 'require("./package.json").version')"
  echo "evidence_cards_listed=$evcards"
  echo "repost_cards_listed=$repostcards (posts: 2, second post exit $repost)"
  echo "muxr_group_cards=$muxr"
  echo "proven_today_tile=$tile"
  echo "proven_today_row=$row"
  echo "glance=$glance"
  echo "dismissed_log_lines=$(cat "$d/board.dismissed.jsonl" 2>/dev/null | wc -l)"
  echo "list_full:"; so list "$d/board.json" --full | grep -E '^ *(update|repost|signin)[^,]*,(shown|dismissed)' || true
} > "$out/counts.txt"
cat > "$out/steps.json" <<JSON
{"target": {"version": "$(node -p 'require("./package.json").version')"}, "start": "A new board with two passed updates (one filed 3 days ago) and two updates with no run, each with a capture",
 "steps": ["Open Today at 390 in light and dark", "Read the Proven today tile, the glance line and the Proven today row", "Open Evidence at 390 in light and dark", "Compare Evidence, which keeps every proof, with the Proven today row, which keeps the passed ones of the last day"],
 "result": "Today counts only the passed updates of the last day; Evidence lists every proof, newest first by project and day, including the 3-day-old one, the pull request proof and the plain one; the reposted card is listed once and no dismissal is written"}
JSON
