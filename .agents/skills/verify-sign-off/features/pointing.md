# Pointing at a mock

Covers the pointing bridge the board adds to each `.html` design mock it serves (`web/point.js`). Follow Launch and Drive in `SKILL.md` first, with a design item whose option `a` has an `.html` mock holding an element with an id and, inside it, a field or button with its own `onfocus` and `onclick` that change its words.

| # | Step | Pass when |
|---|---|---|
| 1 | `curl` the mock's URL (`mockBase` from `/api/decisions`, then `<key>~a/<file>`), the css beside it and an interactive item's view; run `export` and read the mock's `data:` entry | The served mock ends with the bridge `<script>`; the css, the view and the exported mock are exactly as written |
| 2 | Desktop, `eval` on the board: keep every `message` with a `sign-off` field in `window.got`, set the frame's `style.pointerEvents = 'auto'`, then `src = src` to load it again | `got` gets `{ 'sign-off': 'ready' }` |
| 3 | Post `{ 'sign-off': 'point', on: true }` to the frame's `contentWindow`; `click` the frame's `Open mock ... full size` link (its middle lands in the frame) twice, a fresh `snapshot` before each | Two `pointed` entries, each with `ref` `#<id> > ...:nth-of-type(<n>)`, `tag` and the same words: the mock's own handlers did not run; the board stays on its tab |
| 4 | Post `{ 'sign-off': 'point', on: true, marks: [<that ref>] }`, viewport shot in light and dark; then `{ on: false, marks: [] }`, shot | The element has an accent outline with a `1` badge just above its top-left corner, hiding none of its words; off removes it |
| 5 | `eval "location.reload()"`, repeat steps 2 and 3 | The same `ref` comes back |
