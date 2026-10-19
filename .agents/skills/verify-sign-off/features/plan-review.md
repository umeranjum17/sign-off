# Plan review

## Sub-features

- Plan document icons on Today rows and cards, and no pointer-focus box on the reader title.
- Sandboxed direction page, plan summary, mobile Go to next navigation, section Approve/Change controls, required Change note, an optional comment on an approval, decision outcomes and recommendations with an Other free-text answer, and a whole-plan comment, step taps.
- Send back stays disabled until every part is answered; unsent browser drafts survive reload.
- Send back saves structured section notes, decision picks or Other words, and the whole-plan comment for `answers --json` and `wait --json`, removes the plan from Waiting and lists it in Answered.
- Sent answers open read-only; read-only/exported boards cannot send answers.

## Drive

Build with `npm run build`. Run `node .agents/skills/verify-sign-off/plan-shots.mjs "$DONE_DONE_EVIDENCE_ROOT" light 390`.
Repeat with dark/390, light/1280 and dark/1280, each in its own output folder (9 shots per cell, below the 10-capture judge limit).
The script posts a real two-section, one-decision plan through the CLI into a fresh throwaway HOME and drives its real browser controls through chrome-devtools-axi.
It captures home, plan on load, section approved with its comment, Change note, decision answered with Other words, the whole-plan comment, step 2, sent and Answered. The evidence folder holds only those screenshots; the per-shot claims, DOM and network records, answers.json, wait.json and list.txt go to a sibling diagnostics folder, printed when the run starts. By default it is `<evidence-root>/../<evidence-root-name>-diagnostics`, so the records that repeat between states by design never reach the check; `PLAN_REVIEW_DIAGNOSTICS` overrides that folder.
Light captures must be light. Inspect every capture before keeping it. Check each claim separately; the home does not prove a decision, and a sent screen does not prove the CLI payload.
For one concrete claim per screenshot, run `PLAN_REVIEW_STAGE=note PLAN_REVIEW_THEME=light PLAN_REVIEW_WIDTH=390 done-done verify plan-review --outcome "At 390px in light, Change has the note Keep the desktop layout too."`; repeat for each stage/theme/width. The driver still completes the entire real journey but emits only that stage's screenshot. Set `PLAN_REVIEW_TRACE=1` for a native browser performance recording of the interactions.
The diagnostics folder is outside the evidence folder by default, so all DOM/network assertions still run and their records plus CLI answers are kept, while the judge receives only the screenshots. Set `PLAN_REVIEW_DIAGNOSTICS` only to put them somewhere else. Do not submit a multi-stage visual outcome: the judge can conflate adjacent stages. Verify each screenshot with one stage-specific outcome.
The run API's selector wait and selector click can fail with `fn is not a function`; this driver uses plain-expression polling, real functions for page evaluation, and native snapshot refs for the initial pointer click and note input.

The existing Waiting type-filter integration journey in `test/design.test.mjs` also reviews a plan, checks an empty Change blocks sending, reloads an unsent draft, sends through the UI and checks the saved answer and disabled controls.
The plan CLI case in `test/contract.test.mjs` checks list counts and structured answers/events.

## Cleanup

The script stops only its own browser session and board process in `finally` and prints its scratch folder. Remove that folder's disposable files and empty directories after the run; keep output evidence outside the repo.
