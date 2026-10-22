# Board actions

## Sub-features

- Every card kind (evidence, design, plan, signin, ask) on every tab (Today, Waiting, Decide, Designs, Evidence, Reports, Answered) offers its actions: open links, Dismiss, Select / pick / Dismiss N / Cancel / Clear all (Decide: More's sort, Answer all recommended, Move all to Later and Select; an ask's Skip for now, Ask me later, Dismiss and the other ways to send what Add a comment holds), answer buttons, plan and design verdicts, and, under More in Add a comment (on Decide, the page's one More), Send without answering / Ask for another round / Send as my own answer.
- Design cards whose `--tradeoff` ends `Open in first-draft: <label> <url> · …` (seed-board.sh's `look` card does) show one real link per option under the trade-off, outside the mock frames; prove on `#decide/look` at 390: the links open in a new tab and wrap without overflow.
- Decide holds only what waits on the reader, and the CLI counts the same: `list` waiting and the Decide tab agree. An expired sign-in link counts in neither. A guided plan (schema 2) with `decisions: []` is for reading: it shows under Reports (still opens, Go ahead and Go deeper work) and never in Decide; one with a decision waits in Decide. Prove it with a throwaway HOME: post two guided plans (`decisions: []` and one decision), `list` names only the second, the 390 Decide tab shows 1 and Reports shows the other. test/contract.test.mjs ("Decide holds only what waits") and test/design.test.mjs ("Decide on the page") drive it.
- A sign-in whose `--expires` time has passed leaves Waiting on you and Decide by itself (no reload) and counts nowhere; posting the same `--key` with a new link brings it back open. Prove it with a throwaway HOME: `post --type signin --expires 3s`, wait 4 s, the Decide queue and its Sign in group no longer hold it. test/design.test.mjs (the sign-in card test) drives it in a real browser.
- Design options posted with `--link <value>=<url>` (seed-board.sh's `look` card has one per option) show an Open live link under that option's mock, outside the frame; prove on `#decide/look` at 390 in light and dark: each link is an anchor with `target=_blank rel=noopener`, sits below its mock and does not cover the Pick button. A non-http(s) `--link` is refused by `post`.
- CLI twin: `sign-off-axi dismiss <key>` / `restore <key>` write the same dismissed log; prove with a throwaway HOME: dismiss, `list --full` shows `dismissed`, restore, an unknown key exits 1. test/decisions.test.mjs covers it against a live board.
- A missing or disabled action fails the journey. Dismiss and answers are taken back with Undo; the irreversible ones (comment, round, reply, design verdict) run last.
- Every capture is measured by done-done's look code (squashed, clipped or cut-off text, overflow); `done-done look` also runs on each page. A hit fails the journey.

## Drive

`done-done run board-actions` (needs chrome-devtools-axi and Chrome). Or `node .agents/skills/done-done-verify-sign-off/board-actions.mjs <folder> [light|dark] [390|1280]` for one cell; no theme or width runs all four, about a minute each.
It seeds a fresh board per cell with seed-board.sh, so no new content. Shots are `<page>.<theme>.<width>w.png` in the folder; look records go to `<folder>-diagnostics`.
Look at every shot: no toast over content, nothing cut.

## Cleanup

The script stops its browser session and board server and deletes its scratch folder.
