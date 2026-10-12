---
name: sign-off-axi
description: "Ask the user yes/no, pick-one or A/B/C design questions on a local review board and read back their answers, using the sign-off-axi CLI. Use when you need a yes/no decision, a choice between a few options, a design pick between mocks, or approval from the user before going on, want the user to review or sign off on something, or need to read back the answers the user already gave."
license: MIT
metadata:
  author: umeranjum17
  argument-hint: <the question to ask>
  hermes:
    tags:
      - decisions
      - approval
      - review
      - yes-no
      - multiple-choice
      - design
      - mocks
      - human-in-the-loop
      - cli
    category: productivity
---

# sign-off-axi

sign-off-axi puts your questions on one local page (127.0.0.1) where the user answers each with one click, and saves the answers for you to read back.
Every question is an item: post it, wait, read the answer back.

## Current guidance lives in the CLI

Do not trust this file for commands, flags or output - installed copies go stale. Get the current source of truth from the CLI:

- `npx -y sign-off-axi --help` for commands, the board and examples
- `npx -y sign-off-axi <command> --help` for one command's flags

You do not need sign-off-axi installed globally - invoke it with `npx -y sign-off-axi`.
If sign-off-axi output shows a follow-up command starting with `sign-off-axi`, run it as `npx -y sign-off-axi ...` instead.
sign-off itself calls no model and inherits the calling agent's model routing.

## Design decisions: show A/B/C mocks, not words

When the user must choose how something looks or works, do this:

1. State the design question in one line.
2. Build exactly 3 variants that differ in structure: layout, hierarchy or affordance. Variants that differ only in colour do not count.
3. Put them under `.sign-off/mocks/<key>/` in the project (run `npx -y sign-off-axi init` once if `.sign-off/` is missing): 3 files (`a.html`, `b.html`, `c.html`, or screenshots), or one `index.html` that shows the variant named by `?variant=a`, `b` or `c`.
4. Write a short trade-off in plain words (5 lines or fewer: what each variant does well and badly) and recommend one.
5. Post it on the project board with `npx -y sign-off-axi post .sign-off/decisions.json --type design --key <key>`, one `--option` and one `--mock` per variant, `--tradeoff` and `--recommend` (see `post --help`). Mock paths are relative to `.sign-off/`: `--mock a=mocks/<key>/a.html`, or `--mock a=mocks/<key>/index.html?variant=a` for the one-page form. Then run `npx -y sign-off-axi open .sign-off/decisions.json` and give the user the URL.
6. Wait with `npx -y sign-off-axi wait .sign-off/decisions.json --key <key>`.
7. Read the answer with `npx -y sign-off-axi answers .sign-off/decisions.json --key <key> --json`. A pick holds `answer` and maybe a `note`. A `rounds` entry with no `answer`, or newer than the `answer`'s `at`, means the user wants another round: read its note, build 3 new variants and post them under a new key.
8. Build the winner into the real code, then delete `.sign-off/mocks/<key>/`.

Build mocks with a cheap model, for example Go Muse, haiku or luna. A mock is throwaway work.

## Show it when words are not enough

Use the simplest view that explains the item: plain text, then a diagram, then an interactive page.

- Diagram: draw an SVG (or save a PNG) under `.sign-off/mocks/<key>/`, then post with `--type diagram --view mocks/<key>/flow.svg`.
- Interactive page: write one self-contained `.html` file (inline CSS and JS, no network) under `.sign-off/mocks/<key>/`, then post with `--type interactive --view mocks/<key>/demo.html`. It runs sandboxed: no fetch, no remote files, no access to the dashboard.

Both answer like a decision (Yes/No, or your own `--option`s); wait and read the answer the same way.

## Request

$ARGUMENTS

If the line above holds a question, the user invoked this skill by name with it - fetch the current CLI guidance, then ask that question.
If it is empty or only a placeholder, infer the question from the conversation.
