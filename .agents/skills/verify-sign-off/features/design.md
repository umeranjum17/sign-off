# Design item

Covers `sign-off-axi init`, `sign-off-axi doctor`, `sign-off-axi post --type design`, the A/B/C mock cards, and Ask for another round. Follow Launch and Drive in `SKILL.md` first, with a board from `init` in the scratch folder and three mock files under `.sign-off/mocks/` (two `.html`, one image).

| # | Step | Pass when |
|---|---|---|
| 1 | `doctor` output saved as `doctor.json` (TOON) | All four checks ok: node, board, gitignore, port |
| 2 | Phone light and dark, wait the design title, full-page shots | All three mock cards show beside their buttons, trade-off line and Recommended badge visible; `eval "document.documentElement.scrollWidth <= innerWidth"` is true |
| 3 | Desktop light and dark, shots | Same cards readable at width; no overlap, no cut text |
| 4 | Phone dark, type a note, click `Ask for another round`, shot | The row shows the round note; a blocked `wait --key` returns output containing that note |
| 5 | Phone dark, click the recommended mock's button, poll `answers --json` for the pick and the note | The saved pick and note appear within the time limit; `answers-after-pick.json` saved |
| 6 | Reload, shot | The picked button has `[aria-pressed=true]` under Answered with the note and round note intact |
| 7 | `answers --json` saved as `answers-final.json` | The key holds `answer`, `label`, `close`, `at`, `note`, and a `rounds` list with the round note |
