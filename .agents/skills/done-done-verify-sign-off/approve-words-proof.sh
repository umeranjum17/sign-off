#!/usr/bin/env bash
# Approve words in one sealed run: a report that sets approve_result and approved_heading shows them under Approve and once approved, and one that
# sets none keeps "Starts the build." and "Build started", at 390 and 1280; then the required Designs capture at 1440, dark. This journey's steps.json is restored last.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
node "$here/approve-words-shots.mjs" "$out"
cp "$out/steps.json" "$out/steps.approve-words.json"
DESIGNS_WIDTH=1440 DESIGNS_THEME=dark node "$here/design-demo-shots.mjs" "$out"
cp "$out/steps.approve-words.json" "$out/steps.json"
