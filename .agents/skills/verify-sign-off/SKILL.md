---
name: verify-sign-off
description: Prove sign-off works in a real browser before a PR or ready report. Use for any change to src/, web/, skills/ or the README. Drives the real CLI and page with chrome-devtools-axi on phone and desktop, light and dark.
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

- Phone: `390x844x3,mobile,touch`. Narrow phone: `320x700x2,mobile,touch`. Desktop: `1440x900x1`. Viewport emulation is a quick look only; the phone bar is a real emulator (below).
- A reload is a fresh `open` of the same URL, then `emulate` again.
- Get a button ref from a fresh `snapshot --full`; buttons read like `button "Yes, <title>"`.
- Wait for a saved answer by polling `node dist/cli.js answers $SCR/d.json --json` until it prints the expected value (for example `"short-question":{"answer":"yes"`), with a time limit. Never accept a fixed sleep, and never wait on the always-present "Answered" or "Waiting" labels.
- Screenshots: `chrome-devtools-axi screenshot <evidence>/<name>.png --full-page`.
- Finish: `chrome-devtools-axi stop`, kill the server pid, delete `$SCR`.

### Android emulator (the phone bar)

A labeled real Chrome on an Android emulator, reaching the loopback server through `adb reverse`:

1. AVD under the scratch folder (`ANDROID_AVD_HOME=$SCR/avd`), image `system-images/android-36/google_apis_playstore/x86_64/` (it ships Chrome), `hw.lcd.width=1170`, `hw.lcd.height=2532`, `hw.lcd.density=480` so Chrome's viewport is 390 CSS px wide.
2. On a Firstmate host, start it through that host's memory gate (it waits while three emulators run; let it wait); elsewhere run the same `emulator` command directly:
   `ANDROID_AVD_HOME=$SCR/avd /home/umer/firstmate/config/fm-mem-gate.sh emulator -avd <name> -port 5610 -no-window -gpu swiftshader_indirect -memory 2048 -cores 2 -no-audio -no-boot-anim -no-snapshot-save &`
   Wait for `adb -s emulator-5610 shell getprop sys.boot_completed` to print `1`.
3. On a Firstmate host, run the whole journey as ONE call under the device lock: `/home/umer/firstmate/config/fm-device-lock.sh emulator-5610 <journey script>`. Inside it, every adb call names `-s emulator-5610`:
   - Skip Chrome's first run: `adb shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line'`, `adb shell am set-debug-app --persistent com.android.chrome`, then `am start -a android.intent.action.VIEW -d <url> com.android.chrome`.
   - `adb reverse tcp:<port> tcp:<port>` for the server port; the page opens at `http://127.0.0.1:<port>/`, so the loopback Host check holds.
   - `adb forward tcp:<devtools-port> localabstract:chrome_devtools_remote` and drive it with `CHROME_DEVTOOLS_AXI_BROWSER_URL=http://127.0.0.1:<devtools-port>`. Do not `emulate`: the device is the viewport.
   - Theme: `adb shell cmd uimode night yes|no`, then `open` again and check `matchMedia('(prefers-color-scheme: dark)')`.
   - Next to each page shot, keep a real device shot: `adb exec-out screencap -p > <name>-screen.png`. Name the files `emulator-*`.
4. Stop it right after: `adb -s emulator-5610 emu kill`, then delete the AVD.

If the emulator cannot boot, report the concrete blocker. Viewport emulation does not meet the phone bar.

Look at every shot before you report: nothing overlaps, no text is cut, no raw paths or ids, hostile titles show as literal text, the pressed answer is clear in both themes.

## Feature map

| Feature | Entry |
|---|---|
| Decisions page: list, one-click answer, durable answers | [features/decisions.md](features/decisions.md) |
| One-of-few options and the answer note, old-format compatibility | [features/options-note.md](features/options-note.md) |
| README media and rendered README | [features/readme.md](features/readme.md) |
| `sign-off-axi` commands, TOON/`--full`/`--json`, packed tarball via `npx -y` | [features/axi.md](features/axi.md) |
| Agent skill: `skills/sign-off-axi`, `npm run build:skill`, install with `npx skills add` | [features/skill.md](features/skill.md) |
