#!/usr/bin/env bash
# Evidence keeps every proof and Today's Proven today counts only the passed ones of the last day: seeds a board with two passed updates (one three days old),
# a repost of one card under its key, a pull request proof with no run and a plain one, captures Today and Evidence at 390 and 1280 in light and dark (a desk's Today sets the proof
# beside the asks; its Evidence is a list beside the newest update, selected), Evidence narrowed to one project with its project filter, and writes counts.txt (the numbers, as text)
# and steps.json. TODAY_EVIDENCE_RECORD=1 also records the desk's hover, press and selection at 1280 per theme (desk-evidence.<theme>.1280w.mp4).
# Usage, from the repo root after `npm run build`: today-evidence.sh <evidence folder>
set -euo pipefail
out=$(cd "$1" && pwd) repo=$(pwd) d=$(mktemp -d)
export CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-today-evidence-$$}
stop() { chrome-devtools-axi stop >/dev/null 2>&1 || true; HOME=$d XDG_CONFIG_HOME=$d/.config XDG_DATA_HOME=$d/.local/share XDG_STATE_HOME=$d/.local/state XDG_CACHE_HOME=$d/.cache node "$repo/dist/cli.js" stop "$d/board.json" >/dev/null 2>&1 || true; }
trap stop EXIT
"$repo/.agents/skills/done-done-verify-sign-off/seed-board.sh" "$d" > "$d/seed.out"
url=$(grep -o 'http://127.0.0.1:[0-9]*/' "$d/seed.out" | head -1)
so() { HOME=$d XDG_CONFIG_HOME=$d/.config XDG_DATA_HOME=$d/.local/share XDG_STATE_HOME=$d/.local/state XDG_CACHE_HOME=$d/.cache SIGN_OFF_FILER=verify node "$repo/dist/cli.js" "$@"; }
sed 's/The sign-in screen fits a phone/Settings page fits a phone/' "$d/evidence-run.json" > "$d/ev2.json"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));j.title=j.run.outcome="Passed check filed 3 days ago";require("fs").writeFileSync(process.argv[2],JSON.stringify(j))' "$d/evidence-run.json" "$d/ev3.json"
so post "$d/board.json" --kind evidence --from "$d/ev3.json" > /dev/null
so post "$d/board.json" --kind evidence --from "$d/ev2.json" > /dev/null
sleep 1; so post "$d/board.json" --type evidence --title "Plan to cap lanes, not run yet" --about "Not run." --media "$d/shot.webp" > /dev/null
# One card posted twice under a key with a changed title: the second post replaces the first (the base refuses it, exit 2), and no dismissal line is written.
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));j.key="repost-demo";j.title=j.run.outcome="Repost demo, first take";require("fs").writeFileSync(process.argv[2],JSON.stringify(j))' "$d/evidence-run.json" "$d/ev4.json"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));j.title=j.run.outcome="Repost demo, second take";require("fs").writeFileSync(process.argv[2],JSON.stringify(j))' "$d/ev4.json" "$d/ev5.json"
so post "$d/board.json" --kind evidence --from "$d/ev4.json" > /dev/null
set +e; so post "$d/board.json" --kind evidence --from "$d/ev5.json" > "$d/repost.out" 2>&1; repost=$?; set -e
so post "$d/board.json" --type evidence --title "Chat proof for the muxr pull request" --about "Umer reads the chat on a phone." --media "$d/shot.webp" --link https://github.com/umeranjum17/muxr/pull/809 > /dev/null
node -e 'const f=process.argv[1],fs=require("fs"),j=JSON.parse(fs.readFileSync(f)),i=j.items.find((x)=>x.title==="Passed check filed 3 days ago");if(!i)throw new Error("no old item");i.filed=new Date(Date.now()-3*864e5).toISOString();fs.writeFileSync(f,JSON.stringify(j))' "$d/board.json"
chrome-devtools-axi open "$url" >/dev/null
for theme in light dark; do
  for vp in 390x1700x1,mobile,touch 1280x1400x1; do
    chrome-devtools-axi emulate --viewport "$vp" --color-scheme "$theme" >/dev/null
    for s in today evidence; do
      chrome-devtools-axi open "$url$([ $s = evidence ] && echo '#evidence')" >/dev/null
      chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 800))" >/dev/null
      chrome-devtools-axi screenshot "$out/$s.$theme.${vp%%x*}w.png" >/dev/null
    done
  done
done
# One claim per capture: the search box narrows Evidence to one card, the 3-day-old proof and then the reposted card, each alone on a phone screen.
for theme in light dark; do
  chrome-devtools-axi emulate --viewport 390x844x1,mobile,touch --color-scheme "$theme" >/dev/null
  for shot in "old-proof:Passed check filed 3 days ago" "repost:Repost demo"; do
    chrome-devtools-axi open "$url#evidence" >/dev/null
    chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 600))" >/dev/null
    chrome-devtools-axi eval "() => { const b = document.getElementById('ev-find'); b.value = '${shot#*:}'; b.dispatchEvent(new Event('input')); }" >/dev/null
    chrome-devtools-axi screenshot "$out/${shot%%:*}.$theme.390w.png" >/dev/null
  done
done
# The project filter narrows Evidence to the muxr pull request proof; a board with one project has no filter.
for theme in light dark; do
  chrome-devtools-axi emulate --viewport 390x844x1,mobile,touch --color-scheme "$theme" >/dev/null
  chrome-devtools-axi open "$url#evidence" >/dev/null
  chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 600))" >/dev/null
  chrome-devtools-axi eval "() => { const b = document.getElementById('ev-find'); b.value = ''; b.dispatchEvent(new Event('input')); const p = document.getElementById('ev-project'); if (p) { p.value = 'muxr'; p.dispatchEvent(new Event('change')); } }" >/dev/null
  chrome-devtools-axi screenshot "$out/project-filter.$theme.390w.png" >/dev/null
