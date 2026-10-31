#!/usr/bin/env bash
# The Tickets Story proof, in one sealed run: Tickets opening on the Story, the epic cards, a drill-down, All tickets behind its tab and a ticket page at 390 and 1280 in light and dark,
# then the Designs capture the repo's approved design-pick-listing requirement names (designs-shots' own frames, and the designs.1440.dark.png that design-demo-shots writes), so one run carries both.
# The Story's own steps.json is restored last, because the claim is about the Story and designs-shots and design-demo-shots each write a steps.json of their own.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
node "$here/tickets-story-shots.mjs" "$out"
cp "$out/steps.json" "$out/steps.story.json"
DESIGNS_WIDTH=1440 DESIGNS_THEME=dark node "$here/designs-shots.mjs" "$out" dark 1440
DESIGN_DEMO_TITLE="How should Tickets open?" node "$here/design-demo-shots.mjs" "$out"
cp "$out/steps.story.json" "$out/steps.json"
