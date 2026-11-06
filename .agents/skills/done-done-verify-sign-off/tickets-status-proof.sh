#!/usr/bin/env bash
# The status and assignee proof, in one sealed run: tickets-status-shots' frames and changes.json, then the Designs capture the repo's approved design-pick-listing
# requirement names (designs.1440.dark.png, from designs-1440-dark.mjs). The status journey's own steps.json is restored last, in case the capture writes one of its own.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
node "$here/tickets-status-shots.mjs" "$out"
cp "$out/steps.json" "$out/steps.status.json"
node "$here/designs-1440-dark.mjs" "$out"
cp "$out/steps.status.json" "$out/steps.json"
