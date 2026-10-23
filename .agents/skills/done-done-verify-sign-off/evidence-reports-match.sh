#!/usr/bin/env bash
# Evidence and Reports beside the approved feel prototype: a board seeded with the prototype's own demo data (seed-proto-board.sh), each Evidence and Reports state
# the prototype has a shot of, at 390x844 and 1280x800 (both 2x, as the prototype's shots), light and dark (MATCH_WIDTHS="390" or MATCH_THEMES="light" keep one).
# With PROTO_SHOTS naming the prototype's shots folder (its <state>.<theme>.<width>w.png), each state is also written side by side, the same size:
# the prototype on the left, the board on the right.
# MATCH_RECORD=1 also records the phone flow per theme (decide-record.mjs ... evidence).
# The board is served and stopped inside this command; its folder is removed at the end.
# Usage, from the repo root after npm run build: evidence-reports-match.sh <out folder>
# Files: <state>.<theme>.<width>w.png (the board), <state>.<theme>.<width>w.txt (what the page says it shows), side/<state>.<theme>.<width>w.png (the pair),
# evidence-reports.<theme>.390w.mp4, steps.json.
set -euo pipefail
out=$1 here=$(dirname "$0")
export PATH=/usr/bin:$PATH CHROME_DEVTOOLS_AXI_SESSION=evidence-reports-match-$$
mkdir -p "$out"
d=$(mktemp -d)
cleanup() {
  chrome-devtools-axi stop >/dev/null 2>&1 || true
  HOME=$d XDG_CONFIG_HOME=$d/.config XDG_DATA_HOME=$d/.local/share XDG_STATE_HOME=$d/.local/state XDG_CACHE_HOME=$d/.cache node dist/cli.js stop "$d/board.json" >/dev/null 2>&1 || true
  rm -rf -- "$d"
}
trap cleanup EXIT
url=$("$here/seed-proto-board.sh" "$d" | tail -1)
ax() { chrome-devtools-axi "$@" >/dev/null; }
pause() { ax eval "() => new Promise((ok) => setTimeout(ok, $1))"; }
js() { ax eval "() => { $1; return 1 }"; }
# Each state starts from the two new reports unread again and an empty browser store.
unread() { curl -sf "${url}api/reads" -H 'content-type: application/json' -d '{"keys":["new-sign-in","first-second"],"read":false}' >/dev/null; }
go() { unread; ax open "$url#$1"; js 'localStorage.clear(); location.reload()'; pause 1300; }
# What the page says it shows, beside each shot: the rows, their dots and results, the counts, the title bar, what is open, sideways overflow and controls under 44px.
facts() { chrome-devtools-axi eval "() => JSON.stringify({ hash: location.hash, rows: [...document.querySelectorAll('.dl-row .title')].map((t) => t.textContent),
  results: [...document.querySelectorAll('.ev-list .res')].map((r) => r.textContent), dots: document.querySelectorAll('.rp-list .new:not(.out)').length,
  lede: document.querySelector('.waiting-lede')?.textContent ?? '', tabs: [...document.querySelectorAll('#tabs .bd, .side .n')].map((b) => b.textContent),
  menu: [...document.querySelectorAll('details[open] > .dl-menu > button')].map((b) => b.textContent + (b.disabled ? ' (off)' : '')),
  selected: document.querySelector('.dl-row.sel .title')?.textContent ?? '', bar: document.querySelector('.split-bar')?.textContent ?? '',
  page: document.querySelector('#reader:not([hidden]) h1, .split-detail h1')?.textContent ?? '', overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  small: [...document.querySelectorAll('a, button, summary')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && getComputedStyle(e).visibility === 'visible' && (r.height < 44 || r.width < 44) && innerWidth < 1024; }).map((e) => (e.getAttribute('aria-label') ?? e.textContent).trim().slice(0, 40)).slice(0, 12) })" > "$out/$1.$theme.${w}w.txt"; }
