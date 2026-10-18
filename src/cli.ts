#!/usr/bin/env node
import { createServer, type IncomingMessage } from 'node:http';
import { type AddressInfo, isIP } from 'node:net';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { accessSync, closeSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, watch, writeFileSync, type Stats } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { homedir, networkInterfaces, tmpdir, userInfo } from 'node:os';
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { encode } from '@toon-format/toon';
import { AxiError, runAxiCli } from 'axi-sdk-js';
import { type Answer, CHAPTERS_MAX, SIGNED_IN, type Round, type Sent, CLEARED, type Decision, InputError, MEDIA_MAX, NOTE_MAX, type Option, REPLY, answersPath, appendAnnotation, appendAnswer, appendDismissed, appendMessage, appendRound, isKey, loadDecisions, markDelivered, markSeen, messagesPath, readAnnotations, readAnswers, readDismissed, readItems, readMessages, readRounds, roundsPath, seenBy, seenPath, sentIds, unreadable as reasonOf, writeItems } from './store.js';

import { ContractError, KINDS, MEDIA_BYTES, REPORT_INIT, checkMessage, mediaFiles, parseMessage, postable, reportPage } from './contract.js';
import { deliverVault, errors, readVaultExpiry, sweepVault, takeVaultExpiries, VaultError, type VaultExpiry } from './vault.js';

const FORMAT = 'https://github.com/umeranjum17/sign-off/blob/main/docs/file-formats.md';
const CONTRACT = 'https://github.com/umeranjum17/sign-off/blob/main/docs/contract.md';
/** Coding agents init installs the skill for: the `npx skills add -a` name, the command that shows it is installed,
 * and where its skills live in a project and in the home folder. */
const [claudeHome, configHome] = [process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), process.env.XDG_CONFIG_HOME || join(homedir(), '.config')];
const AGENTS: Record<string, { bin: string; dir: string; home: string }> = {
  'claude-code': { bin: 'claude', dir: '.claude/skills', home: join(claudeHome, 'skills') },
  codex: { bin: 'codex', dir: '.agents/skills', home: join(homedir(), '.agents', 'skills') },
  opencode: { bin: 'opencode', dir: '.agents/skills', home: join(configHome, 'opencode', 'skills') },
  pi: { bin: 'pi', dir: '.agents/skills', home: join(homedir(), '.agents', 'skills') },
  'gemini-cli': { bin: 'gemini', dir: '.agents/skills', home: join(homedir(), '.gemini', 'skills') },
};
const TOP_HELP = `usage: sign-off-axi [command] [board.json] [flags]
commands[17]:
  (none)=list, raise, post, answers, wait, poll, open, status, stop, serve, export, init, report, signin, doctor, validate, help
board: the nearest .sign-off/ board (the walk's bounds and SIGN_OFF_HOME: README, "Test runs never touch your board"), else ~/.sign-off/decisions.json; a board file given always wins
flags: --full and --json on list, answers and wait, --events on wait, --json on status, --filer on post, raise and wait, --help on every command, -v/--version
examples:
  sign-off-axi
  sign-off-axi raise --title "Ship the new sign-in screen this week?" --recommend yes
  sign-off-axi post --type evidence --title "Sign-in screen on a phone" --about "The new screen loads in 1 second." --media shot.png
  sign-off-axi post .sign-off/decisions.json --type design --title "Pick the sign-in layout" --option a=A --option b=B --mock a=mocks/a.html --mock b=mocks/b.html --recommend b
  sign-off-axi post .sign-off/decisions.json --type diagram --title "Is this the sign-in flow?" --view mocks/sign-in/flow.svg
  sign-off-axi post --type explainer --title "Is the new sign-in clear?" --about "The new sign-in has 2 steps." --media explainer.mp4 --chapter 0:00=Start
  sign-off-axi report init .sign-off/mocks/sign-in-flow
  sign-off-axi post .sign-off/decisions.json --type report --title "Sign-in now takes 2 steps" --about "Why the code step moved first." --view mocks/sign-in-flow/index.html --preview mocks/sign-in-flow/preview.svg
  sign-off-axi post --type signin --key npm-login --service npm --link https://example.com/login --unlocks "Publish the release" --waits "Main" --expires 15m
  sign-off-axi signin done --key npm-login
  sign-off-axi init
  sign-off-axi doctor
  sign-off-axi validate ask.json
  sign-off-axi open
  sign-off-axi wait --key ship-the-new-sign-in-screen-this-week
  sign-off-axi wait --filer my-session-id
  sign-off-axi poll
  sign-off-axi export --out board.html
  sign-off-axi stop
`;
const HELP: Record<string, string> = {
  list: `usage: sign-off-axi list [board.json] [--full] [--json]
Shows the decisions waiting on the user and counts the answered ones. Running sign-off-axi with no command does the same.
  --full  every decision with its status, about, detail, recommendation, silent default and close
  --json  the board path and every decision with its saved answer
examples:
  sign-off-axi
  sign-off-axi list ./decisions.json --full
`,
  raise: `usage: sign-off-axi raise [board.json] --title "<question>" [--key <key>] [--about <text>] [--detail <text>] [--option <value>=<label>]... [--recommend <value>] [--default <value>] [--close done|release] [--filer <id>]
       sign-off-axi raise [board.json] --from <decisions.json> [--filer <id>]
Adds questions to the board: yes/no, or 2 to 6 choices with one --option each. --key defaults to a slug of the title.
raise is the alias for post --type decision: same flags, same output.
--recommend and --default name a value (yes or no without --option). --default is what happens if the user stays silent; it is shown, never applied.
--recommend is required when you list --option (or "options" in a --from file): the board shows that option first and marks it.
A plain yes/no may leave it out; then nothing is marked. The user answers with one tap and can undo it for a few seconds.
--from adds every decision in a decisions file: ${FORMAT}
Raising the same question again is a no-op that reports its status; a different question under a used key is refused.
--filer names who asks (your agent session or any id of 1-128 of A-Z a-z 0-9 . _ -), saved on the item so \`wait --filer\` with the same id gets the answer.
SIGN_OFF_FILER sets it for every command; with neither, the Claude Code session id is saved when there is one.
examples:
  sign-off-axi raise --title "Keep the weekly digest?" --about "Open rate held steady." --recommend yes
  sign-off-axi raise --title "When should it ship?" --option today=Today --option friday=Friday --option next-week="Next week" --recommend friday
  sign-off-axi raise --from ./decisions.json
`,
  validate: `usage: sign-off-axi validate <message.json>... [--kind <kind>] [--expect-invalid]
Checks message files against the communication contract without posting them: ${CONTRACT}
A message is one JSON object with "contract": 1, its "kind" and its "schema". This build checks kinds ask, evidence, gate, finding and plan at schema 1, and report at schema 2.
An evidence message's media paths read from the message file's folder: each file must be there, inside it, and 50 MB or less.
A report is a page to tap through: its "view" (.html) and "preview" (its picture, beside it) read from the message file's folder, filled with no FILL: lines left (see report init).
A gate names its done-done run (run_id and commit) and offers 2 or 3 of approve (Approve), skip (Skip the judge) and fix (Fix first).
A finding gives a repeated cause, its counts, record ids (never record text) and a proposed change, and offers apply (Apply) and skip (Skip).
Post one with \`sign-off-axi post --kind <kind> --from <message.json>\`, or --from - to read stdin.
A board file given to raise --from or post --from may hold such messages as items: each is checked the same way before it is stored, and a report shows under Reports with no answer.
In such a file a new item of a contract kind (a decision, the default, an ask or a report) must carry contract, kind and schema; new evidence is posted with post --kind evidence, one at a time.
Each file gets a row with ok, or the error and one help line that names the fix. A field written twice, an unknown field or a broken limit refuses the file.
  --kind            each file must be this kind, so the wrong file is refused
  --expect-invalid  every file must be refused: exits 0 only then, 2 when any passes (the conformance check of invalid fixtures)
Exits 0 when every file passes, 2 when any is refused or no file is named, and 1 when any file cannot be read.
example message:
  {"contract":1,"kind":"ask","schema":1,"key":"ship-signin-2","title":"Ship the new sign-in screen this week?","options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}],"recommend_value":"yes"}
examples:
  sign-off-axi validate ask.json
  sign-off-axi validate --kind ask messages/*.json
  sign-off-axi validate --kind report report.json
  sign-off-axi validate --kind evidence proof/evidence.json
  sign-off-axi validate --kind gate gate.json
  sign-off-axi validate --kind finding finding.json
  sign-off-axi validate --expect-invalid node_modules/sign-off-axi/fixtures/contract/*/invalid-*.json
`,
  answers: `usage: sign-off-axi answers [board.json] [--key <key>] [--full] [--json]
Prints the latest saved answer per decision and counts the ones still waiting.
  --key   only that decision
  --full  adds the button label, close and title
  --json  {"<key>":{"answer","label","close","at","note"?}} for the answered decisions; note only when the user wrote one
A note column appears when any shown answer has a note.
examples:
  sign-off-axi answers --key keep-the-weekly-digest
  sign-off-axi answers ./decisions.json --json
`,
  wait: `usage: sign-off-axi wait [board.json] [--filer <id>] [--key <key>] [--timeout 600] [--full] [--json | --events]
Blocks until the user answers, then prints the answer the way answers does. Use it instead of a polling loop.
  --filer    only the items posted with this --filer (or SIGN_OFF_FILER): returns every answer to them this filer has not taken yet,
             even one saved before wait started, and marks it taken, so the board shows "Seen by agent" on that card;
             NOT_FOUND when none of them still needs an answer. Without --filer or SIGN_OFF_FILER, wait takes no filer
  --key      wait for that decision; an answer saved before wait starts returns at once
             and a key not raised yet is waited for too
             without --key, wait for the next answer to any decision that still needs an answer; NOT_FOUND when nothing needs one
  --timeout  seconds to wait, 600 (10 minutes) by default; then exits 1 with code TIMEOUT
  --full     adds the button label, close and title
  --json     {"<key>":{"answer","label","close","at","note"?}} for the new answers; note only when the user wrote one
  --events   needs --filer (or SIGN_OFF_FILER); one JSON line per new answer and per another-round ask, in the order they were saved (${CONTRACT}#7-answers):
             {"event":"answer","contract":1,"kind","schema","key","title","answer","label","close","at","note"?,"filer"?,"comments"?}
             {"event":"round","contract":1,"kind","schema","key","title","note","at","filer"?,"comments"?}; a board-format item reports as ask schema 1
A note column appears when any shown answer has a note.
Ctrl-C stops waiting; nothing is changed.
examples:
  sign-off-axi wait --key keep-the-weekly-digest
  sign-off-axi wait ./decisions.json --timeout 60 --json
  sign-off-axi wait --filer agent-41 --events
`,
  open: `usage: sign-off-axi open [board.json] [--port 4410] [--bind <address>] [--evidence-root <dir>]
Starts the board in the background on 127.0.0.1 and prints its URL and pid; a no-op when this board is already open.
--port defaults to the port in a config.yaml beside the board (init writes one), else 4410.
--bind serves it on one private address of this machine instead (such as its VPN address), so a phone or tablet on the user's own network can open it;
the bind line in config.yaml next to the board sets the same, and its hosts: line names private DNS names that lead to that address
(such as its mesh VPN name, commas between them) that may open it too. A symlinked board uses the config.yaml beside the link. Beyond 127.0.0.1 the board needs an access token: it is made once, kept in <board>.token,
and printed in the URL here; requests without it are refused. Delete that file to shut old links out at once; stop and open again for a new one.
Open on another address while the board runs fails; stop it first.
--evidence-root is the folder holding .done-done/, for decisions that link run evidence. The server log and its pid file are written next to the board.
examples:
  sign-off-axi open
  sign-off-axi open ./decisions.json --port 4411
  sign-off-axi open --bind 100.101.102.103
`,
  status: `usage: sign-off-axi status [board.json] [--json]
Reports whether the board that open started for this board file is running, with its URL and pid.
examples:
  sign-off-axi status
  sign-off-axi status ./decisions.json --json
`,
  stop: `usage: sign-off-axi stop [board.json]
Stops the board that open started (or found running) for this board file. It checks the pid really is that board's server first; a no-op when none is running.
examples:
  sign-off-axi stop
  sign-off-axi stop ./decisions.json
`,
  serve: `usage: sign-off-axi serve [board.json] [--port 4410] [--bind <address>] [--evidence-root <dir>]
Runs the board in the foreground until Ctrl-C; --port 0 picks a free port, and it defaults the way open's does; --bind works as for open. Use open to run it in the background.
examples:
  sign-off-axi serve --port 0
`,
  post: `usage: sign-off-axi post [board.json] [--type decision|design|diagram|interactive] --title "<question>" [--key <key>] [--about <text>] [--option <value>=<label>]... [--mock <value>=<path>]... [--view <path>] [--tradeoff <text>] [--recommend <value>] [--default <value>] [--close done|release] [--filer <id>]
       sign-off-axi post [board.json] --type evidence --title "<what this shows>" --about "<short note>" --media <file>... [--link <commit or URL>] [--detail <text>] [--filer <id>]
       sign-off-axi post [board.json] --from <board file> --replace [--filer <id>]
       sign-off-axi post [board.json] --kind <kind> --from <message.json|-> [--filer <id>]
       sign-off-axi post [board.json] --type explainer --title "<question>" --media <video> [--about <summary>] [--chapter <m:ss>=<title>]... [--key <key>] [--option <value>=<label>]... [--recommend <value>]
       sign-off-axi post [board.json] --type report --title "<the answer>" --about "<why it matters>" --view <page.html> --preview <picture> [--key <key>] [--link <commit or URL>] [--filer <id>]
       sign-off-axi post [board.json] --type signin --service "<name>" --link <sign-in URL> --unlocks "<what it unlocks>" --waits "<who waits>" [--expires <ISO time or 15m>] [--key <key>] [--filer <id>]
       sign-off-axi post [board.json] --type signin --service "<name>" --start '<command as a JSON list>' --unlocks "<what it unlocks>" --waits "<who waits>" [--key <key>] [--filer <id>]
Posts an item for the user. --type decision (the default) is a yes/no or pick-one question, exactly like raise.
--kind posts one contract message (${CONTRACT}), read from a file or from stdin with --from -: it must be that kind and pass every rule,
else it is refused with one fix line and nothing is written. A key already on the board takes only the same message again; anything else exits 2.
--kind evidence copies its media, read from the message file's folder (the current folder for stdin), into evidence/<number>/ like --type evidence;
a "run" is the update's proof: its outcome line heads the card, so write it as the result the user can see. With no key it posts the next update-<number>.
--kind gate holds a done-done run for the user: it waits like an ask; run done-done respond --action <the picked value>.
--kind finding asks the user to apply or skip a retro's proposed change: it waits like an ask.
Listing --option needs --recommend <value>, on every type: the option you would pick, shown first and marked. --from --replace feeds are not held to it.
--filer names who posts (your agent session or any id of 1-128 of A-Z a-z 0-9 . _ -), saved on the item; then \`wait --filer <id>\` gets the answer.
SIGN_OFF_FILER sets it for every command; with neither, the Claude Code session id is saved when there is one.
--type design is a pick between up to 6 options shown side by side, each with an optional board-relative mock file
(.html, .svg, .png, .jpg, .jpeg, .webp, 5 MB or less), a --tradeoff line and a --recommend badge.
One .html page can hold every variant: --mock a=mocks/<key>/index.html?variant=a and so on; the page reads ?variant= to show one.
An .html mock or view loads the css, scripts, images and fonts beside it by relative name, from its own folder only.
After the user picks, answers --key <key> --json holds the pick and note; "rounds" holds an ask for another round.
--from <file> --replace is for a program that feeds the board: the file, checked like any post, becomes the whole board (items and
top-level fields such as "answers_only": true), written only when it changed; a bad item is refused and the board is left as it was. Answers stay.
A contract message under a key already on the board is checked against its kind's rules again when it changed, so a changed item that no longer
matches is refused and the board left as it was; an item whose message did not change is not checked again. An answered contract key the feed dropped
cannot come back: post it under a new key (a design, diagram, interactive or explainer item that comes back keeps its answer).
With --filer (or SIGN_OFF_FILER) the file replaces only that filer's items, and items with no filer it names by key: every other item and the board's other top-level fields stay.
An empty items list removes that filer's items.
--type diagram and --type interactive are a decision shown with a picture: --view names one board-relative file,
an image (.svg, .png, .jpg, .jpeg, .webp, 5 MB or less) shown at card width for a diagram, or one self-contained .html page for interactive.
The page runs in a sandboxed frame: no fetch, no remote files, no access to the dashboard or its tab. Answers work as for a decision.
--type evidence posts the next numbered update (key update-<number>): 1 to ${MEDIA_MAX} screenshots or recordings (.png, .jpg, .jpeg, .webp, .mp4, .webm, 50 MB each), copied into evidence/<number>/ next to the board, with a short note and an optional commit or PR link.
The user gives a verdict, pass, fail or needs-work, with an optional note; read it with answers or wait --key update-<number>.
--type explainer is a decision shown with a narrated video you made: one --media .mp4 or .webm (50 MB or less), copied into evidence/<number>/ like evidence
and played on the card. --about is its short summary; up to ${CHAPTERS_MAX} --chapter m:ss=<title> (in order) are buttons that jump the video there. Answers work as for a decision.
--type report posts an explainer page the user reads, with no answer: a report schema 2 message (${CONTRACT}), refused when it is text only.
--view is the page and --preview its picture on the card, beside it, both from the board file's folder; \`sign-off-axi report init <folder>\` makes them.
The page must be filled (no FILL: line left), with a viewport tag, dark mode, a picture, something to tap, its detail folded, nothing from the web, and no block over about five lines on a phone.
Merges, PR outcomes, receipts and status notes are not reports: post proof of a change as evidence.
--type signin asks the user to sign in, at the top of what waits: the service, one Open button for the http(s) --link, what it unlocks,
who waits, and the time left until --expires (an ISO date-time, or 90s, 15m, 2h, 1d from now). After that time the card says the link expired.
No output prints the link. Post again with the same --key and a new --link or --expires to put a new link on the same card; it waits again.
When the sign-in is done, run \`sign-off-axi signin done [board.json] --key <key>\`: the card leaves the open list and shows as done.
For a link that expires fast, give --start, the command that prints a new sign-in link, as a JSON list such as '["npm", "login", "--auth-type=web"]'.
Each tap on Open then runs it on the computer that serves the board (no shell, in the board file's folder) and opens the first https link it prints on stdout
(on stderr when stdout has none within 2 seconds), so the card never shows an expired link. A tap while it runs opens the same link again. Its exit 0 closes the card as done; a failure, or no link
within 20 seconds, shows on the card and Open can try again. It is stopped after 10 minutes, or when the card closes. The link is never stored or printed.
examples:
  sign-off-axi post --type design --title "Pick the sign-in layout" --option a="A: single column" --option b="B: split screen" --mock a=mocks/a.html --mock b=mocks/b.html --tradeoff "B scans fastest; A is simplest." --recommend b
  sign-off-axi post .sign-off/decisions.json --type design --key sign-in --title "Pick the sign-in layout" --option a=A --option b=B --option c=C --mock a=mocks/sign-in/index.html?variant=a --mock b=mocks/sign-in/index.html?variant=b --mock c=mocks/sign-in/index.html?variant=c --tradeoff "..." --recommend b
  sign-off-axi post --type decision --title "Keep the weekly digest?" --recommend yes
  sign-off-axi post --kind ask --from ask.json --filer agent-41
  sign-off-axi post --kind evidence --from proof/evidence.json --filer done-done
  sign-off-axi post --kind gate --from gate.json --filer done-done
  sign-off-axi post --kind finding --from finding.json --filer learn-from-mistakes
  sign-off-axi post .sign-off/decisions.json --type interactive --title "Does the sign-in flow feel right?" --view mocks/sign-in/demo.html --option yes=Yes --option no="Needs work" --recommend yes
  sign-off-axi post --type evidence --title "Sign-in screen on a phone" --about "The new screen loads in 1 second." --media phone.png --media flow.mp4 --link https://github.com/acme/app/pull/12
  sign-off-axi post --type explainer --title "Is the new sign-in clear?" --about "The new sign-in has 2 steps." --media explainer.mp4 --chapter 0:00=Start --chapter 0:12="Step 2"
  sign-off-axi post .sign-off/decisions.json --type report --title "Sign-in now takes 2 steps" --about "Why the code step moved first." --view mocks/sign-in-flow/index.html --preview mocks/sign-in-flow/preview.svg
  sign-off-axi post --type signin --key npm-login --service npm --link https://example.com/login --unlocks "Publish the release" --waits "Main" --expires 15m
  sign-off-axi post --type signin --key npm-login --service npm --start '["npm", "login", "--auth-type=web"]' --unlocks "Publish the release" --waits "Main"
`,
  signin: `usage: sign-off-axi signin done [board.json] --key <key>
Closes a sign-in card that post --type signin made: the sign-in is done, so the card leaves the open list and shows as done.
Run it when you see the sign-in worked. A card posted with --start also closes by itself when its command ends with exit 0. wait --key <key> also returns once it is done.
examples:
  sign-off-axi signin done --key npm-login
`,
  report: `usage: sign-off-axi report init <folder>
Writes a report page to fill: <folder>/index.html and its card picture <folder>/preview.svg. A file already there is kept.
The page is one self-contained file, phone first, light and dark, in four parts, each one idea:
  1. the answer in one plain sentence and a picture of it   2. a diagram of how it works
  3. steps the reader taps through, with Back and Next     4. the detail, folded
Replace every FILL: line, open the page in a browser 390 px wide and look: mostly text means it is not ready.
Then post it with the command it prints; the paths are from the board file's folder, so make the folder under it, such as .sign-off/mocks/<key>.
A report is for an explanation the user asked for, or a concept, design or trade-off they must understand. Proof that something works is evidence.
examples:
  sign-off-axi report init .sign-off/mocks/sign-in-flow
`,
  init: `usage: sign-off-axi init [dir] [--agent auto|<name>[,<name>]...]
Writes a repo's sign-off setup under <dir>/.sign-off/ (config, an empty board, mocks/ and evidence/ folders, and a .gitignore keeping media and answer files out of git). A file that is already there is kept, never changed, except that a given --agent replaces the config's agent: line; a re-run adds what is missing.
Then installs the sign-off-axi skill into <dir> for each chosen coding agent with \`npx -y skills add\`, skipping agents that already have it.
  --agent  auto (the default) picks every agent below whose command is on PATH; nothing else is read
           or one or more of: ${Object.entries(AGENTS).map(([name, a]) => `${name} (${a.bin})`).join(', ')}
           a given --agent is saved as the agent: line of config.yaml; without it, init uses that line
examples:
  sign-off-axi init
  sign-off-axi init ./my-project --agent opencode
  sign-off-axi init --agent codex,gemini-cli
`,
  poll: `usage: sign-off-axi poll [board.json] [--timeout 600] [--json]
Blocks until the user comments on an item or queues a prompt for the agent on the page, then prints every new one once and marks it read.
Answers and another-round asks come back through answers and wait instead.
  --timeout  seconds to wait, 600 (10 minutes) by default; then exits 1 with code TIMEOUT
  --json     {"messages":[{"id","kind","key"?,"text","at"}]}; kind is comment (key names the item) or prompt
examples:
  sign-off-axi poll
  sign-off-axi poll ./decisions.json --timeout 60 --json
`,
  export: `usage: sign-off-axi export [board.json] [--out <file.html>] [--evidence-root <dir>]
Writes a frozen, read-only copy of the board: one HTML file with every item, answer, note and another-round request, and its local mocks and media inlined. Comments and queued prompts are left out.
A mock page is inlined on its own: the css and images beside it show only on the running board.
It opens from disk with no server and makes no network request. --out defaults to <board>.export.html next to the board and must end in .html.
examples:
  sign-off-axi export
  sign-off-axi export ./decisions.json --out ~/board-12-oct.html
`,
  doctor: `usage: sign-off-axi doctor [dir]
Checks the repo setup init wrote: node version, config, board file, answer files, a lock a crashed command left behind, gitignore lines, folders, whether the dashboard port is free,
that each hosts: name in the config leads to the bind address, that the on_answer: command can run (no shell, so | > && do nothing),
and one line per coding agent in the config's agent: line (auto: each one on PATH) saying whether its skill is installed.
With no dir, it checks the nearest setup, found as a bare command finds its board (README: Test runs never touch your board).
Each failure prints one help line naming its fix and exits 1; a clean setup exits 0.
examples:
  sign-off-axi doctor
`,
};
const warn = (msg: string) => console.error(`sign-off-axi: ${msg}`);
const tilde = (path: string) => (path.startsWith(homedir() + sep) ? `~${path.slice(homedir().length)}` : path);
/** A path as a shell word for a printed command: relative when it is under the working folder, quoted when it has anything but plain path characters,
 * with a leading ~/ kept outside the quotes. */
