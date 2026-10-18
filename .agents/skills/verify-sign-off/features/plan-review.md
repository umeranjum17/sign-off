# Plan review

## Sub-features

- Plan document icons on Summary rows and cards, and no pointer-focus box on the reader title.
- Sandboxed direction page, section Approve/Change controls, required Change note, decision outcomes and recommendations, step taps.
- Send back stays disabled until every part is answered; unsent browser drafts survive reload.
- Send back saves structured section notes and decision picks for `answers --json` and `wait --json`, removes the plan from Waiting and lists it in Answered.
- Sent answers open read-only; read-only/exported boards cannot send answers.

## Drive

Build with `npm run build`. Run `node .agents/skills/verify-sign-off/plan-shots.mjs "$DONE_DONE_EVIDENCE_ROOT" light 390`.
Repeat with dark/390, light/1280 and dark/1280, each in its own output folder (8 shots per cell, below the 10-capture judge limit).
The script posts a real two-section, one-decision plan through the CLI into a fresh throwaway HOME and drives its real browser controls through chrome-devtools-axi.
It captures home, plan on load, section approved, Change note, decision picked, step 2, sent and Answered, and writes answers.json, wait.json, list.txt and per-shot claims and DOM records.
Light captures must be light. Inspect every capture before keeping it. Check each claim separately; the home does not prove a decision, and a sent screen does not prove the CLI payload.

The existing Waiting type-filter integration journey in `test/design.test.mjs` also reviews a plan, checks an empty Change blocks sending, reloads an unsent draft, sends through the UI and checks the saved answer and disabled controls.
The plan CLI case in `test/contract.test.mjs` checks list counts and structured answers/events.

## Cleanup

The script stops only its own browser session and board process in `finally` and prints its scratch folder. Remove that folder's disposable files and empty directories after the run; keep output evidence outside the repo.
