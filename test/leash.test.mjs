import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

// The leash in config.yaml says what the board and a raise answer for the person: Ask me first nothing, When it matters the default at its silent_by,
// Act, then tell me the agent's recommended pick at once; a guarded ask always waits. Each path runs the real CLI and board server.
const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-leash-'));
const env = { ...process.env, HOME: join(scratch, 'home') };
delete env.CLAUDE_CODE_SESSION_ID; delete env.SIGN_OFF_FILER;
const procs = [];
after(async () => {
  await Promise.all(procs.map((p) => p.exitCode ?? p.signalCode ?? new Promise((ok) => p.once('exit', ok).kill())));
  rmSync(scratch, { recursive: true, force: true });
});
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env });
// A wait blocks, so it runs beside the board rather than holding the test's event loop.
const waitFor = (...args) => promisify(execFile)(process.execPath, [cli, 'wait', ...args], { encoding: 'utf8', env }).catch((e) => e);
const at = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19) + 'Z';
/** A board folder with config.yaml naming the leash, or none at all (the default, When it matters). */
const folder = (name, leash) => {
  const dir = join(scratch, name);
  mkdirSync(dir);
  if (leash) writeFileSync(join(dir, 'config.yaml'), `board: board.json\nname: Umer\nleash: ${leash}\n`);
  return join(dir, 'board.json');
};
const raise = (board, key, title, ...more) => run('raise', board, '--ask-ref', 'message-test', '--filer', 'agent-1', '--key', key, '--title', title,
  '--why', 'The release goes out Friday and this decides what is in it.', '--option', 'a=A: Today', '--option', 'b=B: Friday',
  '--outcome', 'a=It ships now.', '--outcome', 'b=It ships with the fixes.', '--recommend', 'b', '--recommend-reason', 'Both fixes land by Thursday.', '--default', 'a', ...more);
const serve = async (board) => {
  const proc = spawn(process.execPath, [cli, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  procs.push(proc);
  const out = await new Promise((ok) => { let o = ''; proc.stdout.on('data', (b) => { o += b; if (/pid: \d+/.test(o)) ok(o); }); proc.once('exit', () => ok(o)); });
  return { url: /url: "(\S+)"/.exec(out)[1], stop: () => new Promise((ok) => proc.once('exit', ok).kill()) };
};
const lines = (board) => readFileSync(board.replace(/\.json$/, '.answers.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const answers = (board) => JSON.parse(run('answers', board, '--json').stdout);

test('When it matters: the board takes the default at silent_by, also one that fell due while it was closed, and the waiting agent wakes with it', async () => {
  const board = folder('matters');
  assert.equal(raise(board, 'missed', 'Which day should the release ship?', '--silent-by', at(-60_000)).status, 0);
  assert.equal(raise(board, 'soon', 'Which day should the docs ship?', '--silent-by', at(3_000)).status, 0);
  assert.equal(raise(board, 'no-deadline', 'Which day should the blog post ship?').status, 0);
  // Nothing is taken while the board is closed, and a raise never takes a default.
  assert.deepEqual(answers(board), {});
  const { url, stop } = await serve(board);
  try {
    // The one that fell due while the board was closed is taken as it starts; the agent's wait wakes with it.
    const first = await waitFor(board, '--filer', 'agent-1', '--json', '--timeout', '10');
    assert.equal(first.code ?? 0, 0, first.stdout);
    assert.deepEqual(Object.keys(JSON.parse(first.stdout)), ['missed']);
    assert.equal(JSON.parse(first.stdout).missed.taken, 'default');
    // The next is timed to its own silent_by.
    const second = await waitFor(board, '--filer', 'agent-1', '--timeout', '15');
    assert.match(second.stdout, /soon,a,\S+,default/, second.stdout);
    assert.match(second.stdout, /taken: default is the default the board took/);
    const saved = lines(board).filter((l) => l.taken);
    assert.deepEqual(saved.map(({ key, answer, taken }) => [key, answer, taken]), [['missed', 'a', 'default'], ['soon', 'a', 'default']]);
    assert.match(saved[0].reason, /^No answer by \S+Z: the leash When it matters took the default$/);
    // An ask with no silent_by waits.
    assert.equal(answers(board)['no-deadline'], undefined);
    // The card's trail starts at Taken and reads Delivered once the agent picked it up; the person can still change it.
    const state = await (await fetch(`${url}api/decisions`)).json();
    const trail = state.trail.find((t) => t.key === 'soon');
    assert.equal(trail.taken, 'default');
    assert.ok(trail.delivered && trail.read, JSON.stringify(trail));
    const changed = await fetch(`${url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'soon', answer: 'b' }) });
    assert.equal(changed.status, 200);
    const now = answers(board).soon;
    assert.equal(now.answer, 'b');
    assert.equal(now.taken, undefined);
    assert.equal(now.replaces.taken, 'default');
    // Picking the same answer the board took makes it the person's own.
    await fetch(`${url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'missed', answer: 'a' }) });
    assert.equal(answers(board).missed.taken, undefined);
    assert.equal(answers(board).missed.replaces.taken, 'default');
    const events = await waitFor(board, '--filer', 'agent-1', '--events', '--timeout', '5');
    assert.deepEqual(events.stdout.trim().split('\n').map((l) => JSON.parse(l)).map(({ key, answer, replaces }) => [key, answer, replaces.taken]).sort(), [['missed', 'a', 'default'], ['soon', 'b', 'default']]);
  } finally { await stop(); }
});

test('Ask me first: an ask past its silent_by keeps waiting for the person', async () => {
  const board = folder('ask', 'ask');
  assert.equal(raise(board, 'missed', 'Which day should the release ship?', '--silent-by', at(-60_000)).status, 0);
  const { url, stop } = await serve(board);
  try {
    const state = await (await fetch(`${url}api/decisions`)).json();
    assert.equal(state.leash, 'ask');
    await new Promise((ok) => setTimeout(ok, 1500));
    assert.deepEqual(answers(board), {});
    // Switching to When it matters takes it at once.
    assert.equal((await fetch(`${url}api/leash`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ leash: 'matters' }) })).status, 200);
    assert.equal(answers(board).missed.taken, 'default');
  } finally { await stop(); }
});

