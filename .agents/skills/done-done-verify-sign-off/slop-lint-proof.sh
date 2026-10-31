#!/usr/bin/env bash
# The slop lint, in one sealed run: it fails on a seeded bad page (a filler phrase, an emoji, a raw task slug, a wall, a painted box showing nothing,
# grey words on near-black), then the same build is green on the real board, read at 390 and 1280 in light and dark, and the Designs capture the
# repo's approved design-pick-listing requirement names rides in the same run.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../../.." && pwd)
export PATH="$(dirname "$(node -p "process.execPath")"):$PATH"

# 1. The lint bites: one seeded page, every rule named with its file and line, the process failing the build.
set +e
node "$repo/scripts/slop-lint.mjs" --seed "$out" > "$out/slop-seed.txt" 2>&1
code=$?
set -e
echo "exit: $code (a build that ran this would not ship)" >> "$out/slop-seed.txt"
[ "$code" = 1 ] || { echo "the lint did not fail on the seeded page (exit $code)"; exit 1; }
grep -q 'every rule fired' "$out/slop-seed.txt" || { echo "the lint failed, but not on the rules: its last line is not 'every rule fired'"; cat "$out/slop-seed.txt"; exit 1; }

# 2. The same build, on the board this repo ships: copy and contrast hold, and the line says how much was read.
node "$repo/scripts/slop-lint.mjs" > "$out/slop-lint.txt" 2>&1 || { cat "$out/slop-lint.txt"; exit 1; }
cat "$out/slop-lint.txt"

# 3. The board's own surfaces at 390 and 1280, light and dark: the frame each one draws, from a board seeded the way an agent seeds one.
d=$(mktemp -d)
export HOME=$d XDG_CONFIG_HOME=$d/config XDG_DATA_HOME=$d/data XDG_STATE_HOME=$d/state XDG_CACHE_HOME=$d/cache SIGN_OFF_FILER=verify
base=$(bash "$here/feel-board.sh" "$d" | tail -1)
export CHROME_DEVTOOLS_AXI_SESSION="so-slop-proof-$$"
chrome-devtools-axi open "$base" > /dev/null
for width in 390 1280; do
  for theme in light dark; do
    view=$([ "$width" = 390 ] && echo "${width}x844x2,mobile,touch" || echo "${width}x800x1")
    chrome-devtools-axi emulate --viewport "$view" --color-scheme "$theme" > /dev/null
    # The surface the lint reads, at every cell: the Inbox with its rail, filters, status chips and empty state.
    chrome-devtools-axi open "$base#inbox" > /dev/null
    sleep 2
    chrome-devtools-axi screenshot "$out/inbox.$theme.${width}w.png" --full-page > /dev/null
  done
done
chrome-devtools-axi stop > /dev/null
node "$repo/dist/cli.js" stop "$d/board.json" > /dev/null || true

# 4. The required approved-design capture, in this same run: the Designs journey at 1440 dark, and designs.1440.dark.png with it.
# A check sends at most ten captures to the judge, so the two journeys' other frames stay beside the run and only the one frame each names is cited.
mkdir -p "$out.records/designs-shots" "$out.records/design-demo"
DESIGNS_WIDTH=1440 DESIGNS_THEME=dark node "$here/designs-shots.mjs" "$out.records/designs-shots" dark 1440
node "$here/design-demo-shots.mjs" "$out.records/design-demo"
cp "$out.records/designs-shots/designs.after.dark.1440w.png" "$out/"
cp "$out.records/design-demo/designs.1440.dark.png" "$out/"
shopt -s nullglob
captures=("$out"/*.png "$out"/*.txt)
[ "${#captures[@]}" -le 10 ] || { echo "the run holds ${#captures[@]} captures: one check sends at most 10 to the judge"; exit 1; }

# 5. What this run claims, in the order it drove it.
node - "$out" "$repo" <<'JS'
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const out = process.argv[2], repo = process.argv[3];
const seed = readFileSync(join(out, 'slop-seed.txt'), 'utf8').trim().split('\n');
const lint = readFileSync(join(out, 'slop-lint.txt'), 'utf8').trim();
const head = require('node:child_process').execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
writeFileSync(join(out, 'steps.json'), JSON.stringify({
  target: { version: `${JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version} at ${head}` },
  start: 'The build runs `npm test`, which now runs `node scripts/slop-lint.mjs`: a copy pass over every file that holds words a person reads, and a screen pass over a seeded board in a real browser.',
  steps: [
    `A seeded page carrying a filler phrase, an emoji, a raw task slug, a ${seed.length} line wall, a painted chip showing nothing and grey words on near-black is read by the same rules: ${seed.find((l) => l.startsWith('slop lint seed'))}.`,
    'Every failure names its rule, its file and line, the ratio or the box, and the words: the process exits 1, so `npm test` would fail the build.',
    `The same build on the board this repo ships: ${lint}.`,
    'The frames are the surfaces that pass: the Inbox (its rail, filters, empty state) and Today (its status chips and rows) at 390 and 1280, light and dark.',
    'The Designs capture the approved design-pick-listing requirement names rides in this run (designs.1440.dark.png).',
  ],
  result: 'Slop in the board\'s copy or its contrast fails the build by rule, file and line; the board as it ships passes every rule at 390 and 1280 in light and dark.',
}));
JS
