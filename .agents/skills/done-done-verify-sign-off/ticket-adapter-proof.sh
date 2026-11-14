#!/usr/bin/env bash
# The ticket adapter interface v1 in one sealed run (CLI only, screen: none): the test file (the schemas against the worked examples, the document against both, the conformance script against the
# stand-in adapter and against copies that each break one rule), then the conformance script as a person runs it: against the stand-in (every check passes), against a copy that answers a failed read
# as an empty list and against one that answers a partial list as complete=false (each refused by name); then the approved design-pick listing the merge gate demands.
# This journey's steps.json is written after the Designs capture, because the claim is about the adapter.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../../.." && pwd)
d=$(mktemp -d)
conform() { mkdir "$d/$1"; TICKET_STANDIN_DIR="$d/$1" TICKET_STANDIN_BUG="${2:-}" node "$repo/test/ticket-adapter-conformance.mjs" "$repo/test/support/ticket-adapter-standin.mjs" --throwaway --faults "$repo/test/support/ticket-adapter-standin-faults.mjs"; }
(cd "$repo" && node --test --test-global-setup=./test/temp-folder.mjs test/ticket-adapter.test.mjs) > "$out/ticket-adapter.log" 2>&1 || { cat "$out/ticket-adapter.log"; exit 1; }
grep -q '^ℹ fail 0' "$out/ticket-adapter.log"
conform good > "$out/conformance.log"
grep -q '^# 18 passed, 0 failed, 0 not run' "$out/conformance.log"
rc=0; conform empty-list empty-on-failure > "$out/conformance-empty-list.log" || rc=$?
[ "$rc" = 1 ] && grep -q '^not ok 17 - failed read: list and get are errors, never an empty list' "$out/conformance-empty-list.log"
rc=0; conform incomplete complete-false > "$out/conformance-incomplete.log" || rc=$?
[ "$rc" = 1 ] && grep -q 'list answered complete=false, which is refused as incomplete' "$out/conformance-incomplete.log"
rm -rf -- "$d"
node "$here/designs-shots.mjs" "$out" dark 1440
node -e '
const fs = require("fs"), out = process.argv[1], v = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).version;
fs.writeFileSync(out + "/steps.json", JSON.stringify({ target: { version: v }, start: "A stand-in ticket adapter over an empty throwaway backend, and the conformance script that runs any adapter against the documented examples", steps: [
  "Run the test file: every schema accepts its worked example and refuses each invalid one, the document quotes the examples as they are and names no backend, status word or label convention (ticket-adapter.log).",
  "Run the conformance script against the stand-in with its faults driver: 18 checks pass, among them an unknown field surviving an update, a stale rev giving conflict, a failed read being an error and a partial list being the error incomplete (conformance.log).",
  "Run it against a copy that answers a failed read as an empty list: the failed-read check fails and the script exits 1 (conformance-empty-list.log).",
  "Run it against a copy that answers a partial list as complete=false: the script refuses it as incomplete and exits 1 (conformance-incomplete.log)."], result: "The schemas of the interface validate its examples, and its conformance script passes an adapter that keeps the rules and fails one that answers a failed read as an empty list or a partial list as complete=false (conformance.log, conformance-empty-list.log, conformance-incomplete.log)." }, null, 2));
' "$out" "$repo/package.json"
