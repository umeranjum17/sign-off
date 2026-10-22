#!/usr/bin/env bash
# A capture's tap and the comparison table, at 390 and 1280, on a throwaway demo board.
# Usage, from the repo root after `npm run build`: phone-link-shots.sh <output folder>   (PHONE_PART=link|table drives one part alone, PHONE_WIDTH=390|1280 one width)
# The board, its CLI and its HOME and XDG_* live in a temp folder; the browser tool keeps its own profile, so it runs with the real HOME.
set -euo pipefail
repo=$(pwd) out=$(cd "$1" && pwd) part=${PHONE_PART:-all}
real=$HOME d=$(mktemp -d)
export HOME=$d XDG_CONFIG_HOME=$d/c XDG_DATA_HOME=$d/d XDG_STATE_HOME=$d/s XDG_CACHE_HOME=$d/k SIGN_OFF_FILER=verify
export CHROME_DEVTOOLS_AXI_SESSION=phone-link-$$
node=$(command -v node); so() { "$node" "$repo/dist/cli.js" "$@"; }
br() { env -u XDG_CONFIG_HOME -u XDG_DATA_HOME -u XDG_STATE_HOME -u XDG_CACHE_HOME HOME=$real chrome-devtools-axi "$@"; }
ev() { # the page answers a moment late after a navigation or a new tab, so an empty answer is asked again
  local r; for _ in 1 2 3 4 5; do r=$(br eval "$1" | sed -n 's/^result: //p'); [ -n "$r" ] && break; sleep 1; done
  printf '%s' "$r" | "$node" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{let v=JSON.parse(s);while(typeof v==="string")v=JSON.parse(v);console.log(JSON.stringify(v))})'; }
want() { [ "$part" = all ] || [ "$part" = "$1" ]; }
cd "$d"; printf 'board: board.json\nname: Umer\n' > config.yaml
"$node" -e '
const fs=require("fs"),r=JSON.parse(fs.readFileSync(process.argv[1]));
const o=(t,tone,text,m,s,b,k)=>({title:t,tone,text,more:`Models: ${m}.\nScripted: ${s}.\nBreaks: ${b}.\nMakers: ${k}.\nSafety: no leak reported.`});
r.sections.push({id:"compare",stage:"found",heading:"The 4 short-listed options on the same 5 points",body:"Each option on the same 5 points: **models**, **scripted mode**, **known breaks**, **how the makers answer** and **safety**.",items:[
 o("Option A: the pick","ok","Pros: any model, small. Cons: one open hang.","any, through providers","yes, with JSON output","hangs when its input pipe stays open","auto-close new issues, then reopen real ones"),
 o("Option B: the backup","warn","Pros: mature. Cons: adds a daemon.","one vendor first, others with open gaps","yes, with JSON output","can hang on a stalled stream","a maker replied the same day"),
 o("Option C: not now","bad","Pros: many features. Cons: key leak.","any","yes","version 1 now gets only critical fixes","a bot answers first"),
 o("Option D: not now","warn","Pros: open, active. Cons: scripted mode misses hooks.","any","yes","hooks do not run in scripted mode","a maintainer explained the cause")]});
