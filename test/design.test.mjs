import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer, get } from 'node:http';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { asked } from './ask.mjs';

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
    return { out: execFileSync(process.execPath, [cli, ...asked(args)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env }), code: 0 };
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
  // The mock comes as written, with the pointing bridge after it.
  assert.match(await (await fetch(`${url}mock/local/pick-the-sign-in-layout~a/a.html`)).text(), /^<h1>Mock A<\/h1><script>/);
  assert.equal((await fetch(`${url}mock/local/pick-the-sign-in-layout~z/a.html`)).status, 404);
  assert.match(await (await fetch(`${url}mock/local/nav~b/index.html?variant=b`)).text(), /^<p>variant page<\/p><script>/);
  assert.equal((await post(url, 'api/rounds', { key: 'pick-the-sign-in-layout', note: '' })).status, 400);
  assert.equal((await post(url, 'api/rounds', { key: 'gone', note: 'hi' })).status, 404);
  // wait takes the rounds already asked as seen, then watches the board folder, so the round is asked once it watches, as while it waits.
  const watching = "import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module'; const { watch } = fs;"
    + " fs.watch = (...a) => { try { return watch(...a); } finally { process.stderr.write('watching'); } }; syncBuiltinESMExports();";
  const waiting = spawn('node', ['--import', `data:text/javascript,${encodeURIComponent(watching)}`, cli, 'wait', board, '--key', 'pick-the-sign-in-layout', '--timeout', '20']);
  let waited = '';
  waiting.stdout.on('data', (b) => (waited += b));
  const exited = new Promise((ok) => waiting.on('exit', ok));
  await new Promise((ok) => { waiting.stderr.on('data', (b) => /watching/.test(b) && ok()); waiting.once('exit', ok); });
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
  assert.match(run('poll', board).out, /messages\[1\]\{id,kind,key,text,at\}:\n  "?\w+"?,prompt,"","Umer: also try a dark header\."/);
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
  assert.equal(data.annotations, undefined, 'the export leaves out comments on mocks');
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
  writeFileSync(config, 'board: decisions.json\nport: 0\nbind: 0.0.0.0\n');
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
  writeFileSync(join(sod, 'config.yaml'), 'board: decisions.json\nport: 0\nowner: Umer\nmax-items: 5\n');
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
  // A call the browser never answers (a page torn down mid-call) gives undefined after 10 s, so until() asks again instead of hanging.
  const call = (method, params) => new Promise((ok) => { const id = ++seq; replies.set(id, ok); setTimeout(ok, 10000).unref(); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = (expression) => call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  // On a busy host, input sent right after a redraw can miss the sandboxed frame it aims at, so each input waits for the page to paint first.
  const painted = () => call('Runtime.evaluate', { expression: 'new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))', awaitPromise: true });
  // Headless Chrome keeps a window at least 500 px wide, so the page is set to the asked width as a phone would be.
  await call('Emulation.setDeviceMetricsOverride', { width, height: 4000, deviceScaleFactor: 1, mobile: false });
  // A real mouse click at a point of the page, which reaches into a frame there as a person's would.
  const click = async ([x, y]) => { await painted(); for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
  // A real touch tap at a point of the page, as a phone's would.
  const tap = async ([x, y]) => { await painted(); await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  return { evaluate, click, tap, close: () => { ws.close(); browser.kill(); } };
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

test('pointing at a design mock: the board turns it on for a frame, a tap comes back as a reference that finds the element again, and a message from another frame is ignored', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'point'), file = join(dir, 'board.json');
  mkdirSync(join(dir, 'mocks'), { recursive: true });
  // The button fills the frame; its own focus, touch and click handlers rename it, which must not happen while the person points.
  writeFileSync(join(dir, 'mocks', 'a.html'), '<style>body { margin: 0 }</style><main id="app"><section><button hidden>Back</button>'
    + '<button style="width: 100%; height: 3000px" ontouchstart="this.textContent = \'Touched\'" onfocus="this.textContent = \'Focused\'" onclick="this.textContent = \'Clicked\'">Sign in</button></section></main>');
  writeFileSync(file, JSON.stringify({ schema: 2, items: [{ key: 'look', type: 'design', title: 'Look', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    recommend_value: 'a', mocks: [{ value: 'a', path: 'mocks/a.html' }] }] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, click, tap, close } = await browse(dir);
  const frame = "document.querySelector('.mock iframe')", pointed = "got.filter((m) => m['sign-off'] === 'pointed')";
  // The card snaps while it scrolls, so the test scrolls the frame into view and waits until it is what sits under the middle of it, then taps there.
  const middle = async () => {
    let at;
    await until(async () => {
      at = await evaluate(`${frame}.scrollIntoView({ block: 'center' }), (({ left, top, width, height }) => [left + width / 2, top + height / 2])(${frame}.getBoundingClientRect())`);
      return at && evaluate(`new Promise((paint) => requestAnimationFrame(() => requestAnimationFrame(() => paint(document.elementFromPoint(${at}) === ${frame}))))`);
    });
    return at;
  };
  const ref = { ref: '#app > section:nth-of-type(1) > button:nth-of-type(2)', tag: 'button', text: 'Sign in' };
  await evaluate(`location.href = ${JSON.stringify(url)}`);
  await until(() => evaluate(`!!${frame}`));
  await evaluate("window.got = [], addEventListener('message', (e) => e.data?.['sign-off'] && got.push(e.data))");
  // The board's own function turns pointing on for the frame; a tap that lands before the bridge loads is simply not kept, so the test taps until it is.
  await evaluate(`point(${frame}, true)`);
  // A tap before the bridge loads reaches nothing, so the test taps until one is kept, then taps once more.
  await until(async () => (await click(await middle()), evaluate(`${pointed}.length >= 1`)));
  const kept = (await evaluate(pointed)).length;
  await click(await middle());
  await until(() => evaluate(`${pointed}.length > ${kept}`));
  // Each tap names the button as it was: the mock's own focus and click handlers did not run.
  for (const m of await evaluate(pointed)) assert.deepEqual(m, { 'sign-off': 'pointed', ...ref });
  assert.deepEqual(await evaluate("pointed.get('look~a')"), ref);
  // A message from a frame that is not a mock never changes what the board kept.
  await evaluate(`document.body.append(Object.assign(document.createElement('iframe'), { srcdoc: ${JSON.stringify("<script>parent.postMessage({ 'sign-off': 'pointed', ref: '#other', tag: 'p', text: 'Other' }, '*')</script>")} }))`);
  await until(() => evaluate("got.some((m) => m.text === 'Other')"));
  assert.deepEqual(await evaluate("pointed.get('look~a')"), ref);
  // A new load of the same mock names the same element the same way.
  await evaluate('window.old = true, location.reload()');
  await until(() => evaluate('!window.old'));
  await until(() => evaluate(`!!${frame}`));
  await evaluate(`point(${frame}, true)`);
  await until(async () => (await click(await middle()), evaluate("pointed.has('look~a')")));
  assert.deepEqual(await evaluate("pointed.get('look~a')"), ref);
  // A touch on a phone runs the mock's own touch handler no more than a click: the words stay as they were.
  await evaluate("window.got = [], addEventListener('message', (e) => e.data?.['sign-off'] && got.push(e.data))");
  await tap(await middle());
  await click(await middle());
  await until(() => evaluate(`${pointed}.length >= 1`));
  assert.deepEqual(await evaluate(`${pointed}.at(-1)`), { 'sign-off': 'pointed', ...ref });
  close();
  proc.kill();
});

test('a stored pointing reference finds its element on the mock page itself, again after a reload, and finds nothing once its words change', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'find'), file = join(dir, 'board.json');
  mkdirSync(join(dir, 'mocks'), { recursive: true });
  writeFileSync(join(dir, 'mocks', 'a.html'), '<main id="app"><section><button hidden>Back</button><button>Sign in</button></section></main>');
  writeFileSync(file, JSON.stringify({ schema: 2, items: [{ key: 'look', type: 'design', title: 'Look', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    recommend_value: 'a', mocks: [{ value: 'a', path: 'mocks/a.html' }] }] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { mockBase } = await (await fetch(`${url}api/decisions`)).json();
  const { evaluate, close } = await browse(dir);
  const ref = { ref: '#app > section:nth-of-type(1) > button:nth-of-type(2)', tag: 'button', text: 'Sign in' };
  const button = "document.querySelector('#app > section:nth-of-type(1) > button:nth-of-type(2)')";
  const same = `signOffFind(${JSON.stringify(ref)}) === ${button}`;
  await evaluate(`location.href = ${JSON.stringify(new URL(`${mockBase.slice(1)}look~a/a.html`, url).href)}`);
  await until(() => evaluate("typeof signOffFind === 'function'"));
  assert.equal(await evaluate(same), true);
  await evaluate('window.old = true, location.reload()');
  await until(() => evaluate('!window.old'));
  await until(() => evaluate("typeof signOffFind === 'function'"));
  assert.equal(await evaluate(same), true);
  assert.equal(await evaluate("signOffFind({ ref: '#app > section:nth-of-type(1)', tag: 'section', text: 'Back Sign in' }) === document.querySelector('section')"), true);
  await evaluate(`${button}.textContent = 'Log in'`);
  assert.equal(await evaluate(`signOffFind(${JSON.stringify(ref)})`), null);
  close();
  proc.kill();
});

test('comments on mock elements: one per element, kept across a reload, edited and deleted, shown only on the file they were made on; an option with no mock says so', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'annotate'), file = join(dir, 'board.json'), mockA = join(dir, 'mocks', 'a.html');
  mkdirSync(join(dir, 'mocks'), { recursive: true });
  writeFileSync(mockA, '<style>body { margin: 0 }</style><main id="app"><button style="width: 100%; height: 3000px">Sign in</button></main>');
  writeFileSync(join(dir, 'mocks', 'b.html'), '<h1>Split</h1>');
  writeFileSync(file, JSON.stringify({ schema: 2, items: [{ key: 'look', type: 'design', title: 'Look', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }],
    recommend_value: 'a', mocks: [{ value: 'a', path: 'mocks/a.html' }, { value: 'b', path: 'mocks/b.html' }] }] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, click, close } = await browse(dir);
  const frame = "document.querySelector('.mock iframe')", button = (name) => `[...document.querySelectorAll('.ann button')].find((b) => b.textContent === '${name}')`;
  const nth = (i) => `document.querySelectorAll('.mock iframe')[${i}]`;
  const middle = (i = 0) => evaluate(`${nth(i)}.scrollIntoView({ block: 'center' }), (({ left, top, width, height }) => [left + width / 2, top + height / 2])(${nth(i)}.getBoundingClientRect())`);
  const write = async (text) => {
    await evaluate(`(${button('Comment on the mocks')}).getAttribute('aria-pressed') === 'false' && (${button('Comment on the mocks')}).click()`);
    // A synthetic mouse stays aimed at the frame a redraw removed until it clicks elsewhere, so it clicks the page first.
    // A tap before the frame's bridge loads reaches nothing, so the test taps until the editor opens.
    await click([1, 1]);
    await until(async () => (await click(await middle()), evaluate("!!document.getElementById('ann-text-look')")));
    const before = await evaluate("document.getElementById('ann-text-look').value");
    await evaluate(`(document.getElementById('ann-text-look').value = ${JSON.stringify(text)}, (${button('Save comment')}).click())`);
    await until(() => evaluate(`state.annotations?.some((a) => a.text === ${JSON.stringify(text)})`));
    return before;
  };
  const reload = async () => { await evaluate(`window.old = true, location.href = ${JSON.stringify(url)}`); await until(() => evaluate(`!window.old && !!${frame}`)); };
  await reload();
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.shot.none')].map((n) => n.textContent)"), ['No mock for this option']);
  assert.equal(await write('Make this button green, Umer'), '');
  // While commenting, a tap that reaches the board instead of the frame, as one on its edge does, never opens the mock full size.
  assert.equal(await evaluate(`${nth(0)}.parentElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`), false);
  const [saved] = await evaluate('state.annotations');
  assert.deepEqual({ ...saved, id: '', at: '' }, { id: '', at: '', key: 'look', mock: 'a', hash: createHash('sha256').update(readFileSync(mockA)).digest('hex'),
    ref: '#app > button:nth-of-type(1)', tag: 'button', words: 'Sign in', text: 'Make this button green, Umer' });
  await reload();
  assert.match(await evaluate("document.querySelector('.ann li').textContent"), /A · button “Sign in”Make this button green, Umer/);
  // The same element again opens its comment, and saving edits it: still one comment.
  assert.equal(await write('Make it blue'), 'Make this button green, Umer');
  assert.deepEqual((await evaluate('state.annotations')).map((a) => [a.id, a.text]), [[saved.id, 'Make it blue']]);
  // Words typed and not saved stay with their element: tapping another element and back brings them back.
  const box = "document.getElementById('ann-text-look')", label = "document.querySelector('.ann label').textContent";
  const aim = async (i, name) => { await click([1, 1]); await until(async () => (await click(await middle(i)), evaluate(`!!${box} && ${label}.startsWith(${JSON.stringify(name)})`))); };
  const type = (text) => `${box}.value = ${JSON.stringify(text)}, ${box}.dispatchEvent(new Event('input'))`;
  await aim(0, 'Comment on A');
  await evaluate(type('Not saved yet'));
  await aim(1, 'Comment on B');
  assert.equal(await evaluate(`${box}.value`), '');
  await aim(0, 'Comment on A');
  assert.equal(await evaluate(`${box}.value`), 'Not saved yet');
  // Save, and at once B's element is named, as its mock does on a tap: when the save lands, B's editor stays open with its words.
  await evaluate(`(${button('Save comment')}).click(), dispatchEvent(new MessageEvent('message', { source: ${nth(1)}.contentWindow,
    data: { 'sign-off': 'pointed', ref: 'body > h1:nth-of-type(1)', tag: 'h1', text: 'Split' } })), ${type('Typed while saving')}`);
  await until(() => evaluate("state.annotations.some((a) => a.text === 'Not saved yet')"));
  assert.deepEqual(await evaluate(`[${label}, ${box}.value]`), ['Comment on B · h1 “Split”', 'Typed while saving']);
  await evaluate(`(${button('Cancel')}).click()`);
  await evaluate(`(${button('Edit')}).click()`);
  await until(() => evaluate("!!document.getElementById('ann-text-look')"));
  await evaluate(`(${button('Delete')}).click()`);
  await until(() => evaluate("state.annotations.length === 0 && !document.querySelector('.ann li') && !document.getElementById('ann-text-look')"));
  // A comment made on one file shows only on that file: overwritten, the mock shows none, and a mock file gone shows the placeholder.
  await write('Keep the words');
  writeFileSync(mockA, '<button style="width: 100%; height: 3000px">Sign in</button>');
  rmSync(join(dir, 'mocks', 'b.html'));
  await reload();
  assert.deepEqual(await evaluate("[state.annotations.length, document.querySelectorAll('.ann li').length, document.querySelectorAll('.shot.none').length]"), [1, 0, 2]);
  assert.equal(await evaluate("document.querySelector('.ann > p.meta:last-of-type').textContent"), '1 comment on an earlier version of “A” is hidden');
  // The pick takes the comments on the file shown now, each with its element, to the agent; the hidden one stays behind.
  const status = (path, body) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
  await write('Make the words bigger');
  assert.equal(await status('api/answers', { key: 'look', answer: 'a' }), 200);
  const [sent] = JSON.parse(run('wait', file, '--key', 'look', '--json', '--timeout', '5').out).look.comments;
  assert.deepEqual({ ...sent, id: '' }, { id: '', mock: 'a', hash: createHash('sha256').update(readFileSync(mockA)).digest('hex'), ref: 'body > button:nth-of-type(1)', tag: 'button', words: 'Sign in', text: 'Make the words bigger' });
  // Sent, it is the agent's: listed without Edit or Delete, and the server refuses to change it. The picked card is under Answered.
  await evaluate("window.old = true, location.hash = 'answered', location.reload()");
  await until(() => evaluate("!window.old && !!document.querySelector('details.done') && (document.querySelector('details.done').open = true)"));
  assert.deepEqual(await evaluate(`[[...document.querySelectorAll('.ann p.meta')].map((p) => p.textContent).includes('Sent to the agent'), !!(${button('Edit')})]`), [true, false]);
  assert.equal(await status('api/annotations', { id: sent.id, deleted: true }), 409);
  // The mock changes after the pick: the sent comment stays listed, and is not counted as hidden.
  writeFileSync(mockA, '<button style="width: 100%; height: 3000px">Changed</button>');
  await evaluate("window.old = true, location.reload()");
  await until(() => evaluate("!window.old && !!document.querySelector('details.done') && (document.querySelector('details.done').open = true)"));
  assert.deepEqual(await evaluate(`[[...document.querySelectorAll('.ann p.meta')].some((p) => p.textContent === 'Sent to the agent'), [...document.querySelectorAll('.ann p.meta')].filter((p) => /hidden/.test(p.textContent)).map((p) => p.textContent)]`), [true, ['1 comment on an earlier version of “A” is hidden']]);
  // The same element again is a new draft, and Another round with no note carries only it.
  assert.equal(await write('Bigger still'), '');
  assert.equal(await status('api/rounds', { key: 'look', note: '' }), 200);
  assert.deepEqual(JSON.parse(run('answers', file, '--json').out).look.rounds[0].comments.map((c) => c.text), ['Bigger still']);
  assert.match(run('answers', file).out, /comments\[2\]\{key,mock,ref,tag,words,text\}:\n\s+look,a,"body > button:nth-of-type\(1\)",button,Sign in,Make the words bigger\n\s+look,a,.*Bigger still/);
  close();
  // A later pick supersedes the answer, but the comments it carried still reach the agent.
  assert.equal(await status('api/answers', { key: 'look', answer: 'b' }), 200);
  const later = JSON.parse(run('answers', file, '--key', 'look', '--json').out).look;
  assert.deepEqual([later.answer, later.comments.map((c) => c.text)], ['b', ['Make the words bigger']]);
  // The page asks nothing the server takes on trust: no text, an option with no page, and a read-only board are refused.
  const post = (body) => fetch(`${url}api/annotations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
  const current = createHash('sha256').update(readFileSync(mockA)).digest('hex');
  const one = { key: 'look', mock: 'a', ref: '#app', tag: 'main', words: '', text: 'Hi', hash: current };
  assert.deepEqual([await post({ ...one, text: ' ' }), await post({ ...one, mock: 'c' }), await post({ id: 'nope', deleted: true }), await post({ ...one, hash: 'an older file' }), await post({ ...one, id: saved.id })], [400, 404, 404, 409, 404]);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), readonly: true }));
  assert.equal(await post(one), 403);
  // Nor do the sent answers and rounds carry their comments to it.
  const ro = await fetch(`${url}api/decisions`).then((r) => r.json());
  assert.deepEqual([ro.annotations, ro.answers.look.comments, ro.rounds[0].comments], [[], undefined, undefined]);
  proc.kill();
});

test('each card has one place to type: Other answer holds the reply, Another round and the comment, and no separate note link; a report opens full screen and back', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'one-box'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const abc = ['A', 'B', 'C'].map((l) => ({ value: l.toLowerCase(), label: l }));
  const nine = new Date(new Date().setHours(9, 15, 0, 0)).toISOString();
  // A report is the page report init writes, filled in; a text-only report stored before reports had pages is a note, never a report card.
  assert.equal(run('report', 'init', join(dir, 'mocks', 'how')).code, 0);
  for (const f of ['index.html', 'preview.svg']) writeFileSync(join(dir, 'mocks', 'how', f), readFileSync(join(dir, 'mocks', 'how', f), 'utf8').replace(/FILL: [^<"']*/g, 'Umer taps through it'));
  writeFileSync(file, JSON.stringify({ schema: 2, items: [{ key: 'ship', title: 'When should it ship?', options: abc, recommend_value: 'b', filed: nine },
    { key: 'look', type: 'design', title: 'Pick the look', options: abc, recommend_value: 'b', filed: nine },
    { contract: 1, kind: 'report', schema: 1, key: 'merged', title: 'Merged: the sign-in fix', about: 'Checks passed.', filed: nine },
    { contract: 1, kind: 'report', schema: 2, key: 'how', title: 'How it ships', group: 'How it works', filed: new Date().toISOString(), decided: 'Ships only when the check passes.',
      view: 'mocks/how/index.html', preview: 'mocks/how/preview.svg', steps: [{ title: 'Build', marks: ['store'] }, { title: 'Check' }, { title: 'Ship', marks: ['gate', 'fail'] }] }] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const dump = (hash) => new Promise((ok, no) => execFile(chrome, ['--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${join(dir, 'profile')}`,
    '--window-size=800,4000', '--virtual-time-budget=10000', '--dump-dom', url + hash], { env: chromeEnv, maxBuffer: 1 << 24 }, (e, out) => (e ? no(e) : ok(out))));
  const cards = (dom) => [...dom.matchAll(/<article class="row[^"]*" id="item-(\w+)">(.*?)<\/article>/gs)].map((m) => [m[1], m[2]]);
  // Waiting on you is Triage: the newest ask alone (the file's last item), with the queue of both beside it and Skip to the next.
  const waiting = await dump('#waiting');
  assert.deepEqual(cards(waiting).map(([key]) => key), ['look']);
  assert.match(waiting, /1 of 2/);
  // Above it, the type chips with their counts (All first, the one on, then each type present) and the sort on Newest first.
  assert.match(waiting, /<div class="filters"><div class="chips" role="group" aria-label="Filter by type"><button aria-pressed="true">All 2<\/button><button aria-pressed="false">Design pick 1<\/button><button aria-pressed="false">Pick one 1<\/button><\/div><label class="sort">Sort<select aria-label="Sort waiting questions"><option value="newest">Newest first<\/option><option value="oldest">Oldest first<\/option><\/select><\/label><\/div>/);
  assert.match(waiting, /<div class="pbar"[^>]*><i[^>]*><\/i><\/div><p class="meta since">Waiting since 09:15<\/p>/);
  assert.equal(waiting.match(/<ol class="queue"[^>]*>.*?<\/ol>/s)[0].match(/<button/g).length, 2);
  // Under the ask, Skip for now and Dismiss sit side by side; the ask has no × of its own.
  assert.match(waiting, /<div class="quiet"><button class="skip">Skip for now<\/button><button class="dis" aria-label="Dismiss, Pick the look">Dismiss<\/button><\/div>/);
  assert.doesNotMatch(waiting.match(/<div class="focus">.*?<\/article>/s)[0], /class="x"/);
  // Needs you first ends with Dismiss on the left and the way to Triage on the right; its card has no × of its own.
  const home = await dump('');
  assert.match(home, /<div class="foot"><button class="dis" aria-label="Dismiss, Pick the look">Dismiss<\/button><a class="more" href="#waiting">Answer all 2 in Triage →<\/a><\/div>/);
  assert.doesNotMatch(home.match(/<section class="card needs.*?<\/section>/s)[0], /class="x"/);
  // Under its heading, when that ask was raised.
  assert.match(home, /<h2>Needs you first<\/h2><p class="meta since">Waiting since 09:15<\/p><article class="row design" id="item-look">/);
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
  // Only the design ask waits now, and its filed time is the tile's oldest.
  assert.match(pages[''], /<a class="tile i-waiting".*?<span class="detail" dir="auto">Oldest 09:15<\/span>/s);
  // Restore puts it back in Triage (behind the ask in focus) through the same dismiss log, and the row goes once nothing is dismissed.
  const { evaluate, close } = await browse(join(dir, 'live'));
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  await until(async () => (await evaluate('document.querySelector(".fhead")?.textContent')) === '1 of 1');
  await evaluate('document.querySelector(".gone-asks .dis").click()');
  await until(async () => (await evaluate('!document.querySelector(".gone-asks") && document.querySelector(".fhead").textContent')) === '1 of 2');
  close();
  assert.deepEqual(readFileSync(gone, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map(({ key, dismissed }) => [key, dismissed]), [['ship', true], ['ship', false]]);
  // Reports and explainers says what the page is under its title, draws a report's steps as numbered nodes, each with only the marks it lists, and the legend once.
  const reports = await dump('#reports');
  assert.match(reports, /<p class="lede">How the tools work, step by step\. Tap one to open it\.<\/p>/);
  assert.equal(reports.match(/class="card legend"/g).length, 1);
  const flow = reports.match(/<ol class="flow"[^>]*>(.*?)<\/ol>/s)[1];
  assert.deepEqual([...flow.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => [...m[1].matchAll(/mk mk-(\w+)/g)].map((x) => x[1])), [['store'], [], ['gate', 'fail']]);
  assert.match(reports, /3 steps.*>Open ›</s);
  // Its group heads a section with the filed time; the card says New today over its title, a link that opens it, then what it decided.
  assert.match(reports, /<div class="sec-h"><h2>How it works<\/h2><span class="meta">Filed \d\d:\d\d today<\/span>/);
  assert.match(reports, /<span class="st new">New today<\/span><\/p><h3 dir="auto"><a href="#reports\/how">How it ships<\/a><\/h3>.*<span class="lbl">What it decided<\/span>Ships only when the check passes\./s);
  // Only the report is a card and counted; the text-only one is folded under Notes, a short row with no page to open.
  assert.deepEqual([...reports.matchAll(/<article class="card report[^"]*" id="item-(\w+)"/g)].map((m) => m[1]), ['how']);
  // The sidebar counts it under its short name; the phone's tab bar marks Reports as the area on screen and reads its count.
  assert.match(reports, /<\/svg><\/span>Reports<span class="n">1<\/span>/);
  assert.match(reports, /<a href="#reports" aria-label="Reports and explainers, 1" aria-current="page"><span class="icon i-reports" aria-hidden="true">.*?<\/span>Reports<\/a>/);
  assert.match(reports, /<details class="other notes"><summary>Notes \(1\)<\/summary>.*<strong dir="auto">Merged: the sign-in fix<\/strong>/s);
  // On a phone, a tap on the card opens the report over the whole board with the focus on its title; the board under it takes no taps.
  // ‹ Reports goes back to the card with the focus on its link, and Escape closes it too.
  {
    const { evaluate, tap, close } = await browse(join(dir, 'reader'), 390);
    await evaluate(`location.href = ${JSON.stringify(`${url}#reports`)}`);
    await until(async () => (await evaluate('document.querySelector("#item-how .thumb, #item-how .flow") && innerWidth')) === 390);
    const at = (sel) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    await tap(await at('#item-how .about, #item-how .decided'));
    await until(async () => (await evaluate('location.hash')) === '#reports/how');
    // The hash lands before its handler draws the reader, so wait for the drawn reader itself, not just the hash.
    let open;
    await until(async () => (open = await evaluate(`(() => { const f = reader.querySelector('iframe').getBoundingClientRect(); return { hidden: reader.hidden, title: document.activeElement.textContent,
      inert: document.querySelector('main').inert, src: reader.querySelector('iframe').getAttribute('src'), sandbox: reader.querySelector('iframe').getAttribute('sandbox'),
      frame: [f.x, f.width, Math.round(f.bottom) === innerHeight], back: reader.querySelector('a').textContent }; })()`))?.src === '/mock/local/how~/index.html');
    assert.deepEqual(open, { hidden: false, title: 'How it ships', inert: true, src: '/mock/local/how~/index.html', sandbox: 'allow-scripts', frame: [0, 390, true], back: '‹ Reports' });
    // The page itself is served: the filled scaffold, with its steps to tap.
    assert.match(await (await fetch(new URL('/mock/local/how~/index.html', url))).text(), /<button type="button" class="next">Next<\/button>/);
    await tap(await at('#reader .close'));
    await until(async () => (await evaluate('location.hash + reader.hidden')) === '#reportstrue');
    assert.deepEqual(await evaluate('[document.activeElement.getAttribute("href"), document.querySelector("main").inert, document.body.className]'), ['#reports/how', false, '']);
    await evaluate('location.hash = "#reports/how"');
    await until(async () => (await evaluate('reader.hidden')) === false);
    await evaluate('dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
    await until(async () => (await evaluate('location.hash + reader.hidden')) === '#reportstrue');
    close();
  }
  // Answered is Done today: a count under the title, Clear all done on the section head, and a short row per item with its answer and time under the title, beside its ×.
  writeFileSync(file.replace(/\.json$/, '.answers.jsonl'), ['ship', 'look'].map((key) => JSON.stringify({ key, answer: 'a', label: 'A', close: 'done', at: new Date().toISOString() })).join('\n') + '\n');
  // Once both are answered, the Answered tile has a check for each and Waiting on you no clock.
  const after = await dump('');
  assert.deepEqual([vis(after, 'answered').match(/class="icon i-\w+"/g), vis(after, 'waiting')], [['class="icon i-answered"', 'class="icon i-answered"'], '']);
  const answered = await dump('#answered');
  assert.match(answered, /<p class="lede">2 answered today\.<\/p><\/header><div class="sec-head"><h2>Done today<\/h2><button class="clear">Clear all done<\/button><\/div>/);
  const lines = [...answered.matchAll(/<summary class="compact">.*?<strong[^>]*>(.*?)<\/strong>.*?<span class="ans"><b[^>]*>(\w+)<\/b><time>\d\d:\d\d<\/time><\/span><\/span><\/summary>.*?<\/details><button class="x" aria-label="Dismiss, [^"]+">×<\/button>/gs)];
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

test('a sign-in card: posted on top of what waits with its link and time left, the link expires on the page, a new link under the same key opens it again, and signin done closes it, all without a reload; a start command makes the link at tap time and its exit 0 closes the card', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'signin'), file = join(dir, 'board.json'), link = 'https://example.com/login?code=one-time-1';
  mkdirSync(dir);
  assert.equal(run('raise', file, '--title', 'Keep the weekly digest?', '--recommend', 'yes').code, 0);
  const signin = (key, service, url, expires) => run('post', file, '--type', 'signin', '--key', key, '--service', service, '--link', url, '--unlocks', `Publish ${service}`, '--waits', 'Main', '--expires', expires);
  const posted = signin('npm-login', 'npm', link, '15m');
  assert.equal(posted.code, 0);
  // A sign-in link can hold a one-time code: no output prints it.
  assert.match(posted.out, /npm-login,posted,npm,/);
  assert.doesNotMatch(posted.out, /one-time|example\.com/);
  assert.match(signin('gh-login', 'GitHub', 'https://example.com/device?code=one-time-2', '3s').out, /gh-login,posted,GitHub,/);
  // Only an http(s) link with no user name or password in it, and a time still to come.
  for (const [url, expires] of [['ftp://example.com/login', '15m'], ['https://user:pw@example.com/login', '15m'], ['https://example.com/login', '2020-01-01T00:00:00Z']]) assert.equal(signin('bad', 'npm', url, expires).code, 2);
  assert.equal(run('signin', 'done', file, '--key', 'missing').code, 1);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'live'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  // A sign-in blocks someone now, so both come before the question, newest first among them.
  const queue = () => evaluate('[...document.querySelectorAll(".queue strong")].map((s) => s.textContent).join("|")');
  await until(async () => (await queue()) === 'GitHub|npm|Keep the weekly digest?');
  const card = (key) => evaluate(`(() => { const c = document.getElementById("item-${key}"), o = c?.querySelector(".open-link");
    return c && [c.querySelector("h3").textContent, ...[...c.querySelectorAll(".line, .expiry, .meta")].map((p) => p.textContent), o ? [o.tagName, o.getAttribute("href"), o.target, o.rel, o.disabled].join(" ") : "no open"].join("|"); })()`);
  // Triage shows the card in focus: the GitHub sign-in is newest, so the npm one is tapped in the queue first.
  await until(async () => (await evaluate('[...document.querySelectorAll(".queue button")].find((b) => b.textContent.startsWith("npm"))?.click() ?? true')) && (await card('npm-login')) !== null);
  assert.equal(await card('npm-login'), `npm|Unlocks: Publish npm|Waits: Main|Expires in 15 min|A ${link} _blank noopener noreferrer `);
  // The page is not loaded again from here on: a mark set now is still there at the end.
  await evaluate('window.stillHere = true');
  // Past its time the link expires on the page: it says so plainly and Open is off.
  await until(async () => (await evaluate('[...document.querySelectorAll(".queue button")].find((b) => b.textContent.startsWith("GitHub"))?.click() ?? true')) && /^GitHub/.test(await card('gh-login') ?? ''));
  await until(async () => (await card('gh-login')) === 'GitHub|Unlocks: Publish GitHub|Waits: Main|Link expired. Ask for a new link.|BUTTON    true');
  // The same key with a new link puts it on the same card, open again.
  assert.match(signin('gh-login', 'GitHub', 'https://example.com/device?code=one-time-3', '10m').out, /gh-login,new link,GitHub,/);
  await until(async () => (await card('gh-login')) === 'GitHub|Unlocks: Publish GitHub|Waits: Main|Expires in 10 min|A https://example.com/device?code=one-time-3 _blank noopener noreferrer ');
  // signin done closes a card: it leaves what waits and shows as done.
  assert.match(run('signin', 'done', file, '--key', 'npm-login').out, /npm-login,done,npm/);
  assert.match(run('signin', 'done', file, '--key', 'npm-login').out, /npm-login,already done,npm/);
  await until(async () => (await queue()) === 'GitHub|Keep the weekly digest?');
  assert.match(run('answers', file).out, /npm-login,done,/);
  await evaluate('location.hash = "#answered"');
  await until(async () => /npm\s*Signed in/.test(await evaluate('document.querySelector("ul.i-answered")?.textContent') ?? ''));
  assert.equal(await evaluate('window.stillHere'), true);
  // A new link after done is a new sign-in: the card waits again.
  signin('npm-login', 'npm', 'https://example.com/login?code=one-time-4', '15m');
  assert.match(run('list', file).out, /npm-login,npm/);
  // A start command makes the link at tap time: Open runs it on this host, and the new tab goes to the first https link it prints on stdout,
  // not a notice link it prints on stderr first, as npm login does.
  const starts = (key, script) => run('post', file, '--type', 'signin', '--key', key, '--service', key, '--unlocks', 'Publish', '--waits', 'Main',
    '--start', JSON.stringify(['node', '-e', script]));
  assert.match(starts('fresh', 'console.error("Notice: see https://example.com/notice"); console.log("Open https://example.com/login?x=1"); setInterval(() => require("fs").existsSync("signed-in") && process.exit(0), 100)').out, /fresh,posted,fresh/);
  assert.match(starts('broken', 'process.exit(3)').out, /broken,posted,broken/);
  assert.equal(run('post', file, '--type', 'signin', '--key', 'fresh', '--service', 'x', '--unlocks', 'a', '--waits', 'b', '--start', 'npm login').code, 2);
  // The page never gets the command, only that a tap makes a new link.
  assert.equal((await (await fetch(`${url}api/decisions`)).json()).decisions.find((d) => d.key === 'fresh').start, true);
  await evaluate(`window.open = () => ({ close() {}, location: { set href(u) { window.tabUrl = u; } } })`);
  // Triage shows one card at a time: tap the key in its queue first.
  const show = (key) => until(async () => evaluate(`[...document.querySelectorAll(".queue button")].find((b) => b.textContent.startsWith("${key}"))?.click() ?? true`)
    .then(() => evaluate(`!!document.querySelector("#item-${key} .open-link")`)));
  const tapOpen = async (key) => { await show(key); await evaluate(`document.querySelector("#item-${key} .open-link").click()`); };
  const line = (key) => evaluate(`document.querySelector("#item-${key} .expiry, #item-${key} .meta")?.textContent`);
  await evaluate('location.hash = "#waiting"');
  await show('fresh');
  assert.equal(await line('fresh'), 'Each tap gets a new link.');
  await tapOpen('fresh');
  await until(async () => (await evaluate('window.tabUrl')) === 'https://example.com/login?x=1' && (await line('fresh')) === 'The sign-in page is open. Finish it there.');
  // A second tap while it runs gives the same link from the same run.
  assert.equal((await (await post(url, 'api/signin', { key: 'fresh' })).json()).open, 'https://example.com/login?x=1');
  // A run that fails says why on the card, and Open stays on to try again.
  await tapOpen('broken');
  await until(async () => (await line('broken')) === 'The last try failed: It stopped with exit code 3. Tap Open to try again.');
  assert.equal(await evaluate('document.querySelector("#item-broken .open-link").disabled'), false);
  // Its exit 0 is the sign-in done: the card closes by itself.
  writeFileSync(join(dir, 'signed-in'), '');
  await until(async () => /fresh,done,/.test(run('answers', file).out) && !(await queue()).includes('fresh'));
  assert.equal(await evaluate('window.stillHere'), true);
  close();
  proc.kill();
});

// Waiting on you: each ask names its type, the type chips filter the list and count each type, and the list reads newest first until the
// viewer picks oldest first, which the browser keeps. On a phone, the chips and the sort sit above the one ask in focus.
test('Waiting on you: a type label on each ask, type chips with counts, and the order newest first or oldest first kept per browser', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'types'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'digest', title: 'Keep the weekly digest?', options: yesNo, recommend_value: 'yes' },
    { key: 'release', title: 'Which day for release?', options: ['today', 'friday', 'next-week'].map((v) => ({ value: v, label: v })), recommend_value: 'friday' },
    { key: 'look', type: 'design', title: 'Pick the look', options: ['a', 'b', 'c'].map((v) => ({ value: v, label: v.toUpperCase() })), recommend_value: 'b' },
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  const chips = () => evaluate('[...document.querySelectorAll(".chips button")].map((b) => b.textContent + (b.getAttribute("aria-pressed") === "true" ? "*" : "")).join("|")');
  const queue = () => evaluate('[...document.querySelectorAll(".queue strong")].map((s) => s.textContent).join("|")');
  const fhead = () => evaluate('document.querySelector(".fhead")?.textContent');
  const pick = (label) => evaluate(`[...document.querySelectorAll(".chips button")].find((b) => b.textContent.startsWith("${label}"))?.click() ?? true`);
  // Newest first by default: the file's last ask leads, with its type on its card.
  await until(async () => (await fhead()) === '1 of 3');
  assert.equal(await queue(), 'Pick the look|Which day for release?|Keep the weekly digest?');
  assert.equal(await evaluate('document.querySelector(".focus .eyebrow")?.textContent'), 'Design pick');
  assert.equal(await chips(), 'All 3*|Design pick 1|Yes/No 1|Pick one 1');
  // One type at a time: Yes/No leaves the one yes/no ask, and All brings the rest back.
  await until(async () => (await pick('Yes/No')) && (await queue()) === 'Keep the weekly digest?');
  assert.equal(await chips(), 'All 3|Design pick 1|Yes/No 1*|Pick one 1');
  assert.equal(await fhead(), '1 of 1');
  await until(async () => (await pick('All')) && (await queue()) === 'Pick the look|Which day for release?|Keep the weekly digest?');
  // Oldest first is one choice away, and it stays after a reload in this browser.
  await evaluate('(() => { const s = document.querySelector(".sort select"); s.value = "oldest"; s.dispatchEvent(new Event("change")); })()');
  await until(async () => (await queue()) === 'Keep the weekly digest?|Which day for release?|Pick the look'
    && (await evaluate('localStorage.getItem("sign-off-waiting-sort")')) === 'oldest');
  await evaluate('location.reload()');
  await until(async () => (await evaluate('document.querySelector(".sort select")?.value')) === 'oldest');
  assert.equal(await evaluate('document.querySelector(".sort select").value'), 'oldest');
  assert.equal(await evaluate('document.querySelector(".focus h3")?.textContent'), 'Keep the weekly digest?');
  // A type chip narrows this visit only: ‹ Summary and back through the way to Triage opens everything its count promises, in All again.
  await until(async () => (await pick('Yes/No')) && (await queue()) === 'Keep the weekly digest?');
  await evaluate('document.querySelector(".back").click()');
  await until(async () => (await evaluate('document.querySelector(".needs a.more")?.textContent')) === 'Answer all 3 in Triage →');
  await evaluate('document.querySelector(".needs a.more").click()');
  await until(async () => (await fhead()) === '1 of 3');
  assert.equal(await queue(), 'Keep the weekly digest?|Which day for release?|Pick the look');
  assert.equal(await chips(), 'All 3*|Design pick 1|Yes/No 1|Pick one 1');
  // The same reset lands a Summary tap on the very ask tapped, even one the chip had filtered out.
  await until(async () => (await pick('Yes/No')) && (await queue()) === 'Keep the weekly digest?');
  await evaluate('document.querySelector(".back").click()');
  await until(async () => (await evaluate('!!document.querySelector(".needs a.more")')));
  await evaluate('[...document.querySelectorAll(".areas .i-waiting a.compact")].find((a) => a.textContent.includes("Pick the look")).click()');
  await until(async () => (await evaluate('document.querySelector(".focus h3")?.textContent')) === 'Pick the look');
  // A posted plan waits with the asks: its card gives the title, its counts and one Open plan, which opens its page over the board with the pointing script.
  const fixture = new URL('../fixtures/contract/plan.v1/', import.meta.url).pathname;
  mkdirSync(join(dir, 'page'));
  writeFileSync(join(dir, 'page', 'index.html'), readFileSync(join(fixture, 'page', 'index.html')));
  assert.equal(run('post', file, '--kind', 'plan', '--from', join(fixture, 'valid-full.json')).code, 0);
  await evaluate('location.reload()');
  await until(async () => (await chips()) === 'All 4*|Design pick 1|Plan 1|Yes/No 1|Pick one 1');
  await until(async () => (await pick('Plan')) && (await queue()) === 'Show plans on the board');
  assert.equal(await evaluate('document.querySelector(".focus .eyebrow").textContent + "|" + document.querySelector(".focus .plan .meta").textContent'), 'Plan|5 sections · 2 decisions');
  // On a 390 px phone the title and Open plan fit with nothing to scroll sideways.
  assert.equal(await evaluate('document.documentElement.scrollWidth <= 390 && document.querySelector(".focus .open-link").getBoundingClientRect().right <= 390'), true);
  // A plan waits until it is sent back, so it has no Dismiss on its card or in Triage.
  assert.equal(await evaluate('!document.querySelector("#board .plan .x, #board .plan .dis, #board .quiet .dis")'), true);
  assert.equal(await evaluate('fetch("api/dismiss", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys: ["plan-kind-board"], dismissed: true }) }).then((r) => r.status)'), 400);
  assert.equal(existsSync(file.replace(/\.json$/, '.dismissed.jsonl')), false);
  await evaluate('document.querySelector(".focus .open-link").click()');
  await until(async () => (await evaluate('location.hash + "|" + document.querySelector("#reader iframe")?.title')) === '#waiting/plan-kind-board|Plan: Show plans on the board');
  await until(async () => await evaluate('document.querySelector("#reader .plan-view")?.clientHeight > 352'));
  assert.equal(await evaluate('document.querySelector(".plan-scroll").getBoundingClientRect().bottom <= document.querySelector(".plan-send").getBoundingClientRect().top'), true);
  assert.equal(await evaluate('document.querySelector(".plan-summary").textContent.includes("5 sections") && document.querySelector(".plan-next").textContent === "Go to next"'), true);
  await evaluate('document.querySelector(".plan-next").click()');
  await evaluate('document.querySelector(".plan-next").click()');
  const view = await evaluate('fetch(document.querySelector("#reader iframe").src).then(async (r) => [r.headers.get("content-security-policy"), await r.text()])');
  assert.match(view[0], /connect-src 'none'.*sandbox allow-scripts$/);
  // The way back leads to Waiting on you with the plan still shown, and the focus on its Open plan.
  await evaluate('document.querySelector("#reader .close").click()');
  await until(async () => (await evaluate('location.hash + "|" + document.activeElement.textContent')) === '#waiting|Open plan');
  // Review through the real controls: a Change must have a note, drafts survive reload, and Send back returns every answer.
  await evaluate('document.querySelector(".focus .open-link").click()');
  await until(async () => await evaluate('!!document.querySelector(".plan-send .open-link:disabled")'));
  await evaluate('document.querySelectorAll(".plan-verdicts .approve").forEach((b) => b.click()); document.querySelector(".plan-verdicts .change").click(); document.querySelectorAll(".plan-decision .choices").forEach((c) => c.querySelector("button").click())');
  assert.equal(await evaluate('document.querySelector(".plan-send .open-link").disabled'), true);
  await evaluate('(() => { const t = document.querySelector(".plan-section textarea"); t.value = "Keep the desktop layout too."; t.dispatchEvent(new Event("input")); })()');
  await evaluate('location.reload()');
  await until(async () => await evaluate('document.querySelector(".plan-section textarea")?.value === "Keep the desktop layout too."'));
  assert.equal(await evaluate('document.querySelector(".plan-send .open-link").disabled'), false);
  await evaluate('document.querySelector(".plan-send .open-link").click()');
  await until(async () => await evaluate('!!document.querySelector(".plan-sent")'));
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".plan-scroll")).marginBottom'), '0px');
  const sent = JSON.parse(run('answers', file, '--json').out)['plan-kind-board'];
  assert.deepEqual(sent.notes[0], { section: 'goals', verdict: 'change', note: 'Keep the desktop layout too.' });
  assert.deepEqual(sent.decisions, { 'send-back': 'one', where: 'waiting' });
  assert.equal(sent.notes.slice(1).every((n) => n.verdict === 'approve'), true);
  assert.equal(await evaluate('[...document.querySelectorAll(".plan-verdicts button, .plan-decision button")].every((b) => b.disabled)'), true);
  // Clear all done on Answered clears the answered ask and the sent-back plan too.
  assert.equal(await evaluate("fetch('api/answers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'digest', answer: 'yes' }) }).then((r) => r.status)"), 200);
  assert.equal(await evaluate('fetch("api/dismiss", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys: ["plan-kind-board"], dismissed: true }) }).then((r) => r.status)'), 200);
  assert.equal(await evaluate('fetch("api/dismiss", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys: ["plan-kind-board"], dismissed: false }) }).then((r) => r.status)'), 200);
  const answeredTitles = 'Array.from(document.querySelectorAll("ul.i-answered strong"), (s) => s.textContent).join("|")';
  await evaluate("location.hash = '#answered'");
  await until(async () => (await evaluate(answeredTitles)).includes('Keep the weekly digest?') && (await evaluate(answeredTitles)).includes('Show plans on the board'));
  await evaluate('document.querySelector(".clear").click()');
  await until(async () => (await evaluate(answeredTitles)) === '');
  close();
  proc.kill();
});

// Waiting on you sorts by when each ask was filed, not by where it sits in the file: an ask re-filed later leads the newest-first list.
test('Waiting on you: newest and oldest first follow each ask\'s filed time, and an ask with no filed time keeps its place in the file', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'filed-sort'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'relinked', title: 'Relinked ask', options: yesNo, recommend_value: 'yes', filed: '2026-10-17T10:00:00Z' },
    { key: 'plain', title: 'Plain ask', options: yesNo, recommend_value: 'yes' },
    { key: 'older', title: 'Older ask', options: yesNo, recommend_value: 'yes', filed: '2026-10-17T09:00:00Z' },
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  const queue = () => evaluate('[...document.querySelectorAll(".queue strong")].map((s) => s.textContent).join("|")');
  await until(async () => (await queue()) === 'Plain ask|Relinked ask|Older ask');
  await evaluate('(() => { const s = document.querySelector(".sort select"); s.value = "oldest"; s.dispatchEvent(new Event("change")); })()');
  await until(async () => (await queue()) === 'Older ask|Relinked ask|Plain ask');
  close();
  proc.kill();
});

test('Waiting on you: a board with no filed times lists newest first as the file reversed and oldest first as the file', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'unfiled-sort'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'first', title: 'First ask', options: yesNo, recommend_value: 'yes' },
    { key: 'second', title: 'Second ask', options: yesNo, recommend_value: 'yes' },
    { key: 'third', title: 'Third ask', options: yesNo, recommend_value: 'yes' },
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  const queue = () => evaluate('[...document.querySelectorAll(".queue strong")].map((s) => s.textContent).join("|")');
  await until(async () => (await queue()) === 'Third ask|Second ask|First ask');
  await evaluate('(() => { const s = document.querySelector(".sort select"); s.value = "oldest"; s.dispatchEvent(new Event("change")); })()');
  await until(async () => (await queue()) === 'First ask|Second ask|Third ask');
  close();
  proc.kill();
});

// Changing a type chip or the sort starts at the first ask of the new list, and keeps the focus on the control changed.
test('Waiting on you: a chip or sort change starts at the first ask of the new list and keeps the focus on that control', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'chip-focus'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], pick = ['a', 'b', 'c'].map((v) => ({ value: v, label: v.toUpperCase() }));
  const ask = (letter, options) => ({ key: `ask-${letter}`, title: `Ask ${letter.toUpperCase()}`, options, recommend_value: options[0].value });
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    ask('e', pick), ask('d', yesNo), ask('c', yesNo), ask('b', pick), ask('a', yesNo),
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  const queue = () => evaluate('[...document.querySelectorAll(".queue strong")].map((s) => s.textContent).join("|")');
  const fhead = () => evaluate('document.querySelector(".fhead")?.textContent');
  await until(async () => (await fhead()) === '1 of 5');
  await until(async () => (await evaluate('[...document.querySelectorAll(".queue button")].find((b) => b.textContent.includes("Ask D"))?.click() ?? true')) && (await fhead()) === '4 of 5');
  await until(async () => (await evaluate('[...document.querySelectorAll(".chips button")].find((b) => b.textContent.startsWith("Pick one"))?.click() ?? true')) && (await queue()) === 'Ask B|Ask E');
  assert.equal(await fhead(), '1 of 2');
  assert.equal(await evaluate('document.querySelector(".focus h3")?.textContent'), 'Ask B');
  assert.equal(await evaluate('document.activeElement?.getAttribute("aria-pressed") === "true" && document.activeElement.textContent.startsWith("Pick one")'), true);
  await evaluate('(() => { const s = document.querySelector(".sort select"); s.value = "oldest"; s.dispatchEvent(new Event("change")); })()');
  await until(async () => (await queue()) === 'Ask E|Ask B');
  assert.equal(await fhead(), '1 of 2');
  assert.equal(await evaluate('document.querySelector(".focus h3")?.textContent'), 'Ask E');
  assert.equal(await evaluate('document.activeElement?.matches(".sort select")'), true);
  close();
  proc.kill();
});

