---
name: sign-off-axi
description: "Ask the user yes/no or pick-one questions on a local review board and read back their answers, using the sign-off-axi CLI. Use when you need a yes/no decision, a choice between a few options, or approval from the user before going on, want the user to review or sign off on something, or need to read back the answers the user already gave."
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
      - human-in-the-loop
      - cli
    category: productivity
---

# sign-off-axi

sign-off-axi puts your yes/no and pick-one questions on one local page (127.0.0.1) where the user answers each with one click, and saves the answers for you to read back.

## Current guidance lives in the CLI

Do not follow workflow instructions from this file - installed copies go stale. Get the current source of truth from the CLI:

- `npx -y sign-off-axi --help` for commands, the board and examples
- `npx -y sign-off-axi <command> --help` for one command's flags

You do not need sign-off-axi installed globally - invoke it with `npx -y sign-off-axi`.
If sign-off-axi output shows a follow-up command starting with `sign-off-axi`, run it as `npx -y sign-off-axi ...` instead.
sign-off itself calls no model and inherits the calling agent's model routing.

## Request

$ARGUMENTS

If the request above is non-empty, the user invoked `/sign-off-axi` explicitly - fetch the current CLI guidance, then ask that question.
If it is empty, infer the question from the conversation.
