# Board actions

## Sub-features

- Every card kind (evidence, design, plan, signin, ask) on every tab (Today, Waiting, Decide, Designs, Evidence, Reports, Answered) offers its actions: open links, Discard with a reason, Select / pick / Discard N (Decide and Designs) or Dismiss N (Evidence, Reports, Answered) / Cancel / Clear all (Designs: More's Select and Discard all, Discard on the design's own page; Reports: a swipe right to mark unread, More's Mark all as read, Select and Archive all; Decide: More's sort, Answer all recommended, Move all to Later and Select; an ask's Ask me later, Write my own answer, Ask for another round and Discard), answer buttons, plan and design verdicts, and, under More in Add a comment, Send without answering / Ask for another round / Send as my own answer (Decide's one More holds Write my own answer and Ask for another round).
- Design cards whose `--tradeoff` ends `Open in first-draft: <label> <url> · …` (seed-board.sh's `look` card does) show one real link per option under the trade-off, outside the mock frames; prove on `#decide/look` at 390: the links open in a new tab and wrap without overflow.
- Decide holds only what waits on the reader, and the CLI counts the same: `list` waiting and the Decide tab agree. A design review (`post --kind design`) is in neither, only under Designs, until Main runs `promote <key>` (`designs-off-decide.sh` in SKILL.md). An expired sign-in link still waits on the reader until it is closed: it stays on the board, plainly Expired, and counts where it did. A guided plan (schema 2) with `decisions: []` is for reading: it shows under Reports (still opens, Go ahead and Go deeper work) and never in Decide; one with a decision waits in Decide. Prove it with a throwaway HOME: post two guided plans (`decisions: []` and one decision), `list` names only the second, the 390 Decide tab shows 1 and Reports shows the other. test/contract.test.mjs ("Decide holds only what waits") and test/design.test.mjs ("Decide on the page") drive it.
- A sign-in whose `--expires` time has passed stays where it waits, plainly Expired (no reload): Open off, its Unlocks and Where still readable with the copy button, its countdown stopped, and **Ask for a new link** on the card. The board is the source of truth (`expired` in state, the cached state rebuilt when a link lapses), so a page that never ticked reads expired on its next poll. Posting the same `--key` with a new link clears it and it waits again. Prove it with a throwaway HOME: `post --type signin --expires 3s`, then `signin-expiry-shots.mjs <folder> <light|dark> 390` in light and dark. test/design.test.mjs (the sign-in card test) drives it in a real browser.
- A page mock shows an Open live link under it, outside the frame, and it opens that option's own prototype (`/mock/<key>~<value>/<file>`), never the option's `--link`; prove on `#decide/look` at 390 in light and dark: each link is an anchor with `target=_blank rel=noopener`, sits below its mock, does not cover the Pick button, and its href names that option's value. A `--link` is drawn beside it as a Reference link, labelled as one. A non-http(s) `--link` is refused by `post`.
- CLI twin: `sign-off-axi dismiss <key>` / `restore <key>` write the same dismissed log; prove with a throwaway HOME: dismiss, `list --full` shows `dismissed`, restore, an unknown key exits 1. test/decisions.test.mjs covers it against a live board.
- A missing or disabled action fails the journey. Discard, Dismiss and answers are taken back with Undo; the irreversible ones (comment, round, reply, design verdict) run last.
- Every capture is measured by done-done's look code (squashed, clipped or cut-off text, overflow); `done-done look` also runs on each page. A hit fails the journey.

## Drive

`done-done run board-actions` (needs chrome-devtools-axi and Chrome). Or `node .agents/skills/done-done-verify-sign-off/board-actions.mjs <folder> [light|dark] [390|1280]` for one cell; no theme or width runs all four, about a minute each.
It seeds a fresh board per cell with seed-board.sh, so no new content. Shots are `<page>.<theme>.<width>w.png` in the folder; look records go to `<folder>-diagnostics`.
Look at every shot: no toast over content, nothing cut.

## Cleanup

The script stops its browser session and board server and deletes its scratch folder.