// Fed boards arrive with shapes the poster chose: a stored type-ask keeps its stored type but shows the type its shape answers as,
// and one shared classifier names every ask and groups the type chips, so a card's label is always the chip it sits under.
test('Waiting on you: a reply-only ask shows Reply, a type-ask yes/no shows Yes/No, and a decision with mocks but no design type shows Pick one', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'fed-types'), file = join(dir, 'board.json');
  mkdirSync(dir);
  writeFileSync(file, JSON.stringify({ schema: 2, answers_only: true, items: [
    { key: 'ready', type: 'ask', title: 'Say ready when you are', options: [], reply: true },
    { key: 'ship', type: 'ask', title: 'Ship it?' },
    { key: 'cover', title: 'Pick a cover', options: ['a', 'b'].map((v) => ({ value: v, label: v.toUpperCase() })), recommend_value: 'b',
      mocks: [{ value: 'a', path: 'mocks/a/index.html' }, { value: 'b', path: 'mocks/b/index.html' }] },
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  const chips = () => evaluate('[...document.querySelectorAll(".chips button")].map((b) => b.textContent + (b.getAttribute("aria-pressed") === "true" ? "*" : "")).join("|")');
  const queue = () => evaluate('[...document.querySelectorAll(".queue strong")].map((s) => s.textContent).join("|")');
  const tap = (name) => evaluate(`[...document.querySelectorAll(".queue button")].find((b) => b.textContent.includes("${name}"))?.click() ?? true`);
  // Newest first: the mocks decision leads, as a plain pick-one card with its two buttons and no mock frames.
  await until(async () => (await evaluate('document.querySelector(".fhead")?.textContent')) === '1 of 3');
  assert.equal(await queue(), 'Pick a cover|Ship it?|Say ready when you are');
  assert.equal(await evaluate('document.querySelector(".focus .eyebrow")?.textContent'), 'Pick one');
  assert.equal(await evaluate('document.querySelectorAll(".focus .choices button").length'), 2);
  assert.equal(await evaluate('document.querySelector(".focus .mock")'), null);
  assert.equal(await chips(), 'All 3*|Yes/No 1|Pick one 1|Reply 1');
  // The stored type-ask with the default yes/no options shows Yes/No, on the card and in its chip.
  await until(async () => (await tap('Ship it?')) && (await evaluate('document.querySelector(".focus .eyebrow")?.textContent')) === 'Yes/No');
  assert.equal(await evaluate('document.querySelectorAll(".focus .choices button").length'), 2);
  // The reply-only ask is a Reply, answered in the one place to type.
  await until(async () => (await tap('Say ready')) && (await evaluate('document.querySelector(".focus .eyebrow")?.textContent')) === 'Reply');
  assert.equal(await evaluate('document.querySelectorAll(".focus .choices button").length'), 0);
  assert.notEqual(await evaluate('document.querySelector(".focus textarea")'), null);
  // Its chip filters to just the reply-only ask.
  await until(async () => (await evaluate('[...document.querySelectorAll(".chips button")].find((b) => b.textContent.startsWith("Reply"))?.click() ?? true')) && (await queue()) === 'Say ready when you are');
  assert.equal(await evaluate('document.querySelector(".fhead")?.textContent'), '1 of 1');
  close();
  proc.kill();
});

test('a posted contract design is listed with its preview and date, and opens for a saved approve/change review', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'contract-design-plain-row'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(join(dir, 'design', 'welcome.png'), png);
  writeFileSync(join(dir, 'design', 'security.html'), '<!doctype html><title>Security view</title><h1>Security preview</h1>');
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd1-design', title: 'Review the welcome screen',
    about: 'Check the welcome screen before release.', group: 'Sign-in', filed: '2026-10-18T12:00:00Z', status: 'in_review',
    preview: 'design/preview.png', link: 'https://example.test/design/original',
    options: [{ value: 'quick', label: 'Quick' }, { value: 'guided', label: 'Guided' }], recommend: 'guided',
    journeys: [{ id: 'account-setup', title: 'Account setup', screens: [
      { id: 'welcome', title: 'Welcome', views: { phone_light: 'design/welcome.png' } },
      { id: 'security', title: 'Security', views: { phone_light: 'design/security.html' } },
      ...Array.from({ length: 15 }, (_, i) => ({ id: `screen-${i + 3}`, title: `Journey screen ${i + 3}`, views: { phone_light: 'design/welcome.png' } })),
    ] }] };
  writeFileSync(source, JSON.stringify(message));
  const posted = run('post', file, '--kind', 'design', '--from', source);
  assert.equal(posted.code, 0, posted.out);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'browser'));
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  await until(async () => (await evaluate('document.querySelector("#item-d1-design h3")?.textContent')) === message.title);
  assert.equal(await evaluate('document.querySelector("#item-d1-design .about")?.textContent'), message.about);
  assert.equal(await evaluate('document.querySelector("#item-d1-design a")?.textContent'), 'Open original');
  assert.equal(await evaluate('document.querySelector("#item-d1-design a")?.getAttribute("href")'), message.link);
  assert.equal(await evaluate('document.querySelector(".quiet a.open-link")?.textContent'), 'Open designs');
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs`)}`);
  await until(async () => (await evaluate('document.querySelector(".design-card h3")?.textContent')) === message.title);
  assert.equal(await evaluate('document.querySelector(".design-card img")?.getAttribute("src")'), `/design/local/d1-design/${encodeURIComponent(message.preview)}`);
  assert.equal(await evaluate('document.querySelector(".design-card .meta")?.textContent'), '18 Oct');
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs/d1-design`)}`);
  await until(async () => (await evaluate('document.querySelector(".design-review .foot button")?.textContent')) === 'Approve');
  assert.equal(await evaluate('document.querySelector(".design-preview-full")?.getAttribute("target")'), '_blank');
  assert.equal(await evaluate('document.querySelector(".design-review-preview")?.getAttribute("src")'), `/design/local/d1-design/${encodeURIComponent('design/welcome.png')}`);
  assert.equal(await evaluate('document.querySelector("[aria-label=\\"Screen for note\\"]")?.options.length'), 17);
  await evaluate('(() => { const s = document.querySelector("[aria-label=\\"Screen for note\\"]"); s.value = "account-setup/security"; s.dispatchEvent(new Event("change")); })()');
  assert.equal(await evaluate('document.querySelector(".design-preview-full")?.getAttribute("href")'), `/design/local/d1-design/${encodeURIComponent('design/security.html')}`);
  assert.equal(await evaluate('document.querySelector(".design-review-preview")?.tagName'), 'IFRAME');
  assert.equal(await evaluate('document.querySelector(".design-review-preview")?.getAttribute("src")'), `/design/local/d1-design/${encodeURIComponent('design/security.html')}`);
  await evaluate('document.querySelector("[aria-label=\\"Pick a direction\\"]").value = "quick"');
  await evaluate('document.querySelector(".design-review .foot button").click()');
  await until(async () => (await evaluate('document.querySelector(".design-review [role=status]")?.textContent')) === 'Approved');
  await evaluate('document.querySelector("[aria-label=\\"Screen for note\\"]").value = "account-setup/security"');
  await evaluate('document.querySelector(".design-review textarea").value = "Make the title clearer"');
  await evaluate('document.querySelector(".design-review .foot button:last-child").click()');
  await until(async () => (await evaluate('document.querySelector(".design-review [role=status]")?.textContent')) === 'Changes requested');
  assert.deepEqual(JSON.parse(run('answers', file, '--json').out)['d1-design'].notes, [{ journey: 'account-setup', screen: 'security', verdict: 'change', note: 'Make the title clearer' }]);
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs`)}`);
  await until(async () => (await evaluate('document.querySelector(".design-card .eyebrow")?.textContent')) === 'Changes requested');
  const desktop = await browse(join(dir, 'desktop-browser'), 1280);
  await desktop.evaluate(`location.href = ${JSON.stringify(`${url}#designs`)}`);
  await until(async () => (await desktop.evaluate('document.querySelector("#nav a[href=\\"#designs\\"][aria-current=page]")?.textContent.trim()')) === 'Designs1');
  await desktop.evaluate(`location.href = ${JSON.stringify(`${url}#designs/d1-design`)}`);
  await until(async () => (await desktop.evaluate('document.querySelector(".design-review .foot button")?.textContent')) === 'Approve');
  assert.equal(await desktop.evaluate('document.querySelector("#nav a[href=\\"#designs\\"][aria-current=page]")?.getClientRects().length > 0'), true);
  assert.equal(await desktop.evaluate('document.querySelector(".design-review")?.getBoundingClientRect().bottom <= innerHeight'), true);
  assert.equal(await desktop.evaluate('document.querySelector("#reader").getBoundingClientRect().left >= document.querySelector("#nav").getBoundingClientRect().right'), true);
  desktop.close();
  // The inline Change saved a change note on this screen: the viewer must show it as a change, not an approval.
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs/d1-design`)}`);
  await until(async () => (await evaluate('document.querySelector("[aria-haspopup=dialog]")?.textContent')) === 'Review full screen');
  await evaluate('document.querySelector("[aria-haspopup=dialog]").click()');
  await until(() => evaluate('!!document.querySelector(".design-viewer[open]")'));
  assert.match(await evaluate('document.querySelector(".design-viewer header").textContent'), /2 of 17.*Security/);
  assert.equal(await evaluate('document.querySelector(".design-viewer [role=status]").textContent'), 'Changes requested');
  assert.equal(await evaluate('document.querySelector(".design-viewer textarea").value'), 'Make the title clearer');
  await evaluate('document.querySelector("[aria-label=\\"Next screen\\"]").click()');
  await evaluate('document.querySelector(".design-viewer").dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowRight"}))');
  assert.match(await evaluate('document.querySelector(".design-viewer header").textContent'), /4 of 17/);
  await evaluate('document.querySelector(".design-viewer textarea").dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowLeft", bubbles:true}))');
  assert.match(await evaluate('document.querySelector(".design-viewer header").textContent'), /4 of 17/);
  await evaluate('window.viewerNode = document.querySelector(".design-viewer")');
  await evaluate('document.querySelector(".design-viewer .open-link").click()');
  await until(async () => (await evaluate('document.querySelector(".design-viewer[open] [role=status]")?.textContent')) === 'Screen approved');
  assert.equal(await evaluate('document.querySelector(".design-viewer") === window.viewerNode'), true);
  const legacy = { journey: 'account-setup', screen: 'security', verdict: 'change', note: 'Make the title clearer' };
  assert.deepEqual(JSON.parse(run('answers', file, '--json').out)['d1-design'].notes, [legacy, { journey: 'account-setup', screen: 'screen-4', verdict: 'approve', note: '' }]);
  await evaluate('document.querySelector("[aria-label=\\"Next screen\\"]").click()');
  await evaluate('document.querySelector(".design-viewer textarea").value = "Give the next action more space"');
  await evaluate('document.querySelector(".design-viewer .foot button:last-child:not([aria-label])").click()');
  await until(async () => (await evaluate('document.querySelector(".design-viewer[open] [role=status]")?.textContent')) === 'Changes requested');
  await evaluate('document.querySelector("[aria-label=\\"Close viewer\\"]").click()');
  await until(() => evaluate('!document.querySelector(".design-viewer[open]")'));
  assert.equal(await evaluate('location.hash'), '#designs/d1-design');
  assert.equal(await evaluate('String(document.querySelector(".design-review textarea").compareDocumentPosition([...document.querySelectorAll(".design-review > a")].find((a) => a.textContent === "Open original design")))'), '4');
  await evaluate('location.reload()');
  await until(async () => (await evaluate('document.querySelector("[aria-haspopup=dialog]")?.textContent')) === 'Review full screen');
  await evaluate('document.querySelector("[aria-haspopup=dialog]").click()');
  await until(() => evaluate('!!document.querySelector(".design-viewer[open]")'));
  await evaluate('document.querySelector("[aria-label=\\"Next screen\\"]").click(); document.querySelector("[aria-label=\\"Next screen\\"]").click()');
  assert.equal(await evaluate('document.querySelector(".design-viewer [role=status]").textContent'), 'Screen approved');
  for (let i = 0; i < 13; i++) await evaluate('document.querySelector("[aria-label=\\"Next screen\\"]").click()');
  assert.match(await evaluate('document.querySelector(".design-viewer header").textContent'), /17 of 17/);
  assert.equal(await evaluate('document.querySelector("[aria-label=\\"Next screen\\"]").disabled'), true);
  assert.equal(JSON.parse(run('answers', file, '--json').out)['d1-design'].notes.length, 3);
  await evaluate('document.querySelector("[aria-label=\\"Close viewer\\"]").click()');
  await until(() => evaluate('!document.querySelector(".design-viewer[open]")'));
  await until(async () => (await evaluate('String(document.querySelector(".design-review textarea").compareDocumentPosition([...document.querySelectorAll(".design-review > a")].find((a) => a.textContent === "Open original design")))')) === '4');
  close();
  proc.kill();
});

