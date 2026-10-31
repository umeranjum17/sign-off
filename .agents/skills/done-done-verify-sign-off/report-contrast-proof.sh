#!/usr/bin/env bash
# The report-contrast proof, in one sealed run: the voice report read in the board's theme at 390 and 1280 in dark and light,
# then the Designs captures the repo's approved design-pick-listing requirement names (designs-shots' own frames, and the
# designs.1440.dark.png that design-demo-shots writes), so one run carries both. The contrast check's own steps.json is restored
# last, because the claim is about a report's page and those two write a steps.json of their own.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
node "$here/report-contrast-shots.mjs" "$out"
cp "$out/steps.json" "$out/steps.contrast.json"
DESIGNS_WIDTH=1440 DESIGNS_THEME=dark node "$here/designs-shots.mjs" "$out" dark 1440
node "$here/design-demo-shots.mjs" "$out"
cp "$out/steps.contrast.json" "$out/steps.json"
