import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-notify-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
const TOKEN = { SIGN_OFF_TEST_TOKEN: 'private-token' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (ok) => { for (let i = 0; i < 100 && !ok(); i++) await sleep(100); };

const cli = (dir, args, env = {}) => new Promise((resolve, reject) => {
  const child = spawn('node', [join(root, 'dist/cli.js'), ...args], { cwd: dir, env: { ...process.env, ...env } });
  let stdout = '', stderr = '';
  child.stdout.on('data', (b) => stdout += b); child.stderr.on('data', (b) => stderr += b);
  child.on('error', reject);
  child.on('close', (code) => code ? reject(new Error(stderr || stdout)) : resolve(stdout));
});
const board = (dir) => join(dir, '.sign-off', 'board.json');
const raise = (dir, env) => cli(dir, ['post', board(dir), '--title', 'Review this?', '--why', 'Umer: one line.', '--outcome', 'yes=Go', '--outcome', 'no=Stop', '--recommend', 'yes', '--recommend-reason', 'Safe.', '--default', 'no'], env);
const setup = (dir, notify = '') => {
  mkdirSync(join(dir, '.sign-off'), { recursive: true });
  writeFileSync(board(dir), '{"schema":2,"items":[]}');
  writeFileSync(join(dir, '.sign-off', 'config.yaml'), `board: board.json\n${notify}`);
};
const notifyBlock = (url) => `notify:\n  url: ${url}\n  token_env: SIGN_OFF_TEST_TOKEN\n  link_base: https://board.example/board\n`;
const listen = async (status = () => 204) => {
  const hits = [];
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (b) => data += b);
    req.on('end', () => {
      hits.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(data) });
      res.statusCode = status(hits.length);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, hits, url: `http://127.0.0.1:${server.address().port}/notify` };
};

test('notification sender posts once per new waiting card and retries failures without secrets in CLI output', { timeout: 15_000 }, async (t) => {
  const quiet = join(scratch, 'quiet'); mkdirSync(quiet); setup(quiet);
  await raise(quiet);

  const dir = join(scratch, 'enabled'); mkdirSync(dir);
  const { server, hits, url } = await listen((n) => (n === 1 ? 503 : 204));
  t.after(() => server.close());
  setup(dir, notifyBlock(`${url}?private-query=1,2`));
  const output = await raise(dir, TOKEN);
  assert.match(output, /raised/);
  await until(() => hits.length === 2);
  assert.equal(hits.length, 2, 'the failed attempt is retried');
  assert.deepEqual(hits[0].body, { v: 1, source: 'sign-off', id: 'review-this', kind: 'ask', title: 'Review this?', text: 'Umer: one line.', url: 'https://board.example/board#waiting/review-this', at: hits[0].body.at });
  assert.equal(hits[0].path, '/notify?private-query=1,2');
  assert.equal(hits[0].auth, 'Bearer private-token');
  await raise(dir, TOKEN);
  await sleep(200);
  assert.equal(hits.length, 2, 'an already-present card does not send again');
  assert.ok(!output.includes('private-token') && !output.includes('private-query'));
});

test('an evidence post with notify configured stores the card and sends it once', { timeout: 15_000 }, async (t) => {
  const dir = join(scratch, 'evidence'); mkdirSync(dir);
  const { server, hits, url } = await listen();
  t.after(() => server.close());
  setup(dir, notifyBlock(url));
  const shot = join(scratch, 'shot.png'); writeFileSync(shot, png);
  await cli(dir, ['post', board(dir), '--type', 'evidence', '--title', 'Sign-in screen', '--about', 'The screen loads.', '--media', shot], TOKEN);
  await until(() => hits.length === 1);
  await sleep(200);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].body.kind, 'evidence');
  assert.equal(hits[0].body.title, 'Sign-in screen');
  assert.equal(JSON.parse(await cli(dir, ['list', board(dir), '--json'])).decisions.length, 1);
});

