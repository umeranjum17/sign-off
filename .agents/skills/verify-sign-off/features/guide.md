# Guided plan and report

## Sub-features

- Clean install: `npm pack` of the checkout, `npm install` in an empty folder, and only the installed `sign-off-axi` posts, serves and answers. No Firstmate, no repo checkout on the path.
- Authoring: `report init <folder>` and `report init <folder> --plan` write a report 3 / plan 2 to fill; posting one with its `FILL:` lines is refused. The skill (`skills/sign-off-axi/SKILL.md`) names the same commands the installed CLI lists.
- One scroll "Guide" view for a plan (`#waiting/<key>`) and a report (`#reports/<key>`): what this is, what I understood, what I found, what I recommend, what you decide, next step. A desk has the rail, Your answers and Go ahead; a phone has the progress bar and the sticky Go ahead bar.
- Numbers behind a Details tap, one visual per point (bars pair, steps or tiles), items that expand in place, each decision with My pick, Why my pick and If you stay quiet.
- Read receipts per part, real: a part on screen for a moment is saved on the board (`POST /api/reads`, `<board>.reads.jsonl`) and shows "Read by you" with the time; "Agent wrote this" shows the filed time; after Go ahead the agent's `wait` takes the answer and the receipt shows "Agent read your answers".
- Go deeper per part, real: the tap is an ask (`POST /api/deeper`, `<board>.deeper.jsonl`) the agent gets from `wait --filer` and answers with `deeper <board> --id <id> --text … [--more]`; the answer streams into that spot with "Agent answered" and a follow-up box.
- Go ahead sends the decisions as one structured answer (`answers --json`); the plan stays open and shows Sent.

## Drive

Build with `npm run build`. Run `node .agents/skills/verify-sign-off/guide-shots.mjs "$DONE_DONE_EVIDENCE_ROOT" light 390` and repeat for dark/390, light/1280 and dark/1280, each in its own output folder (9 shots per cell). The same through done-done: `GUIDE_THEME=dark GUIDE_WIDTH=1280 done-done run guide`.
The script does the install, authoring, posting and serving, then drives the browser through chrome-devtools-axi: plan top, a part read (receipt), Details open, Go deeper answered, the decision, Sent, the agent's read receipt, then the report top and a Go deeper on the report. Each capture asserts no overflow, no console error and no failed request, and writes its claim and DOM record to the sibling diagnostics folder.
Go deeper is answered by `deeper-agent.mjs`, which waits as an agent does (`wait --filer … --events`) and streams the answer with the installed `deeper` command. With `MINIMAX_API_KEY` in the environment (set per command, from the file the owner keeps, never printed or saved) a model writes it from the document; without it a plainly labelled stand-in answers, which still proves the streaming and the receipts. A stand-in run is not proof of a model-written answer.
Look at every capture: the answer in place under its part, no cut text under the sticky bar, receipts with times, My pick on the recommended option only.

## Cleanup

The script stops its own browser session and server and prints its scratch folder (an `so-guide-*` folder in the temp dir); remove that folder after the run. Keep output evidence outside the repo.
