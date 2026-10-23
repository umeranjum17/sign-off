#!/usr/bin/env bash
# Evidence keeps every proof and Today's Latest proof shows its newest: seeds a board with two passed updates (one three days old),
# a repost of one card under its key, a pull request proof with no run and a plain one, captures Today and Evidence at 390 and 1280 in light and dark (a desk's Today sets Latest proof
# beside Up next; its Evidence is a list beside the newest update, selected), the passed update's own screen (evidence-item) and Today's closed Ask the agent (today-ask) at both widths,
# Evidence narrowed to one project with its project filter, and writes counts.txt (the numbers, as text)
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
# The newest card, which the ev-tile crop shows, carries a sign-in screen, so its picture is not itself a board's Evidence tile.
cp "$repo/docs/media/phone-signin.webp" "$d/signin.webp"
so post "$d/board.json" --type evidence --title "Chat proof for the muxr pull request" --about "Umer reads the chat on a phone." --media "$d/signin.webp" --link https://github.com/umeranjum17/muxr/pull/809 > /dev/null
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
# One claim per capture: the passed update's own screen (its capture across the preview on a desk, its verdicts on one row) and Today's closed Ask the agent, one line.
for theme in light dark; do
  for vp in 390x1700x1,mobile,touch 1280x1400x1; do
    chrome-devtools-axi emulate --viewport "$vp" --color-scheme "$theme" >/dev/null
    chrome-devtools-axi open "$url#evidence/update-2" >/dev/null
    chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 800))" >/dev/null
    chrome-devtools-axi screenshot "$out/evidence-item.$theme.${vp%%x*}w.png" >/dev/null
  done
  for vp in 390x844x1,mobile,touch 1280x800x1; do
    chrome-devtools-axi emulate --viewport "$vp" --color-scheme "$theme" >/dev/null
    chrome-devtools-axi open "$url" >/dev/null
    chrome-devtools-axi eval "() => new Promise((ok) => { document.querySelector('details.ask').scrollIntoView({ block: 'center' }); setTimeout(ok, 600); })" >/dev/null
    chrome-devtools-axi screenshot "$out/today-ask.$theme.${vp%%x*}w.png" >/dev/null
  done
