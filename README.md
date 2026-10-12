<p align="center">
  <img src="docs/logo.svg" width="72" height="72" alt="sign-off logo">
</p>

<h1 align="center">sign-off</h1>

<p align="center"><b>Answer your agents' yes/no and pick-one questions in one click, from a page on your own machine.</b></p>

<p align="center">
  <img src="docs/flow-ask.svg" width="240" alt="1. Agent asks: Keep the digest?">
  <img src="docs/flow-answer.svg" width="240" alt="2. You click Yes or No on the page.">
  <img src="docs/flow-receipt.svg" width="240" alt="3. Agent reads your saved answer: yes.">
</p>

<p align="center">
  <img src="docs/media/desktop-light-list.png" width="860" alt="Light desktop: a pick-one question with Today, Friday and Next week, two Yes/No questions, and the weekly digest answered Yes with a note">
</p>

## Why

Agents stop and ask: ship this, keep that, turn this on? Those questions scatter across terminals and chats, and an answer typed in the wrong place gets lost.

sign-off puts them on one calm list. The agent writes a small JSON file, you inspect the linked done-done run evidence, click **Yes** or **No** (or one of up to six choices the agent offers), and the answer is saved next to the file for the agent to read. Add an optional short note if the agent should know why; the note never blocks the click. It runs on your own machine (`127.0.0.1`, or one private address you name with `--bind`): no account, no hosting.

Your answer survives reloads and restarts; you can change it with one more click. Recommendations and silent defaults are shown, never applied for you.

## Quick start

### Agent skill (recommended)