const shellPath = (path: string) => {
  const rel = relative(process.cwd(), path), under = rel.split(sep)[0] !== '..' && !isAbsolute(rel);
  const shown = !rel ? '.' : under ? rel : tilde(path), home = !under && shown.startsWith('~/') ? '~/' : '', rest = shown.slice(home.length);
  return home + (/^[\w./-]+$/.test(rest) ? rest : `'${rest.replaceAll("'", "'\\''")}'`);
};
/** Run through npx (npm exec), a next-step command says npx -y sign-off-axi, since a bare sign-off-axi may not be installed. */
const hint = (line: string) => (process.env.npm_command === 'exec' ? line.replaceAll('`sign-off-axi', '`npx -y sign-off-axi') : line);
const fail = (message: string, code: string, ...help: string[]) => new AxiError(message, code, help.map(hint));
/** TOON data, then next-step hints one per line, the way the other AXIs print them. */
const toon = (data: object, help: string[] = []) => [encode(data), ...(help.length ? [`help[${help.length}]:`, ...help.map((h) => `  ${hint(h)}`)] : [])].join('\n');
class EvidenceError extends Error {}

type Flags = Record<string, { type: 'string' | 'boolean'; default?: string; multiple?: boolean }>;
const TIERS: Flags = { full: { type: 'boolean' }, json: { type: 'boolean' } };
const BOARD_FLAGS: Flags = { port: { type: 'string' }, bind: { type: 'string' }, 'evidence-root': { type: 'string' } };
const TITLE_MAX = 160;
/** A new item's title fits on a card, the contract's title rule; items already on a board are not checked again. */
function fits(title: unknown, key?: string) {
  const n = typeof title === 'string' ? [...title].length : 0;
  if (n > TITLE_MAX) throw fail(`${key ? `key ${key}: ` : ''}title is ${n} characters, over ${TITLE_MAX}`, 'VALIDATION_ERROR', `Shorten the title to ${TITLE_MAX} characters and put the rest in about`);
}
/** Board types that are contract kinds: a decision (the default type) is an ask. */
const CONTRACT_TYPES = ['decision', 'ask', 'evidence', 'report'];
/** The stored item as the message it came from: the board's own `filed` stamp is not part of a message that names none. */
const asSent = ({ filed: _filed, ...rest }: any) => rest;
/** Items of a --from file that carry contract or kind are contract messages: each is checked against its kind's rules before anything is stored.
 * A new item of a contract kind must carry them (contract section 2). A --replace feed replaces the stored item, so an item under an existing key
 * that changed is checked again; an unchanged item, a board-format one and every item outside a --replace feed are not checked again. */
function contractItems(items: any[], from: string, file: string, replace = false) {
  const on = new Map((existsSync(file) ? readItems(file).items : []).map((i) => [i?.key, i]));
  items.forEach((m, i) => {
    // Evidence in message form (no type) never comes in a feed, even under a key on the board: its media must be copied and numbered.
    // A stored board-format evidence item passes through a feed unchanged; any other evidence under a key is refused.
    const kept = on.get(m?.key)?.type === 'evidence';
    if ((m?.kind === 'evidence' && m?.type === undefined) || (!kept && (m?.kind ?? m?.type) === 'evidence')) {
      throw fail(`${from}: items[${i}]${isKey(m?.key) ? ` key ${m.key}` : ''}: evidence is posted one at a time, not in a --from file`, 'VALIDATION_ERROR', 'Post it with sign-off-axi post --kind evidence --from <message.json>');
    }
    const held = on.get(m?.key);
    let check = m;
    // In a --replace feed the stored item is replaced, so a changed item is checked again as the message it carries and
    // one that no longer matches its kind is refused, never stored half-broken (contract section 2). The board's own
    // `filed` stamp is not a field of that message, except on a report, which names one; an evidence item's `type`,
    // `number` and media copies read as the message's `media` paths, and its `evidence` run reads as `run`. An unchanged
    // item, a board-format one and every item outside a --replace feed are not checked again.
    const asMessage = (x: any) => {
      if (m?.kind !== 'evidence') return m?.kind === 'report' ? x : asSent(x);
      const { type: _type, number: _number, media, evidence: run, ...message } = asSent(x);
      return { ...message, ...(media !== undefined && { media: Array.isArray(media) ? media.map((r: any) => r?.path) : media }), ...(run && { run }) };
    };
    if (on.has(m?.key)) {
      const same = canon(m) === canon(m?.filed === undefined ? asMessage(held) : held);
      if (!replace || same || (m?.contract === undefined && m?.kind === undefined)) return;
      check = asMessage(m);
    } else if (replace && m?.kind !== undefined) check = asMessage(m);
    if (m?.contract === undefined && m?.kind === undefined) {
      if (!CONTRACT_TYPES.includes(m?.type ?? 'decision')) return;
      throw fail(`${from}: items[${i}]${isKey(m?.key) ? ` key ${m.key}` : ''}: kind is required on a new ${m?.type ?? 'decision'}`, 'VALIDATION_ERROR',
        'Add "contract": 1, "kind" and "schema" to the item, such as "contract": 1, "kind": "ask", "schema": 1');
    }
    try {
      checkMessage(check);
      postable(check);
      if (check.kind === 'report') reportPage(check, dirname(file));
    } catch (e) {
      throw e instanceof ContractError ? fail(`${from}: items[${i}]: ${e.message}`, 'VALIDATION_ERROR', e.help) : e;
    }
  });
}
const RAISE_FIELDS = ['title', 'key', 'about', 'detail', 'option', 'recommend', 'default', 'close'];

/** Parses one command's flags strictly; `on` carries a given board file into the next-step hints. */
function parse(cmd: string, args: string[], flags: Flags) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, strict: true, options: flags });
  } catch (e: any) {
    const flag = e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && /'([^']+)'/.exec(e.message)?.[1];
    throw fail(flag ? `unknown flag ${flag} for \`${cmd}\`` : e.message, 'VALIDATION_ERROR',
      `valid flags for \`${cmd}\`: ${Object.keys(flags).map((f) => `--${f}`).join(', ')} (--help always allowed)`);
  }
  const [given, extra] = parsed.positionals;
  if (extra !== undefined) throw fail(`unexpected argument ${extra}: \`${cmd}\` takes one board file`, 'VALIDATION_ERROR', `Run \`sign-off-axi ${cmd} --help\``);
  const on = given === undefined ? '' : ` ${/^[\w./~-]+$/.test(given) ? given : JSON.stringify(given)}`;
  // One spelling per board, so a symlinked path finds the same pid record and server; its config.yaml stays the one beside the name given.
  const path = given === undefined ? boardHere() : resolve(given), real = existsSync(path) ? realpathSync(path) : path;
  return { file: real, named: path, values: parsed.values as Record<string, any>, on };
}
/** The root of the default store (~/.sign-off) and the walk's stop: SIGN_OFF_HOME when set, else HOME. */
const signOffHome = () => resolve(process.env.SIGN_OFF_HOME || homedir());
/** The account's own home folder from the system user database, which a changed HOME does not move; undefined when there is none. */
const accountHome = () => { try { return userInfo().homedir || undefined; } catch { return undefined; } };
/** The folder of the nearest .sign-off/config.yaml that init set up: the working folder's own, else one above it up to the repo root (the folder
 * holding .git) or up to HOME (or SIGN_OFF_HOME), never HOME's own. With neither above the climb is not made, and the account's own home (which
 * a changed HOME does not move) is never adopted. */
function setupFolderHere() {
  const [home, account] = [signOffHome(), accountHome()].map((h) => (h && existsSync(h) ? realpathSync(h) : undefined)), cwd = process.cwd(), chain: string[] = [];
  if (cwd === account) return undefined;
  let bounded = false;
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (dir === home) { bounded = true; break; }
    if (dir === account) break;
    chain.push(dir);
    if (existsSync(join(dir, '.git'))) { bounded = true; break; }
    if (dirname(dir) === dir) break;
  }
  return (bounded ? chain : [cwd]).find((dir) => existsSync(join(dir, '.sign-off', 'config.yaml')));
}
/** The board when none is given: the nearest project board, else ~/.sign-off/decisions.json under SIGN_OFF_HOME or HOME. */
function boardHere() {
  const folder = setupFolderHere();
  return folder ? setupOf(join(folder, '.sign-off', 'decisions.json'))!.board : join(signOffHome(), '.sign-off', 'decisions.json');
}
const portOf = (value: string) => {
  if (!/^\d{1,5}$/.test(value) || Number(value) > 65535) throw fail('--port must be a number from 0 to 65535', 'VALIDATION_ERROR', 'Pass a free port, such as 4410, or 0 to let the system pick one');
  return Number(value);
};
/** Maps a decisions-file problem to a structured usage error (exit 2). */
const axi = (cmd: string, run: (args: string[]) => string | Promise<string>) => async (args: string[]) => {
  try { return await run(args); } catch (e) {
    throw e instanceof InputError ? fail(e.message, 'VALIDATION_ERROR', `Run \`sign-off-axi ${cmd} --help\`; the file format is at ${FORMAT}`) : e;
  }
};

/** Who posts or waits: --filer, else SIGN_OFF_FILER; a single post with neither saves the Claude Code session id when there is one. */
function filerOf(values: Record<string, any>, session = false): string | undefined {
  const filer = values.filer ?? (process.env.SIGN_OFF_FILER || undefined);
  if (filer !== undefined && !isKey(filer)) throw fail(`--filer ${filer} must be 1-128 of A-Z a-z 0-9 . _ -`, 'VALIDATION_ERROR', 'Pass your agent session id, or any short name for yourself');
  const own = session ? process.env.CLAUDE_CODE_SESSION_ID : undefined;
  return filer ?? (isKey(own) ? own : undefined);
}
const waitFor = (on: string, filer?: string, key?: string) => (filer ? `Run \`sign-off-axi wait${on} --filer ${filer}\` to block until the user answers`
  : `Run \`sign-off-axi wait${on}${key ? ` --key ${key}` : ''}\` to block until the user answers`);

/** Still waiting on the user: not answered, not dismissed, and something to answer (an item with no options and no reply is only shown). */
const waits = (d: Decision & { answer?: unknown; dismissed?: boolean }) => !d.dismissed && !d.answer && (d.options.length > 0 || !!d.reply || d.type === 'signin');
/** The board's decisions with their latest answer; a missing board file is an empty board.
 *  A dismissal hides an item from the board and is not waiting here either, checked against the same dismissed log the board reads. */
function board(file: string, say = warn) {
  if (!existsSync(file)) return [];
  const decisions = loadDecisions(file), answers = readAnswers(file, say);
  const hidden = new Set(readDismissed(file, answers, readRounds(file), say));
  for (const key of Object.keys(answers)) if (!decisions.some((d) => d.key === key)) say(`left out the answer for ${key}: that question is no longer in ${basename(file)}`);
  return decisions.map((d) => ({ ...d, answer: Object.hasOwn(answers, d.key) ? answers[d.key] : undefined, dismissed: hidden.has(d.key) }));
}
function ready(file: string, on: string, root?: string) {
  if (!existsSync(file)) throw fail(`no board yet at ${tilde(file)}`, 'NOT_FOUND', `Run \`sign-off-axi raise${on} --title "<question>"\` first`);
  if (root) {
    let dir = false;
    try { dir = !!statSync(root, { throwIfNoEntry: false })?.isDirectory(); } catch (e: any) { throw fail(`--evidence-root ${tilde(resolve(root))} ${reasonOf(e.code)}`, 'VALIDATION_ERROR', 'Pass the folder that holds .done-done/'); }
    if (!dir) throw fail(`--evidence-root ${tilde(resolve(root))} is not a folder`, 'VALIDATION_ERROR', 'Pass the folder that holds .done-done/');
  }
  loadDecisions(file);
}

function list(args: string[]) {
  const { file, values, on } = parse('list', args, TIERS);
  const rows = board(file), waiting = rows.filter(waits), answered = rows.filter((d) => d.answer && !d.dismissed).length;
  if (values.json) return JSON.stringify({ board: file, decisions: rows.map(({ dismissed, ...d }) => ({ ...d, ...(d.type === 'signin' && { link: undefined }), ...(dismissed && { dismissed }) })) });
  const help = [
    ...(waiting.length ? [`Run \`sign-off-axi open${on}\` to show the board to the user`] : []),
    ...(answered ? [`Run \`sign-off-axi answers${on}\` to read the ${answered} saved answers`] : []),
    `Run \`sign-off-axi raise${on} --title "<question>"\` to ask the user a yes/no or pick-one question`,
  ];
  const where = tilde(file) + (existsSync(file) ? '' : ' (no file yet; raise creates it)');
  if (values.full) {
    return toon({ board: where, decisions: rows.map((d) => ({ key: d.key, status: d.answer?.answer ?? (d.dismissed ? 'dismissed' : 'waiting'), title: d.title, about: d.about ?? '', detail: d.detail ?? '',
      recommend: d.recommend_value ?? '', default_if_silent: d.default_if_silent ?? '', close: d.close })) }, help);
  }
  return toon({
    board: where,
    waiting: waiting.length ? waiting.map(({ key, title }) => ({ key, title })) : `0 of ${rows.length} decisions (nothing is waiting on the user)`,
    answered,
  }, rows.length ? [...help, `Run \`sign-off-axi list${on} --full\` for about, detail and recommendations`] : help);
}