done
# One claim per crop, each settled and cut to exactly what it shows: the update's capture filling its preview (preview-fill), the one-row verdicts (verdicts),
# the closed Ask the agent line under the Leash (ask-line), one Evidence card's filled tile (ev-tile) and the two same-headline cards with their telling lines (twins).
# crop <file> <page> <js list of elements> [each]: open the page, scroll the elements' box to the middle of the screen, let it settle, shoot the viewport and cut out the box;
# with each, every item (an element, or a list of elements cut as one box) is cut out on its own and the pieces are stacked, so what lies between them stays out of the shot.
crop() {
  file=$1
  chrome-devtools-axi open "$url$2" >/dev/null
  chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 800))" >/dev/null
  box=$(chrome-devtools-axi eval "() => { const els = ($3).flat().filter(Boolean), s = (function up(e) { return !e || e === document.body ? document.scrollingElement : /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight ? e : up(e.parentElement); })(els[0].parentElement), top = () => Math.min(...els.map((e) => e.getBoundingClientRect().top)), bottom = () => Math.max(...els.map((e) => e.getBoundingClientRect().bottom));
    s.scrollBy(0, (top() + bottom() - innerHeight) / 2);
    return new Promise((ok) => setTimeout(() => { const rs = els.map((e) => e.getBoundingClientRect()), px = 16, py = 6, x = Math.max(0, Math.min(...rs.map((r) => r.left)) - px), y = Math.max(0, top() - py);
      ok([Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + px) - x, Math.min(innerHeight, bottom() + py) - y, x, y].map(Math.round).join(' ')); }, 700)); }" | sed -n 's/^result: "\(.*\)"$/\1/p' | tr -d '\\"')
  chrome-devtools-axi screenshot "$d/whole.png" >/dev/null
  if [ "${4:-}" = each ]; then
    pieces=$(chrome-devtools-axi eval "() => ($3).map((g) => { const rs = [g].flat().map((e) => e.getBoundingClientRect()), x = Math.min(...rs.map((r) => r.left)) - 16, y = Math.min(...rs.map((r) => r.top)) - 6;
      return [Math.max(...rs.map((r) => r.right)) + 16 - x, Math.max(...rs.map((r) => r.bottom)) + 6 - y, x, y].map(Math.round).join(' '); }).join(',')" | sed -n 's/^result: "\(.*\)"$/\1/p' | tr -d '\\"')
    IFS=, read -ra boxes <<< "$pieces"; args=()
    for b in "${boxes[@]}"; do set -- $b; args+=("(" "$d/whole.png" -crop "$1x$2+$3+$4" +repage ")"); done
    magick "${args[@]}" -append "$out/$file"
  else
    set -- $box
    magick "$d/whole.png" -crop "$1x$2+$3+$4" +repage "$out/$file"
  fi
}
for theme in light dark; do
  for vp in 390x844x1,mobile,touch 1280x800x1; do
    w=${vp%%x*}
    chrome-devtools-axi emulate --viewport "$vp" --color-scheme "$theme" >/dev/null
    # The capture with the Proof rows under it, which span the same column, on a desk tall enough to hold both.
    if [ "$w" = 1280 ]; then
      chrome-devtools-axi emulate --viewport 1280x1400x1 --color-scheme "$theme" >/dev/null
      crop "preview-fill.$theme.${w}w.png" '#evidence/update-2' "[document.querySelector('.ev-hero'), document.querySelector('.ev-grp')]"
      chrome-devtools-axi emulate --viewport "$vp" --color-scheme "$theme" >/dev/null
    fi
    crop "verdicts.$theme.${w}w.png" '#evidence/update-2' "[document.querySelector('.ev-ask'), document.querySelector('.ev-verdict .choices')]"
    crop "ask-line.$theme.${w}w.png" '' "[document.querySelector('.leash'), document.querySelector('details.ask')]"
    [ "$w" = 390 ] && crop "ev-tile.$theme.${w}w.png" '#evidence' "[document.querySelector('.ev-grid .ev-card')]"
    # On a phone each twin's capture is a tall tile, so only the two titles and results are stacked.
    if [ "$w" = 390 ]; then crop "twins.$theme.${w}w.png" '#evidence' "[...document.querySelectorAll('.ev-grid .ev-card .also')].map((a) => [a.closest('.t'), a.closest('.ev-card').querySelector('.m')])" each
    else crop "twins.$theme.${w}w.png" '#evidence' "[...document.querySelectorAll('.ev-grid .ev-card')].filter((a) => a.querySelector('.also'))"; fi
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
# On a desk: Evidence is one column with the newest selected beside it, and Today's Latest proof sits right of Up next.
chrome-devtools-axi emulate --viewport 1280x800x1 --color-scheme light >/dev/null
chrome-devtools-axi open "$url#evidence" >/dev/null; chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 800))" >/dev/null
columns=$(num '() => new Set([...document.querySelectorAll(".ev-card")].map((a) => Math.round(a.getBoundingClientRect().left))).size')
selected=$(chrome-devtools-axi eval '() => [...document.querySelectorAll(".ev-card[aria-current]")].map((a) => a.id).join() === document.querySelector(".ev-card").id && document.querySelector(".split-detail .ev-title")?.textContent === document.querySelector(".ev-card[aria-current] .t").textContent' | grep -o 'true\|false' | head -1)
twinned=$(num '() => document.querySelectorAll(".ev-card .t .also").length')
chrome-devtools-axi open "$url#evidence/update-2" >/dev/null; chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 800))" >/dev/null
fills=$(chrome-devtools-axi eval '() => Math.round(document.querySelector(".ev-hero img").getBoundingClientRect().width) + " of " + Math.round(document.querySelector(".ev-item").getBoundingClientRect().width) + " px"' | sed -n 's/^result: "\(.*\)"$/\1/p' | sed 's/\\"//g')
rows=$(num '() => new Set([...document.querySelectorAll(".ev-verdict .choices button")].map((b) => Math.round(b.getBoundingClientRect().top))).size')
chrome-devtools-axi open "$url" >/dev/null; chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 800))" >/dev/null
askbox=$(chrome-devtools-axi eval '() => { const a = document.querySelector("details.ask"); return Math.round(a.getBoundingClientRect().height) + " px tall, border " + getComputedStyle(a).borderTopWidth; }' | sed -n 's/^result: "\(.*\)"$/\1/p' | sed 's/\\"//g')
beside=$(chrome-devtools-axi eval '() => document.querySelector(".t-proof").getBoundingClientRect().left > document.querySelector(".up-next").getBoundingClientRect().right' | grep -o 'true\|false' | head -1)
tile=$(num '() => document.querySelector(".tile.g-proof .n").textContent'); row=$(chrome-devtools-axi eval '() => [...document.querySelectorAll(".t-proof .lrow")].map((a) => a.getAttribute("href").slice(10)).join(" ")' | sed -n 's/^result: "\(.*\)"$/\1/p')
newest3=$(chrome-devtools-axi eval '() => fetch("/api/decisions").then((r) => r.json()).then((s) => s.decisions.filter((d) => d.type === "evidence" && !["RUN FAIL", "INCONCLUSIVE"].includes(d.evidenceCard?.result)).sort((x, y) => Date.parse(y.filed) - Date.parse(x.filed)).slice(0, 3).map((d) => d.key).join(" "))' | sed -n 's/^result: "\(.*\)"$/\1/p')
{
  echo "proof cards listed on Evidence: $evcards"
  echo "proof cards dated 3 days ago listed: $old"
  echo "cards for the reposted proof listed: $repostcards"
  echo "headings inside the Evidence list: $heads"
  echo "cards in newest-first order: $newest"
  echo "project filter choices: $projects"
  echo "cards listed with the muxr project picked: $muxr"
  echo "Proof tile (every update filed, failed runs too): $tile"
  echo "Latest proof rows on Today: $row (the three newest on Evidence: $newest3)"
  echo "Evidence list columns at 1280: $columns"
  echo "newest proof selected and open beside the list at 1280: $selected"
  echo "Latest proof right of Up next at 1280: $beside"
  echo "cards sharing a headline that name what differs at 1280: $twinned"
  echo "update capture width across the preview at 1280: $fills"
  echo "rows the Pass, Fail and Needs work buttons take at 1280: $rows"
  echo "closed Ask the agent at 1280: $askbox"
  echo "dismissal log lines written: $(cat "$d/board.dismissed.jsonl" 2>/dev/null | wc -l)"
} > "$out/counts.txt"
# With the recording the desk steps include the clicks it makes.
rec=$([ "${TODAY_EVIDENCE_RECORD:-}" != 1 ] || echo ', "On the desk at 1280, point at a Latest proof row on Today (its hover tint shows), click it: Evidence opens with that update selected beside the list", "Click three more rows in the Evidence list: each click changes the selection, its tint and accent bar move, and the selected update slides in from the right"')
cat > "$out/steps.json" <<JSON
{"target": {"version": "$(node -p 'require("./package.json").version')"}, "start": "A new board with two passed updates (one filed 3 days ago) and two updates with no run, each with a capture, and one new report",
 "steps": ["Open Today on a phone at 390 and on a desk at 1280 (1024px and wider is the desk layout) in light and dark", "Read the Proof tile and the Latest proof rows; on the desk, find Latest proof and the new report in a column beside Up next, the ask that matters most", "Open Evidence on a phone at 390 and on the desk at 1280 in light and dark; on the desk the list is one column, newest first, beside the selected update, the newest when none is picked", "Open the passed update at 390 and 1280: on the desk its capture fills the preview's width from the top of the shot and opens full size on a tap; Pass, Fail and Needs work sit on one row", "Scroll Today to Ask the agent, closed", "Crop one shot per claim, settled and fully open: the update's capture filling its preview with Open full size, as wide as the Proof rows under it, the Pass, Fail and Needs work row, the closed Ask the agent line under the Leash, one Evidence card on a phone whose picture, a phone screenshot, fills its tile edge to edge from the top of the shot, and the two Evidence cards with the same headline, each with its own title on a line under it (on a phone, just their headlines, title lines and results, stacked)", "Pick muxr in the project filter", "Compare Evidence, which keeps every proof, with Latest proof, which shows its three newest, and the Proof tile, which counts them and the failed runs"$rec],
 "result": "Today's Latest proof shows the three newest updates on Evidence and the Proof tile counts every update filed; Evidence lists every proof in one list, newest first, with no project or day headings, and its project filter narrows it to one project, including the 3-day-old one, the pull request proof and the plain one; the reposted card is listed once and no dismissal is written. Two cards with the same headline each name what tells them apart (here their own titles). Each Evidence card's capture fills a tile half as tall as it is wide; the update's verdicts take one row of equal buttons; closed, Ask the agent is one line of text with no box. On a desk (1024px and wider, shown at 1280) Today shows Latest proof and the new report beside Up next, and Evidence is one list beside the selected update, which a click changes and slides in; on a phone at 390 Today and Evidence keep one column of full-width cards"}
JSON
