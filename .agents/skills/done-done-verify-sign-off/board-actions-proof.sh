#!/bin/bash
# The board's actions journey as one sealed run: every card kind's actions are found and clicked at 390 and 1280 in light and dark, then the
# report's own Actions block in each of its states with both replays written as text, then the required Designs capture at 1440, dark.
# Usage: bash .agents/skills/done-done-verify-sign-off/board-actions-proof.sh "$DONE_DONE_EVIDENCE_ROOT"
set -euo pipefail
out=${1:?the evidence folder}
here=$(cd "$(dirname "$0")" && pwd)
node "$here/board-actions.mjs" "$out"
node "$here/report-actions-shots.mjs" "$out"
node "$here/designs-1440-dark.mjs" "$out"
