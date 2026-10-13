# Answer events: filer, `wait --filer`, Seen by agent, `on_answer`, scoped feed

Covers `post`/`raise --filer` (and `SIGN_OFF_FILER`), `wait --filer` returning only that filer's answers once, the **Seen by agent** chip, the `on_answer:` config hook, and `post --from <file> --replace --filer <id>` keeping every other filer's items. Follow Launch and Drive in `SKILL.md` first. Work in a fresh scratch folder and delete it at the end.

Write `$SCR/ev/config.yaml`: `board: board.json`, `port: 0`, `on_answer: node hook.mjs` with `hook.mjs` appending its stdin to `hook.out`. Serve `$SCR/ev/board.json` after the posts below.

| # | Step | Pass when |
|---|---|---|
| 1 | `raise $SCR/ev/board.json --key a --title "Ship A?" --filer agent-a`; `raise ... --key b --title "Ship B?" --filer agent-b` | Each prints a `help` line `Run \`sign-off-axi wait <board> --filer <id>\``; `board.json` holds `filer` on each item; `curl <url>api/decisions` holds no `filer` |
| 2 | Start `wait $SCR/ev/board.json --filer agent-a --json` and `wait ... --filer agent-b --timeout 30` in the background; phone `390x844x3,mobile,touch`, click **Yes** on Ship A? | agent-a's wait prints `{"a":{"answer":"yes",...}}` and exits 0; agent-b's is still waiting; `hook.out` gains one JSON line with `"key":"a"`, `"filer":"agent-a"` |
| 3 | Reload; shot in light and dark | The Ship A? card shows **Seen by agent** at the right of its title, nothing overlaps or is cut at 390 px; Ship B? has no mark |
| 4 | `wait --filer agent-a --timeout 1` again | `NOT_FOUND`: nothing posted by agent-a is waiting (taken once) |
| 5 | A feed `{"schema":2,"items":[...]}` posted with `--replace --filer feeder`, then the same feed with one item fewer, then `{"schema":2,"items":[]}` | Items a and b, and all answers, stay through all three; only the feeder's items change; the board's top-level fields stay |

The integration tests (`npm test`, `test/design.test.mjs`: "answer events" and the end of "an answers-only board") cover the same paths without a browser.
