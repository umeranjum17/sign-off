#!/usr/bin/env bash
# Decide beside the approved feel prototype: a board seeded with the prototype's own demo data (seed-proto-board.sh), each Decide state the prototype has a shot of,
# at 390x844 and 1280x800 (both 2x, as the prototype's shots), light and dark (MATCH_WIDTHS="390" keeps one width).
# With PROTO_SHOTS naming the prototype's shots folder (its <state>.<theme>.<width>w.png), each state is also written side by side, the same size:
# the prototype on the left, the board on the right. MATCH_RECORD=1 also records the phone flows (pick with a note, Your own answer, a pick with no note, More) per theme.
# The board is served and stopped inside this command; its folder is removed at the end.
# Usage, from the repo root after npm run build: decide-match.sh <out folder>
# Files: <state>.<theme>.<width>w.png (the board), side/<state>.<theme>.<width>w.png (the pair), decide-flows.<theme>.390w.mp4.
set -euo pipefail
out=$1 here=$(dirname "$0")
export PATH=/usr/bin:$PATH CHROME_DEVTOOLS_AXI_SESSION=decide-match-$$
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
# The prototype's sign-in has about 11:40 left; its link is made fresh for each state, as the clock runs on.
fresh() { node -e 'const fs = require("fs"), f = process.argv[1], b = JSON.parse(fs.readFileSync(f, "utf8")); b.items.find((x) => x.key === "npm").expires = new Date(Date.now() + 702e3).toISOString().replace(/\.\d+Z$/, "Z"); fs.writeFileSync(f, JSON.stringify(b, null, 2));' "$d/board.json"; }
answer() { curl -sf "${url}api/answers" -H 'content-type: application/json' -d "{\"key\":\"$1\",\"answer\":\"$2\",\"note\":\"\"}" >/dev/null; }
# All clear comes from answering everything, as in the prototype: the sign-in done, the design approved, then Answer all recommended; clear() takes back the first two.
done_() { HOME=$d XDG_CONFIG_HOME=$d/.config XDG_DATA_HOME=$d/.local/share XDG_STATE_HOME=$d/.local/state XDG_CACHE_HOME=$d/.cache node dist/cli.js signin done "$d/board.json" --key npm >/dev/null
  curl -sf "${url}api/answers" -H 'content-type: application/json' -d '{"key":"onboarding","verdict":"approve","notes":[]}' >/dev/null; }
