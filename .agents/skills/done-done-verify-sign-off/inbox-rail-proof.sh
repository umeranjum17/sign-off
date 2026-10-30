#!/usr/bin/env bash
# The Inbox rail proof, in one sealed run: the rail at 390 and 1280 in light and dark, then the Designs capture the repo's
# approved design-pick-listing requirement names, so one run carries both. The rail's own steps.json is restored last,
# because the claim is about the rail and designs-shots and design-demo-shots each write a steps.json of their own
# (design-demo-shots is the one that writes designs.1440.dark.png).
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
for w in 390 1280; do
  for t in light dark; do
    RAIL_ONLY=1 node "$here/inbox-shots.mjs" "$out" "$t" "$w"
  done
done
cp "$out/steps.json" "$out/steps.rail.json"
DESIGNS_WIDTH=1440 DESIGNS_THEME=dark node "$here/designs-shots.mjs" "$out" dark 1440
DESIGN_DEMO_TITLE="Which Inbox rail reads best?" node "$here/design-demo-shots.mjs" "$out"
cp "$out/steps.rail.json" "$out/steps.json"