shot() { ax screenshot "$out/$1.$theme.${w}w.png"; facts "$1"; echo "$out/$1.$theme.${w}w.png"; }
# A finger tap through the page's own handlers, and a drag held mid-swipe (an emulated tap can miss; see SKILL.md).
tap() { js "const e = document.querySelector('$1'), o = { bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'touch' }; e.dispatchEvent(new PointerEvent('pointerdown', o)); e.dispatchEvent(new PointerEvent('pointerup', o)); e.click()"; }
drag() { ax eval "() => new Promise(async (ok) => { const f = document.querySelector('.dl-row[data-key=$1] .dl-face'), r = f.getBoundingClientRect(), y = r.top + r.height / 2, x0 = $2 > 0 ? r.left + 60 : r.right - 60; const o = (x) => ({ bubbles: true, pointerId: 7, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y }); f.dispatchEvent(new PointerEvent('pointerdown', o(x0))); for (let i = 1; i <= 8; i++) { await new Promise((z) => setTimeout(z, 16)); f.dispatchEvent(new PointerEvent('pointermove', o(x0 + $2 * i / 8))); } ok(1); })"; }
key() { js "(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: '$1', bubbles: true }))"; }
ax open "$url"
for w in ${MATCH_WIDTHS:-390 1280}; do
for theme in ${MATCH_THEMES:-light dark}; do
  vp=390x844x2,mobile,touch; [ "$w" = 1280 ] && vp=1280x800x2
  ax emulate --viewport $vp --color-scheme $theme
  if [ "$w" = 390 ]; then
    go evidence; shot evidence
    tap '#ev-project > summary'; pause 400; shot evidence-project
    tap '[data-act=project-chat-app]'; pause 600; shot evidence-filtered
    go evidence/code-keypad; shot evidence-update
    go reports; shot reports
    js 'scrollTo(0, document.body.scrollHeight); dispatchEvent(new Event("scroll"))'; pause 400; shot reports-end
    go reports; tap '.top .dl-more > summary'; pause 400; shot reports-menu
    go reports; drag first-second 170; pause 300; shot reports-swipe-right
    go reports; drag release-train -170; pause 300; shot reports-swipe-left
    go reports; tap 'a.dl-face[href="#reports/new-sign-in"]'; pause 900; tap '#reader .close'; pause 1200; shot reports-read
    go reports/new-sign-in; pause 600; shot report
    go reports/first-second; pause 600; shot report-chart
    go reports/release-train; pause 600; shot report-diagram
    go reports/next-question; pause 600; shot report-list
  else
    go evidence; shot desk-evidence
    tap '#ev-project > summary'; pause 400; shot desk-evidence-project
    tap '[data-act=project-chat-app]'; pause 700; shot desk-evidence-filtered
    go evidence; key j; pause 150; key j; pause 150; key j; pause 700; shot desk-evidence-failed
    go reports; pause 600; shot desk-reports
    go reports/new-sign-in; pause 900; shot desk-reports-read
    go reports/first-second; pause 900; shot desk-report-chart
    go reports/release-train; pause 900; shot desk-report-diagram
  fi