test('a design without journey screens accepts a design-level change note', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'design-level-note'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd1-no-screens', title: 'Review the settings direction',
    about: 'Check the overall settings direction.', group: 'Settings', filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png', journeys: [] };
  writeFileSync(source, JSON.stringify(message));
  const posted = run('post', file, '--kind', 'design', '--from', source);
  assert.equal(posted.code, 0, posted.out);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], { evaluate, close } = await browse(join(dir, 'browser'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs/d1-no-screens`)}`);
  await until(async () => (await evaluate('document.querySelector(".design-review button:last-of-type")?.textContent')) === 'Change');
  assert.equal(await evaluate('document.querySelector(".design-review label")?.textContent.includes("Design note")'), true);
  assert.equal(await evaluate('document.querySelector("[aria-label=\\"Screen for note\\"]")'), null);
  assert.equal(await evaluate('document.querySelector(".design-review button:last-of-type").disabled'), false);
  await evaluate('document.querySelector(".design-review textarea").value = "Clarify the overall hierarchy."');
  await evaluate('document.querySelector(".design-review button:last-of-type").click()');
  await until(async () => (await evaluate('document.querySelector(".design-review [role=status]")?.textContent')) === 'Changes requested');
  assert.deepEqual(JSON.parse(run('answers', file, '--json').out)['d1-no-screens'].notes, [{ verdict: 'change', note: 'Clarify the overall hierarchy.' }]);
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs`)}`);
  await until(async () => (await evaluate('document.querySelector(".design-card .eyebrow")?.textContent')) === 'Changes requested');
  assert.match(await evaluate('document.querySelector(".design-card")?.textContent'), /Clarify the overall hierarchy/);
  close();
  proc.kill();
});

