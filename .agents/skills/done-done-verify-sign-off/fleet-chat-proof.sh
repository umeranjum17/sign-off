#!/usr/bin/env bash
# The Inbox chat proof in one sealed run: the Inbox as a conversation with everyone at 390 and 1280 in light and dark
# (the people rail, a one-to-one thread with its receipts, #fleet muted, a mention jump and a search result), then the
# approved design-pick listing the merge gate demands, designs.1440.dark.png, from the Designs capture at 1440 dark.
# The chat's own steps.json is restored last, because the claim is about the chat.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
for w in 390 1280; do
  for t in light dark; do
    node "$here/fleet-shots.mjs" "$out" "$t" "$w"
  done
done
cp "$out/steps.json" "$out/steps.chat.json"
DESIGNS_WIDTH=1440 DESIGNS_THEME=dark node "$here/design-demo-shots.mjs" "$out"
cp "$out/steps.chat.json" "$out/steps.json"
