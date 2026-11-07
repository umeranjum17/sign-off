#!/usr/bin/env bash
# The ticket links proof, in one sealed run: tickets-links-shots' nine frames, then the Designs capture the repo's approved design-pick-listing requirement names
# (designs.1440.dark.png, from designs-1440-dark.mjs), so one run carries both. The links' own steps.json is restored last, in case the capture writes one of its own.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
node "$here/tickets-links-shots.mjs" "$out"
cp "$out/steps.json" "$out/steps.links.json"
node "$here/designs-1440-dark.mjs" "$out"
cp "$out/steps.links.json" "$out/steps.json"
