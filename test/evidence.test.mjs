import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-evidence-'));
const so = join(scratch, '.sign-off');
const board = join(so, 'decisions.json');
// No PATH: init finds no agent to install the skill for.
const run = (...args) => {
  try {
    return { out: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PATH: '' } }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout}`, code: e.status };
  }
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
const clip = Buffer.from('0123456789 a short recording stand-in');
const procs = [];
after(async () => {
  // A dying serve removes its own run record; removing the scratch folder under it leaves the folder behind.
  await Promise.all(procs.map((p) => p.exitCode ?? p.signalCode ?? new Promise((ok) => p.once('exit', ok).kill())));
  rmSync(scratch, { recursive: true, force: true });
});

test('evidence journey: post numbered updates with media, serve them hash-checked, verdict reads back', async () => {
  run('init', scratch);
  const shot = join(scratch, 'phone.png'), rec = join(scratch, 'flow.webm');
  writeFileSync(shot, png);
  writeFileSync(rec, clip);
  const evidence = (...more) => run('post', board, '--type', 'evidence', ...more);
  assert.equal(evidence('--title', 'No media', '--about', 'Note.').code, 2);
  assert.equal(evidence('--title', 'No note', '--media', shot).code, 2);
  assert.equal(evidence('--title', 'Bad type', '--about', 'Note.', '--media', join(scratch, 'notes.txt')).code, 2);
  assert.match(evidence('--title', 'Missing', '--about', 'Note.', '--media', join(scratch, 'gone.png')).out, /gone\.png is not there/);
  assert.equal(evidence('--title', 'Bad link', '--about', 'Note.', '--media', shot, '--link', 'javascript:alert(1)').code, 2);
  assert.equal(evidence('--title', 'Options', '--about', 'Note.', '--media', shot, '--option', 'a=A', '--option', 'b=B').code, 2);
  assert.deepEqual(readdirSync(join(so, 'evidence')), []);

  assert.match(evidence('--title', 'Sign-in screen', '--about', 'The screen loads.', '--media', shot).out, /update-1,1,1/);
  assert.match(evidence('--title', 'Sign-in flow', '--about', 'Umer signs in on a phone.', '--media', shot, '--media', rec,
    '--link', 'https://github.com/acme/app/pull/12').out, /update-2,2,2/);
  assert.deepEqual(readdirSync(join(so, 'evidence', '2')).sort(), ['1.png', '2.webm']);
  assert.deepEqual(readFileSync(join(so, 'evidence', '2', '2.webm')), clip);
  // Each post records when it was filed.
  for (const item of JSON.parse(readFileSync(board, 'utf8')).items) assert.ok(Date.now() - Date.parse(item.filed) < 60_000, item.key);
  // A second board in the same folder shares evidence/: it takes the next free number and never writes into a used one.
  const other = join(so, 'other.json');
  assert.match(run('post', other, '--type', 'evidence', '--title', 'Other board', '--about', 'Note.', '--media', rec).out, /update-3,3,1/);
  run('raise', other, '--title', 'Manual', '--key', 'update-4');
  assert.match(run('post', other, '--type', 'evidence', '--title', 'After a raised key', '--about', 'Note.', '--media', rec).out, /update-5,5,1/);
  assert.equal(run('post', other, '--type', 'evidence', '--title', 'Bad link', '--about', 'Note.', '--media', rec, '--link', 'nope').code, 2);
  assert.deepEqual(readdirSync(join(so, 'evidence')).sort(), ['1', '2', '3', '5']);
  assert.deepEqual(readFileSync(join(so, 'evidence', '1', '1.png')), png);

  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], { cwd: tmpdir() });
  procs.push(proc);
  const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  assert.match(await (await fetch(url)).text(), /updateMedia/);
  const api = await (await fetch(`${url}api/decisions`)).json();
  assert.deepEqual(api.decisions.map((d) => [d.key, d.number, d.media.length]), [['update-1', 1, 1], ['update-2', 2, 2]]);
  assert.deepEqual(api.decisions[1].options.map((o) => o.value), ['pass', 'fail', 'needs-work']);
  assert.equal(api.decisions[1].link, 'https://github.com/acme/app/pull/12');

  const media = await fetch(`${url}api/media?key=update-2&i=1`);
  assert.equal(media.headers.get('content-type'), 'video/webm');
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), clip);
  const part = await fetch(`${url}api/media?key=update-2&i=1`, { headers: { range: 'bytes=2-5' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 2-5/${clip.length}`);
  assert.equal(await part.text(), '2345');
  assert.equal((await fetch(`${url}api/media?key=update-2&i=9`)).status, 404);
  assert.equal((await fetch(`${url}api/media?key=update-2`)).status, 404);
  // A file changed after posting is refused, never served as the posted proof.
  appendFileSync(join(so, 'evidence', '1', '1.png'), 'x');
  assert.equal((await fetch(`${url}api/media?key=update-1&i=0`)).status, 404);

  const waiting = spawn('node', [cli, 'wait', board, '--key', 'update-2', '--json', '--timeout', '20']);
  let waited = '';
  waiting.stdout.on('data', (b) => (waited += b));
  const exited = new Promise((ok) => waiting.on('exit', ok));
  await new Promise((ok) => setTimeout(ok, 500));
  const verdict = await fetch(`${url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'update-2', answer: 'needs-work', note: 'Umer: the button is cut on a small phone.' }) });
  assert.equal(verdict.status, 200);
  assert.equal(await exited, 0);
  assert.equal(JSON.parse(waited)['update-2'].answer, 'needs-work');
  const read = JSON.parse(run('answers', board, '--json').out)['update-2'];
  assert.deepEqual([read.answer, read.label, read.note], ['needs-work', 'Needs work', 'Umer: the button is cut on a small phone.']);

  // A media path edited to leave the evidence folder makes the board invalid instead of serving it.
  const doc = JSON.parse(readFileSync(board, 'utf8'));
  doc.items[0].media[0].path = 'evidence/1/../../../etc/passwd.png';
  writeFileSync(board, JSON.stringify(doc));
  assert.equal((await fetch(`${url}api/media?key=update-1&i=0`)).status, 422);
  proc.kill();
});
