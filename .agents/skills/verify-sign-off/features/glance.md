# Glance, filters and card polish

Covers the top of the dashboard in `web/index.html`: the glance summary (how many items wait, a filter chip per type with its waiting count, and the oldest waiting items to jump to), the type filter kept in the URL hash, the full trade-off text, evidence captures framed at their own shape, and recommended versus picked buttons. Follow Launch and Drive in `SKILL.md` first, with a board from `init` in the scratch folder.

Build the board oldest first: `raise` a yes/no decision with `--recommend yes`, `post --type evidence` one update with a tall phone screenshot as `--media`, `post --type design` with three options and mocks (`a.html`, `b.html`, `c.png`), a `--tradeoff` of three or more sentences and `--recommend b`, `raise` a three-option decision with `--recommend`, `post --type evidence` one update with a landscape `rec.mp4` (`ffmpeg -f lavfi -i testsrc=size=1280x720:rate=10 -t 3 -pix_fmt yuv420p rec.mp4`), then `raise` one more yes/no decision and answer it with `yes` through `POST /api/answers`. Widths: phone `390x844x3,mobile,touch`, iPad `1024x1366x2,mobile,touch`, desktop `1280x800x1`.

| # | Step | Pass when |
|---|---|---|
| 1 | Every width, light and dark, wait `5 waiting on you`, full-page shots | `FIT` from `dashboard.md` is true; the glance shows `5 waiting on you`, chips `All 5`, `Decisions 2`, `Designs 1`, `Evidence 2` on one line at 390, and the five waiting titles oldest first (the first raised decision on top) |
| 2 | Phone, scroll to the top, `eval "document.querySelector('.waiting .row').getBoundingClientRect().top < innerHeight"` | true: the glance fits in one phone screen above the first card |
| 3 | `eval` on `.tradeoff`: `e.scrollHeight <= e.clientHeight + 1 && getComputedStyle(e).textOverflow !== 'ellipsis'` at 390 | true, and the shot shows every sentence of the trade-off |
| 4 | `eval` on every `.update-media img`: `Math.abs(i.clientWidth / i.clientHeight - i.naturalWidth / i.naturalHeight) < 0.02` | true: each frame is the shot's own shape, no black band; the video shows its controls; `link "Open Update 1, capture 1 of 1"` opens the full-size image in a new tab (`pages`) |
| 5 | Light and dark, before any pick: computed style of the recommended button (`button.rec`) and of the answered `Yes` (`[aria-pressed=true]`) | The recommended one has a dashed accent border, its own background and a `Recommended` tag (its accessible description, `snapshot --full` shows it); the picked one is filled with the accent and starts with a check; the shots tell them apart at a glance |
| 6 | Click `button "Designs, 1 waiting"` | `location.hash` is `#type=design`; only the design row is listed; the chip is pressed and keeps focus; shot `filter-design-<width>-<theme>.png` |
| 7 | Reload the same URL with `#type=design`, then click `button "All, 5 waiting"` | The filter survives the reload; All brings every row back. A type the board lacks (`#type=other`) still shows the chips, so All is one tap away |
| 8 | Click a title in the glance list | The page scrolls to that card with its title below the sticky header |