test('a screen approval on a design with no design verdict saves the screen and keeps the design waiting', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'screen-only'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(join(dir, 'design', 'a.png'), png);
  writeFileSync(join(dir, 'design', 'b.png'), png);
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd2-screens', title: 'Review the flow screens',
    about: 'Approve each screen of the flow.', group: 'Sign-in', filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png',
    journeys: [{ id: 'flow', title: 'Flow', screens: [
      { id: 'a', title: 'First', views: { phone_light: 'design/a.png' } },
      { id: 'b', title: 'Second', views: { phone_light: 'design/b.png' } },
    ] }] };
  writeFileSync(source, JSON.stringify(message));
  assert.equal(run('post', file, '--kind', 'design', '--from', source).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], { evaluate, close } = await browse(join(dir, 'browser'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs/d2-screens`)}`);
  await until(async () => (await evaluate('document.querySelector("[aria-haspopup=dialog]")?.textContent')) === 'Review full screen');
  await evaluate('document.querySelector("[aria-haspopup=dialog]").click()');
  await until(() => evaluate('!!document.querySelector(".design-viewer[open]")'));
  await evaluate('document.querySelector(".design-viewer .open-link").click()');
  await until(async () => (await evaluate('document.querySelector(".design-viewer[open] [role=status]")?.textContent')) === 'Screen approved');
  const saved = JSON.parse(run('answers', file, '--json').out)['d2-screens'];
  assert.deepEqual(saved.notes, [{ journey: 'flow', screen: 'a', verdict: 'approve', note: '' }]);
  assert.equal(saved.answer, 'screens');
  assert.match(run('list', file).out, /answered: 0/);
  assert.match(run('list', file, '--full').out, /waiting/);
  close();
  proc.kill();
});

