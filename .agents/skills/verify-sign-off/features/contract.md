# Contract validator

Covers `validate` and the shipped `fixtures/contract/` messages ([docs/contract.md](../../../../docs/contract.md)). Follow Isolation in `SKILL.md` and the Fresh shell in [axi.md](axi.md) first; this entry runs the packed tarball the way another tool's CI does.

## Steps

| # | Step | Pass when |
|---|---|---|
| 1 | In `$SCR/ci`: `npm init -y`, `npm install --no-save $SCR/sign-off-axi-<version>.tgz` | `node_modules/sign-off-axi/fixtures/contract/ask.v1/` holds 2+ `valid-*` and 3+ `invalid-*` files |
| 2 | `npx sign-off-axi validate node_modules/sign-off-axi/fixtures/contract/*/valid-*.json` | One `files` row per file with `ok` true; exit 0 |
| 3 | `validate` each `invalid-*.json` alone | `ok` false, an error naming the field in the file name, one `help` line; exit 2 |
| 4 | A message with `"recommend_value"` twice; one with `"schema": 2`; `validate --kind gate` on a valid ask | Exit 2 with `Remove the second "recommend_value".`, `Upgrade sign-off-axi`, and `is ask, not --kind gate` |
| 5 | `validate` a valid file plus a missing path; then `validate` with no file | Exit 1 with the missing row `cannot read: ENOENT`; then exit 2 with `error:`, `code: VALIDATION_ERROR` and `help:` |
