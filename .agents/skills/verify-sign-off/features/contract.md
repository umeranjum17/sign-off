# Contract validator

Covers `validate`, `post --kind` and the shipped `fixtures/contract/` messages ([docs/contract.md](../../../../docs/contract.md)). Follow Isolation in `SKILL.md` and the Fresh shell in [axi.md](axi.md) first; this entry runs the packed tarball the way another tool's CI does.

## Steps

| # | Step | Pass when |
|---|---|---|
| 1 | In `$SCR/ci`: `npm init -y`, `npm install --no-save $SCR/sign-off-axi-<version>.tgz` | `ask.v1/` and `report.v1/` under `node_modules/sign-off-axi/fixtures/contract/` each hold 2+ `valid-*` and 3+ `invalid-*` files |
| 2 | `npx sign-off-axi validate node_modules/sign-off-axi/fixtures/contract/*/valid-*.json` | One `files` row per file with `ok` true; exit 0 |
| 3 | `validate` each `invalid-*.json` alone | `ok` false, an error naming the field in the file name, one `help` line; exit 2 |
| 4 | A message with `"recommend_value"` twice; one with `"schema": 2`; `validate --kind gate` on a valid ask | Exit 2 with `Remove the second "recommend_value".`, `Upgrade sign-off-axi`, and `is ask, not --kind gate` |
| 4b | `raise board.json --from feed.json` where the feed's one item is the report fixture `valid-full.json`; `list board.json --json`; `list board.json`; then the same with `"options": []` added, and `raise board.json --title` of 161 characters | The first prints `so the user can read it` and no answer hint; the item has `options: []` and `waiting: 0 of 1`; the other two exit 2 with `post an ask to get an answer` and `title is 161 characters, over 160` |
| 5 | `validate` a valid file plus a missing path; then `validate` with no file | Exit 1 with the missing row `cannot read: ENOENT`; then exit 2 with `error:`, `code: VALIDATION_ERROR` and `help:` |
| 6 | `npx sign-off-axi validate --expect-invalid node_modules/sign-off-axi/fixtures/contract/*/invalid-*.json`; then the same plus one `valid-*.json` | Exit 0; then exit 2 with that file `ok` true and the help `make it break the one rule its name gives` |
| 7 | `post board.json --kind ask --from <valid ask> --filer agent-41`, the same again, then `cat` the report fixture into `post board.json --kind report --from -` | `raised`, then `already waiting`; the board item keeps `kind` and `filer`; the report prints `so the user can read it` |
| 8 | `post --kind` refusals: stdin with no `recommend_value`; a valid ask with `--kind report`; a new title under the same key; `"filer"` other than `--filer`; `--title` beside `--kind` | Each exits 2 with one `help` line, the error starts with `stdin:` or the file name, and the board file is unchanged; the key conflict says `Post it under a new key` |
| 9 | `raise board.json --from feed.json` whose one item is `{"key":"pick","title":"Pick?"}` (no `kind`); the same feed with `post --replace` | Both exit 2: `feed.json: items[0] key pick: kind is required on a new decision`, help `Add "contract": 1, "kind" and "schema"` |
