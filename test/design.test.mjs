import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, get } from 'node:http';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-design-'));
const repo = join(scratch, 'repo');
const so = join(repo, '.sign-off');
const board = join(so, 'decisions.json');
// A PATH holding only node and the agents a test puts there, and an empty HOME, so no installed agent or skill on this host counts.
const bin = join(scratch, 'bin');
mkdirSync(bin);
mkdirSync(join(scratch, 'home'));
symlinkSync(process.execPath, join(bin, 'node'));
const env = { ...process.env, PATH: bin, HOME: join(scratch, 'home') };
// No filer leaks in from the agent running the tests.
delete env.SIGN_OFF_FILER;
delete env.CLAUDE_CODE_SESSION_ID;
// Hints read as npm ran the tests, never as npx would.
delete env.npm_command;
delete env.npm_config_package;
const run = (...args) => {
  try {
    return { out: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout}`, code: e.status };
  }
};
const post = (url, path, body) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
// A plain PNG of a given size, for a capture of a known shape.
const sized = (w, h) => {
  const chunk = (type, data) => { const n = Buffer.alloc(8), t = Buffer.concat([Buffer.from(type), data]); n.writeUInt32BE(data.length); n.writeUInt32BE(crc32(t), 4); return Buffer.concat([n.subarray(0, 4), t, n.subarray(4)]); };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.alloc((w + 1) * h))), chunk('IEND', Buffer.alloc(0))]);
};
const procs = [];
after(async () => {
  // A dying serve removes its own run record; removing the scratch folder under it leaves the folder behind.
  await Promise.all(procs.map((p) => p.exitCode ?? p.signalCode ?? new Promise((ok) => p.once('exit', ok).kill())));
  rmSync(scratch, { recursive: true, force: true });
});

test('design journey: init, doctor, post A/B/C, pick in the browser, another round wakes wait', async () => {
  assert.match(run('init', repo).out, /created\[3\]/);
  assert.match(readFileSync(join(so, '.gitignore'), 'utf8'), /mocks\/\nevidence\//);
  writeFileSync(join(so, 'config.yaml'), 'custom: yes\n');
  assert.match(run('init', repo).out, /kept.*config\.yaml/);
  assert.equal(readFileSync(join(so, 'config.yaml'), 'utf8'), 'custom: yes\n');
  writeFileSync(join(so, 'config.yaml'), 'board: decisions.json\nport: 0\n');
  assert.match(run('doctor', repo).out, /board,0 items/);
  assert.equal(run('doctor', join(scratch, 'missing')).code, 1);
  // Agents: auto finds an agent only by its command on PATH; doctor names the install command for a missing skill.
  assert.match(run('doctor', repo).out, /auto: no agent found on PATH/);
  assert.equal(run('init', repo, '--agent', 'nope').code, 2);
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\n');
  chmodSync(join(bin, 'codex'), 0o755);
  const missing = run('doctor', repo);
  assert.equal(missing.code, 1);
  assert.match(missing.out, /codex skill: not installed\. Run `npx -y skills add umeranjum17\/sign-off --skill sign-off-axi -y -a codex`/);
  mkdirSync(join(repo, '.agents', 'skills', 'sign-off-axi'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'skills', 'sign-off-axi', 'SKILL.md'), '---\nname: sign-off-axi\n---\n');
  assert.match(run('doctor', repo).out, /codex skill,installed/);
  assert.match(run('init', repo).out, /codex,already installed/);
  // A config from before agent: existed: --agent is recorded there, so doctor checks the chosen agent, not PATH.
  writeFileSync(join(so, 'config.yaml'), 'board: decisions.json\nport: 0\n');
  assert.match(run('init', repo, '--agent', 'codex').out, /codex,already installed/);
  assert.equal(readFileSync(join(so, 'config.yaml'), 'utf8'), 'board: decisions.json\nport: 0\nagent: codex\n');
  writeFileSync(join(so, 'config.yaml'), 'board: decisions.json\nagent: codex, claude-code\nport: 0\n');
  assert.match(run('doctor', repo).out, /claude-code skill: not installed\. Run `npx -y skills add .* -a claude-code`/);
  // A blank agent: line is auto; it never reads the next line as the value.
  writeFileSync(join(so, 'config.yaml'), 'board: decisions.json\nagent:\nport: 0\n');
  assert.match(run('doctor', repo).out, /codex skill,installed/);
  rmSync(join(bin, 'codex'));
  writeFileSync(join(so, 'config.yaml'), 'board: decisions.json\nport: 0\n');
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
  // A type with no renderer yet still loads, and lands on the page as a plain card.
  writeFileSync(join(scratch, 'report.json'), JSON.stringify({ schema: 1, decisions: [{ key: 'weekly-report', type: 'memo', title: 'Approve the weekly report?' }] }));
  assert.match(run('raise', board, '--from', join(scratch, 'report.json')).out, /weekly-report,raised,/);
  writeFileSync(join(scratch, 'bad-type.json'), JSON.stringify({ schema: 1, decisions: [{ key: 'x', type: 'Not A Type', title: 'X?' }] }));
  assert.equal(run('raise', board, '--from', join(scratch, 'bad-type.json')).code, 2);
  // raise is the alias for post --type decision: the same question posted either way is one item.
  assert.match(run('post', board, '--type', 'decision', '--title', 'Keep the digest?', '--recommend', 'yes').out, /keep-the-digest,raised,/);
  assert.match(run('raise', board, '--title', 'Keep the digest?', '--recommend', 'yes').out, /keep-the-digest,already waiting,/);
  assert.equal(run('raise', board, '--title', 'Other?', '--type', 'design').code, 2);
  // One page holds every variant and reads ?variant= to show one.
  mkdirSync(join(so, 'mocks', 'nav'));
  writeFileSync(join(so, 'mocks', 'nav', 'index.html'), '<p>variant page</p>');
  const nav = ['--type', 'design', '--key', 'nav', '--title', 'Pick the nav', '--option', 'a=A: tabs', '--option', 'b=B: drawer', '--option', 'c=C: rail'];
  assert.equal(run('post', board, ...nav, '--mock', 'c=mocks/c.png?variant=c').code, 2);
  assert.equal(run('post', board, ...nav, '--mock', 'a=mocks/nav/index.html?other=a').code, 2);
  assert.match(run('post', board, ...nav, ...['a', 'b', 'c'].flatMap((v) => ['--mock', `${v}=mocks/nav/index.html?variant=${v}`]), '--tradeoff', 'A is flat; B hides; C is dense.', '--recommend', 'a').out, /nav,raised,/);
  // Ladder rungs: a diagram image and an interactive page, each a decision shown with a picture.
  mkdirSync(join(so, 'mocks', 'flow'));
  writeFileSync(join(so, 'mocks', 'flow', 'flow.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  writeFileSync(join(so, 'mocks', 'flow', 'demo.html'), '<script>fetch("https://example.com")</script>');
  assert.match(run('post', board, '--type', 'diagram', '--key', 'flow', '--title', 'Is this the sign-in flow?', '--view', 'mocks/flow/flow.svg').out, /flow,raised,/);
  assert.match(run('post', board, '--type', 'interactive', '--key', 'demo', '--title', 'Does the flow feel right?', '--view', 'mocks/flow/demo.html',
    '--option', 'yes=Yes', '--option', 'needs-work=Needs work', '--recommend', 'yes').out, /demo,raised,/);
  for (const bad of [['--type', 'diagram'], ['--type', 'diagram', '--view', 'mocks/flow/demo.html'], ['--type', 'interactive', '--view', 'mocks/flow/flow.svg'],
    ['--type', 'diagram', '--view', '../outside.svg'], ['--type', 'decision', '--view', 'mocks/flow/flow.svg'], ['--type', 'diagram', '--view', 'mocks/flow/flow.svg', '--mock', 'a=mocks/a.html']]) {
    assert.equal(run('post', board, '--title', 'Other?', ...bad).code, 2, bad.join(' '));
  }
  assert.equal(run('post', board, '--type', 'diagram', '--title', 'Other?', '--view', 'mocks/flow/missing.svg').code, 1);
  // A symlink out of the board folder is refused at post time, the same way the board refuses to serve it.
  writeFileSync(join(scratch, 'outside.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  symlinkSync(join(scratch, 'outside.svg'), join(so, 'mocks', 'flow', 'link.svg'));
  assert.equal(run('post', board, '--type', 'diagram', '--title', 'Other?', '--view', 'mocks/flow/link.svg').code, 2);
  // The explainer rung: one narrated video the agent made, copied into the store and hash-checked like evidence media.
  const video = join(scratch, 'explainer.mp4'), clip = Buffer.from('0123456789 a narrated video stand-in');
  writeFileSync(video, clip);
  const explainer = ['--type', 'explainer', '--key', 'tour', '--title', 'Is the new sign-in clear?'];
  for (const bad of [[], ['--media', video, '--media', video], ['--media', join(scratch, 'outside.svg')], ['--media', video, '--chapter', '12=Start'],
    ['--media', video, '--chapter', '0:12=B', '--chapter', '0:05=A'], ['--media', video, '--link', 'https://example.com'], ['--media', video, '--view', 'mocks/flow/flow.svg'], ['--media', video, '--option', 'bad']]) {
    assert.equal(run('post', board, ...explainer, ...bad).code, 2, bad.join(' '));
    assert.deepEqual(readdirSync(join(so, 'evidence')), [], bad.join(' '));
  }
  assert.equal(run('post', board, '--type', 'decision', '--title', 'Other?', '--chapter', '0:00=A').code, 2);
  assert.match(run('post', board, ...explainer, '--about', 'The new sign-in has 2 steps.', '--media', video,
    '--chapter', '0:00=Start', '--chapter', '1:05=Step 2', '--option', 'clear=Clear', '--option', 'unclear=Not clear', '--recommend', 'clear').out, /tour,raised,/);
  assert.match(run('post', board, ...explainer, '--media', video).out, /key tour is already used/);
  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], { cwd: tmpdir() });
  procs.push(proc);
  const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  const html = await (await fetch(url)).text();
  assert.match(html, /<title>Dashboard/);
  assert.match(html, /mockCards/);
  assert.match(html, /<nav class="side" id="nav" aria-label="Board areas">/);
  const api = await (await fetch(`${url}api/decisions`)).json();
  assert.equal(api.decisions[0].type, 'design');
  assert.equal(api.decisions[0].title, 'Pick the sign-in layout');
  assert.equal(api.decisions[0].tradeoff, 'B scans fastest; A is simplest.');
  assert.equal(api.decisions[0].mocks.length, 3);
  assert.deepEqual(api.decisions.map((d) => d.type), ['design', 'memo', 'decision', 'design', 'diagram', 'interactive', 'explainer']);
  assert.equal(api.decisions[4].view, 'mocks/flow/flow.svg');
  const tour = api.decisions[6];
  assert.deepEqual([tour.about, tour.chapters, tour.media.length], ['The new sign-in has 2 steps.', [{ at: 0, title: 'Start' }, { at: 65, title: 'Step 2' }], 1]);
  assert.match(tour.media[0].path, /^evidence\/\d+\/1\.mp4$/);
  const played = await fetch(`${url}api/media?key=tour&i=0`, { headers: { range: 'bytes=0-3' } });
  assert.deepEqual([played.status, played.headers.get('content-type'), await played.text()], [206, 'video/mp4', '0123']);
  assert.match(html, /function chapters/);
  assert.equal((await post(url, 'api/answers', { key: 'tour', answer: 'unclear', note: 'Umer: step 2 is too fast.' })).status, 200);
  assert.equal(JSON.parse(run('answers', board, '--key', 'tour', '--json').out).tour.answer, 'unclear');
  appendFileSync(join(so, tour.media[0].path), 'x');
  assert.equal((await fetch(`${url}api/media?key=tour&i=0`)).status, 404);
  // Each view is served as its own sandboxed page that can fetch nothing, even opened full size.
  for (const [item, type] of [['flow~/flow.svg', 'image/svg+xml'], ['demo~/demo.html', 'text/html'], ['pick-the-sign-in-layout~a/a.html', 'text/html']]) {
    const res = await fetch(`${url}mock/local/${item}`);
    assert.equal(res.headers.get('content-type'), type);
    assert.match(res.headers.get('content-security-policy'), /connect-src 'none'.*sandbox allow-scripts/);
  }
  assert.equal((await post(url, 'api/answers', { key: 'demo', answer: 'needs-work', note: 'Umer: the back step is lost.' })).status, 200);
  assert.equal(JSON.parse(run('answers', board, '--key', 'demo', '--json').out).demo.answer, 'needs-work');
  assert.deepEqual(api.rounds, []);
  assert.equal(api.mockBase, '/mock/local/');
  assert.equal(await (await fetch(`${url}mock/local/pick-the-sign-in-layout~a/a.html`)).text(), '<h1>Mock A</h1>');
  assert.equal((await fetch(`${url}mock/local/pick-the-sign-in-layout~z/a.html`)).status, 404);
  assert.equal(await (await fetch(`${url}mock/local/nav~b/index.html?variant=b`)).text(), '<p>variant page</p>');
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
  // Other answer on a design: the typed words are the answer, saved as text, and wait and answers read them back.
  assert.equal((await post(url, 'api/answers', { key: 'pick-the-sign-in-layout', answer: 'text', note: ' ' })).status, 400);
  assert.equal((await post(url, 'api/answers', { key: 'pick-the-sign-in-layout', answer: 'text', note: 'Umer: A layout with the B colours.' })).status, 200);
  const other = JSON.parse(run('wait', board, '--key', 'pick-the-sign-in-layout', '--json', '--timeout', '5').out)['pick-the-sign-in-layout'];
  assert.deepEqual([other.answer, other.label, other.note], ['text', 'Reply', 'Umer: A layout with the B colours.']);
  assert.match(run('answers', board, '--key', 'pick-the-sign-in-layout').out, /pick-the-sign-in-layout,text,.*Umer: A layout with the B colours\./);
  assert.equal((await post(url, 'api/answers', { key: 'pick-the-sign-in-layout', answer: 'b', note: 'Umer: B scans best.' })).status, 200);
  const read = JSON.parse(run('answers', board, '--json').out)['pick-the-sign-in-layout'];
  assert.deepEqual([read.answer, read.note], ['b', 'Umer: B scans best.']);
  assert.deepEqual(read.rounds, [{ note: 'Umer: show B with A header.', at: read.rounds[0].at }]);

  // A comment on an item and a queued prompt reach a polling agent once, and survive a restart.
  assert.equal((await post(url, 'api/messages', { kind: 'comment', key: 'gone', text: 'hi' })).status, 404);
  for (const bad of [{ kind: 'prompt', text: '  ' }, { kind: 'shout', text: 'hi' }, { kind: 'prompt', text: 'x'.repeat(2001) }]) {
    assert.equal((await post(url, 'api/messages', bad)).status, 400, JSON.stringify(bad).slice(0, 40));
  }
  const polling = spawn('node', [cli, 'poll', board, '--json', '--timeout', '20']);
  let polled = '';
  polling.stdout.on('data', (b) => (polled += b));
  const pollExited = new Promise((ok) => polling.on('exit', ok));
  await new Promise((ok) => setTimeout(ok, 500));
  assert.equal((await post(url, 'api/messages', { kind: 'comment', key: 'pick-the-sign-in-layout', text: 'Umer: B header is too tall.' })).status, 200);
  assert.equal(await pollExited, 0);
  assert.deepEqual(JSON.parse(polled).messages.map(({ kind, key, text }) => [kind, key, text]), [['comment', 'pick-the-sign-in-layout', 'Umer: B header is too tall.']]);
  assert.equal((await post(url, 'api/messages', { kind: 'prompt', text: '  Umer: also try a dark header.  ' })).status, 200);
  proc.kill();
  const again = spawn('node', [cli, 'serve', board, '--port', '0'], { cwd: tmpdir() });
  procs.push(again);
  const url2 = await new Promise((ok) => again.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  const kept = (await (await fetch(`${url2}api/decisions`)).json()).messages;
  assert.deepEqual(kept.map(({ kind, text, delivered }) => [kind, text, !!delivered]), [['comment', 'Umer: B header is too tall.', true], ['prompt', 'Umer: also try a dark header.', false]]);
  assert.match(run('poll', board).out, /messages\[1\]\{id,kind,key,text,at\}:\n  \w+,prompt,"","Umer: also try a dark header\."/);
  const none = run('poll', board, '--timeout', '1');
  assert.deepEqual([none.code, /code: TIMEOUT/.test(none.out)], [1, true]);
  again.kill();

  // The export is one read-only file: state and mocks inline, no server and no network.
  const out = join(scratch, 'frozen.html');
  // The media tampered with above is left out and counted as missing, the same as the page's own 404.
  // A wrong --out never overwrites the board.
  const before = readFileSync(board, 'utf8');
  assert.deepEqual([run('export', board, '--out', board).code, readFileSync(board, 'utf8')], [2, before]);
  assert.match(run('export', board, '--out', out).out, /items: 7\ninlined: 8\nmissing: 1\n/);
  const frozen = readFileSync(out, 'utf8');
  assert.match(frozen, /<meta http-equiv="content-security-policy" content="default-src 'none';/);
  const data = JSON.parse(/window\.FROZEN = (.*);<\/script>/.exec(frozen)[1]);
  assert.equal(data.files['/mock/local/pick-the-sign-in-layout~a/a.html'], `data:text/html;base64,${Buffer.from('<h1>Mock A</h1>').toString('base64')}`);
  // A one-page mock keeps its ?variant= in the frame URL; the trailing comment hides it from the page text.
  assert.equal(data.files['/mock/local/nav~b/index.html?variant=b'], `data:text/html;charset=utf-8,${encodeURIComponent('<p>variant page</p>')}%3C!--?variant=b`);
  assert.equal(data.answers['pick-the-sign-in-layout'].answer, 'b');
  assert.equal(data.messages, undefined, 'the export leaves out comments and prompts');
  // A diagram and an interactive page are inlined too, so the frozen copy shows them with no server.
  assert.equal(data.files['/mock/local/flow~/flow.svg'], `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>').toString('base64')}`);
  assert.ok(data.files['/mock/local/demo~/demo.html']);
  assert.ok(!frozen.includes(board), 'the export leaves out the board path');
});