test('design screen saves: a screen-only save runs no on_answer, a change on a screen of an approved design sets it to change, and other screen saves keep the verdict', async () => {
  const dir = join(scratch, 'screen-verdicts'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json'), out = join(dir, 'hook.out');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(join(dir, 'design', 'a.png'), png);
  writeFileSync(join(dir, 'design', 'b.png'), png);
  writeFileSync(join(dir, 'hook.mjs'), `import { appendFileSync, readFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(out)}, readFileSync(0, 'utf8'));\n`);
  writeFileSync(join(dir, 'config.yaml'), 'board: board.json\non_answer: node hook.mjs\n');
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd3-verdicts', title: 'Review the flow screens',
    about: 'Approve each screen of the flow.', group: 'Sign-in', filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png',
    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], recommend: 'a',
    journeys: [{ id: 'flow', title: 'Flow', screens: [
      { id: 'a', title: 'First', views: { phone_light: 'design/a.png' } },
      { id: 'b', title: 'Second', views: { phone_light: 'design/b.png' } },
    ] }] };
  writeFileSync(source, JSON.stringify(message));
  assert.equal(run('post', file, '--kind', 'design', '--from', source).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const screen = (notes, requested) => post(url, 'api/answers', { key: 'd3-verdicts', notes, ...(requested && { requested: true }) });
  const design = (verdict, notes) => post(url, 'api/answers', { key: 'd3-verdicts', verdict, pick: 'a', notes });
  const saved = () => JSON.parse(run('answers', file, '--json').out)['d3-verdicts'];
  const approveA = { journey: 'flow', screen: 'a', verdict: 'approve', note: '' };
  const changeB = { journey: 'flow', screen: 'b', verdict: 'change', note: 'Fix the title' };
  assert.equal((await screen([approveA])).status, 200);
  assert.deepEqual([saved().answer, saved().label], ['screens', 'Screens reviewed']);
  assert.equal((await design('approve', [approveA])).status, 200);
  assert.deepEqual([saved().answer, saved().label], ['approve', 'Approved']);
  assert.equal((await screen([approveA, changeB], true)).status, 200);
  assert.deepEqual([saved().answer, saved().label, saved().pick], ['change', 'Changes requested', 'a']);
  assert.equal((await screen([{ ...approveA, note: 'Looks right' }, changeB])).status, 200);
  assert.equal(saved().answer, 'change');
  assert.equal((await design('approve', [approveA, changeB])).status, 200);
  assert.equal((await screen([{ ...approveA, note: 'Looks right' }, changeB])).status, 200);
  assert.deepEqual([saved().answer, saved().pick], ['approve', 'a']);
  const hooked = () => readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l).answer);
  for (let i = 0; i < 50 && (!existsSync(out) || hooked().length < 3); i++) await new Promise((ok) => setTimeout(ok, 100));
  await new Promise((ok) => setTimeout(ok, 500));
  assert.deepEqual(hooked().sort(), ['approve', 'approve', 'change']);
  proc.kill();
});

