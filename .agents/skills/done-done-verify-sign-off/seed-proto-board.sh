#!/usr/bin/env bash
# Fills a new board with the approved feel prototype's own demo data (Umer), then serves it, so a shot of the board pairs with the prototype's shot of the same state:
# the npm sign-in, three asks to answer (a pick with its passed proof, a yes or no, and yesterday's pick), a six-screen design to review, five proofs and two new reports.
# Usage, from the repo root after `npm run build`: seed-proto-board.sh <empty folder>
# It sets HOME and XDG_* to that folder, so your own board (~/.sign-off) is never read or written. Prints the board URL.
# Finish with node dist/cli.js stop <folder>/board.json, not kill <folder>/serve.pid.
set -euo pipefail
dir=$(cd "$1" && pwd) repo=$(pwd) board="$1/board.json"
export HOME=$dir XDG_CONFIG_HOME=$dir/.config XDG_DATA_HOME=$dir/.local/share XDG_STATE_HOME=$dir/.local/state XDG_CACHE_HOME=$dir/.cache
so() { local out; out=$(node "$repo/dist/cli.js" "$@" 2>&1) || { printf '%s\n' "$out" >&2; return 1; }; }
f=$repo/fixtures/contract
mkdir -p "$dir/page" "$dir/design" "$dir/.done-done/runs"
printf 'board: board.json\nname: Umer\n' > "$dir/config.yaml"
cp "$f/report.v2/page/"* "$dir/page/"
cp "$repo/docs/media/phone-light.webp" "$dir/settings.webp"

# Proof: three passed (each with a done-done run), one with no result yet, one failed; "Settings page loads in a second" is the proof the ship ask rests on.
sha=$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$dir/settings.webp")
bytes=$(wc -c < "$dir/settings.webp") commit=0000000000000000000000000000000000000000
proof() { # key title about exit
  local run=20261022T0${5}0000Z-a1b2c3d$5
  printf '{"schema":1,"run_id":"%s","commit":"%s","tree":"%s","dirty":false,"exit":%s,"files":[{"path":"settings.webp","sha256":"%s","bytes":%s}]}\n' "$run" $commit "$(printf 'a%.0s' {1..40})" "$4" "$sha" "$bytes" > "$dir/.done-done/runs/$run.json"
  printf '{"contract":1,"kind":"evidence","schema":1,"key":"%s","title":"%s","filer":"done-done","about":"%s","media":["settings.webp"],"link":"https://example.com/pr/4","run":{"run_id":"%s","commit":"%s","outcome":"%s","repro":"repro: n/a: no bug","proof":"done-done-verify-sign-off: phone, 390, passed","evidence":"settings.webp"}}\n' \
    "$1" "$2" "$3" "$run" $commit "$3" > "$dir/$1.json"
  so post "$board" --kind evidence --from "$dir/$1.json"
}
proof notes 'Release notes read well on a phone' 'The notes wrap at phone width with no sideways scrolling.' 0 1
proof code-keypad 'Code screen keeps the keypad in view' 'On a small phone the keypad covers the last two code boxes.' 1 2
so post "$board" --type evidence --title "Sign-in screen fits a phone" --about "The whole form shows without scrolling sideways." --media "$dir/settings.webp" --link https://example.com/pr/4 --filer done-done
proof dark-labels 'Dark mode keeps every label readable' 'Every label on the page passes the contrast check in dark mode.' 0 3
proof settings-speed 'Settings page loads in a second' 'Umer opens the new settings page on a phone. It is ready in 0.8 seconds.' 0 4

# Two reports Umer has not opened.
sed -E 's/"filed": *"[^"]*"/"filed":"2026-10-22T03:19:00Z"/' "$f/report.v2/valid-full.json" > "$dir/r1.json"
sed -E 's/"key":"new-sign-in"/"key":"first-second"/; s/"title":"[^"]*"/"title":"Where the settings page spends its first second"/; s/"about":"[^"]*"/"about":"It is ready in 0.8 seconds. Most of that is the script, which can load after the page shows."/; s/"group":"Sign-in"/"group":"Settings"/; s/"form":"before-after"/"form":"chart"/; s/"filed": *"[^"]*"/"filed":"2026-10-22T02:50:00Z"/; s/,"video":"0:28"//; s/,"decided":"[^"]*"//' \
  "$f/report.v2/valid-full.json" > "$dir/r2.json"
so post "$board" --kind report --from "$dir/r2.json"
so post "$board" --kind report --from "$dir/r1.json"

