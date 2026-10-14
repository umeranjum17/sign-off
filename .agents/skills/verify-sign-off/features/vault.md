# Vault (OFF): expiry and refusal reach `wait --filer` once

Vault admission is OFF: `post --type vault` and vault feed items are refused, and no card or route shows vault items. What this covers is the private expiry and refusal path an ordinary filer wait now reads. Records exist only through the built module (`dist/vault.js`), as `test/vault.test.mjs` creates them. Synthetic values only; never a real token, URL, `.npmrc` or board.

Work in a fresh scratch folder with its own `HOME`, `XDG_STATE_HOME` and `XDG_CONFIG_HOME`; delete it at the end.

| # | Step | Pass when |
|---|---|---|
| 1 | `wait $SCR/v/board.json --filer agent-a --timeout 0` before any vault state, also with `chmod 775 $HOME` | `NOT_FOUND`, empty stderr, no `$XDG_STATE_HOME` and no `.sign-off-vault-id` created |
| 2 | From the built module, `createVault` a Receive item for filer `agent-a` on that board, expiring in about 5 s; `serve` the board; start two `wait ... --filer agent-a --json` | Both keep waiting before the deadline; after it, exactly one prints `{"<key>":{"answer":"expired","label":"Vault item expired; request a fresh item.","close":"done","at":...}}` and exits 1; the other exits `NOT_FOUND` |
| 3 | `wait ... --filer agent-a` again, without `--json` | `NOT_FOUND`, no repeat; a TOON run on a fresh event shows `expired[1]{key,at}`, `error:` with the fixed sentence and `code: EXPIRED` |
| 4 | An answered ordinary item for `agent-a` beside an untaken expiry | The first wait returns the ordinary answer with exit 0; the next one returns `EXPIRED` |
| 5 | From the built module, `createVault` a Receive item for filer `agent-b` expiring in an hour, then `refuseVault` it; `wait ... --filer agent-b --timeout 0` twice | The first prints `refused[1]{key,at}`, `error: User refused this vault item; no value was delivered.` and `code: REFUSED`, exits 1 with empty stderr; the second is `NOT_FOUND` |
| 6 | Grep every output and every file under the scratch HOME for the synthetic value and URL | No match; the board folder files (board, answers, seen) hold no vault key or filer routing |

`npm test` (`test/vault.test.mjs`) covers the same journey plus the concurrent take, folder scope, an expiry and a refusal for one filer (`EXPIRED`, then `REFUSED` on the next wait), held lock (one warning, `TIMEOUT` instead of `NOT_FOUND`, ordinary answers not delayed), unsafe custody, malformed siblings and the all-or-nothing marker rollback.
