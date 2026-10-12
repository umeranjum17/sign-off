#!/usr/bin/env node
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { accessSync, closeSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, watch, writeFileSync, type Stats } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { encode } from '@toon-format/toon';
import { AxiError, runAxiCli } from 'axi-sdk-js';
import { CHAPTERS_MAX, type Decision, InputError, MEDIA_MAX, NOTE_MAX, answersPath, appendAnswer, appendRound, createOnce, loadDecisions, readAnswers, readItems, readRounds, roundsPath, writeItems } from './store.js';

const BOARD = join(homedir(), '.sign-off', 'decisions.json');
const FORMAT = 'https://github.com/umeranjum17/sign-off/blob/main/docs/file-formats.md';
const TOP_HELP = `usage: sign-off-axi [command] [board.json] [flags]
commands[12]:
  (none)=list, raise, post, answers, wait, open, status, stop, serve, init, doctor, help
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
  open: `usage: sign-off-axi open [board.json] [--port 4410] [--evidence-root <dir>]
Starts the board in the background on 127.0.0.1 and prints its URL and pid; a no-op when this board is already open.
--port defaults to the port in a config.yaml beside the board (init writes one), else 4410.
--evidence-root is the folder holding .done-done/, for decisions that link run evidence. The server log and its pid file are written next to the board.
examples:
  sign-off-axi open
  sign-off-axi open ./decisions.json --port 4411
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
  serve: `usage: sign-off-axi serve [board.json] [--port 4410] [--evidence-root <dir>]
Runs the board in the foreground until Ctrl-C; --port 0 picks a free port, and it defaults the way open's does. Use open to run it in the background.
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
  init: `usage: sign-off-axi init [dir]
Writes a repo's sign-off setup under <dir>/.sign-off/ (config, an empty board, mocks/ and evidence/ folders, and a .gitignore keeping media and answer files out of git). A file that is already there is kept, never changed; a re-run adds what is missing.
examples:
  sign-off-axi init
  sign-off-axi init ./my-project
`,
  doctor: `usage: sign-off-axi doctor [dir]
Checks the repo setup init wrote: node version, config, board file, answer files, gitignore lines, folders, and whether the dashboard port is free.
Each failure prints one help line naming its fix and exits 1; a clean setup exits 0.
examples:
  sign-off-axi doctor
`,
};
const warn = (msg: string) => console.error(`sign-off-axi: ${msg}`);
const tilde = (path: string) => (path.startsWith(homedir() + sep) ? `~${path.slice(homedir().length)}` : path);
/** A path as a shell word for a printed command: quoted when it has anything but plain path characters, with a leading ~/ kept outside the quotes. */
const shellPath = (path: string) => {
  const shown = tilde(path), home = shown.startsWith('~/') ? '~/' : '', rest = shown.slice(home.length);
  return home + (/^[\w./~-]+$/.test(rest) ? rest : `'${rest.replaceAll("'", "'\\''")}'`);
};
const fail = (message: string, code: string, ...help: string[]) => new AxiError(message, code, help);
/** TOON data, then next-step hints one per line, the way the other AXIs print them. */
const toon = (data: object, help: string[] = []) => [encode(data), ...(help.length ? [`help[${help.length}]:`, ...help.map((h) => `  ${h}`)] : [])].join('\n');
class EvidenceError extends Error {}

type Flags = Record<string, { type: 'string' | 'boolean'; default?: string; multiple?: boolean }>;
const TIERS: Flags = { full: { type: 'boolean' }, json: { type: 'boolean' } };
const BOARD_FLAGS: Flags = { port: { type: 'string' }, 'evidence-root': { type: 'string' } };
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
    const items = existsSync(file) ? readItems(file).items : [];
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
    items.push(explainer ? { key, type, title, about, detail, options, recommend_value, default_if_silent, close, chapters, media }
      : { key, type, number, title, about, detail, close, link, media });
    // The whole board is checked before it is written, so a bad post leaves the board and evidence/ as they were.
    const check = `${file}.${process.pid}.check`;
    writeFileSync(check, JSON.stringify({ schema: 2, items }), { mode: 0o600 });
    try { loadDecisions(check); } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      throw e instanceof InputError ? new InputError(e.message.replace(basename(check), basename(file))) : e;
    } finally {
      rmSync(check, { force: true });
    }
    writeItems(file, items);
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
    return { incoming: loadDecisions(source), raw: readItems(source).items };
  }
  const scratch = mkdtempSync(join(tmpdir(), 'sign-off-'));
  const source = join(scratch, 'flags');
  try {
    const { title, key = slug(title), about, detail, recommend: recommend_value, default: default_if_silent, close } = values;
    writeFileSync(source, JSON.stringify({ schema: 2, items: [{ key, title, about, detail, options: optionsOf(values), recommend_value, default_if_silent, close, ...extra }] }));
    return { incoming: loadDecisions(source), raw: readItems(source).items };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function storeIncoming(file: string, on: string, { incoming, raw }: { incoming: Decision[]; raw: object[] }) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  return locked(`${file}.lock`, () => {
    const current = board(file), items = existsSync(file) ? readItems(file).items : [];
    const raised = incoming.map((d, i) => {
      const had = current.find((c) => c.key === d.key);
      const same = (x: Decision) => JSON.stringify({ ...x, answer: undefined, options: [...x.options].sort((a, b) => a.value.localeCompare(b.value)) });
      if (had && same(had) !== same(d)) {
        throw fail(`key ${d.key} already holds a different question on ${tilde(file)}`, 'CONFLICT', 'Raise it under a new --key');
      }
      if (!had) items.push(raw[i]);
      return { key: d.key, status: !had ? 'raised' : had.answer ? `already answered ${had.answer.answer}` : 'already waiting', title: d.title };
    });
    if (raised.some((r) => r.status === 'raised')) writeItems(file, items);
    const key = raised.length === 1 ? ` --key ${raised[0].key}` : '';
    const open = raised.some((r) => !r.status.startsWith('already answered')) ? [`Run \`sign-off-axi open${on}\` so the user can answer`] : [];
    return toon({ board: tilde(file), raised }, [...open, `Run \`sign-off-axi answers${on}${key}\` to read ${key ? 'the answer' : 'the answers'}`]);
  });
}