test('a design holding only screen notes does not lock its key or its question', async () => {
  const dir = join(scratch, 'screens-only-relock'), file = join(dir, 'board.json'), message = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(join(dir, 'design', 'a.png'), png);
  const design = { contract: 1, kind: 'design', schema: 1, key: 'd4-relock', title: 'Review the flow screens',
    about: 'Approve each screen of the flow.', group: 'Sign-in', filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png',
    journeys: [{ id: 'flow', title: 'Flow', screens: [{ id: 'a', title: 'First', views: { phone_light: 'design/a.png' } }] }] };
  writeFileSync(message, JSON.stringify(design));
  assert.equal(run('post', file, '--kind', 'design', '--from', message).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  assert.equal((await post(url, 'api/answers', { key: 'd4-relock', notes: [{ journey: 'flow', screen: 'a', verdict: 'approve', note: '' }] })).status, 200);
  assert.equal(JSON.parse(run('answers', file, '--json').out)['d4-relock'].answer, 'screens');
  proc.kill();
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...doc, items: doc.items.filter((i) => i.key !== 'd4-relock') }));
  assert.equal(run('post', file, '--kind', 'design', '--from', message).code, 0);
});

test('an ask whose option is named screens is answered, not left waiting', async () => {
  const dir = join(scratch, 'screens-option'), file = join(dir, 'board.json');
  mkdirSync(dir, { recursive: true });
  assert.equal(run('post', file, '--title', 'Which view?', '--key', 'pick-view', '--option', 'screens=Screens', '--option', 'list=List').code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  assert.equal((await post(url, 'api/answers', { key: 'pick-view', answer: 'screens' })).status, 200);
  assert.equal(JSON.parse(run('answers', file, '--json').out)['pick-view'].answer, 'screens');
  assert.match(run('list', file).out, /waiting: 0 of 1 decisions/);
  proc.kill();
});

test('design screen change: a change with new text on a screen that already had a change note still sets an approved design to change', async () => {
  const dir = join(scratch, 'screen-change-again'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(join(dir, 'design', 'a.png'), png);
  writeFileSync(join(dir, 'design', 'b.png'), png);
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd3-change-again', title: 'Review the flow screens',
    about: 'Approve each screen of the flow.', group: 'Sign-in', filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png',
    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], recommend: 'a',
    journeys: [{ id: 'flow', title: 'Flow', screens: [
      { id: 'a', title: 'First', views: { phone_light: 'design/a.png' } },
      { id: 'b', title: 'Second', views: { phone_light: 'design/b.png' } },
    ] }] };
  writeFileSync(source, JSON.stringify(message));
  assert.equal(run('post', file, '--kind', 'design', '--from', source).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const saved = () => JSON.parse(run('answers', file, '--json').out)['d3-change-again'];
  const changeB = (note) => ({ journey: 'flow', screen: 'b', verdict: 'change', note });
  assert.equal((await post(url, 'api/answers', { key: 'd3-change-again', notes: [changeB('Fix the title')] })).status, 200);
  assert.equal((await post(url, 'api/answers', { key: 'd3-change-again', verdict: 'approve', pick: 'a', notes: [changeB('Fix the title')] })).status, 200);
  assert.equal(saved().answer, 'approve');
  assert.equal((await post(url, 'api/answers', { key: 'd3-change-again', notes: [changeB('Still wrong')], requested: true })).status, 200);
  assert.deepEqual([saved().answer, saved().pick], ['change', 'a']);
  proc.kill();
});

test('a viewer request for a change already stored on an approved design still sets it to change', async () => {
  const dir = join(scratch, 'screen-rerequest'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(join(dir, 'design', 'a.png'), png);
  writeFileSync(join(dir, 'design', 'b.png'), png);
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd3-rerequest', title: 'Review the flow screens',
    about: 'Approve each screen of the flow.', group: 'Sign-in', filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png',
    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], recommend: 'a',
    journeys: [{ id: 'flow', title: 'Flow', screens: [
      { id: 'a', title: 'First', views: { phone_light: 'design/a.png' } },
      { id: 'b', title: 'Second', views: { phone_light: 'design/b.png' } },
    ] }] };
  writeFileSync(source, JSON.stringify(message));
  assert.equal(run('post', file, '--kind', 'design', '--from', source).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const saved = () => JSON.parse(run('answers', file, '--json').out)['d3-rerequest'];
  const changeB = { journey: 'flow', screen: 'b', verdict: 'change', note: 'fix spacing' };
  assert.equal((await post(url, 'api/answers', { key: 'd3-rerequest', notes: [changeB] })).status, 200);
  assert.equal((await post(url, 'api/answers', { key: 'd3-rerequest', verdict: 'approve', pick: 'a', notes: [changeB] })).status, 200);
  assert.equal(saved().answer, 'approve');
  assert.equal((await post(url, 'api/answers', { key: 'd3-rerequest', notes: [changeB], requested: true })).status, 200);
  assert.deepEqual([saved().answer, saved().label], ['change', 'Changes requested']);
  proc.kill();
});

test('design review: a viewer approve needs no direction pick, and an inline Approve with a note gives that screen the same verdict', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'screen-approve-pick'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(join(dir, 'design', 'a.png'), png);
  writeFileSync(join(dir, 'design', 'b.png'), png);
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd3-direction', title: 'Review the flow screens',
    about: 'Approve each screen of the flow.', group: 'Sign-in', filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png',
    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], recommend: 'a',
    journeys: [{ id: 'flow', title: 'Flow', screens: [
      { id: 'a', title: 'First', views: { phone_light: 'design/a.png' } },
      { id: 'b', title: 'Second', views: { phone_light: 'design/b.png' } },
    ] }] };
  writeFileSync(source, JSON.stringify(message));
  assert.equal(run('post', file, '--kind', 'design', '--from', source).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], { evaluate, close } = await browse(join(dir, 'browser'), 1280);
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs/d3-direction`)}`);
  await until(async () => (await evaluate('document.querySelector("[aria-haspopup=dialog]")?.textContent')) === 'Review full screen');
  await evaluate('document.querySelector("[aria-haspopup=dialog]").click()');
  await until(() => evaluate('!!document.querySelector(".design-viewer[open]")'));
  await evaluate('document.querySelector(".design-viewer .open-link").click()');
  await until(async () => (await evaluate('document.querySelector(".design-viewer[open] [role=status]")?.textContent')) === 'Screen approved');
  assert.deepEqual(JSON.parse(run('answers', file, '--json').out)['d3-direction'].notes, [{ journey: 'flow', screen: 'a', verdict: 'approve', note: '' }]);
  await evaluate('document.querySelector(".design-viewer header button").click()');
  await until(() => evaluate('!document.querySelector(".design-viewer[open]")'));
  await evaluate('[...document.querySelectorAll(".design-review label")].find((l) => l.textContent.startsWith("Pick a direction")).querySelector("select").value = "a"');
  await evaluate('const s = [...document.querySelectorAll(".design-review label")].find((l) => l.textContent.startsWith("Screen for note")).querySelector("select"); s.value = "flow/b"; s.dispatchEvent(new Event("change"))');
  await evaluate('document.querySelector(".design-review textarea").value = "Tighten spacing"');
  await evaluate('document.querySelector(".design-review .foot button").click()');
  await until(async () => (await evaluate('document.querySelector(".design-review [role=status]")?.textContent')) === 'Approved');
  const saved = JSON.parse(run('answers', file, '--json').out)['d3-direction'];
  assert.equal(saved.answer, 'approve');
  assert.deepEqual(saved.notes, [{ journey: 'flow', screen: 'a', verdict: 'approve', note: '' }, { journey: 'flow', screen: 'b', verdict: 'approve', note: 'Tighten spacing' }]);
  close();
  proc.kill();
});

