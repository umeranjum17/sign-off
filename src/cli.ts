#!/usr/bin/env node
import { createServer, type IncomingMessage } from 'node:http';
import { type AddressInfo, isIP } from 'node:net';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { encode } from '@toon-format/toon';
import { AxiError, runAxiCli } from 'axi-sdk-js';
import { CHAPTERS_MAX, type Decision, InputError, MEDIA_MAX, NOTE_MAX, answersPath, appendAnswer, appendMessage, appendRound, loadDecisions, markDelivered, messagesPath, readAnswers, readMessages, readRounds } from './store.js';

const BOARD = join(homedir(), '.sign-off', 'decisions.json');
const FORMAT = 'https://github.com/umeranjum17/sign-off/blob/main/docs/file-formats.md';
const TOP_HELP = `usage: sign-off-axi [command] [board.json] [flags]
commands[14]:
  (none)=list, raise, post, answers, wait, poll, open, status, stop, serve, export, init, doctor, help
board: ~/.sign-off/decisions.json unless a board file is given; answers are saved next to it
flags: --full and --json on list, answers and wait, --json on status, --help on every command, -v/--version
examples:
  sign-off-axi
  sign-off-axi raise --title "Ship the new sign-in screen this week?" --recommend yes
  sign-off-axi post --type evidence --title "Sign-in screen on a phone" --about "The new screen loads in 1 second." --media shot.png
  sign-off-axi post .sign-off/decisions.json --type design --title "Pick the sign-in layout" --option a=A --option b=B --mock a=mocks/a.html --mock b=mocks/b.html --recommend b
  sign-off-axi post .sign-off/decisions.json --type diagram --title "Is this the sign-in flow?" --view mocks/sign-in/flow.svg
  sign-off-axi post --type explainer --title "Is the new sign-in clear?" --about "The new sign-in has 2 steps." --media explainer.mp4 --chapter 0:00=Start
  sign-off-axi init
  sign-off-axi doctor
  sign-off-axi open
  sign-off-axi wait --key ship-the-new-sign-in-screen-this-week
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
  raise: `usage: sign-off-axi raise [board.json] --title "<question>" [--key <key>] [--about <text>] [--detail <text>] [--option <value>=<label>]... [--recommend <value>] [--default <value>] [--close done|release]
       sign-off-axi raise [board.json] --from <decisions.json>
Adds questions to the board: yes/no, or 2 to 6 choices with one --option each. --key defaults to a slug of the title.
raise is the alias for post --type decision: same flags, same output.
--recommend and --default name a value (yes or no without --option). --default is what happens if the user stays silent; it is shown, never applied.
--from adds every decision in a decisions file: ${FORMAT}
Raising the same question again is a no-op that reports its status; a different question under a used key is refused.
examples:
  sign-off-axi raise --title "Keep the weekly digest?" --about "Open rate held steady." --recommend yes
  sign-off-axi raise --title "When should it ship?" --option today=Today --option friday=Friday --option next-week="Next week" --recommend friday
  sign-off-axi raise --from ./decisions.json
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
  wait: `usage: sign-off-axi wait [board.json] [--key <key>] [--timeout 600] [--full] [--json]
Blocks until the user answers, then prints the answer the way answers does. Use it instead of a polling loop.
  --key      wait for that decision; an answer saved before wait starts returns at once
             and a key not raised yet is waited for too
             without --key, wait for the next answer to any decision still waiting; NOT_FOUND when nothing is
  --timeout  seconds to wait, 600 (10 minutes) by default; then exits 1 with code TIMEOUT
  --full     adds the button label, close and title
  --json     {"<key>":{"answer","label","close","at","note"?}} for the new answers; note only when the user wrote one
A note column appears when any shown answer has a note.
Ctrl-C stops waiting; nothing is changed.
examples:
  sign-off-axi wait --key keep-the-weekly-digest
  sign-off-axi wait ./decisions.json --timeout 60 --json
`,
  open: `usage: sign-off-axi open [board.json] [--port 4410] [--bind <address>] [--evidence-root <dir>]
Starts the board in the background on 127.0.0.1 and prints its URL and pid; a no-op when this board is already open.
--bind serves it on one private address of this machine instead (such as its VPN address), so a phone or tablet on the user's own network can open it;
the bind line in config.yaml next to the board sets the same. Beyond 127.0.0.1 the board needs an access token: it is made once, kept in <board>.token,
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
Runs the board in the foreground until Ctrl-C; --port 0 picks a free port; --bind works as for open. Use open to run it in the background.
examples:
  sign-off-axi serve --port 0
`,
  post: `usage: sign-off-axi post [board.json] [--type decision|design|diagram|interactive] --title "<question>" [--key <key>] [--about <text>] [--option <value>=<label>]... [--mock <value>=<path>]... [--view <path>] [--tradeoff <text>] [--recommend <value>] [--default <value>] [--close done|release]
       sign-off-axi post [board.json] --type evidence --title "<what this shows>" --about "<short note>" --media <file>... [--link <commit or URL>] [--detail <text>]
       sign-off-axi post [board.json] --type explainer --title "<question>" --media <video> [--about <summary>] [--chapter <m:ss>=<title>]... [--key <key>] [--option <value>=<label>]... [--recommend <value>]
Posts an item for the user. --type decision (the default) is a yes/no or pick-one question, exactly like raise.
--type design is a pick between up to 6 options shown side by side, each with an optional board-relative mock file
(.html, .svg, .png, .jpg, .jpeg, .webp), a --tradeoff line and a --recommend badge.
One .html page can hold every variant: --mock a=mocks/<key>/index.html?variant=a and so on; the page reads ?variant= to show one.
After the user picks, answers --key <key> --json holds the pick and note; "rounds" holds an ask for another round.
--type diagram and --type interactive are a decision shown with a picture: --view names one board-relative file,
an image (.svg, .png, .jpg, .jpeg, .webp, 5 MB or less) shown at card width for a diagram, or one self-contained .html page for interactive.
The page runs in a sandboxed frame: no fetch, no remote files, no access to the dashboard or its tab. Answers work as for a decision.
--type evidence posts the next numbered update (key update-<number>): 1 to ${MEDIA_MAX} screenshots or recordings (.png, .jpg, .jpeg, .webp, .mp4, .webm, 50 MB each), copied into evidence/<number>/ next to the board, with a short note and an optional commit or PR link.
The user gives a verdict, pass, fail or needs-work, with an optional note; read it with answers or wait --key update-<number>.
--type explainer is a decision shown with a narrated video you made: one --media .mp4 or .webm (50 MB or less), copied into evidence/<number>/ like evidence
and played on the card. --about is its short summary; up to ${CHAPTERS_MAX} --chapter m:ss=<title> (in order) are buttons that jump the video there. Answers work as for a decision.
examples:
  sign-off-axi post --type design --title "Pick the sign-in layout" --option a="A: single column" --option b="B: split screen" --mock a=mocks/a.html --mock b=mocks/b.html --tradeoff "B scans fastest; A is simplest." --recommend b
  sign-off-axi post .sign-off/decisions.json --type design --key sign-in --title "Pick the sign-in layout" --option a=A --option b=B --option c=C --mock a=mocks/sign-in/index.html?variant=a --mock b=mocks/sign-in/index.html?variant=b --mock c=mocks/sign-in/index.html?variant=c --tradeoff "..." --recommend b
  sign-off-axi post --type decision --title "Keep the weekly digest?" --recommend yes
  sign-off-axi post .sign-off/decisions.json --type interactive --title "Does the sign-in flow feel right?" --view mocks/sign-in/demo.html --option yes=Yes --option no="Needs work"
  sign-off-axi post --type evidence --title "Sign-in screen on a phone" --about "The new screen loads in 1 second." --media phone.png --media flow.mp4 --link https://github.com/acme/app/pull/12
  sign-off-axi post --type explainer --title "Is the new sign-in clear?" --about "The new sign-in has 2 steps." --media explainer.mp4 --chapter 0:00=Start --chapter 0:12="Step 2"
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
Writes a frozen, read-only copy of the board: one HTML file with every item, answer, note and comment, and its local mocks and media inlined.
It opens from disk with no server and makes no network request. --out defaults to <board>.export.html next to the board.
examples:
  sign-off-axi export
  sign-off-axi export ./decisions.json --out ~/board-12-oct.html
`,
  init: `usage: sign-off-axi init [dir]
Writes a repo's sign-off setup under <dir>/.sign-off/ (config, an empty board, mocks/ and evidence/ folders, and a .gitignore keeping media and answer files out of git). A file that is already there is kept, never changed.
examples:
  sign-off-axi init
  sign-off-axi init ./my-project
`,
  doctor: `usage: sign-off-axi doctor [dir]
Checks the repo setup init wrote: node version, config, board file, gitignore coverage, and whether the dashboard port answers. Every failure names its fix.
examples:
  sign-off-axi doctor
`,
};
const warn = (msg: string) => console.error(`sign-off-axi: ${msg}`);
const tilde = (path: string) => (path.startsWith(homedir() + sep) ? `~${path.slice(homedir().length)}` : path);
const fail = (message: string, code: string, ...help: string[]) => new AxiError(message, code, help);
/** TOON data, then next-step hints one per line, the way the other AXIs print them. */
const toon = (data: object, help: string[] = []) => [encode(data), ...(help.length ? [`help[${help.length}]:`, ...help.map((h) => `  ${h}`)] : [])].join('\n');
class EvidenceError extends Error {}

