#!/usr/bin/env bash
# Going back to an answer on Decide, on a board seeded with the approved feel prototype's own demo data (seed-proto-board.sh), light and dark:
# at 390 (2x) the ask answered with a note and the next ask opened with Back (back-next), Back to the answer (back-answered), Change answer (back-change),
# another pick sent as a change (back-changed), Undo (back-undone), Decide's Answered group (back-list) and Today's Cleared today (back-today);
# at 1280 the answered ask beside the list (back-answered) and its change (back-change). The agent's side is saved as text: agent-events.<theme>.txt holds what
# `wait --filer release-agent --events` hands over after the answer, the change and the Undo, and answers-file.<theme>.txt the answers file's lines.
# BACK_RECORD=1 also records decide-back.<theme>.390w.mp4 with real taps (decide-record.mjs back).
# SIGN_OFF_REPO=<built base checkout> drives a base build the same way by address: the shots it has pair with these under the same names.
# Each pass (the stills per theme, the recording per theme) gets a board of its own, seeded fresh, so its first answer is a first answer;
# every board is served and stopped inside this command, and their folder is removed at the end.
# Usage, from the repo root after npm run build: decide-back.sh <out folder>
set -euo pipefail
out=$(mkdir -p "$1" && cd "$1" && pwd) here=$(cd "$(dirname "$0")" && pwd) repo=$(cd "${SIGN_OFF_REPO:-.}" && pwd)
export PATH=/usr/bin:$PATH CHROME_DEVTOOLS_AXI_SESSION=decide-back-$$
root=$(mktemp -d) d=
cli() { HOME=$d XDG_CONFIG_HOME=$d/.config XDG_DATA_HOME=$d/.local/share XDG_STATE_HOME=$d/.local/state XDG_CACHE_HOME=$d/.cache node "$repo/dist/cli.js" "$@"; }
# Stops the board this pass served (if any), then seeds and serves a new one.
seed() { [ -z "$d" ] || cli stop "$d/board.json" >/dev/null 2>&1 || true; d=$root/$1; mkdir "$d"; url=$(cd "$repo" && "$here/seed-proto-board.sh" "$d" | tail -1); }
cleanup() {
  chrome-devtools-axi stop >/dev/null 2>&1 || true
  [ -z "$d" ] || cli stop "$d/board.json" >/dev/null 2>&1 || true
  rm -rf -- "$root"
}
trap cleanup EXIT
ax() { chrome-devtools-axi "$@" >/dev/null; }
pause() { ax eval "() => new Promise((ok) => setTimeout(ok, $1))"; }
js() { ax eval "() => { $1; return 1 }"; }
has() { chrome-devtools-axi eval "() => !!document.querySelector('$1')" | grep -q true; }
tap() { js "const e = document.querySelector('$1'), o = { bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'touch' }; e.dispatchEvent(new PointerEvent('pointerdown', o)); e.dispatchEvent(new PointerEvent('pointerup', o)); e.click()"; }
# A tap leaves no keyboard focus behind on a phone: blur what the page focused, so a shot shows what a finger leaves.
calm() { js "document.activeElement?.blur()"; }
shot() { calm; ax screenshot "$out/$1.$theme.${w}w.png"; echo "$out/$1.$theme.${w}w.png"; }
answer() { curl -sf "${url}api/answers" -H 'content-type: application/json' -d "{\"key\":\"$1\",\"answer\":\"$2\",\"note\":\"$3\"}" >/dev/null; }
go() { ax open "$url#$1"; js 'localStorage.clear(); location.reload()'; pause 1300; }
events() { { printf '$ sign-off-axi wait <board> --filer release-agent --events   # %s\n' "$1"; cli wait "$d/board.json" --filer release-agent --events --timeout 3 2>&1 || true; echo; } >> "$out/agent-events.$theme.txt"; }
for theme in light dark; do
  rm -f "$out/agent-events.$theme.txt"
  seed "stills-$theme"; ax open "$url"
  w=390; ax emulate --viewport 390x844x2,mobile,touch --color-scheme $theme
  go decide/ship
  js "document.querySelectorAll('.decide .pick-option')[1].click()"
  js "const t = document.querySelector('.decide .note-box'); t.value = 'Keep support on call until Monday.'; t.dispatchEvent(new Event('input'))"
  tap '.decide-bar .answer'; pause 1400; shot back-next
  events 'after the answer'
  if has '.ask-nav .back'; then tap '.ask-nav .back'; else ax open "$url#decide/ship"; fi
  pause 900; shot back-answered
  if has '.decide .ans-card'; then
    tap '.decide-bar .answer'; pause 700; shot back-change
    js "document.querySelectorAll('.decide .pick-option')[0].click()"; tap '.decide-bar .answer'; pause 1400; shot back-changed
    events 'after Change answer to Today'
    tap '#undo'; pause 1200; shot back-undone
    events 'after Undo'
  fi
  cp "$d/board.answers.jsonl" "$out/answers-file.$theme.txt"
  answer digest no 'Readers can still subscribe to the monthly.'
  go waiting; js "scrollTo(0, 99999)"; pause 500; shot back-list
  go ''; js "document.querySelector('.t-cleared')?.scrollIntoView({ block: 'center' })"; pause 500; shot back-today
  w=1280; ax emulate --viewport 1280x800x2 --color-scheme $theme
  go decide/ship; shot back-answered
  if has '.decide .ans-card'; then tap '.decide-bar .answer'; pause 700; shot back-change; fi
