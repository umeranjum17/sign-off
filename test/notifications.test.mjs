import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-notify-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const png = readFileSync(new URL('../fixtures/evidence/product-small.png', import.meta.url));
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
const raise = (dir, env) => cli(dir, ['post', board(dir), '--title', 'Review this?', '--ask-ref', 'message-test', '--why', 'Umer: one line.', '--outcome', 'yes=Go', '--outcome', 'no=Stop', '--recommend', 'yes', '--recommend-reason', 'Safe.', '--default', 'no'], env);
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
  assert.deepEqual(hits[0].body, { v: 1, source: 'sign-off', id: 'review-this', kind: 'ask', title: 'Review this?', text: 'Umer: one line.', url: 'https://board.example/board#decide/review-this', at: hits[0].body.at });
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
  assert.match(hits[0].body.url, /#evidence\/[^/]+$/);
  assert.equal(hits[0].body.title, 'Sign-in screen');
  assert.equal(JSON.parse(await cli(dir, ['list', board(dir), '--json'])).decisions.length, 1);
});

test('a card is announced once, so a sign-in that gets a new link is not announced again', { timeout: 15_000 }, async (t) => {
  const dir = join(scratch, 'signin'); mkdirSync(dir);
  const { server, hits, url } = await listen();
  t.after(() => server.close());
  setup(dir, notifyBlock(url));
  const signin = (link) => cli(dir, ['post', board(dir), '--type', 'signin', '--key', 'npm-login', '--service', 'npm', '--link', link, '--unlocks', 'Publish the release', '--waits', 'Main'], TOKEN);
  await signin('https://example.com/login/1');
  await until(() => hits.length === 1);
  await cli(dir, ['signin', 'done', board(dir), '--key', 'npm-login'], TOKEN);
  await signin('https://example.com/login/2');
  await sleep(400);
  assert.deepEqual(hits.map((h) => h.body.id), ['npm-login'], 'the card left Waiting and came back: the receiver already knows it');
  assert.equal(JSON.parse(await cli(dir, ['list', board(dir), '--json'])).decisions[0].key, 'npm-login');
});

test('a design review a lead posts sends the user no notice; Main promoting it sends one, once', { timeout: 15_000 }, async (t) => {
  const dir = join(scratch, 'design'); mkdirSync(dir);
  const { server, hits, url } = await listen();
  t.after(() => server.close());
  setup(dir, notifyBlock(url));
  const fixture = join(root, 'fixtures', 'contract', 'design.v1');
  mkdirSync(join(dir, '.sign-off', 'design'));
  for (const f of readdirSync(join(fixture, 'design'))) copyFileSync(join(fixture, 'design', f), join(dir, '.sign-off', 'design', f));
  await cli(dir, ['post', board(dir), '--kind', 'design', '--from', join(fixture, 'valid-basic.json')], TOKEN);
  await sleep(400);
  assert.equal(hits.length, 0, 'a design under review is not the user\'s ask');
  await cli(dir, ['promote', 'chat-journeys', board(dir)], TOKEN);
  await until(() => hits.length === 1);
  assert.equal(hits[0].body.kind, 'design');
  await cli(dir, ['promote', 'chat-journeys', board(dir), '--undo'], TOKEN);
  await cli(dir, ['promote', 'chat-journeys', board(dir)], TOKEN);
  await sleep(400);
  assert.equal(hits.length, 1, 'a card is announced once');
});