clear() { answer npm ''; answer onboarding ''; }
# Each state starts from a fresh read of the board and an empty browser store (no Later shelf, no drafts).
go() { fresh; ax open "$url#$1"; js 'localStorage.clear(); location.reload()'; pause 1300; }
shot() { ax screenshot "$out/$1.$theme.${w}w.png"; echo "$out/$1.$theme.${w}w.png"; }
# A finger tap through the page's own handlers, a press held, and a drag held mid-swipe (an emulated tap can miss; see SKILL.md).
tap() { js "const e = document.querySelector('$1'), o = { bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'touch' }; e.dispatchEvent(new PointerEvent('pointerdown', o)); e.dispatchEvent(new PointerEvent('pointerup', o)); e.click()"; }
press() { js "const f = document.querySelector('.dl-row[data-key=$1] .dl-face'), r = f.getBoundingClientRect(); f.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: 200, clientY: r.top + 20 }))"; }
drag() { ax eval "() => new Promise(async (ok) => { const f = document.querySelector('.dl-row[data-key=$1] .dl-face'), r = f.getBoundingClientRect(), y = r.top + r.height / 2, x0 = r.left + 60; const o = (x) => ({ bubbles: true, pointerId: 7, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y }); f.dispatchEvent(new PointerEvent('pointerdown', o(x0))); for (let i = 1; i <= 8; i++) { await new Promise((z) => setTimeout(z, 16)); f.dispatchEvent(new PointerEvent('pointermove', o(x0 + $2 * i / 8))); } ok(1); })"; }
key() { js "(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: '$1', bubbles: true }))"; }
words() { js "const t = document.querySelector('$1'); t.value = '$2'; t.dispatchEvent(new Event('input')); t.focus({ preventScroll: true }); t.scrollIntoView({ block: 'center' })"; }
ax open "$url"
for w in ${MATCH_WIDTHS:-390 1280}; do
for theme in light dark; do
  vp=390x844x2,mobile,touch; [ "$w" = 1280 ] && vp=1280x800x2
  ax emulate --viewport $vp --color-scheme $theme
  if [ "$w" = 390 ]; then
    go waiting; shot decide
    tap '.top .dl-more > summary'; pause 400; shot decide-menu
    go waiting; press digest; pause 250; shot decide-press
    go waiting; drag ship 150; pause 300; shot decide-swipe-right
    go waiting; drag digest -150; pause 300; shot decide-swipe-left
    go decide/ship; shot pick
    tap '.decide .own-option'; words '.decide .own-box' 'Ship Friday, but keep support on call until Monday.'; pause 500; shot pick-own
    go decide/ship; js "document.querySelectorAll('.decide .pick-option')[1].click()"; words '.decide .note-box' 'Keep support on call until Monday.'; pause 500; shot pick-comment
    go decide/ship; tap '.proof-row'; pause 500; shot pick-proof
    go decide/ship; js "document.querySelectorAll('.decide .pick-option')[1].click()"; tap '.decide-bar .answer'; pause 1500; shot pick-toast
    answer ship ''
    go decide/npm; shot signin
    # Open sign-in opens the service in a new tab; here the tab is held back, so only the card's own answer shows.
    js "document.addEventListener('click', (e) => e.target.closest('.open-link') && e.preventDefault(), { capture: true, once: true })"; tap '.decide-bar .open-link'; pause 600; shot signin-wait
    done_; go waiting; tap '.top .dl-more > summary'; pause 300; tap '[data-act=answer-all]'; pause 1500; shot decide-empty
    tap '#undo'; pause 1200; clear
  else
    go waiting; shot desk-decide
    tap '.top .dl-more > summary'; pause 400; shot desk-menu
    go decide/ship; shot desk-pick
    key 3; pause 400; shot desk-pick-option
    go decide/ship; key 2; key c; words '.decide .note-box' 'Keep support on call until Monday.'; pause 500; shot desk-pick-comment
    go decide/ship; key 2; key Enter; pause 1400; shot desk-answered
    answer ship ''
    go decide/ship; key l; pause 1200; shot desk-later
    go decide/npm; key '?'; pause 500; shot desk-keys
    done_; go waiting; tap '.top .dl-more > summary'; pause 300; tap '[data-act=answer-all]'; pause 1500; shot desk-allclear
    tap '#undo'; pause 1200; clear
  fi