done
if [ -n "${BACK_RECORD:-}" ]; then
  for theme in light dark; do
    seed "record-$theme"
    node "$here/decide-record.mjs" "$url" $theme "$out/decide-back.$theme.390w.mp4" back
  done
fi
# The step record done-done checks a claim against, in the words a claim about these screens uses.
node -e 'const [out, v] = process.argv.slice(1); require("fs").writeFileSync(out + "/steps.json", JSON.stringify({ target: { version: v }, start: "A throwaway board seeded with the approved feel prototype\x27s own demo data (the npm sign-in, the asks When should the new settings page ship?, Keep the weekly digest? and What should the export button say?, the Chat app onboarding design, five proofs and two new reports), opened on the ask When should the new settings page ship? on a phone (390 px), light then dark",
  steps: [
    "On a phone the person picks Friday, types the note Keep support on call until Monday. and taps Answer Friday: the next ask, Keep the weekly digest?, opens, its bar reading Back at the top left with arrows beside More, and a toast at the bottom names the question, Friday and with your comment, with Undo.",
    "The person taps Back: the ask When should the new settings page ship? shows Your answer: Answered and the time, Friday in a green card with the note in quotes and Agent has not read it yet, and one button, Change answer.",
    "The person taps Change answer: the answer cards come back with nothing picked, Friday tagged Your answer, and the button reads Pick a new answer.",
    "The person picks Today and taps Change to Today: the ask shows Changed, Today in the green card, Before: Friday with the note and the time under it, and a toast says changed to Today with Undo; the agent waiting with wait --filer receives the answer today with replaces naming friday.",
    "The person taps Undo: the ask shows Friday again, the toast says Back to: Friday, and the agent receives friday with replaces naming today.",
    "On Decide, below the open asks, the Answered group lists When should the new settings page ship? with Friday and the note, and Keep the weekly digest? with No and its note, each with a green check and the time.",
    "On Today, Cleared today lists the same two answers with their notes and times.",
    "At 1280 px, on a desk, the answered ask sits beside Decide\x27s list with the Answered group selected, showing Friday and Change answer; Change answer brings back its numbered cards with Friday tagged Your answer."],
  result: "After an answer the next ask opens with Back, and Back returns to the ask just answered, which shows the answer, its note, when it was given and whether the agent read it. Change answer brings the cards back; a new pick is saved as a change: the ask reads Changed with the answer before it, and the agent receives the new answer with replaces naming the earlier one, while the answers file keeps every earlier line. Undo puts the earlier answer back, and the agent receives that as a change too. Decide lists every answer under Answered and Today under Cleared today, each with the answer, its note and its time." }, null, 2) + "\n")' "$out" "$(node -p "require('$repo/package.json').version")"
