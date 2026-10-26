# First open

The board's cold first open sends only what the first screen shows, and reads the rest after it has painted.

- The first read is one page of asks (`/api/decisions?view=asks&limit=20`), and it carries the board's own lists (answers, dismissals, read marks) for the rows it names, never for the thousands of cards behind them. A row keeps what a list draws of it: the parts of a report, the numbers a guided page's picture shows, that it has an understood part and a next step — not the writing inside them, which the card that opens it brings.
- Everything else is read after the paint: `view=items` pages for the rest of the rows, `view=lists` for every answer and dismissal (Answered and Archived need the whole of them), `view=card&key=` for a card that opens, `view=tickets` for the Tickets screen. The app's own files (the service worker and install row, the tab's mark, the install manifest) are named in the page but asked for once the first screen has drawn.
- A page merges into the board on screen: a card it names with no answer lost one (a link posted again under the same key clears it), and a card it does not name keeps what an earlier read brought. A list read on its own replaces the list; a card or page that says nothing of a list leaves it alone.
- Gate at 390 px on Lighthouse's mobile profile (1.6 Mbps down, 150 ms RTT, 4x CPU), against a copy of the live board's size: under 100 KB before the board's own first paint, and a first paint no worse than before the change.

Drive: `node .agents/skills/done-done-verify-sign-off/first-open.mjs <url> <out folder> <tag> cold light|dark` (and `dark` for the other theme), once on a build of the base ref and once on this one. It prints one JSON line — bytes before the paint, the paint in ms, the whole open — and writes the per-request table (.json) and the first screen (.png) to look at. Byte counts repeat exactly; the paint time moves with the host's load, so compare it only against a run of the same minute.

Measured on a copy of a live board (3,398,935 B `board.json`, 1,600+ cards) at 390 px, cold, slow 4G: 114,344 B before paint in 7 requests before, 98,164 B in 5 requests after; the whole open 971,641 B before, 865,595 B after. The asks page itself went from 19.6 KB to 7.2 KB brotli.

Regressions: test/board-view.test.mjs (the first screen and the lists read are the contract: what a page carries for its rows, what the lists read carries on its own, and that a card comes whole), and test/design.test.mjs ("the board paints its first screen from one page of asks").
