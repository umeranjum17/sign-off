# Ladder rungs: diagram and interactive items

Covers `post --type diagram` and `post --type interactive` (`--view <path>`), their rows on the dashboard, and the sandbox every mock and view file is served under. Follow Launch and Drive in `SKILL.md` first, with a board from `init` in the scratch folder.

Write two files under `.sign-off/mocks/<key>/`: a real SVG diagram (boxes, arrows and labels with dark strokes on a transparent background) and one `demo.html` page that has a working control (a button that changes text) and, on load, tries `fetch('https://example.com')`, `fetch('/api/decisions')`, an `<img src="https://example.com/x.png">` and `top.location = 'https://example.com'`, and prints each result on the page (`blocked` or `ALLOWED`). Post the diagram with no `--option`, the page with `--option yes=Yes --option needs-work="Needs work" --recommend yes`. `FIT` is the one in [dashboard.md](dashboard.md).

| # | Step | Pass when |
|---|---|---|
| 1 | Phone (the emulator; when the host has no emulator room, `390x844x3,mobile,touch`) and desktop `1440x900x1`, light and dark, wait the diagram title, full-page shots | `FIT` is true; the diagram fills the card width on a white panel and reads in dark mode; the interactive row shows the page in its frame; each row has its `DIAGRAM` or `INTERACTIVE` chip, an `Open full size` link and its answer buttons |
| 2 | Inside the frame, click the page's button (`eval` cannot reach into the sandbox: use a `snapshot --full` ref) | The page text changes: scripts run in the frame |
| 3 | Read the page's printed results, then `console` and `curl -s -D - -o /dev/null '<url>api/mock?key=<key>'` (the route answers GET only) | Every remote and `/api` attempt prints `blocked`; `console` names Content Security Policy or the sandbox as the blocker of each (`network` lists the image as `pending` with no response); the response carries `content-security-policy` with `connect-src 'none'` and `sandbox allow-scripts`; the dashboard is still on its own URL |
| 4 | Click `link "Open the diagram full size, <title>"`, then `pages` | A new tab holds `/api/mock?key=<key>` with the full-size drawing; close it and select the dashboard again |
| 5 | Phone dark, click `button "Needs work, <interactive title>"` with a note, poll `answers --json` | The answer and note are saved; the row moves to Answered with its button pressed |
| 6 | `post --type diagram --view mocks/<key>/missing.svg`, `--view ../x.svg`, `--type interactive --view <the .svg>` | Exit 1 `NOT_FOUND`, then exit 2 twice, each naming the fix |

A `--full-page` shot leaves a sandboxed frame below the first screen blank (the frame is loaded; the capture does not paint it). For that row, `eval` a `scrollIntoView()` on its `iframe` and take a viewport shot.

The integration test (`npm test`, `test/design.test.mjs`) also covers the post validation, the served content types and the sandbox header.
