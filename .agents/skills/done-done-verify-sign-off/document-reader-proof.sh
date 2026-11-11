#!/usr/bin/env bash
# A document report's reader in one sealed run: the outline, folding sections, the answer first, search, and a long report past the guided limits, at 390 and 1280 in
# light and dark; then the approved design-pick listing the merge gate demands, designs.after.dark.1440w.png (and designs.1440.dark.png). The reader journey's own steps.json is restored last.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
for w in 390 1280; do
  for t in light dark; do
    node "$here/document-reader-shots.mjs" "$out" "$t" "$w"
  done
done
cp "$out/steps.json" "$out/steps.reader.json"
DESIGNS_WIDTH=1440 DESIGNS_THEME=dark node "$here/designs-shots.mjs" "$out" dark 1440
DESIGNS_WIDTH=1440 DESIGNS_THEME=dark DESIGN_DEMO_TITLE="Which reader layout reads best?" node "$here/design-demo-shots.mjs" "$out"
cp "$out/steps.reader.json" "$out/steps.json"
