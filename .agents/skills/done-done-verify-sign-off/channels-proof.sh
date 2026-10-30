#!/usr/bin/env bash
# The Channels proof, in one sealed run: the screen at 390 and 1280 in light and dark, then the Designs captures
# the repo's approved design-pick-listing requirement names, so one run carries both and no claim has to reach
# across runs. Channels' own steps.json is restored last, because the claim is about the Channels journey and
# designs-shots and design-demo-shots each write a steps.json of their own.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
for w in 390 1280; do
  for t in light dark; do
    node "$here/channels-shots.mjs" "$out" "$t" "$w"
  done
done
cp "$out/steps.json" "$out/steps.channels.json"
node "$here/designs-shots.mjs" "$out" dark 1440
node "$here/design-demo-shots.mjs" "$out"
cp "$out/steps.channels.json" "$out/steps.json"