async function open(args: string[]) {
  const { file, values, on } = parse('open', args, BOARD_FLAGS);
  const port = boardPort(file, values.port);
  ready(file, on, values['evidence-root']);
  // The lock makes concurrent opens take turns, so a second one finds the first board instead of starting another.
  return locked(`${record(file)}.lock`, () => start(file, port, values, on), 'another open is still starting this board', 600);
}
async function start(file: string, port: number, values: Record<string, any>, on: string) {
  const live = await running(file);
  const already = (url = live?.url) => toon({ board: tilde(file), url, status: 'already open (no-op)' }, [`Run \`sign-off-axi stop${on}\` to close the board`]);
  if (live) return already();
  // A board serving this file without a record (a foreground serve) is adopted, so stop can close it.
  const adopt = (b: any) => b?.file === file && (writeFileSync(record(file), `${b.pid} ${port}\n`, { mode: 0o600 }), true);
  const shown = port ? await serving(port) : undefined;
  if (adopt(shown)) return already(`http://127.0.0.1:${port}/`);
  if (shown?.file) throw fail(`port ${port} already shows another board: ${tilde(shown.file)}`, 'CONFLICT', `Run \`sign-off-axi open${on} --port <free port>\``);
  // Appended, not truncated: a concurrent open's child may be writing the same log, so read only this child's lines.
  const log = `${file.replace(/\.json$/, '')}.board.log`, start = existsSync(log) ? statSync(log).size : 0, out = openSync(log, 'a', 0o600);
  const evidence = values['evidence-root'] ? ['--evidence-root', resolve(values['evidence-root'])] : [];
  const child = spawn(process.execPath, [process.argv[1], 'serve', file, '--port', String(port), ...evidence], { detached: true, stdio: ['ignore', out, out] });
  closeSync(out);
  child.unref();
  let exit: number | null | undefined;
  child.once('exit', (code) => (exit = code));
  for (let waited = 0; waited < 10_000; waited += 50) {
    await new Promise((ok) => setTimeout(ok, 50));
    const text = readFileSync(log).subarray(start).toString(), url = new RegExp(`url: "(\\S+)"\\npid: ${child.pid}\\n`).exec(text)?.[1];
    if (url) {
      writeFileSync(record(file), `${child.pid} ${new URL(url).port}\n`, { mode: 0o600 });
      return toon({ board: tilde(file), url, pid: child.pid, status: 'opened' },
        [`Tell the user to answer at ${url}`, `Run \`sign-off-axi wait${on}\` to block until they answer`, `Run \`sign-off-axi stop${on}\` to close the board`]);
    }
    if (exit === undefined) continue;
    if (port && adopt(await serving(port))) return already(`http://127.0.0.1:${port}/`);
    throw fail([...text.matchAll(/^error: "?(.*?)"?$/gm)].pop()?.[1] ?? `the board stopped with exit ${exit}`, 'SERVE_FAILED', `Read ${tilde(log)}`);
  }
  throw fail('the board did not start within 10 seconds', 'SERVE_FAILED', `Read ${tilde(log)}`);
}