test('a design-level inline Approve or Change stores its verdict with the note, and an empty Approve drops the earlier design-level note', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'design-level-note'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd3-plain', title: 'Review the plain page',
    about: 'One page.', group: 'Sign-in', filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png', journeys: [] };
  writeFileSync(source, JSON.stringify(message));
  assert.equal(run('post', file, '--kind', 'design', '--from', source).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], { evaluate, close } = await browse(join(dir, 'browser'), 1280);
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs/d3-plain`)}`);
  await until(async () => (await evaluate('document.querySelector(".design-review .foot button")?.textContent')) === 'Approve');
  await evaluate('document.querySelector(".design-review textarea").value = "Fix spacing"');
  await evaluate('document.querySelector(".design-review .foot button:last-child").click()');
  await until(async () => (await evaluate('document.querySelector(".design-review [role=status]")?.textContent')) === 'Changes requested');
  assert.deepEqual(JSON.parse(run('answers', file, '--json').out)['d3-plain'].notes, [{ verdict: 'change', note: 'Fix spacing' }]);
  await evaluate('document.querySelector(".design-review textarea").value = ""');
  await evaluate('document.querySelector(".design-review .foot button").click()');
  await until(async () => (await evaluate('document.querySelector(".design-review [role=status]")?.textContent')) === 'Approved');
  const saved = JSON.parse(run('answers', file, '--json').out)['d3-plain'];
  assert.deepEqual([saved.answer, saved.notes], ['approve', []]);
  await evaluate('document.querySelector(".design-review textarea").value = "Looks good"');
  await until(() => evaluate('!document.querySelector(".design-review .foot button").disabled'));
  await evaluate('document.querySelector(".design-review .foot button").click()');
  await until(() => JSON.parse(run('answers', file, '--json').out)['d3-plain'].notes.length === 1);
  assert.deepEqual(JSON.parse(run('answers', file, '--json').out)['d3-plain'].notes, [{ verdict: 'approve', note: 'Looks good' }]);
  close();
  proc.kill();
});

test('Waiting on you: an update waiting for a verdict reads Evidence on its card, the name of its chip, not Update N', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'waiting-update'), file = join(dir, 'board.json');
  mkdirSync(dir);
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'upd', type: 'evidence', number: 5, title: 'Login checked', area: 'waiting', media: [{ path: 'evidence/5/shot.png', sha256: 'a'.repeat(64), bytes: 0 }] },
    { key: 'ship', type: 'ask', title: 'Ship it?' },
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  await until(async () => (await evaluate('document.querySelector(".fhead")?.textContent')) === '1 of 2');
  await until(async () => (await evaluate('[...document.querySelectorAll(".queue button")].find((b) => b.textContent.includes("Login checked"))?.click() ?? true')) && (await evaluate('document.querySelector(".focus h3")?.textContent')) === 'Login checked');
  assert.equal(await evaluate('document.querySelector(".focus .eyebrow")?.textContent'), 'Evidence');
  assert.ok(await evaluate('[...document.querySelectorAll(".chips button")].some((b) => b.textContent.startsWith("Evidence 1"))'));
  close();
  proc.kill();
});

// Any question can wait, whatever type it names: while it waits, its card names the type of answer it takes, the same name as the chip
// counting it; outside Waiting the same card keeps its own name.
test('Answered: a design keeps its Design label and an answered yes/no decision has no eyebrow', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'answered-labels'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'look', type: 'design', title: 'Pick the look', options: ['a', 'b'].map((v) => ({ value: v, label: v.toUpperCase() })), recommend_value: 'b' },
    { key: 'digest', title: 'Keep the weekly digest?', options: yesNo, recommend_value: 'yes' },
  ] }));
  writeFileSync(file.replace(/\.json$/, '.answers.jsonl'), [
    { key: 'look', answer: 'a', label: 'A', close: 'done', at: new Date().toISOString() },
    { key: 'digest', answer: 'yes', label: 'Yes', close: 'done', at: new Date().toISOString() },
  ].map((a) => JSON.stringify(a)).join('\n') + '\n');
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#answered`)}`);
  await until(async () => (await evaluate('document.querySelectorAll("article.row").length')) === 2);
  assert.equal(await evaluate('document.querySelector("#item-look .eyebrow")?.textContent'), 'Design');
  assert.ok(await evaluate('document.querySelector("#item-digest .eyebrow") === null'));
  close();
  proc.kill();
});

test('Waiting on you: a diagram, an interactive page, an explainer and a free-form fed type each show the name of the chip counting them', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'view-types'), file = join(dir, 'board.json'), mocks = join(dir, 'mocks');
  mkdirSync(mocks, { recursive: true });
  writeFileSync(join(mocks, 'flow.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>');
  writeFileSync(join(mocks, 'walk.html'), '<p>The new flow</p>');
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'flow', type: 'diagram', title: 'Is this the sign-in flow?', view: 'mocks/flow.svg' },
    { key: 'walk', type: 'interactive', title: 'Walk through the new flow?', view: 'mocks/walk.html' },
    { key: 'tour', type: 'explainer', title: 'Take the tour?', media: [{ path: 'evidence/1/tour.webm', sha256: 'a'.repeat(64), bytes: 0 }], area: 'waiting' },
    { key: 'site', type: 'site-check', title: 'Check the site?' },
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  const chips = () => evaluate('[...document.querySelectorAll(".chips button")].map((b) => b.textContent + (b.getAttribute("aria-pressed") === "true" ? "*" : "")).join("|")');
  const tap = (name) => evaluate(`[...document.querySelectorAll(".queue button")].find((b) => b.textContent.includes("${name}"))?.click() ?? true`);
  // All four take a yes or a no, so one Yes/No chip counts them all, and each waiting card says Yes/No, never its type word.
  await until(async () => (await evaluate('document.querySelector(".fhead")?.textContent')) === '1 of 4');
  assert.equal(await chips(), 'All 4*|Yes/No 4');
  for (const name of ['Check the site?', 'Take the tour?', 'Walk through the new flow?', 'Is this the sign-in flow?']) {
    await until(async () => (await tap(name)) && (await evaluate('document.querySelector(".focus .eyebrow")?.textContent')) === 'Yes/No');
  }
  close();
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

// SQUASH from the verify skill lists squashed text at any width: a visible element holding more than 8 characters of its own
// text in a column narrower than 8 characters of its font, a number or short label (6 characters or fewer) on more than one
// line or running out of its own box, and two visible runs of text that overlap.
const SQUASH = `(() => {
  const out = [], runs = [];
  for (const e of document.querySelectorAll('body *')) {
    const nodes = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()), t = nodes.map((n) => n.textContent).join('').trim();
    if (!t || !e.checkVisibility({ visibilityProperty: true })) continue;
    const box = e.getBoundingClientRect(), rects = nodes.flatMap((n) => { const r = document.createRange(); r.selectNodeContents(n); return [...r.getClientRects()]; }).filter((r) => r.width && r.height);
    if (t.length > 8 && box.width < 8 * parseFloat(getComputedStyle(e).fontSize) * 0.5) out.push('squash:' + t.slice(0, 40));
    if (t.length <= 6 && (new Set(rects.map((r) => Math.round(r.top))).size > 1 || rects.some((r) => r.left < box.left - 1 || r.right > box.right + 1))) out.push('wrap:' + t);
    for (const r of rects) runs.push([e, t, r]);
  }
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    const [ea, ta, a] = runs[i], [eb, tb, b] = runs[j];
    if (ea !== eb && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push('overlap:' + ta.slice(0, 15) + '/' + tb.slice(0, 15));
  }
  return [...new Set(out)];
})()`;

test('a long answer at 390 px sits under its long title, which keeps most of the row and wraps by words, on Answered and the Summary', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'squash'), file = join(dir, 'board.json'), long = 'A (recommended): you sign in to npm once (1 tap); no key stored anywhere';
  mkdirSync(dir);
  writeFileSync(file, JSON.stringify({ schema: 2, items: [{ key: 'npm', title: 'npm auto-publish on merge: how do GitHub builds get publish rights?', options: [{ value: 'a', label: long }, { value: 'b', label: 'B' }] }] }));
  writeFileSync(file.replace(/\.json$/, '.answers.jsonl'), JSON.stringify({ key: 'npm', answer: 'a', label: long, at: new Date().toISOString() }) + '\n');
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  // Per row: the title's share of the row's width, and its narrowest line in ems (a lone letter is about half an em).
  const rows = `[...document.querySelectorAll('.compact')].filter((c) => c.querySelector('.ans')).map((c) => { const s = c.querySelector('strong'), r = document.createRange();
    r.selectNodeContents(s);
    return [s.getBoundingClientRect().width / c.getBoundingClientRect().width, Math.min(...[...r.getClientRects()].map((l) => l.width)) / parseFloat(getComputedStyle(s).fontSize)]; })`;
  for (const [hash, h1] of [['', 'Summary'], ['#answered', 'Answered']]) {
    await evaluate(`location.href = ${JSON.stringify(url + hash)}`);
    await until(async () => (await evaluate(`document.querySelector('h1')?.textContent === '${h1}' && !!document.querySelector('.compact .ans')`)));
    assert.deepEqual(await evaluate(SQUASH), [], h1);
    const [[share, line], ...more] = await evaluate(rows);
    assert.equal(more.length, 0, h1);
    assert.ok(share > 0.75 && line > 1, `${h1}: the title takes ${Math.round(share * 100)}% of the row, its narrowest line ${line.toFixed(1)} em`);
  }
  close();
  proc.kill();
});

// The Summary at 390 with 1, 10 and 100 answers today, as on a narrow phone: one answer at 8:00 and the rest at 9:30, and at
// 100 all of them in one column. The last board is a last-bucket one: one answer at 9:00 and ten at 9:58, so the ten sit at
// `left: 100%`, where a wrapping count would reach the caption. The Answered count stays on one line at its full width while its
// checks give way; each Today column carries its own count, the counts add up to the caption, and none reaches it or another label.
// The Today list under the chart shows the day's newest answers first, taking the rows in the same order as the Answered list.
test('Summary at 390 with 1, 10, 100 answers today and a last-bucket board: the Answered count stays whole, the Today counts add up without touching the caption, and the Today list leads with the newest answer in the Answered order', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const today = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const cases = [{ n: 1, at: () => today(9, 30) }, { n: 10, at: (i) => (i === 0 ? today(8, 0) : today(9, 30)) }, { n: 100, at: () => today(9, 30) },
    { n: 11, at: (i) => (i === 0 ? today(9, 0) : today(9, 58)) }];
  // A list row reads `<time><title> · <label>`; the Answered list's own `strong` holds the title alone.
  const names = (sel) => `[...document.querySelectorAll('${sel}')].map((li) => li.textContent.replace(/^\\d\\d:\\d\\d/, '').split(' · ')[0])`;
  const seen = {}, want = {}, order = {};
  for (const { n, at } of cases) {
    const dir = join(scratch, `fit-${n}`), file = join(dir, 'board.json');
    mkdirSync(dir, { recursive: true });
    const rows = Array.from({ length: n }, (_, i) => ({ key: `q${i}`, title: `Question ${i}?`, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }));
    writeFileSync(file, JSON.stringify({ schema: 2, items: rows }));
    writeFileSync(file.replace(/\.json$/, '.answers.jsonl'), rows.map((d, i) => JSON.stringify({ key: d.key, answer: 'yes', label: 'Yes', close: 'done', at: at(i) })).join('\n') + '\n');
    const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    procs.push(proc);
    const url = /url: "(\S+)"/.exec(await served(proc))[1];
    const { evaluate, close } = await browse(join(dir, 'b'), 390);
    await evaluate(`location.href = ${JSON.stringify(url)}`);
    await until(async () => (await evaluate(`document.querySelector('.tile.i-answered .n')?.textContent === '${n}' && !!document.querySelector('.day')`)));
    seen[n] = await evaluate(`[${SQUASH}, document.querySelector('.today .sec-head .meta').textContent, [...document.querySelectorAll('.col')].map((c) => c.textContent)]`);
    want[n] = [[], `${n} answered, ${n === 10 ? '8:00' : '9:00'} to 10:00`, n === 10 ? ['1', '9'] : n === 11 ? ['1', '10'] : [String(n)]];
    // The same page's Answered screen lists every answer, newest first: the day's list must name the same rows in the same order.
    const list = await evaluate(names('.today .events li'));
    await evaluate(`location.hash = '#answered'`);
    await until(async () => (await evaluate(`!!document.querySelector('#board ul.i-answered > li')`)));
    order[n] = { list, all: await evaluate(names('#board ul.i-answered > li summary .t strong')) };
    close();
    proc.kill();
  }
  assert.deepEqual(seen, want);
  for (const { n } of cases) {
    assert.equal(order[n].all[0], `Question ${n - 1}?`, `${n}: the Answered list leads with the newest answer`);
    assert.deepEqual(order[n].list, order[n].all.slice(0, 8), `${n}: Today shows the newest answers first, in the Answered list's order`);
  }
});

