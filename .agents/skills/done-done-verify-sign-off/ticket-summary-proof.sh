#!/usr/bin/env bash
# A new ticket needs a summary, and old ones get one (CLI only, screen: none): the ticket journey test refuses a new ticket with no --description and writes nothing,
# then ticket --backfill gives an old ticket its title and a second run changes nothing; then the approved design-pick listing the merge gate demands, designs.1440.dark.png.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../../.." && pwd)
d=$(mktemp -d)
# A mise shim fails under a throwaway HOME, so the real node runs the CLI.
node_bin=$([ -x /usr/bin/node ] && echo /usr/bin/node || command -v node)
cli() { HOME="$d" XDG_CONFIG_HOME="$d/c" XDG_DATA_HOME="$d/d" XDG_STATE_HOME="$d/s" "$node_bin" "$repo/dist/cli.js" "$@"; }
board="$d/board.json"
{
  echo '$ sign-off-axi ticket --id T-8 --title "No words yet"   (a new ticket, no --description)'
  rc=0; cli ticket "$board" --id T-8 --title "No words yet" 2>&1 || rc=$?
  echo "exit code $rc"; [ "$rc" = 2 ]
  test ! -e "$d/board.tickets.jsonl" && echo "no tickets file written"
  echo '$ an old ticket line with no description is on the board'
  printf '%s\n' '{"id":"T-old","title":"An old ticket","progress":10,"at":"2026-01-01T00:00:00.000Z"}' > "$d/board.tickets.jsonl"
  echo '$ sign-off-axi ticket --backfill'; cli ticket "$board" --backfill 2>&1
  echo '$ sign-off-axi ticket --id T-old --json'; cli ticket "$board" --id T-old --json 2>&1
  echo '$ sign-off-axi ticket --backfill   (again)'; cli ticket "$board" --backfill 2>&1
  echo '$ sign-off-axi ticket --id T-new --title "With words" --description "Ship it. # Ask - x"'; cli ticket "$board" --id T-new --title "With words" --description "Ship it. # Ask - x" 2>&1
} > "$out/ticket-summary.log"
rm -rf -- "$d"
grep -q 'backfilled: 1' "$out/ticket-summary.log" && grep -q 'backfilled: 0' "$out/ticket-summary.log" && grep -q 'needs --description' "$out/ticket-summary.log" && grep -q 'status: created' "$out/ticket-summary.log"
(cd "$repo" && node --test --test-global-setup=./test/temp-folder.mjs --test-name-pattern="a card names its ticket" test/design.test.mjs) > "$out/ticket-summary-test.log" 2>&1 || { cat "$out/ticket-summary-test.log"; exit 1; }
DESIGNS_WIDTH=1440 DESIGNS_THEME=dark node "$here/design-demo-shots.mjs" "$out"
node -e '
const fs = require("fs"), out = process.argv[1], v = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).version;
fs.writeFileSync(out + "/steps.json", JSON.stringify({ target: { version: v }, start: "An isolated board with no tickets, and one old ticket line that has no description", steps: [
  "Run the ticket journey test: sign-off-axi ticket --id T-8 --title with no --description exits 2 with a message that names --description, and no tickets file is written (ticket-summary.log).",
  "Run ticket --backfill: the old ticket now reads its title as its description, backfilled: 1; run again, backfilled: 0 (ticket-summary.log)."], result: "A new ticket with no summary is refused and an old one is given its title as the summary (ticket-summary.log)." }, null, 2));
' "$out" "$repo/package.json"
