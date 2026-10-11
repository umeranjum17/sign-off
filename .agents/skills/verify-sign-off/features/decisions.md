# Decisions page

Covers `sign-off serve`, `sign-off answers`, `web/index.html` and the answers file. Follow Launch and Drive in `SKILL.md` first.

| # | Step | Pass when |
|---|---|---|
| 1 | Phone light and dark, wait `5 waiting`, full-page shots | All five questions show; `eval "document.documentElement.scrollWidth <= innerWidth"` is true |
| 2 | Same page | `eval "window.__pwned === undefined && !document.querySelector('main img, main script')"` is true; the `<script>` and `<img>` titles show as text |
| 3 | Phone dark, click the first `Show more`, shot | The full 1,500-character text and the 300-character token wrap inside the screen; no horizontal scroll |
| 4 | Narrow phone light, `eval "() => { document.documentElement.style.fontSize = '130%'; return document.documentElement.scrollWidth <= innerWidth }"`, shot | true; header, titles and buttons wrap without cutting words badly or overlapping |
| 5 | Phone dark, click `button "Yes, Ship the new`, poll `answers` for `"short-question":{"answer":"yes"` | The saved answer appears within the time limit |
| 6 | Reload (open, emulate, wait `1 answered`), shots in dark and light | Exactly one `[aria-pressed=true]` button, the Yes of that question, under Answered |
| 7 | Kill the server, start it again on the same port (`--port <port>`), reload desktop light, shot | Still `1 answered` with Yes pressed; `answers` output saved as `answers-after-restart.json` |
| 8 | Desktop dark, click `button "No, Ship the new`, poll `answers` for `"answer":"no"`, reload, shot | Only `No` is pressed; `answers-after-change.json` holds `no`; the answers file has mode 600 |
| 9 | Write an invalid decisions file, reload, shot | A red banner names the file, item, key and field; no misleading empty state |
| 10 | Write `{"schema":1,"decisions":[]}`, reload, shot | "Nothing is waiting on you." |
| 11 | Restore the file, load, then remove one question from the file and click it without reloading | The row shows "Couldn't save: This question is no longer in the file" |

Extreme cases the integration test also covers (`npm test`): torn last line, a bad answer value (400), an unknown key (404), a foreign `Host` header (403), and answers surviving a server restart.
