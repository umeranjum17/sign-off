# Today

Replaced by the [Inbox](inbox.md): the board no longer draws Today. What follows is the record of the screen it replaced.

The board's first screen, in the new look as the approved prototype draws it (`signoff-restyle-board/proto/index.html`, the Today frames): built from `web/ui.css`'s parts.

## What it shows

- The title row: Today, and the round light-or-dark button at its right edge (a moon in light, a sun in dark). A tap switches the whole board to the other theme and keeps the pick in this browser; with no pick the board follows the system.
- Up next: the one ask that matters most (a sign-in, then an ask with a recommended answer, then one to review; Later last). Its label line reads `Up next · 1 of N` with the card's P0-P3 chip only when it has a priority; then the question (up to three lines), a line of its project first (the project's icon, or its initials, then its name; an ask takes the project of the proof it rests on) or else what it is, when it was filed and `Recommended <answer>`; then the main action in ink beside a white one:
  - an ask with a recommended answer: **Answer <answer>** (saves it: the button draws a check, the next ask rises in, Undo in the toast) and **Other answer** (opens the ask);
  - a sign-in: **Open sign-in** and **Details**, with the end time in the reader's own clock and the time left counting down; once the link is past, **Ask for a new link** in ink beside Details instead of Open;
  - a review or an ask with no pick: **Review** or **Answer**, alone.
  - nothing waiting: `Nothing waits on you`.
- Waiting on you: the next three asks after Up next as 68px rows (the project's own icon, else its initials, else the line drawing of what the ask is; the title on one line on a phone, up to two on a desk; the chip only where set; then project or kind and time, or, for a card on a ticket that is partly done, the ticket's bar and percent once it has progress, a full bar at 100%; none at 0%), with See all into Decide.
- Designs to review, whenever a design is in review or a draft: up to two of them as 68px rows (a thumbnail of the design's first screen, the title, its state and day), with See all into Designs; on a phone after Waiting on you, on a desk under it. One tap opens the design's review.
- Two tiles: **Cleared today** (answered today, of that and what still waits) opening Answered, and **Proofs today** (updates filed today) opening Evidence.
- Under the tiles, one quiet line naming what More holds opens it (a sheet from the bottom, in the middle on a desk): Answered and Designs with their counts, the Leash, Ask the agent, and last a Version row with the version the board runs (named on the line only when More holds nothing else; `version-shots.mjs`, journey `version`).
- Search: the dock's round button (the sidebar's on a desk; the address `#find` too) opens a sheet over the screen it is on, its field in hand; what is typed lists in groups (Asks, Proof, Reports, Answered, Designs, Tickets), four rows each, each opening where the card lives. Escape, the close button or a tap outside closes it.
- On a desk (1024px and wider): the title row across, then a 400px column of Up next and the tiles beside Waiting on you.

## How to drive and prove it

`node .agents/skills/done-done-verify-sign-off/today-shots.mjs <out> <light|dark|light,dark> <390|1280>` (journey `today`: `TODAY_THEME=light,dark TODAY_WIDTH=390 done-done run today`), after `npm run build`, with `TODAY_PROTO=<the approved prototype's index.html>` to save each state beside the prototype's (`vs-proto/<state>.after.<theme>.<width>w.pair.png`). It seeds `feel-board.sh`'s board in a throwaway HOME and XDG_*, adds a P0 and a P2 to two asks, puts two cards on tickets (60% and 100%), rests the ship ask on the settings proof, and gives the settings and Chat app projects their icons (`project --icon`), and drives a headless Chromium of its own over the DevTools protocol at 390x844 or 1280x800 (2x):

- at 390: `today-signin` (the sign-in up next), `today` (after `signin done`), `today-answered` (Answer tapped with a real touch; the answers file holds it), `theme` (the light-or-dark button tapped: the other theme, kept across a reload, then put back), `more` (from the line under the tiles), `search` ("settings" typed) and `today-end` (scrolled to the end);
- at 1280: `today` and `search` (the sidebar's Search clicked).

Each capture is measured in the browser (`measure.<side>.<theme>.<width>w.txt`, `<state>.*.measure.json`): every block on the gutter's two edges and the 4px grid, the title row's round button a 40px circle with its icon centred, 68px rows with 40px tiles and the title 12px after it (84px for a two-line title on a desk), the Up next buttons 44px, the dock, the last block at least 16px over the dock at the scroll end, no control under 44px on a phone, no file path, run id or internal code in the words on screen, no sideways overflow and no console error. `facts.json` holds what each part says. The run fails on any of these.

A recording of the flow: `node .agents/skills/done-done-verify-sign-off/decide-record.mjs <url> <light|dark> today-flow.<theme>.390w.mp4 today` on a `feel-board.sh` board (See all, the sign-in to Later, Answer and Undo, the light-or-dark button, More, Search, a row).

The regressions are `test/design.test.mjs` ("Today on a phone", and Today's assertions in "Spacious ask cards", "each card has one place to type", "listed under Designs only" and the Evidence journey).
