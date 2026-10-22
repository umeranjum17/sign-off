#!/usr/bin/env bash
# Decide at phone size (390x844, 2x), light and dark, on a fresh seeded board: the list, an ask, the answered moment and,
# where the board draws them, the feel states (press, swipe right and left, More on the list and on an ask, a swiped answer,
# the all-clear). Motion (skeleton, push, the answer's check and fold) is in decide-record.sh's recording. The board is served and stopped inside this command; its folder is removed at the end.
# Usage, from the repo root after npm run build: decide-shots.sh <out folder>
# Files: <state>.<theme>.390w.png. Run it on a base build into before/ and on this build into after/: the shared names pair up.
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
shot() { ax screenshot "$out/$1.$theme.390w.png"; echo "$out/$1.$theme.390w.png"; }
# A hash change alone keeps the page's old state; a reload reads the board again.
go() { ax open "$url#$1"; ax eval "() => { location.reload(); return 1 }"; pause 1000; }
unanswer() { curl -sf "${url}api/answers" -H 'content-type: application/json' -d "{\"key\":\"$1\",\"answer\":\"\",\"note\":\"\"}" >/dev/null; }
# A finger tap: pointer events through the page's own handlers, then a click (an emulated tap can miss; see SKILL.md).
tap='(s) => { const e = document.querySelector(s); if (!e) return "none"; const o = { bubbles: true, pointerId: 1, isPrimary: true, pointerType: "touch" }; e.dispatchEvent(new PointerEvent("pointerdown", o)); e.dispatchEvent(new PointerEvent("pointerup", o)); e.click(); return "ok"; }'
# A finger dragging a row sideways in eight moves, released or held.
drag='(key, dx, release) => new Promise(async (ok) => { const f = document.querySelector(`.dl-row[data-key="${key}"] .dl-face`); if (!f) return ok("none"); const r = f.getBoundingClientRect(), y = r.top + r.height / 2, x0 = r.left + 60; const o = (x) => ({ bubbles: true, pointerId: 7, isPrimary: true, pointerType: "touch", clientX: x, clientY: y }); f.dispatchEvent(new PointerEvent("pointerdown", o(x0))); for (let i = 1; i <= 8; i++) { await new Promise((w) => setTimeout(w, 16)); f.dispatchEvent(new PointerEvent("pointermove", o(x0 + dx * i / 8))); } if (release) f.dispatchEvent(new PointerEvent("pointerup", o(x0 + dx))); ok("ok"); })'
ax open "$url"
for theme in light dark; do
  phone="--viewport 390x844x2,mobile,touch --color-scheme $theme"
  ax emulate $phone
  go waiting; shot decide
  go decide/ship; shot decide-item
  feel=$(chrome-devtools-axi eval '() => !!document.querySelector(".decide-bar .dl-more")' | grep -c true || true)
  ax eval "() => (${tap})('.decide-bar .answer')"
  pause 1100; shot decide-answered
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
  ax eval "() => (${tap})('.decide-bar .dl-more > summary')"; pause 400; shot decide-item-more
  go waiting
  ax eval "() => (${drag})('keep-the-weekly-digest', 300, true)"; pause 1000; shot decide-swiped-answer
  unanswer keep-the-weekly-digest
done
# All clear: the sign-in, plan and designs dismissed, then Answer all recommended answers the rest and the list empties.
if [ -n "$(ls "$out"/decide-menu.* 2>/dev/null)" ]; then
  curl -sf "${url}api/dismiss" -H 'content-type: application/json' -d '{"keys":["npm","plan-kind-board","look","chat-journeys"],"dismissed":true}' >/dev/null
  for theme in light dark; do
    ax emulate --viewport 390x844x2,mobile,touch --color-scheme $theme
    go waiting
    ax eval "() => (${tap})('.top .dl-more > summary')"; pause 300
    ax eval "() => (${tap})('[data-act=answer-all]')"; pause 1600; shot decide-all-clear
    ax eval "() => (${tap})('#undo')"; pause 1200
  done
fi