/** The answered rows in the answers shape: TOON, --full adds label, close and title, --json the bare map. */
function printAnswers(file: string, rows: ReturnType<typeof board>, waiting: number, values: Record<string, any>, help: string[]) {
  const done = rows.flatMap((d) => (d.answer ? [{ ...d.answer, title: d.title }] : []));
  const rounds = readRounds(file).filter((r) => rows.some((d) => d.key === r.key));
  if (values.json) {
    const asked = (key: string) => rounds.filter((r) => r.key === key).map(({ note, at, comments }) => ({ note, at, comments }));
    const out: Record<string, any> = Object.fromEntries(done.map(({ key, answer, label, close, at, note, comments }) => [key, { answer, label, close, at, note, comments, ...(asked(key).length && { rounds: asked(key) }) }]));
    for (const r of rounds) if (!out[r.key]) out[r.key] = { rounds: asked(r.key) };
    return JSON.stringify(out);
  }
  const notes = done.some((a) => a.note), sent = [...done, ...rounds].flatMap(({ key, comments = [] }) => comments.map(({ mock, ref, tag, words, text }) => ({ key, mock, ref, tag, words, text })));
  return toon({
    board: tilde(file),
    answers: done.length ? done.map(({ key, answer, at, label, close, title, note = '' }) => ({ key, answer, at, ...(values.full && { label, close, title }), ...(notes && { note }) })) : '0 saved yet',
    ...(rounds.length && { rounds: rounds.map(({ key, note, at }) => ({ key, note, at })) }),
    // Comments on mock elements that went with an answer or a round, each with the element it points at.
    ...(sent.length && { comments: sent }),
    waiting,
  }, help);
}

function answers(args: string[]) {
  const { file, values, on } = parse('answers', args, { ...TIERS, key: { type: 'string' } });
  const rows = board(file).filter((d) => values.key === undefined || d.key === values.key);
  if (values.key !== undefined && !rows.length) throw fail(`no decision with key ${values.key} on ${tilde(file)}`, 'NOT_FOUND', `Run \`sign-off-axi list${on}\` to see the waiting keys`);
  const waiting = rows.filter(waits).length, key = values.key === undefined ? '' : ` --key ${values.key}`;
  return printAnswers(file, rows, waiting, values, waiting ? [`Run \`sign-off-axi open${on}\` so the user can answer the ${waiting} waiting`, `Run \`sign-off-axi wait${on}${key}\` to block until they answer`] : []);
}

/** The contract fields an answer or round reports with: the item's kind and schema, or ask schema 1 for a board-format or dropped item (contract section 2). */
function kindOf(file: string) {
  const items = new Map((existsSync(file) ? readItems(file).items : []).map((i) => [i?.key, i]));
  return (key: string) => {
    const i = items.get(key), contract = typeof i?.kind === 'string';
    return { contract: 1, kind: contract ? i.kind : 'ask', schema: contract ? i.schema : 1 };
  };
}
/** One JSON line per answer and per round (contract section 7), oldest first. */
function eventLines(file: string, rows: Decision[], answers: Answer[], rounds: Round[]) {
  const kind = kindOf(file), item = new Map(rows.map((d) => [d.key, d]));
  const head = (event: string, key: string) => ({ event, ...kind(key), key, title: item.get(key)?.title });
  const tail = (key: string, comments?: Sent[]) => ({ ...(item.get(key)?.filer && { filer: item.get(key)!.filer }), ...(comments?.length && { comments }) });
  return [...answers.map(({ key, answer, label, close, at, note, comments }) => ({ at, line: { ...head('answer', key), answer, label, close, at, ...(note && { note }), ...tail(key, comments) } })),
    ...rounds.map(({ key, note, at, comments }) => ({ at, line: { ...head('round', key), note, at, ...tail(key, comments) } }))]
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map(({ line }) => JSON.stringify(line)).join('\n');
}

async function wait(args: string[]) {
  const { file, values, on: onBoard } = parse('wait', args, { ...TIERS, events: { type: 'boolean' }, filer: { type: 'string' }, key: { type: 'string' }, timeout: { type: 'string', default: '600' }, into: { type: 'string' } });
  if (!/^\d{1,7}$/.test(values.timeout)) throw fail('--timeout must be whole seconds, 0 or more', 'VALIDATION_ERROR', `Run \`sign-off-axi wait --help\``);
  if (values.events && (values.json || values.full)) throw fail(`--events prints event lines, so it does not take --${values.json ? 'json' : 'full'}`, 'VALIDATION_ERROR', 'Run `sign-off-axi wait --filer <id> --events`');
  const filer = filerOf(values), on = onBoard + (filer ? ` --filer ${filer}` : '');
  if (values.events && filer === undefined) throw fail(`--events prints a filer's answer events, so it needs --filer`, 'VALIDATION_ERROR', 'Run `sign-off-axi wait --filer <id> --events`');
  // Vault Give delivery: its own loop, before any board read, so no ordinary wait changes. Undocumented while the vault is OFF.
  if (values.into !== undefined) return waitInto(file, values, onBoard);
  if (values.key === undefined) ready(file, onBoard);
  const seconds = Number(values.timeout), deadline = Date.now() + seconds * 1000, key = values.key === undefined ? '' : ` --key ${values.key}`;
  // With a filer, only its own items count, and an answer it has not taken yet is new however old it is.
  const mine = (rows: ReturnType<typeof board>) => (filer === undefined ? rows : rows.filter((d) => d.filer === filer));
  const before = new Set(board(file).flatMap((d) => (d.answer ? [d.key] : [])));
  // Rounds seen before waiting starts stay quiet; only a newly asked round wakes the loop.
  const seenRounds = new Map<string, number>();
  for (const r of readRounds(file)) seenRounds.set(r.key, (seenRounds.get(r.key) ?? 0) + 1);
  // A save wakes the loop at once; the 1 second timer is the fallback where file events are unavailable.
  let wake = () => {}, watcher, vaultWarned = false;
  const name = basename(answersPath(file));
  try {
    try { watcher = watch(dirname(file), (_, changed) => changed === name && wake()).on('error', () => {}); } catch {}
    for (let first = true; ; first = false) {
      const rows = mine(board(file, first ? warn : () => {})), waiting = rows.filter(waits).length, taken = filer === undefined ? undefined : seenBy(file);
      const hit = rows.filter((d) => (values.key !== undefined ? d.key === values.key : d.answer && (taken ? !taken(d.answer) : !before.has(d.key))));
      const counts = new Map<string, number>(), asked: Round[] = [];
      for (const r of readRounds(file, first ? warn : () => {})) {
        counts.set(r.key, (counts.get(r.key) ?? 0) + 1);
        if (counts.get(r.key)! > (seenRounds.get(r.key) ?? 0)) asked.push(r);
      }
      const fresh = rows.filter((d) => (counts.get(d.key) ?? 0) > (seenRounds.get(d.key) ?? 0)
        && (values.key === undefined || d.key === values.key));
      for (const [k, n] of counts) seenRounds.set(k, n);
      let found = [...new Map([...hit.filter((d) => d.answer), ...fresh].map((d) => [d.key, d] as const)).values()];
      // The answers this wait hands over: a filer wait without --key gives only the ones it has not taken yet.
      let given = hit.flatMap((d) => (d.answer ? [d.answer] : []));
      if (found.length && filer !== undefined) {
        // Taken under a lock, so two waits for one filer never both hand over the same answer (another-round asks are not deduped here).
        found = await locked(`${seenPath(file)}.lock`, () => {
          const now = seenBy(file), left = found.filter((d) => values.key !== undefined || fresh.includes(d) || !now(d.answer!));
          const taking = left.flatMap((d) => (d.answer && !now(d.answer) ? [d.answer] : []));
          markSeen(file, taking);
          if (values.key === undefined) given = taking;
          return left;
        }, 'another wait is still taking answers');
      }
      if (found.length && values.events) return eventLines(file, found, given, asked.filter((r) => fresh.some((d) => d.key === r.key)));
      if (found.length) {
        return printAnswers(file, found, waiting, values,
          [waiting ? `Run \`sign-off-axi wait${on}\` for the next of the ${waiting} waiting` : `Run \`sign-off-axi stop${onBoard}\` to close the board`]);
      }
      // Private vault expiries and refusals reach a filer wait only once its ordinary answers are out; each is taken once.
      let live = 0, unknown = false;
      if (filer !== undefined && values.key === undefined) {
        const vault = await takeVaultExpiries(file, filer).catch(() => undefined);
        unknown = !vault;
        if ((!vault || !vault.clean) && !vaultWarned) { vaultWarned = true; warn('Vault expiry status unavailable; ordinary answers still arrive.'); }
        if (vault?.events.length) return vaultEvent(file, vault.events, values);
        live = vault?.live ?? 0;
      }
      // A keyed filer wait reads its own item's expiry or refusal, unless one of its board rows already holds the key.
      if (filer !== undefined && values.key !== undefined && isKey(values.key) && !rows.some((d) => d.key === values.key)) {
        let event;
        try { event = await readVaultExpiry(file, values.key, filer, true); } catch (e: any) {
          if (e?.code !== 'READER_MISMATCH' && !vaultWarned) { vaultWarned = true; warn('Vault expiry status unavailable; ordinary answers still arrive.'); }
        }
        if (event) return vaultEvent(file, [{ key: values.key, at: event.at, status: event.status }], values);
      }
      // A dismissed ask is hidden from the board, not withdrawn: it is not counted as waiting, but the agent still waits on it.
      if (values.key === undefined && !rows.some((d) => waits({ ...d, dismissed: false })) && !live && !unknown) {
        throw fail(`nothing${filer ? ` posted by ${filer}` : ''} is waiting on ${tilde(file)}`, 'NOT_FOUND', `Run \`sign-off-axi answers${onBoard}\` to read the saved answers`, `Run \`sign-off-axi raise${on} --title "<question>"\` to ask a new one`);
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        if (key && !hit.length) throw fail(`no decision with key ${values.key}${filer ? ` posted by ${filer}` : ''} was raised on ${tilde(file)} within ${seconds}s`, 'TIMEOUT', `Run \`sign-off-axi list${onBoard}\` to see the waiting keys`);
        throw fail(`no answer${key ? ` for ${values.key}` : ''} within ${seconds}s`, 'TIMEOUT', `Run \`sign-off-axi wait${on}${key} --timeout ${seconds}\` to keep waiting`,
          ...(await running(file).catch(() => true) ? [] : [`Run \`sign-off-axi open${onBoard}\` so the user can answer: the board is not open`]));
      }
      await new Promise<void>((ok) => {
        const timer = setTimeout(ok, Math.min(1000, left));
        wake = () => { clearTimeout(timer); ok(); };
      });
    }
  } finally {
    watcher?.close();
  }
}

/** Metadata only: a fixed sentence, never a value, URL, path or filer. Failures exit 1; a delivery exits 0 with a label.
 * One poll takes one kind, so all events share a status. */
const VAULT_EVENTS: Record<VaultExpiry['status'], { sentence: string; code?: string }> = {
  expired: { sentence: errors.EXPIRED, code: 'EXPIRED' },
  refused: { sentence: errors.REFUSED, code: 'REFUSED' },
  'delivery-uncertain': { sentence: errors.DELIVERY_UNCERTAIN, code: 'DELIVERY_UNCERTAIN' },
  delivered: { sentence: 'Saved to the approved destination file.' },
};
function vaultEvent(file: string, events: { key: string; at: number; status: VaultExpiry['status'] }[], values: Record<string, any>) {
  const status = events[0].status, { sentence, code } = VAULT_EVENTS[status], at = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z';
  if (code) process.exitCode = 1;
  if (values.json) return JSON.stringify(Object.fromEntries(events.map((e) => [e.key, { answer: status, label: sentence, close: 'done', at: at(e.at) }])));
  return toon({ board: tilde(file), [status]: events.map((e) => ({ key: e.key, at: at(e.at) })), ...(code ? { error: sentence, code } : { label: sentence }) },
    code ? ['Ask for a fresh item under a new key'] : []);
}
// Only these leave the item deliverable later; every other vault code is final for this wait.
const INTO_RETRY = ['BUSY', 'NOT_FOUND', 'VAULT_KEY_UNAVAILABLE'];
const INTO_HELP: Record<string, string> = { DESTINATION_DENIED: 'Fix the destination folder locally, then run the same wait again', DESTINATION_EXISTS: 'Fix the destination folder locally, then run the same wait again',
  READER_MISMATCH: 'Check --key, --filer and --into against the item', VALIDATION_ERROR: 'Check --key, --filer and --into against the item' };
/** `wait --into`: delivers one Give once into its bound file, polling while it is pending. The destination is never printed. */
async function waitInto(file: string, values: Record<string, any>, onBoard: string) {
  const { key, filer, into } = values, seconds = Number(values.timeout), deadline = Date.now() + seconds * 1000;
  // An explicit --filer: an inherited SIGN_OFF_FILER must not route a secret write.
  if (key === undefined || filer === undefined) throw fail('wait --into needs --key and --filer', 'VALIDATION_ERROR', 'Pass the Give item\'s --key and your own --filer');
  let warned = false;
  for (;;) {
    let done;
    try { done = await deliverVault(file, key, filer, into); } catch (e) {
      const code = e instanceof VaultError ? e.code : 'BUSY';
      if (!INTO_RETRY.includes(code)) throw fail(errors[code], code, INTO_HELP[code] ?? 'Ask for a fresh item under a new key');
      if (code !== 'NOT_FOUND' && !warned) { warned = true; warn('Vault delivery status unavailable; still waiting.'); }
    }
    if (done) return vaultEvent(file, [done], values);
    const left = deadline - Date.now();
    if (left <= 0) throw fail(`no vault item with key ${key} was ready to deliver within ${seconds}s`, 'TIMEOUT', `Run \`sign-off-axi wait${onBoard} --key ${key} --filer ${filer} --into <file> --timeout ${seconds}\` to keep waiting`);
    await new Promise((ok) => setTimeout(ok, Math.min(1000, left)));
  }
}

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 64).replace(/^-+|-+$/g, '') || 'decision';
/** Runs fn while holding an exclusive lock file that names its pid, so two agents raising at once never drop a decision,
 * and a lock a crash left behind can be told apart from one in use. */
async function locked<T>(lock: string, fn: () => T | Promise<T>, busy = 'another raise is still writing the board', tries = 150): Promise<T> {
  for (;;) {
    try { writeFileSync(lock, `${process.pid}\n`, { flag: 'wx', mode: 0o600 }); break; } catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
      if (!tries--) {
        throw staleLock(lock) ? fail(`a sign-off-axi that stopped mid-write left ${basename(lock)} behind`, 'BUSY', `Run \`rm ${shellPath(lock)}\`, then try again`)
          : fail(busy, 'BUSY', `If no sign-off-axi is running, delete ${tilde(lock)} and try again`);
      }
      await new Promise((ok) => setTimeout(ok, 20));
    }
  }
  try { return await fn(); } finally { rmSync(lock, { force: true }); }
}

/** A mock path without its optional `?variant=<name>` suffix, which picks one variant of a single .html page. */
const mockFile = (path: string) => path.split('?')[0];
/** Posts an item. `raise` is the alias for `post --type decision`: same flags as before, same output. */
function post(args: string[], cmd = 'post') {
  const typed: Flags = cmd === 'post' ? { replace: { type: 'boolean' }, kind: { type: 'string' }, type: { type: 'string' }, tradeoff: { type: 'string' }, mock: { type: 'string', multiple: true },
    media: { type: 'string', multiple: true }, link: { type: 'string' }, view: { type: 'string' }, preview: { type: 'string' }, chapter: { type: 'string', multiple: true },
    ...Object.fromEntries(SIGNIN_FIELDS.map((f) => [f, { type: 'string' as const }])) } : {};
  const { file, values, on } = parse(cmd, args, { from: { type: 'string' }, filer: { type: 'string' }, ...typed,
    ...Object.fromEntries(RAISE_FIELDS.map((f) => [f, { type: 'string' as const, multiple: f === 'option' }])) });
  const given = [...RAISE_FIELDS, 'type', 'tradeoff', 'mock', 'media', 'link', 'view', 'preview', 'chapter', ...SIGNIN_FIELDS].filter((f) => values[f] !== undefined);
  if (values.kind !== undefined) {
    const odd = [...given, ...(values.replace ? ['replace'] : [])][0];
    if (odd) throw fail(`--kind cannot be combined with --${odd}`, 'VALIDATION_ERROR', 'Put every field in the message file: sign-off-axi post --kind ask --from ask.json');
    return postKind(file, on, values);
  }
  if (values.from !== undefined && given.length) throw fail(`--from cannot be combined with --${given[0]}`, 'VALIDATION_ERROR', `Put every field in the --from file, or ${cmd} with flags only`);
  if (values.replace) return replace(file, on, values.from, filerOf(values));
  const filer = filerOf(values, true);
  const type = values.type ?? 'decision';
  if (type === 'report') return postReport(file, on, values);
  if (type === 'signin') return postSignin(file, on, values, filer);
  const odd = SIGNIN_FIELDS.find((f) => values[f] !== undefined);
  if (odd) throw fail(`--${odd} needs --type signin`, 'VALIDATION_ERROR', 'Run `sign-off-axi post --help`');
  if (values.preview !== undefined) throw fail('--preview needs --type report', 'VALIDATION_ERROR', 'Run `sign-off-axi post --help`');
  if (values.from === undefined && values.title === undefined) {
    throw fail('--title is required (or --from <decisions.json>)', 'VALIDATION_ERROR', type === 'design' ? 'sign-off-axi post --type design --title "<question>" --option a=A --option b=B --recommend a'
      : type === 'evidence' ? 'sign-off-axi post --type evidence --title "<what this shows>" --about "<short note>" --media <file>' : `sign-off-axi ${cmd} --title "<question>" [--recommend <value>]`);
  }
  if (!['decision', 'design', 'evidence', 'diagram', 'interactive', 'explainer'].includes(type)) throw fail(`--type must be decision, design, evidence, diagram, interactive, explainer, report or signin`, 'VALIDATION_ERROR', 'Run `sign-off-axi post --help`');
  if (type === 'evidence' || type === 'explainer') return postMedia(file, on, values, type, filer);
  if (values.media !== undefined || values.link !== undefined || values.chapter !== undefined) throw fail('--media, --link and --chapter need --type evidence or explainer', 'VALIDATION_ERROR', 'Run `sign-off-axi post --help`');
  if (type !== 'design' && (values.tradeoff !== undefined || values.mock !== undefined)) throw fail('--tradeoff and --mock need --type design', 'VALIDATION_ERROR', 'Run `sign-off-axi post --help`');
  const view = type === 'diagram' || type === 'interactive';
  if (view !== (values.view !== undefined)) throw fail(view ? `--type ${type} needs --view <path>` : '--view needs --type diagram or interactive', 'VALIDATION_ERROR', 'Run `sign-off-axi post --help`');
  if (type === 'decision') return storeIncoming(file, on, buildIncoming(values, {}, filer, file), filer);
  const root = resolve(dirname(file));
  if (view) {
    // The same real-path check the board serves with, so a post that passes always renders.
    const escapes = () => fail(`--view ${values.view} escapes the board folder`, 'VALIDATION_ERROR', 'Keep the file next to the board file, under mocks/<key>/');
    if (!resolve(root, values.view).startsWith(root + sep)) throw escapes();
    let actual;
    try { actual = under(root, values.view); } catch (e: any) {
      throw e.message === 'no matching mock file' ? fail(`--view ${values.view} is not a file in ${tilde(root)}`, 'NOT_FOUND', 'Paths are relative to the board file\'s folder') : escapes();
    }
    let size: Stats;
    try { size = statSync(actual); } catch (e: any) { throw fail(`--view ${values.view} ${reasonOf(e.code)}`, 'VALIDATION_ERROR', 'Shrink the picture, or post an interactive page instead of a diagram'); }
    if (!size.isFile() || size.size > MOCK_BYTES) throw fail(`--view ${values.view} must be a file of 5 MB or less`, 'VALIDATION_ERROR', 'Shrink the picture, or post an interactive page instead of a diagram');
    return storeIncoming(file, on, buildIncoming(values, { type, view: values.view }, filer, file), filer);
  }
  const mocks = values.mock?.map((m: string) => {
    const at = m.indexOf('=');
    if (at < 1) throw fail(`--mock ${m} must be <value>=<path>`, 'VALIDATION_ERROR', 'sign-off-axi post --type design --title "<question>" --option a=A --option b=B --mock a=mocks/a.html --recommend a');
    const path = m.slice(at + 1), name = mockFile(path);
    if (!mockTypes[extname(name).toLowerCase()]) throw fail(`--mock ${path} must end in ${Object.keys(mockTypes).join(', ')}`, 'VALIDATION_ERROR', 'Name the mock file itself: .html, an image, or a screenshot of the variant');
    if (!resolve(root, name).startsWith(root + sep)) throw fail(`--mock ${path} escapes the board folder`, 'VALIDATION_ERROR', 'Keep mock files next to the board file');
    let info: Stats | undefined;
    try { info = statSync(resolve(root, name), { throwIfNoEntry: false }); } catch (e: any) { throw fail(`--mock ${path} ${reasonOf(e.code)}`, 'VALIDATION_ERROR', 'Shrink the mock, or point --mock at the screenshot of the variant'); }
    // A mock that is not there posts on purpose (the card says so); one the board could never serve is refused here, as --view is.
    if (info && (!info.isFile() || info.size > MOCK_BYTES)) {
      throw fail(`--mock ${path} must be a file of 5 MB or less`, 'VALIDATION_ERROR', 'Shrink the mock, or point --mock at the screenshot of the variant');
    }
    return { value: m.slice(0, at), path };
  });
  return storeIncoming(file, on, buildIncoming(values, { type, tradeoff: values.tradeoff, mocks }, filer, file), filer);
}

