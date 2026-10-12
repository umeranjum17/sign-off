# Doctor and old boards

Covers `sign-off-axi doctor` failures and fixes, `init` repairing a cut-short setup, and 0.1.0 (`"schema": 1`) boards. CLI only: no page change, so no screenshot matrix. Work in a scratch folder with its own `HOME`, so the default board `~/.sign-off/decisions.json` is a scratch file.

| # | Step | Pass when |
|---|---|---|
| 1 | `doctor` on a folder with no `.sign-off/` | Exit 1; one `help:` line, `setup: ... Run \`sign-off-axi init <dir>\`` |
| 2 | `init`, then `doctor` | Exit 0; checks node, config, board, answers, rounds, gitignore, folders, port all ok |
| 3 | Break one at a time, run `doctor`, save all output as `doctor-broken.txt`: empty `config.yaml`; `port: abc`; `board: ../x.json`; `chmod 000 config.yaml`; board deleted; board emptied; board `{"schema": 2, "items": [`; board `{"schema": 3}`; `.gitignore` without `evidence/`; `.gitignore` and `evidence/` deleted; a torn line in `decisions.answers.jsonl`; port 4410 held by another program | Each run exits 1 and prints one `help:` line per failure that names the file and a concrete fix (init, delete, chmod, move away, add a line, or set `port:`); nothing else fails |
| 4 | Follow each printed fix, run `doctor` | Exit 0 |
| 4b | Set `port: 4477` in `config.yaml`, `open .sign-off/decisions.json`, run `doctor` | `open` prints port 4477; doctor's port check says the port shows this board and exits 0 |
| 5 | With `npx -y sign-off-axi@0.1.0` (scratch `HOME` and `npm_config_cache`): raise a yes/no and a pick-one question on the default board, `open`, answer both through `POST /api/answers` (one with a note), `stop`; save `answers --json` from 0.1.0 | `~/.sign-off/decisions.json` is `"schema": 1` |
| 6 | With this build: `list --full`, `answers --json`, then `post --type design` into the default board; save all output as `migration-0.1.0-board.txt` | `answers --json` is byte-identical to 0.1.0's before and after the post; the board is now `"schema": 2` with the old entries unchanged first; `decisions.json.schema-1.bak` equals the 0.1.0 file byte for byte |
| 7 | One more `raise`, compare the backup | The backup is unchanged (kept once) |
| 8 | `serve` the upgraded board and look at it in a real browser, phone 390px and desktop, light and dark | The old answered decisions and the new design item all show; no overlap or cut text |
