#!/usr/bin/env node
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { encode } from '@toon-format/toon';
import { AxiError, runAxiCli } from 'axi-sdk-js';
import { type Decision, InputError, appendAnswer, loadDecisions, readAnswers } from './store.js';

const BOARD = join(homedir(), '.sign-off', 'decisions.json');
const FORMAT = 'https://github.com/umeranjum17/sign-off/blob/main/docs/file-formats.md';
const TOP_HELP = `usage: sign-off-axi [command] [board.json] [flags]
commands[6]:
  (none)=list, raise, answers, open, serve, help
board: ~/.sign-off/decisions.json unless a board file is given; answers are saved next to it
flags: --full and --json on list and answers, --help on every command, -v/--version
examples:
  sign-off-axi
  sign-off-axi raise --title "Ship the new sign-in screen this week?" --recommend yes
  sign-off-axi open
  sign-off-axi answers --key ship-the-new-sign-in-screen-this-week
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
  raise: `usage: sign-off-axi raise [board.json] --title "<question>" [--key <key>] [--about <text>] [--detail <text>] [--recommend yes|no] [--default yes|no] [--close done|release]
       sign-off-axi raise [board.json] --from <decisions.json>
Adds yes/no questions to the board. --key defaults to a slug of the title. --default is what happens if the user stays silent; it is shown, never applied.
--from adds every decision in a decisions file: ${FORMAT}
Raising the same question again is a no-op that reports its status; a different question under a used key is refused.
examples:
  sign-off-axi raise --title "Keep the weekly digest?" --about "Open rate held steady." --recommend yes
  sign-off-axi raise --from ./decisions.json
`,
  answers: `usage: sign-off-axi answers [board.json] [--key <key>] [--full] [--json]
Prints the latest saved answer per decision and counts the ones still waiting.
  --key   only that decision
  --full  adds the button label, close and title
  --json  {"<key>":{"answer","label","close","at"}} for the answered decisions
examples:
  sign-off-axi answers --key keep-the-weekly-digest
  sign-off-axi answers ./decisions.json --json
`,
  open: `usage: sign-off-axi open [board.json] [--port 4410] [--evidence-root <dir>]
Starts the board in the background on 127.0.0.1 and prints its URL and pid; a no-op when this board is already open on that port.
--evidence-root is the folder holding .done-done/, for decisions that link run evidence. The server log is written next to the board.
examples:
  sign-off-axi open
  sign-off-axi open ./decisions.json --port 4411
`,
  serve: `usage: sign-off-axi serve [board.json] [--port 4410] [--evidence-root <dir>]
Runs the board in the foreground until Ctrl-C; --port 0 picks a free port. Use open to run it in the background.
examples:
  sign-off-axi serve --port 0
`,
};
const warn = (msg: string) => console.error(`sign-off-axi: ${msg}`);
const tilde = (path: string) => (path.startsWith(homedir() + sep) ? `~${path.slice(homedir().length)}` : path);
const fail = (message: string, code: string, ...help: string[]) => new AxiError(message, code, help);
/** TOON data, then next-step hints one per line, the way the other AXIs print them. */
const toon = (data: object, help: string[] = []) => [encode(data), ...(help.length ? [`help[${help.length}]:`, ...help.map((h) => `  ${h}`)] : [])].join('\n');
class EvidenceError extends Error {}

type Flags = Record<string, { type: 'string' | 'boolean'; default?: string }>;
const TIERS: Flags = { full: { type: 'boolean' }, json: { type: 'boolean' } };
const BOARD_FLAGS: Flags = { port: { type: 'string', default: '4410' }, 'evidence-root': { type: 'string' } };
const RAISE_FIELDS = ['title', 'key', 'about', 'detail', 'recommend', 'default', 'close'];

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
  return { file: given === undefined ? BOARD : resolve(given), values: parsed.values as Record<string, any>, on };
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
function board(file: string) {
  if (!existsSync(file)) return [];
  const decisions = loadDecisions(file), answers = readAnswers(file, warn);
  for (const key of Object.keys(answers)) if (!decisions.some((d) => d.key === key)) warn(`left out the answer for ${key}: that question is no longer in ${basename(file)}`);
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
    `Run \`sign-off-axi raise${on} --title "<question>"\` to ask the user a yes/no question`,
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

