#!/usr/bin/env bash
# Fills a new board with the approved feel prototype's Today, posted through the real CLI, then serves it: a sign-in with 12 minutes left,
# three asks with a recommended answer, a six-screen design to review, five updates (three passed, one with no run, one failed run) and two new reports.
# Nothing is answered, so Today reads 5 waiting and 0 cleared, as the mock does (data/signoff-feel-v2/shots/today.*).
# Usage, from the repo root after `npm run build`: feel-board.sh <empty folder>. Prints the board URL; stop it with node dist/cli.js stop <folder>/board.json.
# It sets HOME and XDG_* to that folder, so your own board (~/.sign-off) is never read or written.
set -euo pipefail
dir=$(cd "$1" && pwd) repo=$(pwd) board="$1/board.json"
export HOME=$dir XDG_CONFIG_HOME=$dir/.config XDG_DATA_HOME=$dir/.local/share XDG_STATE_HOME=$dir/.local/state XDG_CACHE_HOME=$dir/.cache SIGN_OFF_FILER=verify
so() { node "$repo/dist/cli.js" "$@" >/dev/null; }
f=$repo/fixtures/contract media=$repo/docs/media
mkdir -p "$dir/design" "$dir/page" "$dir/.done-done/runs"
printf 'board: board.json\nname: Umer\n' > "$dir/config.yaml"
cp "$media/phone-light.webp" "$dir/settings.webp"; cp "$media/phone-dark.webp" "$dir/settings-dark.webp"; cp "$media/phone-signin.webp" "$dir/account.webp"
cp "$media/phone-decide.webp" "$dir/code.webp"; cp "$media/phone-report.webp" "$dir/notes.webp"

# Decide lists newest first, so the oldest ask is posted first.
so post "$board" --ask-ref message-feel --key export --filer design-agent --title "What should the export button say?" --why "In the last test, people looked for “Download” twice as often as “Export”." \
  --option export=Export --option download=Download --option copy="Save a copy" --outcome export="The label stays as it is." --outcome download="The word people looked for." \
  --outcome copy="Longer, but says what happens." --recommend download --recommend-reason "The word people looked for." --default export
cp "$f/design.v1/design/welcome.png" "$dir/design/welcome.png"; cp "$f/design.v1/design/preview.png" "$dir/design/preview.png"
node -e '
const screens = ["Welcome", "Create account", "Enter the code", "Add a photo", "Chats", "First message"].map((title, i) => ({ id: `s${i + 1}`, title, views: { phone_light: "design/welcome.png" } }));
process.stdout.write(JSON.stringify({ contract: 1, kind: "design", schema: 1, key: "onboarding", title: "Chat app onboarding", filer: "design-agent", group: "Chat app", filed: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  about: "Six screens, from the first open to the first message. Approve each one, or say what should change.", status: "in_review", preview: "design/preview.png", journeys: [{ id: "onboarding", title: "Onboarding", screens }] }));
' > "$dir/design.json"
so post "$board" --kind design --from "$dir/design.json"
# The prototype's screen design is the one card per product that Main passed and promoted, so it waits in Decide.
so promote onboarding "$board" >/dev/null
so post "$board" --ask-ref message-feel --key digest --filer newsletter-agent --title "Keep the weekly digest?" --why "About a third of readers opened it in each of the last two months." \
  --outcome yes="It keeps going out each Monday." --outcome no="It stops after this week." --recommend yes --recommend-reason "Readers still open it." --default yes
so post "$board" --ask-ref message-feel --key ship --filer release-agent --title "When should the new settings page ship?" --why "No new bug reports in three weeks, and support is fully staffed on Friday." \
  --option today=Today --option friday=Friday --option next-week="Next week" --outcome today="It ships this afternoon." --outcome friday="It ships with support on hand." \
  --outcome next-week="It waits for the redesign." --recommend friday --recommend-reason "It ships with support on hand." --default next-week
