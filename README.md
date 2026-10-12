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

sign-off puts them on one calm list. The agent writes a small JSON file, you inspect the linked done-done run evidence, click **Yes** or **No**, and the answer is saved next to the file for the agent to read. It runs only on `127.0.0.1`: no account, no hosting, no runtime dependencies.

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
node dist/cli.js answers /tmp/decisions.json     # {"weekly-digest":{"answer":"yes",...}}
```

## Commands

```
sign-off serve <decisions.json> [--port 4410]   show the page on 127.0.0.1 (--port 0 picks a free port)
sign-off answers <decisions.json>               print the latest answer per question as JSON
sign-off help
```

Exit codes: `0` ok, `2` usage or input error (the message names the item, key and field).

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
npm test    # builds, then runs the integration journey against the real CLI and server
```

Browser proof lives in [`.agents/skills/verify-sign-off`](.agents/skills/verify-sign-off/SKILL.md).
