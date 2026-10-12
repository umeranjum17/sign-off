# Evidence updates

Covers `sign-off-axi post --type evidence`, the `evidence/<number>/` store, the media route `/api/media` (hash check, byte ranges), the Evidence updates section of the page, and the verdict read back through `answers` and `wait`. Follow Launch and Drive in `SKILL.md` first, with a board from `init` in the scratch folder.

Media: make two real screenshots and one short real recording in the scratch folder (for example, `screenshot` the empty board at phone and desktop width, and `ffmpeg -f lavfi -i testsrc=size=390x844:rate=10 -t 3 -pix_fmt yuv420p rec.mp4`). Never post private captures.

| # | Step | Pass when |
|---|---|---|
| 1 | `post --type evidence --title ... --about ... --media <shot>` then a second post with `--media <shot> --media <rec.mp4> --link https://...`; save both outputs | Outputs show `update-1` and `update-2`; `.sign-off/evidence/1/` and `evidence/2/` hold the copied files; a post with no `--media`, no `--about`, a missing file or a `javascript:` link exits 2 with the cause and leaves no new folder |
| 2 | Phone light and dark, wait `Update 2`, full-page shots | Evidence updates section shows Update 2 above Update 1; captures show inline; the link is clickable; `eval "document.documentElement.scrollWidth <= innerWidth"` is true |
| 3 | Phone, `eval` play on the `video` element, wait, then `eval "document.querySelector('video').currentTime > 0"` | true: the recording plays inline at phone width; `curl -r 0-9` on its URL returns `206` |
| 4 | Desktop light and dark, shots | Captures sit in a grid, verdict buttons below them; nothing overlaps or is cut |
| 5 | Phone dark, start `wait --key update-2 --json` in the background, type a note, click `button "Needs work, Sign-in`, shot | The wait returns `"answer":"needs-work"` with the note; `answers --json` saved as `answers-verdict.json` |
| 6 | Append one byte to `evidence/1/1.png`, reload, shot | Update 1 says the capture can't be shown (missing, changed or unplayable); `/api/media?key=update-1&i=0` answers 404 |