/** open records `<pid> <port>` next to the board, so status and stop never guess a pid. */
const record = (file: string) => `${file.replace(/\.json$/, '')}.board.pid`;
/** What the board on this port serves; a busy server is an error, never mistaken for no server. */
const serving = (port: number) => fetch(`http://127.0.0.1:${port}/api/board`, { signal: AbortSignal.timeout(1000) }).then((r) => r.json()).then((b) => (b && typeof b.file !== 'string' ? { ...b, file: undefined } : b)).catch((e) => {
  if (e.name === 'TimeoutError') throw fail(`the board on port ${port} did not answer within 1 second`, 'BUSY', 'Run the command again in a moment');
});
const alive = (pid: number) => { try { return process.kill(pid, 0); } catch (e: any) { return e.code === 'EPERM'; } };
/** The board open started for this file, only while that pid really serves this file on that port. */
async function running(file: string) {
  const [pid, port] = (existsSync(record(file)) ? readFileSync(record(file), 'utf8') : '').trim().split(' ').map(Number);
  const b = port ? await serving(port) : undefined;
  return b?.file === file && b?.pid === pid ? { pid, url: `http://127.0.0.1:${port}/` } : undefined;
}

async function status(args: string[]) {
  const { file, values, on } = parse('status', args, { json: { type: 'boolean' } });
  const live = await running(file);
  if (values.json) return JSON.stringify({ board: file, status: live ? 'running' : 'not running', ...live });
  if (!live) return toon({ board: tilde(file), status: 'not running' }, [`Run \`sign-off-axi open${on}\` to start it`]);
  return toon({ board: tilde(file), status: 'running', ...live }, [`Tell the user to answer at ${live.url}`, `Run \`sign-off-axi stop${on}\` to close the board`]);
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

const GITIGNORE = 'mocks/\nevidence/\n*.answers.jsonl\n*.rounds.jsonl\n*.board.pid\n*.board.log\n';
/** The board and port in <so>/config.yaml (the `key: value` lines init writes). A bad line falls back on its own default
 * (decisions.json, 4410) and `problems` says what is wrong; a file that cannot be read throws. */
function readSetup(so: string) {
  const config: Record<string, string> = {}, problems: string[] = [];
  readFileSync(join(so, 'config.yaml'), 'utf8').split(/\r?\n/).forEach((l, n) => {
    const line = l.split('#')[0].trim(), kv = line.match(/^([A-Za-z]+)\s*:\s*(\S+)$/), key = line.match(/^(board|port)(\s|:|$)/i);
    if (kv && ['board', 'port'].includes(kv[1].toLowerCase())) config[kv[1].toLowerCase()] = kv[2];
    else if (key) problems.push(`line ${n + 1} is not one "key: value"`);
  });
  const port = config.port ?? '4410', goodBoard = /^[\w.-]+\.json$/.test(config.board ?? ''), goodPort = /^\d{1,5}$/.test(port) && Number(port) <= 65535;
  if (!goodBoard) problems.push('needs a "board: <name>.json" line');
  if (!goodPort) problems.push(`port ${port} is not a number from 0 to 65535`);
  return { board: join(so, goodBoard ? config.board : 'decisions.json'), port: goodPort ? Number(port) : 4410, goodBoard, problems };
}
/** --port, else the port in a config.yaml beside the board (init writes one), else 4410. */
function boardPort(file: string, given?: string) {
  if (given === undefined) try { given = String(readSetup(dirname(file)).port); } catch { given = '4410'; }
  return portOf(given);
}

function init(args: string[]) {
  const dir = repoDir('init', args), so = join(dir, '.sign-off');
  // A re-run repairs a cut-short init, including a missing board under the name the config gives.
  let board = join(so, 'decisions.json');
  try { board = readSetup(so).board; } catch {}
  const files: [string, string][] = [
    [join(so, 'config.yaml'), `# sign-off repo setup. board: path under .sign-off/, port: dashboard port.\nboard: decisions.json\nport: 4410\n`],
    [board, `{"schema": 2, "items": []}\n`],
    [join(so, '.gitignore'), GITIGNORE],
  ];
  mkdirSync(join(so, 'mocks'), { recursive: true });
  mkdirSync(join(so, 'evidence'), { recursive: true });
  const created: string[] = [], kept: string[] = [];
  for (const [path, content] of files) (createOnce(path, content) ? created : kept).push(path.slice(dir.length + 1));
  return toon({ dir: tilde(dir), created: created.length ? created : 'nothing new (re-run is a no-op)', kept, board: tilde(board) },
    [`Run \`sign-off-axi post ${shellPath(board)} --type design --title "<question>" --option a=A --option b=B\` to ask for a pick`,
      `Run \`sign-off-axi doctor ${shellPath(dir)}\` to check the setup`, `Run \`sign-off-axi open ${shellPath(board)}\` to show the board to the user`]);
}

async function doctor(args: string[]) {
  const dir = repoDir('doctor', args), so = join(dir, '.sign-off'), rerun = `sign-off-axi init ${shellPath(dir)}`;
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
  const unreadable = (path: string, code: string, then: string) => ['EACCES', 'EPERM'].includes(code) ? `Run \`chmod -R u+rwX ${shellPath(dirname(path))}\`` : `Move ${shellPath(path)} away, then ${then}`;
  /** Why a setup file cannot be used and its fix, or nothing when it is a readable file with content. */
  const writable = (path: string) => { try { accessSync(path, constants.W_OK); return true; } catch { return false; } };
  const unusable = (path: string): [string, string] | undefined => {
    const stat = look(path);
    if (stat === 'denied') return [`${basename(path)} cannot be read (permission denied)`, unreadable(path, 'EACCES', `run \`${rerun}\``)];
    if (stat === 'link') return [`${basename(path)} is a broken link`, `Delete the link ${shellPath(path)}, then run \`${rerun}\``];
    if (!stat) return [`${basename(path)} is missing`, `Run \`${rerun}\``];
    if (!stat.isFile()) return [`${basename(path)} is not a file`, `Move ${shellPath(path)} away, then run \`${rerun}\``];
    if (!stat.size) return [`${basename(path)} is empty (init was cut short)`, `Delete ${shellPath(path)}, then run \`${rerun}\``];
    try { closeSync(openSync(path, 'r')); } catch (e: any) { return [`${basename(path)} cannot be read (${e.code})`, unreadable(path, e.code, `run \`${rerun}\``)]; }
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
        else check('config', `${basename(config)}: ${setup.problems.join('; ')}`, `Edit ${shellPath(config)} to hold "board: <name>.json" and "port: <0-65535>" lines, such as board: decisions.json and port: 4410${setup.goodBoard ? '' : `, or delete it and run \`${rerun}\``}`);
      }
      const boardBad = unusable(board);
      if (boardBad) check('board', ...boardBad);
      else {
        try {
          const n = loadDecisions(board).length, old = readItems(board).schema === 1;
          check('board', `${n} items${old ? ' (0.1.0 schema 1: read as decisions; the next raise or post upgrades it and keeps a .schema-1.bak copy)' : ''}`);
        } catch (e: any) {
          check('board', e.message, `Edit ${shellPath(board)} to fix that; the format is at ${FORMAT}`);
        }
      }
      for (const [name, path, fields] of [['answers', answersPath(board), ['key', 'answer']], ['rounds', roundsPath(board), ['key', 'note', 'at']]] as const) {
        let text: string;
        try { text = readFileSync(path, 'utf8'); } catch (e: any) {
          check(name, e.code === 'ENOENT' ? 'none yet' : `${basename(path)} cannot be read (${e.code})`, e.code === 'ENOENT' ? undefined : unreadable(path, e.code, 'the next save writes a new one'));
          continue;
        }
        const torn = text.split('\n').flatMap((line, n) => {
          try { return !line || fields.every((f) => typeof JSON.parse(line)?.[f] === 'string') ? [] : [n + 1]; } catch { return [n + 1]; }
        });
        check(name, torn.length ? `line${torn.length > 1 ? 's' : ''} ${torn.join(', ')} of ${basename(path)} ${torn.length > 1 ? 'do' : 'does'} not parse` : `${text.split('\n').filter(Boolean).length} lines read`,
          torn.length ? `Delete line${torn.length > 1 ? 's' : ''} ${torn.join(', ')} from ${shellPath(path)} (a cut-short write); the other lines are kept` : undefined);
      }
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
      const unwritable = [so, answersPath(board), roundsPath(board), join(so, 'evidence')].filter((p) => existsSync(p) && !writable(p));
      check('write', unwritable.length ? `${unwritable.map((p) => basename(p)).join(' and ')} cannot be written` : 'setup can be written',
        unwritable.length ? `Run \`chmod u+w ${unwritable.map((p) => shellPath(p)).join(' ')}\`` : undefined);
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
    const shown = error && await serving(port).catch(() => undefined), other = shown?.file && shown.file !== (existsSync(board) ? realpathSync(board) : board);
    if (!error) check('port', `${port} is free`);
    else if (error.code === 'EACCES') check('port', `${port} needs privileges to bind (EACCES)`, `Set "port:" in ${shellPath(join(so, 'config.yaml'))} to a port above 1023 (open and serve use it)`);
    else if (shown?.file && !other) check('port', `${port} shows this board (already open)`);
    else check('port', other ? `${port} shows another board, ${shellPath(shown.file)}` : `${port} is in use (${error.code})`,
      `Set "port:" in ${shellPath(join(so, 'config.yaml'))} to a free port (open and serve use it), or ${other ? `close that board: \`sign-off-axi stop ${shellPath(shown.file)}\`, or Ctrl-C its serve` : `stop the program using port ${port}`}`);
  }
  const bad = checks.filter((c) => c.fix);
  if (bad.length) throw fail(`${bad.length} of ${checks.length} checks need a fix in ${tilde(dir)}`, 'NOT_FOUND',...bad.map((c) => `${c.name}: ${c.ok}. ${c.fix}`));
  return toon({ dir: tilde(dir), checks: checks.map(({ name, ok }) => ({ name, ok })) },
    [`Run \`sign-off-axi open ${shellPath(board)}\` to show the board to the user`]);
}

