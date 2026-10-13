# Answers-only board fed through `post --replace`

Covers a board file with `"answers_only": true` that another program writes with `post --from <file> --replace`, items with `"reply": true` (yes/no plus a short text reply, or a text reply alone with `"options": []`), items with `"options": []` that are only shown, and an answer to an item the program dropped. Follow Launch and Drive in `SKILL.md` first. Work in a fresh scratch folder and delete it at the end.

Write `$SCR/fed/mocks/page/index.html` (a short page). Write `$SCR/fed/feed.json`: `{"schema": 2, "answers_only": true, "items": [<interactive item, view mocks/page/index.html, "options": []>, <"type": "ask", "title": "Say yes or no: ...", "reply": true>, <"type": "ask", "options": [], "reply": true>]}` and run `node dist/cli.js post $SCR/fed/board.json --from $SCR/fed/feed.json --replace`. Serve it with `--bind <private address>` (as in [selfhost.md](selfhost.md)) and open the token link. `FIT` is the one in [dashboard.md](dashboard.md).

| # | Step | Pass when |
|---|---|---|
| 1 | Add an item with `"options": [{"value": "only", "label": "Only"}]` to the feed and run the same `post --replace` | Exit 2, the error names `feed.json`, the item's index and key and `options`; `board.json` is byte for byte as before |
| 2 | Phone `390x844x3,mobile,touch`, light and dark, wait `2 waiting`; full-page shot | `FIT` is true; the header reads `2 waiting · 0 answered`, never `read only`; no glance, no **Ask the agent**, no `Another round` or `Send as a comment` button; the page item has no buttons; the yes/no ask shows **Yes** and **No**, then a folded **Other answer** (no text box open); the text ask shows a folded **Write a reply** only |
| 3 | Open **Write a reply** on the text ask, type a few words and click **Send reply**; open **Other answer** on the yes/no ask, type, and click **Yes**; shot in light and dark | The header reads `0 waiting · 2 answered`; each card shows `Your reply: <words>`; **Yes** is pressed. `board.answers.jsonl` beside the board (mode 600) gains `{"key":...,"answer":"text","note":"<words>"}` and `{"answer":"yes","note":...}` lines |
| 4 | `curl` POST `api/rounds`, `api/messages` (a prompt and a comment) with the cookie | Each is 403 `This board takes answers only` |
| 5 | Drop the yes/no ask from the feed, `post --replace`, then POST `{"key":"<dropped key>","answer":"text","note":"late"}` to `api/answers` | 200; the line is appended to `board.answers.jsonl`; within 20 seconds the open page drops that card with no reload |

The integration test (`npm test`, `test/design.test.mjs`) also covers the refused item, the unchanged board, the 403s, both reply kinds, the kept answer for a dropped item and the file mode.
