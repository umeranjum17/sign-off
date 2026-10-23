#!/usr/bin/env bash
# Fills a new board with the approved feel prototype's own demo data (Umer), then serves it, so a shot of the board pairs with the prototype's shot of the same state:
# the npm sign-in, three asks to answer (a pick with its passed proof, a yes or no, and yesterday's pick), a six-screen design to review, five proofs across three projects
# (each with its own capture, one failed and one with no run) and five reports (two new today, three from earlier in the week).
# Usage, from the repo root after `npm run build`: seed-proto-board.sh <empty folder>
# It sets HOME and XDG_* to that folder, so your own board (~/.sign-off) is never read or written. Prints the board URL.
# Finish with node dist/cli.js stop <folder>/board.json, not kill <folder>/serve.pid.
set -euo pipefail
dir=$(cd "$1" && pwd) repo=$(pwd) board="$1/board.json"
export HOME=$dir XDG_CONFIG_HOME=$dir/.config XDG_DATA_HOME=$dir/.local/share XDG_STATE_HOME=$dir/.local/state XDG_CACHE_HOME=$dir/.cache
so() { local out; out=$(node "$repo/dist/cli.js" "$@" 2>&1) || { printf '%s\n' "$out" >&2; return 1; }; }
f=$repo/fixtures/contract m=$repo/docs/media
mkdir -p "$dir/page" "$dir/design" "$dir/.done-done/runs"
printf 'board: board.json\nname: Umer\n' > "$dir/config.yaml"
cp "$f/report.v2/page/"* "$dir/page/"
cp "$m/phone-light.webp" "$dir/settings.webp"; cp "$m/phone-dark.webp" "$dir/settings-dark.webp"; cp "$m/phone-signin.webp" "$dir/account.webp"; cp "$m/phone-decide.webp" "$dir/code.webp"; cp "$m/phone-report.webp" "$dir/notes.webp"

# Proof: three passed (each with a done-done run), one with no result yet, one failed, in the projects release, chat-app and settings, each with its own capture;
# "Settings page loads in a second" is the proof the ship ask rests on.
commit=0000000000000000000000000000000000000000
proof() { # key title about exit n project shot
  local run=20261022T0${5}0000Z-a1b2c3d$5 sha bytes
  sha=$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$dir/$7")
  bytes=$(wc -c < "$dir/$7")
  printf '{"schema":1,"run_id":"%s","commit":"%s","tree":"%s","dirty":false,"exit":%s,"files":[{"path":"%s","sha256":"%s","bytes":%s}]}\n' "$run" $commit "$(printf 'a%.0s' {1..40})" "$4" "$7" "$sha" "$bytes" > "$dir/.done-done/runs/$run.json"
  printf '{"contract":1,"kind":"evidence","schema":1,"key":"%s","title":"%s","filer":"done-done","about":"%s","media":["%s"],"link":"https://example.com/umer/%s/pull/4","run":{"run_id":"%s","commit":"%s","outcome":"%s","repro":"repro: n/a: no bug","proof":"done-done-verify-%s: phone, 390, passed","evidence":"%s"}}\n' \
    "$1" "$2" "$3" "$7" "$6" "$run" $commit "$2" "$6" "$7" > "$dir/$1.json"
  so post "$board" --kind evidence --from "$dir/$1.json"
}
proof notes 'Release notes read well on a phone' 'The notes wrap at phone width with no sideways scrolling.' 0 1 release notes.webp
proof code-keypad 'Code screen keeps the keypad in view' 'On a small phone the keypad covers the last two code boxes.' 1 2 chat-app code.webp
so post "$board" --type evidence --title "Sign-in screen fits a phone" --about "The whole form shows without scrolling sideways." --media "$dir/account.webp" --link https://example.com/umer/chat-app/pull/4 --filer done-done
proof dark-labels 'Dark mode keeps every label readable' 'Every label on the page passes the contrast check in dark mode.' 0 3 settings settings-dark.webp
proof settings-speed 'Settings page loads in a second' 'Umer opens the new settings page on a phone. It is ready in 0.8 seconds.' 0 4 settings settings.webp

# Five reports, oldest first, each the contract's full report with its own fields (an empty value drops the field): three from earlier in the week, read as anything
# filed before today is, then two Umer has not opened.
report() { # key title about group form video decided asked_by
  node -e 'const [file, key, title, about, group, form, video, decided, asked_by] = process.argv.slice(1), r = JSON.parse(require("fs").readFileSync(file, "utf8"));
    Object.assign(r, { key, title, about, group, form, video, decided, asked_by }); for (const k of Object.keys(r)) if (r[k] === "") delete r[k]; process.stdout.write(JSON.stringify(r));' \
    "$f/report.v2/valid-full.json" "$@" > "$dir/$1.json"
  so post "$board" --kind report --from "$dir/$1.json"
}
report next-question 'How sign-off picks the next question' 'The soonest deadline comes first, then anything that blocks other work, then the rest by age.' Sign-off '' '' '' ''
report onboarding-change 'What changed in the chat app onboarding' 'The welcome screen now says what the app is for before it asks for anything.' 'Chat app' before-after '' '' ''
report release-train 'Why the release train has three stages' 'Build, check and publish each have one owner, so a failed check stops the train before anything ships.' Release diagram '' 'Umer approved one owner per stage.' ''
report first-second 'Where the settings page spends its first second' 'It is ready in 0.8 seconds. Most of that is the script, which can load after the page shows.' Settings chart '' '' ''
report new-sign-in 'How the new sign-in works' 'Sign-in now asks for a code after the password, so a stolen password alone opens nothing.' Sign-in before-after 0:28 'Umer keeps the code step.' 'You asked'
# A report archives by itself a day after it is filed; the three from earlier in the week were restored from Archived, so they stay under Earlier, as in the prototype.
for k in next-question onboarding-change release-train; do so restore "$k" "$board"; done

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
  const filed = { npm: at(8, 5), ship: at(8, 1), digest: at(7, 52), export: at(16, 40, 1), onboarding: at(7, 30), "settings-speed": at(7, 40), "dark-labels": at(7, 12), "update-3": at(18, 20, 1), "code-keypad": at(16, 5, 1), notes: at(17, 5, 2), "new-sign-in": at(7, 19), "first-second": at(6, 50),
    "release-train": at(16, 10, 3), "onboarding-change": at(11, 30, 4), "next-question": at(9, 0, 5) };
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
