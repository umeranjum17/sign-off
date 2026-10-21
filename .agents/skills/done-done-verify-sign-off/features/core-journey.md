# Core journey

## Sub-features

- The core journey of sign-off, end to end on the real product: the agent files a card, the person answers it in the board, and the agent reads the answer. Only the installed npm package acts: the CLI files the card, serves the board and takes the answer; a real browser answers the card the way a person does.
- A clean home: the board, the config and the install live in a temp folder, so the user's own board (~/.sign-off) is never read or written. The server runs on a free port and is stopped with the CLI's own `stop` before the run ends.
- Filing: the agent posts the packaged plan (`post --kind plan --from <the installed package's fixture>`) as a card on the board; the board shows it as a plan the person can read.
- Answering in the board: the person opens the plan, picks the option the agent did not recommend and sends it on. The board shows "Sent. I am on it." and, until the agent has taken the answer, "Agent has not read it yet".
- The agent reads the answer: `wait --filer <the card's filer> --json --timeout 0` returns the answer once, and the board then shows "Agent read your answers <time>" on the card.
- The upgrade journey: the previous published version is installed from npm, this build is installed over it in place (`npm install <the packed tarball>`), and the same journey runs on the upgraded CLI. The versions before and after are in the transcript.
- Every capture is measured by done-done's look code (squashed, clipped or cut-off text, overflow); a hit fails the journey.

## Drive

`done-done run core` (needs chrome-devtools-axi and Chrome), or `node .agents/skills/done-done-verify-sign-off/core-journey.mjs <folder>` for one run outside done-done.
`done-done run upgrade` runs the same journey over the previous published version, upgraded in place; the script is the same with `--upgrade`.
The run writes `filed.png`, `picked.png`, `sent.png` and `agent-read.png` into the evidence folder, `core-journey.txt` (the CLI transcript) and `steps.json` (the step record); look records go to the sibling diagnostics folder.
Look at every shot: the plan the agent filed, the option the person picked, the plan as sent, and the read receipt.

## Cleanup

The script stops its own browser session and board server and deletes its scratch folder. Evidence survives cleanup: never delete the run folder.
