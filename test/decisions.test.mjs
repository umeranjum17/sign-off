import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-'));
const file = join(scratch, 'd.json');
const root = join(scratch, 'proof');
const runId = '20261011T120000Z-a1b2c3d4';
const commit = '0123456789abcdef0123456789abcdef01234567';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
mkdirSync(join(root, '.done-done', 'runs'), { recursive: true });
writeFileSync(join(root, 'after.png'), png);
const makeRecord = (path = 'after.png', bytes = png) => ({ schema: 1, run_id: runId, journey: 'sign-off evidence', command: 'node capture.mjs', commit, tree: 'a'.repeat(40), dirty: false,
  started_at: '2026-10-11T12:00:00Z', ended_at: '2026-10-11T12:01:00Z', exit: 0,
  files: [{ path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }] });
const recordPath = join(root, '.done-done', 'runs', `${runId}.json`);
writeFileSync(recordPath, JSON.stringify(makeRecord()));
const originalRecord = readFileSync(recordPath);
copyFileSync(new URL('../fixtures/sample-decisions.json', import.meta.url), file);
const decisions = JSON.parse(readFileSync(file, 'utf8'));
decisions.decisions[0].title = 'Umer: Ship the new sign-in screen this week?';
decisions.decisions[0].evidence = { run_id: runId, commit, outcome: 'Umer can see the updated sign-in screen.', repro: 'repro: n/a: no bug', proof: 'verify-sign-off: real browser journey', evidence: 'after.png' };
writeFileSync(file, JSON.stringify(decisions));
const procs = [];
after(() => procs.forEach((p) => p.kill()));
async function serve() {
  const proc = spawn('node', [cli, 'serve', file, '--port', '0', '--evidence-root', root], { cwd: tmpdir() });
  procs.push(proc);
  return { proc, url: await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0]))) };
}
const post = (url, body) => fetch(`${url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('answer journey: save, survive a torn line and a restart, read back', async () => {
  let { proc, url } = await serve();
  assert.match(await (await fetch(url)).text(), /<title>Decisions/);
  const board = await (await fetch(`${url}api/decisions`)).json();
  assert.equal(board.decisions[0].evidenceCard.result, 'RUN PASS');
  assert.equal(board.decisions[0].evidenceCard.commit, commit);
  assert.equal(board.decisions[0].evidenceCard.media[0].path, 'after.png');
  assert.deepEqual(Buffer.from(await (await fetch(`${url}${board.decisions[0].evidenceCard.media[0].url.slice(1)}`)).arrayBuffer()), png);
  assert.deepEqual(readFileSync(recordPath), originalRecord);
  assert.deepEqual(JSON.parse(execFileSync('node', [cli, 'answers', file, '--json'], { stdio: ['ignore', 'pipe', 'ignore'] })), {});
  const saved = await post(url, { key: 'short-question', answer: 'yes' });
  assert.equal(saved.status, 200);
  const answeredBoard = await saved.json();
  assert.equal(answeredBoard.decisions[0].evidenceCard.result, 'RUN PASS');
  assert.equal(answeredBoard.decisions[0].evidenceCard.media.length, 1);
  assert.equal((await post(url, { key: 'short-question', answer: 'maybe' })).status, 400);
  assert.equal((await post(url, { key: 'gone', answer: 'yes' })).status, 404);
  appendFileSync(file.replace('.json', '.answers.jsonl'), '{"key":"torn');
  assert.equal((await (await post(url, { key: 'use-dark-default', answer: 'no' })).json()).answers['use-dark-default'].answer, 'no');
  assert.equal((await new Promise((ok) => get(url, { headers: { host: 'evil.example' } }, ok))).statusCode, 403);
  proc.kill();
  ({ proc, url } = await serve());
  assert.equal((await (await fetch(`${url}api/decisions`)).json()).answers['short-question'].answer, 'yes');
  const printed = JSON.parse(execFileSync('node', [cli, 'answers', file, '--json'], { stdio: ['ignore', 'pipe', 'ignore'] }));
  assert.deepEqual(Object.keys(printed).sort(), ['short-question', 'use-dark-default']);
  writeFileSync(recordPath, '{malformed');
  assert.equal((await (await fetch(`${url}api/decisions`)).json()).decisions[0].evidenceCard.result, 'UNVERIFIED');
  rmSync(recordPath);
  assert.equal((await (await fetch(`${url}api/decisions`)).json()).decisions[0].evidenceCard.result, 'UNVERIFIED');
  for (const bad of ['null', JSON.stringify({ ...makeRecord(), files: [null] })]) {
    writeFileSync(recordPath, bad);
    const card = (await (await fetch(`${url}api/decisions`)).json()).decisions[0].evidenceCard;
    assert.equal(card.result, 'UNVERIFIED');
    assert.doesNotMatch(card.reason, /Cannot read|TypeError|properties of|\/|\\/);
  }
  const changed = JSON.parse(readFileSync(file, 'utf8'));
  changed.decisions[0].evidence.commit = 'f'.repeat(40);
  writeFileSync(file, JSON.stringify(changed));
  writeFileSync(recordPath, JSON.stringify(makeRecord()));
  assert.equal((await (await fetch(`${url}api/decisions`)).json()).decisions[0].evidenceCard.result, 'UNVERIFIED');
  changed.decisions[0].evidence.commit = commit;
  writeFileSync(file, JSON.stringify(changed));
  const outside = join(scratch, 'private.png');
  writeFileSync(outside, 'private bytes');
  symlinkSync(outside, join(root, 'escape.png'));
  writeFileSync(join(root, '.done-done', 'runs', `${runId}.json`), JSON.stringify(makeRecord('escape.png', Buffer.from('private bytes'))));
  const unverified = await (await fetch(`${url}api/decisions`)).json();
  assert.equal(unverified.decisions[0].evidenceCard.result, 'UNVERIFIED');
  assert.equal((await fetch(`${url}api/evidence?run=${runId}&file=escape.png`)).status, 404);
  assert.deepEqual(JSON.parse(execFileSync('node', [cli, 'answers', file, '--json'], { stdio: ['ignore', 'pipe', 'ignore'] })), printed);
  const checks = JSON.parse(readFileSync(file, 'utf8'));
  checks.decisions[0].evidence.outcome = '   n/a   ';
  writeFileSync(file, JSON.stringify(checks));
  assert.equal((await fetch(`${url}api/decisions`)).status, 200);
  for (const blank of ['', '   ']) {
    checks.decisions[0].evidence.outcome = blank;
    writeFileSync(file, JSON.stringify(checks));
    const response = await fetch(`${url}api/decisions`);
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /evidence/);
  }
});

test('agent journey: raise, open, answer, read back in TOON and JSON', async () => {
  const env = { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'sign-off-home-')) };
  const run = (...args) => {
    try {
      return { out: execFileSync('node', [cli, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }), code: 0 };
    } catch (e) {
      return { out: e.stdout, code: e.status };
    }
  };
  assert.match(run().out, /waiting: 0 of 0 decisions/);
  const raised = run('raise', '--title', 'Keep the weekly digest?', '--recommend', 'yes');
  assert.match(raised.out, /keep-the-weekly-digest,raised,/);
  assert.match(run('raise', '--title', 'Keep the weekly digest?', '--recommend', 'yes').out, /already waiting/);
  assert.deepEqual([run('raise', '--title', 'Keep the weekly digest?').code, run('raise', '--title', 'x', '--recommend', 'maybe').code, run('list', '--stat').code], [1, 2, 2]);
  assert.match(run().out, /waiting\[1\]\{key,title\}:\n  keep-the-weekly-digest,Keep the weekly digest\?/);
  const opened = run('open', '--port', '0');
  const url = /url: "(.+)"/.exec(opened.out)[1], pid = Number(/pid: (\d+)/.exec(opened.out)[1]);
  assert.match(opened.out, /sign-off-axi stop/);
  assert.match(run('status').out, new RegExp(`status: running\npid: ${pid}\n`));
  // wait blocks until the answer is saved, then returns it straight away.
  const waiting = spawn('node', [cli, 'wait', '--key', 'keep-the-weekly-digest', '--timeout', '20'], { env });
  let waited = '';
  waiting.stdout.on('data', (b) => (waited += b));
  const exited = new Promise((ok) => waiting.on('exit', ok));
  await new Promise((ok) => setTimeout(ok, 500));
  assert.equal(waiting.exitCode, null);
  const clicked = Date.now();
  assert.equal((await post(url, { key: 'keep-the-weekly-digest', answer: 'no' })).status, 200);
  assert.equal(await exited, 0);
  assert.ok(Date.now() - clicked < 1500, `wait took ${Date.now() - clicked}ms after the answer`);
  assert.match(waited, /answers\[1\]\{key,answer,at\}:\n  keep-the-weekly-digest,no,/);
  assert.equal(JSON.parse(run('wait', '--key', 'keep-the-weekly-digest', '--json').out)['keep-the-weekly-digest'].answer, 'no');
  assert.match(run('answers').out, /answers\[1\]\{key,answer,at\}:\n  keep-the-weekly-digest,no,/);
  assert.equal(JSON.parse(run('answers', '--key', 'keep-the-weekly-digest', '--json').out)['keep-the-weekly-digest'].answer, 'no');
  assert.match(run('raise', '--title', 'Keep the weekly digest?', '--recommend', 'yes').out, /already answered no/);
  run('raise', '--title', 'Only toString?', '--key', 'toString');
  assert.match(run().out, /waiting\[1\]\{key,title\}:\n  toString,Only toString\?/);
  assert.match(run('help', 'raise').out, /raise \[board.json\] --title/);
  assert.deepEqual([run('help', 'nope').code, run('open', '--port', '0', '--evidence-root', join(env.HOME, 'missing')).code], [2, 2]);
  await Promise.all(Array.from({ length: 20 }, (_, i) => new Promise((ok) => spawn('node', [cli, 'raise', '--title', `Parallel question ${i}?`], { env }).on('exit', ok))));
  assert.match(run().out, /waiting\[21\]/);
  const timedOut = run('wait', '--key', 'toString', '--timeout', '1');
  assert.deepEqual([timedOut.code, /code: TIMEOUT/.test(timedOut.out)], [1, true]);
  assert.match(run('stop').out, new RegExp(`status: stopped\npid: ${pid}\n`));
  assert.match(run('status').out, /status: not running/);
  assert.match(run('stop').out, /not running \(no-op\)/);
  assert.match(run('raise', '--from', 'missing.json').out, new RegExp(`cannot read ${join(process.cwd(), 'missing.json')}: ENOENT`));
});