done
done
# The pairs: the prototype on the left, the board on the right, each under its name, the same size.
if [ -n "${PROTO_SHOTS:-}" ]; then
  mkdir -p "$out/side"
  for f in "$out"/*.png; do
    b=$(basename "$f") p=$PROTO_SHOTS/$(basename "$f")
    [ -f "$p" ] || { echo "no prototype shot for $b" >&2; continue; }
    size=$(magick identify -format '%wx%h' "$p") pt=28; [ "${size%%x*}" -gt 1000 ] && pt=40
    label() { magick "$1" -resize "$size!" -background '#8E8E93' -fill white -font Liberation-Sans -pointsize $pt -gravity north -splice 0x$((pt * 2)) -annotate +0+$((pt / 2)) "$2" "$3"; }
    label "$p" 'Approved prototype' "$d/left.png"; label "$f" 'Live board' "$d/right.png"
    magick "$d/left.png" -size "16x$(magick identify -format '%h' "$d/left.png")" xc:'#8E8E93' "$d/right.png" +append "$out/side/$b"
  done
fi
if [ -n "${MATCH_RECORD:-}" ]; then
  for theme in light dark; do
    for k in ship digest export; do answer $k ''; done
    fresh; node "$here/decide-record.mjs" "$url" $theme "$out/decide-flows.$theme.390w.mp4" flows
  done
fi
# The step record done-done checks a claim against: one step per state captured above, in the words a claim about that screen uses.
node -e 'const [out, v] = process.argv.slice(1); require("fs").writeFileSync(out + "/steps.json", JSON.stringify({ target: { version: v }, start: "A throwaway board seeded with the approved feel prototype\x27s own demo data (the npm sign-in, the asks When should the new settings page ship?, Keep the weekly digest? and What should the export button say?, the Chat app onboarding design, five proofs and two new reports), opened on Decide",
  steps: [
    "At 390 px, on a phone, light then dark, the person opens Decide: the date, the title Decide, 5 waiting · each has a recommended answer, rows grouped Sign in, Answer and Review, each row with its icon, the question, its time and its recommended pick, and a floating tab bar at the bottom.",
    "On a phone the person taps More at the top right of Decide: the menu holds two items, Answer all recommended and Move all to later.",
    "On a phone the person presses the Keep the weekly digest? row, which is tinted grey as it is pressed.",
    "On a phone the person drags the When should the new settings page ship? row to the right, showing a green Friday action with a check under it, then drags the Keep the weekly digest? row to the left, showing an indigo Later action with a clock under it.",
    "On a phone the person opens the ask When should the new settings page ship?: no answer is picked, Today, Friday (tagged Recommended), Next week and Your own answer are cards with empty radios, and the button at the foot reads Pick an answer.",
    "On a phone the person picks Your own answer: its card is checked, one box opens under it, the person types the answer in it, and the button at the foot reads Send answer.",
    "On a phone the person picks Friday and types a note in the Note box under the cards; the button at the foot reads Answer Friday.",
    "On a phone the person taps the proof row: a sheet from the bottom shows Settings page loads in a second, Passed with the time it was checked, and its capture in a phone frame.",
    "On a phone the person answers Friday: the next ask, Keep the weekly digest?, opens with Back at the top left (the owner\x27s ask; the prototype goes back to the list), and a toast at the bottom names the question and Friday, with Undo.",
    "On a phone the person opens the npm sign-in, a page of its own: an orange key, Sign in to npm, why it waits, Unlocks, Expires in with a clock, Where, and an Open sign-in button; after Open sign-in is tapped the button shows a spinner and reads Waiting for you to sign in.",
    "On a phone, with the sign-in done and the design approved, the person taps More, Answer all recommended: every ask is answered, and Decide shows a green check over All clear and Nothing is waiting on you, Umer, with a toast that offers Undo.",
    "At 1280 px, on a desk, light then dark, Decide\x27s list sits beside the selected npm sign-in, which shows its key, Sign in to npm, Unlocks and Where, and an Open sign-in button; the person opens Decide\x27s More menu over the list, with Answer all recommended and Move all to later.",
    "On a desk the person opens the ask When should the new settings page ship? beside the list: its proof row and its answers as numbered cards, none of them picked, with Your own answer last; the person presses 3 and Next week is picked, the button below naming it: Answer Next week.",
    "On a desk the person presses 2 to pick Friday, then C, and types a note in the Note box; the button reads Answer Friday.",
    "On a desk the person answers the settings page ask with Enter: the next ask Keep the weekly digest? is shown beside the list, and a toast names the answered question and Friday, with Undo.",
    "On a desk the person presses L on the settings page ask: it moves under Later in the list, the next ask is shown beside it, and a toast says it moved to later, with Undo.",
    "On a desk the person presses ? and the Keyboard shortcuts sheet opens over Decide, listing its keys, among them Pick option 1 to 9, Note and Answer from the note.",
    "On a desk, with every ask answered, Decide shows All clear in the list and, larger, in the pane, with a toast that offers Undo."],
  result: "Each state is written beside the prototype\x27s shot of it, the same size. On a phone and on a desk, Decide lists what waits grouped Sign in, Answer and Review with each row\x27s recommended pick, and its More holds Answer all recommended and Move all to later; a pressed row is tinted grey and a dragged row shows a green Friday or an indigo Later action. An ask such as When should the new settings page ship? opens with no answer picked and its button reading Pick an answer; picking Friday makes it read Answer Friday, a note goes in the Note box under the cards, and Your own answer opens one box with Send answer. The proof opens in a sheet; an answer shows a toast naming the question and the answer with Undo, and on a desk the next ask Keep the weekly digest? is shown and L moves an ask under Later. The npm sign-in shows its orange key, Unlocks, Expires in with a clock, Where and Open sign-in, then Waiting for you to sign in. The Keyboard shortcuts sheet lists Pick option 1 to 9, Note and Answer from the note. With every ask answered, Decide shows All clear, Nothing is waiting on you, Umer, with a toast that offers Undo." }, null, 2) + "\n")' "$out" "$(node -p 'require("./package.json").version')"
