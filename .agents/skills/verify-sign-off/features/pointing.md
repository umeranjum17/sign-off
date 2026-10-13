# Pointing at a mock

Covers the pointing bridge the board adds to each `.html` design mock it serves (`web/point.js`). Follow Launch and Drive in `SKILL.md` first, with a design item whose option `a` has an `.html` mock holding an element with an id and, inside it, a field or button with its own `onfocus` and `onclick` that change its words.

| # | Step | Pass when |
|---|---|---|
| 1 | `curl` the mock's URL (`mockBase` from `/api/decisions`, then `<key>~a/<file>`), the css beside it and an interactive item's view; run `export` and read the mock's `data:` entry | The served mock ends with the bridge `<script>`; the css, the view and the exported mock are exactly as written |
| 2 | Desktop, `eval` on the board: keep every `message` with a `sign-off` field in `window.got`, then `point(document.querySelector('.mock iframe'), true)` (the board's function turns pointing on for that frame) | `got` gets `{ 'sign-off': 'ready' }` and the frame takes taps (`style.pointerEvents` is `auto`) |
| 3 | `click` the frame's `Open mock ... full size` link (its middle lands in the frame) twice, a fresh `snapshot` before each | Two `pointed` entries in `got`, each with `ref` `#<id> > ...:nth-of-type(<n>)`, `tag` and the same words: the mock's own handlers did not run; the board stays on its tab; `eval "pointed.get('<key>~a')"` gives the same `ref`, `tag` and `text` |
| 4 | `eval "point(document.querySelector('.mock iframe'), false)"`, then `eval "document.querySelector('.mock iframe').style.pointerEvents"` | The value is empty: the frame no longer takes taps, so the link opens the mock full size again |
| 5 | `eval "location.reload()"`, then repeat steps 2 and 3 | The same `ref`, `tag` and `text` come back |
