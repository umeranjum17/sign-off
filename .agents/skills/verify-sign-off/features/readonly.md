# Read-only board fed from files

Covers a board file with `"readonly": true` that another program rewrites, `link` on any item, the page checking the file every 20 seconds, and an interactive frame fitted to the height its page posts. Follow Launch and Drive in `SKILL.md` first. Work in a fresh scratch folder under `/tmp` and delete it at the end.

Write `$SCR/fed/mocks/page/index.html`: a short page with two headed sections and two images in `img/` beside it, one wrapped in `<a href="img/<file>">`. Write the board with a small script that rewrites it whole (temp file, then `mv`): `{"schema": 2, "readonly": true, "items": [<interactive item, view mocks/page/index.html>, <two items of "type": "ask", each with "link": "https://example.com/...">]}`. Serve it with `--bind <private address>` (as in [selfhost.md](selfhost.md)) and open the token link. `FIT` is the one in [dashboard.md](dashboard.md).

| # | Step | Pass when |
|---|---|---|
| 1 | Phone `390x844x3,mobile,touch` and desktop `1440x900x1`, light and dark, wait `read only`; full-page shot, then `scrollIntoView()` on the frame and a viewport shot | `FIT` is true; the header reads `3 items · read only`; no glance, no **Ask the agent**, no Waiting/Answered headings; no answer, Pick, note or comment control anywhere; each ask shows its `ASK` chip and its link; the page frame is about 80% of the screen tall and its second section can be scrolled to inside it |
| 2 | Click `link "Open the interactive page full size, <title>"`, then the linked image | A new tab shows the page at full width; the image opens on its own, fitted to the screen |
| 3 | `curl -s -X POST -H 'content-type: application/json' -d '{"key":"<ask key>","answer":"yes"}' <url>api/answers` (with the cookie), the same for `api/rounds` and `api/messages` | Each is 403 `This board is read-only`; no `*.jsonl` file appears beside the board |
| 4 | Add `<script>new ResizeObserver(() => parent.postMessage({ height: document.documentElement.offsetHeight }, '*')).observe(document.documentElement)</script>` to the page, then fresh-load phone and desktop and `scrollIntoView()` on the frame | The frame ends just below the page's last line, with no blank area under it and no scroll inside it |
| 5 | With the page open, rewrite the board adding a third ask and dropping the first; change the page's first section and add a line to the interactive item's `about` | Within 20 seconds, with no reload, the new ask shows, the dropped one is gone and the frame shows the changed section |

The integration test (`npm test`, `test/design.test.mjs`) also covers the 403s, `link` on a non-evidence item, a rewritten file read on the next request, and, in headless Chrome, a frame sized by its page's posted height (each frame only its own, at most 10000px).
