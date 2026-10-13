# Summary home, area screens and Triage

Covers the top of the board in `web/index.html`: the Summary (four area tiles, Needs you first, Today, a short list per area), Triage inside Waiting on you (one ask at a time), the area screens in the URL hash (`#waiting`, `#evidence`, `#reports`, `#answered`) with `‹ Summary` on a phone and the sidebar at 60rem and wider, the full trade-off, evidence captures framed at their own shape, and recommended versus picked buttons. Follow Launch and Drive in `SKILL.md` first.

Each item lives in one area: an answered item in **Answered**; an evidence update in **Evidence**; an explainer, an item with nothing to answer, or any item on a read-only board in **Reports and explainers**; every other open ask in **Waiting on you**, oldest first. An open item with `"area"` set (see `docs/file-formats.md`) shows in that area instead.

Build an answers-only board (`post --from <file> --replace`) oldest first: an `interactive` page and an `interactive` page with `"area": "evidence"`, and a `diagram` with `"options": []`, two yes/no decisions, a three-option design with image mocks, three evidence updates (one with two portrait shots, one landscape), a two-option design with image mocks and `--recommend a`, a diagram ask with options `yes=Yes, build it` and `needs-work=Needs work`, and a yes/no decision. Answer the first two decisions and the three-option design through `POST /api/answers`. Widths: phone `390x844x3,mobile,touch`, desktop `1440x900x1`.

| # | Step | Pass when |
|---|---|---|
| 1 | Both widths, light and dark, wait `Needs you first`, full-page shots; also the round 3 measure tool (`shoot.mjs`) and `check-390.mjs` | `FIT` from `dashboard.md` is true; the tiles read `Waiting on you, 3`, `Evidence, 4` (three updates and the page with `area`), `Reports and explainers, 2`, `Answered, 3` (2x2 on the phone with the name under the icon, one row at desktop, each with its icon, count, a short count line such as `3 waiting` and `2 to read` that never ends in `…` at 390, and small picture); the measure tool reports clip, squash and overlap 0 on the Summary |
| 2 | Phone, top of the page | The first screen shows the date, `Summary`, all four tiles and the oldest ask in Needs you first with its two option pictures side by side and both `Pick` buttons |
| 3 | Answer the two-option design, reload | Needs you first now holds the diagram ask: `Yes, build it` (Recommended, first) and `Needs work` are the same width at both sizes; Today shows a mark per answer on its line of hours and lists them with their times; Answered counts 4 |
| 4 | Click `button "A: …, <title>"` in Needs you first, poll `answers --json`, then click Undo | The answer saves, the toast reads `Saved: …` with Undo, the Waiting tile drops by one; Undo saves an empty answer and the ask is back first |
| 5 | Click `link "Evidence, 4"`, then `link "‹ Summary"`, then a Summary row (`link "Update 2 · …"`) | The tile opens `#evidence` with `Evidence` focused at the top and the `area` page listed; back returns to the Summary; the row opens `#evidence` scrolled to Update 2. `#type=design` (an old link) shows the Summary |
| 6 | Desktop | The sidebar lists Summary and the four areas with counts, the current one marked; no `‹ Summary` link |
| 7 | `eval` on `.tradeoff`: `e.scrollHeight <= e.clientHeight + 1 && getComputedStyle(e).textOverflow !== 'ellipsis'` at 390 | true, and the shot shows every sentence of the trade-off |
| 8 | On `#evidence`, `eval` on every `.update-media img`: `Math.abs(i.clientWidth / i.clientHeight - i.naturalWidth / i.naturalHeight) < 0.02` | true: each frame is the shot's own shape; `link "Open Update 1, capture 1 of 1"` opens the full-size image in a new tab (`pages`) |
| 9 | Light and dark, before any pick: computed style of the recommended button (`button.rec`) and of an answered one (`[aria-pressed=true]`) | The recommended one has a solid accent border, a soft accent tint and a `★ Recommended` tag (its accessible description); the picked one is filled with the accent and starts with a check; the shots tell them apart at a glance |
| 10 | Phone, click `link "Waiting on you, 3"` | Triage: `1 of 3` with a progress bar, the oldest ask's question large, its answers stacked with the recommended one first, `Other answer`, `Skip for now`, an `Up next` card and the swipe hint |
| 11 | Click `Skip for now` three times | The ask moves to `2 of 3`, `3 of 3`, then back to `1 of 3` |
| 12 | On a yes/no ask press `1`, poll `answers --json`, then press `z` | The answer saves and Triage shows the next ask with the total one lower; `z` undoes it and the same ask is back |
| 13 | Swipe the card right on the diagram ask (touch drag over 90px), then left | Right saves the recommended answer; left skips; on a design ask right does nothing |
| 14 | Answer every waiting ask, open `#waiting` | `All caught up` with `Back to Summary` |
| 15 | Desktop `#waiting` | The queue lists every waiting ask beside the focused one, the current one marked; key hints show; clicking a queue row focuses that ask |
| 16 | Post a feed with `"area": "later"` | `post` fails with `area must be waiting or evidence or reports or answered` |
