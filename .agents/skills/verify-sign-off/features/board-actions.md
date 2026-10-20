# Board actions

## Sub-features

- Every card kind (evidence, design, plan, signin, ask) on every tab (Today, Waiting, Decide, Designs, Evidence, Reports, Answered) offers its actions: open links, Dismiss, Select / pick / Dismiss N / Cancel / Clear all, answer buttons, plan and design verdicts, comment / Another round / Send reply.
- Design cards whose `--tradeoff` ends `Open in first-draft: <label> <url> · …` (seed-board.sh's `look` card does) show one real link per option under the trade-off, outside the mock frames; prove on `#decide/look` at 390: the links open in a new tab and wrap without overflow.
- A sign-in whose `--expires` time has passed leaves Waiting on you and Decide by itself (no reload) and counts nowhere; posting the same `--key` with a new link brings it back open. Prove it with a throwaway HOME: `post --type signin --expires 3s`, wait 4 s, the Decide queue and the Sign-in chip no longer hold it. test/design.test.mjs (the sign-in card test) drives it in a real browser.
- Design options posted with `--link <value>=<url>` (seed-board.sh's `look` card has one per option) show an Open live link under that option's mock, outside the frame; prove on `#decide/look` at 390 in light and dark: each link is an anchor with `target=_blank rel=noopener`, sits below its mock and does not cover the Pick button. A non-http(s) `--link` is refused by `post`.
- CLI twin: `sign-off-axi dismiss <key>` / `restore <key>` write the same dismissed log; prove with a throwaway HOME: dismiss, `list --full` shows `dismissed`, restore, an unknown key exits 1. test/decisions.test.mjs covers it against a live board.
- A missing or disabled action fails the journey. Dismiss and answers are taken back with Undo; the irreversible ones (comment, round, reply, design verdict) run last.
- Every capture is measured by done-done's look code (squashed, clipped or cut-off text, overflow); `done-done look` also runs on each page. A hit fails the journey.

## Drive

`done-done run board-actions` (needs chrome-devtools-axi and Chrome). Or `node .agents/skills/verify-sign-off/board-actions.mjs <folder> [light|dark] [390|1280]` for one cell; no theme or width runs all four, about a minute each.
It seeds a fresh board per cell with seed-board.sh, so no new content. Shots are `<page>.<theme>.<width>w.png` in the folder; look records go to `<folder>-diagnostics`.
Look at every shot: no toast over content, nothing cut.

## Cleanup

The script stops its browser session and board server and deletes its scratch folder.
