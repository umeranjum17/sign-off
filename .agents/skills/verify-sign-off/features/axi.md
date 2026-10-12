# AXI command surface and npm package

Covers `sign-off-axi` with no command (list), `raise`, `answers`, `wait`, `open`, `status`, `stop`, `serve` and `--help`, the TOON, `--full` and `--json` tiers, and the packed tarball an agent runs with `npx -y`. Follow Isolation in `SKILL.md` first; this entry runs the packed tarball, not `dist/` from the repo.

## Fresh shell

```sh
npm install && npm pack --pack-destination "$SCR"      # prepack builds dist; prints sign-off-axi-<version>.tgz
NODE_DIR=$(dirname "$(mise which node 2>/dev/null || command -v node)")
FRESH=(env -i HOME="$SCR/home" PATH="$NODE_DIR:/usr/bin:/bin" TERM=xterm-256color npm_config_prefix="$SCR/prefix" npm_config_update_notifier=false)
```

Run every step as `"${FRESH[@]}" bash -c 'cd "$SCR" && npx -y ./sign-off-axi-<version>.tgz <args>'`, so nothing installed globally and none of your own HOME is visible. For the timed terminal recording, put the steps in one script and run it under `script -q --log-timing "$EVIDENCE/terminal.timing" "$EVIDENCE/terminal.log" -c '<the FRESH command>'`; replay with `scriptreplay -t terminal.timing terminal.log`. The script waits for the browser click with `wait --key <key> --timeout <seconds>`, never a fixed sleep or a polling loop.

## Steps

| # | Step | Pass when |
|---|---|---|
| 1 | No arguments | `bin:` names the npx copy, then `waiting: 0 of 0 decisions` and a `raise` hint; exit 0 |
| 2 | `--help`, then `raise --help` | Top-level usage, commands and examples; the raise help lists every flag |
| 3 | `raise --title "Umer: keep the weekly digest email?" --about "<text>" --recommend yes`, run it twice, then no arguments | `raised`, then `already waiting` with exit 0, then `waiting[1]{key,title}` naming the key |
| 4 | `open`, then `open` again, then `status` | `url`, `pid`, `opened` and a `stop` hint (no `kill`); then `already open (no-op)`; then `status: running` with the same pid |
| 5 | Start `wait --key <key>` in the recorded terminal; desktop light (`1440x900x1`): open the URL, wait for the title, shot; click `button "Yes, Umer: keep`; reload in dark, shot | `wait` prints `<key>,yes,<at>` and exits 0 within a second of the click; Yes is pressed in both themes |
| 5a | `wait --key <key>` again; then raise a second question and `wait --key <it> --timeout 3` | The first returns at once with the saved answer; the second exits 1 after about 3 s with `code: TIMEOUT` and a keep-waiting hint |
| 6 | `answers`, `answers --json`, `answers --full` | TOON row `<key>,yes,<at>` with `waiting: 0`; JSON `{"<key>":{"answer":"yes",...}}`; `--full` adds label, close and title |
| 7 | `list --stat`; `raise --title x --recommend maybe`; the step 3 title with no `--recommend` | Exit 2, 2 and 1, each with `error:`, `code:` and `help:` on stdout and no stack trace |
| 7a | `raise --from ./missing.json` | Exit 2; the error names the full resolved path, not just `missing.json` |
| 8 | `tar tzf` the tarball; `stop`, `status`, `stop` | Only `package.json`, `LICENSE`, `README.md`, `dist/` and `web/`; `status: stopped` with the step 4 pid, then `not running`, then `not running (no-op)` |

Extreme case `npm test` also covers: 20 agents raising at once keep all 20 decisions (the board takes a lock file while it writes), and `wait` returning within 1.5 s of an answer saved while it blocks.