r.filed=new Date().toISOString().replace(/\.\d+Z$/,"Z");fs.writeFileSync("report.json",JSON.stringify(r));' "$repo/fixtures/contract/report.v4/valid-full.json"
so post board.json --kind report --from report.json >/dev/null
key=$("$node" -p 'require("./report.json").key')
"$node" "$repo/dist/cli.js" serve board.json --port 0 > serve.log 2>&1 &
trap 'so stop board.json >/dev/null 2>&1 || true; br stop >/dev/null 2>&1 || true; cd /; rm -rf -- "$d"' EXIT
for _ in $(seq 50); do base=$(grep -o 'http://127.0.0.1:[0-9]*/' serve.log | head -1) && [ -n "$base" ] && break; sleep 0.2; done
# A 1280 wide desktop screenshot of the report, posted as an update's capture.
br open "$base#reports/$key" >/dev/null; br emulate --viewport 1280x860x1 --color-scheme light >/dev/null; sleep 1.5
ev "() => { document.getElementById('gd-compare').scrollIntoView({block:'start'}); return 1 }" >/dev/null; sleep 1
br screenshot "$d/desktop-report.png" >/dev/null
so post board.json --type evidence --title "The option report as read on a desk" --about "Umer reads the 4 options on the same 5 points." --media "$d/desktop-report.png" >/dev/null
: > "$out/measures.txt"
for w in ${PHONE_WIDTH:-390 1280}; do
  if [ $w = 390 ]; then vp=390x844x2,mobile,touch; else vp=1280x860x1; fi
  br emulate --viewport $vp --color-scheme light >/dev/null
  if want table; then
    br open "$base#reports/$key" >/dev/null; sleep 1.5
    ev "() => { const s = document.querySelector('.gd-scroll'); if (s) s.style.scrollBehavior = 'auto'; document.getElementById('gd-compare').scrollIntoView({block:'start'}); return 1 }" >/dev/null; sleep 1
    t=$(ev "() => { const t = document.querySelector('#gd-compare .gd-ct'), cs = getComputedStyle(t.querySelector('td')); return JSON.stringify({width: innerWidth, layout: getComputedStyle(t).display, cellFontPx: parseFloat(cs.fontSize), columnsAcross: t.tHead.getBoundingClientRect().height > 1 ? t.tHead.rows[0].cells.length : 0, optionsListedPerPoint: t.tBodies[0].rows[1].cells.length - 1, pageOverflowsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth}) }")
    echo "table.$w: $t" >> "$out/measures.txt"
    br screenshot "$out/table.$w.png" >/dev/null
    "$node" -e 'const t=JSON.parse(process.argv[1]),w=+process.argv[2];if(t.pageOverflowsSideways||t.optionsListedPerPoint!==4||(w===390?t.cellFontPx!==16||t.layout!=="block":t.layout!=="table"||t.columnsAcross!==5))process.exit(1)' "$t" $w
  fi
  if want link; then
    br open "$base#evidence/update-1" >/dev/null; sleep 1.5
    l=$(ev "() => { const a = document.querySelector('.ev-hero a'); return JSON.stringify({width: innerWidth, href: a.getAttribute('href').split('?')[0], opensInNewTab: a.target === '_blank'}) }")
    echo "link.$w: $l" >> "$out/measures.txt"
    # Tap it as a person does, then capture where it led: the board's own screen on a phone, the raw file's tab on a desk.
    ev "() => { document.querySelector('.ev-hero a').click(); return 1 }" >/dev/null; sleep 1.5
    if [ $w = 1280 ]; then
      id=$(br pages | sed -n 's/^  \([0-9]*\),[^,]*api\/media[^,]*,.*$/\1/p' | tail -1)
      [ -n "$id" ] && br selectpage "$id" >/dev/null && sleep 1
      echo "link.$w opened: $(br pages | sed -n 's/^  [0-9]*,\([^?,]*\).*/\1/p' | tr '\n' ' ')" | sed 's#http://127.0.0.1:[0-9]*##g' >> "$out/measures.txt"
    else
      echo "link.$w after tap: $(ev '() => JSON.stringify({staysOnBoard: location.pathname === "/", screen: location.hash.split("/")[0], backLink: [...document.querySelectorAll("a")].find((a) => /Evidence$/.test(a.textContent.trim()))?.textContent.trim() ?? ""})')" >> "$out/measures.txt"
    fi
    br screenshot "$out/link.$w.png" >/dev/null
    "$node" -e 'const l=JSON.parse(process.argv[1]),w=+process.argv[2];if(w===390?(l.href!=="#evidence/update-1"||l.opensInNewTab):(l.href!=="/api/media"||!l.opensInNewTab))process.exit(1)' "$l" $w
  fi
done
case "$part ${PHONE_WIDTH:-both}" in
  "link 390") steps='"The board is opened at 390 px wide, a phone.", "The update whose capture is a desktop image of a report is opened and its capture is tapped."'
    result="On a phone, tapping the capture keeps the person on the board's own Evidence screen, with its back link, instead of opening the raw desktop image." ;;
  "link 1280") steps='"The board is opened at 1280 px wide, a desk.", "The update whose capture is a desktop image of a report is opened and its capture is tapped."'
    result="On a desk, tapping the capture opens the raw image file on its own, a plain picture with no board controls around it, in a new tab." ;;
  "table 390") steps='"The board is opened at 390 px wide, a phone.", "The report is opened at its comparison table of 4 options on 5 points."'
    result="On a phone, the comparison table reads at 16 px, each point listing every option, with nothing off the screen." ;;
  "table 1280") steps='"The board is opened at 1280 px wide, a desk.", "The report is opened at its comparison table of 4 options on 5 points."'
    result="On a desk, the comparison table is one table of 5 columns, each option across, at 13 px." ;;
  *) steps='"The board is opened at 390 and 1280 px wide.", "The update capture is tapped and the comparison table read."'
    result="On a phone the capture stays on the board and the table reads at 16 px; on a desk the capture opens the raw image in a new tab and the table is 5 columns." ;;
esac
cat > "$out/steps.json" <<J
{"target": {"version": "$("$node" -p 'require(process.argv[1]).version' "$repo/package.json")"},
 "start": "A throwaway board with one report that compares 4 options on the same 5 points, and one update whose capture is a 1280 wide desktop image of that report.",
 "steps": [$steps],
 "result": "$result"}
J
