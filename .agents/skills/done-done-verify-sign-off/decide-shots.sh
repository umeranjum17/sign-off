#!/usr/bin/env bash
# Decide at phone size (390x844, 2x) and desk size (1280x800), light and dark (DECIDE_WIDTHS="390" keeps one), on a fresh seeded board: the list, an ask, the answered moment and,
# where the board draws them, the feel states (press, swipe right and left, More on the list and on an ask, a swiped answer,
# the all-clear). Motion (skeleton, push, the answer's check and fold) is in decide-record.sh's recording. The board is served and stopped inside this command; its folder is removed at the end.
# Usage, from the repo root after npm run build: decide-shots.sh <out folder>
# Files: <state>.<theme>.<width>w.png. Run it on a base build into before/ and on this build into after/: the shared names pair up.
set -euo pipefail
out=$1
export PATH=/usr/bin:$PATH CHROME_DEVTOOLS_AXI_SESSION=decide-shots-$$
mkdir -p "$out"
d=$(mktemp -d)
# Whatever happens, the browser session and the board stop, and the board's folder goes.
cleanup() {
  chrome-devtools-axi stop >/dev/null 2>&1 || true
  HOME=$d XDG_CONFIG_HOME=$d/.config XDG_DATA_HOME=$d/.local/share XDG_STATE_HOME=$d/.local/state XDG_CACHE_HOME=$d/.cache node dist/cli.js stop "$d/board.json" >/dev/null 2>&1 || true
  rm -rf -- "$d"
}
trap cleanup EXIT
url=$(.agents/skills/done-done-verify-sign-off/seed-board.sh "$d" | tail -1)
ax() { chrome-devtools-axi "$@" >/dev/null; }
pause() { ax eval "() => new Promise((ok) => setTimeout(ok, $1))"; }
shot() { ax screenshot "$out/$1.$theme.${w}w.png"; echo "$out/$1.$theme.${w}w.png"; }
# A hash change alone keeps the page's old state; a reload reads the board again.
go() { ax open "$url#$1"; ax eval "() => { location.reload(); return 1 }"; pause 1000; }
unanswer() { curl -sf "${url}api/answers" -H 'content-type: application/json' -d "{\"key\":\"$1\",\"answer\":\"\",\"note\":\"\"}" >/dev/null; }
# A finger tap: pointer events through the page's own handlers, then a click (an emulated tap can miss; see SKILL.md).
tap='(s) => { const e = document.querySelector(s); if (!e) return "none"; const o = { bubbles: true, pointerId: 1, isPrimary: true, pointerType: "touch" }; e.dispatchEvent(new PointerEvent("pointerdown", o)); e.dispatchEvent(new PointerEvent("pointerup", o)); e.click(); return "ok"; }'
# A finger dragging a row sideways in eight moves, released or held.
drag='(key, dx, release) => new Promise(async (ok) => { const f = document.querySelector(`.dl-row[data-key="${key}"] .dl-face`); if (!f) return ok("none"); const r = f.getBoundingClientRect(), y = r.top + r.height / 2, x0 = r.left + 60; const o = (x) => ({ bubbles: true, pointerId: 7, isPrimary: true, pointerType: "touch", clientX: x, clientY: y }); f.dispatchEvent(new PointerEvent("pointerdown", o(x0))); for (let i = 1; i <= 8; i++) { await new Promise((w) => setTimeout(w, 16)); f.dispatchEvent(new PointerEvent("pointermove", o(x0 + dx * i / 8))); } if (release) f.dispatchEvent(new PointerEvent("pointerup", o(x0 + dx))); ok("ok"); })'
ax open "$url"
for w in ${DECIDE_WIDTHS:-390 1280}; do
for theme in light dark; do
  vp=390x844x2,mobile,touch; [ "$w" = 1280 ] && vp=1280x800x1
  ax emulate --viewport $vp --color-scheme $theme
  go waiting; shot decide
  go decide/npm; shot decide-signin
  go decide/ship; shot decide-item
  feel=$(chrome-devtools-axi eval '() => !!document.querySelector(".ask-nav .dl-more, .split-bar .dl-more, .decide-bar .dl-more")' | grep -c true || true)
  # Nothing is picked until the person picks: Friday first, then the button that now names it.
  ax eval "() => (${tap})('.decide .pick-option')"
  ax eval "() => (${tap})('.decide-bar .answer')"
  pause 1100; shot decide-answered
  # Undo: its toast has the same style, with its own mark.
  ax eval "() => (${tap})('#undo')"; pause 700; shot decide-undo-toast
  unanswer ship
  # The feel states exist only where the board draws them; a base build stops here.
  [ "$feel" = 1 ] || continue
  go waiting
  ax eval '() => { const r = document.querySelector(".dl-row[data-key=ship] .dl-face"); r.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, isPrimary: true, pointerType: "touch", clientX: 200, clientY: r.getBoundingClientRect().top + 20 })); return "ok" }'
  pause 250; shot decide-press
  ax eval '() => { document.querySelector(".dl-row[data-key=ship] .dl-face").dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 })); return "ok" }'
  for side in right left; do
    go waiting
    dx=150; [ $side = left ] && dx=-150
    ax eval "() => (${drag})('ship', $dx, false)"; pause 300; shot decide-swipe-$side
  done
  go waiting
  ax eval "() => (${tap})('.top .dl-more > summary')"; pause 400; shot decide-menu
  go decide/ship
  # On a desk the bar sits under a tall ask: it is scrolled into view first, so the button shows.
  ax eval "() => { document.querySelector('.decide-bar').scrollIntoView({ block: 'end' }); return 1 }"
  pause 300; shot decide-item-end
  ax eval "() => (${tap})('.ask-nav .dl-more > summary, .split-bar .dl-more > summary')"; pause 400; shot decide-item-more
  go waiting
  ax eval "() => (${drag})('keep-the-weekly-digest', 300, true)"; pause 1000; shot decide-swiped-answer
  unanswer keep-the-weekly-digest
  # The desk's own states: the ? sheet of keys, and a row's hover actions (shown here by focusing them, as headless has no mouse).
  if [ "$w" = 1280 ] && [ "$(chrome-devtools-axi eval '() => !!document.getElementById("keys")' | grep -c true)" = 1 ]; then
    go decide/ship
    ax eval "() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })); return 1 }"; pause 500; shot decide-keys
    go waiting
    ax eval "() => { document.querySelector('.dl-row[data-key=keep-the-weekly-digest] .dl-hover .yes').focus(); return 1 }"; pause 300; shot decide-hover
  fi
