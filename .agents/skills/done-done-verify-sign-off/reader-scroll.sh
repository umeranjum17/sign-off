#!/usr/bin/env bash
# Real board, guided report, phone read over two minutes and one live update.
set -euo pipefail
out=$(cd "$1" && pwd)
repo=$(pwd)
# Keep all frames and fixture data in a private location, including on failure.
owner_home=$(getent passwd "$(id -u)" | cut -d: -f6)
private=${READER_SCROLL_EVIDENCE_ROOT:-${owner_home}/.no-mistakes/evidence/reader-scroll-jump}
mkdir -p "$private"
designs=$(mktemp -d "$private/designs.XXXXXX")
board=$(mktemp -d "$private/board.XXXXXX")
cleanup() {
  chrome-devtools-axi stop >/dev/null 2>&1 || true
  node "$repo/dist/cli.js" stop "$board/board.json" >/dev/null 2>&1 || true
}
trap cleanup EXIT
node_dir=$(dirname "$(command -v node)")
export PATH="$node_dir:$PATH" CHROME_DEVTOOLS_AXI_SESSION="reader-scroll-$$" CHROME_DEVTOOLS_AXI_BRIDGE_TIMEOUT_MS=120000
DESIGNS_WIDTH=1440 DESIGNS_THEME=dark node .agents/skills/done-done-verify-sign-off/designs-shots.mjs "$designs" dark 1440
cp "$designs/designs.after.dark.1440w.png" "$out/designs.after.dark.1440w.png"
export HOME="$board" XDG_CONFIG_HOME="$board/config" XDG_DATA_HOME="$board/data" XDG_STATE_HOME="$board/state" XDG_CACHE_HOME="$board/cache" SIGN_OFF_FILER=verify
url=$(.agents/skills/done-done-verify-sign-off/seed-board.sh "$board" | tail -1)
node - "$board/report.json" <<'JS'
const fs=require('fs'); const report=JSON.parse(fs.readFileSync('fixtures/contract/report.v3/valid-full.json'));
report.filed=new Date().toISOString().replace(/\.\d+Z$/, 'Z'); fs.writeFileSync(process.argv[2],JSON.stringify(report));
JS
node dist/cli.js post "$board/board.json" --kind report --from "$board/report.json" >/dev/null
chrome-devtools-axi open "${url}#reports/sign-in-faster" >/dev/null
chrome-devtools-axi emulate --viewport 390x844x1,mobile,touch --color-scheme light >/dev/null
chrome-devtools-axi run <<'JS'
await new Promise(r=>setTimeout(r,1200));
console.log(JSON.stringify(await page.eval(() => { let e=document.querySelector('.gd-scroll'); e.scrollTo({top:900,behavior:'instant'}); window.measurements=[]; window.startRead=Date.now(); new MutationObserver(()=>measurements.push({t:Date.now(),type:'redraw',y:document.querySelector('.gd-scroll')?.scrollTop})).observe(document.querySelector('#reader'),{childList:true}); setInterval(()=>measurements.push({t:Date.now(),type:'sample',y:document.querySelector('.gd-scroll')?.scrollTop}),50); return {start:Date.now(),y:e.scrollTop}; })));
JS
mkdir "$board/frames"
for i in $(seq 0 139); do
  if [ "$i" = 60 ]; then
    node - "$board/board.json" <<'JS'
const fs=require('fs'),p=process.argv[2],d=JSON.parse(fs.readFileSync(p)); const item=d.items.find(x=>x.key==='sign-in-faster'); item.about=item.about.replace('code step','Code step'); fs.writeFileSync(p,JSON.stringify(d));
JS
  fi
  chrome-devtools-axi screenshot "$board/frames/$(printf '%03d' "$i").png" >/dev/null
  sleep 0.8
done
chrome-devtools-axi eval '() => ({start:startRead,end:Date.now(),min:Math.min(...measurements.map(x=>x.y)),max:Math.max(...measurements.map(x=>x.y)),redraws:measurements.filter(x=>x.type==="redraw"),updated:document.querySelector("#reader").textContent.includes("Code step")})' > "$out/reader-measurements.txt"
node - "$out/reader-measurements.txt" <<'JS'
const fs=require('fs'),text=fs.readFileSync(process.argv[2],'utf8'),m=JSON.parse(JSON.parse(text.match(/^result: (.+)$/m)[1]));
if(m.end-m.start<120000 || !m.updated || m.redraws.length!==1 || m.redraws[0].y!==900 || m.min!==900 || m.max!==900) throw Error(JSON.stringify(m));
JS
duration=$(node - "$out/reader-measurements.txt" <<'JS'
const fs=require('fs'),s=fs.readFileSync(process.argv[2],'utf8'),m=JSON.parse(JSON.parse(s.match(/^result: (.+)$/m)[1])); console.log(m.end-m.start);
JS
)
node - "$out/reader-measurements.txt" <<'JS'
const fs=require('fs'),p=process.argv[2],s=fs.readFileSync(p,'utf8'),m=JSON.parse(JSON.parse(s.match(/^result: (.+)$/m)[1]));
fs.writeFileSync(p, `Phone viewport: 390 x 844 px\n\n| Measurement | Result |\n| --- | --- |\n| Reading duration | ${((m.end-m.start)/1000).toFixed(1)} seconds |\n| Minimum / maximum scroll position | ${m.min} / ${m.max} px |\n| Report update arrived | ${m.updated ? 'Yes' : 'No'} |\n| Position at update redraw | ${m.redraws[0].y} px |\n`);
JS
# Label evidence outside the product screenshot with the measured reading context.
font=$(fc-match -f '%{file}' sans)
seconds=$(node -e 'console.log((Number(process.argv[1])/1000).toFixed(1))' "$duration")
for theme in light dark; do
  chrome-devtools-axi emulate --viewport 390x844x1,mobile,touch --color-scheme "$theme" >/dev/null
  position=$(chrome-devtools-axi eval '() => document.querySelector(".gd-scroll").scrollTop')
  [[ "$position" == *'result: "900"'* ]] || { printf 'Unexpected report position: %s\n' "$position" >&2; exit 1; }
  chrome-devtools-axi screenshot "$board/reader.$theme.png" >/dev/null
  caption=$(printf 'UPDATE ARRIVED\nPOSITION HELD  |  900 px  |  %s s' "$seconds")
  magick "$board/reader.$theme.png" \
    -background '#123b55' -fill white -font "$font" -pointsize 22 -gravity center \
    label:"$caption" -append "$out/reader.$theme.390w.png"
done
magick "$out/designs.after.dark.1440w.png" -background '#111111' -fill white -font "$font" -pointsize 16 -gravity center \
  label:"Design capture | phone report scrollY: 900 px | elapsed: ${seconds} s" -append -resize '1280x1280>' "$board/design-labelled.png"
cp "$board/design-labelled.png" "$out/designs.after.dark.1440w.png"
ffmpeg -loglevel error -y -framerate "140000/$duration" -i "$board/frames/%03d.png" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$out/reader-two-minutes.mp4"
node - "$out/steps.json" <<'JS'
require('fs').writeFileSync(process.argv[2],JSON.stringify({target:{version:'0.10.2-dev'},start:'Isolated board with a long guided report',steps:['Open the report at phone width','Read at a fixed place for two minutes','Update the report during polling'],result:'The report stays at the reading position when its update arrives'},null,2));
JS
