import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-design-'));
const repo = join(scratch, 'repo');
const so = join(repo, '.sign-off');
const board = join(so, 'decisions.json');
const run = (...args) => {
  try {
    return { out: execFileSync('node', [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout}`, code: e.status };
  }
};
const post = (url, path, body) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
const procs = [];
after(() => procs.forEach((p) => p.kill()));

test('design journey: init, doctor, post A/B/C, pick in the browser, another round wakes wait', async () => {
  assert.match(run('init', repo).out, /created\[3\]/);
  assert.match(readFileSync(join(so, '.gitignore'), 'utf8'), /mocks\/\nevidence\//);
  writeFileSync(join(so, 'config.yaml'), 'custom: yes\n');
  assert.match(run('init', repo).out, /kept.*config\.yaml/);
  assert.equal(readFileSync(join(so, 'config.yaml'), 'utf8'), 'custom: yes\n');
  writeFileSync(join(so, 'config.yaml'), 'board: decisions.json\nport: 0\n');
  assert.match(run('doctor', repo).out, /board,0 items/);
  assert.equal(run('doctor', join(scratch, 'missing')).code, 1);
  mkdirSync(join(so, 'mocks'), { recursive: true });
  writeFileSync(join(so, 'mocks', 'a.html'), '<h1>Mock A</h1>');
  writeFileSync(join(so, 'mocks', 'b.html'), '<h1>Mock B</h1>');
  writeFileSync(join(so, 'mocks', 'c.png'), png);
  const posted = run('post', board, '--type', 'design', '--title', 'Pick the sign-in layout',
    '--option', 'a=A: single column', '--option', 'b=B: split screen', '--option', 'c=C: card',
    '--mock', 'a=mocks/a.html', '--mock', 'b=mocks/b.html', '--mock', 'c=mocks/c.png',
    '--tradeoff', 'B scans fastest; A is simplest.', '--recommend', 'b');
  assert.match(posted.out, /pick-the-sign-in-layout,raised,/);
  assert.equal(run('post', board, '--type', 'design', '--title', 'Pick the sign-in layout', '--mock', 'a=mocks/a.html').code, 2);
  assert.equal(run('post', board, '--type', 'design', '--title', 'Other?', '--option', 'a=A', '--option', 'b=B', '--mock', 'a=../outside.html').code, 2);
  assert.equal(run('post', board, '--type', 'design', '--title', 'Other?', '--option', 'a=A', '--option', 'b=B', '--mock', 'a=mocks/a.txt').code, 2);
  assert.equal(run('post', board, '--type', 'nope', '--title', 'Other?').code, 2);
  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], { cwd: tmpdir() });
  procs.push(proc);
  const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  const html = await (await fetch(url)).text();
  assert.match(html, /<title>Decisions/);
  assert.match(html, /mockCards/);
  const api = await (await fetch(`${url}api/decisions`)).json();
  assert.equal(api.decisions[0].type, 'design');
  assert.equal(api.decisions[0].title, 'Pick the sign-in layout');
  assert.equal(api.decisions[0].tradeoff, 'B scans fastest; A is simplest.');
  assert.equal(api.decisions[0].mocks.length, 3);
  assert.deepEqual(api.rounds, []);
  assert.equal(await (await fetch(`${url}api/mock?key=pick-the-sign-in-layout&value=a`)).text(), '<h1>Mock A</h1>');
  assert.equal((await fetch(`${url}api/mock?key=pick-the-sign-in-layout&value=z`)).status, 404);
  assert.equal((await post(url, 'api/rounds', { key: 'pick-the-sign-in-layout', note: '' })).status, 400);
  assert.equal((await post(url, 'api/rounds', { key: 'gone', note: 'hi' })).status, 404);
  const waiting = spawn('node', [cli, 'wait', board, '--key', 'pick-the-sign-in-layout', '--timeout', '20']);
  let waited = '';
  waiting.stdout.on('data', (b) => (waited += b));
  const exited = new Promise((ok) => waiting.on('exit', ok));
  await new Promise((ok) => setTimeout(ok, 500));
  assert.equal((await post(url, 'api/rounds', { key: 'pick-the-sign-in-layout', note: 'Umer: show B with A header.' })).status, 200);
  assert.equal(await exited, 0);
  assert.match(waited, /show B with A header/);
  assert.equal((await post(url, 'api/answers', { key: 'pick-the-sign-in-layout', answer: 'b', note: 'Umer: B scans best.' })).status, 200);
  const read = JSON.parse(run('answers', board, '--json').out)['pick-the-sign-in-layout'];
  assert.deepEqual([read.answer, read.note], ['b', 'Umer: B scans best.']);
  assert.deepEqual(read.rounds, [{ note: 'Umer: show B with A header.', at: read.rounds[0].at }]);
  proc.kill();
});

test('doctor journey: each broken precondition prints its own fix, and a repair makes it clean', async () => {
  const dir = join(scratch, 'broken'), sod = join(dir, '.sign-off'), doc = () => run('doctor', dir);
  const failed = (out) => [...out.matchAll(/(?:: |,)"([a-z]+): /g)].map((m) => m[1]);
  // Port 0 skips the port check, so a board open on this host cannot fail the clean runs.
  const config = (port) => writeFileSync(join(sod, 'config.yaml'), `board: decisions.json\nport: ${port}\n`);
  assert.deepEqual([doc().code, failed(doc().out)], [1, ['setup']]);
  run('init', dir);
  config(0);
  assert.equal(doc().code, 0);
  const busy = createServer().listen(0, '127.0.0.1');
  await new Promise((ok) => busy.once('listening', ok));
  const { port } = busy.address();
  config(port);
  writeFileSync(join(sod, 'decisions.answers.jsonl'), '{"key":"a","answer":"yes"}\n{"key":"to\n');
  writeFileSync(join(sod, '.gitignore'), 'mocks/\n');
  rmSync(join(sod, 'evidence'), { recursive: true });
  const broken = doc();
  busy.close();
  assert.equal(broken.code, 1);
  assert.deepEqual(failed(broken.out), ['answers', 'gitignore', 'folders', 'port']);
  assert.match(broken.out, /line 2 of decisions.answers.jsonl does not parse\. Delete line 2 from /);
  assert.match(broken.out, /Add the line evidence\/ to /);
  assert.match(broken.out, new RegExp(`${port} is in use \\(EADDRINUSE\\)\\. Set \\\\"port:\\\\" in .*config.yaml to a free port`));
  writeFileSync(join(sod, 'decisions.answers.jsonl'), '{"key":"a","answer":"yes"}\n');
  writeFileSync(join(sod, '.gitignore'), 'mocks/\nevidence/\n');
  run('init', dir);
  config(0);
  assert.equal(doc().code, 0);
  writeFileSync(join(sod, 'config.yaml'), '');
  assert.match(doc().out, /config: config.yaml is empty \(init was cut short\)\. Delete /);
  rmSync(join(sod, 'config.yaml'));
  run('init', dir);
  config(0);
  writeFileSync(join(sod, 'decisions.json'), '{"schema": 2, "items": [');
  assert.match(doc().out, /board: decisions.json: invalid JSON: .*Edit .*decisions.json to fix that/);
  // A bad port line keeps the board the config names; a file where a folder belongs is moved away first.
  writeFileSync(join(sod, 'config.yaml'), 'board: mine.json\nport: 99999\n');
  rmSync(join(sod, 'evidence'), { recursive: true });
  writeFileSync(join(sod, 'evidence'), 'x');
  assert.deepEqual(failed(doc().out), ['config', 'board', 'folders']);
  assert.match(doc().out, /board: mine.json is missing.*Move .*evidence away, then run/);
  rmSync(join(sod, 'evidence'));
  config(0);
  rmSync(join(sod, 'decisions.json'));
  assert.match(doc().out, /board: decisions.json is missing\. Run `sign-off-axi init /);
  assert.match(run('init', dir).out, /created\[1\]: .sign-off\/decisions.json/);
  assert.equal(doc().code, 0);
});

test('doctor names a fix for a denied setup path and a port that needs privilege', () => {
  if (process.getuid?.() === 0) return;
  const dir = join(scratch, 'denied'), sod = join(dir, '.sign-off');
  run('init', dir);
  writeFileSync(join(sod, 'config.yaml'), 'board: decisions.json\nport: 0\n');
  chmodSync(sod, 0o600);
  try {
    assert.match(run('doctor', dir).out, /config: config\.yaml cannot be read \(permission denied\)\. Run `chmod -R u\+rwX /);
  } finally {
    chmodSync(sod, 0o700);
  }
  writeFileSync(join(sod, 'config.yaml'), 'board: decisions.json\nport: 80\n');
  assert.match(run('doctor', dir).out, /port: 80 needs privileges to bind \(EACCES\)\. Set \\"port:\\" in .*config\.yaml to a port above 1023/);
});

test('doctor prints a fix a shell can run for a path with a space, and fails with NOT_FOUND', () => {
  const dir = join(scratch, 'my repo'), cli2 = cli;
  mkdirSync(dir);
  const broken = run('doctor', dir);
  assert.equal(broken.code, 1);
  assert.match(broken.out, /^code: NOT_FOUND$/m);
  const fix = /Run `sign-off-axi (init [^`]+)`/.exec(broken.out)[1];
  execFileSync('sh', ['-c', `node ${cli2} ${fix}`]);
  writeFileSync(join(dir, '.sign-off', 'config.yaml'), 'board: decisions.json\nport: 0\n');
  assert.equal(run('doctor', dir).code, 0);
});