// Beyond loopback the board needs its token on every route; a phone on the user's own network gets it in the link.
const mine = Object.values(networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.)/.test(i.address));
test('private-network bind: token on every route, kept across a restart', { skip: !mine && 'this machine has no private IPv4 address' }, async () => {
  assert.equal(run('open', board, '--port', '0', '--bind', '0.0.0.0').code, 2);
  assert.equal(run('open', board, '--port', '0', '--bind', '8.8.8.8').code, 2);
  const opened = run('open', board, '--port', '0', '--bind', mine.address);
  const link = /url: "(.+)"/.exec(opened.out)[1], { origin, port, searchParams } = new URL(link), token = searchParams.get('token');
  assert.equal(token, readFileSync(board.replace('.json', '.token'), 'utf8').trim());
  assert.equal(statSync(board.replace('.json', '.token')).mode & 0o777, 0o600);
  for (const path of ['/', '/api/decisions', '/api/board', '/mock/local/pick-the-sign-in-layout~a/a.html', `/mock/${token}/pick-the-sign-in-layout~a/a.html`, '/api/media?key=x&i=0', `/?token=${'x'.repeat(token.length)}`]) {
    assert.equal((await fetch(`${origin}${path}`)).status, 401, path);
  }
  assert.equal((await post(`${origin}/`, 'api/messages', { kind: 'prompt', text: 'hi' })).status, 401);
  const entry = await fetch(link, { redirect: 'manual' });
  assert.deepEqual([entry.status, entry.headers.get('location')], [303, '/']);
  const cookie = entry.headers.get('set-cookie').split(';')[0];
  assert.match(entry.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const api = await fetch(`${origin}/api/decisions`, { headers: { cookie } });
  assert.equal(api.status, 200);
  assert.equal(api.headers.get('access-control-allow-origin'), null);
  // A sandboxed mock frame sends no cookie: the mock's folder opens with the pass in its path, and nothing else does.
  const { mockBase } = await api.json();
  assert.match(mockBase, /^\/mock\/[a-f0-9]{64}\/$/);
  assert.equal((await fetch(`${origin}${mockBase}pick-the-sign-in-layout~a/a.html`)).status, 200);
  assert.equal((await fetch(`${origin}${mockBase}pick-the-sign-in-layout~a/b.html`)).status, 200);
  assert.equal((await fetch(`${origin}${mockBase.replace('/mock/', '/api/')}decisions`)).status, 401);
  assert.match(run('status', board).out, /status: running/);
  assert.match(run('stop', board).out, /status: stopped/);
  const reopened = run('open', board, '--port', String(port), '--bind', mine.address);
  assert.equal(new URL(/url: "(.+)"/.exec(reopened.out)[1]).searchParams.get('token'), token);
  const repeat = run('open', board, '--port', String(port), '--bind', mine.address);
  assert.match(repeat.out, /already open \(no-op\)/);
  assert.equal(new URL(/url: "(.+)"/.exec(repeat.out)[1]).searchParams.get('token'), token);
  // Another address while it runs is refused, never a silent no-op on the old one.
  const moved = run('open', board, '--port', String(port), '--bind', '127.0.0.1');
  assert.deepEqual([moved.code, /code: CONFLICT/.test(moved.out)], [1, true]);
  assert.ok(!readFileSync(board.replace('.json', '.board.log'), 'utf8').includes(token), 'the log never holds the token');
  // Deleting the token shuts the old link out at once; status and stop still find the board.
  rmSync(board.replace('.json', '.token'));
  // A new connection: fetch would reuse one the stopped board closed.
  const code = await new Promise((ok, no) => get(`${origin}/api/decisions`, { agent: false, headers: { cookie } }, (r) => (r.resume(), ok(r.statusCode))).on('error', no));
  assert.equal(code, 401);
  assert.match(run('status', board).out, /status: running/);
  assert.match(run('stop', board).out, /status: stopped/);
  const fresh = run('open', board, '--port', String(port), '--bind', mine.address);
  assert.notEqual(new URL(/url: "(.+)"/.exec(fresh.out)[1]).searchParams.get('token'), token);
  assert.match(run('stop', board).out, /status: stopped/);
  const foreground = spawn('node', [cli, 'serve', board, '--port', '0', '--bind', mine.address], { stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise((ok) => foreground.stdout.once('data', ok));
  const clash = run('open', board, '--port', '0', '--bind', '127.0.0.1');
  const second = spawnSync('node', [cli, 'serve', board, '--port', '0', '--bind', '127.0.0.1'], { encoding: 'utf8', timeout: 5000 });
  assert.deepEqual([second.status, /code: CONFLICT/.test(second.stdout)], [1, true]);
  foreground.kill('SIGTERM');
  await new Promise((ok) => foreground.once('exit', ok));
  assert.deepEqual([clash.code, /code: CONFLICT/.test(clash.out)], [1, true]);
});

test('doctor journey: each broken precondition prints its own fix, and a repair makes it clean', async () => {
  const dir = join(scratch, 'broken'), sod = join(dir, '.sign-off'), doc = () => run('doctor', dir);
  const failed = (out) => [...out.matchAll(/(?:: |,)"([a-z]+): /g)].map((m) => m[1]);
  // Port 0 skips the port check, so a board open on this host cannot fail the clean runs.
  const config = (port) => writeFileSync(join(sod, 'config.yaml'), `board: decisions.json\nport: ${port}\n`);
  assert.deepEqual([doc().code, failed(doc().out).filter((n) => n !== 'port')], [1, ['setup']]);
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
  assert.deepEqual(failed(doc().out).filter((n) => n !== 'port'), ['config', 'board', 'folders']);
  assert.match(doc().out, /board: mine.json is missing.*Move .*evidence away, then run/);
  rmSync(join(sod, 'evidence'));
  config(0);
  rmSync(join(sod, 'decisions.json'));
  assert.match(doc().out, /board: decisions.json is missing\. Run `sign-off-axi init /);
  assert.match(run('init', dir).out, /created\[1\]: .sign-off\/decisions.json/);
  assert.equal(doc().code, 0);
});

test('doctor names a fix for a denied setup path and a port that needs privilege', { skip: process.getuid?.() === 0 && 'root can read every path' }, () => {
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

test('a refused config bind is named by doctor, and an unreadable config stops open', { skip: process.getuid?.() === 0 && 'root can read every path' }, () => {
  const dir = join(scratch, 'bind-config'), sod = join(dir, '.sign-off'), config = join(sod, 'config.yaml'), board = join(sod, 'decisions.json');
  run('init', dir);
  writeFileSync(config, 'board: decisions.json\nport: 4410\nbind: 0.0.0.0\n');
  assert.match(run('doctor', dir).out, /config: config\.yaml: bind 0\.0\.0\.0 is not 127\.0\.0\.1 or a private address/);
  assert.equal(run('open', board, '--port', '0').code, 2);
  chmodSync(config, 0o000);
  try {
    const out = run('open', board, '--port', '0');
    assert.equal(out.code, 2);
    assert.match(out.out, /config\.yaml cannot be read/);
  } finally {
    chmodSync(config, 0o600);
  }
});

test('doctor names a fix when the folder argument is a file', () => {
  const file = join(scratch, 'plain.txt');
  writeFileSync(file, 'x');
  const out = run('doctor', file);
  assert.equal(out.code, 1);
  assert.match(out.out, /^code: NOT_FOUND$/m);
  assert.match(out.out, /plain\.txt is not a folder/);
  assert.match(out.out, /Pass a folder: `sign-off-axi doctor <folder>`/);
});

test('doctor prints a fix a shell can run for a path with a space, and fails with NOT_FOUND', () => {
  const dir = join(scratch, 'my repo'), cli2 = cli;
  mkdirSync(dir);
  const broken = run('doctor', dir);
  assert.equal(broken.code, 1);
  assert.match(broken.out, /^code: NOT_FOUND$/m);
  const fix = /Run `sign-off-axi (init [^`]+)`/.exec(broken.out)[1];
  execFileSync('/bin/sh', ['-c', `node ${cli2} ${fix}`], { env });
  writeFileSync(join(dir, '.sign-off', 'config.yaml'), 'board: decisions.json\nport: 0\n');
  assert.equal(run('doctor', dir).code, 0);
});

test('doctor ignores config keys it does not use and names a malformed port line', () => {
  const dir = join(scratch, 'extra-keys'), sod = join(dir, '.sign-off');
  run('init', dir);
  writeFileSync(join(sod, 'config.yaml'), 'board: decisions.json\nport: 0\nowner: Umer Anjum\nmax-items: 5\n');
  assert.equal(run('doctor', dir).code, 0);
  writeFileSync(join(sod, 'config.yaml'), 'board: decisions.json\nport:\n');
  const broken = run('doctor', dir);
  assert.equal(broken.code, 1);
  assert.match(broken.out, /config: config.yaml: line 2 is not one/);
});

test('doctor names a fix when the setup folder cannot be written', { skip: process.getuid?.() === 0 && 'root can write every path' }, () => {
  const dir = join(scratch, 'unwritable'), sod = join(dir, '.sign-off');
  run('init', dir);
  writeFileSync(join(sod, 'config.yaml'), 'board: decisions.json\nport: 0\n');
  chmodSync(sod, 0o500);
  try {
    const broken = run('doctor', dir);
    assert.equal(broken.code, 1);
    assert.match(broken.out, /write: \.sign-off cannot be written\. Run `chmod u\+w /);
  } finally {
    chmodSync(sod, 0o700);
  }
  assert.equal(run('doctor', dir).code, 0);
});

test('doctor reports a port whose server names a non-text file as in use', async () => {
  const dir = join(scratch, 'odd-port'), sod = join(dir, '.sign-off');
  run('init', dir);
  const odd = createHttpServer((req, res) => res.end(JSON.stringify({ file: 5 }))).listen(0, '127.0.0.1');
  await new Promise((ok) => odd.once('listening', ok));
  const { port } = odd.address();
  writeFileSync(join(sod, 'config.yaml'), `board: decisions.json\nport: ${port}\n`);
  const out = await new Promise((ok) => execFile('node', [cli, 'doctor', dir], { encoding: 'utf8', env }, (err, stdout) => ok({ code: err?.code ?? 0, out: stdout || err?.stdout || '' })));
  odd.close();
  assert.equal(out.code, 1);
  assert.match(out.out, new RegExp(`port: ${port} is in use \\(EADDRINUSE\\)`));
});

test('doctor passes a read-only board in a writable setup', { skip: process.getuid?.() === 0 && 'root can write every path' }, () => {
  const dir = join(scratch, 'readonly-board'), sod = join(dir, '.sign-off');
  run('init', dir);
  writeFileSync(join(sod, 'config.yaml'), 'board: decisions.json\nport: 0\n');
  chmodSync(join(sod, 'decisions.json'), 0o444);
  try {
    assert.equal(run('doctor', dir).code, 0);
  } finally {
    chmodSync(join(sod, 'decisions.json'), 0o600);
  }
});

test('serve refuses a board that already runs, and the first board keeps its record', async () => {
  const opened = run('open', board, '--port', '0');
  const pid = /pid: (\d+)/.exec(opened.out)[1];
  const second = spawnSync('node', [cli, 'serve', board, '--port', '0'], { encoding: 'utf8', timeout: 5000 });
  assert.deepEqual([second.status, /code: CONFLICT/.test(second.stdout)], [1, true]);
  assert.match(run('status', board).out, new RegExp(`pid: ${pid}\\b`));
  assert.match(run('stop', board).out, /status: stopped/);
});

// A free port to name in a config.yaml.
const freePort = async () => {
  const s = createServer().listen(0, '127.0.0.1');
  await new Promise((ok) => s.once('listening', ok));
  const { port } = s.address();
  await new Promise((ok) => s.close(ok));
  return port;
};
const served = (proc) => new Promise((ok) => {
  let out = '';
  proc.stdout.on('data', (b) => { out += b; if (/pid: \d+/.test(out)) ok(out); });
  proc.once('exit', () => ok(out));
});
const hostStatus = (url, host) => new Promise((ok, no) => get(url, { agent: false, headers: { host } }, (r) => (r.resume(), ok(r.statusCode))).on('error', no));

// A real browser draws the board for the frame tests: CI's runner has Chrome; elsewhere they skip when none is on the PATH.
const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].flatMap((b) => process.env.PATH.split(':').map((d) => join(d, b))).find(existsSync);
// Chrome puts a socket in its TMPDIR and stops when that path passes 107 characters, which a deep test folder does,
// so every Chrome here gets one short throwaway TMPDIR of its own, removed when the tests end.
const chromeEnv = chrome && { ...process.env, TMPDIR: mkdtempSync('/tmp/so-') };
after(() => chromeEnv && rmSync(chromeEnv.TMPDIR, { recursive: true, force: true }));
// A busy host can take many seconds to start Chrome or draw a page, so a check waits on the page itself, up to 60 seconds.
const until = async (check) => {
  for (const end = Date.now() + 60000; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await check()) return;
  assert.fail('the page did not reach the expected state');
};
/** A headless Chrome driven over its DevTools socket: evaluate(js) returns the value, or undefined while a page is still loading. */
async function browse(dir, width = 800) {
  const profile = join(dir, 'profile'), active = join(profile, 'DevToolsActivePort');
  mkdirSync(dir, { recursive: true });
  const browser = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`, `--window-size=${width},4000`, '--remote-debugging-port=0', 'about:blank'],
    { env: chromeEnv, stdio: 'ignore' });
  procs.push(browser);
  await until(() => existsSync(active) && readFileSync(active, 'utf8').includes('\n'));
  const page = (await (await fetch(`http://127.0.0.1:${readFileSync(active, 'utf8').split('\n')[0]}/json`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok) => { ws.onopen = ok; });
  const replies = new Map();
  let seq = 0;
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); replies.get(msg.id)?.(msg.result?.result?.value); };
  const evaluate = (expression) => new Promise((ok) => { const id = ++seq; replies.set(id, ok); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); });
  return { evaluate, close: () => { ws.close(); browser.kill(); } };
}

test('an interactive page that posts its height gets a frame that fits it, each frame only its own and never past 10000px; a design shows the recommended phone frame first', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'fit'), file = join(dir, 'board.json'), pages = join(dir, 'mocks', 'page');
  mkdirSync(pages, { recursive: true });
  const says = (h) => `<p>page</p><script>parent.postMessage({ height: ${h} }, '*')</script>`;
  writeFileSync(join(pages, 'short.html'), says(240));
  writeFileSync(join(pages, 'huge.html'), says(99999));
  writeFileSync(join(pages, 'quiet.html'), '<p>no height</p>');
  const item = (key) => ({ key, type: 'interactive', title: key, view: `mocks/page/${key}.html` });
  const look = { key: 'look', type: 'design', title: 'look', options: ['A', 'B', 'C'].map((l) => ({ value: l.toLowerCase(), label: l })), recommend_value: 'b',
    mocks: ['a', 'b', 'c'].map((value) => ({ value, path: 'mocks/page/quiet.html' })) };
  writeFileSync(file, JSON.stringify({ schema: 2, readonly: true, items: [...['short', 'huge', 'quiet'].map(item), look] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  // A read-only board's pages and designs are only to read: they live on Reports and explainers.
  const url = `${/url: "(\S+)"/.exec(await served(proc))[1]}#reports`;
  // Each page posts its height once it loads, and a frame loads only near the screen (the 10000px one can push the rest away),
  // so scroll to each frame still unsized, as a reader would, and read the board once both pages that post have their frame sized.
  const { evaluate, close } = await browse(dir);
  await evaluate(`location.href = ${JSON.stringify(url)}`);
  const sized = `[...document.querySelectorAll("iframe[title^='Interactive page']")].map((f) => f.style.height ? f.title : void f.scrollIntoView()).filter(Boolean).sort().join()`;
  await until(async () => (await evaluate(sized)) === 'Interactive page: huge,Interactive page: short');
  const dom = await evaluate('document.documentElement.outerHTML');
  close();
  const frame = (key) => new RegExp(`<iframe[^>]*title="Interactive page: ${key}"[^>]*>`).exec(dom)?.[0];
  assert.match(frame('short'), /style="height: 240px;"/);
  assert.match(frame('huge'), /style="height: 10000px;"/);
  assert.doesNotMatch(frame('quiet'), /style=/);
  // Each option is a figure: its label (and the badge) above its frame; the recommended one first, the rest in their order.
  const figures = [...dom.matchAll(/<figure class="mock">(.*?)<\/figure>/g)].map((m) => m[1]);
  assert.deepEqual(figures.map((f) => /class="label"[^>]*>(\w)</.exec(f)[1]), ['B', 'A', 'C']);
  assert.ok(figures.every((f) => f.indexOf('<figcaption') < f.indexOf('class="shot"')), figures[0]);
  assert.match(figures[0], /Recommended/);
  proc.kill();
});

test('each card has one place to type: Other answer holds the reply, Another round and the comment, and no separate note link', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'one-box'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const abc = ['A', 'B', 'C'].map((l) => ({ value: l.toLowerCase(), label: l }));
  const nine = new Date(new Date().setHours(9, 15, 0, 0)).toISOString();
  writeFileSync(file, JSON.stringify({ schema: 2, items: [{ key: 'ship', title: 'When should it ship?', options: abc, recommend_value: 'b', filed: nine },
    { key: 'look', type: 'design', title: 'Pick the look', options: abc, recommend_value: 'b' },
    { key: 'how', title: 'How it ships', area: 'reports', group: 'How it works', filed: new Date().toISOString(), decided: 'Ships only when the check passes.', steps: [{ title: 'Build', marks: ['store'] }, { title: 'Check' }, { title: 'Ship', marks: ['gate', 'fail'] }] }] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const dump = (hash) => new Promise((ok, no) => execFile(chrome, ['--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${join(dir, 'profile')}`,
    '--window-size=800,4000', '--virtual-time-budget=10000', '--dump-dom', url + hash], { env: chromeEnv, maxBuffer: 1 << 24 }, (e, out) => (e ? no(e) : ok(out))));
  const cards = (dom) => [...dom.matchAll(/<article class="row[^"]*" id="item-(\w+)">(.*?)<\/article>/gs)].map((m) => [m[1], m[2]]);
  // Waiting on you is Triage: the oldest ask alone, with the queue of both beside it and Skip to the next.
  const waiting = await dump('#waiting');
  assert.deepEqual(cards(waiting).map(([key]) => key), ['ship']);
  assert.match(waiting, /1 of 2/);
  // Under the progress bar, when the ask in focus was raised.
  assert.match(waiting, /<div class="pbar"[^>]*><i[^>]*><\/i><\/div><p class="meta since">Waiting since 09:15<\/p>/);
  assert.equal(waiting.match(/<ol class="queue"[^>]*>.*?<\/ol>/s)[0].match(/<button/g).length, 2);
  // Under the ask, Skip for now and Dismiss sit side by side; the ask has no × of its own.
  assert.match(waiting, /<div class="quiet"><button class="skip">Skip for now<\/button><button class="dis" aria-label="Dismiss, When should it ship\?">Dismiss<\/button><\/div>/);
  assert.doesNotMatch(waiting.match(/<div class="focus">.*?<\/article>/s)[0], /class="x"/);
  // Needs you first ends with Dismiss on the left and the way to Triage on the right; its card has no × of its own.
  const home = await dump('');
  assert.match(home, /<div class="foot"><button class="dis" aria-label="Dismiss, When should it ship\?">Dismiss<\/button><a class="more" href="#waiting">Answer all 2 in Triage →<\/a><\/div>/);
  assert.doesNotMatch(home.match(/<section class="card needs.*?<\/section>/s)[0], /class="x"/);
  // Under its heading, when that ask was raised.
  assert.match(home, /<h2>Needs you first<\/h2><p class="meta since">Waiting since 09:15<\/p>/);
  // Summary has the person's mark beside its title, and the Waiting on you tile one clock and the oldest ask's time (the design ask has none).
  assert.match(home, /<h1 tabindex="-1">Summary<\/h1><span class="icon i-you" aria-hidden="true">/);
  const vis = (dom, a) => dom.match(new RegExp(`<a class="tile i-${a}".*?<span class="vis" aria-hidden="true">(.*?)<\\/span><span class="detail"`, 's'))[1];
  assert.deepEqual(vis(home, 'waiting').match(/class="icon i-\w+"/g), ['class="icon i-waiting"']);
  assert.match(home, /<a class="tile i-waiting".*?<span class="detail" dir="auto">Oldest 09:15<\/span>/s);
  // An ask dismissed from Waiting on you sits under Dismissed (1) at the end of Needs you first and of Triage, with Restore.
  const gone = file.replace(/\.json$/, '.dismissed.jsonl');
  writeFileSync(gone, JSON.stringify({ key: 'ship', dismissed: true, at: new Date().toISOString() }) + '\n');
  const pages = {};
  for (const hash of ['', '#waiting']) assert.match(pages[hash] = await dump(hash), /<details class="other gone-asks"><summary>Dismissed \(1\)<\/summary><ul class="rows"><li><strong dir="auto">When should it ship\?<\/strong><button class="dis" aria-label="Restore, When should it ship\?">Restore<\/button><\/li><\/ul><\/details>/, hash);
  // Only the design ask waits now, and it has no time: the tile keeps its count.
  assert.match(pages[''], /<a class="tile i-waiting".*?<span class="detail" dir="auto">1 waiting<\/span>/s);
  // Restore puts it back in Triage (behind the ask in focus) through the same dismiss log, and the row goes once nothing is dismissed.
  const { evaluate, close } = await browse(join(dir, 'live'));
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  await until(async () => (await evaluate('document.querySelector(".fhead")?.textContent')) === '1 of 1');
  await evaluate('document.querySelector(".gone-asks .dis").click()');
  await until(async () => (await evaluate('!document.querySelector(".gone-asks") && document.querySelector(".fhead").textContent')) === '2 of 2');
  close();
  assert.deepEqual(readFileSync(gone, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map(({ key, dismissed }) => [key, dismissed]), [['ship', true], ['ship', false]]);
  // Reports and explainers says what the page is under its title, draws a report's steps as numbered nodes, each with only the marks it lists, and the legend once.
  const reports = await dump('#reports');
  assert.match(reports, /<p class="lede">How the tools work, step by step\. Tap Open to see the whole flow\.<\/p>/);
  assert.equal(reports.match(/class="card legend"/g).length, 1);
  const flow = reports.match(/<ol class="flow"[^>]*>(.*?)<\/ol>/s)[1];
  assert.deepEqual([...flow.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => [...m[1].matchAll(/mk mk-(\w+)/g)].map((x) => x[1])), [['store'], [], ['gate', 'fail']]);
  assert.match(reports, /3 steps.*>Open</s);
  // Its group heads a section with the filed time; the card says New today and what it decided.
  assert.match(reports, /<div class="sec-h"><h2>How it works<\/h2><span class="meta">Filed \d\d:\d\d today<\/span>/);
  assert.match(reports, /How it ships<\/h3><span class="st new">New today<\/span>.*<span class="lbl">What it decided<\/span>Ships only when the check passes\./s);
  // Answered is Done today: a count under the title, Clear all done on the section head, and a short row per item with its answer and time on the right, beside its ×.
  writeFileSync(file.replace(/\.json$/, '.answers.jsonl'), ['ship', 'look'].map((key) => JSON.stringify({ key, answer: 'a', label: 'A', close: 'done', at: new Date().toISOString() })).join('\n') + '\n');
  // Once both are answered, the Answered tile has a check for each and Waiting on you no clock.
  const after = await dump('');
  assert.deepEqual([vis(after, 'answered').match(/class="icon i-\w+"/g), vis(after, 'waiting')], [['class="icon i-answered"', 'class="icon i-answered"'], '']);
  const answered = await dump('#answered');
  assert.match(answered, /<p class="lede">2 answered today\.<\/p><\/header><div class="sec-head"><h2>Done today<\/h2><button class="clear">Clear all done<\/button><\/div>/);
  const lines = [...answered.matchAll(/<summary class="compact">.*?<strong[^>]*>(.*?)<\/strong>.*?<span class="ans"><b[^>]*>(\w+)<\/b><time>\d\d:\d\d<\/time><\/span><\/summary>.*?<\/details><button class="x" aria-label="Dismiss, [^"]+">×<\/button>/gs)];
  assert.deepEqual(lines.map((m) => [m[1], m[2]]).sort(), [['Pick the look', 'A'], ['When should it ship?', 'A']]);
  // Each row opens to its full card, with its one box.
  const rows = cards(answered);
  assert.deepEqual(rows.map(([key]) => key).sort(), ['look', 'ship']);
  for (const [key, row] of rows) {
    assert.equal(row.match(/<textarea/g)?.length, 1, key);
    assert.match(row, /<details class="other"><summary[^>]*>Other answer<\/summary>.*<textarea.*>Send reply<.*>Another round<.*>Send as a comment</s, key);
    assert.doesNotMatch(row, /Note, comment or another round/, key);
  }
  // A dismissed item leaves the page and its counts.
  writeFileSync(file.replace(/\.json$/, '.dismissed.jsonl'), JSON.stringify({ key: 'look', dismissed: true, at: new Date(Date.now() + 1000).toISOString() }) + '\n');
  const left = await dump('#answered');
  assert.deepEqual(cards(left).map(([key]) => key), ['ship']);
  assert.match(left, /Answered<span class="n">1<\/span>/);
  writeFileSync(file.replace(/\.json$/, '.dismissed.jsonl'), ['look', 'ship'].map((key) => JSON.stringify({ key, dismissed: true, at: new Date(Date.now() + 1000).toISOString() })).join('\n') + '\n');
  assert.match(await dump('#answered'), /<p class="empty">All done items cleared\.<\/p>/);
  proc.kill();
});

test('Clear all done on 201 answered items, set two across on a wide screen: the page empties in chunks, says so, and Undo brings all 201 back', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'many-answered'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const abc = ['A', 'B', 'C'].map((l) => ({ value: l.toLowerCase(), label: l }));
  const keys = Array.from({ length: 201 }, (_, i) => `q${i}`);
  writeFileSync(file, JSON.stringify({ schema: 2, items: keys.map((key) => ({ key, title: `Question ${key}`, options: abc, recommend_value: 'b' })) }));
  writeFileSync(file.replace(/\.json$/, '.answers.jsonl'), keys.map((key) => JSON.stringify({ key, answer: 'a', label: 'A', close: 'done', at: new Date().toISOString() })).join('\n') + '\n');
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(dir, 1440);
  const rows = 'document.querySelectorAll("article.row").length';
  await evaluate(`location.href = ${JSON.stringify(`${url}#answered`)}`);
  await until(async () => (await evaluate(`${rows} === 201`)));
  // On a wide screen the rows are cards two across: the first two share a line, side by side.
  assert.ok(await evaluate('(([a, b]) => a.top === b.top && b.left > a.right)([...document.querySelectorAll(".rows.i-answered > li")].map((li) => li.getBoundingClientRect()))'));
  await evaluate('document.querySelector(".clear").click()');
  await until(async () => (await evaluate(`${rows} === 0 && document.querySelector(".empty")?.textContent === "All done items cleared."`)));
  await evaluate('document.getElementById("undo").click()');
  await until(async () => (await evaluate(`${rows} === 201`)));
  close();
  proc.kill();
});

test('Evidence: each update is a card with its number, the day it was filed and New when that is today; one portrait capture sits beside its words, two go side by side; at 1440 the page counts them under its title and sets them two across', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'updates'), file = join(dir, '.sign-off', 'decisions.json');
  mkdirSync(dir);
  run('init', dir);
  const shot = (name, w, h) => (writeFileSync(join(dir, name), sized(w, h)), join(dir, name));
  const [tall, wide] = [shot('tall.png', 300, 600), shot('wide.png', 600, 300)];
  const update = (...media) => run('post', file, '--type', 'evidence', '--title', 'Sign-in', '--about', 'Loads in 1 second.', ...media.flatMap((m) => ['--media', m])).code;
  assert.deepEqual([update(tall), update(wide, tall), update(wide)], [0, 0, 0]);
  // The first update was filed three days ago: it shows that day and no New.
  const doc = JSON.parse(readFileSync(file, 'utf8')), old = new Date(Date.now() - 3 * 864e5);
  doc.items[0].filed = old.toISOString();
  writeFileSync(file, JSON.stringify(doc));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 1440);
  await evaluate(`location.href = ${JSON.stringify(`${url}#evidence`)}`);
  const cards = '[...document.querySelectorAll("article.update")].map((a) => [a.querySelector("h3").textContent, a.querySelector(".head .meta").textContent, !!a.querySelector(".st.new"), a.querySelector(".upd").className, a.querySelectorAll(".choices button").length])';
  await until(async () => (await evaluate(`${cards}.length === 3 && document.querySelector(".upd.portrait")`)));
  const day = (at) => at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), today = day(new Date());
  assert.deepEqual(await evaluate(cards), [['Update 3', today, true, 'upd', 3], ['Update 2', today, true, 'upd', 3], ['Update 1', day(old), false, 'upd portrait', 3]]);
  // The portrait capture is left of the words; the pair shares a line.
  const box = (sel) => `document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect()`;
  assert.ok(await evaluate(`${box('#item-update-1 .upd > .media')}.right <= ${box('#item-update-1 .upd > div:last-child')}.left`));
  assert.ok(await evaluate('(([a, b]) => a.top === b.top && b.left > a.right)([...document.querySelectorAll("#item-update-2 .media img")].map((i) => i.getBoundingClientRect()))'));
  // Under the title: how many, how many filed today and when the newest came; then the Updates head and the cards two across.
  const at = new Date(doc.items[2].filed).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  assert.deepEqual(await evaluate('[document.querySelector(".top .lede").textContent, document.querySelector(".sec-head h2").textContent]'), [`3 updates, 2 new. The page changed at ${at}.`, 'Updates']);
  assert.ok(await evaluate('(([a, b, c]) => a.top === b.top && b.left > a.right && c.top > a.bottom)([3, 2, 1].map((n) => document.getElementById(`item-update-${n}`).getBoundingClientRect()))'));
  close();
  proc.kill();
});

test('a lock left by a sign-off-axi that stopped mid-write: raise names it, doctor prints its fix, the fix clears it', () => {
  const dir = join(scratch, 'crashed'), sod = join(dir, '.sign-off'), lock = join(sod, 'decisions.json.lock');
  run('init', dir);
  writeFileSync(join(sod, 'config.yaml'), 'board: decisions.json\nport: 0\n');
  assert.match(run('doctor', dir).out, /locks,none left behind/);
  // What a crash leaves: the lock with the pid of a process that is gone.
  writeFileSync(lock, `${spawnSync(process.execPath, ['-e', '']).pid}\n`);
  const busy = run('raise', join(sod, 'decisions.json'), '--title', 'Ship it?');
  assert.deepEqual([busy.code, /code: BUSY/.test(busy.out)], [1, true]);
  assert.match(busy.out, /a sign-off-axi that stopped mid-write left decisions\.json\.lock behind\n[^]*Run `rm /);
  const broken = run('doctor', dir);
  assert.equal(broken.code, 1);
  const fix = /locks: decisions\.json\.lock left by a sign-off-axi that stopped mid-write, so every raise, post and open waits on it\. Run `([^`]+)`/.exec(broken.out)[1];
  execFileSync('/bin/sh', ['-c', fix]);
  assert.equal(run('doctor', dir).code, 0);
  assert.match(run('raise', join(sod, 'decisions.json'), '--title', 'Ship it?').out, /ship-it,raised,/);
});

test('two serves of one board started at once: one runs, the other is refused', async () => {
  const dir = join(scratch, 'race'), file = join(dir, '.sign-off', 'decisions.json');
  run('init', dir);
  // A stale record naming a port where a slow server shows another board: each serve's check takes 300 ms, so the two checks overlap.
  const slow = createHttpServer((req, res) => setTimeout(() => res.end(JSON.stringify({ file: '/another/board.json', pid: 1 })), 300)).listen(0, '127.0.0.1');
  await new Promise((ok) => slow.once('listening', ok));
  writeFileSync(file.replace('.json', '.board.pid'), `1 ${slow.address().port} 127.0.0.1\n`);
  const both = [0, 1].map(() => spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] }));
  procs.push(...both);
  const outs = await Promise.all(both.map(served)).finally(() => (slow.close(), slow.closeAllConnections()));
  assert.equal(outs.filter((o) => /url: /.test(o)).length, 1, outs.join('\n'));
  assert.equal(outs.filter((o) => /code: CONFLICT/.test(o)).length, 1, outs.join('\n'));
  assert.match(run('status', file).out, new RegExp(`pid: ${/pid: (\d+)/.exec(outs.find((o) => /url: /.test(o)))[1]}\\b`));
  both.forEach((p) => p.kill());
});

test('a mock page loads the css and images beside it, and nothing outside its own folder', async () => {
  const dir = join(scratch, 'siblings'), sod = join(dir, '.sign-off'), file = join(sod, 'decisions.json'), page = join(sod, 'mocks', 'card');
  run('init', dir);
  mkdirSync(join(page, 'img'), { recursive: true });
  writeFileSync(join(page, 'index.html'), '<link rel="stylesheet" href="style.css"><img src="img/dot.png"><p>card</p>');
  writeFileSync(join(page, 'style.css'), 'p { color: teal }');
  writeFileSync(join(page, 'img', 'dot.png'), png);
  writeFileSync(join(page, 'notes.json'), '{}');
  writeFileSync(join(sod, 'mocks', 'other.css'), 'p { color: red }');
  assert.match(run('post', file, '--type', 'design', '--key', 'card', '--title', 'Pick the card', '--option', 'a=A', '--option', 'b=B',
    '--mock', 'a=mocks/card/index.html?variant=a', '--mock', 'b=mocks/card/index.html?variant=b', '--recommend', 'a').out, /card,raised,/);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  // The frame's own URL, as the page builds it; the browser resolves the page's relative names against it.
  const frame = new URL(`${(await (await fetch(`${url}api/decisions`)).json()).mockBase.slice(1)}card~a/index.html?variant=a`, url);
  assert.match(await (await fetch(frame)).text(), /<p>card<\/p>/);
  const css = await fetch(new URL('style.css', frame));
  assert.deepEqual([css.status, css.headers.get('content-type'), await css.text()], [200, 'text/css', 'p { color: teal }']);
  assert.match(css.headers.get('content-security-policy'), /connect-src 'none'.*sandbox allow-scripts/);
  const dot = await fetch(new URL('img/dot.png', frame));
  assert.deepEqual([dot.status, dot.headers.get('content-type')], [200, 'image/png']);
  for (const escape of ['notes.json', '../other.css', '..%2Fother.css', '..%2F..%2Fdecisions.json', '..%2F..%2Fconfig.yaml', 'missing.css']) {
    const res = await fetch(`${frame.href.replace(/index\.html.*/, '')}${escape}`);
    assert.notEqual(res.status, 200, escape);
  }
  proc.kill();
});

test('hosts: a private DNS name in config.yaml is let in besides the bind address, and doctor checks it leads there', async () => {
  const dir = join(scratch, 'hosts'), sod = join(dir, '.sign-off'), file = join(sod, 'decisions.json'), config = join(sod, 'config.yaml');
  run('init', dir);
  writeFileSync(config, 'board: decisions.json\nport: 0\nbind: 127.0.0.1\nhosts: Board.example, box.example.\n');
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], { port } = new URL(url);
  assert.deepEqual(await Promise.all([`board.example:${port}`, `box.example:${port}`, `127.0.0.1:${port}`, `evil.example:${port}`, `board.example:1`].map((h) => hostStatus(`${url}api/board`, h))),
    [200, 200, 200, 403, 403]);
  proc.kill();
  writeFileSync(config, 'board: decisions.json\nport: 0\nbind: 127.0.0.1\nhosts: board.invalid\n');
  const astray = run('doctor', dir);
  assert.equal(astray.code, 1);
  assert.match(astray.out, /hosts: board\.invalid does not resolve \([A-Z_]+\), not the bind address 127\.0\.0\.1\. Point each name at 127\.0\.0\.1 in your private network's DNS, or take it off the hosts: line of /);
  writeFileSync(config, 'board: decisions.json\nport: 0\nbind: 127.0.0.1\nhosts: bad_name!\n');
  assert.match(run('doctor', dir).out, /config: config\.yaml: hosts bad_name! is not a DNS name/);
  writeFileSync(config, 'board: decisions.json\nport: 0\nbind: 127.0.0.1\nhosts: localhost\n');
  assert.match(run('doctor', dir).out, /hosts,localhost resolves to 127\.0\.0\.1/);
  assert.equal(run('doctor', dir).code, 0);
});

test('a symlinked board: doctor, open and serve all read the config.yaml beside the link', async () => {
  const dir = join(scratch, 'linked'), sod = join(dir, '.sign-off'), link = join(sod, 'decisions.json'), away = join(scratch, 'linked-away');
  run('init', dir);
  const [here, there] = [await freePort(), await freePort()];
  mkdirSync(away);
  writeFileSync(join(away, 'real.json'), '{"schema": 2, "items": []}\n');
  writeFileSync(join(away, 'config.yaml'), `board: real.json\nport: ${there}\n`);
  rmSync(link);
  symlinkSync(join(away, 'real.json'), link);
  writeFileSync(join(sod, 'config.yaml'), `board: decisions.json\nport: ${here}\n`);
  assert.match(run('doctor', dir).out, new RegExp(`config,"board decisions\\.json, port ${here}"`));
  const opened = run('open', link);
  assert.match(opened.out, new RegExp(`url: "http://127\\.0\\.0\\.1:${here}/"`));
  assert.match(run('stop', link).out, /status: stopped/);
  const proc = spawn(process.execPath, [cli, 'serve', link], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  assert.match(await served(proc), new RegExp(`url: "http://127\\.0\\.0\\.1:${here}/"`));
  proc.kill();
});

test('a read-only board fed by another program: no answers, a link on any item, and each change shows on the next read', async () => {
  const dir = join(scratch, 'fed'), file = join(dir, 'board.json'), page = join(dir, 'mocks', 'page');
  mkdirSync(join(page, 'img'), { recursive: true });
  writeFileSync(join(page, 'index.html'), '<a href="img/dot.png"><img src="img/dot.png"></a>');
  writeFileSync(join(page, 'img', 'dot.png'), png);
  const feed = (items) => writeFileSync(file, JSON.stringify({ schema: 2, readonly: true, items }));
  const pageItem = { key: 'page', type: 'interactive', title: 'Updates', view: 'mocks/page/index.html' };
  feed([pageItem, { key: 'ask-1', type: 'ask', title: 'Check the sign-in screen', link: 'https://example.com/pr/1' }]);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], read = async () => (await fetch(`${url}api/decisions`)).json();
  const first = await read();
  assert.equal(first.readonly, true);
  assert.equal(first.decisions[1].link, 'https://example.com/pr/1');
  assert.equal((await fetch(new URL(`${first.mockBase.slice(1)}page~/img/dot.png`, url))).status, 200);
  for (const [path, body] of [['api/answers', { key: 'ask-1', answer: 'yes' }], ['api/rounds', { key: 'ask-1', note: 'again' }], ['api/messages', { kind: 'prompt', text: 'hi' }], ['api/dismiss', { keys: ['ask-1'], dismissed: true }]]) {
    const res = await post(url, path, body);
    assert.deepEqual([res.status, (await res.json()).error], [403, 'This board is read-only'], path);
  }
  assert.deepEqual(readdirSync(dir).filter((f) => /jsonl$/.test(f)), []);
  // The feeding program rewrites the file: a new row shows, a removed one is gone, with no restart.
  feed([pageItem, { key: 'ask-2', type: 'ask', title: 'Pick a release day' }]);
  assert.deepEqual((await read()).decisions.map((d) => d.key), ['page', 'ask-2']);
  writeFileSync(file, JSON.stringify({ schema: 2, items: [{ key: 'ask-3', title: 'Bad link?', link: 'ftp://x' }] }));
  assert.equal((await fetch(`${url}api/decisions`)).status, 422);
  proc.kill();
});

test('an answers-only board fed through post --replace: a bad item is refused, yes/no and text replies are saved, even for a dropped item', async () => {
  const dir = join(scratch, 'fed-answers'), file = join(dir, 'board.json'), feed = join(dir, 'feed.json');
  mkdirSync(join(dir, 'mocks', 'page'), { recursive: true });
  writeFileSync(join(dir, 'mocks', 'page', 'index.html'), '<p>Updates</p>');
  const write = (items) => (writeFileSync(feed, JSON.stringify({ schema: 2, answers_only: true, items })), run('post', file, '--from', feed, '--replace'));
  // The feed's page of updates names its area, so the board counts and opens it under Evidence.
  const page = { key: 'page', type: 'interactive', title: 'Updates', view: 'mocks/page/index.html', options: [], area: 'evidence' };
  const yesNo = { key: 'ask-1', type: 'ask', title: 'Ship it?', reply: true };
  const words = { key: 'ask-2', type: 'ask', title: 'Say ready when you are', options: [], reply: true };
  // Items already on a board are not checked again: these kind-less asks were on it before contract v1, which refuses a new one.
  writeFileSync(file, JSON.stringify({ schema: 2, answers_only: true, items: [page, yesNo, words] }));
  assert.match(write([page, yesNo, words]).out, /items: 3\nchanged: true/);
  // A feed with no times gets one per item on first sight, kept on every later run, so the file is left alone; a feed's own time is kept as sent.
  const times = () => JSON.parse(readFileSync(file, 'utf8')).items.map((i) => i.filed), stamped = times();
  assert.ok(stamped.every((t) => Date.now() - Date.parse(t) < 60_000), String(stamped));
  assert.match(write([page, yesNo, words]).out, /changed: false/);
  assert.deepEqual(times(), stamped);
  assert.match(write([page, yesNo, { ...words, filed: '2026-10-13T07:19:00Z' }]).out, /changed: true/);
  assert.deepEqual(times(), [...stamped.slice(0, 2), '2026-10-13T07:19:00Z']);
  // A malformed item from the feeder is refused at write time, and the board stays as it was.
  const before = readFileSync(file, 'utf8');
  const bad = write([page, { ...words, options: [{ value: 'only', label: 'Only' }] }]);
  assert.equal(bad.code, 2);
  assert.match(bad.out, /feed\.json: items\[1\] \(key \\"ask-2\\"\): options must be 2 to 6 items \(or empty/);
  assert.equal(write([{ ...yesNo, options: [{ value: 'text', label: 'T' }, { value: 'no', label: 'No' }] }]).code, 2);
  assert.match(write([{ ...page, area: 'later' }]).out, /area must be waiting or evidence or reports or answered/);
  assert.match(write([{ ...page, steps: [{ title: 'Read', marks: ['magic'] }, { title: 'Count' }] }]).out, /steps must list 2 to 12 steps/);
  assert.match(write([{ ...page, filed: 'yesterday' }]).out, /filed must be an ISO 8601 date-time/);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(run('post', file, '--replace').code, 2);
  assert.match(run('list', file).out, /waiting\[2\]/);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const shown = await (await fetch(`${url}api/decisions`)).json();
  assert.deepEqual([shown.answers_only, shown.decisions.map((d) => d.area)], [true, ['evidence', undefined, undefined]]);
  for (const [path, body] of [['api/rounds', { key: 'ask-1', note: 'again' }], ['api/messages', { kind: 'prompt', text: 'hi' }], ['api/messages', { kind: 'comment', key: 'ask-1', text: 'hi' }]]) {
    const res = await post(url, path, body);
    assert.deepEqual([res.status, (await res.json()).error], [403, 'This board takes answers only'], path);
  }
  for (const [body, status] of [[{ key: 'page', answer: 'yes' }, 400], [{ key: 'ask-2', answer: 'yes' }, 400], [{ key: 'ask-2', answer: 'text' }, 400],
    [{ key: 'ask-1', answer: 'yes', note: 'go' }, 200], [{ key: 'ask-2', answer: 'text', note: 'ready' }, 200]]) {
    assert.equal((await post(url, 'api/answers', body)).status, status, JSON.stringify(body));
  }
  // The feeder drops ask-1 while the person replies to it: the reply is still saved.
  assert.equal(write([page, words]).code, 0);
  assert.equal((await post(url, 'api/answers', { key: 'ask-1', answer: 'text', note: 'too late?' })).status, 200);
  assert.equal((await post(url, 'api/answers', { key: 'ask-9', answer: 'no such' })).status, 404);
  const lines = readFileSync(join(dir, 'board.answers.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map(({ key, answer, note }) => [key, answer, note]), [['ask-1', 'yes', 'go'], ['ask-2', 'text', 'ready'], ['ask-1', 'text', 'too late?']]);
  assert.equal(statSync(join(dir, 'board.answers.jsonl')).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir).filter((f) => /jsonl$/.test(f)), ['board.answers.jsonl']);
  assert.match(run('list', file).out, /0 of 2 decisions/);
  // Dismiss hides items on an answers-only board too, and tells the feeder nothing; Undo, or a new answer after it, brings an item back.
  const hidden = async (body) => (await (await post(url, 'api/dismiss', body)).json()).dismissed;
  for (const [body, status] of [[{ keys: [], dismissed: true }, 400], [{ keys: ['page'], dismissed: 'yes' }, 400], [{ keys: ['ask-9'], dismissed: true }, 404]]) {
    assert.equal((await post(url, 'api/dismiss', body)).status, status, JSON.stringify(body));
  }
  assert.deepEqual(await hidden({ keys: ['page', 'ask-2', 'page'], dismissed: true }), ['page', 'ask-2']);
  assert.deepEqual(await hidden({ keys: ['page'], dismissed: false }), ['ask-2']);
  assert.equal(statSync(join(dir, 'board.dismissed.jsonl')).mode & 0o777, 0o600);
  await new Promise((r) => setTimeout(r, 1100)); // Times are kept to the second.
  assert.equal((await post(url, 'api/answers', { key: 'ask-2', answer: 'text', note: 'ready now' })).status, 200);
  assert.deepEqual((await (await fetch(`${url}api/decisions`)).json()).dismissed, []);
  assert.deepEqual(readFileSync(join(dir, 'board.answers.jsonl'), 'utf8').trim().split('\n').length, 4);
  // An answered key may not come back asking something else; an item only shown needs a fed board.
  const moved = write([page, { ...words, title: 'Say go when you are' }]);
  assert.notEqual(moved.code, 0);
  assert.match(moved.out, /key ask-2 was answered and now holds a different question/);
  writeFileSync(feed, JSON.stringify({ schema: 2, items: [page] }));
  assert.equal(run('post', join(dir, 'plain.json'), '--from', feed, '--replace').code, 2);
  // Another agent's card on the same board: a feed with --filer replaces only its own items, never that card or the answers.
  assert.match(run('raise', file, '--key', 'agent-card-1', '--title', 'Hold the release?').out, /agent-card-1,raised/);
  const scoped = (items) => (writeFileSync(feed, JSON.stringify({ schema: 2, ...(items.length && { answers_only: true }), items })), run('post', file, '--from', feed, '--replace', '--filer', 'feeder'));
  const keys = () => JSON.parse(readFileSync(file, 'utf8')).items.map((i) => [i.key, i.filer ?? '']);
  assert.match(scoped([page, words]).out, /changed: true/);
  assert.deepEqual(keys(), [['page', 'feeder'], ['ask-2', 'feeder'], ['agent-card-1', '']]);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).answers_only, true, 'the board keeps its answers_only');
  assert.match(scoped([page, words]).out, /changed: false/);
  assert.equal(scoped([page]).code, 0);
  assert.deepEqual(keys(), [['page', 'feeder'], ['agent-card-1', '']]);
  assert.match(run('raise', file, '--key', 'theirs', '--title', 'Theirs?', '--filer', 'other').out, /theirs,raised/);
  const taken = scoped([page, { key: 'theirs', title: 'Theirs?' }]);
  assert.equal(taken.code, 1);
  assert.match(taken.out, /key theirs .* was posted by another filer/);
  // An empty feed removes the feeder's items alone.
  assert.equal(scoped([]).code, 0);
  assert.deepEqual(keys(), [['agent-card-1', ''], ['theirs', 'other']]);
  assert.match(readFileSync(join(dir, 'board.answers.jsonl'), 'utf8'), /"note":"ready"/);
  // ask-2 is gone but its answer stays: a new question under that key would inherit it, so it is refused.
  const reused = run('raise', file, '--key', 'ask-2', '--title', 'Something else?');
  assert.equal(reused.code, 1);
  assert.match(reused.out, /key ask-2 already has a saved answer/);
  proc.kill();
});

test('answer events: a filer takes only its own answers, once, the card shows it seen, and on_answer gets each answer on stdin', async () => {
  const dir = join(scratch, 'events'), file = join(dir, 'board.json'), out = join(dir, 'hook.out');
  mkdirSync(dir);
  writeFileSync(join(dir, 'hook.mjs'), `import { appendFileSync, readFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(out)}, readFileSync(0, 'utf8'));\n`);
  // The answer reaches the hook on stdin only: its arguments are the config's words, never the answer.
  writeFileSync(join(dir, 'config.yaml'), 'board: board.json\non_answer: node hook.mjs --from-board\n');
  const as = (extra, ...args) => {
    try { return { out: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...env, ...extra } }), code: 0 }; }
    catch (e) { return { out: `${e.stdout}`, code: e.status }; }
  };
  assert.match(as({}, 'raise', file, '--key', 'a', '--title', 'Ship A?', '--filer', 'agent-a').out, /Run `sign-off-axi wait \S+ --filer agent-a`/);
  as({ SIGN_OFF_FILER: 'agent-b' }, 'raise', file, '--key', 'b', '--title', 'Ship B?');
  as({ CLAUDE_CODE_SESSION_ID: 'session-1' }, 'raise', file, '--key', 's', '--title', 'Ship S?');
  as({}, 'raise', file, '--key', 'none', '--title', 'Ship it?');
  assert.equal(as({}, 'raise', file, '--key', 'bad', '--title', 'Bad?', '--filer', 'not ok').code, 2);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).items.map((i) => [i.key, i.filer ?? '']), [['a', 'agent-a'], ['b', 'agent-b'], ['s', 'session-1'], ['none', '']]);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const read = async () => (await fetch(`${url}api/decisions`)).json();
  assert.ok((await read()).decisions.every((d) => !('filer' in d)), 'the page never learns who filed an item');
  // An answer saved before the filer waits is still its event.
  assert.equal((await post(url, 'api/answers', { key: 'a', answer: 'yes' })).status, 200);
  assert.deepEqual((await read()).seen, []);
  const took = as({}, 'wait', file, '--filer', 'agent-a', '--json', '--timeout', '5');
  assert.deepEqual([took.code, Object.keys(JSON.parse(took.out))], [0, ['a']]);
  assert.deepEqual((await read()).seen, ['a']);
  assert.match(await (await fetch(url)).text(), /Seen by agent/);
  // Taken once: nothing of agent-a is left.
  assert.match(as({}, 'wait', file, '--filer', 'agent-a', '--timeout', '1').out, /nothing posted by agent-a is waiting/);
  // agent-b's wait sleeps through answers to other filers' items and wakes on its own.
  const waiting = spawn(process.execPath, [cli, 'wait', file, '--filer', 'agent-b', '--json', '--timeout', '20'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  let waited = '';
  waiting.stdout.on('data', (b) => (waited += b));
  const exited = new Promise((ok) => waiting.on('exit', ok));
  await new Promise((ok) => setTimeout(ok, 700));
  assert.equal((await post(url, 'api/answers', { key: 'a', answer: 'no', note: 'changed my mind' })).status, 200);
  assert.equal((await post(url, 'api/answers', { key: 'none', answer: 'yes' })).status, 200);
  await new Promise((ok) => setTimeout(ok, 700));
  assert.equal(waiting.exitCode, null, 'no answer to agent-b yet');
  assert.equal((await post(url, 'api/answers', { key: 'b', answer: 'yes' })).status, 200);
  assert.equal(await exited, 0);
  assert.deepEqual(Object.keys(JSON.parse(waited)), ['b']);
  // A changed answer is new again; SIGN_OFF_FILER names the filer for wait too.
  assert.deepEqual((await read()).seen, ['b']);
  assert.deepEqual(JSON.parse(as({ SIGN_OFF_FILER: 'agent-a' }, 'wait', file, '--json', '--timeout', '5').out).a.note, 'changed my mind');
  assert.deepEqual((await read()).seen.sort(), ['a', 'b']);
  const hooked = () => readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  for (let i = 0; i < 50 && (!existsSync(out) || hooked().length < 4); i++) await new Promise((ok) => setTimeout(ok, 100));
  // Each hook runs on its own, so their lines may land in any order.
  assert.deepEqual(hooked().map(({ key, answer, filer = '', title }) => [key, answer, filer, title].join()).sort(),
    ['a,no,agent-a,Ship A?', 'a,yes,agent-a,Ship A?', 'b,yes,agent-b,Ship B?', 'none,yes,,Ship it?']);
  assert.equal(statSync(join(dir, 'board.seen.jsonl')).mode & 0o777, 0o600);
  proc.kill();
});

test('no board named: the nearest .sign-off/ up to the repo root, else the home board; doctor checks on_answer; init and hints under npx', () => {
  const at = (cwd, more, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...env, ...more }, encoding: 'utf8' });
  const proj = join(scratch, 'walk'), deep = join(proj, 'src', 'deep'), inner = join(proj, 'inner'), items = (b) => JSON.parse(readFileSync(b, 'utf8')).items.map((i) => i.key);
  mkdirSync(deep, { recursive: true });
  mkdirSync(join(inner, '.git'), { recursive: true });
  // Hints name the board relative to the working folder, and through npx say npx -y sign-off-axi.
  assert.match(at(proj, {}, 'init').stdout, /Run `sign-off-axi post \.sign-off\/decisions\.json --type design/);
  const viaNpx = at(proj, { npm_command: 'exec' }, 'init').stdout;
  assert.match(viaNpx, /Run `npx -y sign-off-axi post \.sign-off\/decisions\.json --type design/);
  assert.doesNotMatch(viaNpx, /`sign-off-axi /);
  assert.equal(at(deep, {}, 'raise', '--title', 'From deep?').status, 0);
  assert.deepEqual(items(join(proj, '.sign-off', 'decisions.json')), ['from-deep']);
  // A folder holding .git is the repo root: the walk stops there and falls back to the home board.
  assert.equal(at(inner, {}, 'raise', '--title', 'From the inner repo?').status, 0);
  assert.deepEqual(items(join(env.HOME, '.sign-off', 'decisions.json')), ['from-the-inner-repo']);
  // on_answer runs with no shell: doctor names a missing program, a shell operator and a file that will not run.
  const doctor = (hook) => (writeFileSync(join(proj, '.sign-off', 'config.yaml'), `board: decisions.json\nport: 0\non_answer: ${hook}\n`), at(proj, {}, 'doctor'));
  assert.match(doctor('nosuch-hook').stdout, /on_answer: nosuch-hook is not a program on PATH or an executable file\. Install nosuch-hook/);
  const op = doctor('node hook.mjs > answer.txt');
  assert.equal(op.status, 1);
  assert.match(op.stdout, /on_answer: > is a shell operator, and on_answer runs with no shell, so it is passed to the program as an argument\. Put the command in a script/);
  assert.equal(doctor('node hook.mjs').status, 0);
  writeFileSync(join(proj, '.sign-off', 'save.sh'), '#!/bin/sh\n');
  assert.match(doctor('./save.sh').stdout, /on_answer: \.\/save\.sh is not a program on PATH or an executable file\. Run `chmod \+x .*save\.sh`/);
  chmodSync(join(proj, '.sign-off', 'save.sh'), 0o755);
  assert.match(doctor('./save.sh').stdout, /on_answer,runs \.\/save\.sh for each answer/);
  // Under npx -p <package>, the skill install must still run skills, not that package.
  const npx = join(bin, 'npx'), fresh = join(scratch, 'npx-p');
  writeFileSync(npx, "#!/usr/bin/env node\nconst fs = require('fs');\nif (process.env.npm_config_package) process.exit(127);\nfs.mkdirSync('.agents/skills/sign-off-axi', { recursive: true });\nfs.writeFileSync('.agents/skills/sign-off-axi/SKILL.md', '---\\nname: sign-off-axi\\n---\\n');\n");
  chmodSync(npx, 0o755);
  mkdirSync(fresh);
  const installed = at(fresh, { npm_config_package: join(scratch, 'sign-off-axi.tgz') }, 'init', '--agent', 'codex');
  rmSync(npx);
  assert.equal(installed.status, 0, installed.stdout);
  assert.match(installed.stdout, /codex,installed/);
});

test('no board named under a symlinked HOME: the walk stops at the real HOME, never its own .sign-off, and the home board takes the item', () => {
  const realHome = join(scratch, 'linked', 'real-home'), linkHome = join(scratch, 'linked', 'link-home'), proj = join(realHome, 'proj');
  mkdirSync(join(realHome, '.sign-off'), { recursive: true });
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(realHome, '.sign-off', 'config.yaml'), 'board: home-trap.json\nport: 0\n');
  symlinkSync(realHome, linkHome);
  const r = spawnSync(process.execPath, [cli, 'raise', '--title', 'From linked home'], { cwd: join(linkHome, 'proj'), env: { ...env, HOME: linkHome }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(JSON.parse(readFileSync(join(linkHome, '.sign-off', 'decisions.json'), 'utf8')).items.map((i) => i.key), ['from-linked-home']);
  assert.equal(existsSync(join(realHome, '.sign-off', 'home-trap.json')), false);
});

test('no board named: doctor checks the nearest setup from a subfolder, a missing HOME uses the working folder, and a folder named ~ is printed quoted', () => {
  const at = (cwd, more, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...env, ...more }, encoding: 'utf8' });
  const proj = join(scratch, 'doctor-walk'), deep = join(proj, 'src', 'deep');
  mkdirSync(join(proj, '.git'), { recursive: true });
  mkdirSync(deep, { recursive: true });
  assert.equal(at(proj, {}, 'init').status, 0);
  assert.match(at(deep, {}, 'doctor').stdout, /config,"board decisions\.json/);
  assert.equal(at(proj, { HOME: join(scratch, 'no-such-home') }, 'raise', '--title', 'Missing home?').status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(proj, '.sign-off', 'decisions.json'), 'utf8')).items.map((i) => i.key), ['missing-home']);
  assert.match(at(proj, {}, 'doctor', join('~', 'x')).stdout, /init '~\/x'/);
});