so post "$board" --type signin --key npm --filer release-agent --service npm --link https://example.com/login --unlocks "Publishing the release" --waits "Release agent" --expires 12m

# Five updates, oldest first: a passed one, a failed run, one with no run, then two passed today.
proof() { # key title about shot project exit
  local run sha bytes
  run="2026102$((RANDOM % 10))T0$((RANDOM % 10))0000Z-$(printf '%08x' $((RANDOM * RANDOM)))"
  sha=$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$dir/$4")
  bytes=$(wc -c < "$dir/$4")
  printf '{"schema": 1, "run_id": "%s", "commit": "%040d", "tree": "%s", "dirty": false, "exit": %s, "files": [{"path": "%s", "sha256": "%s", "bytes": %s}]}\n' \
    "$run" 0 "$(printf 'a%.0s' {1..40})" "$6" "$4" "$sha" "$bytes" > "$dir/.done-done/runs/$run.json"
  node -e 'const [key, title, about, shot, project, run] = process.argv.slice(1); process.stdout.write(JSON.stringify({ contract: 1, kind: "evidence", schema: 1, key, title, filer: "verify", about, media: [shot],
    run: { run_id: run, commit: "0".repeat(40), outcome: title, repro: "repro: npm test", proof: `done-done-verify-${project}: npm test, phone, 390, passed`, evidence: shot } }));' "$1" "$2" "$3" "$4" "$5" "$run" > "$dir/$1.json"
  so post "$board" --kind evidence --from "$dir/$1.json"
}
proof ev5 "Release notes read well on a phone" "The notes wrap at phone width with no sideways scrolling." notes.webp release 0
proof ev4 "Code screen keeps the keypad in view" "On a small phone the keypad covers the last two code boxes." code.webp chat-app 1
so post "$board" --type evidence --title "Sign-in screen fits a phone" --about "The whole form shows without scrolling sideways." --media "$dir/account.webp"
proof ev2 "Dark mode keeps every label readable" "Every label on the page passes the contrast check in dark mode." settings-dark.webp settings 0
proof ev1 "Settings page loads in a second" "Umer opens the new settings page on a phone. It is ready in 0.8 seconds." settings.webp settings 0

# Two reports filed today, not read yet: the chart first, so the before-and-after one is the newest.
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cp "$f/report.v2/page/"* "$dir/page/"
sed -E -e "s/\"filed\": *\"[^\"]*\"/\"filed\":\"$now\"/" -e 's/"key":"new-sign-in"/"key":"first-second"/' -e 's/"title":"How the new sign-in works"/"title":"Where the settings page spends its first second"/' \
  -e 's/"about":"[^"]*"/"about":"It is ready in 0.8 seconds. Most of that is the script, which can load after the page shows."/' -e 's/"form":"before-after","video":"0:28",/"form":"chart",/' \
  -e 's/"filer":"sign-off-builder"/"filer":"performance-agent"/' -e 's/"group":"Sign-in"/"group":"Settings"/' "$f/report.v2/valid-full.json" > "$dir/report-chart.json"
so post "$board" --kind report --from "$dir/report-chart.json"
sed -E -e "s/\"filed\": *\"[^\"]*\"/\"filed\":\"$now\"/" -e 's/"filer":"sign-off-builder"/"filer":"release-agent"/' "$f/report.v2/valid-full.json" > "$dir/report-now.json"
so post "$board" --kind report --from "$dir/report-now.json"

timeout "${SEED_SERVE_SECONDS:-1800}" node "$repo/dist/cli.js" serve "$board" --port 0 --evidence-root "$dir" > "$dir/serve.log" 2>&1 &
echo $! > "$dir/serve.pid"
for _ in $(seq 50); do url=$(grep -o 'http://127.0.0.1:[0-9]*/' "$dir/serve.log" | head -1) && [ -n "$url" ] && break; sleep 0.2; done
if [ -z "${url:-}" ]; then
  printf 'Server failed to start:\n' >&2
  cat "$dir/serve.log" >&2
  exit 1
fi
echo "$url"
