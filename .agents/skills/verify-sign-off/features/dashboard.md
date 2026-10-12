# Dashboard

Covers the one list in `web/index.html`: every item type on one page, newest first with waiting items on top, a type chip on each row, design items led by their mock cards, and the plain card for a type that has no view yet. Follow Launch and Drive in `SKILL.md` first, with a board from `init` in the scratch folder.

Build the board oldest first: `raise` a yes/no decision, `raise` a three-option decision, `raise --from` a file holding one `"type": "report"` item, `post --type design` with three options, mocks `a=mocks/a.html`, `b=mocks/b.html`, `c=mocks/c.png` (real layouts, not one heading), a long `--tradeoff` and `--recommend b`, then `post --type evidence` one update with a real screenshot as `--media`. Answer the three-option decision through `POST /api/answers`. `FIT` below is
`[...document.querySelectorAll('body *')].every(e => e.closest('.shot') || e.getBoundingClientRect().right <= innerWidth + 0.5) && document.documentElement.scrollWidth <= innerWidth`.

| # | Step | Pass when |
|---|---|---|
| 1 | Phone (the emulator; when the host has no emulator room, `390x844x3,mobile,touch`) and desktop `1440x900x1`, light and dark, wait `4 waiting`, full-page shots | `FIT` is true; header reads `Dashboard`; Waiting lists Update 1, design, report, decision in that order (newest first), Answered holds the three-option decision; each row has its type chip; the evidence row shows its capture and verdict buttons; the report row is a plain card with its buttons, no error |
| 2 | Same page, the design row | The three mock cards come right after the title and one trade-off line; each card has its own label, `Pick` button, and B the `Recommended` badge; previews are cropped to the same height with no blank band; the note and round controls are one closed `Note or another round` |
| 3 | Click the trade-off line | It opens to the full text, wrapped inside the screen |
| 4 | Click `link "Open mock A: … full size"`, then `pages` | A new tab holds `/api/mock?key=…&value=a`; close it and select the dashboard tab again |
| 5 | Phone dark: start `wait --key <design key>`, open `Note or another round, <title>`, fill the note box, click `Ask for another round, <title>` | `wait` exits 0 with the note in its `rounds`; the summary shows `1 round asked` |
| 6 | Click `button "B: …, <title>"`, poll `answers --json` for `"answer":"b"` | The pick and the note are saved; `answers-after-pick.json` |
| 7 | Reload phone dark and desktop light, shots | The design row moved to Answered above the older answer; B's button reads `Picked` with `[aria-pressed=true]` and its card has the accent border |
| 8 | Phone dark, click `button "Yes, <report title>"` and `button "Pass, <evidence title>"`, poll `answers --json`, reload, shot | One click each saves `yes` on the plain card and `pass` on the update; both rows move to Answered with their button pressed |

Take refs from a fresh `snapshot --full` right before each click; a ref from an earlier snapshot clicks nothing. The integration test (`npm test`) also covers: a `report` item loading through `raise --from` and served with its type, and a type that is not a lowercase word exiting 2.
