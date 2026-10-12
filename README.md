<p align="center">
  <img src="docs/logo.svg" width="72" height="72" alt="sign-off logo">
</p>

<h1 align="center">sign-off</h1>

<p align="center"><b>Answer your agents' yes/no questions in one click, from a page on your own machine.</b></p>

<p align="center">
  <img src="docs/flow-ask.svg" width="240" alt="1. Agent asks: Keep the digest?">
  <img src="docs/flow-answer.svg" width="240" alt="2. You click Yes or No on the page.">
  <img src="docs/flow-receipt.svg" width="240" alt="3. Agent reads your saved answer: yes.">
</p>

<p align="center">
  <img src="docs/media/desktop-light-list.png" width="860" alt="Light desktop: three waiting questions with recommendations and Yes/No buttons, and the weekly digest answered Yes">
</p>

## Why

Agents stop and ask: ship this, keep that, turn this on? Those questions scatter across terminals and chats, and an answer typed in the wrong place gets lost.

sign-off puts them on one calm list. The agent writes a small JSON file, you inspect the linked done-done run evidence, click **Yes** or **No**, and the answer is saved next to the file for the agent to read. It runs only on `127.0.0.1`: no account, no hosting.

Your answer survives reloads and restarts; you can change it with one more click. Recommendations and silent defaults are shown, never applied for you.

## Quick start

sign-off is not on npm yet. Run it from this repository (Node 22.5 or newer):

```sh
# 1. Build
git clone https://github.com/umeranjum17/sign-off && cd sign-off && npm install && npm run build

# 2. Open the page with the demo questions (copy them so the answers stay out of the repo)
cp fixtures/demo-decisions.json /tmp/decisions.json
node dist/cli.js serve /tmp/decisions.json       # prints http://127.0.0.1:4410/
# Optional: add --evidence-root /path/to/project-store to read proof records/media (the root containing .done-done/)

# 3. Click an answer, then read it back the way an agent would
node dist/cli.js answers /tmp/decisions.json     # answers[1]{key,answer,at}: weekly-digest,yes,...
```

## Commands

The CLI is `sign-off-axi`, an [AXI](https://axi.md): agents drive it from a shell with no setup. It prints compact [TOON](https://toonformat.dev) on stdout with next-step hints, and every command takes `--help`.

```
sign-off-axi                       list the decisions waiting on the user (same as list)
sign-off-axi raise --title "<question>" [--key <key>] [--about <text>] [--detail <text>]
                   [--recommend yes|no] [--default yes|no] [--close done|release]
sign-off-axi raise --from <decisions.json>      add every decision in a decisions file
sign-off-axi open  [--port 4410] [--evidence-root <dir>]   start the board in the background; prints its URL and pid
sign-off-axi serve [--port 4410] [--evidence-root <dir>]   run the board in the foreground (--port 0 picks a free port)
sign-off-axi answers [--key <key>]              the latest answer per decision, and how many still wait
```

- The board is `~/.sign-off/decisions.json` unless you name a file right after the command (`sign-off-axi answers ./decisions.json`). Answers are saved next to it.
- `list` and `answers` take `--full` for every field and `--json` for JSON (`answers --json` prints `{"<key>":{"answer","label","close","at"}}`).
- Raising a question that is already on the board is a no-op that reports its status, so an agent can re-run it safely. `--key` defaults to a slug of the title.
- `open` is a no-op when the same board is already open on that port. `--evidence-root` is the folder holding `.done-done/`, for decisions that link run evidence.

```
$ sign-off-axi raise --title "Keep the weekly digest?" --recommend yes
board: ~/.sign-off/decisions.json
raised[1]{key,status,title}:
  keep-the-weekly-digest,raised,Keep the weekly digest?
help[2]:
  Run `sign-off-axi open` so the user can answer
  Run `sign-off-axi answers --key keep-the-weekly-digest` to read the answer
```

Exit codes: `0` ok, including no-ops; `1` the request cannot be done (a key that already holds a different question, a busy port); `2` usage or input error (the message names the item, key and field). Errors print on stdout as `error:`, `code:` and `help:` lines.

Write your own questions using the [file-format reference](docs/file-formats.md).

## On your screen

Real demo questions, with one Yes already saved. Desktop shots are cropped to the list, not redrawn.

**Desktop · dark**

<img src="docs/media/desktop-dark-list.png" width="860" alt="Dark desktop: the same question list, with the saved Yes highlighted in purple">

**Phone · light and dark**

<p>
  <img src="docs/media/phone-light.png" width="300" alt="Decisions page on a phone in light mode">
  <img src="docs/media/phone-dark.png" width="300" alt="Decisions page on a phone in dark mode">
</p>

## Development

```sh
npm test    # builds, then runs the integration journeys against the real CLI and server
npm pack    # builds the publishable sign-off-axi tarball
```

Browser proof lives in [`.agents/skills/verify-sign-off`](.agents/skills/verify-sign-off/SKILL.md).
