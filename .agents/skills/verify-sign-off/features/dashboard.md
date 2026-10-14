# Dashboard

Covers the cards in `web/index.html`: every item type in its area screen (see [summary.md](summary.md)), a type chip on each row, design items led by their options as tall phone frames, and the plain card for a type that has no view yet. Follow Launch and Drive in `SKILL.md` first, with a board from `init` in the scratch folder.

Build the board oldest first: `raise` a yes/no decision, `raise` a three-option decision, `raise --from` a file holding one `"type": "report"` item, `post --type design` with three options, mocks `a=mocks/a.html`, `b=mocks/b.html`, `c=mocks/c.png` (real layouts, not one heading), a long `--tradeoff` and `--recommend b`, then `post --type evidence` one update with a real screenshot as `--media`. Answer the three-option decision through `POST /api/answers`. `FIT` below is
`[...document.querySelectorAll('body *')].every(e => e.closest('.mocks') || e.getBoundingClientRect().right <= innerWidth + 0.5) && document.documentElement.scrollWidth <= innerWidth`. `SQUASH` below lists squashed text, any visible element holding more than 8 characters of its own text in a column narrower than 8 characters of its font; it must return `[]`:
`[...document.querySelectorAll('body *')].filter((e) => { const t = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(), w = e.getBoundingClientRect().width; return t.length > 8 && w > 0 && w < 8 * parseFloat(getComputedStyle(e).fontSize) * 0.5; }).map((e) => e.textContent.trim().slice(0, 40))`.

| # | Step | Pass when |
|---|---|---|
| 1 | Phone (the emulator; when the host has no emulator room, `390x844x3,mobile,touch`) and desktop `1440x900x1`, light and dark, wait `Needs you first`, then open `#waiting`, `#evidence` and `#answered`, full-page shots | `FIT` is true and `SQUASH` is `[]`; Waiting on you lists decision, report, design in that order (oldest first), Evidence holds Update 1, Answered holds the three-option decision; each row has its type chip; the evidence row shows its capture and verdict buttons; the report row is a plain card with its buttons, no error |
| 2 | Same page, the design row | The three options come right after the title and the trade-off text as tall phone frames of the same size, B first: each has its label (and B the `Recommended` badge) above its frame and its own `Pick` button below. On the phone a frame is about two-thirds of the screen high and the next one peeks in at the right edge; at desktop all three sit side by side with no scrollbar; the reply, note, comment and round controls are one closed `Other answer` |
| 3 | Read the trade-off line | It shows the full text, wrapped inside the screen, with no ellipsis and nothing to open |
| 4 | Click `link "Open mock A: … full size"`, then `pages` | A new tab holds `/mock/local/<key>~a/<file>`; close it and select the dashboard tab again |
| 5 | Phone dark: start `wait --key <design key>`, open `Other answer, <title>`, fill the box, click `Another round, <title>` | `wait` exits 0 with the note in its `rounds`; the summary shows `Other answer · 1 round asked` |
| 6 | Click `button "B: …, <title>"`, poll `answers --json` for `"answer":"b"` | The pick and the note are saved; `answers-after-pick.json` |
| 7 | Reload phone dark and desktop light, shots | The design row moved to Answered above the older answer; B's button reads `Picked` with `[aria-pressed=true]` and its card has the accent border |
| 8 | Phone dark, click `button "Yes, <report title>"` and `button "Pass, <evidence title>"`, poll `answers --json`, reload, shot | One click each saves `yes` on the plain card and `pass` on the update; both rows move to Answered with their button pressed |

Take refs from a fresh `snapshot --full` right before each click; a ref from an earlier snapshot clicks nothing. The integration test (`npm test`) also covers: a `report` item loading through `raise --from` and served with its type, and a type that is not a lowercase word exiting 2.
