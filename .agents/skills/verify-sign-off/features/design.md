# Design item

Covers `sign-off-axi init`, `sign-off-axi doctor`, `sign-off-axi post --type design` (and `--type decision`, which `raise` is the alias of), the A/B/C options as tall phone frames (the recommended one first), and Ask for another round. Follow Launch and Drive in `SKILL.md` first, with a board from `init` in the scratch folder and three mock files under `.sign-off/mocks/` (two `.html`, one image).

| # | Step | Pass when |
|---|---|---|
| 1 | `doctor` output saved as `doctor.json` (TOON) | All checks ok and exit 0, with one line per agent ([agents.md](agents.md)); failure cases live in [doctor.md](doctor.md) |
| 2 | Phone light and dark, wait the design title, full-page shots | The recommended frame is first, its label and Recommended badge above it and its Pick button below; the frame is about two-thirds of the screen high and the next one peeks in; a finger swipe left over the frames snaps to the next option and the page itself does not scroll sideways; a tap on a frame opens that mock full size in a new tab; `eval "document.documentElement.scrollWidth <= innerWidth"` is true |
| 3 | Desktop light and dark, shots | All three frames side by side, the same size, no scrollbar under them; no overlap, no cut text |
| 4 | Phone dark, open `Note, comment or another round`, type a note, click `Ask for another round`, shot | The row shows the round note; a blocked `wait --key` returns output containing that note |
| 5 | Phone dark, click the recommended mock's `Pick` button, poll `answers --json` for the pick and the note | The saved pick and note appear within the time limit; `answers-after-pick.json` saved |
| 6 | Reload, shot | The picked button has `[aria-pressed=true]` under Answered with the note and round note intact |
| 7 | `answers --json` saved as `answers-final.json` | The key holds `answer`, `label`, `close`, `at`, `note`, and a `rounds` list with the round note |
| 8 | One page for all variants: write `mocks/<key>/index.html` that prints `location.search`'s `variant`, post with `--mock a=mocks/<key>/index.html?variant=a` (b, c alike), reload, shot | Each card's frame shows its own variant letter |
| 9 | `raise` against `post --type decision`: run the same raise cases with `dist/cli.js` from main and from the branch in fresh HOMEs and `diff` the output and board files | No difference |
