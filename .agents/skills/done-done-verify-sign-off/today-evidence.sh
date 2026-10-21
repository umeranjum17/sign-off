#!/usr/bin/env bash
# Today's Proven today and Evidence name the same passed proofs: seeds a board with two passed updates (one three days old), two with no run,
# captures Today and Evidence at 390 in light and dark, and writes steps.json. Usage, from the repo root after `npm run build`: today-evidence.sh <evidence folder>
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
cat > "$out/steps.json" <<JSON
{"target": {"version": "$(node -p 'require("./package.json").version')"}, "start": "A new board with two passed updates (one filed 3 days ago) and two updates with no run, each with a capture",
 "steps": ["Open Today at 390 in light and dark", "Read the Proven today tile, the glance line and the Proven today row", "Open Evidence at 390 in light and dark", "Compare the passed cards on Evidence with the Proven today row"],
 "result": "Today counts 2 proven updates and Evidence lists the same 2 passed cards, newest first; the updates with no run and the 3-day-old one are on neither"}
JSON
