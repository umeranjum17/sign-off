import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { asked } from './ask.mjs';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-attach-'));
const so = join(scratch, '.sign-off'), board = join(so, 'decisions.json');
const run = (env, ...args) => {
  try {
    return { out: execFileSync(process.execPath, [cli, ...asked(args)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PATH: '', ...env } }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout}`, code: e.status };
  }
};
const capture = new URL('../fixtures/evidence/product-board.png', import.meta.url).pathname;
const procs = [];
after(async () => {
  await Promise.all(procs.map((p) => p.exitCode ?? p.signalCode ?? new Promise((ok) => p.once('exit', ok).kill())));
  rmSync(scratch, { recursive: true, force: true });
});
const sha = (path) => new Promise((ok) => { const h = createHash('sha256'); createReadStream(path).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))); });

// A sparse 176 MB file stands in for the Android build: generated here, never committed.
const BIG = 176_000_000;
const apk = join(scratch, 'muxr-release.apk');
const attach = (...more) => run({}, 'post', board, '--type', 'evidence', '--title', 'Android build', '--about', 'The app installs.', ...more);

test('attach journey: a large file is copied beside the board, streamed back as a download with range support, and never enters board.json', async () => {
  run({}, 'init', scratch);
  writeFileSync(apk, '');
  truncateSync(apk, BIG);
  const posted = attach('--attach', apk);
  assert.equal(posted.code, 0, posted.out);
  assert.match(posted.out, /update-1,1,0,1,Android build/);
  const stored = JSON.parse(readFileSync(board, 'utf8')).items[0];
  assert.equal(stored.media, undefined);
  assert.deepEqual(stored.attachments, [{ path: 'evidence/1/attach-1.apk', name: 'muxr-release.apk', sha256: await sha(apk), bytes: BIG }]);
  assert.ok(statSync(board).size < 2000, 'the board holds a reference, not the file');
  assert.equal(statSync(join(so, 'evidence', '1', 'attach-1.apk')).size, BIG);
  assert.equal(statSync(join(so, 'evidence', '1', 'attach-1.apk')).mode & 0o777, 0o600);

  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], { cwd: tmpdir() });
  procs.push(proc);
  const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  const card = (await (await fetch(`${url}api/decisions`)).json()).decisions.find((d) => d.key === 'update-1');
  assert.equal(card.attachments[0].bytes, BIG);
  const got = await fetch(`${url}api/attachment?key=update-1&i=0`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.equal(got.headers.get('content-disposition'), 'attachment; filename="muxr-release.apk"');
  assert.equal(got.headers.get('content-length'), String(BIG));
  assert.equal(got.headers.get('accept-ranges'), 'bytes');
  // The download is read chunk by chunk and counted: the whole file arrives, and its size matches.
  let total = 0;
  for await (const chunk of got.body) total += chunk.length;
  assert.equal(total, BIG);
  // A range (a resumed or segmented download) answers 206 with only those bytes.
  const part = await fetch(`${url}api/attachment?key=update-1&i=0`, { headers: { range: `bytes=${BIG - 10}-` } });
  assert.deepEqual([part.status, part.headers.get('content-range'), (await part.arrayBuffer()).byteLength], [206, `bytes ${BIG - 10}-${BIG - 1}/${BIG}`, 10]);
  assert.equal((await fetch(`${url}api/attachment?key=update-1&i=0`, { headers: { range: `bytes=${BIG}-` } })).status, 416);
  assert.equal((await fetch(`${url}api/attachment?key=update-1&i=1`)).status, 404);
  assert.equal((await fetch(`${url}api/attachment?key=nope&i=0`)).status, 404);
  assert.equal((await fetch(`${url}api/attachment?key=update-1`)).status, 404);
  // A file changed after posting is refused.
  truncateSync(join(so, 'evidence', '1', 'attach-1.apk'), 10);
  assert.equal((await fetch(`${url}api/attachment?key=update-1&i=0`)).status, 404);
});

test('attach refusals say why; a file name is made safe and never picks where the copy goes', () => {
  assert.match(attach('--attach', join(scratch, 'gone.apk')).out, /gone\.apk is not there/);
  assert.match(attach('--attach', scratch).out, /is not a file/);
  const small = join(scratch, 'two-mb.bin');
  writeFileSync(small, Buffer.alloc(2 * 1048576));
  const big = run({ SIGN_OFF_ATTACH_MAX_MB: '1' }, 'post', board, '--type', 'evidence', '--title', 'Too big', '--about', 'Note.', '--attach', small);
  assert.equal(big.code, 2);
  assert.match(big.out, /two-mb\.bin is 2 MB, over the 1 MB limit/);
  assert.match(big.out, /SIGN_OFF_ATTACH_MAX_MB=<megabytes>/);
  assert.match(run({ SIGN_OFF_ATTACH_MAX_MB: 'lots' }, 'post', board, '--type', 'evidence', '--title', 'Bad limit', '--about', 'Note.', '--attach', small).out, /SIGN_OFF_ATTACH_MAX_MB=lots must be a number/);
  assert.equal(attach('--attach', small, '--attach', small, '--attach', small, '--attach', small, '--attach', small, '--attach', small).code, 2);
  assert.equal(run({}, 'post', board, '--type', 'explainer', '--title', 'Q', '--media', capture, '--attach', small).code, 2);
  assert.equal(run({}, 'post', board, '--title', 'Q?', '--attach', small).code, 2);
  assert.equal(attach().code, 2);
  const numbers = readdirSync(join(so, 'evidence'));
  assert.deepEqual(numbers, ['1'], 'a refused post leaves no folder behind');
  // A hostile name keeps only safe characters, and the stored file is named by the board, not by the poster.
  const odd = join(scratch, `..a"b;$(x) é.tar.gz`);
  writeFileSync(odd, 'data');
  assert.equal(attach('--attach', odd, '--media', capture).code, 0);
  const item = JSON.parse(readFileSync(board, 'utf8')).items.at(-1);
  assert.equal(item.attachments[0].name, '_a_b__(x) _.tar.gz');
  assert.equal(item.attachments[0].path, 'evidence/2/attach-1.gz');
  assert.deepEqual(readdirSync(join(so, 'evidence', '2')).sort(), ['1-light.jpg', '1-thumb.jpg', '1.png', 'attach-1.gz']);
});

// Beyond loopback the download needs the board's token like every other route; the cookie the link sets carries it.
const mine = Object.values(networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.)/.test(i.address));
test('attach download over the board link needs the token', { skip: !mine && 'this machine has no private IPv4 address' }, async () => {
  const dir = mkdtempSync(join(scratch, 'lan-')), b = join(dir, 'decisions.json'), file = join(dir, 'app.apk');
  writeFileSync(file, 'apk bytes');
  run({}, 'init', dir);
  assert.equal(run({}, 'post', join(dir, '.sign-off', 'decisions.json'), '--type', 'evidence', '--title', 'Build', '--about', 'Note.', '--attach', file).code, 0);
  const opened = run({}, 'open', join(dir, '.sign-off', 'decisions.json'), '--port', '0', '--bind', mine.address);
  const link = /url: "(.+)"/.exec(opened.out)[1], origin = new URL(link).origin;
  try {
    assert.equal((await fetch(`${origin}/api/attachment?key=update-1&i=0`)).status, 401);
    const cookie = (await fetch(link, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
    const got = await fetch(`${origin}/api/attachment?key=update-1&i=0`, { headers: { cookie } });
    assert.equal(got.status, 200);
    assert.equal(await got.text(), 'apk bytes');
  } finally {
    run({}, 'stop', join(dir, '.sign-off', 'decisions.json'));
  }
});