test('Evidence: an update leads with its number and New or its day, then its result as a headline over the card width, its captures (two side by side) and Does this look right? over its verdicts; a done-done update heads with the run outcome, shows the run capture and check in plain words, and folds the commit and agent lines under Details; at 390 nothing squashes; at 1440 the page counts them and sets them two across', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'updates'), file = join(dir, '.sign-off', 'decisions.json');
  mkdirSync(dir);
  run('init', dir);
  const shot = (name, w, h) => (writeFileSync(join(dir, name), sized(w, h)), join(dir, name));
  const [tall, wide] = [shot('tall.png', 300, 600), shot('wide.png', 600, 300)];
  const update = (...media) => run('post', file, '--type', 'evidence', '--title', 'Sign-in', '--about', 'Loads in 1 second.', ...media.flatMap((m) => ['--media', m])).code;
  assert.deepEqual([update(tall), update(wide, tall), update(wide)], [0, 0, 0]);
  // The first update was filed three days ago: it shows that day and no New. The fourth links a done-done run as done-done files one:
  // a title that only names the run, the plain outcome, and the capture its run record lists under --evidence-root.
  const doc = JSON.parse(readFileSync(file, 'utf8')), old = new Date(Date.now() - 3 * 864e5), runId = '20261011T120000Z-a1b2c3d4', commit = 'c0ffee'.padEnd(40, '0');
  const outcome = 'You can read every card on a phone.', bytes = readFileSync(wide);
  doc.items[0].filed = old.toISOString();
  doc.items.push({ key: 'update-4', type: 'evidence', number: 4, title: 'sign-off board verify: pass', about: outcome,
    evidence: { run_id: runId, commit, outcome, repro: 'repro: n/a: no bug', proof: 'done-done: real browser journey', evidence: 'wide.png' } });
  writeFileSync(file, JSON.stringify(doc));
  mkdirSync(join(dir, '.done-done', 'runs'), { recursive: true });
  writeFileSync(join(dir, '.done-done', 'runs', `${runId}.json`), JSON.stringify({ schema: 1, run_id: runId, commit, tree: 'a'.repeat(40), dirty: false, exit: 0,
    files: [{ path: 'wide.png', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0', '--evidence-root', dir], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  let { evaluate, close } = await browse(join(dir, 'b'), 1440);
  await evaluate(`location.href = ${JSON.stringify(`${url}#evidence`)}`);
  // Per card: the line over the headline, the headline, its pictures, the question over the verdicts and how many verdicts.
  const cards = '[...document.querySelectorAll("article.update")].map((a) => [[...a.querySelector(".eyebrow").childNodes].map((n) => n.textContent), a.querySelector("h3").textContent, a.querySelectorAll(".proof img").length, a.querySelector(".ask-line").textContent, a.querySelectorAll(".choices button").length])';
  await until(async () => (await evaluate(`${cards}.length === 4 && [...document.querySelectorAll(".proof img")].every((i) => i.complete && i.naturalWidth)`)));
  const day = (at) => at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), ask = 'Does this look right?';
  assert.deepEqual(await evaluate(cards), [[['Update 4', 'Check passed'], outcome, 1, ask, 3], [['Update 3', 'New'], 'Sign-in', 1, ask, 3],
    [['Update 2', 'New'], 'Sign-in', 2, ask, 3], [['Update 1', day(old)], 'Sign-in', 1, ask, 3]]);
  // The done-done update shows nothing an engineer wrote until Details opens: the run's title, its commit and the agent's lines.
  const shown = (sel) => `[...document.querySelectorAll(${JSON.stringify(`${sel}, ${sel} *`)})].filter((e) => e.checkVisibility()).flatMap((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent)).join(' ')`;
  assert.doesNotMatch(await evaluate(shown('#item-update-4')), /verify|c0ffee|repro|done-done|wide\.png|RUN PASS/);
  await evaluate('document.querySelector("#item-update-4 .tech summary").click()');
  assert.match(await evaluate(shown('#item-update-4 .tech')), /sign-off board verify: pass/);
  assert.match(await evaluate('document.querySelector("#item-update-4 .tech").textContent'), /Commit c0ffee0{34}.*repro: n\/a: no bug/s);
  // Two captures share a line.
  assert.ok(await evaluate('(([a, b]) => a.top === b.top && b.left > a.right)([...document.querySelectorAll("#item-update-2 .media img")].map((i) => i.getBoundingClientRect()))'));
  // Under the title: how many, how many filed today and when the newest came; then the Updates head and the cards two across.
  const at = new Date(doc.items[2].filed).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  assert.deepEqual(await evaluate('[document.querySelector(".top .lede").textContent, document.querySelector(".sec-head h2").textContent]'), [`4 updates, 2 new. The page changed at ${at}.`, 'Updates']);
  assert.ok(await evaluate('(([a, b, c]) => a.top === b.top && b.left > a.right && c.top > a.bottom)([4, 3, 2].map((n) => document.getElementById(`item-update-${n}`).getBoundingClientRect()))'));
  close();
  // On a phone each headline keeps the card's width beside the corner x, nothing squashes, and the page never scrolls sideways.
  ({ evaluate, close } = await browse(join(dir, 'p'), 390));
  await evaluate(`location.href = ${JSON.stringify(`${url}#evidence`)}`);
  await until(async () => (await evaluate('document.querySelectorAll("article.update").length === 4')));
  assert.deepEqual(await evaluate(SQUASH), []);
  assert.deepEqual(await evaluate('[...document.querySelectorAll("article.update")].filter((a) => a.querySelector("h3").getBoundingClientRect().width < 0.85 * a.getBoundingClientRect().width).map((a) => a.id)'), []);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
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
  // A single-item post is checked against the board it goes to: on this answers-only board an evidence update and an item only shown both post.
  assert.equal(scoped([page]).code, 0);
  const shot = join(dir, 'shot.png');
  writeFileSync(shot, png);
  assert.match(run('post', file, '--type', 'evidence', '--title', 'Sign-in screen', '--about', 'The screen loads.', '--media', shot).out, /update-1,1,1/);
  writeFileSync(feed, JSON.stringify({ schema: 2, items: [{ ...page, key: 'look', title: 'Look' }] }));
  assert.match(run('post', file, '--from', feed).out, /look,raised/);
  const posted = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual([posted.answers_only, posted.items.find((i) => i.key === 'page').options], [true, []]);
  proc.kill();
});

test('answer events: a filer takes only its own answers, once, the card shows it seen, and on_answer gets each answer on stdin', async () => {
  const dir = join(scratch, 'events'), file = join(dir, 'board.json'), out = join(dir, 'hook.out');
  mkdirSync(dir);
  writeFileSync(join(dir, 'hook.mjs'), `import { appendFileSync, readFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(out)}, readFileSync(0, 'utf8'));\n`);
  // The answer reaches the hook on stdin only: its arguments are the config's words, never the answer.
  writeFileSync(join(dir, 'config.yaml'), 'board: board.json\non_answer: node hook.mjs --from-board\n');
  const as = (extra, ...args) => {
    try { return { out: execFileSync(process.execPath, [cli, ...asked(args)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...env, ...extra } }), code: 0 }; }
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
  // Each line is an answer event: a board-format item reports as ask schema 1.
  assert.ok(hooked().every((h) => h.event === 'answer' && h.contract === 1 && h.kind === 'ask' && h.schema === 1), JSON.stringify(hooked()));
  assert.equal(statSync(join(dir, 'board.seen.jsonl')).mode & 0o777, 0o600);
  proc.kill();
});

test('no board named: the nearest .sign-off/ up to the repo root, else the home board, never a board above a folder outside both; SIGN_OFF_HOME; doctor checks on_answer; init and hints under npx', () => {
  const at = (cwd, more, ...args) => spawnSync(process.execPath, [cli, ...asked(args)], { cwd, env: { ...env, ...more }, encoding: 'utf8' });
  const proj = join(scratch, 'walk'), deep = join(proj, 'src', 'deep'), inner = join(proj, 'inner'), items = (b) => JSON.parse(readFileSync(b, 'utf8')).items.map((i) => i.key);
  mkdirSync(deep, { recursive: true });
  mkdirSync(join(proj, '.git'));
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
  // A board above a working folder that has no repo root and sits outside HOME (another home's board, say, under an isolated HOME) is never adopted; the working folder's own is.
  const other = join(scratch, 'other-home'), stray = join(other, 'work', 'proj');
  mkdirSync(join(other, '.sign-off'), { recursive: true });
  mkdirSync(stray, { recursive: true });
  writeFileSync(join(other, '.sign-off', 'config.yaml'), 'board: decisions.json\nport: 0\n');
  writeFileSync(join(other, '.sign-off', 'decisions.json'), '{"schema":2,"items":[]}\n');
  assert.equal(at(stray, {}, 'raise', '--title', 'Probe from an isolated run?').status, 0);
  assert.equal(at(other, {}, 'raise', '--title', 'Probe from its own folder?').status, 0);
  assert.deepEqual(items(join(other, '.sign-off', 'decisions.json')), ['probe-from-its-own-folder']);
  assert.deepEqual(items(join(env.HOME, '.sign-off', 'decisions.json')), ['from-the-inner-repo', 'probe-from-an-isolated-run']);
  // SIGN_OFF_HOME takes HOME's place for the default board; a board file given always wins.
  const own = join(scratch, 'sign-off-home');
  assert.equal(at(stray, { SIGN_OFF_HOME: own }, 'raise', '--title', 'Into SIGN_OFF_HOME?').status, 0);
  assert.deepEqual(items(join(own, '.sign-off', 'decisions.json')), ['into-sign-off-home']);
  assert.equal(at(stray, { SIGN_OFF_HOME: own }, 'raise', join(other, '.sign-off', 'decisions.json'), '--title', 'Named board?').status, 0);
  assert.deepEqual(items(join(other, '.sign-off', 'decisions.json')), ['probe-from-its-own-folder', 'named-board']);
  // A board above a folder with no .git but inside HOME is adopted. (HOME equal to the account home cannot be exercised here without touching the real home.)
  const inHome = join(env.HOME, 'projects'), foo = join(inHome, 'foo');
  mkdirSync(join(inHome, '.sign-off'), { recursive: true });
  mkdirSync(foo, { recursive: true });
  writeFileSync(join(inHome, '.sign-off', 'config.yaml'), 'board: decisions.json\nport: 0\n');
  writeFileSync(join(inHome, '.sign-off', 'decisions.json'), '{"schema":2,"items":[]}\n');
  assert.equal(at(foo, {}, 'raise', '--title', 'Ancestor board in home?').status, 0);
  assert.deepEqual(items(join(inHome, '.sign-off', 'decisions.json')), ['ancestor-board-in-home']);
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
  const r = spawnSync(process.execPath, [cli, ...asked(['raise', '--title', 'From linked home?'])], { cwd: join(linkHome, 'proj'), env: { ...env, HOME: linkHome }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(JSON.parse(readFileSync(join(linkHome, '.sign-off', 'decisions.json'), 'utf8')).items.map((i) => i.key), ['from-linked-home']);
  assert.equal(existsSync(join(realHome, '.sign-off', 'home-trap.json')), false);
});

test('no board named: doctor checks the nearest setup from a subfolder, a missing HOME uses the working folder, and a folder named ~ is printed quoted', () => {
  const at = (cwd, more, ...args) => spawnSync(process.execPath, [cli, ...asked(args)], { cwd, env: { ...env, ...more }, encoding: 'utf8' });
  const proj = join(scratch, 'doctor-walk'), deep = join(proj, 'src', 'deep');
  mkdirSync(join(proj, '.git'), { recursive: true });
  mkdirSync(deep, { recursive: true });
  assert.equal(at(proj, {}, 'init').status, 0);
  writeFileSync(join(proj, '.sign-off', 'config.yaml'), 'board: decisions.json\nport: 0\n');
  assert.match(at(deep, {}, 'doctor').stdout, /config,"board decisions\.json/);
  assert.equal(at(proj, { HOME: join(scratch, 'no-such-home') }, 'raise', '--title', 'Missing home?').status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(proj, '.sign-off', 'decisions.json'), 'utf8')).items.map((i) => i.key), ['missing-home']);
  assert.match(at(proj, {}, 'doctor', join('~', 'x')).stdout, /init '~\/x'/);
});
