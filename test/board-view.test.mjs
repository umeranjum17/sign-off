import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-view-'));
const file = join(scratch, 'd.json');
const root = join(scratch, 'proof');
const runId = '20261011T120000Z-a1b2c3d4';
const commit = '0123456789abcdef0123456789abcdef01234567';
const png = readFileSync(new URL('../fixtures/evidence/product-small.png', import.meta.url));
const recordPath = join(root, '.done-done', 'runs', `${runId}.json`);
const picture = join(root, 'after.png');
mkdirSync(join(root, '.done-done', 'runs'), { recursive: true });
writeFileSync(picture, png);
writeFileSync(recordPath, JSON.stringify({ schema: 1, run_id: runId, journey: 'sign-off view', command: 'node capture.mjs', commit, tree: 'a'.repeat(40), dirty: false,
  started_at: '2026-10-11T12:00:00Z', ended_at: '2026-10-11T12:01:00Z', exit: 0, files: [{ path: 'after.png', sha256: createHash('sha256').update(png).digest('hex'), bytes: png.length }] }));

// A board shaped like a real one: the fixture's cards plus thirty plans that each carry a report's body. Those bodies are what a first screen must
// not send: twenty of them alone weigh more than the whole first-screen budget.
const ASKS = 30;
copyFileSync(new URL('../fixtures/sample-decisions.json', import.meta.url), file);
const board = JSON.parse(readFileSync(file, 'utf8'));
const at = (n) => new Date(Date.UTC(2026, 9, 11, 12, n)).toISOString();
for (let i = 0; i < ASKS; i++) board.decisions.push({ key: `plan-${i}`, title: `Plan ${i} to approve`, type: 'plan', kind: 'plan', view: `plan-${i}.html`, filed: at(i), by: 'agent',
  sections: [{ id: 's1', stage: 'overview', heading: 'Detail', body: 'x'.repeat(9_000), blocks: [] }],
  decisions: [{ key: 'q1', title: 'Which way?', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }] });
board.decisions.find((d) => d.key === 'plan-0').evidence = { run_id: runId, commit, outcome: 'Umer can see the updated sign-in screen.', repro: 'repro: n/a: no bug', proof: 'done-done: real browser journey', evidence: 'after.png' };
writeFileSync(file, JSON.stringify(board));

const procs = [];
after(async () => {
  await Promise.all(procs.map((p) => p.exitCode ?? p.signalCode ?? new Promise((ok) => p.once('exit', ok).kill())));
  rmSync(scratch, { recursive: true, force: true });
});

test('a first screen is one small page of the board, paging covers the rest, one card comes whole, and the whole board is unchanged', async () => {
  const proc = spawn('node', [cli, 'serve', file, '--port', '0', '--evidence-root', root], { cwd: tmpdir() });
  procs.push(proc);
  const url = await new Promise((ok, no) => {
    let said = '';
    proc.stdout.on('data', (b) => { said += b; const hit = /http:\/\/127\.0\.0\.1:\d+\//.exec(said); if (hit) ok(hit[0]); });
    proc.once('exit', (code) => no(new Error(`serve exited ${code}: ${said}`)));
  });
  const get = async (path) => { const res = await fetch(url + path); return { res, body: await res.json().catch(() => undefined) }; };

  // What the board itself says waits on the person, so the test holds whatever the fixture holds.
  const all = await get('api/decisions'), answers = all.body.answers ?? {}, gone = new Set(all.body.dismissed ?? []);
  const waiting = all.body.decisions.filter((d) => d.type !== 'evidence' && !answers[d.key] && !gone.has(d.key));

  // The first screen: the asks waiting on the person, a page at a time, without the report bodies or the proof media they link.
  const first = await get('api/decisions?view=asks&limit=20'), text = JSON.stringify(first.body);
  assert.ok(Buffer.byteLength(text) < 100_000, `the first screen is under 100 KB: ${Buffer.byteLength(text)} bytes`);
  assert.equal(first.body.decisions.length, 20);
  assert.equal(first.body.counts.asks, waiting.length, 'every unanswered ask is counted, not only the page');
  assert.equal(first.body.page.total, waiting.length);
  assert.equal(first.body.more, waiting.length > 20);
  assert.ok(first.body.decisions.every((d) => !('sections' in d)), 'no row carries a report body');
  assert.equal(first.body.decisions[0].key, waiting[0].key, "the board's own order decides what waits on you first");
  const whole = all.body.decisions.filter((d) => first.body.decisions.some((r) => r.key === d.key));
  assert.ok(Buffer.byteLength(text) < Buffer.byteLength(JSON.stringify(whole)) / 3, 'the page is a fraction of what the same items weigh whole');

  // Paging covers every ask once, and the last page says there is no more.
  const keys = first.body.decisions.map((d) => d.key);
  for (let offset = 20; ; offset += 20) {
    const next = await get(`api/decisions?view=asks&limit=20&offset=${offset}`);
    keys.push(...next.body.decisions.map((d) => d.key));
    if (!next.body.more) break;
  }
  assert.deepEqual(keys, waiting.map((d) => d.key), 'paging serves every ask once, in the board order');

  // The rest of the board a page at a time, for Evidence and history: rows without the proof media, counted as a whole.
  const items = await get('api/decisions?view=items&offset=0&limit=50');
  assert.equal(items.body.decisions.length, Math.min(50, all.body.decisions.length));
  assert.equal(items.body.counts.items, all.body.decisions.length);
  assert.equal(items.body.counts.evidence, all.body.decisions.filter((d) => d.type === 'evidence').length);
  assert.equal(items.body.more, all.body.decisions.length > 50);
  assert.ok(items.body.decisions.every((d) => !('evidenceCard' in d)), 'a row is not a card');

  // One card whole: the report body and the proof as checked, for the screen that opens it.
  const card = await get('api/decisions?view=card&key=plan-0');
  assert.equal(card.body.card.sections[0].body.length, 9_000);
  assert.equal(card.body.card.evidenceCard.result, 'RUN PASS');
  assert.equal(card.body.counts.asks, waiting.length);
  assert.equal((await fetch(url + 'api/decisions?view=card&key=nope')).status, 404);
  assert.equal((await fetch(url + 'api/decisions?view=nope')).status, 422);

  // The whole board is unchanged: every item, its report body, its proof card and its ticket roll-up.
  assert.equal(all.body.decisions.length, board.decisions.length);
  assert.equal(all.body.decisions.find((d) => d.key === 'plan-0').sections[0].body.length, 9_000);
  assert.equal(all.body.decisions.find((d) => d.key === 'plan-0').evidenceCard.result, 'RUN PASS');
  assert.ok(Array.isArray(all.body.tickets));

  // A view is kept like the board it came from: a poll of an unchanged board is a 304 with no body, and an answer changes it.
  const etag = first.res.headers.get('etag');
  const poll = await fetch(url + 'api/decisions?view=asks&limit=20', { headers: { 'if-none-match': etag } });
  assert.deepEqual([poll.status, (await poll.arrayBuffer()).byteLength], [304, 0]);
  await fetch(url + 'api/answers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'short-question', answer: 'yes' }) });
  const moved = await get('api/decisions?view=asks&limit=20');
  assert.notEqual(moved.res.headers.get('etag'), etag, 'an answer is a new page');
  assert.equal(moved.body.counts.asks, waiting.length - 1, 'the answered ask leaves the waiting count');
  assert.equal(moved.body.answers['short-question'].answer, 'yes');
});
