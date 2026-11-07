#!/usr/bin/env bash
# The Done slice of the Inbox, in one sealed run: the Done gesture, the Done view and the thread an agent's reply brought back, at 390 and 1280
# in light and dark, then the Designs capture at 1440 dark and the approved design-pick listing the merge gate demands, designs.1440.dark.png
# (design-demo-shots is the one that writes it), so one run carries the slice and the listing. The Done states' own steps.json is restored
# last, because designs-shots, design-demo-shots and inbox-shots each write a steps.json of their own.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
for w in 390 1280; do
  for t in light dark; do
    DONE_ONLY=1 node "$here/inbox-shots.mjs" "$out" "$t" "$w"
  done
done
cp "$out/steps.json" "$out/steps.done.json"
DESIGNS_WIDTH=1440 DESIGNS_THEME=dark node "$here/designs-shots.mjs" "$out" dark 1440
DESIGN_DEMO_TITLE="Which Inbox Done view reads best?" node "$here/design-demo-shots.mjs" "$out"
cp "$out/steps.done.json" "$out/steps.json"