test('Act, then tell me: raise takes the agent\'s recommended pick at once, and its wait hands it over as taken by the agent', async () => {
  const board = folder('act', 'act');
  const raised = raise(board, 'release-day', 'Which day should the release ship?');
  assert.equal(raised.status, 0, raised.stdout);
  assert.match(raised.stdout, /release-day,picked b/);
  assert.match(raised.stdout, /go ahead with B: Friday on release-day; the person can still change it/);
  assert.deepEqual(lines(board).map(({ key, answer, taken }) => [key, answer, taken]), [['release-day', 'b', 'agent']]);
  assert.match(lines(board)[0].reason, /^The leash is Act, then tell me: agent-1 took its recommended pick$/);
  const given = await waitFor(board, '--filer', 'agent-1', '--json', '--timeout', '5');
  assert.equal(JSON.parse(given.stdout)['release-day'].taken, 'agent');
});

test('a guarded ask is never answered for the person: --guard, what its words say it does, and kinds that always wait', async () => {
  const board = folder('guard', 'act');
  const guarded = [
    ['flag-money', 'Which day should the release ship?', '--guard', 'money'],
    ['flag-destructive', 'Which day should the docs ship?', '--guard', 'destructive'],
    ['flag-irreversible', 'Which day should the blog post ship?', '--guard', 'irreversible'],
    ['flag-credential', 'Which day should the newsletter ship?', '--guard', 'credential'],
    ['flag-security', 'Which day should the changelog ship?', '--guard', 'security'],
    ['words-money', 'Move the board hosting to the Pro plan?'],
    ['words-destructive', 'Delete the old release branches this week?'],
    ['words-irreversible', 'Publish version one of the package today?'],
    ['words-credential', 'Rotate the npm token before Friday?'],
    ['words-security', 'Give the new agent admin rights on the repo?'],
  ];
  for (const [key, title, ...flags] of guarded) {
    const r = raise(board, key, title, '--silent-by', at(-60_000), ...flags);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, new RegExp(`${key},raised`), `${key} is not picked on Act`);
  }
  assert.equal(run('post', board, '--type', 'design', '--key', 'look', '--title', 'Which look should the settings page use?', '--option', 'a=A', '--option', 'b=B', '--recommend', 'a').status, 0);
  // The board takes no default for any of them either, and says why each waits.
  const { url, stop } = await serve(board);
  try {
    const state = await (await fetch(`${url}api/decisions`)).json();
    await new Promise((ok) => setTimeout(ok, 1500));
    assert.deepEqual(answers(board), {});
    assert.deepEqual(Object.fromEntries(state.decisions.filter((d) => d.guard).map((d) => [d.key, d.guard])), Object.fromEntries(guarded.map(([key]) => [key, key.split('-')[1]])));
  } finally { await stop(); }
  // A guard that is not one of the five is refused, naming them.
  const bad = raise(board, 'odd', 'Which day should the podcast ship?', '--guard', 'risky');
  assert.equal(bad.status, 2, bad.stdout);
  assert.match(bad.stdout, /guard must be destructive or irreversible or money or credential or security/);
});
