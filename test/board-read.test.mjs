import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-read-'));
const file = join(scratch, 'd.json');
const root = join(scratch, 'proof');
const runId = '20261011T120000Z-a1b2c3d4';
const commit = '0123456789abcdef0123456789abcdef01234567';
const png = readFileSync(new URL('../fixtures/evidence/product-small.png', import.meta.url));
const recordPath = join(root, '.done-done', 'runs', `${runId}.json`);
const picture = join(root, 'after.png');
mkdirSync(join(root, '.done-done', 'runs'), { recursive: true });
writeFileSync(picture, png);
writeFileSync(recordPath, JSON.stringify({ schema: 1, run_id: runId, journey: 'sign-off read', command: 'node capture.mjs', commit, tree: 'a'.repeat(40), dirty: false,
  started_at: '2026-10-11T12:00:00Z', ended_at: '2026-10-11T12:01:00Z', exit: 0, files: [{ path: 'after.png', sha256: createHash('sha256').update(png).digest('hex'), bytes: png.length }] }));
copyFileSync(new URL('../fixtures/sample-decisions.json', import.meta.url), file);
const seeded = JSON.parse(readFileSync(file, 'utf8'));
seeded.decisions[0].evidence = { run_id: runId, commit, outcome: 'Umer can see the updated sign-in screen.', repro: 'repro: n/a: no bug', proof: 'done-done: real browser journey', evidence: 'after.png' };
writeFileSync(file, JSON.stringify(seeded));
const procs = [];
after(async () => {
  await Promise.all(procs.map((p) => p.exitCode ?? p.signalCode ?? new Promise((ok) => p.once('exit', ok).kill())));
  rmSync(scratch, { recursive: true, force: true });
});

test('a poll of an unchanged board rebuilds nothing, and a changed board or proof is never hidden by it', async () => {
  const proc = spawn('node', [cli, 'serve', file, '--port', '0', '--evidence-root', root], { cwd: tmpdir() });
  procs.push(proc);
  const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  const first = await fetch(`${url}api/decisions`), etag = first.headers.get('etag'), board = await first.json();
  assert.equal(board.decisions[0].evidenceCard.result, 'RUN PASS');
  assert.ok(etag, 'the board names its bytes so a poll can ask for them again');

  // The read is kept, so a poll of an unchanged board answers without reading the files it was built from: this proof record is unreadable
  // now (its size and change time are untouched, so the board still looks unchanged), and the kept card is still answered as it was checked.
  chmodSync(recordPath, 0o000);
  const poll = await fetch(`${url}api/decisions`, { headers: { 'if-none-match': etag } });
  assert.deepEqual([poll.status, (await poll.arrayBuffer()).byteLength], [304, 0]);
  const again = await fetch(`${url}api/decisions`), body = await again.json();
  assert.deepEqual([again.status, again.headers.get('etag')], [200, etag]);
  assert.equal(body.decisions[0].evidenceCard.result, 'RUN PASS');
  chmodSync(recordPath, 0o600);

  // An answer changes the board, so the next poll is a new read: the answer is in it, and the tag changes with it.
  await fetch(`${url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'short-question', answer: 'yes' }) });
  const answered = await fetch(`${url}api/decisions`), moved = await answered.json();
  assert.notEqual(answered.headers.get('etag'), etag);
  assert.equal(moved.answers['short-question'].answer, 'yes');
  assert.equal(moved.decisions[0].evidenceCard.result, 'RUN PASS');

  // A proof picture replaced on disk is hashed again: the board never says Pass over bytes that changed after the run.
  appendFileSync(picture, 'x');
  const tampered = await fetch(`${url}api/decisions`);
  assert.equal((await tampered.json()).decisions[0].evidenceCard.result, 'UNVERIFIED');
  assert.notEqual(tampered.headers.get('etag'), answered.headers.get('etag'));
});