done
if [ "${TODAY_EVIDENCE_RECORD:-}" = 1 ]; then
  for theme in light dark; do node "$repo/.agents/skills/done-done-verify-sign-off/desk-evidence-record.mjs" "$url" $theme "$out/desk-evidence.$theme.1280w.mp4"; done
fi
num() { chrome-devtools-axi eval "$1" | grep -o '[0-9][0-9]*' | head -1; }
# The search and the project pick stay while the page is open, so both are cleared before counting.
chrome-devtools-axi open "$url#evidence" >/dev/null; chrome-devtools-axi eval "() => { const p = document.getElementById('ev-project'); if (p) { p.value = ''; p.dispatchEvent(new Event('change')); } const b = document.getElementById('ev-find'); b.value = ''; b.dispatchEvent(new Event('input')); return new Promise((ok) => setTimeout(ok, 800)); }" >/dev/null
evcards=$(num '() => document.querySelectorAll(".ev-card").length'); repostcards=$(num '() => [...document.querySelectorAll(".ev-card .t")].filter((t) => t.textContent.startsWith("Repost demo")).length')
old=$(num '() => [...document.querySelectorAll(".ev-card .t")].filter((t) => t.textContent === "Passed check filed 3 days ago").length')
heads=$(num '() => document.getElementById("ev-find").closest(".search").nextElementSibling.querySelectorAll("h2, h3").length')
newest=$(chrome-devtools-axi eval '() => fetch("/api/decisions").then((r) => r.json()).then((s) => { const at = Object.fromEntries(s.decisions.map((d) => ["item-" + d.key, Date.parse(d.filed)])); return [...document.querySelectorAll(".ev-card")].every((a, i, all) => !i || at[all[i - 1].id] >= at[a.id]); })' | grep -o 'true\|false' | head -1)
projects=$(chrome-devtools-axi eval '() => [...document.querySelectorAll("#ev-project option")].map((o) => o.textContent).join(", ") || "none"' | sed -n 's/^result: "\(.*\)"$/\1/p' | sed 's/\\"//g')
chrome-devtools-axi eval "() => { const p = document.getElementById('ev-project'); if (p) { p.value = 'muxr'; p.dispatchEvent(new Event('change')); } }" >/dev/null
muxr=$([ "$projects" = none ] && echo "no project filter" || num '() => document.querySelectorAll(".ev-card").length')
chrome-devtools-axi eval "() => { const p = document.getElementById('ev-project'); if (p) { p.value = ''; p.dispatchEvent(new Event('change')); } }" >/dev/null
# On a desk: Evidence is one column with the newest selected beside it, and Today's proof sits right of the asks.
chrome-devtools-axi emulate --viewport 1280x800x1 --color-scheme light >/dev/null
chrome-devtools-axi open "$url#evidence" >/dev/null; chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 800))" >/dev/null
columns=$(num '() => new Set([...document.querySelectorAll(".ev-card")].map((a) => Math.round(a.getBoundingClientRect().left))).size')
selected=$(chrome-devtools-axi eval '() => [...document.querySelectorAll(".ev-card[aria-current]")].map((a) => a.id).join() === document.querySelector(".ev-card").id && document.getElementById("reader").dataset.key === document.querySelector(".ev-card").id.slice(5)' | grep -o 'true\|false' | head -1)
chrome-devtools-axi open "$url" >/dev/null; chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 800))" >/dev/null
beside=$(chrome-devtools-axi eval '() => document.querySelector(".areas > .i-evidence").getBoundingClientRect().left > document.querySelector(".areas > .i-waiting").getBoundingClientRect().right' | grep -o 'true\|false' | head -1)
tile=$(num '() => document.querySelector(".tile.i-evidence .n").textContent'); row=$(num '() => document.querySelectorAll(".ev-scroll-row .ev-card").length')
glance=$(chrome-devtools-axi eval '() => document.querySelector(".glance")?.textContent' | grep -o '[0-9]* updates\? filed' || echo none)
{
  echo "proof cards listed on Evidence: $evcards"
  echo "proof cards dated 3 days ago listed: $old"
  echo "cards for the reposted proof listed: $repostcards"
  echo "headings inside the Evidence list: $heads"
  echo "cards in newest-first order: $newest"
  echo "project filter choices: $projects"
  echo "cards listed with the muxr project picked: $muxr"
  echo "Proven today tile: $tile"
  echo "Evidence list columns at 1280: $columns"
  echo "newest proof selected and open beside the list at 1280: $selected"
  echo "Proven today right of Waiting on you at 1280: $beside"
  echo "dismissal log lines written: $(cat "$d/board.dismissed.jsonl" 2>/dev/null | wc -l)"
} > "$out/counts.txt"
cat > "$out/steps.json" <<JSON
{"target": {"version": "$(node -p 'require("./package.json").version')"}, "start": "A new board with two passed updates (one filed 3 days ago) and two updates with no run, each with a capture",
 "steps": ["Open Today at 390 and 1280 in light and dark", "Read the Proven today tile, the glance line and the Proven today row", "Open Evidence at 390 and 1280 in light and dark; at 1280 the list sits beside the newest update, selected", "Pick muxr in the project filter", "Compare Evidence, which keeps every proof, with the Proven today row, which keeps the passed ones of the last day"],
 "result": "Today counts only the passed updates of the last day; Evidence lists every proof in one list, newest first, with no project or day headings, and its project filter narrows it to one project, including the 3-day-old one, the pull request proof and the plain one; the reposted card is listed once and no dismissal is written; at 1280 Today sets Proven today right of Waiting on you, and Evidence is one column beside the newest update, selected"}
JSON
