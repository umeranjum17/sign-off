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
- Isolate every `sign-off-axi` run under `$SCR` as the README's [Test runs never touch your board](../../../README.md#test-runs-never-touch-your-board) says.
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
- Mock and view frames are sandboxed, so a `--full-page` shot leaves any frame below the first screen blank (it is loaded; the capture does not paint it). For those rows, `eval` a `scrollIntoView()` on the frame and take a viewport shot.
- Finish: `chrome-devtools-axi stop`, kill the server pid, delete `$SCR`.

### Android emulator (the phone bar)

A labeled real Chrome on an Android emulator, reaching the loopback server through `adb reverse`:

1. AVD under the scratch folder (`ANDROID_AVD_HOME=$SCR/avd`), image `system-images/android-36/google_apis_playstore/x86_64/` (it ships Chrome), `hw.lcd.width=1170`, `hw.lcd.height=2532`, `hw.lcd.density=480` so Chrome's viewport is 390 CSS px wide.
2. On a shared host, start the emulator through the host's emulator memory gate, if it has one (it may wait while other emulators run; let it wait); elsewhere drop `<mem-gate>` and run the `emulator` command directly:
   `ANDROID_AVD_HOME=$SCR/avd <mem-gate> emulator -avd <name> -port 5610 -no-window -gpu swiftshader_indirect -memory 2048 -cores 2 -no-audio -no-boot-anim -no-snapshot-save &`
   Wait for `adb -s emulator-5610 shell getprop sys.boot_completed` to print `1`.
3. On a shared host, run the whole journey as ONE call under the host's device lock, if it has one: `<device-lock> emulator-5610 <journey script>`. Inside it, every adb call names `-s emulator-5610`:
   - Skip Chrome's first run: `adb shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line'`, `adb shell am set-debug-app --persistent com.android.chrome`, then `am start -a android.intent.action.VIEW -d <url> com.android.chrome`.
   - `adb reverse tcp:<port> tcp:<port>` for the server port; the page opens at `http://127.0.0.1:<port>/`, so the loopback Host check holds.
   - `adb forward tcp:<devtools-port> localabstract:chrome_devtools_remote` and drive it with `CHROME_DEVTOOLS_AXI_BROWSER_URL=http://127.0.0.1:<devtools-port>`. Do not `emulate`: the device is the viewport.
   - Theme: `adb shell cmd uimode night yes|no`, then `open` again and check `matchMedia('(prefers-color-scheme: dark)')`.
   - Next to each page shot, keep a real device shot: `adb exec-out screencap -p > <name>-screen.png`. Name the files `emulator-*`. On the device `screenshot --full-page` repeats the first viewport down the image, so for the lower page `eval` a `scrollIntoView()` on the row and take another device shot.
   - The host may be slow with several emulators up: wait for the server's `url:` line with a time limit of a minute, not seconds.
4. Stop it right after: `adb -s emulator-5610 emu kill`, then delete the AVD.

If the emulator cannot boot, report the concrete blocker. Viewport emulation does not meet the phone bar.

Look at every shot before you report: nothing overlaps, no text is cut, no raw paths or ids, hostile titles show as literal text, the pressed answer is clear in both themes.
On every page you shoot, `eval` `SQUASH` from [features/dashboard.md](features/dashboard.md). It must return `[]`; any text it names is squashed, wrapped onto two lines, or overlapping another text box, and that fails the check at any width.

## Feature map

