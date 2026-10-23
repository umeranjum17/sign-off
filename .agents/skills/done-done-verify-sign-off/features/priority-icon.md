# Priority and project icons

Backend only: a card may carry `priority` (`P0` to `P3`), and a project may carry its own icon, a picture in the board file's folder pinned by its hash in `<board>.projects.jsonl`. Both are optional; the screens that draw the chip and the icon (or a monogram tile) belong to their own slices.

## Sub-features

- `--priority P0-P3` on `raise` and `post` (every `--type` and `--kind`); `"priority"` in a message or `--from` item. A value outside P0-P3, a message naming another priority than `--priority`, and `--replace` with `--priority` are refused, and nothing is written. A card without one has none.
- `project --name <name> --icon <path>`: the path is from the board file's folder; refused with nothing written when it has `..` or is absolute, its real path leads outside the folder (a symlink), it is not a file, it is over 500,000 bytes, its content is not the type its name gives, or it is an SVG with a script, `foreignObject` or event attribute. `--clear-icon` takes the icon away; `project` lists, `project --json` prints the records.
- The board: `/api/decisions` carries each card's `priority` and `projects`; `GET /api/project-icon?name=<name>` (any case) serves the pinned file with nosniff and the sandbox policy, and answers 404 for no icon, an unknown name, a skipped line or a file changed since it was set.

## Drive

`done-done run priority-icon`, or `bash .agents/skills/done-done-verify-sign-off/priority-icon.sh <folder>` after `npm run build`. It writes `priority-icon.txt` (every command with its output and exit code, the state and the icon's headers read back over HTTP, and a last line `priority-icon: PASS` or `FAIL`), `icon-served.png` (Chrome at 390 px on the journey's own labelled test page, which loads the icon from the running board's URL beside Nobody's 404 and the card priorities; chrome-devtools-axi keeps the real HOME so it finds its Chrome, and its `wait` is replaced by a sleep because it throws) and `steps.json`, the step record the judge reads. It runs the CLI and the board in their own temporary HOME and stops the board it served.
No screen draws the chip or the icon yet: the screen slices add those, and their journeys capture them.
test/contract.test.mjs ("a card carries a priority and a project its own icon") is the regression.
