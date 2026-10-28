# Evidence media guard

Drive the post through the CLI with an isolated HOME and a throwaway board, not an internal function. The guard refuses a still that is not a picture of the product at post time: mostly text (a rendered log, receipt or summary), a colour-bar test card, or a placeholder card (one flat colour). A card whose picture is a colour-bar test card or a placeholder is also not shown on the board.

Refused: post each still with `--type evidence` and with `--kind evidence --from <message.json>`:

```sh
sign-off-axi post .sign-off/decisions.json --type evidence --title "Sync log" --about "Rendered log." --media fixtures/evidence/text-log.png
sign-off-axi post .sign-off/decisions.json --type evidence --title "Test card" --about "Note." --media fixtures/evidence/colour-bars.png
```

Verify the exit is 2 and the error names the fault: `is mostly text: a picture of a log, receipt or summary is not evidence`, `is a colour-bar test card, not evidence`. The help says to post a real capture of the running product. No `evidence/` folder or item is written.

Accepted: post a real capture of the running product, such as a screenshot of the board's Evidence area (or `fixtures/evidence/product-board.png`), and verify the exit is 0 and `update-<number>` is posted with its copy under `evidence/<number>/`.

Placeholder versus empty screen: `fixtures/evidence/placeholder-card.png` (one flat colour with a small label) is refused with `is a placeholder card, not evidence`; `fixtures/evidence/sparse-screen.png` (a real chat screen with header, message, composer and tab bar, 90% empty thread) is accepted.

Terminal applications: `sign-off-axi project <board.json> --name <product> --terminal-app` declares the board's product surface in `<board>.projects.jsonl`, readable with `project <board.json> --json`. On that board only the `text` still refusal is disabled; colour bars and placeholders remain refused. Without the declaration, text stills are refused and the message names this command. Prove with `node --test --test-global-setup=test/temp-folder.mjs test/evidence.test.mjs`, then on disposable live boards post a plain text still before and after declaration and inspect the CLI output and board media. Also post a real screenshot of a running terminal application and a plain log dump to the declared board.

Journey: `done-done run evidence-guard` (`evidence-guard-journey.mjs`) posts the sparse screen on a throwaway board, screenshots its Evidence card at 390 and 1280 and saves the placeholder refusal output.

Board: a card that already holds a colour-bar or placeholder picture (posted before the guard, so the board file holds it) does not appear on the Evidence page; the real cards around it still do.

Recording: a card that also holds an `.mp4` or `.webm` is never handed to ImageMagick when the board loads. Serve a board with a recording on it and read `/api/decisions`: it answers at once (within half a second) on the first read, while any stills are measured in the background, and no `convert` or `ffmpeg` process runs. The same holds for a still whose measurement hangs: `/api/board`, `/api/decisions`, `/api/media` and a POST all still answer, and the still stays unmeasured.

Keep the transcripts outside the repository.