done
done
# DECIDE_RECORD=1 also records the motion at 390, light and dark, on the same board (decide.<theme>.390w.mp4), and the desk by keys (decide.<theme>.1280w.mp4) where the board has one.
if [ -n "${DECIDE_RECORD:-}" ] && [ -n "$(ls "$out"/decide-menu.* 2>/dev/null)" ]; then
  for theme in light dark; do node .agents/skills/done-done-verify-sign-off/decide-record.mjs "$url" $theme "$out/decide.$theme.390w.mp4"; done
  if [ -n "$(ls "$out"/decide-keys.* 2>/dev/null)" ]; then
    for theme in light dark; do unanswer ship; unanswer keep-the-weekly-digest; unanswer look; node .agents/skills/done-done-verify-sign-off/decide-record.mjs "$url" $theme "$out/decide.$theme.1280w.mp4" desk; done
    unanswer ship; unanswer keep-the-weekly-digest; unanswer look
  fi
fi
# All clear: the sign-in, plan and designs dismissed, then Answer all recommended answers the rest and the list empties.
if [ -n "$(ls "$out"/decide-menu.* 2>/dev/null)" ]; then
  curl -sf "${url}api/dismiss" -H 'content-type: application/json' -d '{"keys":["npm","plan-kind-board","look","chat-journeys"],"dismissed":true}' >/dev/null
  for w in ${DECIDE_WIDTHS:-390 1280}; do
  for theme in light dark; do
    vp=390x844x2,mobile,touch; [ "$w" = 1280 ] && vp=1280x800x1
    ax emulate --viewport $vp --color-scheme $theme
    go waiting
    ax eval "() => (${tap})('.top .dl-more > summary')"; pause 300
    ax eval "() => (${tap})('[data-act=answer-all]')"; pause 1600; shot decide-all-clear
    ax eval "() => (${tap})('#undo')"; pause 1200
  done
  done
fi
# The step record done-done checks a claim against.
node -e 'const [out, v, w] = process.argv.slice(1); require("fs").writeFileSync(out + "/steps.json", JSON.stringify({ target: { version: v }, start: "A throwaway board seeded with a sign-in, two asks to answer, a design pick, a screen design, a plan and an answered ask, opened on Decide",
  steps: [`At ${w} px, light then dark, the person opens Decide and sees the rows grouped Sign in, Answer and Review.`, "The person opens the npm sign-in: at 1280 wide (a desk) its detail sits beside the list, and at 390 (a phone) on a page of its own.", "The person opens the ship ask and looks at its options above the answer bar, then taps Friday, then Answer Friday, then Undo in the toast.", "On the list the person presses a row, drags it right and left, and opens More.", "On the ask the person opens More in the bar over it.", "The person swipes the digest row right to answer it.", "With the sign-in, plan and designs dismissed, the person taps More, Answer all recommended."],
  result: "At 1280 wide, light and dark: the sign-in detail shows its title Sign in to npm, what it unlocks (Unlocks: Publishing the release) and one primary button, Open sign-in; the time left of the sign-in shows once, on its list row; on the ask When should the new settings page ship?, the answer bar sits after the last option, Next week, and covers no option. On a phone (390) the sign-in keeps its card with Open. Decide shows grouped rows with icons, two-line titles, times and the recommended pick; a press tints a row, a right drag shows the green answer and a left drag the indigo Later; the ask opens with nothing picked and its one button off until a pick, which it then names, and one More over it holding only Ask me later and Dismiss; an answer and its Undo each show a toast in one style with its own mark; when nothing waits a green check says All clear." }, null, 2) + "\n")' "$out" "$(node -p 'require("./package.json").version')" "${DECIDE_WIDTHS:-390 1280}"
