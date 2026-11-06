#!/usr/bin/env bash
# The question shape in one sealed run: the ask with its recommendation selected, Something else open, a guarded ask, and a plan's and a report's
# open question, at 390 and 1280 in light and dark, with the board files read before and after the page loads; then the approved design-pick
# listing the merge gate demands, designs.1440.dark.png. The question journey's own steps.json is restored last, because the claim is about it.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
for w in 390 1280; do
  for t in light dark; do
    node "$here/question-shape-shots.mjs" "$out" "$t" "$w"
  done
done
cp "$out/steps.json" "$out/steps.question.json"
DESIGNS_WIDTH=1440 DESIGNS_THEME=dark node "$here/design-demo-shots.mjs" "$out"
cp "$out/steps.question.json" "$out/steps.json"