Install the sign-off skill in the [Agent Skills](https://agentskills.io) format with [`npx skills`](https://github.com/vercel-labs/skills):

```sh
npx skills add umeranjum17/sign-off --skill sign-off-axi
```

That is the entire setup - no npm install needed.
The skill teaches your agent to run sign-off through `npx -y sign-off-axi`, so the CLI comes along on demand.
It stays a short stub and sends the agent to `npx -y sign-off-axi --help` for current instructions, so an installed copy cannot go stale against a newer CLI.
Its frontmatter also includes Hermes Agent metadata, so Hermes-compatible harnesses can categorize and surface it as a first-class productivity skill.

Then, in agents that expose skills as slash commands (Claude Code, for example), invoke it directly:

```
/sign-off-axi should we keep the weekly digest?
```

Or just ask in plain words - "ask me whether to keep the weekly digest and wait for my answer" - and the agent loads the skill on its own when it recognizes the task.

By default the skill lands in the current project's skills directory (`.claude/skills/`, for example); add `-g` to install it for all projects (`~/.claude/skills/`).

### Repo setup

In a project folder, `sign-off-axi init` writes `.sign-off/` (config, an empty
board, `mocks/` and `evidence/` folders, and a `.gitignore` keeping media and
answer files out of git) and `sign-off-axi doctor` checks it. Re-running `init`
keeps files that are already there. Mock files go under `.sign-off/mocks/` and
are named board-relative in `post` (for example `mocks/a.html`). The skill tells
the agent how to make them: 3 variants that differ in structure, a short
trade-off and one recommendation, posted, waited on and read back.

### Manual CLI

The skill is the recommended path, but you can also run the board by hand from this repository (Node 22.5 or newer):

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
sign-off itself calls no model and inherits the calling agent's model routing.

```
sign-off-axi                       list the decisions waiting on the user (same as list)
sign-off-axi raise --title "<question>" [--key <key>] [--about <text>] [--detail <text>]
                    [--option <value>=<label>]... [--recommend <value>] [--default <value>] [--close done|release]
sign-off-axi raise --from <decisions.json>      add every decision in a decisions file
sign-off-axi post --type design --title "<question>" [--option <value>=<label>]... [--mock <value>=<path>]...
                    [--tradeoff <text>] [--recommend <value>]   ask for a pick between mocks, shown side by side
                                                (--type decision is the same as raise; raise stays its alias)
sign-off-axi post --type evidence --title "<what this shows>" --about "<short note>" --media <file>... [--link <commit or URL>]
                                                post the next numbered evidence update for a pass/fail/needs-work verdict
sign-off-axi post --type diagram|interactive --title "<question>" --view <path> [--option <value>=<label>]...
                                                ask with a diagram image, or a sandboxed interactive .html page
sign-off-axi post --type explainer --title "<question>" --media <video> [--about <summary>] [--chapter <m:ss>=<title>]...
                                                ask with a narrated video the agent made with free local tools
sign-off-axi init [dir]                         write the repo setup under <dir>/.sign-off/ (config, board, mocks/ and evidence/ folders)
sign-off-axi doctor [dir]                       check that setup; every failure names its fix
sign-off-axi open  [--port 4410] [--bind <address>] [--evidence-root <dir>]   start the board in the background; prints its URL and pid
sign-off-axi status                             is the board open started for this file running? its URL and pid
sign-off-axi stop                               stop that board
sign-off-axi serve [--port 4410] [--bind <address>] [--evidence-root <dir>]   run the board in the foreground (--port 0 picks a free port)
sign-off-axi answers [--key <key>]              the latest answer per decision, and how many still wait
sign-off-axi wait [--key <key>] [--timeout 600]  block until the user answers, then print it like answers
sign-off-axi poll [--timeout 600]               block until the user comments or queues a prompt, then print each new one once
sign-off-axi export [--out <file.html>]          write a frozen read-only copy of the board as one HTML file
```

- The board is `~/.sign-off/decisions.json` unless you name a file right after the command (`sign-off-axi answers ./decisions.json`). Answers are saved next to it.
- `post --type design` asks for a pick between up to 6 mock options, each with an optional `--mock <value>=<path>` file (`.html`, `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`) shown beside its button, plus a `--tradeoff` line and a `--recommend` badge. Mock paths are relative to the board file's folder and never escape it. One `.html` page can hold every variant: `--mock a=mocks/<key>/index.html?variant=a` loads the page with `?variant=a`. `post --type decision` (the default) is exactly `raise`, and `raise` stays as its alias.
- `post --type evidence` posts the next numbered update (`update-1`, `update-2`, ...) with 1 to 12 screenshots or recordings (`.png`, `.jpg`, `.jpeg`, `.webp`, `.mp4`, `.webm`, up to 50 MB each), a short note and an optional commit or PR link. The files are copied into `evidence/<number>/` next to the board, so the board is the store: no hosted service. The page shows the updates newest first; each file is served only while its size and SHA-256 still match what was posted, and recordings play inline on a phone. The person gives a verdict, **Pass**, **Fail** or **Needs work**, with an optional note, read back with `answers` or `wait --key update-<number>`.
- `post --type diagram` and `post --type interactive` show a question with a picture: `--view <path>` names one board-relative file, an image (`.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`) drawn at card width for a diagram, or one self-contained `.html` page that runs in a sandboxed frame for interactive. Every mock and view is served under a Content-Security-Policy with no `fetch`, no remote files and no access to the dashboard or its tab. They answer like a decision.
- `post --type explainer` shows a question with a narrated video the agent made itself (stills plus speech from a free local engine such as piper or espeak-ng, joined with ffmpeg; the skill has the recipe). `--media` names one `.mp4` or `.webm`, copied into `evidence/<number>/` and served hash-checked like evidence media; it plays on the card with its own controls, at phone width too. `--about` is a short summary and each `--chapter m:ss=<title>` is a button that plays the video from there. sign-off itself never makes the video: it calls no speech engine, no ffmpeg and no network service.
- The person can also click **Ask for another round** (with a note), which wakes a waiting agent the same way an answer does; the agent reads it back in `answers --json` under `rounds`.
- The person can comment on any item (**Send as a comment**) and queue a free-text prompt for the agent (**Ask the agent**). `poll` blocks until one arrives and prints every new one once (`--json` prints `{"messages":[{"id","kind","key"?,"text","at"}]}`); the page then shows it as read by the agent. Typed notes that are not sent yet stay in the browser across reloads; everything sent is saved next to the board and survives a restart.
- The board runs on your own machine only: no hosted service, no recurring cost. It listens on `127.0.0.1` unless `--bind <address>` (or `bind:` in the `config.yaml` that `init` writes) names one private address of this machine, such as its VPN address, so a phone or tablet on your own network can open it. All interfaces and public addresses are refused. Beyond `127.0.0.1` the board makes an access token once (`decisions.token`, mode 600, next to the board), `open` prints it in the link, and every request without it is refused; the link sets a cookie, so the page and its media work after the first load. Delete the token file to shut old links out at once, then `stop` and `open` for a new one.
- `export` writes one self-contained HTML file (`decisions.export.html` by default): every item, answer and note with its local mocks and media inlined. It opens from disk with no server, is read-only, and makes no network request.
- With no `--option` a question is Yes/No; give 2 to 6 `--option` flags for a pick-one question (`--option friday=Friday --option next-week="Next week"`). `--recommend` and `--default` name one of its values.
- `list` and `answers` take `--full` for every field and `--json` for JSON (`answers --json` prints `{"<key>":{"answer","label","close","at"}}`, plus `"note"` when the user wrote one). `answers` adds a note column when any shown answer has a note.
- Raising a question that is already on the board is a no-op that reports its status, so an agent can re-run it safely. `--key` defaults to a slug of the title.
- `open` is a no-op when the same board is already open on the same address, and fails with `CONFLICT` when it runs on another one. `--evidence-root` is the folder holding `.done-done/`, for decisions that link run evidence.
- `wait` replaces a polling loop. With `--key` it returns at once if that decision is already answered, and waits for a key that is not raised yet; without it, it waits for the next answer to any decision still waiting and fails with `NOT_FOUND` when nothing is. It wakes on each save, gives up after `--timeout` seconds (600, ten minutes, by default) with code `TIMEOUT` and exit 1, and takes `--full` and `--json` like `answers`. Ctrl-C stops it without changing anything.
- `open` records the board's pid and port next to the board file (`decisions.board.pid`). `status` and `stop` read it and only act on a pid that really serves that board, so no one has to guess a pid to kill. `open` on a board already served by `serve` records that server, so `stop` can close it too.

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

Real demo questions, with one Yes and its note already saved. Desktop shots are cropped to the list, not redrawn.

**Desktop · dark**

<img src="docs/media/desktop-dark-list.png" width="860" alt="Dark desktop: the same question list, with the saved Yes highlighted in purple and the note shown under it">

**Phone · light and dark**

<p>
  <img src="docs/media/phone-light.png" width="300" alt="Decisions page on a phone in light mode">
  <img src="docs/media/phone-dark.png" width="300" alt="Decisions page on a phone in dark mode">
</p>

## Development

```sh
npm test                      # builds, then runs the integration journeys against the real CLI and server
npm run build:skill           # regenerates skills/sign-off-axi/SKILL.md from src/skill.ts (CI runs it with -- --check)
npm pack                      # builds the publishable sign-off-axi tarball
```

Browser proof lives in [`.agents/skills/verify-sign-off`](.agents/skills/verify-sign-off/SKILL.md).