done
done
# The pairs: the prototype on the left, the board on the right, each under its name, the same size.
pair() { # left right label-left out
  local size pt; size=$(magick identify -format '%wx%h' "$2") pt=28; [ "${size%%x*}" -gt 1000 ] && pt=40
  label() { magick "$1" -resize "$size" -background '#8E8E93' -gravity center -extent "$size" -fill white -font Liberation-Sans -pointsize $pt -gravity north -splice 0x$((pt * 2)) -annotate +0+$((pt / 2)) "$2" "$3"; }
  label "$1" "$3" "$d/left.png"; label "$2" 'Live board' "$d/right.png"
  magick "$d/left.png" -size "16x$(magick identify -format '%h' "$d/left.png")" xc:'#8E8E93' "$d/right.png" +append "$4"
}
if [ -n "${PROTO_SHOTS:-}" ]; then
  mkdir -p "$out/side"
  for f in "$out"/*.png; do
    p=$PROTO_SHOTS/$(basename "$f")
    [ -f "$p" ] || { echo "no prototype shot for $(basename "$f")" >&2; continue; }
    pair "$p" "$f" 'Approved prototype' "$out/side/$(basename "$f")"
  done
fi
if [ -n "${MATCH_RECORD:-}" ]; then
  for theme in ${MATCH_THEMES:-light dark}; do unread; node "$here/decide-record.mjs" "$url" $theme "$out/evidence-reports.$theme.390w.mp4" evidence; done
fi
# The step record done-done checks a claim against: one step per state captured above, in the words a claim about that screen uses.
node -e 'const [out, v] = process.argv.slice(1); require("fs").writeFileSync(out + "/steps.json", JSON.stringify({ target: { version: v }, start: "A throwaway board seeded with the approved feel prototype\x27s own demo data (five proofs in the projects settings, chat-app and release, one failed and one with no run, and five reports, two new today), opened on Evidence",
  steps: [
    "At 390 px, on a phone, light then dark, the person opens Evidence: the date, the title Evidence and More at the top right, an All projects pill, then one row per proof, newest first, each with the top of its capture, its title, its result as a coloured dot and word with its project, and when it was filed, the failed one in red, over a floating tab bar.",
    "On a phone the person taps All projects: a menu opens under it with All projects ticked, a gap, then chat-app, release and settings.",
    "On a phone the person picks chat-app: the pill reads chat-app and only its two proofs are listed, Sign-in screen fits a phone (Not run) and Code screen keeps the keypad in view (Failed).",
    "On a phone the person opens Code screen keeps the keypad in view: a page with the way back to Evidence, Failed · chat-app · Yesterday, 16:05, its title, what it proves, then its capture with a soft edge.",
    "On a phone the person opens Reports: the date, the title Reports, 2 new · 5 in all and More, then Today (2) and Earlier (3), each row with a teal picture of its form, its title, a blue dot while it is new, two lines of what it says and its form, project and time; the Reports tab carries a blue 2.",
    "On a phone the person scrolls Reports to its end: the small title Reports shows in a bar at the top, and the last report sits clear above the tab bar.",
    "On a phone the person taps More on Reports: the menu holds one item, Mark all as read.",
    "On a phone the person drags Where the settings page spends its first second to the right, showing a blue Read action, then drags Why the release train has three stages to the left, showing an indigo Archive action.",
    "On a phone the person opens How the new sign-in works and goes back: its blue dot is gone, Reports reads 1 new · 5 in all, and the tab carries a blue 1.",
    "On a phone the person opens a report: the way back to Reports, what it explains with in teal, who asked and when, a large title, what it says in grey, then the report\x27s own page, ending, where it decided something, in a green What it decided box.",
    "At 1280 px, on a desk, light then dark, Evidence\x27s list sits beside the newest proof: the list with the date, the title, More and the All projects pill, the selected row tinted with an accent bar; beside it a bar with Passed · settings · Today, 07:40 and Clear E, then the title, what it proves and the capture.",
    "On a desk the person opens the All projects menu over the list, then picks chat-app: two rows remain and the first, Sign-in screen fits a phone, is shown beside them.",
    "On a desk the person presses J three times: Code screen keeps the keypad in view is selected and shown, its bar reading Failed · chat-app · Yesterday, 16:05.",
    "On a desk the person opens Reports: Today and Earlier beside the newest report, How the new sign-in works, whose bar reads Before and after · You asked · Today, 07:19 beside Mark read U and Archive E; opened by its address it is read, the bar says Mark unread and Reports reads 1 new · 5 in all.",
    "On a desk the person opens Where the settings page spends its first second, then Why the release train has three stages, each beside the list with its title, what it says and its page."],
  result: "Each state is written beside the prototype\x27s shot of it, the same size. Evidence is one list of rows, newest first, each with the top of its capture, its title, its result as a coloured dot (red for the failed run) with its project, and when it was filed; the All projects pill opens a menu that narrows the list to chat-app. An update opens to its result, project and time, its title, what it proves and its capture. Reports lists Today and Earlier with teal pictures and blue dots, More holds Mark all as read, a right drag shows Read and a left drag Archive, and an opened report loses its dot. A report\x27s page shows what it explains with in teal, who asked and when, its title and what it says, its page and a green What it decided box. On a desk each list sits beside the item selected, under a bar that says what it is and when, with Clear or Mark read and Archive." }, null, 2) + "\n")' "$out" "$(node -p 'require("./package.json").version')"