let file = '', evidenceRoot = '';
async function serve(args: string[]) {
  const parsed = parse('serve', args, BOARD_FLAGS), port = boardPort(parsed.file, parsed.values.port);
  ready(parsed.file, parsed.on, parsed.values['evidence-root']);
  [file, evidenceRoot] = [parsed.file, parsed.values['evidence-root'] ? resolve(parsed.values['evidence-root']) : ''];
  await new Promise<void>((ok, no) => server.once('error', no).listen(port, '127.0.0.1', ok)).catch((e) => {
    throw fail(e.code === 'EADDRINUSE' ? `port ${port} is in use; pass --port` : e.message, 'SERVE_FAILED');
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  return toon({ board: tilde(file), url, pid: process.pid }, [`Tell the user to answer at ${url}`, `Run \`sign-off-axi answers${parsed.on}\` to read their answers`]);
}


const page = readFileSync(new URL('../web/index.html', import.meta.url));
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const state = () => ({
  file,
  decisions: loadDecisions(file).map((d) => ({ ...d, evidenceCard: d.evidence ? evidenceCard(d.evidence) : null })),
  answers: readAnswers(file, warn),
  rounds: readRounds(file, warn),
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
  if (req.method !== 'POST' || (req.url !== '/api/answers' && req.url !== '/api/rounds')) return [404, { error: 'Not found' }];
  if (!req.headers['content-type']?.startsWith('application/json')) return [415, { error: 'Send JSON' }];
  let body = '';
  for await (const chunk of req) body += chunk;
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
  // Only loopback names: blocks DNS rebinding from a web page.
  if (req.headers.host !== `127.0.0.1:${bound}` && req.headers.host !== `localhost:${bound}`) return res.writeHead(403).end('Forbidden host');
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
  commands: { list: axi('list', list), raise: axi('raise', (args) => post(args, 'raise')), post: axi('post', post), answers: axi('answers', answers), wait: axi('wait', wait), open: axi('open', open), status: axi('status', status), stop: axi('stop', stop), serve: axi('serve', serve), init: axi('init', init), doctor: axi('doctor', doctor), help: ([name, ...rest]) => {
    if (rest.length || (name && !HELP[name])) throw fail(`unknown command or argument: ${[name, ...rest].join(' ')}`, 'VALIDATION_ERROR', 'Run `sign-off-axi --help` to see the commands');
    return name ? HELP[name] : TOP_HELP;
  } },
});