test('a sign-in that gets a new link enters Waiting on you again and is announced again', { timeout: 15_000 }, async (t) => {
  const dir = join(scratch, 'signin'); mkdirSync(dir);
  const { server, hits, url } = await listen();
  t.after(() => server.close());
  setup(dir, notifyBlock(url));
  const signin = (link) => cli(dir, ['post', board(dir), '--type', 'signin', '--key', 'npm-login', '--service', 'npm', '--link', link, '--unlocks', 'Publish the release', '--waits', 'Main'], TOKEN);
  await signin('https://example.com/login/1');
  await until(() => hits.length === 1);
  await cli(dir, ['signin', 'done', board(dir), '--key', 'npm-login'], TOKEN);
  await signin('https://example.com/login/2');
  await until(() => hits.length === 2);
  await signin('https://example.com/login/2');
  await sleep(200);
  assert.deepEqual(hits.map((h) => h.body.id), ['npm-login', 'npm-login']);
});

test('a post returns at once when the receiver is down and the sender holds no caller output', { timeout: 15_000 }, async (t) => {
  const dir = join(scratch, 'down'); mkdirSync(dir);
  const { server, url } = await listen();
  await new Promise((resolve) => server.close(resolve));
  setup(dir, notifyBlock(url));
  const started = Date.now();
  await raise(dir, TOKEN);
  assert.ok(Date.now() - started < 5000);
});

test('doctor reports a notify line it cannot use, and nothing is sent', { timeout: 15_000 }, async (t) => {
  const dir = join(scratch, 'flow'); mkdirSync(dir);
  const { server, hits, url } = await listen();
  t.after(() => server.close());
  setup(dir, `notify: { url: ${url}, token_env: SIGN_OFF_TEST_TOKEN, link_base: https://board.example/board }\n`);
  await raise(dir, TOKEN);
  await sleep(200);
  assert.equal(hits.length, 0);
  const report = await cli(dir, ['doctor', dir]).catch((e) => e.message);
  assert.match(report, /line 2 is not one/);
});

test('a symlinked board reads the config beside the name it was given', { timeout: 15_000 }, async (t) => {
  const dir = join(scratch, 'linked'); mkdirSync(join(dir, '.sign-off'), { recursive: true });
  const store = join(scratch, 'linked-store'); mkdirSync(store);
  writeFileSync(join(store, 'board.json'), '{"schema":2,"items":[]}');
  symlinkSync(join(store, 'board.json'), board(dir));
  const { server, hits, url } = await listen();
  t.after(() => server.close());
  writeFileSync(join(dir, '.sign-off', 'config.yaml'), `board: board.json\n${notifyBlock(url)}`);
  await raise(dir, TOKEN);
  await until(() => hits.length === 1);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].body.id, 'review-this');
});

test('a notify token variable that is unset sends nothing, and doctor says so', { timeout: 15_000 }, async (t) => {
  const dir = join(scratch, 'no-token'); mkdirSync(dir);
  const { server, hits, url } = await listen();
  t.after(() => server.close());
  setup(dir, notifyBlock(url));
  await raise(dir);
  await sleep(200);
  assert.equal(hits.length, 0);
  const report = await cli(dir, ['doctor', dir]).catch((e) => e.message);
  assert.match(report, /SIGN_OFF_TEST_TOKEN is not set/);
});

test('an explainer that waits on the user is announced as an ask', { timeout: 15_000 }, async (t) => {
  const dir = join(scratch, 'explainer'); mkdirSync(dir);
  const { server, hits, url } = await listen();
  t.after(() => server.close());
  setup(dir, notifyBlock(url));
  const video = join(scratch, 'explainer.mp4'); writeFileSync(video, 'not a real video');
  await cli(dir, ['post', board(dir), '--type', 'explainer', '--title', 'Is sign-in clear?', '--about', 'Two steps.', '--media', video, '--option', 'yes=Yes', '--option', 'no=No', '--recommend', 'yes'], TOKEN);
  await until(() => hits.length === 1);
  await sleep(200);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].body.kind, 'ask');
});

test('a notify url on a DNS name starting with 127 is not treated as this machine', async () => {
  const dir = join(scratch, 'spoof'); mkdirSync(dir);
  setup(dir, notifyBlock('http://127.evil.example/notify'));
  const output = await cli(dir, ['doctor', dir]).catch((e) => e.message);
  assert.match(output, /notify needs url/);
});
