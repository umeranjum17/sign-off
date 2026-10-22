# Decide

The Decide tab (`#waiting`) and an ask (`#decide/<key>`) at phone size first, built from the approved feel prototype: list rows, one Answer button that names the answer and one More, a skeleton while the board loads, a push into an ask and a pop back, a pressed row, swipes with follow-through, a toast with Undo and a countdown, the answer's check and the row folding away, an all-clear, and an approve stamp in the screen viewer. Light and dark.

## Sub-features

- Header: the date in small caps, the large title Decide, "N items need you" (and "· N for later"), and More (···) at the top right.
- Rows, grouped with a count each: Sign in, Answer, Review (plans, design picks and screen designs, which are looked over before they are answered) and Later. A row is a coloured squircle icon, the question in up to two lines, the time it was filed (a sign-in counts down its link in orange), and "Recommended <pick> · <agent>", or what it is when it recommends nothing. A row is the link to its ask; a press tints it.
- Swipe: right answers with the recommended pick (green), left moves the ask to Later (indigo; on a Later row it brings it back). The row follows the finger; past a third of its width the action grows (a haptic tick on Android) and the swipe commits on release; a fast fling commits sooner; short of it the row springs back; past 80% it rubber-bands; a row with nothing to answer resists a right swipe. Later is kept in this browser per board file (`localStorage['sign-off-later <board file>']`); the agent still waits and the tab still counts it.
- More on the list: Answer all recommended (the Answer rows only), Move all to Later, Oldest first / Newest first (kept in this browser), Select (pick rows, then Dismiss N). Each change shows a toast with Undo.
- Answering: the Answer button turns green and draws a check, the row tints green and folds away, and the toast (a green check, the answer, Undo and a hairline counting down) rises; on a phone the list slides back in, and Undo on the list puts the row back with a blue flash.
- On a desk (1024px and wider) the list sits beside the selected ask (the first one on `#waiting`): the ask's bar on top holds the pager and Later (L), its Answer button shows ↵ and sits at the pane's foot, or after the last option when the ask is taller than the pane, so it never covers one; a sign-in reads like any ask there (Sign-in and who waits, "Sign in to <service>", what it unlocks, and Open sign-in as the bar's one button), its time left only on its row; answering selects the next ask, which slides in, while the answered row folds away; the toast sits over the ask's pane. Hovering (or focusing) a row shows its quick actions: answer with the recommended pick, and Later. Keys: J/K move, Enter answers (or opens a sign-in), 1 to 9 answer with that option, C opens the comment and Cmd/Ctrl+Enter answers from it, L moves to Later, E skips, Cmd/Ctrl+Z undoes; all clear pops in the ask's pane.
- An ask's More, four items at most: Ask me later (back to the list, the row moved to Later), Write my own answer (clears the pick, opens the box and makes the button Send your answer), Ask for another round, and Dismiss last in red. The next ask is a swipe left, E or the pager.
- Every toast has one style: a coloured disc with its mark (a check for a save, a clock for Later, an arrow for an undo, a tray for a dismiss, a stop for a failure), the words, Undo where it applies, and a countdown hairline.
- First load: shimmering rows hold the place until the board file is read; the rows then rise in, a little apart.
- All clear: once nothing waits, a green check pops in over "All clear" and "Nothing is waiting on you.".
- Screen viewer (`#designs/<key>`, Review full screen): an approved screen carries a green check stamp in its corner, which springs in as the approval saves.
- Reduced motion (`prefers-reduced-motion: reduce`): no slides, rises, pops or springs; every state change still happens.

## Driving it

1. `npm run build`.
2. Stills, 390 and 1280 (`DECIDE_WIDTHS`), light and dark, on a fresh seeded board it serves and stops itself: `.agents/skills/done-done-verify-sign-off/decide-shots.sh <folder>` writes decide, decide-signin (the npm sign-in), decide-item, decide-answered, decide-undo-toast and, on this build, decide-press, decide-swipe-right, decide-swipe-left, decide-menu, decide-item-more, decide-swiped-answer and decide-all-clear (`<state>.<theme>.<width>w.png`), at 1280 also decide-keys (the ? sheet) and decide-hover (a row's quick actions), and steps.json. Run the same script from a base checkout's build into before/: the shared names pair up.
3. Motion: seed a board (`d=$(mktemp -d); url=$(.agents/skills/done-done-verify-sign-off/seed-board.sh "$d" | tail -1)`), then `node .agents/skills/done-done-verify-sign-off/decide-record.mjs "$url" <light|dark> <out.mp4>` (its own headless Chromium; the first board read is held 1.2 s so the skeleton shows), or add `desk` for the desk by keys at 1280 (a pill names each key), then stop the board as SKILL.md says. `DECIDE_RECORD=1 decide-shots.sh` records both.
4. done-done: `done-done run decide` (in `.done-done.yaml`) runs the stills at 390 and 1280 and the recording into one run folder with its step record, for `done-done check` and the merge card.
5. Journeys: `npm run build && node --test --test-global-setup=./test/temp-folder.mjs --test-name-pattern='Decide on a phone|Decide on a desk|Waiting and Decide' test/design.test.mjs` drives a real finger swipe right (answer, Undo) and left (Later, kept across a reload, back), the push, the check and fold, Undo in place, More's sort and Select, and the plan row; on a desk, the list beside its ask, a sign-in laid out as an ask with no second countdown, a six-option ask whose bar stays under its last option, J and K, Enter, Cmd+Z, L, C with Cmd+Enter, a row's hover answer, the ? sheet, G then a letter, and the phone layout under 1024px.
6. Look at every still and at frames of each recording (for example `ffmpeg -i decide.light.390w.mp4 -vf fps=1.4,scale=260:-1,tile=9x4 -frames:v 1 sheet.png`).

## Gotchas

- A hash change alone keeps the page's old state; reload after changing the board through the API.
- Pointer events sent from the page (or a real CDP touch) drive the swipe; a single fast move counts as a fling.
- The push slides the page's content, not the dock, so the dock never leaves the screen mid-slide.
