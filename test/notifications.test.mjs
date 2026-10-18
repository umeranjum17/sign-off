import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-notify-'));
const post = (dir, env = {}) => new Promise((resolve, reject) => {
  const child = spawn('node', [join(root, 'dist/cli.js'), 'post', join(dir, '.sign-off', 'board.json'), '--title', 'Review this?', '--why', 'Umer: one line.', '--outcome', 'yes=Go', '--outcome', 'no=Stop', '--recommend', 'yes', '--recommend-reason', 'Safe.', '--default', 'no'], { cwd: dir, env: { ...process.env, ...env } });
  let stdout = '', stderr = '';
  child.stdout.on('data', (b) => stdout += b); child.stderr.on('data', (b) => stderr += b);
  child.on('error', reject); child.on('exit', (code) => code ? reject(new Error(stderr || stdout)) : resolve(stdout));
});
const setup = (dir, notify = '') => {
  mkdirSync(join(dir, '.sign-off'), { recursive: true });
  writeFileSync(join(dir, '.sign-off', 'board.json'), '{"schema":2,"items":[]}');
  writeFileSync(join(dir, '.sign-off', 'config.yaml'), `board: board.json\n${notify}`);
};
const listen = async (handler) => {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/notify` };
};
const receive = (server, n) => {
  const got = [];
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  server.on('request', (req) => { let data = ''; req.on('data', (b) => data += b); req.on('end', () => { got.push({ body: JSON.parse(data), auth: req.headers.authorization }); if (got.length === n) finish(got); }); });
  return done;
};

test('notification sender posts once per new waiting card and retries failures without secrets in CLI output', { timeout: 15_000 }, async (t) => {
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const quiet = join(scratch, 'quiet'); mkdirSync(quiet); setup(quiet);
  await post(quiet);

  const dir = join(scratch, 'enabled'); mkdirSync(dir);
  let attempts = 0;
  const { server, url } = await listen((_req, res) => { attempts++; res.statusCode = attempts === 1 ? 503 : 204; res.end(); });
  t.after(() => server.close());
  setup(dir, `notify: { url: ${url}?private-query, token_env: SIGN_OFF_TEST_TOKEN, link_base: https://board.example/board }\n`);
  process.env.SIGN_OFF_TEST_TOKEN = 'private-token';
  const received = receive(server, 2);
  const outputPromise = post(dir, { SIGN_OFF_TEST_TOKEN: 'private-token' });
  const output = await outputPromise;
  assert.match(output, /raised/);
  const got = await received;
  assert.deepEqual(got[0].body, { v: 1, source: 'sign-off', id: 'review-this', kind: 'ask', title: 'Review this?', text: 'Umer: one line.', url: 'https://board.example/board#waiting/review-this', at: got[0].body.at });
  assert.equal(got[0].auth, 'Bearer private-token');
  assert.equal(attempts, 2);
  await post(dir, { SIGN_OFF_TEST_TOKEN: 'private-token' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(attempts, 2, 'an already-present card does not send again');
  assert.ok(!output.includes('private-token') && !output.includes('private-query'));
  delete process.env.SIGN_OFF_TEST_TOKEN;
});