# What waits on Umer, oldest first.
so post "$board" --ask-ref message-demo --key export --filer design-agent --title "What should the export button say?" \
  --why "In the last test, people looked for “Download” twice as often as “Export”." \
  --option export=Export --option download=Download --option copy="Save a copy" \
  --outcome export="The label stays as it is." --outcome download="The word people looked for." --outcome copy="Longer, but says what happens." \
  --recommend download --recommend-reason "People looked for it twice as often." --default export
cp "$f/design.v1/design/welcome.png" "$dir/design/"; cp "$f/design.v1/design/inbox.png" "$dir/design/"; cp "$repo/docs/media/phone-light.webp" "$dir/design/preview.webp"
node -e '
  const names = [["welcome", "Welcome"], ["account", "Create account"], ["code", "Enter the code"], ["profile", "Add a photo"], ["chats", "Chats"], ["conversation", "First message"]];
  const screens = names.map(([id, title], i) => ({ id, title, views: { phone_light: i % 2 ? "design/inbox.png" : "design/welcome.png" } }));
  process.stdout.write(JSON.stringify({ contract: 1, kind: "design", schema: 1, key: "onboarding", title: "Chat app onboarding", filer: "design-agent",
    about: "Six screens, from the first open to the first message. Approve each one, or say what should change.", group: "Chat app", status: "in_review", filed: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    preview: "design/preview.webp", journeys: [{ id: "onboarding", title: "Onboarding", screens }] }));' > "$dir/onboarding.json"
so post "$board" --kind design --from "$dir/onboarding.json"
# The prototype's screen design is the one card per product that Main passed and promoted, so it waits in Decide.
so promote onboarding "$board" >/dev/null
so post "$board" --ask-ref message-demo --key digest --filer newsletter-agent --title "Keep the weekly digest?" \
  --why "About a third of readers opened it in each of the last two months." \
  --outcome yes="It keeps going out each Monday." --outcome no="It stops after this week." --recommend yes --recommend-reason "Readers still open it." --default yes
so post "$board" --ask-ref message-demo --key ship --filer release-agent --title "When should the new settings page ship?" \
  --why "No new bug reports in three weeks, and support is fully staffed on Friday." \
  --option today=Today --option friday=Friday --option next-week="Next week" \
  --outcome today="It ships this afternoon." --outcome friday="It ships with support on hand." --outcome next-week="It waits for the redesign." \
  --recommend friday --recommend-reason "Support is fully staffed on Friday." --default next-week --proof settings-speed
so post "$board" --type signin --key npm --service npm --link https://www.npmjs.com/login --unlocks "Publishing the release" --waits "Release agent" --expires 12m --filer release-agent

# The prototype's clock: each item filed at the time its shot shows, today in this computer's time zone (the export ask yesterday),
# and the sign-in's line of why it waits, which a sign-in takes in a board file but not as a post flag.
node -e '
  const fs = require("fs"), file = process.argv[1], b = JSON.parse(fs.readFileSync(file, "utf8"));
  const at = (h, m, back = 0) => { const t = new Date(); t.setDate(t.getDate() - back); t.setHours(h, m, 0, 0); return t.toISOString().replace(/\.\d+Z$/, "Z"); };
  const filed = { npm: at(8, 5), ship: at(8, 1), digest: at(7, 52), export: at(16, 40, 1), onboarding: at(7, 30), "settings-speed": at(7, 40), "dark-labels": at(7, 12), "update-3": at(18, 20, 1), "code-keypad": at(16, 5, 1), notes: at(17, 5, 2), "new-sign-in": at(7, 19), "first-second": at(6, 50) };
  for (const d of b.items) if (filed[d.key]) d.filed = filed[d.key];
  b.items.find((d) => d.key === "npm").about = "The release agent has the build ready. It needs your npm sign-in to publish version 2.5.";
  fs.writeFileSync(file, JSON.stringify(b, null, 2) + "\n");' "$board"

timeout "${SEED_SERVE_SECONDS:-1800}" node "$repo/dist/cli.js" serve "$board" --port 0 --evidence-root "$dir" > "$dir/serve.log" 2>&1 &
echo $! > "$dir/serve.pid"
for _ in $(seq 50); do url=$(grep -o 'http://127.0.0.1:[0-9]*/' "$dir/serve.log" | head -1) && [ -n "$url" ] && break; sleep 0.2; done
if [ -z "${url:-}" ]; then
  printf 'Server failed to start:\n' >&2
  cat "$dir/serve.log" >&2
  exit 1
fi
echo "$url"