| Feature | Entry |
|---|---|
| Dashboard: every item type as a card on its area screen, pick on the mock card, plain card for new types | [features/dashboard.md](features/dashboard.md) |
| Summary home: four area tiles with counts, Triage in Waiting on you, the `area` field, report cards with `steps`, sections and Open/Close, Dismiss with Undo and Clear all done, Dismissed (N) with Restore, Answered as Done today rows, Needs you first (answer there, with Undo, its Dismiss and Triage footer), Today (the day's marks, then its newest answers first with `and N earlier` below), a short list per area, area screens with `‹ Summary` and the wide-screen sidebar, full trade-off, fitted evidence media, recommended vs picked | [features/summary.md](features/summary.md) |
| Decisions page: list, one-click answer, durable answers | [features/decisions.md](features/decisions.md) |
| Design item: init/doctor, A/B/C mock cards, `?variant=` pages, another-round asks, `raise` as `post --type decision` | [features/design.md](features/design.md) |
| Pointing at a mock: the bridge in each `.html` design mock, a tap named back as an element reference, turned on by the board | [features/pointing.md](features/pointing.md) |
| Comments on mock elements: Comment on the mocks, the editor and list with Edit and Delete, kept per mock file hash, a tap on a frame's edge that never opens the mock full size while commenting, the No mock placeholder, and comments sent to the agent with an answer or Another round, then locked | [features/annotation.md](features/annotation.md) |
| Ladder rungs: diagram item inline at card width, interactive item in a sandboxed frame with no network | [features/ladder.md](features/ladder.md) |
| Explainer rung: a narrated stills video built with free local speech, played inline with chapter buttons, no network | [features/explainer.md](features/explainer.md) |
| Evidence updates: numbered posts with media, hash-checked serving, inline video, verdict | [features/evidence.md](features/evidence.md) |
| One-of-few options and the answer note, old-format compatibility | [features/options-note.md](features/options-note.md) |
| `doctor` failures and fixes, `init` repair, 0.1.0 schema 1 board upgrade | [features/doctor.md](features/doctor.md) |
| Self-hosted reach: `--bind`/config bind with the access token, comments and queued prompts read by `poll`, restart, one-file `export` | [features/selfhost.md](features/selfhost.md) |
| Stale locks named by doctor, one `serve` per board, mock sibling files, `hosts:` names, config beside a symlinked board, the tests' temp-folder guard | [features/followups.md](features/followups.md) |
| Read-only board fed from files: `"readonly": true`, no answer controls, 403 on writes, `link` on any item, the page redrawing within 20 seconds of a rewrite, an interactive frame fitted to the height its page posts | [features/readonly.md](features/readonly.md) |
| Answers-only board fed through `post --from <file> --replace`: a bad item refused at write time, `reply` items (yes/no plus a short text reply, or text alone), `"options": []` items only shown, 403 on rounds, comments and prompts, an answer to a dropped item still saved | [features/answers-only.md](features/answers-only.md) |
| Quick answers: buttons first with the recommended one first and marked, typing folded behind **Other answer** on every ask, the card's one place to type (a reply saved as the answer `text`, a note for a pick, the **Another round** chip, a comment; a design's Picks too), one tap then a 5 s **Undo** saved as an answer change, `raise`/`post` refusing listed options with no `--recommend` | [features/quick-answers.md](features/quick-answers.md) |
| Answer events: `--filer` on post/raise, `wait --filer` returns only that filer's answers once, **Seen by agent** chip, `on_answer:` hook on stdin, `post --replace --filer` keeps other filers' items | [features/answer-events.md](features/answer-events.md) |
| Vault (OFF): a private expiry, refusal or delivery event reaches `wait --filer` once as metadata (`EXPIRED`, `REFUSED`, `DELIVERY_UNCERTAIN`, or `delivered` with exit 0), ordinary answers first, `wait --key --filer` replays its own item's, silent when the vault was never used; `wait --into` delivers a Give once into an owner-approved folder; a Receive link must match an owner-listed provider origin exactly | [features/vault.md](features/vault.md) |
| README media and rendered README | [features/readme.md](features/readme.md) |
| `sign-off-axi` commands, TOON/`--full`/`--json`, packed tarball via `npx -y`, the board a bare command picks | [features/axi.md](features/axi.md) |
| Contract: `validate` on message files, refusals with one fix line and exit 2, the shipped `fixtures/contract/` run from the package | [features/contract.md](features/contract.md) |
| Coding agents: `init --agent auto|<name>`, config `agent:`, one doctor line per agent, the same journey on several agents | [features/agents.md](features/agents.md) |
| Agent skill: `skills/sign-off-axi`, the A/B/C mock recipe, `npm run build:skill`, install with `npx skills add` | [features/skill.md](features/skill.md) |
| Release: `release.yml` publishes a new package.json version to npm on merge, skips one already on npm | [features/release.md](features/release.md) |