const SIGNIN_FIELDS = ['service', 'unlocks', 'waits', 'expires', 'start'];
const SIGNIN_EXAMPLE = 'sign-off-axi post --type signin --key npm-login --service npm --link https://example.com/login --unlocks "Publish the release" --waits "Main" --expires 15m';
const SIGNIN_START_EXAMPLE = 'sign-off-axi post --type signin --key npm-login --service npm --start \'["npm", "login", "--auth-type=web"]\' --unlocks "Publish the release" --waits "Main"';
/** --expires: an ISO date-time, or a time from now such as 90s, 15m, 2h or 1d; refused when it is already past. */
function expiresAt(value: string) {
  const span = /^(\d{1,6})([smhd])$/.exec(value), at = span ? Date.now() + Number(span[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[span[2] as 's']
    : /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
  if (!(at > Date.now())) throw fail(`--expires ${value} must be a time still to come: an ISO date-time such as 2026-10-13T07:19:00Z, or a time from now such as 15m`, 'VALIDATION_ERROR', SIGNIN_EXAMPLE);
  return new Date(at).toISOString().replace(/\.\d+Z$/, 'Z');
}
/** post --type signin: one card with a link to open. The same key again with another link or time swaps them on that card, which waits again.
 * The link can hold a one-time code, so no output prints it. */
function postSignin(file: string, on: string, values: Record<string, any>, filer?: string) {
  const odd = ['title', 'about', 'detail', 'option', 'recommend', 'default', 'close', 'tradeoff', 'mock', 'media', 'view', 'preview', 'chapter'].find((f) => values[f] !== undefined);
  if (odd) throw fail(`--${odd} does not apply to --type signin`, 'VALIDATION_ERROR', SIGNIN_EXAMPLE);
  const missing = ['service', ...(values.start === undefined ? ['link'] : []), 'unlocks', 'waits'].filter((f) => values[f] === undefined);
  if (missing.length) throw fail(`--type signin needs ${missing.map((f) => `--${f}`).join(', ')}${values.link === undefined ? ' (or --start in place of --link)' : ''}`, 'VALIDATION_ERROR', SIGNIN_EXAMPLE);
  const { service, link, unlocks, waits: who, key = `signin-${slug(service)}` } = values;
  let start: string[] | undefined;
  if (values.start !== undefined) {
    try { start = JSON.parse(values.start); } catch { start = undefined; }
    if (!Array.isArray(start)) throw fail('--start must be the command as a JSON list, such as \'["npm", "login", "--auth-type=web"]\'', 'VALIDATION_ERROR', SIGNIN_START_EXAMPLE);
    if (values.link !== undefined || values.expires !== undefined) throw fail(`--${values.link !== undefined ? 'link' : 'expires'} does not apply with --start: each tap makes a new link`, 'VALIDATION_ERROR', SIGNIN_START_EXAMPLE);
  }
  const expires = values.expires === undefined ? undefined : expiresAt(values.expires);
  const { incoming: [d], raw: [item] } = buildIncoming({ title: service, key }, { type: 'signin', link, unlocks, waits: who, ...(expires && { expires }), ...(start && { start }) }, filer, file);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  return locked(`${file}.lock`, () => {
    const items = existsSync(file) ? readItems(file).items : [], at = items.findIndex((x) => x?.key === d.key), had = items[at];
    if (had && had.type !== 'signin') throw fail(`key ${d.key} already holds a different question on ${tilde(file)}`, 'CONFLICT', 'Post the sign-in under a new --key');
    const same = had && canon({ ...had, filed: undefined, filer: undefined }) === canon({ ...item, filed: undefined, filer: undefined });
    const done = readAnswers(file)[d.key];
    let status = same ? (done ? 'already done' : 'already waiting') : had ? 'new link' : 'posted';
    if (!same) {
      fits(d.title, d.key);
      const next = { ...item, filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
      if (had) items[at] = next; else items.push(next);
      writeItems(file, items);
      // A new link is a new sign-in: the card waits again, also when it was done or dismissed.
      appendAnswer(file, d, CLEARED);
      if (had) appendDismissed(file, [d.key], false);
    }
    return toon({ board: tilde(file), posted: [{ key: d.key, status, service: d.title, ...(expires && { expires }) }] }, [
      ...(status === 'already done' ? [] : [`Run \`sign-off-axi open${on}\` so the user can sign in`]),
      `Run \`sign-off-axi signin done${on} --key ${d.key}\` when the sign-in is done; the card then closes`,
      ...(start ? [] : [`Run \`sign-off-axi post${on} --type signin --key ${d.key} ...\` again with a new --link and --expires when this link expires`])]);
  });
}
/** signin done [board.json] --key <key>: the sign-in is done, so its card leaves the open list and shows as done. */
function signin(args: string[]) {
  const [sub, ...rest] = args;
  if (sub !== 'done') throw fail(`unknown signin command ${sub ?? '(none)'}`, 'VALIDATION_ERROR', 'sign-off-axi signin done [board.json] --key <key>');
  const { file, values, on } = parse('signin done', rest, { key: { type: 'string' } });
  if (values.key === undefined) throw fail('signin done needs --key <key>', 'VALIDATION_ERROR', 'sign-off-axi signin done [board.json] --key <key>');
  return locked(`${file}.lock`, () => {
    const d = board(file).find((x) => x.key === values.key);
    if (d?.type !== 'signin') throw fail(`no sign-in with key ${values.key} on ${tilde(file)}`, 'NOT_FOUND', `Run \`sign-off-axi list${on}\` to see the waiting keys`);
    const saved = appendAnswer(file, d, SIGNED_IN);
    return toon({ board: tilde(file), closed: [{ key: d.key, status: saved ? 'done' : 'already done', service: d.title }] }, [`Run \`sign-off-axi list${on}\` to see what still waits on the user`]);
  });
}

/** For a program that feeds the board: the --from file, checked like any post, becomes the whole board, items and top-level fields. Answers stay.
 * With a filer it replaces only that filer's items (and items with no filer it names by key); every other item and top-level field stays. */
function replace(file: string, on: string, from?: string, filer?: string) {
  if (from === undefined) throw fail('--replace needs --from <board file>', 'VALIDATION_ERROR', 'sign-off-axi post board.json --from feed.json --replace');
  const source = resolve(from), fed = readItems(source);
  contractItems(fed.items, from, file, true);
  const incoming = loadDecisions(source);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  return locked(`${file}.lock`, () => {
    // An item the feed sends without a time keeps the one it was first posted with, so a feeder that runs every few seconds never resets it.
    const first = new Map((existsSync(file) ? readItems(file).items : []).map((i) => [i?.key, i])), now = new Date().toISOString();
    for (const i of fed.items) if (first.get(i?.key)?.title !== i?.title) fits(i?.title, i?.key);
    const feed = fed.items.map((i) => ({ filed: first.get(i?.key)?.filed ?? now, ...i, ...(filer && { filer }) }));
    // An answer belongs to its question: an answered key may not come back asking something else.
    // Evidence is answered for the media and run it shows, so those are part of its question too, as a gate's run and a finding's proposal are.
    const question = (d: Decision) => JSON.stringify([d.title, [...d.options].sort((a, b) => a.value.localeCompare(b.value)), !!d.reply, d.run, d.finding, d.evidence, d.media, d.type === 'signin' ? [d.link, d.start] : '']);
    // A key whose answer outlived it may not come back: the board and the answers are read here, under the lock the feed writes with.
    const saved = readAnswers(file);
    for (const i of fed.items) if (i?.kind !== undefined && !first.has(i?.key) && Object.hasOwn(saved, i?.key)) {
      throw fail(`key ${i.key} was answered on ${tilde(file)} and is no longer there`, 'CONFLICT', 'Post it under a new key');
    }
    for (const had of board(file)) {
      const d = incoming.find((x) => x.key === had.key);
      if (filer && d && had.filer && had.filer !== filer) throw fail(`key ${d.key} on ${tilde(file)} was posted by another filer`, 'CONFLICT', 'Feed it under a new key');
      if (had.answer && d && question(d) !== question(had)) {
        throw fail(`key ${d.key} was answered and now holds a different question on ${tilde(file)}`, 'CONFLICT', 'Post the new question under a new key');
      }
    }
    const old = existsSync(file) ? readItems(file) : undefined;
    let items = feed, extra = fed.extra;
    if (filer) {
      // The feed's items first: the board shows the file's last item first, so the other filers' items keep showing on top.
      const named = new Set(feed.map((i) => i.key));
      items = [...feed, ...(old?.items ?? []).filter((i) => i?.filer !== filer && !named.has(i?.key))];
      extra = { ...old?.extra, ...fed.extra };
      // The merged board is checked before it is written, so a feed that breaks another filer's items leaves the board as it was.
      const check = `${file}.${process.pid}.check`;
      writeFileSync(check, JSON.stringify({ ...extra, schema: 2, items }), { mode: 0o600 });
      try { loadDecisions(check); } catch (e) {
        throw e instanceof InputError ? new InputError(e.message.replace(basename(check), basename(file))) : e;
      } finally {
        rmSync(check, { force: true });
      }
    }
    // Written only when it changed, so a feeder that runs every few seconds leaves the file alone.
    const changed = JSON.stringify(old && { ...old.extra, schema: old.schema, items: old.items }) !== JSON.stringify({ ...extra, schema: 2, items });
    if (changed) writeItems(file, items, extra);
    return toon({ board: tilde(file), items: items.length, changed }, [`Run \`sign-off-axi answers${on}\` to read the answers`]);
  });
}

/** Copies the media into evidence/<n>/ next to the board and adds the item, numbered under the board lock: update-<n>, or an explainer under its own key.
 * `message` is a checked contract evidence message (post --kind evidence): its key, if any, takes only the same message again, and its run is stored as `evidence`. */
function postMedia(file: string, on: string, values: Record<string, any>, type: 'evidence' | 'explainer', filer?: string, message?: any) {
  fits(values.title);
  const explainer = type === 'explainer';
  const extra = (explainer ? ['mock', 'tradeoff', 'view', 'link'] : ['key', 'option', 'recommend', 'default', 'mock', 'tradeoff', 'view', 'chapter']).find((f) => values[f] !== undefined);
  if (extra) throw fail(`--${extra} does not apply to --type ${type}`, 'VALIDATION_ERROR', 'Run `sign-off-axi post --help`');
  const example = explainer ? 'sign-off-axi post --type explainer --title "<question>" --about "<short summary>" --media explainer.mp4'
    : 'sign-off-axi post --type evidence --title "<what this shows>" --about "<short note>" --media shot.png';
  if (!explainer && !values.about?.trim()) throw fail('--about is required for --type evidence: the short note', 'VALIDATION_ERROR', example);
  if (explainer && values.media?.length !== 1) throw fail('--type explainer needs one --media video (.mp4 or .webm)', 'VALIDATION_ERROR', example);
  if ((!message && !values.media?.length) || values.media.length > MEDIA_MAX) throw fail(`--type evidence needs 1 to ${MEDIA_MAX} --media files`, 'VALIDATION_ERROR', example);
  const kinds = explainer ? ['.mp4', '.webm'] : Object.keys(mediaTypes), options = optionsOf(values);
  recommended([{ options, recommend_value: values.recommend }], true);
  const chapters = values.chapter?.map((c: string) => {
    const m = /^(\d{1,3}):([0-5]\d)=(.+)$/.exec(c);
    if (!m) throw fail(`--chapter ${c} must be <m:ss>=<title>`, 'VALIDATION_ERROR', 'sign-off-axi post --type explainer ... --chapter 0:00=Start --chapter 0:12="Step 2"');
    return { at: Number(m[1]) * 60 + Number(m[2]), title: m[3] };
  });
  const sources: string[] = values.media.map((m: string) => {
    const path = resolve(m);
    let info: Stats | undefined;
    try { info = statSync(path, { throwIfNoEntry: false }); } catch (e: any) { throw fail(`--media ${m} ${reasonOf(e.code)}`, 'NOT_FOUND', 'Name a file that is there, such as the screenshot you just took'); }
    if (!kinds.includes(extname(path).toLowerCase())) throw fail(`--media ${m} must end in ${kinds.join(', ')}`, 'VALIDATION_ERROR', example);
    if (!info?.isFile()) throw fail(`--media ${m} ${info || existsSync(path) ? 'is not a file' : 'is not there'}`, 'NOT_FOUND', 'Name a file that is there, such as the screenshot you just took');
    if (info.size > MEDIA_BYTES) throw fail(`--media ${tilde(path)} is over 50 MB`, 'VALIDATION_ERROR', 'Trim or compress the recording');
    return path;
  });
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  return locked(`${file}.lock`, () => {
    const { items, extra } = existsSync(file) ? readItems(file) : { items: [] as any[], extra: {} };
    // Boards in one folder share evidence/, so a number is taken only by creating its folder; one in use is never written into.
    const current = board(file), store = join(dirname(file), 'evidence'), taken = current.map((d) => Number(/^update-(\d+)$/.exec(d.key)?.[1] ?? 0));
    const own = message ? message.key : explainer && (values.key ?? slug(values.title)), had = message && own && items.find((x) => x?.key === own);
    if (had) {
      // The stored item, read back as the message it came from: its run, and each media file by hash.
      const asMessage = ({ type: _t, number: _n, filed: _f, evidence: run, media: kept, ...rest }: any) => canon({ ...rest, run, media: kept?.map((x: any) => x.sha256) });
      if (asMessage(had) !== canon({ ...message, media: sources.length ? sources.map((src) => sha256(readFileSync(src))) : undefined })) {
        throw fail(`key ${own} already holds a different message on ${tilde(file)}`, 'CONFLICT', 'Post it under a new key');
      }
      return toon({ board: tilde(file), posted: [{ key: own, number: had.number, media: sources.length, title: had.title, status: 'already posted' }] }, [`Run \`sign-off-axi open${on}\` so the user can give a verdict`]);
    }
    if (message && own && Object.hasOwn(readAnswers(file), own)) throw fail(`key ${own} was answered on ${tilde(file)} and is no longer there`, 'CONFLICT', 'Post it under a new key');
    if (own && current.some((d) => d.key === own)) throw fail(`key ${own} is already used on ${tilde(file)}`, 'CONFLICT', 'Post it under a new --key');
    mkdirSync(store, { recursive: true, mode: 0o700 });
    let number = Math.max(0, ...taken, ...readdirSync(store).map(Number).filter(Number.isInteger)) + 1;
    for (;; number++) {
      try { mkdirSync(join(store, String(number)), { mode: 0o700 }); break; } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
    }
    const key = own || `update-${number}`, dir = join(store, String(number));
    let media;
    try {
      media = sources.map((src, i) => {
        const bytes = readFileSync(src), path = `evidence/${number}/${i + 1}${extname(src).toLowerCase()}`;
        writeFileSync(join(dir, `${i + 1}${extname(src).toLowerCase()}`), bytes, { mode: 0o600 });
        return { path, sha256: sha256(bytes), bytes: bytes.length };
      });
    } catch (e) {
      // A file that cannot be read after all leaves no copies behind.
      rmSync(dir, { recursive: true, force: true });
      throw e;
    }
    const { title, about, detail, close, link, recommend: recommend_value, default: default_if_silent } = values, filed = new Date().toISOString();
    const { run, media: _paths, ...fields } = message ?? {};
    items.push(explainer ? { key, type, title, about, detail, options, recommend_value, default_if_silent, close, chapters, media, filer, filed }
      : message ? { ...fields, key, type, number, ...(media.length ? { media } : {}), ...(run && { evidence: run }), filed }
      : { key, type, number, title, about, detail, close, link, media, filer, filed });
    // The whole board is checked before it is written, so a bad post leaves the board and evidence/ as they were.
    const check = `${file}.${process.pid}.check`;
    writeFileSync(check, JSON.stringify({ ...extra, schema: 2, items }), { mode: 0o600 });
    try { loadDecisions(check); } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      throw e instanceof InputError ? new InputError(e.message.replace(basename(check), basename(file))) : e;
    } finally {
      rmSync(check, { force: true });
    }
    writeItems(file, items);
    if (explainer) return toon({ board: tilde(file), raised: [{ key, status: 'raised', title }] }, [`Run \`sign-off-axi open${on}\` so the user can watch and answer`, waitFor(on, filer, key)]);
    return toon({ board: tilde(file), posted: [{ key, number, media: media.length, title, ...(message && { status: 'posted' }) }] },
      [`Run \`sign-off-axi open${on}\` so the user can give a verdict`, waitFor(on, filer, key)]);
  });
}

/** post --type report: the flags as one report message, posted as post --kind report posts it. A report with no page is refused before anything is read. */
function postReport(file: string, on: string, values: Record<string, any>) {
  const odd = ['option', 'recommend', 'default', 'close', 'detail', 'mock', 'tradeoff', 'media', 'chapter'].find((f) => values[f] !== undefined);
  if (odd) throw fail(`--${odd} does not apply to --type report: a report takes no answer`, 'VALIDATION_ERROR', 'Run `sign-off-axi post --help`');
  const missing = ['title', 'about', 'view', 'preview'].filter((f) => values[f] === undefined).map((f) => `--${f}`);
  if (missing.length) {
    throw fail(`a report is a page to tap through, not text: ${missing.join(' and ').replace(/ and (?=.* and )/g, ', ')} ${missing.length > 1 ? 'are' : 'is'} missing`, 'VALIDATION_ERROR',
      `Run \`${REPORT_INIT}\` to make the page and its picture, fill them, then post --type report --title "<the answer>" --about "<why it matters>" --view <folder>/index.html --preview <folder>/preview.svg`);
  }
  const key = values.key ?? slug(values.title), had = existsSync(file) ? readItems(file).items.find((i) => i?.key === key) : undefined;
  // Posting the same report again is a no-op, so it keeps the time it was first filed.
  const filed = (had?.kind === 'report' && had.filed) || new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const { title, about, view, preview, link } = values;
  return postKind(file, on, values, { contract: 1, kind: 'report', schema: 2, key, title, about, view, preview, ...(link !== undefined && { link }), filed });
}

/** Posts one contract message (docs/contract.md), from a file or from stdin with --from -: checked against --kind, then stored like a raised item.
 * `built` is a message post --type report made from its flags. */
async function postKind(file: string, on: string, values: Record<string, any>, built?: object) {
  const { kind, from } = values, example = 'sign-off-axi post --kind ask --from ask.json';
  const name = built ? '--type report' : from === '-' ? 'stdin' : from;
  let bytes, m: any = built;
  if (!built) {
    if (!KINDS.includes(kind)) throw fail(`--kind must be one of ${KINDS.join(', ')}`, 'VALIDATION_ERROR', example);
    if (from === undefined) throw fail('--kind needs --from <message.json>, or --from - to read stdin', 'VALIDATION_ERROR', example);
    try { bytes = readFileSync(from === '-' ? 0 : from); } catch (e: any) { throw fail(`${name} ${reasonOf(e.code)}`, 'NOT_FOUND', 'Check the path names a readable file'); }
  }
  let sources: string[] = [];
  try {
    m ??= parseMessage(bytes!);
    checkMessage(m, built ? 'report' : kind);
    postable(m);
    // Media paths read from the message file's folder, or from the current folder for stdin.
    if (m.kind === 'evidence') sources = mediaFiles(m, from === '-' ? process.cwd() : dirname(resolve(from)));
    // A report's page is served from the board file's folder, as --view is.
    if (m.kind === 'report') reportPage(m, dirname(file));
  } catch (e) { throw e instanceof ContractError ? fail(`${name}: ${e.message}`, 'VALIDATION_ERROR', e.help) : e; }
  if (m.filer !== undefined && values.filer !== undefined && m.filer !== values.filer) {
    throw fail(`${name}: key ${m.key}: filer ${m.filer} is not --filer ${values.filer}`, 'VALIDATION_ERROR', 'Leave "filer" out of the message, or pass the same --filer');
  }
  const filer = m.filer ?? filerOf(values, true), scratch = mkdtempSync(join(tmpdir(), 'sign-off-')), source = join(scratch, basename(name));
  try {
    if (m.kind === 'evidence') return await postMedia(file, on, { title: m.title, about: m.about, media: sources }, 'evidence', filer, { ...m, ...(filer && { filer }) });
    writeFileSync(source, JSON.stringify({ schema: 2, items: [{ ...m, ...(filer && { filer }) }] }));
    return await storeIncoming(file, on, buildIncoming({ from: source }, {}, filer, file), filer, true);
  } catch (e) {
    if (!(e instanceof AxiError && e.code === 'CONFLICT')) throw e;
    // A key conflict refuses a contract post like any other rule: exit 2 (contract section 4); raise keeps exit 1.
    process.once('exit', () => { process.exitCode = 2; });
    throw fail(`${name}: ${e.message}`, 'CONFLICT', 'Post it under a new key');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Checks message files without posting them: one row per file, exit 2 when any is refused, 1 when any cannot be read. */
function validate(args: string[]) {
  let parsed;
  try { parsed = parseArgs({ args, allowPositionals: true, strict: true, options: { kind: { type: 'string' }, 'expect-invalid': { type: 'boolean' } } }); } catch (e: any) {
    throw fail(e.message, 'VALIDATION_ERROR', 'Run `sign-off-axi validate --help`');
  }
  const { values: { kind: want, 'expect-invalid': expect }, positionals: names } = parsed;
  if (!names.length) throw fail('name at least one message file', 'VALIDATION_ERROR', 'sign-off-axi validate ask.json');
  if (want !== undefined && !KINDS.includes(want)) throw fail(`--kind must be one of ${KINDS.join(', ')}`, 'VALIDATION_ERROR', 'sign-off-axi validate --kind ask ask.json');
  let unread = false;
  const files = names.map((file) => {
    let raw, m: any;
    try { raw = readFileSync(file); } catch (e: any) {
      unread = true;
      // A file that is not there is refused like any other bad input, with the reason in words: the row's file column names it.
      return { file, kind: '', schema: '', ok: false, error: reasonOf(e.code), help: 'Check the path names a readable file' };
    }
    try {
      m = parseMessage(raw);
      const kind = checkMessage(m, want);
      if (m.kind === 'evidence') mediaFiles(m, dirname(resolve(file)));
      if (m.kind === 'report') reportPage(m, dirname(resolve(file)));
      return { file, ...kind, ok: true, error: '', help: '' };
    } catch (e) {
      if (!(e instanceof ContractError)) throw e;
      return { file, kind: typeof m?.kind === 'string' ? m.kind : '', schema: Number.isSafeInteger(m?.schema) ? m.schema : '', ok: false, error: e.message, help: e.help };
    }
  });
  // With --expect-invalid a file that passes is the miss: conformance holds invalid fixtures that must each be refused.
  const missed = files.some((f) => (expect ? f.ok : !f.ok));
  process.exitCode = unread ? 1 : missed ? 2 : 0;
  return toon({ files }, !process.exitCode ? [] : expect && missed ? ['Each file with ok true was accepted: make it break the one rule its name gives'] : ['Fix each refused file as its help says, then run validate again']);
}

const optionsOf = (values: Record<string, any>) => values.option?.map((o: string) => {
  const at = o.indexOf('=');
  if (at < 1) throw fail(`--option ${o} must be <value>=<label>`, 'VALIDATION_ERROR', 'sign-off-axi raise --title "<question>" --option friday=Friday --option next-week="Next week" --recommend friday');
  return { value: o.slice(0, at), label: o.slice(at + 1) };
});
/** Whoever lists the choices names the one they would pick: the board puts it first and marks it. A plain yes/no may leave it out,
 * and a program feeding a whole board with --replace is not held to it. */
function recommended(items: any[], flags: boolean) {
  const d = items.find((i) => i?.options?.length && i.recommend_value === undefined), values = d?.options.map((o: Option) => o.value).join(', ');
  if (d && flags) throw fail('--recommend is required when you list options', 'VALIDATION_ERROR', `Add --recommend <value>, the option you would pick: one of ${values}`);
  if (d) throw fail(`items[${items.indexOf(d)}] (key ${d.key}) lists options but no recommend_value`, 'VALIDATION_ERROR', `Add "recommend_value": "<value>", the option you would pick: one of ${values}`);
}
/** Flags are validated by the same loader as a file: write them as a one-decision file first. Items are checked against the board they go to, so its answers_only or readonly holds. */
function buildIncoming(values: Record<string, any>, extra: object, filer: string | undefined, file: string): { incoming: Decision[]; raw: object[] } {
  const board = existsSync(file) ? readItems(file).extra : {};
  if (values.from !== undefined) {
    // An item that names its own filer keeps it.
    const source = resolve(values.from), raw = readItems(source).items;
    contractItems(raw, values.from, file);
    const incoming = loadDecisions(source, board);
    recommended(raw, false);
    return { incoming: incoming.map((d) => ({ filer, ...d })), raw: raw.map((i) => ({ filer, ...i })) };
  }
  const scratch = mkdtempSync(join(tmpdir(), 'sign-off-'));
  const source = join(scratch, 'flags');
  try {
    const { title, key = slug(title), about, detail, recommend: recommend_value, default: default_if_silent, close } = values;
    writeFileSync(source, JSON.stringify({ schema: 2, items: [{ key, title, about, detail, options: optionsOf(values), recommend_value, default_if_silent, close, ...extra, filer }] }));
    const incoming = loadDecisions(source, board), raw = readItems(source).items;
    recommended(raw, true);
    return { incoming, raw };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** JSON with object fields in key order, so the same message compares equal in any field order. */
const canon = (v: unknown) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
/** exact: a contract post, where a key takes only the same message again, filer and filed included (contract section 4). */
function storeIncoming(file: string, on: string, { incoming, raw }: { incoming: Decision[]; raw: any[] }, filer?: string, exact = false) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  return locked(`${file}.lock`, () => {
    const current = board(file), items = existsSync(file) ? readItems(file).items : [], saved = readAnswers(file), now = new Date().toISOString();
    const raised = incoming.map((d, i) => {
      const had = current.find((c) => c.key === d.key);
      // A contract message refused for its key exits 2 like any other refusal (contract section 4); raise --title keeps exit 1.
      const contract = exact || raw[i]?.contract !== undefined || raw[i]?.kind !== undefined;
      const refuse = (why: string) => {
        if (contract) process.once('exit', () => { process.exitCode = 2; });
        return fail(`key ${d.key} ${why}`, 'CONFLICT', contract ? 'Post it under a new key' : 'Raise it under a new --key');
      };
      // An answer outlives its item: a new question under that key would inherit it.
      if (!had && Object.hasOwn(saved, d.key)) throw refuse(`already has a saved answer on ${tilde(file)} from an item no longer there`);
      // The same question from another filer, or at another time, is the same question: it keeps its first filer and time.
      const same = (x: Decision) => JSON.stringify({ ...x, answer: undefined, dismissed: undefined, filer: undefined, filed: undefined, options: [...x.options].sort((a, b) => a.value.localeCompare(b.value)) });
      // A message that names no filed time matches the one the board stamped.
      const differs = () => exact ? canon({ ...items.find((x) => x?.key === d.key), ...(raw[i].filed === undefined && { filed: undefined }) }) !== canon(raw[i]) : same(had!) !== same(d);
      if (had && differs()) throw refuse(`already holds a different ${contract ? 'message' : 'question'} on ${tilde(file)}`);
      // Each new item records when it was raised, unless it names its own time.
      if (!had) {
        fits(d.title, d.key);
        items.push({ filed: now, ...raw[i] });
      }
      return { key: d.key, status: !had ? 'raised' : had.answer ? `already answered ${had.answer.answer}` : waits({ ...had, dismissed: false }) ? 'already waiting' : 'already posted', title: d.title };
    });
    if (raised.some((r) => r.status === 'raised')) writeItems(file, items);
    const key = raised.length === 1 ? ` --key ${raised[0].key}` : '';
    // Reports take no answer, so a post with nothing waiting asks the user to read it, never to answer.
    const anyWaiting = incoming.some((d, i) => waits(d) && !raised[i].status.startsWith('already answered'));
    if (incoming.length && !anyWaiting) return toon({ board: tilde(file), raised }, [`Run \`sign-off-axi open${on}\` so the user can read ${incoming.length > 1 ? 'them' : 'it'}`]);
    const open = anyWaiting ? [`Run \`sign-off-axi open${on}\` so the user can answer`] : [];
    return toon({ board: tilde(file), raised }, [...open, ...(filer ? [waitFor(on, filer)] : []), `Run \`sign-off-axi answers${on}${key}\` to read ${key ? 'the answer' : 'the answers'}`]);
  });
}

async function open(args: string[]) {
  const { file, named, values, on } = parse('open', args, BOARD_FLAGS);
  const port = boardPort(named, values.port);
  ready(file, on, values['evidence-root']);
  const host = bindOf(named, values.bind);
  // The lock makes concurrent opens take turns, so a second one finds the first board instead of starting another.
  return locked(`${record(file)}.lock`, () => start(file, named, port, host, values, on), 'another open is still starting this board', 600);
}
async function start(file: string, named: string, port: number, host: string, values: Record<string, any>, on: string) {
  const live = await running(file);
  const answerLink = (url: string) => {
    if (loopback(host)) return url;
    const token = tokenOf(file);
    if (!token) throw fail(`${tilde(tokenFile(file))} is gone, so the running board refuses every link`, 'CONFLICT', `Run \`sign-off-axi stop${on}\`, then open it again`);
    return `${url}?token=${token}`;
  };
  const already = (url = live!.url) => toon({ board: tilde(file), url: answerLink(url), status: 'already open (no-op)' }, [`Tell the user to answer at ${answerLink(url)}`, `Run \`sign-off-axi stop${on}\` to close the board`]);
  if (live && !live.url.startsWith(`http://${urlHost(host)}:`)) {
    throw fail(`this board is already open at ${live.url}, not on ${host}`, 'CONFLICT', `Run \`sign-off-axi stop${on}\`, then open it again on the new address`);
  }
  if (live) return already();
  // A board serving this file without a record (a foreground serve) is adopted, so stop can close it.
  const adopt = (b: any) => b?.file === file && (writeFileSync(record(file), `${b.pid} ${port} ${host}\n`, { mode: 0o600 }), true);
  const shown = port ? await serving(port, host, file) : undefined;
  if (adopt(shown)) return already(`http://${urlHost(host)}:${port}/`);
  if (shown?.file) throw fail(`port ${port} already shows another board: ${tilde(shown.file)}`, 'CONFLICT', `Run \`sign-off-axi open${on} --port <free port>\``);
  // Appended, not truncated: a concurrent open's child may be writing the same log, so read only this child's lines.
  const log = `${file.replace(/\.json$/, '')}.board.log`, start = existsSync(log) ? statSync(log).size : 0, out = openSync(log, 'a', 0o600);
  const evidence = values['evidence-root'] ? ['--evidence-root', resolve(values['evidence-root'])] : [];
  const child = spawn(process.execPath, [process.argv[1], 'serve', named, '--port', String(port), '--bind', host, ...evidence], { detached: true, stdio: ['ignore', out, out] });
  closeSync(out);
  child.unref();
  let exit: number | null | undefined;
  child.once('exit', (code) => (exit = code));
  for (let waited = 0; waited < 10_000; waited += 50) {
    await new Promise((ok) => setTimeout(ok, 50));
    const text = readFileSync(log).subarray(start).toString(), url = new RegExp(`url: "(\\S+)"\\npid: ${child.pid}\\n`).exec(text)?.[1];
    if (url) {
      // The token is shown here, never in the log, so a log shared for help does not carry it.
      const link = answerLink(url);
      return toon({ board: tilde(file), url: link, pid: child.pid, status: 'opened' },
        [`Tell the user to answer at ${link}`, `Run \`sign-off-axi wait${on}\` to block until they answer`, `Run \`sign-off-axi stop${on}\` to close the board`]);
    }
    if (exit === undefined) continue;
    if (port && adopt(await serving(port, host, file))) return already(`http://${urlHost(host)}:${port}/`);
    throw fail([...text.matchAll(/^error: "?(.*?)"?$/gm)].pop()?.[1] ?? `the board stopped with exit ${exit}`, 'SERVE_FAILED', `Read ${tilde(log)}`);
  }
  throw fail('the board did not start within 10 seconds', 'SERVE_FAILED', `Read ${tilde(log)}`);
}

/** open records `<pid> <port> <bind address>` next to the board, so status and stop never guess a pid. */
const record = (file: string) => `${file.replace(/\.json$/, '')}.board.pid`;
/** What the board on this port serves; a busy server is an error, never mistaken for no server. */
const serving = (port: number, host: string, file: string) => fetch(`http://${urlHost(host)}:${port}/api/board`, {
  headers: loopback(host) ? {} : { cookie: `sign-off-${port}=${tokenOf(file)}` }, signal: AbortSignal.timeout(1000),
}).then((r) => (r.status === 401 ? { locked: true } : r.json())).then((b) => (b && typeof b.file !== 'string' ? { ...b, file: undefined } : b)).catch((e) => {
  if (e.name === 'TimeoutError') throw fail(`the board on port ${port} did not answer within 1 second`, 'BUSY', 'Run the command again in a moment');
});
const alive = (pid: number) => { try { return process.kill(pid, 0); } catch (e: any) { return e.code === 'EPERM'; } };
/** A lock whose pid is gone (or empty, from before locks held one): a crash left it, and every later write waits on it. */
const staleLock = (lock: string) => {
  try { const pid = Number(readFileSync(lock, 'utf8')); return !(pid > 0 && alive(pid)); } catch { return false; }
};
/** The board open started for this file, only while that pid really serves this file on that port. */
async function running(file: string) {
  const [pid, port, host = '127.0.0.1'] = (existsSync(record(file)) ? readFileSync(record(file), 'utf8') : '').trim().split(' ');
  const b = Number(port) ? await serving(Number(port), host, file) : undefined;
  // A board that refuses the token file (deleted or replaced while it runs) is still this board while its pid lives.
  const ours = b?.locked ? alive(Number(pid)) : b?.file === file && b?.pid === Number(pid);
  return ours ? { pid: Number(pid), url: `http://${urlHost(host)}:${port}/` } : undefined;
}

/** Loopback, or one private address: 10/8, 172.16/12, 192.168/16, the 100.64/10 range mesh VPNs use, IPv6 fc00::/7. Never all interfaces or a public one. */
const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|f[cd][0-9a-f]{2}:)/i;
const privateBind = (host: string) => isIP(host) > 0 && PRIVATE.test(host);
const loopback = (host: string) => /^127\./.test(host) || host === '::1';
const urlHost = (host: string) => (isIP(host) === 6 ? `[${host}]` : host);
/** The config.yaml beside the board as it is named, never beside the file a symlinked board points to: the one place open, serve and doctor read it. */
function setupOf(named: string) {
  const config = join(dirname(named), 'config.yaml');
  if (!existsSync(config)) return undefined;
  try { return readSetup(dirname(named)); } catch (e: any) {
    throw fail(`${basename(config)} ${reasonOf(e.code)}, so its port, bind and hosts lines are unknown`, 'VALIDATION_ERROR', `Make ${shellPath(config)} readable, or pass --port and --bind`);
  }
}
/** --bind, else the bind line of config.yaml next to the board, else 127.0.0.1. */
function bindOf(named: string, given?: string) {
  const host = given ?? setupOf(named)?.bind ?? '127.0.0.1';
  if (!privateBind(host)) throw fail(`bind address ${host} must be 127.0.0.1 or a private address of this machine, never all interfaces or a public address`,
    'VALIDATION_ERROR', 'Pass 127.0.0.1 or a private address of this machine');
  return host;
}
const tokenFile = (file: string) => `${file.replace(/\.json$/, '')}.token`;
/** The board's access token beyond loopback: made on the first such bind, kept mode 600 beside the board. */
function tokenOf(file: string, make = false) {
  if (make) {
    try { writeFileSync(tokenFile(file), `${randomBytes(24).toString('base64url')}\n`, { mode: 0o600, flag: 'wx' }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
  }
  let token = '';
  try { token = readFileSync(tokenFile(file), 'utf8').trim(); } catch {}
  if (make && !/^[\w-]{32,}$/.test(token)) throw fail(`${tilde(tokenFile(file))} holds no usable access token`, 'VALIDATION_ERROR', 'Delete it and open the board again to make a new one');
  return token;
}
/** Status and serve print the URL and point at the token file, never the token itself. */
const linkHelp = (file: string, url: string) => (loopback(new URL(url).hostname.replace(/^\[|\]$/g, '')) ? `Tell the user to answer at ${url}`
  : `Tell the user to answer at ${url}?token=<the token in ${tilde(tokenFile(file))}>`);

async function status(args: string[]) {
  const { file, values, on } = parse('status', args, { json: { type: 'boolean' } });
  const live = await running(file);
  if (values.json) return JSON.stringify({ board: file, status: live ? 'running' : 'not running', ...live });
  if (!live) return toon({ board: tilde(file), status: 'not running' }, [`Run \`sign-off-axi open${on}\` to start it`]);
  return toon({ board: tilde(file), status: 'running', ...live }, [linkHelp(file, live.url), `Run \`sign-off-axi stop${on}\` to close the board`]);
}

async function stop(args: string[]) {
  const { file, on } = parse('stop', args, {});
  const live = await running(file);
  if (live) {
    process.kill(live.pid, 'SIGTERM');
    for (let waited = 0; alive(live.pid); waited += 50) {
      if (waited >= 5000) throw fail(`the board (pid ${live.pid}) did not stop within 5 seconds`, 'STOP_FAILED', `Run \`sign-off-axi stop${on}\` again`);
      await new Promise((ok) => setTimeout(ok, 50));
    }
  }
  // A record whose pid no longer serves this board is stale: drop it and never signal that pid.
  rmSync(record(file), { force: true });
  return toon({ board: tilde(file), status: live ? 'stopped' : 'not running (no-op)', ...(live && { pid: live.pid }) }, [`Run \`sign-off-axi open${on}\` to start it again`]);
}

/** The repo dir for init/doctor: one optional positional, defaulting to the working folder. */
function repoDir(cmd: string, args: string[], options: Flags = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, strict: true, options });
  } catch {
    throw fail(`\`${cmd}\` takes only a folder${options.agent ? ' and --agent' : ''}`, 'VALIDATION_ERROR', `Run \`sign-off-axi ${cmd} --help\``);
  }
  const [dir, extra] = parsed.positionals;
  if (extra !== undefined) throw fail(`unexpected argument ${extra}: \`${cmd}\` takes one folder`, 'VALIDATION_ERROR', `Run \`sign-off-axi ${cmd} --help\``);
  return { dir: resolve(dir ?? '.'), given: dir !== undefined, values: parsed.values as Record<string, any> };
}

/** The value of the agent: line of <so>/config.yaml, spaces dropped; undefined when there is none or it is empty. */
const configAgent = (so: string) => {
  try { return /^[ \t]*agent[ \t]*:([^#\n]*)/m.exec(readFileSync(join(so, 'config.yaml'), 'utf8'))?.[1].replace(/\s+/g, '') || undefined; } catch { return undefined; }
};
/** Is this command on PATH? The only thing auto detection looks at: no config, credential or network read. */
const executable = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch { return false; }
};
const onPath = (bin: string) => (process.env.PATH ?? '').split(delimiter).filter(Boolean).some((d) => executable(join(d, bin)));
/** The agents an agent: value names; auto is every known agent whose command is on PATH. */
function chosenAgents(value: string) {
  if (value === 'auto') return Object.keys(AGENTS).filter((a) => onPath(AGENTS[a].bin));
  const names = [...new Set(value.split(',').map((n) => n.trim()))], bad = names.find((n) => !Object.hasOwn(AGENTS, n));
  if (bad !== undefined) throw fail(`unknown agent ${bad}`, 'VALIDATION_ERROR', `Use auto, or one or more of ${Object.keys(AGENTS).join(', ')} joined by commas`);
  return names;
}
const skillInstalled = (dir: string, agent: string) => [join(dir, AGENTS[agent].dir), AGENTS[agent].home]
  .some((skills) => existsSync(join(skills, 'sign-off-axi', 'SKILL.md')));
const SKILL_ADD = ['-y', 'skills', 'add', 'umeranjum17/sign-off', '--skill', 'sign-off-axi', '-y', '-a'];
const skillAdd = (agents: string[]) => `npx ${[...SKILL_ADD, ...agents].join(' ')}`;

const GITIGNORE = 'mocks/\nevidence/\n*.answers.jsonl\n*.rounds.jsonl\n*.messages.jsonl\n*.annotations.jsonl\n*.seen.jsonl\n*.dismissed.jsonl\n*.board.pid\n*.board.log\n*.token\n*.export.html\n';
/** The board, port, bind and hosts in <so>/config.yaml (the `key: value` lines init writes). A bad line falls back on its own default
 * (decisions.json, 4410) and `problems` says what is wrong; a file that cannot be read throws. */
function readSetup(so: string) {
  const config: Record<string, string> = {}, problems: string[] = [], hosts: string[] = [];
  let onAnswer: string[] = [];
  readFileSync(join(so, 'config.yaml'), 'utf8').split(/\r?\n/).forEach((l, n) => {
    const line = l.split('#')[0].trim(), kv = line.match(/^([A-Za-z]+)\s*:\s*(\S+)$/), key = line.match(/^(board|port|bind)(\s|:|$)/i);
    // hosts: private DNS names that reach the bind address (a mesh VPN name), let in besides it; commas or spaces between them.
    const names = /^hosts\s*:(.*)$/i.exec(line)?.[1].split(/[\s,]+/).filter(Boolean).map((h) => h.toLowerCase().replace(/\.$/, ''));
    for (const h of names ?? []) {
      if (/^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(h)) hosts.push(h);
      else problems.push(`hosts ${h} is not a DNS name`);
    }
    if (names) return;
    // on_answer: a command and its arguments, split on spaces and run with no shell for each saved answer.
    const hook = /^on_answer\s*:(.*)$/i.exec(line)?.[1];
    if (hook !== undefined) return void (onAnswer = hook.split(/\s+/).filter(Boolean));
    if (kv && ['board', 'port', 'bind'].includes(kv[1].toLowerCase())) config[kv[1].toLowerCase()] = kv[2];
    else if (key) problems.push(`line ${n + 1} is not one "key: value"`);
  });
  const port = config.port ?? '4410', goodBoard = /^[\w.-]+\.json$/.test(config.board ?? ''), goodPort = /^\d{1,5}$/.test(port) && Number(port) <= 65535;
  if (!goodBoard) problems.push('needs a "board: <name>.json" line');
  if (!goodPort) problems.push(`port ${port} is not a number from 0 to 65535`);
  const bind = config.bind ?? '127.0.0.1';
  if (!privateBind(bind)) problems.push(`bind ${bind} is not 127.0.0.1 or a private address`);
  return { board: join(so, goodBoard ? config.board : 'decisions.json'), port: goodPort ? Number(port) : 4410, bind, hosts, onAnswer, goodBoard, problems };
}
/** --port, else the port in a config.yaml beside the board (init writes one), else 4410. */
const boardPort = (named: string, given?: string) => portOf(given ?? String(setupOf(named)?.port ?? 4410));

function init(args: string[]) {
  const { dir, values } = repoDir('init', args, { agent: { type: 'string' } }), so = join(dir, '.sign-off');
  const had = configAgent(so), agent = (values.agent ?? had ?? 'auto').replace(/\s+/g, ''), agents = chosenAgents(agent);
  // A re-run repairs a cut-short init, including a missing board under the name the config gives.
  let board = join(so, 'decisions.json');
  try { board = readSetup(so).board; } catch {}
  const files: [string, string][] = [
    [join(so, 'config.yaml'), `# sign-off repo setup. board: path under .sign-off/, port: dashboard port, agent: auto or the coding agents to install the skill for.\n# bind: 127.0.0.1 keeps the dashboard on this machine; a private address such as its VPN address lets a phone open it.\n# hosts: (optional) private DNS names that lead to that address, such as its mesh VPN name, commas between them.\n# on_answer: (optional) a command run for each answer, with the answer as one JSON line on its stdin; no shell, so | > && do nothing: on_answer: node hook.mjs\nboard: decisions.json\nport: 4410\nbind: 127.0.0.1\nagent: ${agent}\n`],
    [board, `{"schema": 2, "items": []}\n`],
    [join(so, '.gitignore'), GITIGNORE],
  ];
  mkdirSync(join(so, 'mocks'), { recursive: true });
  mkdirSync(join(so, 'evidence'), { recursive: true });
  const created: string[] = [], kept: string[] = [];
  for (const [path, content] of files) {
    if (existsSync(path)) kept.push(path.slice(dir.length + 1));
    else {
      writeFileSync(path, content, { mode: 0o600 });
      created.push(path.slice(dir.length + 1));
    }
  }
  // A given --agent is the user's choice: record it, so doctor checks the same agents.
  if (values.agent !== undefined && had !== agent) {
    const config = join(so, 'config.yaml'), text = readFileSync(config, 'utf8');
    writeFileSync(config, /^[ \t]*agent[ \t]*:.*$/m.test(text) ? text.replace(/^[ \t]*agent[ \t]*:.*$/m, `agent: ${agent}`) : `${text.replace(/\n?$/, '\n')}agent: ${agent}\n`);
  }
  const missing = agents.filter((a) => !skillInstalled(dir, a));
  if (missing.length) {
    // Under npx -p <package>, npm_config_package names that package, and a nested npx would run it instead of skills.
    const env = { ...process.env };
    delete env.npm_config_package;
    const r = spawnSync('npx', [...SKILL_ADD, ...missing], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const cause = r.error?.message ?? `${r.stderr}\n${r.stdout}`.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n').map((l) => l.trim()).filter(Boolean).pop();
    if (r.status !== 0 || missing.some((a) => !skillInstalled(dir, a))) {
      throw fail(`.sign-off/ is set up, but installing the skill for ${missing.join(', ')} failed: ${cause ?? `exit ${r.status}`}`, 'INSTALL_FAILED', `Run \`${skillAdd(missing)}\` in ${shellPath(dir)}`);
    }
  }
  const skills = agents.length ? agents.map((a) => ({ agent: a, skill: missing.includes(a) ? 'installed' : 'already installed' }))
    : `no agent found on PATH (${Object.values(AGENTS).map((a) => a.bin).join(', ')})`;
  return toon({ dir: tilde(dir), created: created.length ? created : 'nothing new (re-run is a no-op)', kept, board: shellPath(board), agent, skills }, [
    ...(agents.length ? [] : [`Run \`sign-off-axi init ${shellPath(dir)} --agent <name>\` to install the skill for one agent: ${Object.keys(AGENTS).join(', ')}`]),
    `Run \`sign-off-axi post ${shellPath(board)} --type design --title "<question>" --option a=A --option b=B --recommend a\` to ask for a pick`,
      `Run \`sign-off-axi doctor ${shellPath(dir)}\` to check the setup`, `Run \`sign-off-axi open ${shellPath(board)}\` to show the board to the user`]);
}

/** report init <folder>: the scaffold page and its picture, kept when already there, with the post command that names them. */
function report(args: string[]) {
  let parsed;
  try { parsed = parseArgs({ args, allowPositionals: true, strict: true, options: {} }); } catch (e: any) { throw fail(e.message, 'VALIDATION_ERROR', 'Run `sign-off-axi report --help`'); }
  const [sub, dir, extra] = parsed.positionals;
  if (sub !== 'init' || dir === undefined || extra !== undefined) {
    throw fail(sub !== 'init' ? `unknown report command ${sub ?? '(none)'}` : extra !== undefined ? `unexpected argument ${extra}: report init takes one folder` : 'report init needs the folder to write the page in', 'VALIDATION_ERROR', 'sign-off-axi report init .sign-off/mocks/<key>');
  }
  const out = resolve(dir), created: string[] = [], kept: string[] = [];
  mkdirSync(out, { recursive: true });
  for (const [name, from] of [['index.html', 'report.html'], ['preview.svg', 'report-preview.svg']]) {
    const path = join(out, name);
    if (existsSync(path)) kept.push(shellPath(path));
    else {
      writeFileSync(path, readFileSync(new URL(`../web/${from}`, import.meta.url)), { flag: 'wx' });
      created.push(shellPath(path));
    }
  }
  // The board serves a report's page from its own folder, so the post command names the page from there.
  const board = boardHere(), rel = relative(dirname(board), out).split(sep).join('/'), served = rel && !rel.startsWith('../') && rel !== '..' && !isAbsolute(rel);
  return toon({ folder: shellPath(out), created: created.length ? created : 'nothing new (re-run is a no-op)', kept }, [
    'Replace every FILL: line: the answer and its picture first, then the diagram, the steps to tap, and the folded detail',
    'Open index.html in a browser 390 px wide and look before posting: mostly text means it is not ready',
    served ? `Run \`sign-off-axi post ${shellPath(board)} --type report --title "<the answer>" --about "<why it matters>" --view ${rel}/index.html --preview ${rel}/preview.svg\``
      : `Run \`sign-off-axi post <board.json> --type report --title "<the answer>" --about "<why it matters>" --view <path>/index.html --preview <path>/preview.svg\`, both paths from the board file's folder, which must hold this folder`,
  ]);
}

async function doctor(args: string[]) {
  const { dir: folder, given } = repoDir('doctor', args), dir = given ? folder : setupFolderHere() ?? folder, so = join(dir, '.sign-off'), rerun = `sign-off-axi init ${shellPath(dir)}`;
  const checks: { name: string; ok: string; fix?: string }[] = [];
  const check = (name: string, ok: string, fix?: string) => checks.push({ name, ok, fix });
  /** Stats a path; one it cannot follow (a link to nothing, a link loop) is 'link', and one it may not reach is 'denied', instead of an error. */
  const look = (path: string): Stats | 'link' | 'denied' | undefined => {
    try { return statSync(path, { throwIfNoEntry: false }) ?? (lstatSync(path, { throwIfNoEntry: false }) && 'link'); } catch (e: any) {
      if (e.code === 'ELOOP') return 'link';
      if (['EACCES', 'EPERM'].includes(e.code)) return 'denied';
      throw e;
    }
  };
  /** A permission problem is fixed by chmod on the setup folder holding the path; anything else in the way is moved aside. */
  const fixFor = (path: string, code: string, then: string) => ['EACCES', 'EPERM'].includes(code) ? `Run \`chmod -R u+rwX ${shellPath(dirname(path))}\`` : `Move ${shellPath(path)} away, then ${then}`;
  /** Why a setup file cannot be used and its fix, or nothing when it is a readable file with content. */
  const writeError = (path: string): string | undefined => { try { accessSync(path, constants.W_OK); } catch (e: any) { return e.code; } };
  const unusable = (path: string): [string, string] | undefined => {
    const stat = look(path);
    if (stat === 'denied') return [`${basename(path)} cannot be read (permission denied)`, fixFor(path, 'EACCES', `run \`${rerun}\``)];
    if (stat === 'link') return [`${basename(path)} is a broken link`, `Delete the link ${shellPath(path)}, then run \`${rerun}\``];
    if (!stat) return [`${basename(path)} is missing`, `Run \`${rerun}\``];
    if (!stat.isFile()) return [`${basename(path)} is not a file`, `Move ${shellPath(path)} away, then run \`${rerun}\``];
    if (!stat.size) return [`${basename(path)} is empty (init was cut short)`, `Delete ${shellPath(path)}, then run \`${rerun}\``];
    try { closeSync(openSync(path, 'r')); } catch (e: any) { return [`${basename(path)} ${reasonOf(e.code)}`, fixFor(path, e.code, `run \`${rerun}\``)]; }
  };
  const [major, minor] = process.versions.node.split('.').map(Number);
  check('node', major > 22 || (major === 22 && minor >= 5) ? `ok (${process.versions.node})` : `too old (${process.versions.node})`,
    major > 22 || (major === 22 && minor >= 5) ? undefined : 'Install Node 22.5 or newer');
  let board = join(so, 'decisions.json'), port = 4410;
  try {
    const top = look(so);
    if (top === 'denied') check('setup', '.sign-off cannot be read (permission denied)', `Run \`chmod u+x ${shellPath(dir)}\``);
    else if (top && (top === 'link' || !top.isDirectory())) check('setup', '.sign-off is not a folder', `Move ${shellPath(so)} away, then run \`${rerun}\``);
    else if (!top) check('setup', 'no .sign-off/ folder', `Run \`${rerun}\``);
    else {
      const config = join(so, 'config.yaml'), configBad = unusable(config);
      if (configBad) check('config', ...configBad);
      else {
        const setup = readSetup(so);
        ({ board, port } = setup);
        if (!setup.problems.length) check('config', `board ${basename(board)}, port ${port}`);
        else check('config', `${basename(config)}: ${setup.problems.join('; ')}`, `Edit ${shellPath(config)} to hold "board: <name>.json", "port: <0-65535>" and "bind: <127.0.0.1 or a private address>" lines, such as board: decisions.json, port: 4410 and bind: 127.0.0.1, and hosts: only DNS names${setup.goodBoard ? '' : `, or delete it and run \`${rerun}\``}`);
        // A hosts: name is only of use when it leads to the bind address.
        const astray: string[] = [];
        for (const h of setup.hosts) {
          const found = await lookup(h, { all: true }).then((a) => a.map((x) => x.address), (e) => e.code as string);
          if (typeof found === 'string') astray.push(`${h} does not resolve (${found})`);
          else if (!found.includes(setup.bind)) astray.push(`${h} resolves to ${found.join(', ')}`);
        }
        if (setup.hosts.length) {
          check('hosts', astray.length ? `${astray.join('; ')}, not the bind address ${setup.bind}` : `${setup.hosts.join(', ')} resolve${setup.hosts.length > 1 ? '' : 's'} to ${setup.bind}`,
            astray.length ? `Point each name at ${setup.bind} in your private network's DNS, or take it off the hosts: line of ${shellPath(config)}` : undefined);
        }
        // on_answer runs with no shell, in the board's folder: a shell operator is passed as an argument, and a relative path is found from there.
        const [hook] = setup.onAnswer, op = setup.onAnswer.find((w) => /[|&;<>$`]/.test(w));
        if (hook) {
          const path = hook.includes('/') && resolve(dirname(existsSync(board) ? realpathSync(board) : board), hook), runs = path ? executable(path) : onPath(hook);
          check('on_answer', op ? `${op} is a shell operator, and on_answer runs with no shell, so it is passed to the program as an argument` : runs ? `runs ${hook} for each answer` : `${hook} is not a program on PATH or an executable file`,
            op ? `Put the command in a script and name the script on the on_answer: line of ${shellPath(config)}`
              : runs ? undefined : path ? `Run \`chmod +x ${shellPath(path)}\`, or fix the path on the on_answer: line of ${shellPath(config)}`
              : `Install ${hook}, or name an executable file on the on_answer: line of ${shellPath(config)}`);
        }
      }
      const boardBad = unusable(board);
      if (boardBad) check('board', ...boardBad);
      else {
        try {
          const n = loadDecisions(board).length, old = readItems(board).schema === 1;
          check('board', `${n} items${old ? ' (0.1.0 schema 1: read as decisions; the first write that changes it upgrades it and keeps a .schema-1.bak copy)' : ''}`);
        } catch (e: any) {
          check('board', e.message, `Edit ${shellPath(board)} to fix that; the format is at ${FORMAT}`);
        }
      }
      for (const [name, path, fields] of [['answers', answersPath(board), ['key', 'answer']], ['rounds', roundsPath(board), ['key', 'note', 'at']]] as const) {
        let text: string;
        try { text = readFileSync(path, 'utf8'); } catch (e: any) {
          check(name, e.code === 'ENOENT' ? 'none yet' : `${basename(path)} ${reasonOf(e.code)}`, e.code === 'ENOENT' ? undefined : fixFor(path, e.code, 'the next save writes a new one'));
          continue;
        }
        const torn = text.split('\n').flatMap((line, n) => {
          try { return !line || fields.every((f) => typeof JSON.parse(line)?.[f] === 'string') ? [] : [n + 1]; } catch { return [n + 1]; }
        });
        check(name, torn.length ? `line${torn.length > 1 ? 's' : ''} ${torn.join(', ')} of ${basename(path)} ${torn.length > 1 ? 'do' : 'does'} not parse` : `${text.split('\n').filter(Boolean).length} lines read`,
          torn.length ? `Delete line${torn.length > 1 ? 's' : ''} ${torn.join(', ')} from ${shellPath(path)} (a cut-short write); the other lines are kept` : undefined);
      }
      // The same lock names raise, post, open and poll take, on the board's real path.
      const real = existsSync(board) ? realpathSync(board) : board;
      const stale = [`${real}.lock`, `${record(real)}.lock`, `${messagesPath(real)}.lock`].filter(staleLock);
      check('locks', stale.length ? `${stale.map((l) => basename(l)).join(' and ')} left by a sign-off-axi that stopped mid-write, so every raise, post and open waits on it` : 'none left behind',
        stale.length ? `Run \`rm ${stale.map(shellPath).join(' ')}\`` : undefined);
      const ignore = join(so, '.gitignore'), ignoreBad = unusable(ignore);
      if (ignoreBad) check('gitignore', ...ignoreBad);
      else {
        const lines = readFileSync(ignore, 'utf8').split('\n').map((l) => l.trim().replace(/^\/|\/$/g, ''));
        const absent = ['mocks/', 'evidence/'].filter((d) => !lines.includes(d.slice(0, -1)));
        check('gitignore', absent.length ? `${absent.join(' and ')} not ignored` : 'mocks/ and evidence/ are ignored',
          absent.length ? `Add the line${absent.length > 1 ? 's' : ''} ${absent.join(' and ')} to ${shellPath(ignore)}` : undefined);
      }
      const kinds = ['mocks', 'evidence'].map((f) => ({ f, stat: look(join(so, f)) }));
      const denied = kinds.filter(({ stat }) => stat === 'denied').map(({ f }) => `${f}/`);
      const folders = kinds.filter(({ stat }) => stat !== 'denied' && (!stat || stat === 'link' || !stat.isDirectory())).map(({ f }) => f);
      const blocked = kinds.filter(({ f, stat }) => folders.includes(f) && stat).map(({ f }) => f);
      const problems = [
        ...(denied.length ? [`${denied.join(' and ')} cannot be read (permission denied)`] : []),
        ...folders.map((f) => `${f}/ ${blocked.includes(f) ? 'not a folder' : 'missing'}`),
      ];
      const steps = [
        ...(blocked.length ? [`move ${blocked.map((f) => shellPath(join(so, f))).join(' and ')} away`] : []),
        ...(denied.length ? [`run \`chmod -R u+rwX ${shellPath(so)}\``] : []),
        `run \`${rerun}\``,
      ];
      check('folders', problems.join('; ') || 'mocks/ and evidence/ exist', problems.length ? `${steps.join(', then ')}`.replace(/^./, (c) => c.toUpperCase()) : undefined);
      const unwritable = [so, answersPath(board), roundsPath(board), join(so, 'evidence')].flatMap((p) => {
        const code = existsSync(p) ? writeError(p) : undefined;
        return code ? [{ path: p, code }] : [];
      });
      const writeFix = ({ path, code }: { path: string; code: string }) => code === 'EROFS' ? 'the filesystem is read-only: remount it read-write or move the repo'
        : code === 'EPERM' ? 'chown it to you (or run as its owner)' : `Run \`chmod u+w ${shellPath(path)}\``;
      check('write', unwritable.length ? `${unwritable.map(({ path }) => basename(path)).join(' and ')} cannot be written` : 'setup can be written',
        unwritable.length ? [...new Set(unwritable.map(writeFix))].join('; ') : undefined);
    }
  } catch (e: any) {
    if (!e.syscall) throw e;
    if (e.code === 'ENOTDIR') check('setup', `${tilde(dir)} is not a folder`, 'Pass a folder: `sign-off-axi doctor <folder>`');
    else check('setup', `${tilde(e.path ?? so)} cannot be inspected (${e.code})`, `Check ${shellPath(e.path ?? so)}, then run \`${rerun}\``);
  }
  if (port) {
    const error = await new Promise<any>((ok) => server.once('error', ok).listen(port, '127.0.0.1', () => server.close(() => ok(undefined))));
    server.removeAllListeners('error');
    // A port in use by this very board is fine: the board is already open.
    const shown = error && await serving(port, '127.0.0.1', board).catch(() => undefined), other = shown?.file && shown.file !== (existsSync(board) ? realpathSync(board) : board);
    if (!error) check('port', `${port} is free`);
    else if (error.code === 'EACCES') check('port', `${port} needs privileges to bind (EACCES)`, `Set "port:" in ${shellPath(join(so, 'config.yaml'))} to a port above 1023 (open and serve use it)`);
    else if (shown?.file && !other) check('port', `${port} shows this board (already open)`);
    else check('port', other ? `${port} shows another board, ${shellPath(shown.file)}` : `${port} is in use (${error.code})`,
      `Set "port:" in ${shellPath(join(so, 'config.yaml'))} to a free port (open and serve use it), or ${other ? `close that board: \`sign-off-axi stop ${shellPath(shown.file)}\`, or Ctrl-C its serve` : `stop the program using port ${port}`}`);
  }
  try {
    const agents = chosenAgents(configAgent(so) ?? 'auto');
    if (!agents.length) check('agent', `auto: no agent found on PATH (${Object.values(AGENTS).map((a) => a.bin).join(', ')})`);
    for (const a of agents) check(`${a} skill`, skillInstalled(dir, a) ? 'installed' : 'not installed', skillInstalled(dir, a) ? undefined : `Run \`${skillAdd([a])}\` in ${shellPath(dir)}`);
  } catch (e: any) {
    check('agent', e.message, `Set agent: in ${shellPath(join(so, 'config.yaml'))} to auto or ${Object.keys(AGENTS).join(', ')}`);
  }
  const bad = checks.filter((c) => c.fix);
  if (bad.length) throw fail(`${bad.length} of ${checks.length} checks need a fix in ${tilde(dir)}`, 'NOT_FOUND',...bad.map((c) => `${c.name}: ${c.ok}. ${c.fix}`));
  return toon({ dir: tilde(dir), checks: checks.map(({ name, ok }) => ({ name, ok })) },
    [`Run \`sign-off-axi open ${shellPath(board)}\` to show the board to the user`]);
}

let file = '', evidenceRoot = '', bind = '127.0.0.1', hosts: string[] = [], onAnswer: string[] = [];
async function serve(args: string[]) {
  const parsed = parse('serve', args, BOARD_FLAGS), port = boardPort(parsed.named, parsed.values.port);
  ready(parsed.file, parsed.on, parsed.values['evidence-root']);
  bind = bindOf(parsed.named, parsed.values.bind);
  ({ hosts = [], onAnswer = [] } = setupOf(parsed.named) ?? {});
  let warned = false;
  const sweep = async (phase: 'startup' | 'periodic') => {
    if (await sweepVault(parsed.file) || warned) return;
    warned = true;
    warn(`Vault ${phase} expiry unavailable; access checks remain enforced.`);
  };
  // Checked and recorded under the board lock, so two serves started at once never both run with one record between them.
  const bound = await locked(`${parsed.file}.lock`, async () => {
    const live = await running(parsed.file);
    if (live) throw fail(`this board is already open at ${live.url}`, 'CONFLICT', `Run \`sign-off-axi stop${parsed.on}\` first`);
    if (!loopback(bind)) tokenOf(parsed.file, true);
    await sweep('startup');
    [file, evidenceRoot] = [parsed.file, parsed.values['evidence-root'] ? resolve(parsed.values['evidence-root']) : ''];
    await new Promise<void>((ok, no) => server.once('error', no).listen(port, bind, ok)).catch((e) => {
      throw fail(e.code === 'EADDRINUSE' ? `port ${port} is in use; pass --port` : e.code === 'EADDRNOTAVAIL' ? `${bind} is not an address of this machine; pass another --bind` : e.message, 'SERVE_FAILED', 'Run `sign-off-axi --help` for the flags, then start it again');
    });
    const { port: bound } = server.address() as AddressInfo;
    writeFileSync(record(file), `${process.pid} ${bound} ${bind}\n`, { mode: 0o600 });
    return bound;
  }, 'another serve is still starting this board');
  const repeat = async () => {
    if (!server.listening) return;
    await sweep('periodic');
    reap();
    if (server.listening) setTimeout(repeat, 5_000).unref();
  };
  setTimeout(repeat, 5_000).unref();
  const url = `http://${urlHost(bind)}:${bound}/`;
  process.on('exit', () => { if (existsSync(record(file)) && readFileSync(record(file), 'utf8').split(' ')[0] === String(process.pid)) rmSync(record(file), { force: true }); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
  return toon({ board: tilde(file), url, pid: process.pid }, [linkHelp(file, url), `Run \`sign-off-axi answers${parsed.on}\` to read their answers`]);
}

/** Every new comment and queued prompt, each handed over once. */
async function poll(args: string[]) {
  const { file, values, on } = parse('poll', args, { json: { type: 'boolean' }, timeout: { type: 'string', default: '600' } });
  if (!/^\d{1,7}$/.test(values.timeout)) throw fail('--timeout must be whole seconds, 0 or more', 'VALIDATION_ERROR', 'Run `sign-off-axi poll --help`');
  ready(file, on);
  const seconds = Number(values.timeout), deadline = Date.now() + seconds * 1000;
  for (let first = true; ; first = false) {
    // Read and marked under one lock, so two polls never hand the same message over twice.
    const fresh = await locked(`${messagesPath(file)}.lock`, () => {
      const got = readMessages(file, first ? warn : () => {}).filter((m) => !m.delivered);
      if (got.length) markDelivered(file, got.map((m) => m.id));
      return got;
    }, 'another poll is still reading the messages');
    if (fresh.length) {
      if (values.json) return JSON.stringify({ messages: fresh.map(({ delivered, ...m }) => m) });
      return toon({ board: tilde(file), messages: fresh.map(({ id, kind, key = '', text, at }) => ({ id, kind, key, text, at })) },
        [`Run \`sign-off-axi poll${on}\` to wait for the next comment or prompt`, `Run \`sign-off-axi answers${on}\` for the answers`]);
    }
    const left = deadline - Date.now();
    if (left <= 0) throw fail(`no new comment or prompt within ${seconds}s`, 'TIMEOUT', `Run \`sign-off-axi poll${on} --timeout ${seconds}\` to keep waiting`);
    await new Promise((ok) => setTimeout(ok, Math.min(1000, left)));
  }
}

/** One read-only HTML file: the page, the board's state and its local mocks and media as data: URIs. */
async function exportBoard(args: string[]) {
  const parsed = parse('export', args, { out: { type: 'string' }, 'evidence-root': { type: 'string' } });
  ready(parsed.file, parsed.on, parsed.values['evidence-root']);
  [file, evidenceRoot] = [parsed.file, parsed.values['evidence-root'] ? resolve(parsed.values['evidence-root']) : ''];
  const { file: _, messages: _messages, annotations: _annotations, ...frozen } = state(), files: Record<string, string> = {}, q = encodeURIComponent;
  let missing = 0;
  // The same URLs the page asks the server for, read through the same hash and path checks.
  const inline = async (url: string, query?: string) => {
    const [code, body] = await route({ method: 'GET', url } as IncomingMessage).catch((): [number, unknown] => [404, null]);
    if (code !== 200) { missing++; return; }
    const { media, type } = body as { media: Buffer; type: string };
    // A data: URL keeps a one-page mock's query where the mock page reads it, but also appends it to the page text: a trailing comment hides it.
    files[url] = query && type === 'text/html' ? `data:text/html;charset=utf-8,${q(media.toString())}%3C!--?${query}` : `data:${type};base64,${media.toString('base64')}`;
  };
  // A mock page is inlined on its own: the css and images beside it load only from the running board.
  const at = (key: string, value: string, path: string) => `${frozen.mockBase}${key}~${value}/${q(basename(mockFile(path)))}`;
  for (const d of frozen.decisions) {
    for (const m of d.mocks ?? []) {
      const query = m.path.split('?')[1];
      await inline(`${at(d.key, m.value, m.path)}${query ? `?${query}` : ''}`, query);
    }
    // A diagram or an interactive page is the item's own view, inlined the same way.
    if (d.view) await inline(at(d.key, '', d.view));
    if (d.preview) await inline(at(d.key, '', d.preview));
    for (const i of (d.media ?? []).keys()) await inline(`/api/media?key=${q(d.key)}&i=${i}`);
    for (const m of d.evidenceCard?.media ?? []) await inline(m.url);
  }
  const out = resolve(parsed.values.out ?? `${parsed.file.replace(/\.json$/, '')}.export.html`);
  // Only an .html name, so a wrong --out never overwrites the board or a file beside it.
  if (!/\.html?$/i.test(out)) throw fail(`--out ${tilde(out)} does not end in .html`, 'VALIDATION_ERROR', 'Pass --out <file.html>');
  const data = JSON.stringify({ ...frozen, files, exported: `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC` }).replace(/</g, '\\u003c');
  const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; media-src data:; frame-src data:";
  writeFileSync(out, page.toString().replace('</head>', () => `<meta http-equiv="content-security-policy" content="${csp}">\n<script>window.FROZEN = ${data};</script>\n</head>`), { mode: 0o600 });
  return toon({ board: tilde(parsed.file), exported: tilde(out), items: frozen.decisions.length, inlined: Object.keys(files).length, ...(missing && { missing }) },
    [`Open ${tilde(out)} in a browser: one read-only file, no server needed`]);
}


const page = readFileSync(new URL('../web/index.html', import.meta.url));
/** Added to each design mock page so the person can point at a part of it; see web/point.js. */
const pointer = Buffer.from(`<script>${readFileSync(new URL('../web/point.js', import.meta.url), 'utf8')}</script>`);
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const state = () => {
  reap();
  // The page marks sent comments in annotations, so answers and rounds go without theirs: a read-only board or an export carries none.
  const answers = Object.fromEntries(Object.entries(readAnswers(file, warn)).map(([k, { comments: _, ...a }]) => [k, a])), taken = seenBy(file);
  const rounds = readRounds(file, warn).map(({ comments: _, ...r }) => r);
  return {
    file,
    mockBase: `/mock/${loopback(bind) ? 'local' : mockPass(tokenOf(file))}/`,
    // Who filed an item stays in the file: the page only learns that its filer took the answer.
    // A sign-in's start command stays on this host too: the page only learns that a tap makes a new link, and how the last run went.
    decisions: loadDecisions(file).map(({ filer: _, start, ...d }) => ({ ...d, ...(start && { start: true, run: signinState(d.key) }), evidenceCard: d.evidence ? evidenceCard(d.evidence) : null,
      ...(d.mocks && { mocks: d.mocks.map((m) => ({ ...m, hash: mockHash(m.path) })) }) })),
    readonly: readOnly(),
    answers_only: answersOnly(),
    answers,
    seen: Object.values(answers).filter(taken).map((a) => a.key),
    rounds,
    messages: readMessages(file, warn),
    annotations: readOnly() || answersOnly() ? [] : ((sent) => readAnnotations(file, warn).map((a) => (sent.has(a.id) ? { ...a, sent: true } : a)))(sentIds(file)),
    dismissed: readDismissed(file, answers, rounds, warn),
  };
};
/** A mock file's sha256 now, or null when it is gone: a comment shows only on the exact file it was made on.
 * ponytail: hashes every mock on each state read; cache by mtime if boards carry many big mocks. */
const mockHash = (path: string) => { try { return sha256(readFileSync(under(dirname(file), mockFile(path)))); } catch { return null; } };
/** The comments that go with a card's next answer or round: not sent yet, and made on the mock file the card shows now. */
const unsent = (d: Decision): Sent[] => {
  const sent = sentIds(file), now = new Map((d.mocks ?? []).map((m) => [m.value, mockHash(m.path)]));
  return answersOnly() ? [] : readAnnotations(file).filter((a) => a.key === d.key && !sent.has(a.id) && now.get(a.mock) === a.hash)
    .map(({ id, mock, hash, ref, tag, words, text }) => ({ id, mock, hash, ref, tag, words, text }));
};
/** A board whose file says `"readonly": true` shows its items and takes no answers, rounds or comments: another program feeds it. */
const readOnly = () => readItems(file).extra.readonly === true;
/** A board whose file says `"answers_only": true` takes answers and replies but no rounds, comments or prompts: another program feeds it. */
const answersOnly = () => readItems(file).extra.answers_only === true;
const mediaTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const mockTypes: Record<string, string> = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
/** What a mock's folder may serve beside it: pages, styles, scripts, images, fonts and clips; never the board, answers, token or config. */
const assetTypes: Record<string, string> = { ...mediaTypes, ...mockTypes, '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.gif': 'image/gif', '.woff2': 'font/woff2' };
const MOCK_BYTES = 5_000_000;
/** A sandboxed mock frame sends no cookie, so beyond loopback its URLs carry this pass in the path: made from the token, it opens mock folders only. */
const mockPass = (token: string) => sha256(Buffer.from(`mock ${token}`));
/** Every served file is its own sandboxed page, even opened full size: no fetch, no remote files, no frames, and no reach into the dashboard or its tab. */
const FRAME_CSP = "default-src 'self' 'unsafe-inline' data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts";
/** A board-relative path resolved inside a root folder; anything else is unavailable. */
function under(root: string, rel: string): string {
  let base: string, actual: string;
  try {
    base = realpathSync(root);
    actual = realpathSync(resolve(base, rel));
  } catch { throw new EvidenceError('no matching mock file'); }
  if (actual !== base && !actual.startsWith(base + sep)) throw new EvidenceError('mock path escapes the board folder');
  return actual;
}
function contained(path: string, missing = 'A picture or recording of the proof is missing.'): string {
  let root: string, actual: string;
  try {
    root = realpathSync(evidenceRoot);
    actual = realpathSync(resolve(root, path));
  } catch { throw new EvidenceError(missing); }
  if (!actual.startsWith(root + sep)) throw new EvidenceError('A picture or recording is outside the proof folder.');
  return actual;
}
/** A linked run as the board checked it; the reason a check failed is a plain sentence for the card.
 * With no --evidence-root the board cannot check a run at all, so the card shows no result rather than one that blames the run. */
function evidenceCard(link: NonNullable<Decision['evidence']>) {
  if (!evidenceRoot) return null;
  try {
    const recordPath = contained(`.done-done/runs/${link.run_id}.json`, 'The proof for this run is missing.');
    if (statSync(recordPath).size > 1_000_000) throw new EvidenceError('The proof for this run is too large to read.');
    const run = JSON.parse(readFileSync(recordPath, 'utf8'));
    if (!run || typeof run !== 'object' || Array.isArray(run)) throw new EvidenceError('The proof for this run cannot be read.');
    if (run.schema !== 1 || run.run_id !== link.run_id || run.commit !== link.commit || !/^[a-f0-9]{40}$/.test(run.tree ?? '')
      || typeof run.dirty !== 'boolean' || !(run.exit === null || Number.isInteger(run.exit)) || !Array.isArray(run.files)
      || run.files.some((f: any) => !f || typeof f !== 'object' || typeof f.path !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256 ?? '') || !Number.isInteger(f.bytes) || f.bytes < 0)) {
      throw new EvidenceError('The proof does not match this change.');
    }
    const media: { path: string; url: string; type: string }[] = run.files.flatMap((f: any) => {
      const type = mediaTypes[extname(f.path ?? '').toLowerCase()];
      if (!type) return [];
      const path = contained(f.path);
      if (statSync(path).size > 20_000_000) throw new EvidenceError('A picture or recording of the proof is too large.');
      const bytes = readFileSync(path);
      if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256) throw new EvidenceError('A picture or recording changed after the run.');
      return [{ path: f.path, url: `/api/evidence?run=${encodeURIComponent(link.run_id)}&file=${encodeURIComponent(f.path)}`, type }];
    });
    const result = !Number.isInteger(run.exit) ? 'INCONCLUSIVE' : run.exit !== 0 || run.dirty || !run.files.length ? 'RUN FAIL' : 'RUN PASS';
    return { status: 'verified', result, commit: run.commit, media };
  } catch (e: any) {
    const reason = e instanceof EvidenceError ? e.message : 'The proof for this run cannot be read.';
    return { status: 'unverified', result: 'UNVERIFIED', reason, commit: '', media: [] };
  }
}

const MESSAGE_MAX = 2000;
async function route(req: IncomingMessage): Promise<[number, unknown]> {
  if (req.method === 'GET' && req.url?.startsWith('/mock/')) {
    // /mock/<pass>/<key>~<value>/<file>: that option's design mock, or with no value the item's own view (a diagram or interactive page),
    // and the files beside it in its own folder, so a mock page's relative css, scripts and images load.
    const [item, ...rest] = new URL(req.url, 'http://localhost').pathname.split('/').slice(3), [key, value] = item?.split('~') ?? [];
    const d = loadDecisions(file).find((x) => x.key === key);
    const mock = value ? d?.mocks?.find((m) => m.value === value)?.path : value === '' && d?.view;
    try {
      const path = rest.map(decodeURIComponent).join('/'), type = assetTypes[extname(path).toLowerCase()];
      if (!mock || !type) return [404, { error: 'Mock is unavailable' }];
      const actual = under(dirname(under(dirname(file), mockFile(mock))), path);
      if (statSync(actual).size > MOCK_BYTES) return [404, { error: 'Mock is unavailable' }];
      // A design mock page gets the pointing bridge when served; export inlines the page as written.
      return [200, { media: readFileSync(actual), type, point: Boolean(value) && type === 'text/html' }];
    } catch { return [404, { error: 'Mock is unavailable' }]; }
  }
  if (req.method === 'GET' && req.url?.startsWith('/api/evidence?')) {
    const q = new URL(req.url, 'http://localhost').searchParams, runId = q.get('run') ?? '', path = q.get('file') ?? '';
    const decision = loadDecisions(file).find((d) => d.evidence?.run_id === runId);
    if (!decision?.evidence || !path) return [404, { error: 'Evidence is unavailable' }];
    const card = evidenceCard(decision.evidence);
    if (card?.status !== 'verified' || !card.media.some((m) => m.path === path)) return [404, { error: 'Evidence is unavailable' }];
    const actual = contained(path), type = mediaTypes[extname(path).toLowerCase()];
    return [200, { media: readFileSync(actual), type }];
  }
  if (req.method === 'GET' && req.url?.startsWith('/api/media?')) {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const m = loadDecisions(file).find((d) => d.key === q.get('key'))?.media?.[Number(q.get('i') || NaN)];
    const type = m && mediaTypes[extname(m.path).toLowerCase()];
    if (!m || !type) return [404, { error: 'Evidence is unavailable' }];
    try {
      const actual = under(dirname(file), m.path);
      if (statSync(actual).size !== m.bytes) return [404, { error: 'Evidence file changed since it was posted' }];
      const bytes = readFileSync(actual);
      if (sha256(bytes) !== m.sha256) return [404, { error: 'Evidence file changed since it was posted' }];
      return [200, { media: bytes, type }];
    } catch { return [404, { error: 'Evidence is unavailable' }]; }
  }
  if (req.method === 'GET' && req.url === '/api/board') return [200, { file, pid: process.pid }];
  if (req.method === 'GET' && req.url === '/api/decisions') {
    return [200, state()];
  }
  if (req.method !== 'POST' || !['/api/answers', '/api/rounds', '/api/messages', '/api/annotations', '/api/dismiss', '/api/signin'].includes(req.url ?? '')) return [404, { error: 'Not found' }];
  if (readOnly()) return [403, { error: 'This board is read-only' }];
  // Dismiss only hides an item on this page and sends nothing to the feeding program, so an answers-only board takes it too.
  if (!['/api/answers', '/api/dismiss', '/api/signin'].includes(req.url!) && answersOnly()) return [403, { error: 'This board takes answers only' }];
  if (!req.headers['content-type']?.startsWith('application/json')) return [415, { error: 'Send JSON' }];
  let body = '';
  for await (const chunk of req) body += chunk;
  if (req.url === '/api/messages') {
    const { kind, key, text } = JSON.parse(body) ?? {};
    if (kind !== 'comment' && kind !== 'prompt') return [400, { error: 'Send a comment or a prompt' }];
    if (typeof text !== 'string' || !text.trim() || [...text.trim()].length > MESSAGE_MAX) return [400, { error: `Write the ${kind} first, ${MESSAGE_MAX} characters or fewer` }];
    if (kind === 'comment' && !loadDecisions(file).some((x) => x.key === key)) return [404, { error: 'This question is no longer in the file' }];
    appendMessage(file, kind, text.trim(), kind === 'comment' ? key : undefined);
    return [200, state()];
  }
  if (req.url === '/api/annotations') {
    const { id, deleted, key, mock, ref, tag, words, text, hash: shown } = JSON.parse(body) ?? {}, live = readAnnotations(file), sent = sentIds(file);
    // A comment that went with an answer or a round is the agent's now: it stays as it was sent.
    if (id !== undefined && sent.has(id)) return [409, { error: 'This comment was sent' }];
    if (deleted === true) {
      if (!live.some((a) => a.id === id)) return [404, { error: 'This comment is gone' }];
      appendAnnotation(file, { id, deleted });
      return [200, state()];
    }
    if (![ref, tag, words].every((v) => typeof v === 'string' && v.length <= 300) || !ref || !tag) return [400, { error: 'Point at an element of the mock first' }];
    if (typeof text !== 'string' || !text.trim() || [...text.trim()].length > NOTE_MAX) return [400, { error: `Write the comment first, ${NOTE_MAX} characters or fewer` }];
    const m = loadDecisions(file).find((x) => x.key === key)?.mocks?.find((x) => x.value === mock);
    const hash = m && /\.html$/i.test(mockFile(m.path)) && mockHash(m.path);
    if (!hash) return [404, { error: 'This mock is no longer on the board' }];
    // The page saved against the file it showed; a file overwritten since then is not the one the comment is about.
    if (shown !== hash) return [409, { error: 'The mock changed; reload the board' }];
    // An edit names a comment that must still be live, so a deleted one is not written back.
    if (id !== undefined && !live.some((a) => a.id === id)) return [404, { error: 'This comment is gone' }];
    // One comment per element: another on the same element of the same file edits the first.
    const same = live.find((a) => a.key === key && a.mock === mock && a.hash === hash && a.ref === ref && !sent.has(a.id));
    appendAnnotation(file, { id: same?.id, key, mock, hash, ref, tag, words, text: text.trim() });
    return [200, state()];
  }
  if (req.url === '/api/signin') {
    // Only the key comes from the page: the command is the one the poster stored on this host.
    const { key } = JSON.parse(body) ?? {}, d = board(file).find((x) => x.key === key);
    if (!d?.start) return [404, { error: 'This card has no sign-in to start' }];
    if (d.answer) return [409, { error: 'This sign-in is already done' }];
    try { return [200, { open: await signinLink(d), state: state() }]; } catch (e: any) {
      // A run that ended with exit 0 before it printed a link was already signed in: the card is done, with no link to open.
      return board(file).find((x) => x.key === key)?.answer ? [200, { state: state() }] : [502, { error: e.message, state: state() }];
    }
  }
  if (req.url === '/api/dismiss') {
    const { keys, dismissed } = JSON.parse(body) ?? {};
    if (!Array.isArray(keys) || !keys.length || keys.length > 200 || typeof dismissed !== 'boolean') return [400, { error: 'Send 1 to 200 keys and dismissed true or false' }];
    const have = new Set(loadDecisions(file).map((x) => x.key));
    if (!keys.every((k) => isKey(k) && have.has(k))) return [404, { error: 'This item is no longer in the file' }];
    appendDismissed(file, [...new Set<string>(keys)], dismissed);
    return [200, state()];
  }
  if (req.url === '/api/rounds') {
    const { key, note = '' } = JSON.parse(body) ?? {};
    if (typeof note !== 'string' || [...note.trim()].length > NOTE_MAX) return [400, { error: `The note must be text of ${NOTE_MAX} characters or fewer` }];
    const d = loadDecisions(file).find((x) => x.key === key);
    if (!d) return [404, { error: 'This question is no longer in the file' }];
    // Comments on the mocks are enough for a round; with none, the round needs a note.
    const comments = unsent(d);
    if (!note.trim() && !comments.length) return [400, { error: 'Write a note first: another round needs your comment' }];
    appendRound(file, key, note.trim(), comments);
    return [200, state()];
  }
  const { key, answer, note = '' } = JSON.parse(body) ?? {};
  if (typeof note !== 'string' || [...note.trim()].length > NOTE_MAX) return [400, { error: `The note must be text of ${NOTE_MAX} characters or fewer` }];
  const d = loadDecisions(file).find((x) => x.key === key);
  if (answer === REPLY.value && !note.trim() && !d?.options.some((o) => o.value === answer)) return [400, { error: 'Write the reply first' }];
  // Undo with no answer to go back to saves an empty answer: the line is kept and the item waits again.
  if (answer === CLEARED.value) {
    if (!isKey(key) || (!d && !answersOnly())) return [404, { error: 'This question is no longer in the file' }];
    answered(appendAnswer(file, d ?? ({ key, close: 'done' } as Decision), CLEARED), d);
    return [200, state()];
  }
  if (!d) {
    // The program feeding the board may drop an item while the person answers it: the answer is still saved.
    if (!answersOnly() || !isKey(key) || !isKey(answer)) return [404, { error: 'This question is no longer in the file' }];
    answered(appendAnswer(file, { key, close: 'done' } as Decision, answer === REPLY.value ? REPLY : { value: answer, label: answer }, note.trim()));
    return [200, state()];
  }
  // Every item that asks something takes an Other answer: the words, saved as the answer `text`, unless an option is named text.
  const other = d.reply || d.options.length ? [REPLY] : [], option = d.options.find((o) => o.value === answer) ?? other.find((o) => o.value === answer);
  if (!option) return [400, { error: `The answer must be one of: ${[...d.options, ...other].map((o) => o.label).join(', ') || 'none, this item is only shown'}` }];
  answered(appendAnswer(file, d, option, note.trim(), unsent(d)), d);
  return [200, state()];
}

/** Runs the config's on_answer command for a saved answer, with no shell: the answer goes in as one JSON line on its stdin, never in its arguments. */
function answered(a?: Answer, d?: Decision) {
  if (!a || !onAnswer.length) return;
  const [cmd, ...rest] = onAnswer;
  const child = spawn(cmd, rest, { cwd: dirname(file), stdio: ['pipe', 'ignore', 'inherit'] });
  child.on('error', (e) => warn(`on_answer ${cmd} did not run: ${e.message}`));
  child.on('exit', (code, signal) => (code || signal) && warn(`on_answer ${cmd} exited with ${code ?? signal}`));
  child.stdin.on('error', () => {});
  child.stdin.end(`${JSON.stringify({ event: 'answer', ...kindOf(file)(a.key), ...a, ...(d && { title: d.title }), ...(d?.filer && { filer: d.filer }) })}\n`);
}

/** Live sign-in runs by key, and why the last one failed: kept in memory only, so a captured link is gone once its run ends. */
type SigninRun = { child: ChildProcess; argv: string[]; url?: string; why?: string; link: Promise<string> };
const runs = new Map<string, SigninRun>(), failures = new Map<string, string>();
const SIGNIN_WAIT = 20_000, SIGNIN_LIFE = 600_000;
const signinState = (key: string) => (runs.get(key)?.url ? 'live' : runs.has(key) ? 'starting' : failures.has(key) ? `failed: ${failures.get(key)}` : 'none');
/** Stops a run and its child processes (it leads its own process group): SIGTERM first, SIGKILL if it stays. */
function stopRun(key: string, why: string) {
  const run = runs.get(key);
  if (!run) return;
  run.why ??= why;
  const signal = (sig: NodeJS.Signals) => { try { process.kill(-run.child.pid!, sig); } catch { run.child.kill(sig); } };
  signal('SIGTERM');
  setTimeout(() => { if (runs.get(key) === run) signal('SIGKILL'); }, 2_000).unref();
}
/** Stops each run whose card closed: done, gone from the board, no longer a start-command sign-in, or swapped for another command. */
function reap() {
  if (!runs.size) return;
  const items = new Map(board(file, () => {}).map((d) => [d.key, d]));
  for (const key of runs.keys()) {
    const d = items.get(key), run = runs.get(key)!;
    if (!d?.start || d.answer) stopRun(key, 'The card closed.');
    else if (JSON.stringify(d.start) !== JSON.stringify(run.argv)) stopRun(key, 'A new sign-in was posted for this card.');
  }
}
/** The live link for a tap on Open: a run still going gives its link again; else the start command runs with no shell in the board's folder,
 * and the first https link it prints on stdout (else on stderr) is the link. Its exit 0 closes the card as done. The link is never logged or stored. */
function signinLink(d: Decision): Promise<string> {
  const had = runs.get(d.key);
  if (had) return had.link;
  failures.delete(d.key);
  const [cmd, ...rest] = d.start!, child = spawn(cmd, rest, { cwd: dirname(file), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let found!: (url: string) => void, lost!: (why: string) => void, aside: NodeJS.Timeout | undefined;
  const run: SigninRun = { child, argv: [cmd, ...rest], link: new Promise<string>((ok, no) => { found = ok; lost = (why) => no(new Error(why)); }) };
  run.link.catch(() => {});
  runs.set(d.key, run);
  const take = (url: string) => { if (!run.url) found((run.url = url)); };
  // The link is the first https link on stdout: tools such as npm print notices with other links on stderr first.
  // ponytail: a tool that prints its link only on stderr (gh) is read from there after 2 s of nothing on stdout; add a link pattern per card if a tool needs one.
  const reader = (onOut: boolean) => {
    let seen = '';
    return (b: Buffer) => {
      if (run.url) return;
      seen = (seen + b).slice(-8000);
      const url = /https:\/\/[^\s"'<>`]+/.exec(seen)?.[0];
      if (url && onOut) take(url);
      else if (url) aside ??= setTimeout(() => take(url), 2000);
    };
  };
  child.stdout!.on('data', reader(true));
  child.stderr!.on('data', reader(false));
  const wait = setTimeout(() => run.url || stopRun(d.key, 'It gave no sign-in link within 20 seconds.'), SIGNIN_WAIT);
  const life = setTimeout(() => stopRun(d.key, 'It was not done within 10 minutes, so it was stopped.'), SIGNIN_LIFE);
  const end = (why?: string) => {
    clearTimeout(aside);
    clearTimeout(wait);
    clearTimeout(life);
    if (runs.get(d.key) !== run) return;
    runs.delete(d.key);
    if (why) failures.set(d.key, why);
    lost(why ?? 'The sign-in is done.');
  };
  child.on('error', (e: any) => end(e.code === 'ENOENT' ? `${basename(cmd)} is not on this computer.` : `It did not start (${e.code ?? e.message}).`));
  child.on('exit', (code) => {
    if (code === 0) {
      const now = board(file).find((x) => x.key === d.key);
      if (now?.start && !now.answer && JSON.stringify(now.start) === JSON.stringify(run.argv)) answered(appendAnswer(file, now, SIGNED_IN), now);
      return end();
    }
    end(run.why ?? (code === null ? "It was stopped." : `It stopped with exit code ${code}.`));
  });
  return run.link;
}
process.on('exit', () => { for (const key of runs.keys()) stopRun(key, 'The board stopped.'); });

const server = createServer(async (req, res) => {
  const { port: bound } = server.address() as AddressInfo;
  // Only loopback names, the bound address and the config's hosts: names: blocks DNS rebinding from a web page.
  if (!['127.0.0.1', 'localhost', urlHost(bind), ...hosts].some((h) => `${h}:${bound}` === req.headers.host?.toLowerCase())) return res.writeHead(403).end('Forbidden host');
  if (!loopback(bind)) {
    // Beyond loopback every request carries the token: once in the link, then in a cookie the link sets.
    // The file is read on every request, so deleting or replacing it shuts old links out at once.
    const token = tokenOf(file), cookie = `sign-off-${bound}`, given = req.url?.startsWith('/?') ? new URL(req.url, 'http://x').searchParams.get('token') : null;
    const pass = /^\/mock\/([^/?]*)\//.exec(req.url ?? '')?.[1], want = Buffer.from(pass === undefined ? token : mockPass(token));
    const sent = Buffer.from(pass ?? given ?? req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(`${cookie}=`))?.slice(cookie.length + 1) ?? '');
    if (!/^[\w-]{32,}$/.test(token) || sent.length !== want.length || !timingSafeEqual(sent, want)) {
      return res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' }).end('This board needs its access link: run sign-off-axi open on the computer that serves it and open the link it prints.');
    }
    if (given !== null) return res.writeHead(303, { location: '/', 'set-cookie': `${cookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` }).end();
  }
  if (req.method === 'GET' && req.url === '/') {
    return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self' 'unsafe-inline'" }).end(page);
  }
  let status: number, body: unknown;
  try {
    [status, body] = await route(req);
  } catch (e: any) {
    status = e instanceof InputError ? (req.method === 'GET' ? 422 : 409) : e instanceof SyntaxError ? 400 : 500;
    body = { error: e.message };
  }
  if (body && typeof body === 'object' && 'media' in body) {
    const { media: bytes, type, point } = body as { media: Buffer; type: string; point?: boolean }, media = point ? Buffer.concat([bytes, pointer]) : bytes;
    const headers = { 'content-type': type, 'x-content-type-options': 'nosniff', 'content-security-policy': FRAME_CSP, 'accept-ranges': 'bytes', 'content-length': media.length };
    // One byte range, so phone browsers can play and seek a recording.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (!range || (!range[1] && !range[2])) return res.writeHead(status, headers).end(media);
    const start = range[1] ? Number(range[1]) : Math.max(0, media.length - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    if (start > end) return res.writeHead(416, { 'content-range': `bytes */${media.length}` }).end();
    return res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${media.length}` }).end(media.subarray(start, end + 1));
  }
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
});

const argv = process.argv.slice(2);
// Flags with no command belong to the default list view (sign-off-axi --json).
if (argv[0]?.startsWith('-') && !['--help', '-v', '-V', '--version'].includes(argv[0])) argv.unshift('list');
await runAxiCli({
  description: 'Ask the user yes/no or pick-one questions on one local board and read their answers back',
  version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
  argv,
  topLevelHelp: TOP_HELP,
  getCommandHelp: (cmd) => HELP[cmd],
  home: axi('list', list),
  commands: { list: axi('list', list), raise: axi('raise', (args) => post(args, 'raise')), post: axi('post', post), answers: axi('answers', answers), wait: axi('wait', wait), poll: axi('poll', poll), open: axi('open', open), status: axi('status', status), stop: axi('stop', stop), serve: axi('serve', serve), export: axi('export', exportBoard), init: axi('init', init), report: axi('report', report), signin: axi('signin', signin), doctor: axi('doctor', doctor), validate, help: ([name, ...rest]) => {
    if (rest.length || (name && !HELP[name])) throw fail(`unknown command or argument: ${[name, ...rest].join(' ')}`, 'VALIDATION_ERROR', 'Run `sign-off-axi --help` to see the commands');
    return name ? HELP[name] : TOP_HELP;
  } },
});
