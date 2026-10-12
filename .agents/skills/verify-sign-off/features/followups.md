# Stale locks, serve race, mock sibling files, `hosts:`, symlinked boards

Covers a lock left by a crash, two `serve` runs at once, the css and images beside a mock page, the `hosts:` line of `config.yaml`, a board reached through a symlink, and the test suite's temp-folder guard. Work in a fresh scratch folder under `/tmp` with its own `HOME`, and delete it at the end.

| # | Step | Pass when |
|---|---|---|
| 1 | `open` a board, `kill -9` the `open` while it holds `decisions.board.pid.lock` (or write a dead pid into `<board>.lock`); `raise` or `open` again; `doctor` | The command exits BUSY naming the lock a stopped sign-off-axi left behind and a `rm` fix; `doctor` exits 1 with a `locks` line and the same `rm` |
| 2 | Run the printed `rm`, then `doctor`, `open` | `doctor` says `locks: none left behind` and exits 0; `open` prints the URL |
| 3 | Leave a `<board>.board.pid` pointing at a slow stand-in server, start two `serve <board> --port 0` at once | Exactly one prints a URL; the other exits with `CONFLICT` |
| 4 | Post a design whose `.html` mocks link `style.css`, `img/dot.png` and a script beside them; open the board, phone `390x844x3,mobile,touch` and desktop `1440x900x1`, light and dark | Each mock card is styled and shows its image; `network` lists the siblings as 200 under `/mock/local/<key>~<value>/` |
| 5 | `curl` siblings with an encoded `..` to the board, the token file or a folder outside the mock's own; a `.json` beside the mock | Each is 404 |
| 6 | Set `bind: <private address>` and `hosts: <private DNS name>` in `config.yaml`; `doctor`; `open`; browse `http://<name>:<p>/?token=…` | `doctor` says the name resolves to the bind address; the page loads by name with its sibling files 200; `Host: evil.example` gets 403; a mock URL with the raw token or `local` gets 401 |
| 7 | `hosts: board.invalid`, then `hosts: bad_name!`; `doctor` | Exit 1 naming the name that does not resolve, then the name that is not a DNS name |
| 8 | Symlink `<other>/decisions.json` to the board, put `config.yaml` with another `port:` beside the link; `doctor`, `open`, `serve` on the link | All use the port from the config beside the link, not beside the target |
| 9 | `export`, open the file with the server stopped | Mock pages are inlined; their sibling files do not show (live-only, as the README says) |
| 10 | `npm test` | Passes; the run's temp folder is empty at the end, or teardown names what a test left behind |

The integration tests cover steps 1-3, 4-5 (by curl), 6-8 and 10. Steps 4, 6 and 9 need the browser matrix.