test('an undone answer puts the card back in Waiting without another notice', { timeout: 20_000 }, async (t) => {
  const dir = join(scratch, 'undo'); mkdirSync(dir);
  const { server, hits, url } = await listen();
  t.after(() => server.close());
  setup(dir, notifyBlock(url));
  const proc = spawn('node', [join(root, 'dist/cli.js'), 'serve', board(dir), '--port', '0'], { cwd: dir, env: { ...process.env, ...TOKEN } });
  t.after(() => proc.kill());
  const base = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  await raise(dir, TOKEN);
  await until(() => hits.length === 1);
  const answer = (body) => fetch(`${base}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await answer({ key: 'review-this', answer: 'yes' })).status, 200);
  assert.equal((await answer({ key: 'review-this', answer: '' })).status, 200);
  assert.deepEqual(JSON.parse(await cli(dir, ['answers', board(dir), '--json'])), {}, 'the undone card waits again');
  await cli(dir, ['post', board(dir), '--key', 'second', '--title', 'Ship this too?', '--ask-ref', 'message-test', '--why', 'Umer: one line.', '--outcome', 'yes=Go', '--outcome', 'no=Stop', '--recommend', 'yes', '--recommend-reason', 'Safe.', '--default', 'no'], TOKEN);
  await until(() => hits.length === 2);
  await sleep(400);
  assert.deepEqual(hits.map((h) => h.body.id), ['review-this', 'second'], 'the undone card is not announced again');
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

const muxrBlock = (url, base = 'https://board.tail1234.ts.net/') => `notify:\n  receiver: muxr\n  url: ${url}\n  link_base: ${base}\n`;
const muxrHome = (name, token) => {
  const home = join(scratch, name + '-muxr'); mkdirSync(home);
  if (token) writeFileSync(join(home, 'notify-token'), token + '\n');
  return { MUXR_HOME: home };
};

test('muxr receiver: a raised card posts title, body, url and id with the bearer token read from the token file at send time', { timeout: 15_000 }, async (t) => {
  const dir = join(scratch, 'muxr'); mkdirSync(dir);
  const { server, hits, url } = await listen();
  t.after(() => server.close());
  setup(dir, muxrBlock(url));
  const env = muxrHome('muxr', 'file-token-123');
  const long = 'Authentication infrastructure modernization recommendations considered thoroughly yesterday afternoon, regardless?';
  const output = await cli(dir, ['post', board(dir), '--title', long, '--ask-ref', 'message-test', '--why', 'Umer: one line.', '--outcome', 'yes=Go', '--outcome', 'no=Stop', '--recommend', 'yes', '--recommend-reason', 'Safe.', '--default', 'no'], env);
  await until(() => hits.length === 1);
  assert.equal(hits[0].auth, 'Bearer file-token-123');
  assert.deepEqual(Object.keys(hits[0].body).sort(), ['body', 'id', 'title', 'url']);
  assert.equal([...hits[0].body.title].length, 80);
  assert.equal(hits[0].body.body, 'Umer: one line.');
  assert.match(hits[0].body.url, /^https:\/\/board\.tail1234\.ts\.net#decide\//);
  assert.ok(!output.includes('file-token-123'));
});

test('muxr receiver: a missing token file sends nothing and says why in plain words, then works once the file appears', { timeout: 15_000 }, async (t) => {
  const dir = join(scratch, 'muxr-late'); mkdirSync(dir);
  const { server, hits, url } = await listen();
  t.after(() => server.close());
  setup(dir, muxrBlock(url));
  const env = muxrHome('muxr-late');
  await raise(dir, env);
  await sleep(200);
  assert.equal(hits.length, 0);
  const message = await cli(dir, ['notify', 'test', dir], env).catch((e) => e.message);
  assert.match(message, /notify-token is not there yet/);
  assert.doesNotMatch(message, /at .*\.js:\d+|TypeError|ENOENT/);
  assert.match(await cli(dir, ['doctor', dir], env).catch((e) => e.message), /notify-token is not there yet/);
  writeFileSync(join(env.MUXR_HOME, 'notify-token'), 'late-token\n');
  assert.match(await cli(dir, ['notify', 'test', dir], env), /test: sent/);
  assert.equal(hits.at(-1).auth, 'Bearer late-token');
  assert.equal(hits.at(-1).body.title, 'sign-off test');
});

test('notify check: off until the config turns it on, and a link that will not open on the iPad is refused', { timeout: 15_000 }, async () => {
  const dir = join(scratch, 'muxr-check'); mkdirSync(dir);
  setup(dir);
  assert.match(await cli(dir, ['notify', dir]), /notifications: off/);
  setup(dir, muxrBlock('http://127.0.0.1:8793/v1/notify', 'http://127.0.0.1:4410/'));
  assert.match(await cli(dir, ['notify', dir]).catch((e) => e.message), /https:\/\/ or a tailnet address/);
  setup(dir, muxrBlock('http://127.0.0.1:8793/v1/notify', 'http://100.101.102.103:4410/'));
  assert.match(await cli(dir, ['notify', dir]).catch((e) => e.message), /a \.ts\.net name/);
  setup(dir, muxrBlock('http://127.0.0.1:8793/v1/notify', 'http://box.tail1234.ts.net:4410/'));
  const env = muxrHome('muxr-check', 'x');
  const out = await cli(dir, ['notify', dir], env);
  assert.match(out, /notifications: on/);
  assert.match(out, /receiver: muxr/);
  assert.ok(!out.includes('x\n') && !/token: x\b/.test(out));
});

test('notify test fails when muxr accepts the notice but sends it to 0 devices', { timeout: 15_000 }, async (t) => {
  const dir = join(scratch, 'muxr-zero'); mkdirSync(dir);
  let delivered = 0;
  const server = createServer((req, res) => { req.resume(); req.on('end', () => { res.statusCode = 202; res.end(JSON.stringify({ id: 'sign-off-test', delivered_to: delivered })); }); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  setup(dir, muxrBlock(`http://127.0.0.1:${server.address().port}/notify`));
  const env = muxrHome('muxr-zero', 'tok');
  assert.match(await cli(dir, ['notify', 'test', dir], env).catch((e) => e.message), /sent it to 0 devices/);
  delivered = 2;
  assert.match(await cli(dir, ['notify', 'test', dir], env), /delivered_to: 2/);
});

test('notify test says so when the receiver refuses the token or is not running', { timeout: 15_000 }, async (t) => {
  const dir = join(scratch, 'muxr-refused'); mkdirSync(dir);
  const { server, url } = await listen(() => 401);
  setup(dir, muxrBlock(url));
  const env = muxrHome('muxr-refused', 'wrong');
  assert.match(await cli(dir, ['notify', 'test', dir], env).catch((e) => e.message), /refused the token \(HTTP 401\)/);
  await new Promise((resolve) => server.close(resolve));
  assert.match(await cli(dir, ['notify', 'test', dir], env).catch((e) => e.message), /nothing answered at/);
});

test('a reply that lands sends one notice that opens its thread in the inbox; a replayed earlier step sends none', { timeout: 20_000 }, async (t) => {
  const dir = join(scratch, 'reply'); mkdirSync(dir);
  const { server, hits, url } = await listen();
  t.after(() => server.close());
  setup(dir, notifyBlock(url));
  const proc = spawn('node', [join(root, 'dist/cli.js'), 'serve', board(dir), '--port', '0'], { cwd: dir, env: { ...process.env, ...TOKEN } });
  t.after(() => proc.kill());
  const base = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  await raise(dir, TOKEN);
  await until(() => hits.length === 1);
  const answer = (body) => fetch(`${base}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await answer({ key: 'review-this', answer: 'yes' })).status, 200);
  await cli(dir, ['feedback', 'review-this', board(dir), '--read'], TOKEN);
  await cli(dir, ['feedback', 'review-this', board(dir), '--reply', 'Done, it is live.', '--link', 'https://example.com/pr/7'], TOKEN);
  await until(() => hits.length === 2);
  const { body } = hits[1];
  assert.match(body.id, /^review-this:reply:\d{4}-/);
  // The title names the card's filer, which an agent's own session can set, so only its end is fixed here.
  assert.match(body.title, / replied: Review this\?$/);
  assert.deepEqual({ ...body, id: '', title: '', at: '' }, { v: 1, source: 'sign-off', id: '', kind: 'ask', title: '', text: 'Done, it is live.', url: 'https://board.example/board#inbox/review-this', at: '' });
  await cli(dir, ['feedback', 'review-this', board(dir), '--reply', 'An earlier word.', '--at', String(Math.floor(Date.now() / 1000))], TOKEN);
  await sleep(600);
  assert.equal(hits.length, 2, 'a step replayed with --at is history, not news');
});
