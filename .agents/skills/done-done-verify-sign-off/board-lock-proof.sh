#!/usr/bin/env bash
# A board lock whose holder is gone is cleared by the next write (CLI only, screen: none): a report post on a board whose lock names a dead pid lands at once and leaves no lock,
# the same post on a lock naming a live process is refused BUSY and the lock is kept, then the lock journey test (dead owner, live owner, empty lock, eight concurrent raises);
# then the approved design-pick listing the merge gate demands, designs.after.dark.1440w.png.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../../.." && pwd)
d=$(mktemp -d)
# A mise shim fails under a throwaway HOME, so the real node runs the CLI.
node_bin=$([ -x /usr/bin/node ] && echo /usr/bin/node || command -v node)
cli() { HOME="$d" XDG_CONFIG_HOME="$d/c" XDG_DATA_HOME="$d/d" XDG_STATE_HOME="$d/s" "$node_bin" "$repo/dist/cli.js" "$@"; }
board="$d/board.json"; lock="$board.lock"
cli report init "$d/page" --page --purpose other > /dev/null
for f in index.html preview.svg; do sed -i -E "s/FILL: [^<\"']*/Umer taps through it/g" "$d/page/$f"; done
post() { (cd "$d" && cli post board.json --type report --purpose other --project Umer --title "$1" --about "Checks passed." --view page/index.html --preview page/preview.svg 2>&1); }
gone=$("$node_bin" -e 'process.stdout.write(String(require("child_process").spawnSync(process.execPath, ["-e", ""]).pid))')
{
  echo "\$ the board's lock names pid $gone, a process that has exited"
  echo "$gone" > "$lock"
  echo '$ sign-off-axi post --type report --title "Dead owner"'
  start=$(date +%s%N); rc=0; post "Dead owner" || rc=$?; ms=$(( ($(date +%s%N) - start) / 1000000 ))
  echo "exit code $rc, $ms ms"; [ "$rc" = 0 ] && [ "$ms" -lt 2500 ]
  test ! -e "$lock" && test ! -e "$lock.reclaim" && echo "no lock and no reclaim guard left behind"
  echo '$ the lock names a live process (sleep, started here)'
  sleep 20 & owner=$!
  echo "$owner" > "$lock"
  echo '$ sign-off-axi post --type report --title "Live owner"'
  rc=0; post "Live owner" || rc=$?
  echo "exit code $rc"; [ "$rc" = 1 ]
  [ "$(cat "$lock")" = "$owner" ] && echo "the lock still names the live owner"
  kill "$owner" 2>/dev/null || true; wait "$owner" 2>/dev/null || true
  rm -f "$lock"
  echo '$ sign-off-axi list'; cli list "$board" 2>&1
} > "$out/board-lock.log"
rm -rf -- "$d"
grep -q 'merged\|dead-owner' "$out/board-lock.log" && grep -q 'code: BUSY' "$out/board-lock.log" && grep -q 'the lock still names the live owner' "$out/board-lock.log"
(cd "$repo" && node --test --test-global-setup=./test/temp-folder.mjs --test-name-pattern="a lock left by" test/design.test.mjs) > "$out/board-lock-test.log" 2>&1 || { cat "$out/board-lock-test.log"; exit 1; }
node "$here/designs-shots.mjs" "$out" dark 1440
node -e '
const fs = require("fs"), out = process.argv[1], v = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).version;
fs.writeFileSync(out + "/steps.json", JSON.stringify({ target: { version: v }, start: "An isolated board whose lock file names a process that has exited", steps: [
  "Post a report to that board: it lands in under 2.5 seconds, exit code 0, and neither the lock nor its reclaim guard is left (board-lock.log).",
  "Point the lock at a running process and post again: the post is refused BUSY and the lock still names that process (board-lock.log).",
  "Run the lock journey test: dead owner, live owner, an empty lock and eight raises at once on a dead owner all behave as above (board-lock-test.log)."], result: "A board lock left by a process that is gone no longer blocks posts; a lock held by a running process still does (board-lock.log)." }, null, 2));
' "$out" "$repo/package.json"
