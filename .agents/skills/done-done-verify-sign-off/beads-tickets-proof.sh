#!/usr/bin/env bash
# Tickets from Beads in one sealed run (CLI only, screen: none): the integration test drives the built CLI on isolated boards against a stand-in wrapper
# (list, create, update, an unreadable store); then the approved design-pick listing the merge gate demands, designs.1440.dark.png.
# This journey's steps.json is written after the Designs capture, because the claim is about it.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../../.." && pwd)
(cd "$repo" && node --test --test-global-setup=./test/temp-folder.mjs test/beads-tickets.test.mjs) > "$out/beads-tickets.log" 2>&1 || { cat "$out/beads-tickets.log"; exit 1; }
grep -q '^# fail 0\|^ℹ fail 0' "$out/beads-tickets.log"
DESIGNS_WIDTH=1440 DESIGNS_THEME=dark node "$here/design-demo-shots.mjs" "$out"
node -e '
const fs = require("fs"), out = process.argv[1], v = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).version;
fs.writeFileSync(out + "/steps.json", JSON.stringify({ target: { version: v }, start: "An isolated board given a stand-in Beads store of five rows through SIGN_OFF_BEADS_DIR and SIGN_OFF_BEADS_WRAPPER", steps: [
  "Run the integration test: with SIGN-OFF Beads variables set, ticket --json lists the rows of a stand-in Beads store with their hold reason, pull requests, parent, priority and project, and no tickets file is written (beads-tickets.log).",
  "A ticket write, a hold with its reason and its release reach the store through the wrapper as create and update; a hold without a reason is refused; an unreadable store shows no tickets and a warning (beads-tickets.log)."], result: "The tickets listed are the rows of the store, the writes are in the store, and no tickets file exists (beads-tickets.log: 4 tests pass)." }, null, 2));
' "$out" "$repo/package.json"