type Flags = Record<string, { type: 'string' | 'boolean'; default?: string; multiple?: boolean }>;
const TIERS: Flags = { full: { type: 'boolean' }, json: { type: 'boolean' } };
const BOARD_FLAGS: Flags = { port: { type: 'string', default: '4410' }, bind: { type: 'string' }, 'evidence-root': { type: 'string' } };
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
  // One spelling per board, so a symlinked path finds the same pid record and server.
  const path = given === undefined ? BOARD : resolve(given), real = existsSync(path) ? realpathSync(path) : path;
  return { file: real, values: parsed.values as Record<string, any>, on };
}
const portOf = (value: string) => {
  if (!/^\d{1,5}$/.test(value) || Number(value) > 65535) throw fail('--port must be a number from 0 to 65535', 'VALIDATION_ERROR');
  return Number(value);
};
/** Maps a decisions-file problem to a structured usage error (exit 2). */
const axi = (cmd: string, run: (args: string[]) => string | Promise<string>) => async (args: string[]) => {
  try { return await run(args); } catch (e) {
    throw e instanceof InputError ? fail(e.message, 'VALIDATION_ERROR', `Run \`sign-off-axi ${cmd} --help\`; the file format is at ${FORMAT}`) : e;
  }
};

/** The board's decisions with their latest answer; a missing board file is an empty board. */
function board(file: string, say = warn) {
  if (!existsSync(file)) return [];
  const decisions = loadDecisions(file), answers = readAnswers(file, say);
  for (const key of Object.keys(answers)) if (!decisions.some((d) => d.key === key)) say(`left out the answer for ${key}: that question is no longer in ${basename(file)}`);
  return decisions.map((d) => ({ ...d, answer: Object.hasOwn(answers, d.key) ? answers[d.key] : undefined }));
}
function ready(file: string, on: string, root?: string) {
  if (!existsSync(file)) throw fail(`no board yet at ${tilde(file)}`, 'NOT_FOUND', `Run \`sign-off-axi raise${on} --title "<question>"\` first`);
  if (root && !statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw fail(`--evidence-root ${tilde(resolve(root))} is not a folder`, 'VALIDATION_ERROR', 'Pass the folder that holds .done-done/');
  loadDecisions(file);
}

function list(args: string[]) {
  const { file, values, on } = parse('list', args, TIERS);
  const rows = board(file), waiting = rows.filter((d) => !d.answer), answered = rows.length - waiting.length;
  if (values.json) return JSON.stringify({ board: file, decisions: rows });
  const help = [
    ...(waiting.length ? [`Run \`sign-off-axi open${on}\` to show the board to the user`] : []),
    ...(answered ? [`Run \`sign-off-axi answers${on}\` to read the ${answered} saved answers`] : []),
    `Run \`sign-off-axi raise${on} --title "<question>"\` to ask the user a yes/no or pick-one question`,
  ];
  const where = tilde(file) + (existsSync(file) ? '' : ' (no file yet; raise creates it)');
  if (values.full) {
    return toon({ board: where, decisions: rows.map((d) => ({ key: d.key, status: d.answer?.answer ?? 'waiting', title: d.title, about: d.about ?? '', detail: d.detail ?? '',
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
    const out: Record<string, any> = Object.fromEntries(done.map(({ key, answer, label, close, at, note }) => {
      const asked = rounds.filter((r) => r.key === key).map(({ note, at }) => ({ note, at }));
      return [key, { answer, label, close, at, note, ...(asked.length && { rounds: asked }) }];
    }));
    for (const r of rounds) if (!out[r.key]) out[r.key] = { rounds: rounds.filter((q) => q.key === r.key).map(({ note, at }) => ({ note, at })) };
    return JSON.stringify(out);
  }
  const notes = done.some((a) => a.note);
  return toon({
    board: tilde(file),
    answers: done.length ? done.map(({ key, answer, at, label, close, title, note = '' }) => ({ key, answer, at, ...(values.full && { label, close, title }), ...(notes && { note }) })) : '0 saved yet',
    ...(rounds.length && { rounds: rounds.map(({ key, note, at }) => ({ key, note, at })) }),
    waiting,
  }, help);
}

function answers(args: string[]) {
  const { file, values, on } = parse('answers', args, { ...TIERS, key: { type: 'string' } });
  const rows = board(file).filter((d) => values.key === undefined || d.key === values.key);
  if (values.key !== undefined && !rows.length) throw fail(`no decision with key ${values.key} on ${tilde(file)}`, 'NOT_FOUND', `Run \`sign-off-axi list${on}\` to see the waiting keys`);
  const waiting = rows.filter((d) => !d.answer).length, key = values.key === undefined ? '' : ` --key ${values.key}`;
  return printAnswers(file, rows, waiting, values, waiting ? [`Run \`sign-off-axi open${on}\` so the user can answer the ${waiting} waiting`, `Run \`sign-off-axi wait${on}${key}\` to block until they answer`] : []);
}

async function wait(args: string[]) {
  const { file, values, on } = parse('wait', args, { ...TIERS, key: { type: 'string' }, timeout: { type: 'string', default: '600' } });
  if (!/^\d{1,7}$/.test(values.timeout)) throw fail('--timeout must be whole seconds, 0 or more', 'VALIDATION_ERROR', `Run \`sign-off-axi wait --help\``);
  if (values.key === undefined) ready(file, on);
  const seconds = Number(values.timeout), deadline = Date.now() + seconds * 1000, key = values.key === undefined ? '' : ` --key ${values.key}`;
  const before = new Set(board(file).flatMap((d) => (d.answer ? [d.key] : [])));
  // Rounds seen before waiting starts stay quiet; only a newly asked round wakes the loop.
  const seenRounds = new Map<string, number>();
  for (const r of readRounds(file)) seenRounds.set(r.key, (seenRounds.get(r.key) ?? 0) + 1);
  // A save wakes the loop at once; the 1 second timer is the fallback where file events are unavailable.
  let wake = () => {}, watcher;
  const name = basename(answersPath(file));
  try {
    try { watcher = watch(dirname(file), (_, changed) => changed === name && wake()).on('error', () => {}); } catch {}
    for (let first = true; ; first = false) {
      const rows = board(file, first ? warn : () => {}), waiting = rows.filter((d) => !d.answer).length;
      const hit = rows.filter((d) => (values.key === undefined ? d.answer && !before.has(d.key) : d.key === values.key));
      const counts = new Map<string, number>();
      for (const r of readRounds(file, first ? warn : () => {})) counts.set(r.key, (counts.get(r.key) ?? 0) + 1);
      const fresh = rows.filter((d) => (counts.get(d.key) ?? 0) > (seenRounds.get(d.key) ?? 0)
        && (values.key === undefined || d.key === values.key));
      for (const [k, n] of counts) seenRounds.set(k, n);
      const found = [...new Map([...hit.filter((d) => d.answer), ...fresh].map((d) => [d.key, d] as const)).values()];
      if (found.length) {
        return printAnswers(file, found, waiting, values,
          [waiting ? `Run \`sign-off-axi wait${on}\` for the next of the ${waiting} waiting` : `Run \`sign-off-axi stop${on}\` to close the board`]);
      }
      if (values.key === undefined && !waiting) throw fail(`nothing is waiting on ${tilde(file)}`, 'NOT_FOUND', `Run \`sign-off-axi answers${on}\` to read the saved answers`, `Run \`sign-off-axi raise${on} --title "<question>"\` to ask a new one`);
      const left = deadline - Date.now();
      if (left <= 0) {
        if (key && !hit.length) throw fail(`no decision with key ${values.key} was raised on ${tilde(file)} within ${seconds}s`, 'TIMEOUT', `Run \`sign-off-axi list${on}\` to see the waiting keys`);
        throw fail(`no answer${key ? ` for ${values.key}` : ''} within ${seconds}s`, 'TIMEOUT', `Run \`sign-off-axi wait${on}${key} --timeout ${seconds}\` to keep waiting`,
          ...(await running(file).catch(() => true) ? [] : [`Run \`sign-off-axi open${on}\` so the user can answer: the board is not open`]));
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

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 64).replace(/^-+|-+$/g, '') || 'decision';
/** Runs fn while holding an exclusive lock file, so two agents raising at once never drop a decision. */
async function locked<T>(lock: string, fn: () => T | Promise<T>, busy = 'another raise is still writing the board', tries = 150): Promise<T> {
  for (;;) {
    try { closeSync(openSync(lock, 'wx')); break; } catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
      if (!tries--) throw fail(busy, 'BUSY', `If no sign-off-axi is running, delete ${tilde(lock)} and try again`);
      await new Promise((ok) => setTimeout(ok, 20));
    }
  }
  try { return await fn(); } finally { rmSync(lock, { force: true }); }
}

/** A mock path without its optional `?variant=<name>` suffix, which picks one variant of a single .html page. */
const mockFile = (path: string) => path.split('?')[0];
/** Posts an item. `raise` is the alias for `post --type decision`: same flags as before, same output. */
function post(args: string[], cmd = 'post') {
  const typed: Flags = cmd === 'post' ? { type: { type: 'string' }, tradeoff: { type: 'string' }, mock: { type: 'string', multiple: true },
    media: { type: 'string', multiple: true }, link: { type: 'string' }, view: { type: 'string' }, chapter: { type: 'string', multiple: true } } : {};
  const { file, values, on } = parse(cmd, args, { from: { type: 'string' }, ...typed,
    ...Object.fromEntries(RAISE_FIELDS.map((f) => [f, { type: 'string' as const, multiple: f === 'option' }])) });
  const given = [...RAISE_FIELDS, 'type', 'tradeoff', 'mock', 'media', 'link', 'view', 'chapter'].filter((f) => values[f] !== undefined);
  if (values.from !== undefined && given.length) throw fail(`--from cannot be combined with --${given[0]}`, 'VALIDATION_ERROR', `Put every field in the --from file, or ${cmd} with flags only`);
  const type = values.type ?? 'decision';
  if (values.from === undefined && values.title === undefined) {
    throw fail('--title is required (or --from <decisions.json>)', 'VALIDATION_ERROR', type === 'design' ? 'sign-off-axi post --type design --title "<question>" --option a=A --option b=B'
      : type === 'evidence' ? 'sign-off-axi post --type evidence --title "<what this shows>" --about "<short note>" --media <file>' : `sign-off-axi ${cmd} --title "<question>" [--recommend <value>]`);
  }
  if (!['decision', 'design', 'evidence', 'diagram', 'interactive', 'explainer'].includes(type)) throw fail(`--type must be decision, design, evidence, diagram, interactive or explainer`, 'VALIDATION_ERROR', 'Run `sign-off-axi post --help`');
  if (type === 'evidence' || type === 'explainer') return postMedia(file, on, values, type);
  if (values.media !== undefined || values.link !== undefined || values.chapter !== undefined) throw fail('--media, --link and --chapter need --type evidence or explainer', 'VALIDATION_ERROR', 'Run `sign-off-axi post --help`');
  if (type !== 'design' && (values.tradeoff !== undefined || values.mock !== undefined)) throw fail('--tradeoff and --mock need --type design', 'VALIDATION_ERROR', 'Run `sign-off-axi post --help`');
  const view = type === 'diagram' || type === 'interactive';
  if (view !== (values.view !== undefined)) throw fail(view ? `--type ${type} needs --view <path>` : '--view needs --type diagram or interactive', 'VALIDATION_ERROR', 'Run `sign-off-axi post --help`');
  if (type === 'decision') return storeIncoming(file, on, buildIncoming(values));
  const root = resolve(dirname(file));
  if (view) {
    // The same real-path check the board serves with, so a post that passes always renders.
    const escapes = () => fail(`--view ${values.view} escapes the board folder`, 'VALIDATION_ERROR', 'Keep the file next to the board file, under mocks/<key>/');
    if (!resolve(root, values.view).startsWith(root + sep)) throw escapes();
    let actual;
    try { actual = under(root, values.view); } catch (e: any) {
      throw e.message === 'no matching mock file' ? fail(`--view ${values.view} is not a file in ${tilde(root)}`, 'NOT_FOUND', 'Paths are relative to the board file\'s folder') : escapes();
    }
    const size = statSync(actual);
    if (!size.isFile() || size.size > MOCK_BYTES) throw fail(`--view ${values.view} must be a file of 5 MB or less`, 'VALIDATION_ERROR');
    return storeIncoming(file, on, buildIncoming(values, { type, view: values.view }));
  }
  const mocks = values.mock?.map((m: string) => {
    const at = m.indexOf('=');
    if (at < 1) throw fail(`--mock ${m} must be <value>=<path>`, 'VALIDATION_ERROR', 'sign-off-axi post --type design --title "<question>" --option a=A --mock a=mocks/a.html');
    const path = m.slice(at + 1), name = mockFile(path);
    if (!mockTypes[extname(name).toLowerCase()]) throw fail(`--mock ${path} must end in ${Object.keys(mockTypes).join(', ')}`, 'VALIDATION_ERROR');
    if (!resolve(root, name).startsWith(root + sep)) throw fail(`--mock ${path} escapes the board folder`, 'VALIDATION_ERROR', 'Keep mock files next to the board file');
    return { value: m.slice(0, at), path };
  });
  return storeIncoming(file, on, buildIncoming(values, { type, tradeoff: values.tradeoff, mocks }));
}

const MEDIA_BYTES = 50_000_000;
/** Copies the media into evidence/<n>/ next to the board and adds the item, numbered under the board lock: update-<n>, or an explainer under its own key. */
function postMedia(file: string, on: string, values: Record<string, any>, type: 'evidence' | 'explainer') {
  const explainer = type === 'explainer';
  const extra = (explainer ? ['mock', 'tradeoff', 'view', 'link'] : ['key', 'option', 'recommend', 'default', 'mock', 'tradeoff', 'view', 'chapter']).find((f) => values[f] !== undefined);
  if (extra) throw fail(`--${extra} does not apply to --type ${type}`, 'VALIDATION_ERROR', 'Run `sign-off-axi post --help`');
  const example = explainer ? 'sign-off-axi post --type explainer --title "<question>" --about "<short summary>" --media explainer.mp4'
    : 'sign-off-axi post --type evidence --title "<what this shows>" --about "<short note>" --media shot.png';
  if (!explainer && !values.about?.trim()) throw fail('--about is required for --type evidence: the short note', 'VALIDATION_ERROR', example);
  if (explainer && values.media?.length !== 1) throw fail('--type explainer needs one --media video (.mp4 or .webm)', 'VALIDATION_ERROR', example);
  if (!values.media?.length || values.media.length > MEDIA_MAX) throw fail(`--type evidence needs 1 to ${MEDIA_MAX} --media files`, 'VALIDATION_ERROR', example);
  const kinds = explainer ? ['.mp4', '.webm'] : Object.keys(mediaTypes), options = optionsOf(values);
  const chapters = values.chapter?.map((c: string) => {
    const m = /^(\d{1,3}):([0-5]\d)=(.+)$/.exec(c);
    if (!m) throw fail(`--chapter ${c} must be <m:ss>=<title>`, 'VALIDATION_ERROR', 'sign-off-axi post --type explainer ... --chapter 0:00=Start --chapter 0:12="Step 2"');
    return { at: Number(m[1]) * 60 + Number(m[2]), title: m[3] };
  });
  const sources: string[] = values.media.map((m: string) => {
    const path = resolve(m), info = statSync(path, { throwIfNoEntry: false });
    if (!kinds.includes(extname(path).toLowerCase())) throw fail(`--media ${m} must end in ${kinds.join(', ')}`, 'VALIDATION_ERROR');
    if (!info?.isFile()) throw fail(`--media ${tilde(path)} is not a file`, 'NOT_FOUND');
    if (info.size > MEDIA_BYTES) throw fail(`--media ${tilde(path)} is over 50 MB`, 'VALIDATION_ERROR', 'Trim or compress the recording');
    return path;
  });
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  return locked(`${file}.lock`, () => {
    const doc = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { schema: 1, decisions: [] };
    // Boards in one folder share evidence/, so a number is taken only by creating its folder; one in use is never written into.
    const current = board(file), store = join(dirname(file), 'evidence'), taken = current.map((d) => Number(/^update-(\d+)$/.exec(d.key)?.[1] ?? 0));
    const own = explainer && (values.key ?? slug(values.title));
    if (own && current.some((d) => d.key === own)) throw fail(`key ${own} is already used on ${tilde(file)}`, 'CONFLICT', 'Post it under a new --key');
    mkdirSync(store, { recursive: true, mode: 0o700 });
    let number = Math.max(0, ...taken, ...readdirSync(store).map(Number).filter(Number.isInteger)) + 1;
    for (;; number++) {
      try { mkdirSync(join(store, String(number)), { mode: 0o700 }); break; } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
    }
    const key = own || `update-${number}`, dir = join(store, String(number));
    const media = sources.map((src, i) => {
      const bytes = readFileSync(src), path = `evidence/${number}/${i + 1}${extname(src).toLowerCase()}`;
      writeFileSync(join(dir, `${i + 1}${extname(src).toLowerCase()}`), bytes, { mode: 0o600 });
      return { path, sha256: sha256(bytes), bytes: bytes.length };
    });
    const { title, about, detail, close, link, recommend: recommend_value, default: default_if_silent } = values;
    doc.decisions.push(explainer ? { key, type, title, about, detail, options, recommend_value, default_if_silent, close, chapters, media }
      : { key, type, number, title, about, detail, close, link, media });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
    try { loadDecisions(tmp); } catch (e) {
      rmSync(tmp, { force: true });
      rmSync(dir, { recursive: true, force: true });
      throw e instanceof InputError ? new InputError(e.message.replace(basename(tmp), basename(file))) : e;
    }
    renameSync(tmp, file);
    if (explainer) return toon({ board: tilde(file), raised: [{ key, status: 'raised', title }] }, [`Run \`sign-off-axi open${on}\` so the user can watch and answer`, `Run \`sign-off-axi wait${on} --key ${key}\` to block until they do`]);
    return toon({ board: tilde(file), posted: [{ key, number, media: media.length, title }] },
      [`Run \`sign-off-axi open${on}\` so the user can give a verdict`, `Run \`sign-off-axi wait${on} --key ${key}\` to block until they do`]);
  });
}

const optionsOf = (values: Record<string, any>) => values.option?.map((o: string) => {
  const at = o.indexOf('=');
  if (at < 1) throw fail(`--option ${o} must be <value>=<label>`, 'VALIDATION_ERROR', 'sign-off-axi raise --title "<question>" --option friday=Friday --option next-week="Next week"');
  return { value: o.slice(0, at), label: o.slice(at + 1) };
});
/** Flags are validated by the same loader as a file: write them as a one-decision file first. */
function buildIncoming(values: Record<string, any>, extra: object = {}): { incoming: Decision[]; raw: object[] } {
  if (values.from !== undefined) {
    const source = resolve(values.from);
    return { incoming: loadDecisions(source), raw: JSON.parse(readFileSync(source, 'utf8')).decisions };
  }
  const scratch = mkdtempSync(join(tmpdir(), 'sign-off-'));
  const source = join(scratch, 'flags');
  try {
    const { title, key = slug(title), about, detail, recommend: recommend_value, default: default_if_silent, close } = values;
    writeFileSync(source, JSON.stringify({ schema: 1, decisions: [{ key, title, about, detail, options: optionsOf(values), recommend_value, default_if_silent, close, ...extra }] }));
    return { incoming: loadDecisions(source), raw: JSON.parse(readFileSync(source, 'utf8')).decisions };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function storeIncoming(file: string, on: string, { incoming, raw }: { incoming: Decision[]; raw: object[] }) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  return locked(`${file}.lock`, () => {
    const current = board(file), doc = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { schema: 1, decisions: [] };
    const raised = incoming.map((d, i) => {
      const had = current.find((c) => c.key === d.key);
      const same = (x: Decision) => JSON.stringify({ ...x, answer: undefined, options: [...x.options].sort((a, b) => a.value.localeCompare(b.value)) });
      if (had && same(had) !== same(d)) {
        throw fail(`key ${d.key} already holds a different question on ${tilde(file)}`, 'CONFLICT', 'Raise it under a new --key');
      }
      if (!had) doc.decisions.push(raw[i]);
      return { key: d.key, status: !had ? 'raised' : had.answer ? `already answered ${had.answer.answer}` : 'already waiting', title: d.title };
    });
    if (raised.some((r) => r.status === 'raised')) {
      writeFileSync(`${file}.${process.pid}.tmp`, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
      renameSync(`${file}.${process.pid}.tmp`, file);
    }
    const key = raised.length === 1 ? ` --key ${raised[0].key}` : '';
    const open = raised.some((r) => !r.status.startsWith('already answered')) ? [`Run \`sign-off-axi open${on}\` so the user can answer`] : [];
    return toon({ board: tilde(file), raised }, [...open, `Run \`sign-off-axi answers${on}${key}\` to read ${key ? 'the answer' : 'the answers'}`]);
  });
}

async function open(args: string[]) {
  const { file, values, on } = parse('open', args, BOARD_FLAGS);
  const port = portOf(values.port);
  ready(file, on, values['evidence-root']);
  const host = bindOf(file, values.bind);
  // The lock makes concurrent opens take turns, so a second one finds the first board instead of starting another.
  return locked(`${record(file)}.lock`, () => start(file, port, host, values, on), 'another open is still starting this board', 600);
}
async function start(file: string, port: number, host: string, values: Record<string, any>, on: string) {
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
  const child = spawn(process.execPath, [process.argv[1], 'serve', file, '--port', String(port), '--bind', host, ...evidence], { detached: true, stdio: ['ignore', out, out] });
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
}).then((r) => (r.status === 401 ? { locked: true } : r.json())).catch((e) => {
  if (e.name === 'TimeoutError') throw fail(`the board on port ${port} did not answer within 1 second`, 'BUSY', 'Run the command again in a moment');
});
const alive = (pid: number) => { try { return process.kill(pid, 0); } catch (e: any) { return e.code === 'EPERM'; } };
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
const loopback = (host: string) => /^127\./.test(host) || host === '::1';
const urlHost = (host: string) => (isIP(host) === 6 ? `[${host}]` : host);
/** --bind, else the bind line of config.yaml next to the board, else 127.0.0.1. */
function bindOf(file: string, given?: string) {
  const host = given ?? (existsSync(join(dirname(file), 'config.yaml')) ? readConfig(dirname(file)).bind : undefined) ?? '127.0.0.1';
  if (!isIP(host) || !PRIVATE.test(host)) throw fail(`bind address ${host} must be 127.0.0.1 or a private address of this machine, never all interfaces or a public address`,
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
function repoDir(cmd: string, args: string[]) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, strict: true, options: {} });
  } catch {
    throw fail(`\`${cmd}\` takes only a folder`, 'VALIDATION_ERROR', `Run \`sign-off-axi ${cmd} --help\``);
  }
  const [dir, extra] = parsed.positionals;
  if (extra !== undefined) throw fail(`unexpected argument ${extra}: \`${cmd}\` takes one folder`, 'VALIDATION_ERROR', `Run \`sign-off-axi ${cmd} --help\``);
  return resolve(dir ?? '.');
}

const GITIGNORE = 'mocks/\nevidence/\n*.answers.jsonl\n*.rounds.jsonl\n*.messages.jsonl\n*.board.pid\n*.board.log\n*.token\n*.export.html\n';
function init(args: string[]) {
  const dir = repoDir('init', args), so = join(dir, '.sign-off');
  const board = join(so, 'decisions.json');
  const files: [string, string][] = [
    [join(so, 'config.yaml'), `# sign-off repo setup. board: path under .sign-off/, port: dashboard port.\n# bind: 127.0.0.1 keeps the dashboard on this machine; a private address such as its VPN address lets a phone open it.\nboard: decisions.json\nport: 4410\nbind: 127.0.0.1\n`],
    [board, `{"schema": 1, "decisions": []}\n`],
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
  return toon({ dir: tilde(dir), created: created.length ? created : 'nothing new (re-run is a no-op)', kept, board: tilde(board) },
    [`Run \`sign-off-axi post ${tilde(board)} --type design --title "<question>" --option a=A --option b=B\` to ask for a pick`,
      `Run \`sign-off-axi doctor ${tilde(dir)}\` to check the setup`, `Run \`sign-off-axi open ${tilde(board)}\` to show the board to the user`]);
}

/** Reads the `key: value` lines init writes into <so>/config.yaml; anything else in the file is ignored. */
const readConfig = (so: string) => Object.fromEntries(
  readFileSync(join(so, 'config.yaml'), 'utf8').split('\n')
    .map((l) => l.split('#')[0].match(/^\s*([A-Za-z]+)\s*:\s*(\S+)\s*$/)?.slice(1))
    .filter(Boolean) as [string, string][]);

async function doctor(args: string[]) {
  const dir = repoDir('doctor', args), so = join(dir, '.sign-off');
  const checks: { name: string; ok: string; fix?: string }[] = [];
  const [major, minor] = process.versions.node.split('.').map(Number);
  checks.push(major > 22 || (major === 22 && minor >= 5) ? { name: 'node', ok: `ok (${process.versions.node})` }
    : { name: 'node', ok: `too old (${process.versions.node})`, fix: 'Install Node 22.5 or newer' });
  let board = '', port = 4410;
  try {
    const config = readConfig(so);
    if (!config.board) throw new Error('no board line');
    board = join(so, config.board);
    port = Number(config.port ?? 4410);
  } catch {
    checks.push({ name: 'config', ok: 'missing or unreadable', fix: `Run \`sign-off-axi init ${tilde(dir)}\`` });
  }
  if (board) {
    try {
      const n = loadDecisions(board).length;
      checks.push({ name: 'board', ok: `${n} items` });
    } catch (e: any) {
      checks.push({ name: 'board', ok: e instanceof InputError ? e.message : 'unreadable', fix: `Fix ${tilde(board)}, or re-run \`sign-off-axi init ${tilde(dir)}\`` });
    }
  }
  const ignore = existsSync(join(so, '.gitignore')) ? readFileSync(join(so, '.gitignore'), 'utf8') : '';
  checks.push(ignore.includes('mocks/') && ignore.includes('evidence/') ? { name: 'gitignore', ok: 'mocks/ and evidence/ are ignored' }
    : { name: 'gitignore', ok: 'mocks/ or evidence/ not ignored', fix: `Run \`sign-off-axi init ${tilde(dir)}\` again` });
  if (port) {
    const free = await new Promise((ok) => server.once('error', () => ok(false)).listen(port, '127.0.0.1', () => server.close(() => ok(true))));
    server.removeAllListeners('error');
    checks.push(free ? { name: 'port', ok: `${port} is free` } : { name: 'port', ok: `${port} is busy (the board may already be open)` });
  }
  const bad = checks.filter((c) => c.fix);
  if (bad.length) throw fail(`${bad.length} checks need a fix in ${tilde(dir)}`, 'NOT_FOUND', ...bad.map((c) => `${c.name}: ${c.fix}`));
  return toon({ dir: tilde(dir), checks: checks.map(({ name, ok }) => ({ name, ok })) },
    [`Run \`sign-off-axi open ${tilde(board)}\` to show the board to the user`]);
}

let file = '', evidenceRoot = '', bind = '127.0.0.1';
async function serve(args: string[]) {
  const parsed = parse('serve', args, BOARD_FLAGS), port = portOf(parsed.values.port);
  ready(parsed.file, parsed.on, parsed.values['evidence-root']);
  const live = await running(parsed.file);
  if (live) throw fail(`this board is already open at ${live.url}`, 'CONFLICT', `Run \`sign-off-axi stop${parsed.on}\` first`);
  bind = bindOf(parsed.file, parsed.values.bind);
  if (!loopback(bind)) tokenOf(parsed.file, true);
  [file, evidenceRoot] = [parsed.file, parsed.values['evidence-root'] ? resolve(parsed.values['evidence-root']) : ''];
  await new Promise<void>((ok, no) => server.once('error', no).listen(port, bind, ok)).catch((e) => {
    throw fail(e.code === 'EADDRINUSE' ? `port ${port} is in use; pass --port` : e.code === 'EADDRNOTAVAIL' ? `${bind} is not an address of this machine; pass another --bind` : e.message, 'SERVE_FAILED');
  });
  const bound = (server.address() as AddressInfo).port, url = `http://${urlHost(bind)}:${bound}/`;
  writeFileSync(record(file), `${process.pid} ${bound} ${bind}\n`, { mode: 0o600 });
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
  const { file: _, messages: _messages, ...frozen } = state(), files: Record<string, string> = {}, q = encodeURIComponent;
  let missing = 0;
  // The same URLs the page asks the server for, read through the same hash and path checks.
  const inline = async (url: string, query?: string) => {
    const [code, body] = await route({ method: 'GET', url } as IncomingMessage).catch((): [number, unknown] => [404, null]);
    if (code !== 200) { missing++; return; }
    const { media, type } = body as { media: Buffer; type: string };
    // A data: URL keeps a one-page mock's query where the mock page reads it, but also appends it to the page text: a trailing comment hides it.
    files[url] = query && type === 'text/html' ? `data:text/html;charset=utf-8,${q(media.toString())}%3C!--?${query}` : `data:${type};base64,${media.toString('base64')}`;
  };
  for (const d of frozen.decisions) {
    for (const m of d.mocks ?? []) {
      const query = m.path.split('?')[1];
      await inline(`/api/mock?key=${q(d.key)}&value=${q(m.value)}${query ? `&${query}` : ''}`, query);
    }
    // A diagram or an interactive page is the item's own view, inlined the same way.
    if (d.view) await inline(`/api/mock?key=${q(d.key)}`);
    for (const i of (d.media ?? []).keys()) await inline(`/api/media?key=${q(d.key)}&i=${i}`);
    for (const m of d.evidenceCard?.media ?? []) await inline(m.url);
  }
  const out = resolve(parsed.values.out ?? `${parsed.file.replace(/\.json$/, '')}.export.html`);
  const data = JSON.stringify({ ...frozen, files, exported: `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC` }).replace(/</g, '\\u003c');
  const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; media-src data:; frame-src data:";
  writeFileSync(out, page.toString().replace('</head>', () => `<meta http-equiv="content-security-policy" content="${csp}">\n<script>window.FROZEN = ${data};</script>\n</head>`), { mode: 0o600 });
  return toon({ board: tilde(parsed.file), exported: tilde(out), items: frozen.decisions.length, inlined: Object.keys(files).length, ...(missing && { missing }) },
    [`Open ${tilde(out)} in a browser: one read-only file, no server needed`]);
}


const page = readFileSync(new URL('../web/index.html', import.meta.url));
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const state = () => ({
  file,
  decisions: loadDecisions(file).map((d) => ({ ...d, evidenceCard: d.evidence ? evidenceCard(d.evidence) : null })),
  answers: readAnswers(file, warn),
  rounds: readRounds(file, warn),
  messages: readMessages(file, warn),
});
const mediaTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const mockTypes: Record<string, string> = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MOCK_BYTES = 5_000_000;
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
function contained(path: string, missing = 'no matching evidence file'): string {
  let root: string, actual: string;
  try {
    root = realpathSync(evidenceRoot);
    actual = realpathSync(resolve(root, path));
  } catch { throw new EvidenceError(missing); }
  if (!actual.startsWith(root + sep)) throw new EvidenceError('evidence path escapes the selected root');
  return actual;
}
function evidenceCard(link: NonNullable<Decision['evidence']>) {
  try {
    if (!evidenceRoot) throw new EvidenceError('no evidence root was selected');
    const recordPath = contained(`.done-done/runs/${link.run_id}.json`, 'run record is missing');
    if (statSync(recordPath).size > 1_000_000) throw new EvidenceError('run record is too large');
    const run = JSON.parse(readFileSync(recordPath, 'utf8'));
    if (!run || typeof run !== 'object' || Array.isArray(run)) throw new EvidenceError('run record is malformed or its media is unavailable');
    if (run.schema !== 1 || run.run_id !== link.run_id || run.commit !== link.commit || !/^[a-f0-9]{40}$/.test(run.tree ?? '')
      || typeof run.dirty !== 'boolean' || !(run.exit === null || Number.isInteger(run.exit)) || !Array.isArray(run.files)
      || run.files.some((f: any) => !f || typeof f !== 'object' || typeof f.path !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256 ?? '') || !Number.isInteger(f.bytes) || f.bytes < 0)) {
      throw new EvidenceError('run record is malformed or commit does not match');
    }
    const media: { path: string; url: string; type: string }[] = run.files.flatMap((f: any) => {
      const type = mediaTypes[extname(f.path ?? '').toLowerCase()];
      if (!type) return [];
      const path = contained(f.path);
      if (statSync(path).size > 20_000_000) throw new EvidenceError('media is unavailable or too large');
      const bytes = readFileSync(path);
      if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256) throw new EvidenceError('evidence hash does not match the run record');
      return [{ path: f.path, url: `/api/evidence?run=${encodeURIComponent(link.run_id)}&file=${encodeURIComponent(f.path)}`, type }];
    });
    const result = !Number.isInteger(run.exit) ? 'INCONCLUSIVE' : run.exit !== 0 || run.dirty || !run.files.length ? 'RUN FAIL' : 'RUN PASS';
    return { status: 'verified', result, commit: run.commit, media };
  } catch (e: any) {
    const reason = e instanceof EvidenceError ? e.message
      : e?.code ? 'no matching run record or media'
      : 'run record is malformed or its media is unavailable';
    return { status: 'unverified', result: 'UNVERIFIED', reason, commit: '', media: [] };
  }
}

const MESSAGE_MAX = 2000;
async function route(req: IncomingMessage): Promise<[number, unknown]> {
  if (req.method === 'GET' && req.url?.startsWith('/api/mock?')) {
    const q = new URL(req.url, 'http://localhost').searchParams;
    // With a value, that option's design mock; without, the item's own view (a diagram or interactive page).
    const d = loadDecisions(file).find((x) => x.key === q.get('key'));
    const mock = q.has('value') ? d?.mocks?.find((m) => m.value === q.get('value'))?.path : d?.view;
    const type = mock && mockTypes[extname(mockFile(mock)).toLowerCase()];
    if (!mock || !type) return [404, { error: 'Mock is unavailable' }];
    try {
      const actual = under(dirname(file), mockFile(mock));
      if (statSync(actual).size > MOCK_BYTES) return [404, { error: 'Mock is unavailable' }];
      return [200, { media: readFileSync(actual), type }];
    } catch { return [404, { error: 'Mock is unavailable' }]; }
  }
  if (req.method === 'GET' && req.url?.startsWith('/api/evidence?')) {
    const q = new URL(req.url, 'http://localhost').searchParams, runId = q.get('run') ?? '', path = q.get('file') ?? '';
    const decision = loadDecisions(file).find((d) => d.evidence?.run_id === runId);
    if (!decision?.evidence || !path) return [404, { error: 'Evidence is unavailable' }];
    const card = evidenceCard(decision.evidence);
    if (card.status !== 'verified' || !card.media.some((m) => m.path === path)) return [404, { error: 'Evidence is unavailable' }];
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
  if (req.method !== 'POST' || !['/api/answers', '/api/rounds', '/api/messages'].includes(req.url ?? '')) return [404, { error: 'Not found' }];
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
  if (req.url === '/api/rounds') {
    const { key, note = '' } = JSON.parse(body) ?? {};
    if (typeof note !== 'string' || [...note.trim()].length > NOTE_MAX) return [400, { error: `The note must be text of ${NOTE_MAX} characters or fewer` }];
    if (!note.trim()) return [400, { error: 'Write a note first: another round needs your comment' }];
    if (!loadDecisions(file).some((x) => x.key === key)) return [404, { error: 'This question is no longer in the file' }];
    appendRound(file, key, note.trim());
    return [200, state()];
  }
  const { key, answer, note = '' } = JSON.parse(body) ?? {};
  if (typeof note !== 'string' || [...note.trim()].length > NOTE_MAX) return [400, { error: `The note must be text of ${NOTE_MAX} characters or fewer` }];
  const d = loadDecisions(file).find((x) => x.key === key);
  if (!d) return [404, { error: 'This question is no longer in the file' }];
  const option = d.options.find((o) => o.value === answer);
  if (!option) return [400, { error: `The answer must be one of: ${d.options.map((o) => o.label).join(', ')}` }];
  appendAnswer(file, d, option, note.trim());
  return [200, state()];
}

const server = createServer(async (req, res) => {
  const { port: bound } = server.address() as AddressInfo;
  // Only loopback names and the bound address: blocks DNS rebinding from a web page.
  if (![`127.0.0.1:${bound}`, `localhost:${bound}`, `${urlHost(bind)}:${bound}`].includes(req.headers.host ?? '')) return res.writeHead(403).end('Forbidden host');
  if (!loopback(bind)) {
    // Beyond loopback every request carries the token: once in the link, then in a cookie the link sets.
    // The file is read on every request, so deleting or replacing it shuts old links out at once.
    const token = tokenOf(file), cookie = `sign-off-${bound}`, given = req.url?.startsWith('/?') ? new URL(req.url, 'http://x').searchParams.get('token') : null;
    const sent = Buffer.from(given ?? req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(`${cookie}=`))?.slice(cookie.length + 1) ?? ''), want = Buffer.from(token);
    if (!/^[\w-]{32,}$/.test(token) || sent.length !== want.length || !timingSafeEqual(sent, want)) {
      return res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' }).end('This board needs its access link: run sign-off-axi open on the computer that serves it and open the link it prints.');
    }
    if (given !== null) return res.writeHead(303, { location: '/', 'set-cookie': `${cookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000` }).end();
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
    const { media, type } = body as { media: Buffer; type: string };
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
  commands: { list: axi('list', list), raise: axi('raise', (args) => post(args, 'raise')), post: axi('post', post), answers: axi('answers', answers), wait: axi('wait', wait), poll: axi('poll', poll), open: axi('open', open), status: axi('status', status), stop: axi('stop', stop), serve: axi('serve', serve), export: axi('export', exportBoard), init: axi('init', init), doctor: axi('doctor', doctor), help: ([name, ...rest]) => {
    if (rest.length || (name && !HELP[name])) throw fail(`unknown command or argument: ${[name, ...rest].join(' ')}`, 'VALIDATION_ERROR', 'Run `sign-off-axi --help` to see the commands');
    return name ? HELP[name] : TOP_HELP;
  } },
});
