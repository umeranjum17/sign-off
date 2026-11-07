#!/usr/bin/env bash
# A queued Beads ticket with a live blocker reads `waiting` and names the blocker in its Tickets row, at 390 and 1280 in light and dark, beside a ticket with no
# blocker and a held one; then the approved design-pick listing the merge gate demands, designs.1440.dark.png. This journey's own steps.json is written last.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../../.." && pwd)
for w in 390 1280; do for t in light dark; do node "$here/beads-waiting-row-shots.mjs" "$out" "$t" "$w"; done; done
DESIGNS_WIDTH=1440 DESIGNS_THEME=dark node "$here/design-demo-shots.mjs" "$out"
node -e '
const fs = require("fs"), out = process.argv[1], v = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).version;
fs.writeFileSync(out + "/steps.json", JSON.stringify({ target: { version: v }, start: "An isolated board given a stand-in Beads store: queued tickets with one live blocker, with two, with none, with only a closed one, and a held one", steps: [
  "Open All tickets at 390 and 1280, light and dark (waiting-row.<theme>.<width>.png and its .txt).",
  "Read the rows: a queued ticket with a live blocker says waiting and carries one chip naming the blocker (+1 for a second); a ticket with no live blocker still says queued and has no chip; a held ticket keeps its own words and no chip; nothing overflows (the .txt files)."], result: "A person scanning the Tickets list can see which tickets are stuck and what they wait on, in both themes at both widths." }, null, 2));
' "$out" "$repo/package.json"