function answers(args: string[]) {
  const { file, values, on } = parse('answers', args, { ...TIERS, key: { type: 'string' } });
  const rows = board(file).filter((d) => values.key === undefined || d.key === values.key);
  if (values.key !== undefined && !rows.length) throw fail(`no decision with key ${values.key} on ${tilde(file)}`, 'NOT_FOUND', `Run \`sign-off-axi list${on}\` to see the waiting keys`);
  const done = rows.flatMap((d) => (d.answer ? [{ ...d.answer, title: d.title }] : [])), waiting = rows.length - done.length;
  if (values.json) return JSON.stringify(Object.fromEntries(done.map(({ key, answer, label, close, at }) => [key, { answer, label, close, at }])));
  return toon({
    board: tilde(file),
    answers: done.length ? done.map(({ key, answer, at, label, close, title }) => (values.full ? { key, answer, at, label, close, title } : { key, answer, at })) : '0 saved yet',
    waiting,
  }, waiting ? [`Run \`sign-off-axi open${on}\` so the user can answer the ${waiting} waiting`] : []);
}

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 64).replace(/^-+|-+$/g, '') || 'decision';
/** Runs fn while holding an exclusive lock file, so two agents raising at once never drop a decision. */
function locked<T>(lock: string, fn: () => T): T {
  for (let tries = 0; ; tries++) {
    try { closeSync(openSync(lock, 'wx')); break; } catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
      if (tries === 150) throw fail('another raise is still writing the board', 'BUSY', `If no sign-off-axi is running, delete ${tilde(lock)} and raise again`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try { return fn(); } finally { rmSync(lock, { force: true }); }
}

function raise(args: string[]) {
  const { file, values, on } = parse('raise', args, { from: { type: 'string' }, ...Object.fromEntries(RAISE_FIELDS.map((f) => [f, { type: 'string' as const }])) });
  const given = RAISE_FIELDS.filter((f) => values[f] !== undefined);
  if (values.from !== undefined && given.length) throw fail(`--from cannot be combined with --${given[0]}`, 'VALIDATION_ERROR', 'Put every field in the --from file, or raise with flags only');
  if (values.from === undefined && values.title === undefined) throw fail('--title is required (or --from <decisions.json>)', 'VALIDATION_ERROR', 'sign-off-axi raise --title "<question>" [--recommend yes|no]');
  // Flags are validated by the same loader as a file: write them as a one-decision file first.
  const scratch = values.from === undefined ? mkdtempSync(join(tmpdir(), 'sign-off-')) : '';
  const source = scratch ? join(scratch, 'flags') : resolve(values.from);
  let incoming: Decision[], raw: object[];
  try {
    if (scratch) {
      const { title, key = slug(title), about, detail, recommend: recommend_value, default: default_if_silent, close } = values;
      writeFileSync(source, JSON.stringify({ schema: 1, decisions: [{ key, title, about, detail, recommend_value, default_if_silent, close }] }));
    }
    incoming = loadDecisions(source);
    raw = JSON.parse(readFileSync(source, 'utf8')).decisions;
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
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
  const shows = () => fetch(`http://127.0.0.1:${port}/api/decisions`, { signal: AbortSignal.timeout(1000) }).then((r) => r.json()).then((b) => b.file, () => undefined);
  const already = () => toon({ board: tilde(file), url: `http://127.0.0.1:${port}/`, status: 'already open (no-op)' });
  const shown = port && await shows();
  if (shown === file) return already();
  if (shown) throw fail(`port ${port} already shows another board: ${tilde(shown)}`, 'CONFLICT', `Run \`sign-off-axi open${on} --port <free port>\``);
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
    if (url) return toon({ board: tilde(file), url, pid: child.pid, status: 'opened' }, [`Tell the user to answer at ${url}`, `Run \`sign-off-axi answers${on}\` to read their answers`, `Run \`kill ${child.pid}\` to close the board`]);
    if (exit === undefined) continue;
    if (port && (await shows()) === file) return already();
    throw fail([...text.matchAll(/^error: "?(.*?)"?$/gm)].pop()?.[1] ?? `the board stopped with exit ${exit}`, 'SERVE_FAILED', `Read ${tilde(log)}`);
  }
  throw fail('the board did not start within 10 seconds', 'SERVE_FAILED', `Read ${tilde(log)}`);
}

let file = '', evidenceRoot = '';
async function serve(args: string[]) {
  const parsed = parse('serve', args, BOARD_FLAGS), port = portOf(parsed.values.port);
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
});
const mediaTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm' };
function contained(path: string): string {
  let root: string, actual: string;
  try {
    root = realpathSync(evidenceRoot);
    actual = realpathSync(resolve(root, path));
  } catch { throw new EvidenceError('no matching evidence file'); }
  if (!actual.startsWith(root + sep)) throw new EvidenceError('evidence path escapes the selected root');
  return actual;
}
function evidenceCard(link: NonNullable<Decision['evidence']>) {
  try {
    if (!evidenceRoot) throw new EvidenceError('no evidence root was selected');
    const recordPath = contained(`.done-done/runs/${link.run_id}.json`);
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
  if (req.method === 'GET' && req.url?.startsWith('/api/evidence?')) {
    const q = new URL(req.url, 'http://localhost').searchParams, runId = q.get('run') ?? '', path = q.get('file') ?? '';
    const decision = loadDecisions(file).find((d) => d.evidence?.run_id === runId);
    if (!decision?.evidence || !path) return [404, { error: 'Evidence is unavailable' }];
    const card = evidenceCard(decision.evidence);
    if (card.status !== 'verified' || !card.media.some((m) => m.path === path)) return [404, { error: 'Evidence is unavailable' }];
    const actual = contained(path), type = mediaTypes[extname(path).toLowerCase()];
    return [200, { media: readFileSync(actual), type }];
  }
  if (req.method === 'GET' && req.url === '/api/decisions') {
    return [200, state()];
  }
  if (req.method !== 'POST' || req.url !== '/api/answers') return [404, { error: 'Not found' }];
  if (!req.headers['content-type']?.startsWith('application/json')) return [415, { error: 'Send JSON' }];
  let body = '';
  for await (const chunk of req) body += chunk;
  const { key, answer } = JSON.parse(body) ?? {};
  const d = loadDecisions(file).find((x) => x.key === key);
  if (!d) return [404, { error: 'This question is no longer in the file' }];
  const option = d.options.find((o) => o.value === answer);
  if (!option) return [400, { error: 'The answer must be yes or no' }];
  appendAnswer(file, d, option);
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
    const media = body as { media: Buffer; type: string };
    return res.writeHead(status, { 'content-type': media.type, 'x-content-type-options': 'nosniff' }).end(media.media);
  }
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
});

const argv = process.argv.slice(2);
// Flags with no command belong to the default list view (sign-off-axi --json).
if (argv[0]?.startsWith('-') && !['--help', '-v', '-V', '--version'].includes(argv[0])) argv.unshift('list');
await runAxiCli({
  description: 'Ask the user yes/no questions on one local board and read their answers back',
  version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
  argv,
  topLevelHelp: TOP_HELP,
  getCommandHelp: (cmd) => HELP[cmd],
  home: axi('list', list),
  commands: { list: axi('list', list), raise: axi('raise', raise), answers: axi('answers', answers), open: axi('open', open), serve: axi('serve', serve), help: ([name, ...rest]) => {
    if (rest.length || (name && !HELP[name])) throw fail(`unknown command or argument: ${[name, ...rest].join(' ')}`, 'VALIDATION_ERROR', 'Run `sign-off-axi --help` to see the commands');
    return name ? HELP[name] : TOP_HELP;
  } },
});
