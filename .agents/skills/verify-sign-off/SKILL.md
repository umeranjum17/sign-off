---
name: verify-sign-off
description: Prove sign-off works in a real browser before a PR or ready report. Use for any change to src/, web/ or the README media. Drives the real CLI and page with chrome-devtools-axi on phone and desktop, light and dark.
metadata:
  internal: true
---

# verify-sign-off

Proof comes from the real CLI, the real server and a real browser. A build or a passing `npm test` is not proof.

## Isolation

- Work only in a scratch folder: `SCR=~/.cache/fm-scratch/<task-id>`. Copy fixtures into it; never serve a tracked fixture, because answers land next to the file.
- Use your own browser session and profile inside the scratch folder:
  `export CHROME_DEVTOOLS_AXI_SESSION=<task-id> CHROME_DEVTOOLS_AXI_USER_DATA_DIR=$SCR/profile`
- Evidence goes to a private folder outside the repo. Never commit proof media. Only the clean synthetic demo shots in `docs/media/` belong in git.
- Data is synthetic only (`fixtures/`). No real names, projects or secrets.

## Launch

1. `npm install && npm run build`
2. `cp fixtures/sample-decisions.json $SCR/d.json`
3. Start the server in the background and keep its pid:
   `node dist/cli.js serve $SCR/d.json --port 0 > $SCR/serve.log 2>&1 & echo $! > $SCR/srv.pid`
4. `$SCR/serve.log` prints `url: "http://127.0.0.1:<port>/"`. Wait for that line; do not sleep a fixed time.

The server reads `web/index.html` once at start. Restart it after any page edit.

## Doctor

- `serve.log` holds `url: "http://127.0.0.1:<port>/"`. Otherwise its `error:` line is the real error (exit 2 names the file, item, key and field).
- `curl -s <url>api/decisions` returns `{"decisions":[...],"answers":{...}}`.

## Drive

Load a page with all three steps, every time. `emulate` with only `--color-scheme` resets the viewport, so always pass both flags:

```
chrome-devtools-axi open <url>
chrome-devtools-axi emulate --viewport "<spec>" --color-scheme <light|dark>
chrome-devtools-axi wait "<text that only appears in the expected state>"
```

- Phone: `390x844x3,mobile,touch`. Narrow phone: `320x700x2,mobile,touch`. Desktop: `1440x900x1`.
- A reload is a fresh `open` of the same URL, then `emulate` again.
- Get a button ref from a fresh `snapshot --full`; buttons read like `button "Yes, <title>"`.
- Wait for a saved answer by polling `node dist/cli.js answers $SCR/d.json --json` until it prints the expected value (for example `"short-question":{"answer":"yes"`), with a time limit. Never accept a fixed sleep, and never wait on the always-present "Answered" or "Waiting" labels.
- Screenshots: `chrome-devtools-axi screenshot <evidence>/<name>.png --full-page`.
- Finish: `chrome-devtools-axi stop`, kill the server pid, delete `$SCR`.

Look at every shot before you report: nothing overlaps, no text is cut, no raw paths or ids, hostile titles show as literal text, the pressed answer is clear in both themes.

## Feature map

| Feature | Entry |
|---|---|
| Decisions page: list, one-click answer, durable answers | [features/decisions.md](features/decisions.md) |
| README media and rendered README | [features/readme.md](features/readme.md) |
| `sign-off-axi` commands, TOON/`--full`/`--json`, packed tarball via `npx -y` | [features/axi.md](features/axi.md) |
