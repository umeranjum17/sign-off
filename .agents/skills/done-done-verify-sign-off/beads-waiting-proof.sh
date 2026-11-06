#!/usr/bin/env bash
# A held Beads ticket's sheet names the open ticket it waits on, at 390 and 1280 in light and dark; then the approved design-pick listing the merge
# gate demands, designs.1440.dark.png. This journey's own steps.json is written last, because the claim is about it.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../../.." && pwd)
for w in 390 1280; do for t in light dark; do node "$here/beads-waiting-shots.mjs" "$out" "$t" "$w"; done; done
(cd "$repo" && node --test --test-global-setup=./test/temp-folder.mjs test/beads-tickets.test.mjs) > "$out/beads-tickets.log" 2>&1 || { cat "$out/beads-tickets.log"; exit 1; }
DESIGNS_WIDTH=1440 DESIGNS_THEME=dark node "$here/design-demo-shots.mjs" "$out"
node -e '
const fs = require("fs"), out = process.argv[1], v = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).version;
fs.writeFileSync(out + "/steps.json", JSON.stringify({ target: { version: v }, start: "An isolated board given a stand-in Beads store: a held ticket with a reason, blocked by one open and one closed ticket", steps: [
  "Open the held ticket from Tickets at 390 and 1280, light and dark (waiting.<theme>.<width>.png and its .txt).",
  "Read its sheet: the Hold row gives the reason, a Waiting on row names only the open ticket, and nothing overflows (the .txt files).",
  "Run the integration test: a row reads blocked_by only for open tickets on its blocks edges (beads-tickets.log)."], result: "The sheet of a held ticket shows why it is held and which open ticket it waits on, at both widths in both themes." }, null, 2));
' "$out" "$repo/package.json"
