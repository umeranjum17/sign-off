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
import jpeg from 'jpeg-js';
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
const png = readFileSync(new URL('../fixtures/evidence/product-small.png', import.meta.url));
// A plain PNG of a given size, for a capture of a known shape.
const sized = (w, h) => {
  const chunk = (type, data) => { const n = Buffer.alloc(8), t = Buffer.concat([Buffer.from(type), data]); n.writeUInt32BE(data.length); n.writeUInt32BE(crc32(t), 4); return Buffer.concat([n.subarray(0, 4), t, n.subarray(4)]); };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.from(Array.from({ length: (w + 1) * h }, (_, i) => (i % (w + 1) === 0 ? 0 : (i * 37) % 251))))), chunk('IEND', Buffer.alloc(0))]);
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
/** One headless Chrome for the whole file, driven over its DevTools socket. A file of browser tests then starts one browser and waits
 * for one DevToolsActivePort, instead of starting a fresh Chrome for every test on a runner that is already drawing other boards. */
let shared;
const browserFor = async () => {
  if (shared?.proc.exitCode === null && shared.ws.readyState === WebSocket.OPEN) return shared;
  const profile = mkdtempSync(join(scratch, 'chrome-')), active = join(profile, 'DevToolsActivePort');
  const proc = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${profile}`, '--window-size=800,4000', '--remote-debugging-port=0', 'about:blank'],
    { env: chromeEnv, stdio: 'ignore' });
  procs.push(proc);
  await until(() => existsSync(active) && readFileSync(active, 'utf8').includes('\n'));
  const version = await (await fetch(`http://127.0.0.1:${readFileSync(active, 'utf8').split('\n')[0]}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  const replies = new Map();
  let seq = 0;
  ws.onmessage = (m) => { const msg = JSON.parse(m.data), done = replies.get(msg.id); if (!done) return; replies.delete(msg.id); done(msg.result); };
  // A call the browser never answers (a page torn down mid-call) gives undefined after 10 s, so until() asks again instead of hanging.
  const call = (method, params, sessionId) => new Promise((ok) => {
    const id = ++seq;
    replies.set(id, ok);
    setTimeout(() => { if (replies.delete(id)) ok(undefined); }, 10000).unref();
    ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
  });
  return (shared = { proc, ws, call });
};
/** A page of its own in the shared browser: evaluate(js) returns the value, or undefined while a page is still loading. */
async function browse(_dir, width = 800, height = 4000, mobile = false) {
  const { call } = await browserFor();
  // A browser context of its own is a fresh profile per test: no localStorage, cookies or cache from an earlier board on the same port.
  const { browserContextId } = await call('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => call(method, params, sessionId);
  // A step lets the page finish what the last one started (a dialog's close, a hashchange, a click's navigation) before the next
  // command reads the DOM, so a test never acts on a panel the page has already left.
  const settle = () => send('Runtime.evaluate', { expression: 'new Promise((ok) => setTimeout(ok, 0))', awaitPromise: true });
  const evaluate = async (expression) => {
    const value = (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
    await settle();
    return value;
  };
  // On a busy host, input sent right after a redraw can miss the sandboxed frame it aims at, so each input waits for the page to paint first.
  const painted = () => send('Runtime.evaluate', { expression: 'new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))', awaitPromise: true });
  // Headless Chrome keeps a window at least 500 px wide, so the page is set to the asked width as a phone would be.
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  // A real mouse click at a point of the page, which reaches into a frame there as a person's would.
  const click = async ([x, y]) => { await painted(); for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
  // A real touch tap at a point of the page, as a phone's would.
  const tap = async ([x, y]) => { await painted(); await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  // A real finger swipe across the page, as a phone's would.
  const swipe = async (from, to) => {
    await painted();
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  // Text typed as a phone's keyboard does: the browser fires beforeinput and input on the focused field, as an IME commit does.
  const insertText = (text) => send('Input.insertText', { text });
  // A capture of part of the page as the screen shows it, decoded to RGBA.
  const capture = async (clip) => jpeg.decode(Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: 90, clip: { ...clip, scale: 1 } }))?.data ?? '', 'base64'), { useTArray: true });
  return { evaluate, click, tap, swipe, insertText, send, capture, close: () => call('Target.disposeBrowserContext', { browserContextId }).catch(() => {}) };
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
    tradeoff: 'B reads best. Open in first-draft: Calm http://100.64.0.1:4430/#/o/1/play · Bold http://100.64.0.1:4430/#/o/2/play',
    mocks: ['a', 'b', 'c'].map((value) => ({ value, path: 'mocks/page/quiet.html', ...(value === 'b' && { link: 'https://example.com/b' }) })) };
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
  const frame = (key) => new RegExp(`<iframe[^>]*title="Interactive page: ${key}"[^>]*>`).exec(dom)?.[0];
  assert.match(frame('short'), /style="height: 240px;"/);
  assert.match(frame('huge'), /style="height: 10000px;"/);
  assert.doesNotMatch(frame('quiet'), /style=/);
  // Each option is a figure: its label (and the badge) above its frame; the recommended one first, the rest in their order.
  const figures = [...dom.matchAll(/<figure class="mock">(.*?)<\/figure>/g)].map((m) => m[1]);
  assert.deepEqual(figures.map((f) => /class="label"[^>]*>(\w)</.exec(f)[1]), ['B', 'A', 'C']);
  assert.ok(figures.every((f) => f.indexOf('<figcaption') < f.indexOf('class="shot"')), figures[0]);
  assert.match(figures[0], /Recommended/);
  // first-draft's urls in the trade-off become real links on the card, outside the sandboxed frames, and leave the text.
  const links = [...dom.matchAll(/<p class="fd-links"[^>]*>(.*?)<\/p>/g)].map((m) => m[1]);
  assert.equal(links.length, 1);
  assert.deepEqual([...links[0].matchAll(/<a href="([^"]+)" target="_blank" rel="noopener">([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]),
    [['Calm', 'http://100.64.0.1:4430/#/o/1/play'], ['Bold', 'http://100.64.0.1:4430/#/o/2/play']]);
  assert.match(dom, /<p class="tradeoff"[^>]*><strong>Trade-off <\/strong>B reads best\.<\/p>/);
  assert.ok(figures.every((f) => !f.includes('first-draft')));
  // An option's own link is a real anchor under its mock, outside the sandboxed frame; only B has one.
  assert.match(figures[0], /<a class="option-link" href="https:\/\/example\.com\/b" target="_blank" rel="noopener"[^>]*>Open live<\/a>/);
  assert.ok(figures[0].indexOf('</iframe>') < figures[0].indexOf('option-link'));
  assert.equal(figures.filter((f) => f.includes('option-link')).length, 1);
  close();
  proc.kill();
});

test('report and plan documents use one page scroll and the available width at 390 and 1280', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'document-scroll'), file = join(dir, 'board.json');
  mkdirSync(join(dir, 'page'), { recursive: true });
  // A real sandboxed document reports its geometry; the board cannot inspect its opaque origin.
  writeFileSync(join(dir, 'page', 'index.html'), readFileSync(new URL('../fixtures/contract/plan.v1/page/index.html', import.meta.url), 'utf8') + `<style>html{overflow-y:scroll}body{margin:0;font:18px sans-serif}p{margin:0;padding:20px}</style>
    ${'<p>A long public release note, with enough text to wrap on a phone.</p>'.repeat(220)}
    <script>
    const measure = () => parent.postMessage({documentGeometry: {
      height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth,
      scrollbar: innerWidth - document.documentElement.clientWidth, viewport: innerHeight, childViewportWidth: innerWidth, inner: [...document.querySelectorAll('body *')].filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1).length
    }}, '*');
    new ResizeObserver(measure).observe(document.body); addEventListener('resize', measure);
    addEventListener('message', e => { if(e.source === parent && e.data === 'grow') { document.body.insertAdjacentHTML('beforeend', '<p style="height:700px">Late content</p>'); measure(); } });
    measure(); setInterval(measure, 200);</script>`);
  const plan = JSON.parse(readFileSync(new URL('../fixtures/contract/plan.v1/valid-full.json', import.meta.url), 'utf8'));
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
  assert.equal(run('post', file, '--kind', 'plan', '--from', join(dir, 'plan.json')).code, 0);
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  stored.items.push({ contract: 1, kind: 'report', schema: 2, key: 'release', title: 'Latest stable build: muxr 0.2.8', view: 'page/index.html', preview: 'page/preview.svg', filed: new Date().toISOString() });
  writeFileSync(file, JSON.stringify(stored));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const exported = join(dir, 'board.html');
  assert.equal(run('export', file, '--out', exported).code, 0);
  const copyServer = createHttpServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(readFileSync(exported)); });
  await new Promise(ok => copyServer.listen(0, '127.0.0.1', ok));
  after(() => new Promise(ok => copyServer.close(ok)));
  for (const base of [url, `http://127.0.0.1:${copyServer.address().port}/`]) for (const [width, mobile] of [[390, false], [390, true], [1280, false]]) {
    const { evaluate, close } = await browse(dir, width, 844, mobile);
    try {
      await evaluate(`location.href = ${JSON.stringify(base)}`);
      await until(() => evaluate('!!window.state || !!document.querySelector("#board h1")'));
      await evaluate(`addEventListener('message', e => {
        if(e.source !== document.querySelector(':is(#reader, .split-detail) iframe')?.contentWindow) return;
        if(e.data?.documentGeometry) window.geometry = { source: e.source, value: e.data.documentGeometry };
        if(Number.isFinite(e.data?.height)) window.sizedSource = e.source;
      })`);
      for (const hash of ['#reports/release', '#waiting/plan-kind-board']) {
        await evaluate(`window.geometry = null; window.sizedSource = null; location.hash = ${JSON.stringify(hash)}`);
        // On a desk a report reads in the pane beside Reports' list; a plan, and anything on a phone, opens over the board.
        const selector = hash.includes('reports') ? ':is(#reader, .split-detail) .read iframe' : '#reader iframe.plan-view';
        // Read the settled signal and ALL measured values atomically, bound to this route's actual frame.
        const layout = () => evaluate(`(() => {
          const frame = document.querySelector(${JSON.stringify(selector)}), signal = window.geometry, g = signal?.value;
          if (!frame || signal?.source !== frame.contentWindow || window.sizedSource !== frame.contentWindow || frame.clientHeight <= 1
            || g.viewport !== frame.clientHeight || g.childViewportWidth !== frame.clientWidth) return null;
          const page = frame.closest('.read, .plan-main'), rect = frame.getBoundingClientRect(), s = getComputedStyle(page);
          const scrollers = [...document.querySelectorAll('#reader *, .split-detail')].filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1);
          return { ...g, frameHeight: frame.clientHeight, frameWidth: rect.width,
            available: page.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight), scrollers: scrollers.map(e => e.className) };
        })()`);
        let got;
        await until(async () => !!(got = await layout()));
        assert.ok(got.frameHeight >= got.height - 1, `${width} ${hash}: nested document scroll ${JSON.stringify(got)}`);
        assert.ok(got.frameWidth >= got.available - 1, `${width} ${hash}: narrow document frame ${JSON.stringify(got)}`);
        assert.ok(got.width <= got.frameWidth + 1 && got.inner === 0, JSON.stringify(got));
        // A forced document scrollbar must not paint a gutter even after its content fits.
        assert.equal(got.scrollbar, 0, `painted inner scrollbar at ${width}px (mobile=${mobile}): ${JSON.stringify(got)}`);
        assert.deepEqual(got.scrollers, [hash.includes('reports') ? (width === 1280 ? 'split-detail' : 'read') : 'plan-scroll']);
        const previous = got.frameHeight;
        await evaluate(`document.querySelector(${JSON.stringify(selector)}).contentWindow.postMessage('grow', '*')`);
        await until(async () => { const next = await layout();
          if (!next || next.frameHeight <= previous + 600) return false;
          got = next; return true;
        });
        assert.ok(got.frameHeight >= got.height - 1, JSON.stringify(got));
        console.log('document-layout', JSON.stringify({ surface: base === url ? 'live' : 'exported',
          document: hash.includes('reports') ? 'report document' : 'plan document', viewportWidth: width, mobile,
          growth: got.frameHeight - previous, outerScrollContainers: got.scrollers.length, ...got }));
      }
    } finally { close(); }
  }
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
  await evaluate(`location.href = ${JSON.stringify(`${url}#decide/look`)}`);
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
  // The design ask's mocks show on its Decide card.
  const at = JSON.stringify(`${url}#decide/look`);
  const reload = async () => { await evaluate(`window.old = true, location.href === ${at} ? location.reload() : (location.href = ${at})`); await until(() => evaluate(`!window.old && !!${frame}`)); };
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

test('each card has one place to type: Add a comment holds the note sent with the answer, and its More holds the own answer, another round and a comment on its own, with no separate note link; a report opens full screen and back', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'one-box'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const abc = ['A', 'B', 'C'].map((l) => ({ value: l.toLowerCase(), label: l }));
  const nine = new Date(new Date().setHours(9, 15, 0, 0)).toISOString();
  // A report is the page report init writes, filled in; a text-only report stored before reports had pages is a note, never a report card.
  assert.equal(run('report', 'init', join(dir, 'mocks', 'how'), '--page').code, 0);
  for (const f of ['index.html', 'preview.svg']) writeFileSync(join(dir, 'mocks', 'how', f), readFileSync(join(dir, 'mocks', 'how', f), 'utf8').replace(/FILL: [^<"']*/g, 'Umer taps through it'));
  writeFileSync(file, JSON.stringify({ schema: 2, items: [{ key: 'ship', title: 'When should it ship?', options: abc, recommend_value: 'b', filed: nine },
    { key: 'look', type: 'design', title: 'Pick the look', options: abc, recommend_value: 'b', filed: nine },
    { contract: 1, kind: 'report', schema: 1, key: 'merged', title: 'Merged: the sign-in fix', about: 'Checks passed.', filed: nine },
    { contract: 1, kind: 'report', schema: 2, key: 'how', title: 'How it ships', group: 'How it works', form: 'diagram', video: '0:28', asked_by: 'You asked', filed: new Date().toISOString(), decided: 'Ships only when the check passes.',
      view: 'mocks/how/index.html', preview: 'mocks/how/preview.svg', steps: [{ title: 'Build', marks: ['store'] }, { title: 'Check' }, { title: 'Ship', marks: ['gate', 'fail'] }] }] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const dump = (hash) => new Promise((ok, no) => execFile(chrome, ['--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${join(dir, 'profile')}`,
    '--window-size=800,4000', '--virtual-time-budget=10000', '--dump-dom', url + hash], { env: chromeEnv, maxBuffer: 1 << 24 }, (e, out) => (e ? no(e) : ok(out))));
  const cards = (dom) => [...dom.matchAll(/<article class="row[^"]*" id="item-(\w+)">(.*?)<\/article>/gs)].map((m) => [m[1], m[2]]);
  const waiting = await dump('#waiting');
  assert.match(waiting, /class="lede waiting-lede">2 waiting · each has a recommended answer/);
  // Decide groups its rows: the plain ask under Answer with its recommended pick, the design pick under Review; More holds Answer all recommended and Move all to later, and no sort.
  assert.match(waiting, /<h2 class="dl-head">Answer<span class="n">1<\/span><\/h2><ul class="dl-list" aria-label="Answer">.*?When should it ship\?.*?Recommended <b>B<\/b>/s);
  assert.match(waiting, /<h2 class="dl-head">Review<span class="n">1<\/span><\/h2><ul class="dl-list" aria-label="Review">.*?href="#decide\/look".*?Pick the look.*?Design pick/s);
  assert.match(waiting, /data-act="answer-all"><span>Answer all recommended<\/span>.*?<div class="dl-sep" role="separator"><\/div>.*?data-act="later-all"><span>Move all to later<\/span>/s);
  assert.doesNotMatch(waiting, /data-act="sort"|Oldest first/);
  assert.doesNotMatch(waiting, /<ol class="queue"|<p class="fhead"/);
  // Today: the date over its title and the ring of what was cleared, how many wait, Up next with the recommended answer as its one button,
  // and four tiles counting each group Decide lists; the search sits at the foot.
  const home = await dump('');
  assert.match(home, /<header class="top today-top"><div class="cbar" aria-hidden="true">Today<\/div><p class="kicker date-kicker">[^<]+<\/p><div class="head-row"><h1 tabindex="-1">Today<\/h1><span class="ring" role="img" aria-label="0 of 2 cleared">/);
  assert.match(home, /<p class="sub">2 waiting on you · 0 cleared<\/p>/);
  assert.match(home, /<section class="up-next g-answer" aria-label="Up next"><p class="lk">.*?Up next · Pick one<span class="when">\d\d:\d\d<\/span><\/p><h2 dir="auto">When should it ship\?<\/h2>.*?<span class="lbl">Answer B<\/span>.*?<a class="soft" href="#decide\/ship">Other answer<\/a>/s);
  assert.deepEqual([...home.matchAll(/<a class="tile g-\w+[^"]*" href="([^"]*)" aria-label="([^"]*)"/g)].map((m) => `${m[1]} ${m[2]}`),
    ['#waiting Answer, 1: Each has a pick', '#waiting Review, 1: 1 item to look over', '#waiting Sign in, 0: Nothing waiting', '#evidence Proof, 0: Nothing filed yet']);
  assert.match(home, /<div class="t-foot"><div class="search" role="search"><input type="search" id="find" aria-label="Search the board"/);
  // An ask dismissed from Waiting on you sits under Dismissed (1) at its end, with Restore.
  const gone = file.replace(/\.json$/, '.dismissed.jsonl');
  writeFileSync(gone, JSON.stringify({ key: 'ship', dismissed: true, at: new Date().toISOString() }) + '\n');
  const pages = {};
  for (const hash of ['#waiting']) assert.match(pages[hash] = await dump(hash), /<details class="other gone-asks"><summary>Dismissed \(1\)<\/summary><ul class="rows"><li><strong dir="auto">When should it ship\?<\/strong><button class="dis" aria-label="Restore, When should it ship\?">Restore<\/button><\/li><\/ul><\/details>/, hash);
  // Only the design ask waits now, and it is Up next.
  assert.match(await dump(''), /<p class="sub">1 waiting on you · 0 cleared<\/p>.*?Up next · Review/s);
  // Restore returns the dismissed ask to the grouped list.
  const { evaluate, close } = await browse(join(dir, 'live'));
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  await until(async () => (await evaluate('document.querySelectorAll(".ask-card").length')) === 1);
  await evaluate('document.querySelector(".gone-asks .dis").click()');
  await until(async () => (await evaluate('!document.querySelector(".gone-asks") && document.querySelectorAll(".ask-card").length')) === 2);
  close();
  assert.deepEqual(readFileSync(gone, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map(({ key, dismissed }) => [key, dismissed]), [['ship', true], ['ship', false]]);
  // Reports leads with the date over its title and how many are new, keeps its More at the top right, draws a report's steps as numbered nodes, each with only the marks it lists, and the legend once.
  const reports = await dump('#reports');
  assert.match(reports, /<p class="kicker date-kicker">[^<]+<\/p><h1 tabindex="-1">Reports<\/h1>.*?<p class="lede waiting-lede">1 new · 1 in all<\/p><details class="dl-more"><summary aria-label="More">/s);
  assert.equal(reports.match(/class="card legend"/g).length, 1);
  // The list row has no ×: Dismiss lives on the report's page.
  assert.doesNotMatch(reports, /aria-label="Dismiss, How it ships"/);
  const flow = reports.match(/<ol class="flow"[^>]*>(.*?)<\/ol>/s)[1];
  assert.deepEqual([...flow.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => [...m[1].matchAll(/mk mk-(\w+)/g)].map((x) => x[1])), [['store'], [], ['gate', 'fail']]);
  // Today heads the list with its count; the row is a link that opens it, with its picture, its title and a dot while it is not read, then its form, steps, video, project and time.
  assert.match(reports, /<h2 class="dl-head" style="--n:0">Today<span class="n">1<\/span><\/h2><ul class="dl-list rp-list" aria-label="Today">/);
  assert.match(reports, /<a class="dl-face" href="#reports\/how" draggable="false" id="item-how" data-row=""><span class="rth" aria-hidden="true"><svg viewBox="0 0 48 48">.*?<strong class="title" dir="auto">How it ships<\/strong><span class="new" role="img" aria-label="Not read yet"><\/span>.*?<span class="when">Diagram · 3 steps · Video 0:28 · How it works · \d\d:\d\d<\/span>/s);
  // Under the row, a swipe right marks it read and a swipe left archives it.
  assert.match(reports, /<div class="dl-act yes" aria-hidden="true">.*?<span>Read<\/span><\/div><div class="dl-act later" aria-hidden="true">.*?<span>Archive<\/span><\/div>/s);
  // Only the report is a row and counted; the text-only one is folded under Notes, a short row with no page to open.
  assert.deepEqual([...reports.matchAll(/<li class="report dl-row" style="--n:\d+" data-key="(\w+)"/g)].map((m) => m[1]), ['how']);
  // The sidebar counts what is new under its short name; the phone's tab bar marks Reports as the area on screen and carries a blue count.
  assert.match(reports, /<\/svg><\/span>Reports<span class="n blue">1<\/span>/);
  assert.match(reports, /<a href="#reports" aria-label="Reports, 1 new" aria-current="page"><span class="icon i-reports" aria-hidden="true">.*?<\/span>Reports<span class="bd blue" aria-hidden="true">1<\/span><\/a>/);
  assert.match(reports, /<details class="other notes"><summary>Notes \(1\)<\/summary>.*<strong dir="auto">Merged: the sign-in fix<\/strong>/s);
  // On a phone, a tap on the card opens the report over the whole board with the focus on its title; the board under it takes no taps.
  // ‹ Reports goes back to the card with the focus on its link, and Escape closes it too.
  {
    const { evaluate, tap, swipe, close } = await browse(join(dir, 'reader'), 390);
    await evaluate(`location.href = ${JSON.stringify(`${url}#reports`)}`);
    await until(async () => (await evaluate('document.querySelector("#item-how .flow") && innerWidth')) === 390);
    const at = (sel) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    await tap(await at('#item-how strong'));
    await until(async () => (await evaluate('location.hash')) === '#reports/how');
    // The hash lands before its handler draws the reader, so wait for the drawn reader itself, not just the hash.
    let open;
    await until(async () => (open = await evaluate(`(() => { const f = reader.querySelector('iframe').getBoundingClientRect(); return { hidden: reader.hidden, title: document.activeElement.textContent,
      inert: document.querySelector('main').inert, src: reader.querySelector('iframe').getAttribute('src'), sandbox: reader.querySelector('iframe').getAttribute('sandbox'),
      frame: [f.x, Math.round(f.width) === reader.querySelector('.read').clientWidth - 40], back: reader.querySelector('a').textContent, decided: reader.querySelector('.decided')?.textContent }; })()`))?.src === '/mock/local/how~/index.html');
    // The page sits in a tile inside the phone's gutters, under its title and what it decided.
    assert.deepEqual(open, { hidden: false, title: 'How it ships', inert: true, src: '/mock/local/how~/index.html', sandbox: 'allow-scripts', frame: [20, true], back: '‹ Reports',
      decided: 'What it decidedShips only when the check passes.' });
    // The page itself is served: the filled scaffold, with its steps to tap.
    assert.match(await (await fetch(new URL('/mock/local/how~/index.html', url))).text(), /<button type="button" class="next">Next<\/button>/);
    await tap(await at('#reader .close'));
    await until(async () => (await evaluate('location.hash + reader.hidden')) === '#reportstrue');
    assert.deepEqual(await evaluate('[document.activeElement.getAttribute("href"), document.querySelector("main").inert, document.body.className]'), ['#reports/how', false, '']);
    await evaluate('location.hash = "#reports/how"');
    await until(async () => (await evaluate('reader.hidden')) === false);
    await evaluate('dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
    await until(async () => (await evaluate('location.hash + reader.hidden')) === '#reportstrue');
    // Opening it read it, beside the board: back on the list its dot is gone, the lede says so and the tab bar's count is gone.
    const reads = () => readFileSync(file.replace(/\.json$/, '.reads.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map(({ key, read }) => [key, read]);
    await until(async () => (await evaluate('[document.querySelector(".top .lede").textContent, !!document.querySelector(".tabs .bd.blue")].join()')) === '1 report · all read,false');
    assert.deepEqual(reads(), [['how', true]]);
    // A swipe right marks it unread again (the dot and the count come back); a swipe left archives it, and Undo puts it back.
    const y = await evaluate('(() => { const r = document.querySelector("#item-how").getBoundingClientRect(); return r.y + 30; })()');
    await swipe({ x: 40, y }, { x: 360, y });
    await until(async () => (await evaluate('[!!document.querySelector("#item-how .new"), document.querySelector(".tabs .bd.blue")?.textContent, document.getElementById("toast-text").textContent].join()')) === 'true,1,Marked unread: How it ships');
    assert.deepEqual(reads(), [['how', true], ['how', false]]);
    await swipe({ x: 360, y }, { x: 30, y });
    await until(async () => (await evaluate('[!document.querySelector("#item-how"), document.getElementById("toast-text").textContent].join()')) === 'true,Archived: How it ships');
    await evaluate('document.getElementById("undo").click()');
    await until(async () => (await evaluate('!!document.querySelector("#item-how")')));
    assert.deepEqual(readFileSync(file.replace(/\.json$/, '.dismissed.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.key === 'how').map((x) => x.dismissed), [true, false]);
    close();
  }
  // Answered is Done today: a count under the title, Clear all beside it, and a short row per item with its answer and time under the title, beside its ×. Clear all sits at the right of the title.
  writeFileSync(file.replace(/\.json$/, '.answers.jsonl'), ['ship', 'look'].map((key) => JSON.stringify({ key, answer: 'a', label: 'A', close: 'done', at: new Date().toISOString() })).join('\n') + '\n');
  // Once both are answered, nothing needs you: the ring is closed, Up next says all clear, and Cleared today lists both with the answer, each opening its ask, to see or change the answer.
  const after = await dump('');
  assert.match(after, /<span class="ring" role="img" aria-label="2 of 2 cleared">.*?<p class="sub">Everything is answered<\/p>/s);
  assert.match(after, /<section class="up-next clear" aria-label="Up next">.*?<h2>You're all clear<\/h2>/s);
  assert.deepEqual([...after.matchAll(/<a class="lrow" href="#decide\/(\w+)">.*?<b dir="auto">(.*?)<\/b><span dir="auto">(\w+) · \d\d:\d\d<\/span>/gs)].map((m) => [m[1], m[2], m[3]]).sort(), [['look', 'Pick the look', 'A'], ['ship', 'When should it ship?', 'A']]);
  assert.match(after, /<a class="more" href="#answered">Answered \(2\)<\/a>/);
  const answered = await dump('#answered');
  assert.match(answered, /<p class="lede">2 answers today\. Each one has gone back to its agent\.<\/p><div class="bulk">.*?<\/div><\/header><div class="sec-head"><h2>Today<\/h2><\/div>/);
  const lines = [...answered.matchAll(/<summary class="compact">.*?<strong[^>]*>(.*?)<\/strong>.*?<span class="ans"><b[^>]*>(\w+)<\/b><time>\d\d:\d\d<\/time><\/span><\/span><\/summary>.*?<\/details><button class="x" aria-label="Dismiss, [^"]+">×<\/button>/gs)];
  assert.deepEqual(lines.map((m) => [m[1], m[2]]).sort(), [['Pick the look', 'A'], ['When should it ship?', 'A']]);
  // Each row opens to its full card, with its one box.
  const rows = cards(answered);
  assert.deepEqual(rows.map(([key]) => key).sort(), ['look', 'ship']);
  for (const [key, row] of rows) {
    assert.equal(row.match(/<textarea/g)?.length, 1, key);
    assert.match(row, /<details class="other comment"><summary[^>]*>Add a comment<\/summary><textarea[^>]*placeholder="Add a note \(optional\)"[^>]*><\/textarea><div class="actions"><details class="more-menu"><summary[^>]*>More…<\/summary><div class="menu"><button[^>]*>Send as my own answer<\/button><button[^>]*>Ask for another round<\/button><button[^>]*>Send without answering<\/button><\/div><\/details><\/div><\/details>/, key);
    // No help line: the box speaks through its placeholder.
    assert.doesNotMatch(row, /Goes with the answer you pick|<label for="note-/, key);
    assert.doesNotMatch(row, /Note, comment or another round/, key);
  }
  // A dismissed item leaves the page and its counts.
  writeFileSync(file.replace(/\.json$/, '.dismissed.jsonl'), JSON.stringify({ key: 'look', dismissed: true, at: new Date(Date.now() + 1000).toISOString() }) + '\n');
  const left = await dump('#answered');
  assert.deepEqual(cards(left).map(([key]) => key), ['ship']);
  assert.deepEqual([...(await dump('')).matchAll(/<a class="lrow" href="#decide\/\w+">.*?<b dir="auto">(.*?)<\/b>/gs)].map((m) => m[1]), ['When should it ship?']);
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
  const { evaluate, swipe, close } = await browse(join(dir, 'live'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  // A sign-in blocks someone now, so both come before the question, newest first among them.
  const queue = () => evaluate('[...document.querySelectorAll(".ask-card .title")].map((s) => s.textContent).join("|")');
  await until(async () => (await queue()) === 'Sign in to GitHub|Sign in to npm|Keep the weekly digest?');
  // A sign-in's page: its headline, its facts (what it unlocks, a clock of the time left, where it signs in) and its one Open.
  const card = (key) => evaluate(`(() => { const c = document.querySelector("section#item-${key}.signin-ask"), o = c?.querySelector(".open-link");
    return c && [c.querySelector("h2")?.textContent, ...[...c.querySelectorAll(".fact")].map((p) => p.textContent), o ? [o.tagName, o.getAttribute("href"), o.target, o.rel, o.disabled].join(" ") : "no open"].join("|"); })()`);
  // Decide shows the card in focus: the GitHub sign-in is newest, so the npm one is tapped in the queue first.
  await evaluate('document.querySelector("#item-npm-login").click()');
  await until(async () => (await evaluate('location.hash')) === '#decide/npm-login' && (await card('npm-login')) !== null);
  assert.match(await card('npm-login'), new RegExp(`^Sign in to npm\\|UnlocksPublish npm\\|Expires in1[45]:\\d\\d\\|Whereexample\\.com\\|A ${link.replace(/[.?]/g, '\\$&')} _blank noopener noreferrer $`));
  assert.match(await evaluate('document.querySelector(".decide .kicker").textContent'), /^Sign in · Main · \d\d:\d\d$/);
  // A sign-in's More, in its bar, holds Ask me later and Dismiss; it skips on to the next ask like any other, by a swipe left and with E as its key.
  assert.equal(await evaluate('[...document.querySelectorAll(".ask-nav .dl-menu > button")].map((b) => b.textContent).join("|")'), 'Ask me later|Dismiss');
  await swipe({ x: 340, y: 300 }, { x: 40, y: 300 });
  await until(async () => /^#decide\/(?!npm-login)/.test(await evaluate('location.hash')));
  const at = await evaluate('location.hash');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }))');
  await until(async () => (await evaluate('location.hash')) !== at);
  // The page is not loaded again from here on: a mark set now is still there at the end.
  await evaluate('window.stillHere = true');
  // Dismiss on a sign-in's Decide page moves on to the next ask like any other ask, not to "Nothing to decide".
  signin('tmp-login', 'Tmp', 'https://example.com/tmp', '15m');
  await evaluate('location.hash = "#decide/tmp-login"');
  await until(async () => (await card('tmp-login')) !== null);
  await evaluate('document.querySelector(".ask-nav .dis").click()');
  await until(async () => /^#decide\/(?!tmp-login)/.test(await evaluate('location.hash')));
  assert.equal(await evaluate('document.querySelector("#board .empty")?.textContent'), undefined);
  // Past its time the link has nothing left to open: its card leaves what waits and Decide on its own, counted nowhere, and the page is not reloaded.
  await evaluate('location.hash = "#waiting"');
  await until(async () => !(await queue()).includes('GitHub'));
  assert.equal(await evaluate('document.getElementById("item-gh-login")'), null);
  assert.equal(await evaluate('[...document.querySelectorAll(".dl-head")].some((h) => h.textContent === "Sign in1")'), true);
  // The same key with a new link brings it back on the same card, open again.
  assert.match(signin('gh-login', 'GitHub', 'https://example.com/device?code=one-time-3', '10m').out, /gh-login,new link,GitHub,/);
  await until(async () => (await queue()).includes('GitHub'));
  await evaluate('document.querySelector("#item-gh-login").click()');
  await until(async () => (await evaluate('location.hash')) === '#decide/gh-login'
    && /^Sign in to GitHub\|UnlocksPublish GitHub\|Expires in(10:00|9:\d\d)\|Whereexample\.com\|A https:\/\/example\.com\/device\?code=one-time-3 _blank noopener noreferrer $/.test(await card('gh-login')));
  // signin done closes a card: it leaves what waits and shows as done.
  assert.match(run('signin', 'done', file, '--key', 'npm-login').out, /npm-login,done,npm/);
  assert.match(run('signin', 'done', file, '--key', 'npm-login').out, /npm-login,already done,npm/);
  await evaluate('location.hash = "#waiting"');
  await until(async () => !(await queue()).includes('npm'));
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
  // Decide shows one card at a time: tap the key in its queue first.
  const show = (key) => until(async () => evaluate(`document.querySelector("#item-${key}")?.click() ?? true`)
    .then(() => evaluate(`location.hash === "#decide/${key}" && !!document.querySelector("#item-${key} .open-link")`)));
  const tapOpen = async (key) => { await show(key); await evaluate(`document.querySelector("#item-${key} .open-link").click()`); };
  const line = (key) => evaluate(`document.querySelector("#item-${key} .expiry, #item-${key} .meta")?.textContent`);
  await evaluate('location.hash = "#waiting"');
  await show('fresh');
  assert.equal(await line('fresh'), 'Each tap gets a new link.');
  await tapOpen('fresh');
  await until(async () => (await evaluate('window.tabUrl')) === 'https://example.com/login?x=1' && (await line('fresh')) === 'The sign-in page is open. Finish it there.');
  // A second tap while it runs gives the same link from the same run.
  assert.equal((await (await post(url, 'api/signin', { key: 'fresh' })).json()).open, 'https://example.com/login?x=1');
  await evaluate('location.hash = "#waiting"');
  // A run that fails says why on the card, and Open stays on to try again.
  await tapOpen('broken');
  await until(async () => (await line('broken')) === 'The last try failed: It stopped with exit code 3. Tap Open to try again.');
  assert.equal(await evaluate('document.querySelector("#item-broken .open-link").disabled'), false);
  // Its exit 0 is the sign-in done: the card closes by itself.
  writeFileSync(join(dir, 'signed-in'), '');
  await evaluate('location.hash = "#waiting"');
  await until(async () => /fresh,done,/.test(run('answers', file).out) && !(await queue()).includes('fresh'));
  assert.equal(await evaluate('window.stillHere'), true);
  close();
  proc.kill();
});

test('Decide on the page: a guided plan with no decisions is read under Reports, one with a decision waits', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'reading'), file = join(dir, 'board.json'), fixture = new URL('../fixtures/contract/plan.v2/valid-full.json', import.meta.url).pathname;
  mkdirSync(dir);
  const plan = JSON.parse(readFileSync(fixture));
  writeFileSync(join(dir, 'open.json'), JSON.stringify(plan));
  writeFileSync(join(dir, 'reading.json'), JSON.stringify({ ...plan, key: 'for-reading', title: 'A plan to read', decisions: [] }));
  for (const f of ['open', 'reading']) assert.equal(run('post', file, '--kind', 'plan', '--from', join(dir, `${f}.json`)).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  const count = (tab) => evaluate(`[...document.querySelectorAll("#nav a")].find((a) => a.textContent.startsWith("${tab}"))?.querySelector(".n")?.textContent`);
  await until(async () => (await count('Decide')) === '1');
  assert.equal(await evaluate('document.querySelectorAll(".g-review .dl-face[href^=\'#waiting/\']").length'), 1);
  assert.equal(run('list', file).out.includes('for-reading'), false);
  await evaluate('location.hash = "#reports"');
  await until(async () => (await count('Reports')) === '1' && (await evaluate('document.getElementById("board").textContent')).includes('A plan to read'));
  close();
  proc.kill();
});

test('a guided report: item detail keeps its line breaks, same-axis options read as one comparison table at 390 and 1280, and an item with no detail keeps its buttons inside its padding', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'compare'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const report = JSON.parse(readFileSync(new URL('../fixtures/contract/report.v4/valid-full.json', import.meta.url)));
  const option = (title, tone, text, models, safety) => ({ title, tone, text, more: `Models: ${models}.\nScripted: yes, with JSON output (github.com/example-org/example-agent/issues/10415).\nSafety: ${safety}.` });
  report.sections.push({ id: 'compare', stage: 'found', heading: 'Three engines on the same 3 points', body: 'Each option on the same points.', items: [
    option('pi: the pick', 'ok', 'Pros: any model. Cons: one open hang.', 'any, through providers', 'no leak reported'),
    option('Codex CLI: the backup', 'warn', 'Pros: mature. Cons: adds a daemon.', 'OpenAI first', 'a background service'),
    option('OpenCode: not now', 'bad', 'Pros: many features. Cons: key leak.', 'any', 'keys may have leaked on 17 Oct')] },
  { id: 'lines', stage: 'found', heading: 'Three steps', body: 'One per line.', items: [{ title: 'The steps', text: 'Tap for all three.', more: 'Close the input.\nPin the version.\nReady the backup.' }] });
  // Filed now, so it is listed under Reports rather than archived as old.
  report.filed = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  const posted = run('post', file, '--kind', 'report', '--from', join(dir, 'report.json'));
  assert.equal(posted.code, 0, posted.out);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  for (const width of [390, 1280]) {
    const { evaluate, close } = await browse(join(dir, `b${width}`), width, 2400);
    try {
      await evaluate(`location.href = ${JSON.stringify(`${url}#reports/${report.key}`)}`);
      await until(() => evaluate('!!document.querySelector("#gd-compare .gd-ct")'));
      const table = await evaluate(`(() => {
        const t = document.querySelector('#gd-compare .gd-ct'), shown = (e) => e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
        const cell = (r, c) => t.tBodies[0].rows[r].cells[c];
        return { tableLayout: getComputedStyle(t).display, list: !!document.querySelector('#gd-compare .gd-rows'),
          heads: [...t.tHead.rows[0].cells].slice(1).map((c) => c.textContent), axes: [...t.tBodies[0].rows].map((r) => r.cells[0].textContent),
          safety: cell(3, 3).textContent, optionInCell: shown(cell(1, 1).querySelector('.ol')), headShown: t.tHead.getBoundingClientRect().height > 1,
          wide: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          outside: [...t.querySelectorAll('th, td')].filter((c) => c.getBoundingClientRect().right > t.closest('.gd-sec').getBoundingClientRect().right).length };
      })()`);
      assert.deepEqual([table.list, table.heads, table.axes, table.safety], [false, ['pi: the pick', 'Codex CLI: the backup', 'OpenCode: not now'], ['In short', 'Models', 'Scripted', 'Safety'], 'OpenCode: not nowkeys may have leaked on 17 Oct.'], JSON.stringify(table));
      // Options run across on a desk; on a phone each point lists every option under it, named in its cell.
      assert.deepEqual([table.tableLayout, table.headShown, table.optionInCell], width === 1280 ? ['table', true, false] : ['block', false, true], `${width}: ${JSON.stringify(table)}`);
      assert.deepEqual([table.wide, table.outside], [false, 0], `${width}: ${JSON.stringify(table)}`);
      // The stacked table at 390 reads at the 16 px body size; with room for columns it is the 13 px table.
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('#gd-compare .gd-ct td')).fontSize`), width === 1280 ? '13px' : '16px', `${width}`);
      // Detail that is not a table keeps one line per point.
      await evaluate(`document.querySelector('#gd-lines .rowbtn').click()`);
      const lines = await evaluate(`(() => { const f = document.querySelector('#gd-lines .body [data-sf="more"]') ?? document.querySelector('#gd-lines .body .gd-md'), r = document.createRange(), tops = new Set(), walk = document.createTreeWalker(f, NodeFilter.SHOW_TEXT);
        for (let n; (n = walk.nextNode());) if (n.data.trim()) { r.selectNodeContents(n); for (const b of r.getClientRects()) tops.add(Math.round(b.top)); }
        return { text: f.textContent, lines: [...f.querySelectorAll('p')].map((p) => p.textContent), tops: tops.size }; })()`);
      assert.deepEqual(lines, { text: 'Close the input.\nPin the version.\nReady the backup.', lines: ['Close the input.', 'Pin the version.', 'Ready the backup.'], tops: 3 }, `${width}`);
      // An item with no detail draws its buttons inside the item's own padding, as an opened item does.
      const pad = await evaluate(`(() => { const li = [...document.querySelectorAll('#gd-found .gd-rows > li')].find((l) => l.textContent.startsWith('One password entry')), box = li.getBoundingClientRect(), text = li.querySelector('.rowstat .sm').getBoundingClientRect();
        const shown = [...li.querySelectorAll('button, input')].filter((b) => b.getClientRects().length); return { buttons: shown.length, outside: shown.filter((b) => { const r = b.getBoundingClientRect(); return r.left < text.left - 0.5 || r.right > box.right - 8; }).length }; })()`);
      assert.ok(pad.buttons >= 4 && pad.outside === 0, `${width}: ${JSON.stringify(pad)}`);
    } finally { close(); }
  }
  proc.kill();
});

// A capture of a report is a desktop screenshot: on a phone its tap stays on the board's own live page, never the raw file shrunk in a tab.
test('a capture opens the raw file on a desk and its own live screen on a phone', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'raw-capture'), file = join(dir, '.sign-off', 'decisions.json');
  mkdirSync(dir);
  run('init', dir);
  writeFileSync(join(dir, 'wide.png'), sized(600, 300));
  assert.equal(run('post', file, '--type', 'evidence', '--title', 'The engine report', '--about', 'Umer reads it.', '--media', join(dir, 'wide.png')).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  for (const width of [390, 1280]) {
    const { evaluate, close } = await browse(join(dir, `b${width}`), width, 2400);
    try {
      await evaluate(`location.href = ${JSON.stringify(`${url}#evidence/update-1`)}`);
      await until(() => evaluate('!!document.querySelector(".ev-hero a")'));
      const link = await evaluate('(() => { const a = document.querySelector(".ev-hero a"); return [a.getAttribute("href").replace(/&h=[0-9a-f]{16}$/, ""), a.target]; })()');
      assert.deepEqual(link, width === 390 ? ['#evidence/update-1', ''] : ['/api/media?key=update-1&i=0', '_blank'], `${width}: ${link}`);
    } finally { close(); }
  }
  proc.kill();
});

// Waiting and Decide cards retain the existing filters and answer/undo API path.
test('Waiting and Decide: Spacious ask cards, decision options, answer and undo, with plan card navigation', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'types'), file = join(dir, 'board.json');
  mkdirSync(dir);
  mkdirSync(join(dir, 'mocks'));
  writeFileSync(join(dir, 'mocks', 'one.webp'), readFileSync(new URL('../docs/media/phone-light.webp', import.meta.url)));
  const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'digest', title: 'Keep the weekly digest?', about: 'Open rate held steady.', options: yesNo, recommend_value: 'yes' },
    { key: 'release', title: 'Which day for release?', why: 'The release needs one calm day.', about: 'Two quiet weeks since the last release.', options: ['today', 'friday', 'next-week'].map((v) => ({ value: v, label: v })), recommend_value: 'friday' },
    { key: 'look', type: 'design', title: 'Pick the look', options: [
      { value: 'a', label: 'A', outcome: 'Fastest. Support is thin on Saturday.' },
      { value: 'b', label: 'B', outcome: 'Full support team on the day.' },
      { value: 'c', label: 'C', outcome: 'Safest. One more week of waiting.' }
    ], recommend_value: 'b', tradeoff: 'No new bugs in three weeks, and support is fully staffed on Friday.', default_if_silent: 'c', mocks: [{ value: 'b', path: 'mocks/one.webp' }] }
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  const askTitles = () => evaluate('[...document.querySelectorAll(".ask-card .title")].map((s) => s.textContent).join("|")');
  const heads = () => evaluate('[...document.querySelectorAll(".dl-head")].map((h) => h.textContent).join("|")');
  // A More item: the menu opens, then the item is tapped.
  const more = (act) => evaluate(`(() => { const m = document.querySelector(".top .dl-more"); m.open = true; m.querySelector('[data-act="${act}"]').click(); return true; })()`);
  // Decide groups the asks, newest first in each group: the two to answer, then the design pick to review.
  await until(async () => (await askTitles()) === 'Which day for release?|Keep the weekly digest?|Pick the look');
  assert.equal(await evaluate('document.querySelector(".waiting-lede").textContent'), '3 waiting · each has a recommended answer');
  assert.equal(await heads(), 'Answer2|Review1');
  // Each kind has its mark: a checklist for a pick, a question for yes or no, a phone for a design to look over.
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".ask-card .icon")].map((s) => [s.className, (s.querySelector("path")?.getAttribute("d") ?? "").length > 10])'),
    [['icon i-pick', true], ['icon i-yesno', true], ['icon i-phone', true]]);
  // A row names the pick it recommends; a design pick, reviewed before it is answered, says what it is.
  assert.equal(await evaluate('[...document.querySelectorAll(".dl-face .sub")].map((s) => s.textContent).join("|")'), 'Recommended friday · Agent|Recommended Yes · Agent|Design pick · Agent');
  await evaluate('document.querySelector("#item-look").click()');
  await until(async () => (await evaluate('location.hash')) === '#decide/look');
  assert.equal(await evaluate('document.querySelector(".decide .why")?.textContent'), 'No new bugs in three weeks, and support is fully staffed on Friday.');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".decide-preview .mock")].map((f) => [f.querySelector(".label").textContent, f.querySelector(".shot.none")?.textContent ?? null])'),
    [['B', null], ['A', 'No mock for this option'], ['C', 'No mock for this option']]);
  assert.equal(await evaluate('document.querySelector(".silent-line")?.textContent'), 'If you stay quiet, the agent goes with C.');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".pick-option"), "::before").content'), 'none');
  // The bar sits under the last card and the quiet line once the page scrolls to its end.
  await evaluate('scrollTo(0, 1e5)');
  assert.equal(await evaluate('(() => { const b = document.querySelector(".decide-bar").getBoundingClientRect().top; return document.querySelector(".pick-list").getBoundingClientRect().bottom <= b && document.querySelector(".decide > .silent-line").getBoundingClientRect().bottom <= b; })()'), true);
  // One button in the bar, and More in the ask's own bar at the top, both big enough for a thumb.
  assert.equal(await evaluate('[...document.querySelectorAll(".decide-bar > *")].map((e) => e.className).join() + "|" + [document.querySelector(".decide-bar .answer"), document.querySelector(".ask-nav > .dl-more > summary")].map((e) => e.getBoundingClientRect().height >= 44).join()'), 'answer|true,true');
  await evaluate('location.hash = "#waiting"');
  await until(async () => (await askTitles()) === 'Which day for release?|Keep the weekly digest?|Pick the look');
  // More on the list holds no sort: Decide reads newest first.
  assert.equal(await evaluate('[...document.querySelectorAll(".top .dl-more [data-act]")].map((b) => b.dataset.act).join("|")'), 'answer-all|later-all');
  // Today's Up next is the first ask Decide lists with a recommended answer, and Other answer opens it; the Review tile opens Decide at its group, whose head flashes.
  await evaluate('location.hash = ""');
  await until(async () => (await evaluate('document.querySelector(".up-next h2")?.textContent')) === 'Which day for release?');
  assert.equal(await evaluate('document.querySelector(".up-next .go .lbl").textContent + "|" + document.querySelector(".up-next .soft").textContent'), 'Answer friday|Other answer');
  await evaluate('document.querySelector(".up-next .soft").click()');
  await until(async () => await evaluate('location.hash === "#decide/release" && document.querySelector(".decide h2")?.textContent === "Which day for release?"'));
  await evaluate('location.hash = ""');
  await until(async () => (await evaluate('document.querySelector(".tile.g-review .n")?.textContent')) === '1');
  await evaluate('document.querySelector(".tile.g-review").click()');
  await until(async () => (await evaluate('location.hash + "|" + document.querySelector(".dl-head.flash")?.firstChild.textContent')) === '#waiting|Review');
  await evaluate("location.hash = '#waiting'");
  await until(async () => (await evaluate('location.hash')) === '#waiting');
  // Decide shows the ask's context line when it carries no reason text of its own.
  await evaluate('location.hash = "#decide/digest"');
  await until(async () => (await evaluate('location.hash')) === '#decide/digest');
  assert.equal(await evaluate('document.querySelector(".decide .why")?.textContent'), 'Open rate held steady.');
  // Answer, undo, then accept by keyboard so the Waiting list and its toast reflect the durable answer.
  await evaluate("location.hash = '#waiting'");
  await until(async () => (await askTitles()) === 'Which day for release?|Keep the weekly digest?|Pick the look');
  // On a phone the ask pushes in over the list.
  assert.equal(await evaluate('new Promise((ok) => { document.querySelector(`a[href="#decide/release"]`).click(); setTimeout(() => ok(location.hash + "|" + document.getElementById("board").classList.contains("push")), 30); })'), '#decide/release|true');
  await until(async () => (await evaluate('location.hash')) === '#decide/release');
  assert.equal(await evaluate('document.querySelector(".decide h2").textContent'), 'Which day for release?');
  // A reason text wins over the ask's context line.
  assert.equal(await evaluate('document.querySelector(".decide .why").textContent'), 'The release needs one calm day.');
  // Three answers then Your own answer; nothing is picked yet: Recommended is a tag on its card, and the button waits, off, until a pick.
  assert.equal(await evaluate('[...document.querySelectorAll(".pick-option")].map((b) => b.querySelector(".label").textContent + (b.querySelector(".recommend") ? "*" : "") + ":" + b.getAttribute("aria-pressed")).join("|")'),
    'today:false|friday*:false|next-week:false|Your own answer:false');
  assert.equal(await evaluate('(() => { const a = document.querySelector(".decide-bar .answer"); return a.textContent + "|" + a.disabled; })()'), 'Pick an answer|true');
  // A pick slides the button's label to it; the answer turns the button green with a check, then the next ask opens, with Back to the one just answered.
  await evaluate('document.querySelector(".pick-option").click()');
  assert.equal(await evaluate('document.querySelector(".decide-bar .answer").textContent + "|" + document.querySelector(".answer .lbl").classList.contains("swap")'), 'Answer today|true');
  await evaluate('document.querySelector(".decide-bar .answer").click()');
  assert.equal(await evaluate('document.querySelector(".decide-bar .answer").classList.contains("done")'), true);
  await until(async () => (await evaluate('[location.hash, document.querySelector(".ask-nav .back")?.textContent, document.querySelector(".ask-nav .back")?.getAttribute("href")].join("|")')) === '#decide/digest|Back|#decide/release');
  await until(async () => (await evaluate('!document.querySelector("#toast").hidden && document.querySelector("#toast").dataset.mark')) === 'ok');
  assert.match(run('answers', file, '--key', 'release').out, /today/);
  // On the list it is under Answered.
  await evaluate("location.hash = '#waiting'");
  await until(async () => (await askTitles()) === 'Keep the weekly digest?|Pick the look' && (await heads()) === 'Answer1|Review1|Answered1');
  // Undo on the list puts the row back in place, with a flash, and stays on the list.
  await evaluate('document.querySelector("#undo").click()');
  await until(async () => !/today/.test(run('answers', file, '--key', 'release').out));
  await until(async () => (await askTitles()) === 'Which day for release?|Keep the weekly digest?|Pick the look');
  assert.equal(await evaluate('location.hash'), '#waiting');
  await evaluate("location.hash = '#decide/release'");
  await until(async () => (await evaluate('location.hash')) === '#decide/release' && (await evaluate('document.querySelectorAll(".pick-option").length')) === 4);
  // A number picks that answer, and Enter sends it.
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }))');
  assert.equal(await evaluate('document.querySelector(".decide-bar .answer").textContent'), 'Answer today');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))');
  // On a phone the answer opens the next ask once its check has played; waiting for that keeps the late step from landing on Answered below.
  await until(async () => /today/.test(run('answers', file, '--key', 'release').out) && (await evaluate('location.hash')) === '#decide/digest');
  // An undo of a changed answer from Answered puts it back and stays there; Decide opens the answered ask with its answer, and says so for a key it does not have.
  await evaluate("location.hash = '#answered'");
  await until(async () => (await evaluate('document.querySelectorAll("#item-release .choices button").length')) === 3);
  await evaluate('[...document.querySelectorAll("#item-release .choices button")].find((b) => b.textContent.startsWith("friday")).click()');
  await until(async () => /friday/.test(run('answers', file, '--key', 'release').out));
  await evaluate('document.querySelector("#undo").click()');
  await until(async () => /today/.test(run('answers', file, '--key', 'release').out));
  assert.equal(await evaluate('location.hash'), '#answered');
  await evaluate("location.hash = '#decide/release'");
  await until(async () => (await evaluate('document.querySelector(".decide .ans-card b")?.textContent + "|" + document.querySelector(".decide-bar .answer")?.textContent')) === 'today|Change answer');
  await evaluate("location.hash = '#decide/nope'");
  await until(async () => (await evaluate('document.querySelector("#board .empty")?.textContent')) === 'Nothing to decide for that question.');
  await evaluate("location.hash = '#waiting'");
  await until(async () => (await evaluate('location.hash')) === '#waiting');
  // A posted plan waits with the asks: its card gives the title, its counts and one Open plan, which opens its page over the board with the pointing script.
  const fixture = new URL('../fixtures/contract/plan.v1/', import.meta.url).pathname;
  mkdirSync(join(dir, 'page'));
  writeFileSync(join(dir, 'page', 'index.html'), readFileSync(join(fixture, 'page', 'index.html')));
  assert.equal(run('post', file, '--kind', 'plan', '--from', join(fixture, 'valid-full.json')).code, 0);
  await evaluate('window.old = true, location.reload()');
  await until(() => evaluate('!window.old'));
  // The plan is a row under Review: its title and how many sections and decisions it holds; the page never scrolls sideways.
  await until(async () => (await heads()) === 'Answer1|Review2|Answered1');
  const planRow = 'document.getElementById("item-plan-kind-board")';
  assert.equal(await evaluate(`${planRow}.querySelector(".title").textContent + "|" + ${planRow}.querySelector(".sub").textContent + "|" + ${planRow}.getAttribute("href")`), 'Show plans on the board|5 sections · 2 decisions|#waiting/plan-kind-board');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true);
  // Move all to later, from More: every row goes under Later, with a toast and Undo, which brings them back.
  await more('later-all');
  await until(async () => (await heads()) === 'Later3|Answered1');
  await evaluate('document.getElementById("undo").click()');
  await until(async () => (await heads()) === 'Answer1|Review2|Answered1');
  await evaluate(`${planRow}.click()`);
  await until(async () => (await evaluate('location.hash + "|" + document.querySelector("#reader iframe")?.title')) === '#waiting/plan-kind-board|Plan: Show plans on the board');
  await until(async () => await evaluate('document.querySelector("#reader .plan-view")?.clientHeight > 100'));
  assert.equal(await evaluate('document.querySelector(".plan-scroll").getBoundingClientRect().bottom <= document.querySelector(".plan-send").getBoundingClientRect().top'), true);
  assert.equal(await evaluate('document.querySelector(".plan-summary").textContent.includes("5 sections") && document.querySelector(".plan-next").textContent === "Go to next"'), true);
  await evaluate('document.querySelector(".plan-next").click()');
  await evaluate('document.querySelector(".plan-next").click()');
  const view = await evaluate('fetch(document.querySelector("#reader iframe").src).then(async (r) => [r.headers.get("content-security-policy"), await r.text()])');
  assert.match(view[0], /connect-src 'none'.*sandbox allow-scripts$/);
  // The way back leads to Decide with the plan still shown, and focus on its row.
  await evaluate('document.querySelector("#reader .close").click()');
  await until(async () => (await evaluate('location.hash + "|" + document.activeElement.id')) === '#waiting|item-plan-kind-board');
  // Review through the real controls: a Change must have a note, drafts survive reload, and Send back returns every answer.
  await evaluate(`${planRow}.click()`);
  await until(async () => await evaluate('!!document.querySelector(".plan-send .open-link:disabled")'));
  await evaluate('document.querySelectorAll(".plan-verdicts .approve").forEach((b) => b.click()); document.querySelector(".plan-verdicts .change").click(); document.querySelectorAll(".plan-decision .choices").forEach((c) => c.querySelector("button").click())');
  assert.equal(await evaluate('document.querySelector(".plan-send .open-link").disabled'), true);
  await evaluate('(() => { const t = document.querySelector(".plan-section textarea"); t.value = "Keep the desktop layout too."; t.dispatchEvent(new Event("input")); })()');
  await evaluate('window.old = true, location.reload()');
  await until(() => evaluate('!window.old'));
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
  // A plan with one section and no decisions reads in the singular.
  assert.equal(run('post', file, '--kind', 'plan', '--from', join(fixture, 'valid-minimal.json')).code, 0);
  await evaluate('location.hash = "#waiting"');
  await evaluate('window.old = true, location.reload()');
  await until(() => evaluate('!window.old'));
  await until(async () => (await evaluate('document.querySelector("#item-plan-filter-waiting .sub")?.textContent')) === '1 section · 0 decisions');
  close();
  proc.kill();
});

// Waiting on you sorts by when each ask was filed, not by where it sits in the file: an ask re-filed later leads the newest-first list.
test('Waiting on you: newest first follows each ask\'s filed time, and an ask with no filed time keeps its place in the file', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
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
  const queue = () => evaluate('[...document.querySelectorAll(".ask-card .title")].map((s) => s.textContent).join("|")');
  await until(async () => (await queue()) === 'Plain ask|Relinked ask|Older ask');
  close();
  proc.kill();
});

test('Waiting on you: a board with no filed times lists newest first as the file reversed', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
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
  const queue = () => evaluate('[...document.querySelectorAll(".ask-card .title")].map((s) => s.textContent).join("|")');
  await until(async () => (await queue()) === 'Third ask|Second ask|First ask');
  close();
  proc.kill();
});

// Fed boards arrive with shapes the poster chose: a stored type-ask keeps its stored type but shows the type its shape answers as,
// and one shared classifier names every ask, so a row with no recommended pick says the type its shape answers as.
test('Waiting on you: a reply-only ask shows Reply, a type-ask yes/no shows Yes/No, and a decision with mocks but no design type shows Pick one', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'fed-types'), file = join(dir, 'board.json');
  mkdirSync(join(dir, 'mocks', 'a'), { recursive: true });
  mkdirSync(join(dir, 'mocks', 'b'));
  writeFileSync(join(dir, 'mocks', 'a', 'index.html'), '<h1>Cover A</h1>');
  writeFileSync(join(dir, 'mocks', 'b', 'index.html'), '<h1>Cover B</h1>');
  const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
  writeFileSync(file, JSON.stringify({ schema: 2, answers_only: true, items: [
    { key: 'ready', type: 'ask', title: 'Say ready when you are', options: [], reply: true },
    { key: 'ship', type: 'ask', title: 'Ship it?', options: yesNo },
    { key: 'cover', title: 'Pick a cover', options: ['a', 'b'].map((v) => ({ value: v, label: v.toUpperCase() })), recommend_value: 'b',
      mocks: [{ value: 'a', path: 'mocks/a/index.html' }, { value: 'b', path: 'mocks/b/index.html' }] },
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  const titles = () => evaluate('[...document.querySelectorAll(".ask-card .title")].map((s) => s.textContent).join("|")');
  await until(async () => (await titles()) === 'Pick a cover|Ship it?|Say ready when you are');
  assert.equal(await evaluate('[...document.querySelectorAll(".dl-face .sub")].map((s) => s.textContent).join("|")'), 'Recommended B · Agent|Yes/No · Agent|Reply · Agent');
  await evaluate('document.querySelector("#item-ship").click()');
  await until(async () => (await evaluate('location.hash')) === '#decide/ship');
  assert.equal(await evaluate('document.querySelector(".decide .eyebrow")'), null); // no kind eyebrow on Decide
  assert.equal(await evaluate('[...document.querySelectorAll(".pick-option .label")].map((l) => l.textContent).join("|")'), 'Yes|No|Your own answer');
  await evaluate('location.hash = "#waiting"');
  await evaluate('document.querySelector("#item-ready").click()');
  await until(async () => (await evaluate('location.hash')) === '#decide/ready');
  // A reply ask is only words: its box is open, and Send answer waits for them.
  assert.equal(await evaluate('document.querySelectorAll(".decide .pick-option").length'), 0);
  assert.equal(await evaluate('(() => { const b = document.querySelector(".decide .own-box"), a = document.querySelector(".decide-bar .answer"); return b.placeholder + "|" + a.textContent + "|" + a.disabled; })()'), 'Your reply|Send answer|true');
  await evaluate('location.hash = "#waiting"');
  await evaluate('document.querySelector("#item-cover").click()');
  await until(async () => (await evaluate('location.hash')) === '#decide/cover');
  assert.equal(await evaluate('document.querySelectorAll(".decide-preview .mock").length'), 2);
  close();
  proc.kill();
});

test('Decide on a pick-one ask: nothing is picked until you pick and the button then names the pick, Your own answer is the last card and opens one box whose words Send answer sends, one note goes with any pick, More holds only Ask me later and Dismiss, and E moves to the next ask', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'decide-option-box'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const abc = ['A', 'B', 'C'].map((l) => ({ value: l.toLowerCase(), label: l }));
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'alpha', title: 'Alpha question?', options: abc, recommend_value: 'a' },
    { key: 'beta', title: 'Beta question?', options: abc, recommend_value: 'b' },
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 1280);
  await evaluate(`location.href = ${JSON.stringify(`${url}#decide/beta`)}`);
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === 'Beta question?');
  const cards = () => evaluate('[...document.querySelectorAll(".decide .pick-option")].map((b) => b.querySelector(".label").textContent + (b.querySelector(".recommend") ? "*" : "") + ":" + b.getAttribute("aria-pressed")).join("|")');
  const button = () => evaluate('(() => { const a = document.querySelector(".decide-bar .answer"); return a.textContent + "|" + a.disabled; })()');
  // The answers then Your own answer, each a card of its own with a radio before its words; nothing is picked, Recommended is only a tag, and the button waits, off.
  assert.equal(await cards(), 'A:false|B*:false|C:false|Your own answer:false');
  assert.equal(await evaluate('(() => { const rows = [...document.querySelectorAll(".decide .pick-list > li")]; return rows.length === 4 && rows.every((li) => li.firstElementChild?.classList.contains("pick-option") && li.firstElementChild.firstElementChild.classList.contains("check")) && getComputedStyle(rows[1].firstElementChild).borderTopLeftRadius !== "0px" && rows[1].getBoundingClientRect().top > rows[0].getBoundingClientRect().bottom; })()'), true);
  assert.equal(await button(), 'Pick an answer|true');
  // One note, open under the cards with no toggle to find it, and no box for your own answer until you pick it.
  assert.equal(await evaluate('[!!document.querySelector(".decide .note-field .note-box"), !!document.querySelector(".decide details"), document.querySelector(".decide .own-field").getBoundingClientRect().height].join("|")'), 'true|false|0');
  // More, in the bar over the ask, holds only Ask me later and Dismiss, in red.
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".split-bar .dl-menu > button")].map((b) => [b.textContent, b.classList.contains("dis")])'), [['Ask me later', false], ['Dismiss', true]]);
  await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }))');
  await until(async () => (await evaluate('location.hash')) === '#decide/alpha');
  await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }))');
  await until(async () => (await evaluate('location.hash')) === '#decide/beta');
  // A pick names itself on the button, and the note goes with it.
  await evaluate('document.querySelectorAll(".decide .pick-option")[2].click()');
  assert.equal(await cards(), 'A:false|B*:false|C:true|Your own answer:false');
  assert.equal(await button(), 'Answer C|false');
  await evaluate('(() => { const t = document.querySelector(".decide .note-box"); t.value = "Only after the release"; t.dispatchEvent(new Event("input")); })()');
  await evaluate('document.querySelector(".decide-bar .answer").click()');
  await until(async () => JSON.parse(run('answers', file, '--json').out).beta?.answer === 'c');
  assert.equal(JSON.parse(run('answers', file, '--json').out).beta.note, 'Only after the release');
  // Answered, the desk moves on to the next ask. Your own answer opens its one box, the note steps aside, and the button reads Send answer, off until there are words.
  await until(async () => (await evaluate('location.hash + "|" + document.querySelector(".split-detail .decide h2")?.textContent')) === '#decide/alpha|Alpha question?');
  await evaluate('(() => { const t = document.querySelector(".decide .note-box"); t.value = "A note that stays behind"; t.dispatchEvent(new Event("input")); })()');
  await evaluate('document.querySelector(".decide .own-option").click()');
  assert.equal(await cards(), 'A*:false|B:false|C:false|Your own answer:true');
  assert.equal(await button(), 'Send answer|true');
  await until(async () => (await evaluate('document.querySelector(".decide .own-field").getBoundingClientRect().height')) > 60);
  assert.equal(await evaluate('[document.activeElement === document.querySelector(".decide .own-box"), getComputedStyle(document.querySelector(".decide .note-field")).display].join("|")'), 'true|none');
  await evaluate('(() => { const t = document.querySelector(".decide .own-box"); t.value = "Ship it Thursday"; t.dispatchEvent(new Event("input")); })()');
  assert.equal(await button(), 'Send answer|false');
  await evaluate('document.querySelector(".decide-bar .answer").click()');
  await until(async () => /alpha,text,/.test(run('answers', file).out));
  assert.equal(JSON.parse(run('answers', file, '--json').out).alpha.note, 'Ship it Thursday');
  close();
  proc.kill();
});

test('Add a comment on every answer: a yes/no on a phone and a pick-one on a desk each send the one note under the cards with the answer picked, More holds only Ask me later and Dismiss, an answer with no note carries none, typing leaves no focus ring, and answers reads it back', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'answer-comment'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], abc = ['A', 'B', 'C'].map((l) => ({ value: l.toLowerCase(), label: l }));
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'feel', title: 'Does the new feel look right?', options: yesNo, recommend_value: 'yes' },
    { key: 'layout', title: 'Which layout first?', options: abc, recommend_value: 'a' },
    { key: 'quick', title: 'Keep the weekly digest?', options: yesNo, recommend_value: 'yes' },
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  // The note is one box between the cards and the bar, open with no toggle to find it; what is typed goes with the answer picked.
  const comment = async ({ evaluate, insertText }, key, text) => {
    await evaluate(`location.href = ${JSON.stringify(`${url}#decide/${key}`)}`);
    await until(async () => (await evaluate('document.querySelector(".decide .pick-option") && location.hash')) === `#decide/${key}`);
    assert.deepEqual(await evaluate(`(() => { const box = document.querySelector('.decide .note-box'), list = document.querySelector('.decide .pick-list'), bar = document.querySelector('.decide .decide-bar');
      return { shown: box.getClientRects().length > 0, after: !!(list.compareDocumentPosition(box) & 4), before: !!(box.compareDocumentPosition(bar) & 4), head: box.previousElementSibling.textContent, placeholder: box.placeholder, toggles: document.querySelectorAll('.decide details').length }; })()`),
      { shown: true, after: true, before: true, head: 'NoteOptional · goes with your answer', placeholder: 'A note for the agent', toggles: 0 }, key);
    await evaluate('document.querySelector(".decide .note-box").focus()');
    await insertText(text);
    // The page keeps one way to answer, the bar's one button, off until a pick; More, over the ask, holds only Ask me later and Dismiss.
    assert.deepEqual(await evaluate(`(() => ({ bar: [...document.querySelectorAll('.decide-bar button')].map((b) => b.textContent + (b.disabled ? ' (off)' : '')),
      folded: [...document.querySelectorAll('.ask-nav .dl-menu > *, .split-bar .dl-menu > *')].map((b) => b.textContent) }))()`),
      { bar: ['Pick an answer (off)'], folded: ['Ask me later', 'Dismiss'] }, key);
    // Keys typed into the box are not keyboard navigation, so the next page's title gets no focus ring; Tab out of the box is.
    await evaluate('document.querySelector(".decide .note-box").dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }))');
    assert.equal(await evaluate('"kbd" in document.documentElement.dataset'), false, key);
  };
  const phone = await browse(join(dir, 'phone'), 390, 844, true);
  await comment(phone, 'feel', 'Looks good, but I want to see reports and the desktop variant too');
  await phone.evaluate('document.querySelector(".decide .pick-option").click()');
  await phone.evaluate('document.querySelector(".decide-bar .answer").click()');
  await until(async () => (await phone.evaluate('location.hash')) !== '#decide/feel');
  // No note: a pick and the button, and the answer carries none.
  await phone.evaluate(`location.href = ${JSON.stringify(`${url}#decide/quick`)}`);
  await until(async () => (await phone.evaluate('document.querySelector(".decide h2")?.textContent')) === 'Keep the weekly digest?');
  await phone.evaluate('document.querySelector(".decide .pick-option").click()');
  await phone.evaluate('document.querySelector(".decide-bar .answer").click()');
  await until(async () => (await phone.evaluate('location.hash')) !== '#decide/quick');
  phone.close();
  const desk = await browse(join(dir, 'desk'), 1280);
  await comment(desk, 'layout', 'B is close too');
  await desk.evaluate('[...document.querySelectorAll(".decide .pick-option")].find((b) => b.textContent.startsWith("C")).click()');
  await desk.evaluate('document.querySelector(".decide-bar .answer").click()');
  await until(async () => (await desk.evaluate('location.hash')) !== '#decide/layout');
  // The answered card shows the comment it went with, and its line now reads Edit comment.
  await desk.evaluate(`location.href = ${JSON.stringify(`${url}#answered`)}`);
  await until(async () => (await desk.evaluate('document.querySelectorAll("#item-feel .saved-note").length')) === 1);
  // Its picked answer reads only Yes; Recommended stays on an answer not picked, small and beside its label.
  await desk.evaluate('document.querySelector("#item-feel").closest("details").open = true');
  assert.deepEqual(await desk.evaluate('[...document.querySelectorAll("#item-feel .choices button")].map((b) => [b.getAttribute("aria-pressed"), b.querySelector(".label-line").textContent])'), [['true', 'Yes'], ['false', 'No']]);
  assert.deepEqual(await desk.evaluate('[...document.querySelectorAll("#item-layout .choices button")].map((b) => [b.getAttribute("aria-pressed"), b.querySelector(".label-line").textContent, b.querySelector(".tag") && getComputedStyle(b.querySelector(".tag")).textTransform])'),
    [['false', 'ARecommended', 'none'], ['false', 'B', null], ['true', 'C', null]]);
  await desk.evaluate('document.querySelector(".decide, main").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))');
  assert.equal(await desk.evaluate('"kbd" in document.documentElement.dataset'), true);
  assert.deepEqual(await desk.evaluate('[document.querySelector("#item-feel .saved-note").textContent, document.querySelector("#item-feel details.comment summary").textContent, document.querySelector("#item-quick details.comment summary").textContent]'),
    ['Your comment, sent with Yes: Looks good, but I want to see reports and the desktop variant too', 'Edit comment', 'Add a comment']);
  desk.close();
  const saved = JSON.parse(run('answers', file, '--json').out);
  assert.deepEqual(Object.fromEntries(Object.entries(saved).map(([k, a]) => [k, [a.answer, a.note]])),
    { feel: ['yes', 'Looks good, but I want to see reports and the desktop variant too'], layout: ['c', 'B is close too'], quick: ['yes', undefined] });
  // The agent's plain read carries each comment beside its answer.
  assert.match(run('answers', file).out, /feel,yes,[^\n]*,"?Looks good, but I want to see reports and the desktop variant too/);
  proc.kill();
});

test('Decide on a phone: a pick then the button opens the next ask with Back to the one answered, which shows the answer and changes it (sent as a change the agent reads, with Undo), the arrows step through answered and open asks, the toast never covers the next question’s button, the bar keeps to the foot with the tab bar slid away, and a row swipes right to answer and left to Later', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'decide-toast'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const abc = ['A', 'B', 'C'].map((l) => ({ value: l.toLowerCase(), label: l })), why = 'The release needs one calm day. '.repeat(140);
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    // The board reads newest first, so the queue answers alpha, then beta, then the short gamma.
    { key: 'gamma', title: 'Gamma question?', why: 'One calm day.', options: abc, recommend_value: 'c' },
    { key: 'beta', title: 'Beta question?', why, options: abc, recommend_value: 'b' },
    { key: 'alpha', title: 'Alpha question?', why, options: abc, recommend_value: 'a' },
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, swipe, close } = await browse(join(dir, 'b'), 390, 844);
  await evaluate(`location.href = ${JSON.stringify(`${url}#decide/alpha`)}`);
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === 'Alpha question?');
  // The ask has its own page: the tab bar slides away and the bar keeps to the foot of the screen.
  assert.equal(await evaluate('document.querySelector(".decide-bar").getBoundingClientRect().bottom <= innerHeight'), true);
  assert.equal(await evaluate('document.querySelector(".decide-bar").getBoundingClientRect().top > innerHeight / 2'), true);
  await until(() => evaluate('document.querySelector(".tabs").getBoundingClientRect().top >= innerHeight'));
  await evaluate('document.querySelector(".decide .pick-option").click()');
  await evaluate('document.querySelector(".decide-bar .answer").click()');
  // The next ask opens with the toast, and Back (or a swipe right) returns to the one just answered.
  await until(async () => (await evaluate('location.hash')) === '#decide/beta' && (await evaluate('!document.querySelector("#toast").hidden')));
  const bar = () => evaluate('[document.querySelector(".ask-nav .back").textContent, document.querySelector(".ask-nav .back").getAttribute("href"), ...[...document.querySelectorAll(".ask-nav .step")].map((a) => a.getAttribute("href") ?? "-")].join("|")');
  assert.equal(await bar(), 'Back|#decide/alpha|#decide/alpha|#decide/gamma');
  await swipe({ x: 40, y: 400 }, { x: 360, y: 400 });
  await until(async () => (await evaluate('location.hash + "|" + document.querySelector(".decide .ans-card b")?.textContent')) === '#decide/alpha|A');
  // There it shows the answer, when and that the agent has not read it, with Change answer as its one button and no ask's More; it goes back to the list.
  assert.equal(await evaluate('[document.querySelector(".decide .ans-meta").textContent.split(" · ")[0], document.querySelector(".decide .ans-card > div > span").textContent, document.querySelector(".decide-bar .answer").textContent, !!document.querySelector(".ask-nav .dl-more")].join("|")'), 'Answered|Agent has not read it yet|Change answer|false');
  assert.equal(await bar(), 'Decide|#waiting|-|#decide/beta');
  // Change answer brings the cards back with nothing picked and the answer given tagged; the button is off until another answer, then names the change.
  await evaluate('document.querySelector(".decide-bar .answer").click()');
  await until(async () => (await evaluate('document.querySelectorAll(".decide .pick-option").length')) === 4);
  assert.equal(await evaluate('[...document.querySelectorAll(".decide .pick-option")].map((b) => b.querySelector(".label").textContent + (b.querySelector(".now") ? "=" : "") + b.getAttribute("aria-pressed")).join("|") + "|" + document.querySelector(".decide-bar .answer").textContent + "|" + document.querySelector(".decide-bar .answer").disabled'),
    'A=false|Bfalse|Cfalse|Your own answerfalse|Pick a new answer|true');
  await evaluate('document.querySelector(".decide .pick-option").click()');
  assert.equal(await evaluate('document.querySelector(".decide-bar .answer").textContent + "|" + document.querySelector(".decide-bar .answer").disabled'), 'Change to A|true');
  await evaluate('document.querySelectorAll(".decide .pick-option")[2].click()');
  await evaluate('document.querySelector(".decide-bar .answer").click()');
  // It stays on the ask, now Changed with the answer before under it, and the agent gets it as a change that replaces A; the first answer stays in the history.
  await until(async () => (await evaluate('[document.querySelector(".decide .ans-meta")?.textContent.split(" · ")[0], document.querySelector(".decide .ans-card b")?.textContent, document.querySelector(".decide .ans-was")?.textContent.split(" · ")[0], document.querySelector("#toast-text").textContent].join("|")')) === 'Changed|C|Before: A|Alpha question? · changed to C');
  const took = JSON.parse(run('wait', file, '--key', 'alpha', '--json', '--timeout', '5').out).alpha;
  assert.deepEqual([took.answer, took.replaces.answer], ['c', 'a']);
  // Undo puts A back, as a change the agent reads too.
  await evaluate('document.querySelector("#undo").click()');
  await until(async () => (await evaluate('document.querySelector(".decide .ans-card b")?.textContent + "|" + document.querySelector("#toast-text").textContent')) === 'A|Back to: A' && /alpha,a,/.test(run('answers', file).out));
  assert.deepEqual(readFileSync(join(dir, 'board.answers.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((a) => `${a.answer}<${a.replaces?.answer ?? ''}`), ['a<', 'c<a', 'a<c']);
  // The arrows step on to the next open ask; on the list the answer is under Answered.
  await evaluate('document.querySelector(".ask-nav .step[aria-label=Next]").click()');
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === 'Beta question?');
  await evaluate('location.hash = "#waiting"');
  await until(async () => (await evaluate('[...document.querySelectorAll(".dl-head")].map((h) => h.textContent).join("|") + "|" + document.querySelector(".g-done .sub")?.textContent')) === 'Answer2|Answered1|Changed to A');
  // From the list, an ask answered opens the next one; back on the list, once it has risen into place, the toast sits over the tab bar.
  await evaluate('document.querySelector(".dl-row[data-key=beta] .dl-face").click()');
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === 'Beta question?');
  await until(() => evaluate('!document.getElementById("board").getAnimations({ subtree: true }).length'));
  await evaluate('document.querySelectorAll(".decide .pick-option")[1].click()');
  await evaluate('document.querySelector(".decide-bar .answer").click()');
  await until(async () => (await evaluate('location.hash')) === '#decide/gamma' && /beta,b,/.test(run('answers', file).out) && (await evaluate('!document.querySelector("#toast").hidden')));
  await evaluate('location.hash = "#waiting"');
  await until(async () => (await evaluate('location.hash')) === '#waiting');
  assert.equal(await evaluate('Promise.all(document.querySelector("#toast").getAnimations().map((a) => a.finished)).then(() => document.querySelector("#toast").getBoundingClientRect().bottom <= document.querySelector(".tabs").getBoundingClientRect().top)'), true);
  // On the next question the toast never covers its button.
  await evaluate('location.hash = "#decide/gamma"');
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === 'Gamma question?' && (await evaluate('!document.querySelector("#toast").hidden')));
  await until(() => evaluate('!document.getElementById("board").getAnimations({ subtree: true }).length')); // the push in has landed
  assert.equal(await evaluate('document.querySelector("#toast").getBoundingClientRect().bottom <= document.querySelector(".decide-bar").getBoundingClientRect().top'), true);
  assert.equal(await evaluate('(() => { const r = document.querySelector(".decide-bar .answer").getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(".answer") != null; })()'), true);
  // Short or tall, the ask keeps its bar at the foot of the screen, with the toast above it.
  // Every length in between too: on any font one of them would leave the bar where the toast sits.
  for (const words of ['One calm day.', ...Array.from({ length: 24 }, (_, i) => why.slice(0, 60 * (i + 1))), why]) {
    await evaluate(`document.querySelector('.decide .why').textContent = ${JSON.stringify(words)}`);
    // Measured after the page has laid the new words out (two frames), as a person would see it.
    const at = await evaluate('new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))).then(() => { const b = document.querySelector(".decide-bar").getBoundingClientRect(), t = document.querySelector("#toast"), r = t.getBoundingClientRect(); return { hidden: t.hidden, inner: innerHeight, bar: [b.top, b.bottom], toast: [r.top, r.bottom], scroll: scrollY }; })');
    assert.ok(!at.hidden && Math.abs(at.bar[1] - at.inner) <= 1 && at.toast[1] <= at.bar[0] + 13, JSON.stringify({ chars: words.length, ...at }));
    assert.equal(await evaluate('(() => { const r = document.querySelector(".decide-bar .answer").getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(".answer") != null; })()'), true);
  }
  // A finger on a row: a short drag springs back and opens nothing; a swipe right answers with the recommended pick, with Undo.
  await evaluate('location.hash = "#waiting"');
  const row = async (key) => evaluate(`(() => { const r = document.querySelector('.dl-row[data-key="${key}"]:not(.leaving, .g-done) .dl-face')?.getBoundingClientRect(); return r && { y: r.top + r.height / 2 }; })()`);
  await until(async () => !!(await row('gamma')));
  let { y } = await row('gamma');
  await swipe({ x: 100, y }, { x: 140, y });
  await until(async () => (await evaluate('document.querySelector(".dl-row[data-key=gamma] .dl-face").style.transform')) === '');
  assert.equal(await evaluate('location.hash'), '#waiting');
  assert.doesNotMatch(run('answers', file).out, /gamma/);
  await swipe({ x: 40, y }, { x: 360, y });
  await until(async () => /gamma,c,/.test(run('answers', file).out) && (await evaluate('document.querySelector("#toast").dataset.mark + "|" + document.querySelector("#toast-text").textContent')) === 'ok|Gamma question? · C');
  await until(async () => !(await row('gamma')));
  await evaluate('document.querySelector("#undo").click()');
  await until(async () => !/gamma,c,/.test(run('answers', file).out) && !!(await row('gamma')));
  // Every toast has the one style: the undo's toast has its own mark in the same disc.
  await until(async () => (await evaluate('[document.querySelector("#toast").dataset.mark, document.querySelector("#toast-text").textContent, getComputedStyle(document.querySelector("#toast .tk")).display, getComputedStyle(document.querySelector("#toast .tk .undo")).display].join("|")')) === 'undo|Undone: not answered|grid|block');
  // A swipe left moves it to Later, kept in this browser across a reload; the agent still waits, so Decide still counts it; Undo brings it back.
  ({ y } = await row('gamma'));
  await swipe({ x: 360, y }, { x: 30, y });
  await until(async () => (await evaluate('[...document.querySelectorAll(".dl-head")].map((h) => h.textContent).join("|")')) === 'Later1|Answered2');
  assert.equal(await evaluate('document.querySelector("#toast-text").textContent + "|" + document.querySelector(".waiting-lede").textContent + "|" + document.querySelector(".tabs .bd").textContent'), 'Gamma question? · moved to later|1 waiting · 1 for later|1');
  await evaluate('window.old = true, location.reload()');
  await until(() => evaluate('!window.old && document.querySelectorAll(".dl-head").length === 2'));
  assert.equal(await evaluate('document.querySelector(".dl-head").textContent'), 'Later1');
  // A swipe on an answered row does nothing: it is changed on its ask.
  ({ y } = await evaluate('(() => { const r = document.querySelector(".g-done .dl-face").getBoundingClientRect(); return { y: r.top + r.height / 2 }; })()'));
  await swipe({ x: 40, y }, { x: 360, y });
  assert.equal(await evaluate('location.hash + "|" + document.querySelector(".g-done .dl-face").style.transform'), '#waiting|');
  // From Later a swipe left brings it back to Answer.
  ({ y } = await row('gamma'));
  await swipe({ x: 360, y }, { x: 30, y });
  await until(async () => (await evaluate('[...document.querySelectorAll(".dl-head")].map((h) => h.textContent).join("|")')) === 'Answer1|Answered2');
  close();
  proc.kill();
});

test('Decide on a desk: the list beside its ask, J and K move the selection, a number picks and Enter answers and selects the next while the row folds, Cmd+Z, L, C with Cmd+Enter, a row\'s hover answer, the ? sheet, G then a letter (Evidence on the same shell), a sign-in laid out as an ask, a tall ask\'s bar after its last option, and the phone layout under 1024px', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'decide-desk'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const abc = ['A', 'B', 'C'].map((l) => ({ value: l.toLowerCase(), label: l }));
  writeFileSync(file, JSON.stringify({ schema: 2, items: ['delta', 'gamma', 'beta', 'alpha'].map((k) => ({ key: k, title: `${k[0].toUpperCase()}${k.slice(1)} question?`, options: abc, recommend_value: 'b' })) }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 1280, 800);
  const key = (k, mod = false) => evaluate(`(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, ctrlKey: ${mod}, metaKey: ${mod} }))`);
  const seen = () => evaluate('[location.hash, document.querySelector(".split-list .sel")?.dataset.key, document.querySelector(".split-detail .decide h2")?.textContent, document.activeElement === document.querySelector(".split-list .sel .dl-face")].join("|")');
  const rows = () => evaluate('[...document.querySelectorAll(".split-list .dl-row:not(.leaving, .g-done)")].map((r) => r.dataset.key).join(",")');
  const done = () => evaluate('[...document.querySelectorAll(".split-list .g-done")].map((r) => r.dataset.key).join(",")');
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  // The list and the first ask share the screen, each column scrolling on its own; the strip under the list names its keys.
  await until(async () => (await evaluate('document.querySelector(".split-detail .decide h2")?.textContent')) === 'Alpha question?');
  assert.equal(await evaluate('document.querySelector(".split-list .sel").dataset.key + "|" + (document.scrollingElement.scrollHeight <= innerHeight) + "|" + document.querySelector(".split-hints").textContent'), 'alpha|true|JKMove↵Answer?All keys');
  assert.equal(await evaluate('(() => { const l = document.querySelector(".split-list").getBoundingClientRect(), d = document.querySelector(".split-detail").getBoundingClientRect(), s = document.querySelector(".side").getBoundingClientRect(); return s.right <= l.left && l.right <= d.left && d.right === innerWidth && l.width >= 320; })()'), true);
  await key('j');
  await until(async () => (await seen()) === '#decide/beta|beta|Beta question?|true');
  await key('j'), await key('k');
  await until(async () => (await seen()) === '#decide/beta|beta|Beta question?|true');
  // Nothing is picked until a number picks: 2 picks B and the button names it. Enter answers with the pick: the button draws its check, the row folds away,
  // the next ask is selected beside the list, and the toast, 440px wide, sits centred over the list and the ask's pane.
  assert.equal(await evaluate('document.querySelector(".split-detail .answer").disabled'), true);
  await key('2');
  assert.equal(await evaluate('document.querySelector(".split-detail .answer").textContent + "|" + document.querySelector(".split-detail .answer").disabled'), 'Answer B|false');
  await key('Enter');
  await until(() => evaluate('document.querySelector(".split-detail .answer.done") !== null'));
  await until(async () => /beta,b,/.test(run('answers', file).out) && (await seen()) === '#decide/gamma|gamma|Gamma question?|true' && (await rows()) === 'alpha,gamma,delta' && (await done()) === 'beta');
  await until(() => evaluate('(() => { const t = document.querySelector("#toast"), r = t.getBoundingClientRect(), side = document.querySelector(".side").getBoundingClientRect(); return !t.hidden && r.width <= 440 && Math.abs((r.left + r.right) / 2 - (side.right + innerWidth) / 2) <= 2; })()'));
  // Cmd+Z takes it back and the row returns.
  await key('z', true);
  await until(async () => !/beta,b,/.test(run('answers', file).out) && (await rows()) === 'alpha,beta,gamma,delta' && (await done()) === '');
  // L moves the selected ask to Later and selects the next.
  await evaluate('location.hash = "#decide/gamma"');
  await until(async () => (await seen()) === '#decide/gamma|gamma|Gamma question?|true');
  await key('l');
  await until(async () => (await seen()) === '#decide/delta|delta|Delta question?|true' && (await evaluate('[...document.querySelectorAll(".dl-head")].map((h) => h.textContent).join("|")')) === 'Answer3|Later1');
  // C goes to the note under the answers, and Cmd+Enter answers the pick from it with the note.
  await key('3');
  await key('c');
  assert.equal(await evaluate('document.activeElement.id'), 'note-delta');
  await evaluate('(() => { const t = document.activeElement; t.value = "After the demo"; t.dispatchEvent(new Event("input")); })()');
  await key('Enter', true);
  await until(() => JSON.parse(run('answers', file, '--json').out).delta?.note === 'After the demo');
  assert.equal(JSON.parse(run('answers', file, '--json').out).delta.answer, 'c');
  // Hovering a row shows its quick answer, which answers with the recommended pick.
  await until(async () => (await rows()) === 'alpha,beta,gamma');
  await evaluate('document.querySelector(\'.dl-row[data-key="alpha"] .dl-hover .yes\').click()');
  await until(async () => /alpha,b,/.test(run('answers', file).out) && (await rows()) === 'beta,gamma' && (await done()) === 'alpha,delta');
  // An answered row opens its ask beside the list: the answer, Change answer and no Later.
  await evaluate('document.querySelector(\'.g-done[data-key="alpha"] .dl-face\').click()');
  await until(async () => (await evaluate('[location.hash, document.querySelector(".split-detail .ans-card b")?.textContent, document.querySelector(".split-detail .decide-bar .answer")?.textContent, !!document.querySelector(".split-bar .later")].join("|")')) === '#decide/alpha|B|Change answer|false');
  // ? opens every key in one sheet; G then a letter goes to an area.
  await key('?');
  assert.equal(await evaluate('document.getElementById("keys").open + "|" + document.querySelector("#keys h2").textContent + "|" + document.querySelectorAll("#keys li").length'), 'true|Keyboard shortcuts|18');
  await evaluate('document.querySelector("#keys header button").click()');
  await key('g'), await key('e');
  await until(async () => (await evaluate('location.hash + "|" + !!document.querySelector(".split-list") + "|" + document.querySelector(".split-detail")?.textContent')) === '#evidence|true|No evidence updates.');
  await key('g'), await key('d');
  await until(async () => (await evaluate('location.hash + "|" + !!document.querySelector(".split")')) === '#waiting|true');
  // A sign-in reads like any ask beside the list: who waits, its headline, what it unlocks and Open as the bar's one button, with its time left only on its row.
  const board = JSON.parse(readFileSync(file, 'utf8')), many = 'abcdef'.split('').map((l) => ({ value: l, label: `Option ${l}`, outcome: `What happens after option ${l}.` }));
  board.items.push({ key: 'npm', title: 'npm', type: 'signin', link: 'https://example.com/login', unlocks: 'Publishing the release', waits: 'Release agent', expires: new Date(Date.now() + 2 * 3600_000).toISOString() },
    { key: 'tall', title: 'Which of six?', options: many, recommend_value: 'a' });
  writeFileSync(file, JSON.stringify(board));
  await evaluate('location.hash = "#decide/npm"; location.reload()');
  await until(async () => (await evaluate('document.querySelector(".split-detail .decide h2")?.textContent')) === 'Sign in to npm');
  assert.equal(await evaluate(`(() => { const p = document.querySelector(".split-detail .decide"), o = p.querySelector(".decide-bar .open-link");
    return [document.querySelector(".split-bar .crumb").textContent, [...p.querySelectorAll(".fact")].map((f) => f.textContent).join(","), o.textContent, o.getAttribute("href"), !!p.querySelector(".row"),
      /Expires|left/.test(p.textContent), / left$/.test(document.querySelector('.dl-row[data-key="npm"] .tm').textContent), !!document.querySelector(".split-bar .dl-more")].join("|"); })()`),
  'Sign in · Release agent|UnlocksPublishing the release,Whereexample.com|Open sign-in|https://example.com/login|false|false|true|true');
  // An ask taller than the pane: its bar comes after the last option and never covers it.
  await evaluate('location.hash = "#decide/tall"');
  await until(async () => (await evaluate('document.querySelectorAll(".split-detail .pick-option:not(.own-option)").length')) === 6);
  assert.equal(await evaluate(`(() => { const s = document.querySelector(".split-detail"), bar = () => document.querySelector(".split-detail .decide-bar").getBoundingClientRect().top, last = () => [...s.querySelectorAll(".pick-option")].at(-1).getBoundingClientRect().bottom;
    const rest = bar() >= last(); s.scrollTop = 1e5; return [s.scrollHeight > s.clientHeight, rest, bar() >= last()].join("|"); })()`), 'true|true|true');
  close();
  // Under 1024px the board keeps the phone's layout: the tab bar, and an ask on a page of its own.
  const narrow = await browse(join(dir, 'n'), 1000, 800);
  await narrow.evaluate(`location.href = ${JSON.stringify(`${url}#decide/gamma`)}`);
  await until(async () => (await narrow.evaluate('document.querySelector(".decide h2")?.textContent')) === 'Gamma question?');
  assert.equal(await narrow.evaluate('!!document.querySelector(".split") + "|" + getComputedStyle(document.querySelector(".tabs")).display + "|" + getComputedStyle(document.querySelector(".side")).display'), 'false|flex|none');
  narrow.close();
  proc.kill();
});

test('Reports on a desk: the list beside the newest report, J moves and reads, U marks unread and the page stays loaded, E archives and selects the next, Cmd+Z, a row\'s hover, a guided report opens over the board and Escape comes back, and the phone layout under 1024px', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'reports-desk'), file = join(dir, 'board.json');
  mkdirSync(join(dir, 'page'), { recursive: true });
  writeFileSync(join(dir, 'page', 'index.html'), '<!doctype html><p>A report page.</p>');
  const at = (m) => new Date(Date.now() - m * 60e3).toISOString().replace(/\.\d+Z$/, 'Z');
  const guided = { ...JSON.parse(readFileSync(new URL('../fixtures/contract/report.v4/valid-full.json', import.meta.url), 'utf8')), filed: at(3) };
  writeFileSync(file, JSON.stringify({ schema: 2, items: [] }));
  writeFileSync(join(dir, 'guided.json'), JSON.stringify(guided));
  assert.equal(run('post', file, '--kind', 'report', '--from', join(dir, 'guided.json')).code, 0);
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  stored.items.push(...[['beta', 'Beta report', 2, { about: 'What beta says.', form: 'chart', asked_by: 'Release agent' }], ['gamma', 'Gamma report', 4, {}], ['alpha', 'Alpha report', 1, { form: 'before-after' }]]
    .map(([key, title, ago, more]) => ({ contract: 1, kind: 'report', schema: 2, key, title, view: 'page/index.html', preview: 'page/preview.svg', filed: at(ago), ...more })));
  writeFileSync(file, JSON.stringify(stored));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const reads = () => { try { return readFileSync(file.replace(/\.json$/, '.reads.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map(({ key, read }) => `${key}:${read}`).join(','); } catch { return ''; } };
  const { evaluate, close } = await browse(join(dir, 'b'), 1280, 800);
  const key = (k, mod = false) => evaluate(`(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, ctrlKey: ${mod}, metaKey: ${mod} }))`);
  const seen = () => evaluate('[location.hash, document.querySelector(".split-list .sel")?.dataset.key, document.querySelector(".split-detail .read h1")?.textContent, document.querySelectorAll("#board .report .new:not(.out)").length].join("|")');
  const rows = () => evaluate('[...document.querySelectorAll(".split-list .dl-row[data-key]")].filter((r) => r.style.height !== "0px").map((r) => r.dataset.key).join(",")');
  await evaluate(`location.href = ${JSON.stringify(`${url}#reports`)}`);
  // The newest report is shown beside the list, not yet marked read; the bar says what it is, and the strip under the list names its keys.
  await until(async () => (await seen()) === `#reports|alpha|Alpha report|4`);
  assert.match(await evaluate('document.querySelector(".rp-bar .eyebrow").textContent'), /^Before and after · \d\d:\d\d$/);
  assert.equal(await evaluate('[...document.querySelectorAll(".rp-bar button")].map((b) => b.textContent).join(",") + "|" + document.querySelector(".split-hints").textContent + "|" + !!document.querySelector(".split-detail .read iframe")'),
    'Mark read,Archive|JKMoveUReadEArchive?All keys|true');
  assert.equal(await rows(), `alpha,beta,${guided.key},gamma`);
  assert.equal(reads(), '');
  // J selects the next report and reads it: its dot goes and the read is saved beside the board.
  await key('j');
  await until(async () => (await seen()) === '#reports/beta|beta|Beta report|3' && reads() === 'beta:true');
  // U marks it unread; the page beside the list is not loaded again, and the mark holds.
  await evaluate('document.querySelector(".split-detail .read iframe").dataset.kept = "1"');
  await key('u');
  await until(async () => reads() === 'beta:true,beta:false' && (await seen()) === '#reports/beta|beta|Beta report|4');
  assert.equal(await evaluate('document.querySelector(".split-detail .read iframe").dataset.kept + "|" + document.querySelector(".rp-read").textContent'), '1|Mark read');
  // A row's hover holds Read and Archive, the same two actions as its swipes.
  assert.equal(await evaluate(`[...document.querySelectorAll('.dl-row[data-key="gamma"] .dl-hover button')].map((b) => b.textContent).join(",")`), 'Read,Archive');
  // E archives the report shown: its row folds away and the next one is selected; Cmd+Z brings it back.
  await key('e');
  await until(async () => (await rows()) === `alpha,${guided.key},gamma` && (await evaluate('location.hash')) === `#reports/${guided.key}` && /^Archived: Beta report/.test(await evaluate('document.getElementById("toast").textContent')));
  await key('z', true);
  await until(async () => (await rows()) === `alpha,beta,${guided.key},gamma`);
  // A guided report reads in stages over the board: Enter opens it, Escape closes it back to the list with the same report selected.
  assert.equal(await evaluate('!!document.querySelector(".split-detail .read iframe") + "|" + document.querySelector(".split-detail .rp-open").textContent'), 'false|Read the report');
  await key('Enter');
  await until(() => evaluate('!document.getElementById("reader").hidden && document.getElementById("reader").getAttribute("aria-modal") === "true"'));
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
  await until(async () => (await evaluate(`document.getElementById("reader").hidden + "|" + location.hash + "|" + document.querySelector(".split-list .sel")?.dataset.key`)) === `true|#reports/${guided.key}|${guided.key}`);
  close();
  // Under 1024px Reports keeps the phone's list, and a report opens over it.
  const narrow = await browse(join(dir, 'n'), 1000, 800);
  await narrow.evaluate(`location.href = ${JSON.stringify(`${url}#reports/gamma`)}`);
  await until(() => narrow.evaluate('!document.getElementById("reader").hidden && document.querySelector("#reader h1")?.textContent === "Gamma report"'));
  assert.equal(await narrow.evaluate('!!document.querySelector(".split") + "|" + getComputedStyle(document.querySelector(".tabs")).display'), 'false|flex');
  narrow.close();
  proc.kill();
});

test('Decide on an ask with no mock to show: no empty preview frame, and an ask with one still shows it', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'decide-no-mocks'), file = join(dir, 'board.json');
  mkdirSync(join(dir, 'mocks'), { recursive: true });
  writeFileSync(join(dir, 'mocks', 'one.png'), png);
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'look', type: 'design', title: 'Pick the look', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], recommend_value: 'a' },
    { key: 'shot', type: 'design', title: 'Pick the shot', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], recommend_value: 'a',
      mocks: [{ value: 'b', path: 'mocks/one.png' }] },
    { key: 'lost', type: 'design', title: 'Pick the lost look', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], recommend_value: 'a',
      mocks: [{ value: 'b', path: 'mocks/gone.png' }] },
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#decide/look`)}`);
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === 'Pick the look');
  assert.equal(await evaluate('document.querySelector(".decide-preview")'), null);
  assert.equal(await evaluate('document.querySelectorAll(".decide .shot.none, .decide .mock").length'), 0);
  await evaluate('location.hash = "#decide/shot"');
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === 'Pick the shot');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".decide-preview .mock")].map((f) => [f.querySelector(".label").textContent, f.querySelector(".shot.none")?.textContent ?? null])'),
    [['A', 'No mock for this option'], ['B', null]]);
  await evaluate('location.hash = "#decide/lost"');
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === 'Pick the lost look');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".decide-preview .mock")].map((f) => [f.querySelector(".label").textContent, f.querySelector(".shot.none")?.textContent ?? null])'),
    [['A', 'No mock for this option'], ['B', 'No mock for this option']]);
  close();
  proc.kill();
});

test('Decide keeps every option in its preview when only some have a mock: the rest say "No mock for this option" and can still be picked', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'decide-partial-mocks'), file = join(dir, 'board.json');
  mkdirSync(join(dir, 'mocks'), { recursive: true });
  writeFileSync(join(dir, 'mocks', 'b.png'), png);
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'look', type: 'design', title: 'Pick the look', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], recommend_value: 'a',
      mocks: [{ value: 'b', path: 'mocks/b.png' }],
    },
    { key: 'next', type: 'decision', title: 'And then?', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], recommend_value: 'yes' },
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#decide/look`)}`);
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === 'Pick the look');
  // A is the recommended option and has no mock: it stays in the preview, saying so, instead of dropping out of it.
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".decide-preview .mock")].map((f) => [f.querySelector(".label").textContent, f.querySelector(".shot.none")?.textContent ?? null])'),
    [['A', 'No mock for this option'], ['B', null]]);
  await evaluate('[...document.querySelectorAll(".decide .pick-option")].find((b) => b.textContent.startsWith("A")).click(); document.querySelector(".decide-bar .answer").click()');
  await until(async () => (await evaluate('location.hash')) === '#decide/next' && /look,a,/.test(run('answers', file).out));
  close();
  proc.kill();
});

test('Decide on a design pick with an HTML mock: Comment on the mocks is there before the pick and turns pointing on for that mock', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'decide-annotate'), file = join(dir, 'board.json');
  mkdirSync(join(dir, 'mocks'), { recursive: true });
  writeFileSync(join(dir, 'mocks', 'a.html'), '<main><button>Sign in</button></main>');
  writeFileSync(file, JSON.stringify({ schema: 2, items: [{ key: 'look', type: 'design', title: 'Pick the look',
    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], recommend_value: 'a', mocks: [{ value: 'a', path: 'mocks/a.html' }] }] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#decide/look`)}`);
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === 'Pick the look');
  const toggle = 'document.querySelector(\'.decide .ann button[aria-label^="Comment on the mocks"]\')';
  assert.equal(await evaluate(`!!${toggle}`), true);
  assert.equal(await evaluate(`${toggle}.getAttribute('aria-pressed')`), 'false');
  await evaluate(`${toggle}.click()`);
  await until(async () => (await evaluate(`${toggle}?.getAttribute('aria-pressed')`)) === 'true' && (await evaluate("pointing.get('look~a')")) === true);
  assert.equal(await evaluate('document.querySelector(".decide .ann .meta")?.textContent'), 'Tap an element in a mock to comment on it. Turn this off to open a mock full size.');
  await evaluate('document.querySelector(".decide .pick-option").click(); document.querySelector(".decide-bar .answer").click()');
  await until(async () => (await evaluate('location.hash')) !== '#decide/look');
  close();
  proc.kill();
});

test('Open full screen: a design pick\'s prototype over the whole screen takes real taps on its own links (scaled to Desktop too), loads the files beside it, switches option and size, shows the other option over it on a phone and beside it on a desk, and Close goes back; an interactive page has no Reference; while pointing, a tap on a mock does not open it', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'full'), file = join(dir, 'board.json'), a = join(dir, 'mocks', 'fleet', 'a'), b = join(dir, 'mocks', 'fleet', 'b');
  mkdirSync(a, { recursive: true }); mkdirSync(b, { recursive: true });
  // Each page is one link that fills its frame, to the other page beside it, and says which page it is and the colour its stylesheet gave it.
  const page = (to) => `<link rel="stylesheet" href="style.css"><a href="${to}" style="display: block; height: 100vh">Go</a><script>parent.postMessage({ at: location.pathname.split('/').pop(), color: getComputedStyle(document.body).color }, '*')</script>`;
  writeFileSync(join(a, 'index.html'), page('lanes.html'));
  writeFileSync(join(a, 'lanes.html'), page('index.html'));
  writeFileSync(join(a, 'style.css'), 'body { margin: 0; color: rgb(1, 2, 3) }');
  writeFileSync(join(b, 'index.html'), '<p>B</p>');
  writeFileSync(join(dir, 'mocks', 'tour.html'), '<p>Tour</p>');
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'fleet', type: 'design', title: 'Pick the fleet dashboard', options: [{ value: 'a', label: 'A: Table' }, { value: 'b', label: 'B: Cards' }], recommend_value: 'a',
      mocks: [{ value: 'a', path: 'mocks/fleet/a/index.html', link: 'https://example.com/a' }, { value: 'b', path: 'mocks/fleet/b/index.html' }] },
    { key: 'tour', type: 'interactive', title: 'Does the tour feel right?', view: 'mocks/tour.html' }] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const full = "document.querySelector('dialog.proto-full[open]')", port = (n = 0) => `${full}.querySelectorAll('.pf-frame:not([hidden]) .pf-port')[${n}]`;
  const centre = (e) => `(({ left, top, width, height }) => [left + width / 2, top + height / 2])(${e}.getBoundingClientRect())`;
  const box = (e) => `(({ left, top, width, height }) => [left, top, width, height].map(Math.round))(${e}.getBoundingClientRect())`;
  const pages = "got.filter((m) => m.full).map((m) => m.at)";
  {
    const { evaluate, tap, click, close } = await browse(join(dir, 'phone'), 390, 844, true);
    await evaluate(`location.href = ${JSON.stringify(`${url}#decide/fleet`)}`);
    await until(() => evaluate("!!document.querySelector('.decide .full-open')"));
    assert.equal(await evaluate("document.querySelector('.decide .full-open').textContent"), 'Open full screen');
    await evaluate("window.got = [], addEventListener('message', (e) => e.data?.at && got.push({ ...e.data, full: e.source === document.querySelector('.proto-full iframe')?.contentWindow }))");
    await tap(await evaluate(centre("document.querySelector('.decide .full-open')")));
    await until(() => evaluate(`${pages}.includes('index.html')`));
    // The whole screen, the recommended option first, at phone size, its live link in the bar, and the files beside the page loaded.
    assert.deepEqual(await evaluate(box(full)), [0, 0, 390, 844]);
    assert.deepEqual(await evaluate(`[${full}.querySelector('.pf-pick').value, ${full}.querySelector('.pf-size [aria-pressed=true]').dataset.size, ${full}.querySelector('.pf-ref').getAttribute('aria-pressed'), ${full}.querySelector('.pf-live').href]`),
      ['a', 'phone', 'false', 'https://example.com/a']);
    assert.equal((await evaluate(box(port())))[2], 390);
    assert.equal(await evaluate("got.find((m) => m.full).color"), 'rgb(1, 2, 3)');
    // A real click on the prototype's own link goes to the page beside it: the board takes none of the prototype's input.
    // (Headless Chrome puts the sandboxed frame in a process of its own and misplaces the click it makes from an emulated tap there; a phone keeps the frame in-process, and a mouse click lands.)
    await click(await evaluate(centre(port())));
    await until(() => evaluate(`${pages}.includes('lanes.html')`));
    // Desktop draws the same page at 1280 scaled to the screen, without loading it again, and a tap there still reaches the prototype's link.
    await tap(await evaluate(centre(`${full}.querySelector('[data-size=desktop]')`)));
    await until(async () => (await evaluate(`getComputedStyle(${port()}.firstChild).width`)) === '1280px');
    assert.deepEqual(await evaluate(`[${box(port())}[2], ${pages}.length]`), [390, 2]);
    assert.ok(Math.abs((await evaluate(`+${port()}.style.getPropertyValue('--s')`)) - 390 / 1280) < 0.001);
    await click(await evaluate(centre(port())));
    await until(() => evaluate(`${pages}.length === 3 && ${pages}.at(-1) === 'index.html'`));
    // Reference on a phone covers the prototype with the other option, labelled; off again, the prototype is as it was.
    await tap(await evaluate(centre(`${full}.querySelector('.pf-ref')`)));
    await until(() => evaluate(`${full}.querySelector('.pf-stage').dataset.mode === 'over'`));
    assert.deepEqual(await evaluate(`[${full}.querySelector('.pf-back figcaption').textContent, ${full}.querySelector('.pf-back iframe').title, ${box(port(1))}.join() === ${box(port(0))}.join()]`), ['ReferenceB: Cards', 'Reference: B: Cards', true]);
    await tap(await evaluate(centre(`${full}.querySelector('.pf-ref')`)));
    await until(() => evaluate(`${full}.querySelector('.pf-stage').dataset.mode === 'one' && ${full}.querySelector('.pf-back').hidden`));
    // Another option replaces the page shown; it has no live link.
    await evaluate(`(s => { s.value = 'b'; s.dispatchEvent(new Event('change')); })(${full}.querySelector('.pf-pick'))`);
    assert.deepEqual(await evaluate(`[${full}.querySelector('.pf-main iframe').title, ${full}.querySelector('.pf-live').hidden]`), ['Prototype: B: Cards', true]);
    // Close goes back to the card, on what opened it, at the same address.
    await tap(await evaluate(centre(`${full}.querySelector('.pf-close')`)));
    await until(() => evaluate(`!${full} && !document.querySelector('.proto-full')`));
    assert.deepEqual(await evaluate("[location.hash, document.activeElement.className]"), ['#decide/fleet', 'full-open']);
    // A tap on a mock's frame opens that option full screen.
    await evaluate("document.querySelectorAll('.decide .shot')[1].click()");
    await until(() => evaluate(`${full}?.querySelector('.pf-pick').value === 'b'`));
    await evaluate(`${full}.querySelector('.pf-close').click()`);
    assert.equal(await evaluate("document.querySelectorAll('.proto-full').length"), 0);
    // While Comment on the mocks is on, a tap on a mock names an element instead: no full screen.
    await evaluate("document.querySelector('.decide .ann button[aria-label^=\"Comment on the mocks\"]').click()");
    await until(() => evaluate("pointing.get('fleet~a') === true"));
    await evaluate("document.querySelector('.decide .shot[data-full=\"fleet~a\"]').click()");
    assert.equal(await evaluate("!!document.querySelector('.proto-full')"), false);
    close();
  }
  {
    // On a desk the reference stands beside the prototype at phone size, both centred; an interactive page has no option or Reference to pick.
    const { evaluate, click, close } = await browse(join(dir, 'desk'), 1280, 800);
    await evaluate(`location.href = ${JSON.stringify(`${url}#decide/fleet`)}`);
    await until(() => evaluate("!!document.querySelector('.decide .full-open')"));
    await click(await evaluate(centre("document.querySelector('.decide .full-open')")));
    await until(() => evaluate(`!!${full}`));
    assert.deepEqual(await evaluate(`[${full}.querySelector('.pf-size [aria-pressed=true]').dataset.size, ${box(port())}[2]]`), ['desktop', 1280]);
    await click(await evaluate(centre(`${full}.querySelector('[data-size=phone]')`)));
    await click(await evaluate(centre(`${full}.querySelector('.pf-ref')`)));
    await until(() => evaluate(`${full}.querySelector('.pf-stage').dataset.mode === 'beside'`));
    const [one, two] = [await evaluate(box(port(0))), await evaluate(box(port(1)))];
    assert.deepEqual([one[2], two[2], one[1] === two[1]], [390, 390, true]);
    assert.ok(Math.abs(one[0] + (two[0] + two[2]) - 1280) <= 2, `${one} ${two} centred`);
    assert.ok(two[0] >= one[0] + one[2], 'side by side');
    await evaluate(`${full}.querySelector('.pf-close').click()`);
    await evaluate(`location.href = ${JSON.stringify(`${url}#decide/tour`)}`);
    await until(() => evaluate("document.querySelector('.decide h2')?.textContent === 'Does the tour feel right?' && !!document.querySelector('.decide .full-open')"));
    await click(await evaluate(centre("document.querySelector('.decide .full-open')")));
    await until(() => evaluate(`!!${full}?.querySelector('iframe[title=\"Prototype: Does the tour feel right?\"]')`));
    assert.deepEqual(await evaluate(`[!!${full}.querySelector('.pf-ref'), !!${full}.querySelector('.pf-pick'), ${full}.querySelector('.pf-live').hidden, ${full}.querySelector('iframe').getAttribute('sandbox')]`), [false, false, true, 'allow-scripts']);
    close();
  }
  proc.kill();
});

test('Undo on a card outside Waiting takes the answer back and stays on that area instead of opening a Decide page without it', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'undo-area'), file = join(dir, 'board.json');
  mkdirSync(dir);
  writeFileSync(file, JSON.stringify({ schema: 2, items: [{ key: 'build', title: 'Did the build pass?',
    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], area: 'evidence' }] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#evidence`)}`);
  const choices = 'document.querySelectorAll("#item-build .choices button").length';
  await until(async () => (await evaluate(choices)) === 2);
  await evaluate('[...document.querySelectorAll("#item-build .choices button")].find((b) => b.textContent.startsWith("Yes")).click()');
  await until(async () => (await evaluate('!document.querySelector("#toast").hidden')));
  await evaluate('document.querySelector("#undo").click()');
  await until(async () => (await evaluate('document.getElementById("toast-text").textContent')) === 'Undone: not answered');
  assert.equal(await evaluate('location.hash'), '#evidence');
  assert.equal(await evaluate(choices), 2);
  close();
  proc.kill();
});

test('Decide after an ask is replaced under the same key: the pick remembered from the old options is dropped, so nothing is picked and the button waits, and a new pick answers', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'decide-options-changed'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const doc = (options) => JSON.stringify({ schema: 2, items: [{ key: 'when', title: 'When should it ship?', options, recommend_value: options[0].value }] });
  writeFileSync(file, doc([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#decide/when`)}`);
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === 'When should it ship?');
  await evaluate('[...document.querySelectorAll(".decide .pick-option")].find((b) => b.textContent.startsWith("B")).click()');
  assert.equal(await evaluate('document.querySelector(".decide-bar .answer").textContent'), 'Answer B');
  writeFileSync(file, doc([{ value: 'c', label: 'C' }, { value: 'd', label: 'D' }]));
  await evaluate('refresh()');
  await until(async () => (await evaluate('document.querySelector(".decide .pick-option .label")?.textContent')) === 'C');
  assert.equal(await evaluate('document.querySelectorAll(".decide .pick-option[aria-pressed=true]").length'), 0);
  assert.equal(await evaluate('document.querySelector(".decide-bar .answer").textContent + "|" + document.querySelector(".decide-bar .answer").disabled'), 'Pick an answer|true');
  await evaluate('document.querySelector(".decide .pick-option").click()');
  assert.equal(await evaluate('document.querySelector(".decide-bar .answer").textContent'), 'Answer C');
  await evaluate('document.querySelector(".decide-bar .answer").click()');
  await until(async () => (await evaluate('location.hash')) !== '#decide/when');
  assert.equal(JSON.parse(run('answers', file, '--json').out).when.answer, 'c');
  close();
  proc.kill();
});

test('a posted contract design is listed under Designs only, never in Decide or a count of asks until Main promotes it, with its preview and date, and opens for a saved approve/change review', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
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
  // A lead's design is Main's to review: Today counts no ask for it and links it under Designs, and Decide is all clear with no badge.
  await evaluate(`location.href = ${JSON.stringify(url)}`);
  await until(async () => (await evaluate('document.querySelector("a.more[href=\'#designs\']")?.textContent')) === 'Designs (1)');
  assert.equal(await evaluate('[...document.querySelectorAll(".tiles .tile")].map((t) => t.textContent.replace(/\\s+/g, " ").trim()).slice(0, 3).join("|")'), '0AnswerAll answered|0ReviewNothing to review|0Sign inNothing waiting');
  assert.equal(await evaluate('document.querySelector(".up-next h2")?.textContent'), "You're all clear");
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  await until(async () => (await evaluate('document.querySelector(".waiting-lede")?.textContent')) === 'Nothing waiting');
  assert.equal(await evaluate('!document.querySelector("#item-d1-design") && !document.querySelector("#tabs a[href=\'#waiting\'] .bd, #nav a[href=\'#waiting\'] .n")'), true);
  // Main promotes it: it waits in Decide like any ask, and --undo puts it back under Designs.
  assert.match(run('promote', 'd1-design', file).out, /promoted\[1\]: d1-design/);
  await evaluate('location.reload()');
  await until(async () => (await evaluate('document.querySelector("#item-d1-design .title")?.textContent')) === message.title);
  assert.equal(await evaluate('document.querySelector("#item-d1-design .tm")?.textContent + "|" + document.querySelector("#item-d1-design .sub")?.textContent'), '18 Oct|17 screens · Agent'); // the row is its title, how many screens it holds and when it came
  assert.equal(await evaluate('document.querySelector("#item-d1-design")?.getAttribute("href")'), '#designs/d1-design');
  assert.equal(await evaluate('document.querySelector(".waiting-lede")?.textContent'), '1 waiting');
  assert.match(run('promote', 'd1-design', file, '--undo').out, /unpromoted\[1\]: d1-design/);
  await evaluate('window.old = true, location.reload()');
  await until(async () => (await evaluate('!window.old && document.querySelector(".waiting-lede")?.textContent')) === 'Nothing waiting');
  // Only a design is promoted, and only a key on the board.
  assert.equal(run('promote', 'nope', file).code, 1);
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs`)}`);
  await until(async () => (await evaluate('document.querySelector(".designs strong")?.textContent')) === message.title);
  assert.equal(await evaluate('document.querySelector(".designs img")?.getAttribute("src")'), `/design/local/d1-design/${encodeURIComponent(message.preview)}`);
  assert.equal(await evaluate('document.querySelector(".designs .when")?.textContent'), 'In review · 18 Oct');
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
  await until(async () => (await evaluate('document.querySelector(".designs .when")?.textContent')).startsWith('Changes requested'));
  // Main's verdict is no answer of the user's: Today lists nothing under Answered for it.
  await evaluate(`location.href = ${JSON.stringify(url)}`);
  await until(async () => (await evaluate('document.querySelector("a.more[href=\'#designs\']")?.textContent')) === 'Designs (1)');
  assert.equal(await evaluate('document.querySelector("a.more[href=\'#answered\']")'), null);
  const desktop = await browse(join(dir, 'desktop-browser'), 1280);
  await desktop.evaluate(`location.href = ${JSON.stringify(`${url}#designs`)}`);
  await until(async () => (await desktop.evaluate('document.querySelector("#nav a[href=\\"#waiting\\"][aria-current=page]")?.textContent.trim().startsWith("Decide")')) === true);
  await desktop.evaluate(`location.href = ${JSON.stringify(`${url}#designs/d1-design`)}`);
  await until(async () => (await desktop.evaluate('document.querySelector(".design-review .foot button")?.textContent')) === 'Approve');
  assert.equal(await desktop.evaluate('document.querySelector("#nav a[href=\\"#waiting\\"][aria-current=page]")?.getClientRects().length > 0'), true);
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
  await until(async () => (await evaluate('String(document.querySelector(".design-review textarea").compareDocumentPosition([...document.querySelectorAll(".design-review > a")].find((a) => a.textContent === "Open original design")))')) === '4');
  // The old page stays readable for a moment after location.reload(), so the wait names this load: a button read and clicked
  // on the outgoing page goes away with it, and the viewer it opened never shows.
  await evaluate('window.old = true, location.reload()');
  await until(async () => (await evaluate('!window.old && document.querySelector("[aria-haspopup=dialog]")?.textContent')) === 'Review full screen');
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
  await until(async () => (await evaluate('document.querySelector(".designs .when")?.textContent')).startsWith('Changes requested'));
  assert.match(await evaluate('document.querySelector(".designs")?.textContent'), /Clarify the overall hierarchy/);
  close();
  proc.kill();
});

test('an answers-only board takes a screen review: typing a note in the viewer enables Request change, and a tap sends it', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'answers-only-viewer'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(join(dir, 'design', 'a.png'), png);
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd3-fed', title: 'Review the fed screen', about: 'A program feeds this board.', group: 'Sign-in',
    filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png',
    journeys: [{ id: 'flow', title: 'Flow', screens: [{ id: 'a', title: 'First', views: { phone_light: 'design/a.png' } }] }] };
  writeFileSync(source, JSON.stringify(message));
  assert.equal(run('post', file, '--kind', 'design', '--from', source).code, 0);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), answers_only: true }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], { evaluate, tap, insertText, close } = await browse(join(dir, 'browser'), 390, 844, true);
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs/d3-fed`)}`);
  await until(async () => (await evaluate('document.querySelector("[aria-haspopup=dialog]")?.textContent')) === 'Review full screen');
  await evaluate('document.querySelector("[aria-haspopup=dialog]").click()');
  await until(() => evaluate('!!document.querySelector(".design-viewer[open]")'));
  const centre = (label) => evaluate(`(() => { const r = [...document.querySelectorAll(".design-viewer .foot button")].find((b) => b.textContent === ${JSON.stringify(label)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await evaluate('document.querySelector(".design-viewer textarea").focus()');
  await insertText('Make the title clearer');
  assert.equal(await evaluate('document.querySelector(".design-viewer textarea").value'), 'Make the title clearer');
  assert.equal(await evaluate('[...document.querySelectorAll(".design-viewer .foot button")].find((b) => b.textContent === "Request change").disabled'), false);
  await tap(await centre('Request change'));
  await until(async () => (await evaluate('document.querySelector(".design-viewer [role=status]")?.textContent')) === 'Changes requested');
  assert.deepEqual(JSON.parse(run('answers', file, '--json').out)['d3-fed'].notes, [{ journey: 'flow', screen: 'a', verdict: 'change', note: 'Make the title clearer' }]);
  close();
  proc.kill();
});

test('a screen approval on a design with no design verdict keeps the design waiting, and a viewer Request change answers it as Changes requested', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
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
  // Still no verdict: under review by Main, not answered (a design waits on the user only once promoted).
  assert.match(run('list', file, '--full').out, /d2-screens,in review,/);
  // Request change on the next screen is the person's answer: the design reads Changes requested and leaves waiting.
  await evaluate('document.querySelector("[aria-label=\\"Next screen\\"]").click()');
  await evaluate('document.querySelector(".design-viewer textarea").value = "Make the title clearer"');
  await evaluate('[...document.querySelectorAll(".design-viewer .foot button")].find((b) => b.textContent === "Request change").click()');
  await until(async () => JSON.parse(run('answers', file, '--json').out)['d2-screens'].notes.length === 2);
  const changed = JSON.parse(run('answers', file, '--json').out)['d2-screens'];
  assert.deepEqual([changed.answer, changed.label], ['change', 'Changes requested']);
  assert.match(run('list', file).out, /answered: 1/);
  await evaluate('document.querySelector("[aria-label=\\"Close viewer\\"]").click()');
  await until(async () => (await evaluate('document.querySelector(".design-review [role=status]")?.textContent')) === 'Changes requested');
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

const flowMessage = (key, screens) => ({ contract: 1, kind: 'design', schema: 1, key, title: 'Review the flow screens',
  about: 'Approve each screen of the flow.', group: 'Sign-in', filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png',
  options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], recommend: 'a', journeys: [{ id: 'flow', title: 'Flow', screens: screens.map((id) => ({ id, title: id, views: { phone_light: 'design/preview.png' } })) }] });

test('an empty inline save clears the selected screen note', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'empty-inline-save'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(source, JSON.stringify(flowMessage('d3-empty-save', ['a', 'b'])));
  assert.equal(run('post', file, '--kind', 'design', '--from', source).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], { evaluate, close } = await browse(join(dir, 'browser'), 1280);
  const saved = () => JSON.parse(run('answers', file, '--json').out)['d3-empty-save'];
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs/d3-empty-save`)}`);
  await until(async () => (await evaluate('document.querySelector(".design-review .foot button")?.textContent')) === 'Approve');
  await evaluate('document.querySelector("[aria-label=\\"Screen for note\\"]").value = "flow/b"');
  await evaluate('document.querySelector("[aria-label=\\"Pick a direction\\"]").value = "a"');
  await evaluate('document.querySelector(".design-review textarea").value = "Fix the title"');
  await evaluate('document.querySelector(".design-review .foot button:last-child").click()');
  await until(async () => saved()?.notes?.length === 1);
  await evaluate('document.querySelector(".design-review textarea").value = ""');
  await evaluate('document.querySelector(".design-review .foot button").click()');
  await until(async () => saved().answer === 'approve' && saved().notes.length === 0);
  assert.deepEqual([saved().answer, saved().notes], ['approve', []]);
  close();
  proc.kill();
});

test('a save drops a stored screen note whose screen a re-post removed', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'stale-screen-note'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(source, JSON.stringify(flowMessage('d3-stale', ['a', 'b'])));
  assert.equal(run('post', file, '--kind', 'design', '--from', source).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], { evaluate, close } = await browse(join(dir, 'browser'), 1280);
  const saved = () => JSON.parse(run('answers', file, '--json').out)['d3-stale'];
  const change = await post(url, 'api/answers', { key: 'd3-stale', verdict: 'change', pick: 'a', notes: [{ journey: 'flow', screen: 'b', verdict: 'change', note: 'Fix the title' }] });
  assert.equal(change.status, 200);
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  stored.items.find((i) => i.key === 'd3-stale').journeys = flowMessage('d3-stale', ['a']).journeys;
  writeFileSync(file, JSON.stringify(stored));
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs/d3-stale`)}`);
  await until(async () => (await evaluate('document.querySelector(".design-review .foot button")?.textContent')) === 'Approve');
  await evaluate('document.querySelector("[aria-label=\\"Pick a direction\\"]").value = "a"');
  await evaluate('document.querySelector(".design-review .foot button").click()');
  await until(async () => saved().answer === 'approve');
  assert.deepEqual([saved().answer, saved().notes], ['approve', []]);
  assert.equal(await evaluate('document.querySelector(".design-review .err").textContent'), '');
  close();
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

test('a screen save drops a stored pick that is no longer a listed option', async () => {
  const dir = join(scratch, 'screens-pick-relisted'), file = join(dir, 'board.json'), message = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(join(dir, 'design', 'a.png'), png);
  const design = (options) => ({ contract: 1, kind: 'design', schema: 1, key: 'd5-pick', title: 'Look', about: 'Pick a look.', group: 'Sign-in',
    filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png', options, recommend: options[0].value,
    journeys: [{ id: 'flow', title: 'Flow', screens: [{ id: 'a', title: 'First', views: { phone_light: 'design/a.png' } }] }] });
  writeFileSync(message, JSON.stringify(design([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }])));
  assert.equal(run('post', file, '--kind', 'design', '--from', message).code, 0);
  let proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  let url = /url: "(\S+)"/.exec(await served(proc))[1];
  assert.equal((await post(url, 'api/answers', { key: 'd5-pick', pick: 'a', notes: [{ journey: 'flow', screen: 'a', verdict: 'approve', note: '' }] })).status, 200);
  proc.kill();
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...doc, items: doc.items.map((i) => i.key === 'd5-pick' ? { ...i, options: [{ value: 'c', label: 'C' }, { value: 'd', label: 'D' }], recommend_value: 'c' } : i) }));
  proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  url = /url: "(\S+)"/.exec(await served(proc))[1];
  assert.equal((await post(url, 'api/answers', { key: 'd5-pick', notes: [{ journey: 'flow', screen: 'a', verdict: 'approve', note: '' }] })).status, 200);
  const read = JSON.parse(run('answers', file, '--json').out)['d5-pick'];
  assert.equal(read.answer, 'screens');
  assert.equal(read.pick, undefined);
  proc.kill();
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

test('a plain wait wakes when a viewer request changes an approved design', async () => {
  const dir = join(scratch, 'approved-rewake'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(join(dir, 'design', 'a.png'), png);
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd5-rewake', title: 'Review the flow screens',
    about: 'Approve each screen of the flow.', group: 'Sign-in', filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png',
    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], recommend: 'a',
    journeys: [{ id: 'flow', title: 'Flow', screens: [{ id: 'a', title: 'First', views: { phone_light: 'design/a.png' } }] }] };
  writeFileSync(source, JSON.stringify(message));
  assert.equal(run('post', file, '--kind', 'design', '--from', source).code, 0);
  assert.equal(run('raise', file, '--title', 'Keep the digest?').code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  assert.equal((await post(url, 'api/answers', { key: 'd5-rewake', verdict: 'approve', pick: 'a', notes: [] })).status, 200);
  const watching = "import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module'; const { watch } = fs;"
    + " fs.watch = (...a) => { try { return watch(...a); } finally { process.stderr.write('watching'); } }; syncBuiltinESMExports();";
  const waiting = spawn('node', ['--import', `data:text/javascript,${encodeURIComponent(watching)}`, cli, 'wait', file, '--timeout', '20'], { env });
  let waited = '';
  waiting.stdout.on('data', (b) => (waited += b));
  const exited = new Promise((ok) => waiting.on('exit', ok));
  await new Promise((ok) => { waiting.stderr.on('data', (b) => /watching/.test(b) && ok()); waiting.once('exit', ok); });
  const changeA = { journey: 'flow', screen: 'a', verdict: 'change', note: 'fix spacing' };
  assert.equal((await post(url, 'api/answers', { key: 'd5-rewake', notes: [changeA], requested: true })).status, 200);
  assert.equal(await exited, 0);
  assert.match(waited, /d5-rewake/);
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
  // Closing hands the focus back to Review full screen once the board has redrawn, so the form below is the one to fill.
  await evaluate('document.querySelector(".design-viewer header button").click()');
  await until(() => evaluate('!document.querySelector(".design-viewer[open]") && !!document.activeElement?.matches("[data-design]")'));
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

test('a design posted again is a new round: the note box starts empty, the earlier note is in the card\'s Activity once, and a save on this round leaves it out', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'design-new-round'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(join(dir, 'design', 'a.png'), png);
  writeFileSync(join(dir, 'design', 'b.png'), png);
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd6-round', title: 'Review the flow screens',
    about: 'Approve each screen of the flow.', group: 'Sign-in', filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png',
    journeys: [{ id: 'flow', title: 'Flow', screens: [
      { id: 'a', title: 'First', views: { phone_light: 'design/a.png' } },
      { id: 'b', title: 'Second', views: { phone_light: 'design/b.png' } },
    ] }] };
  writeFileSync(source, JSON.stringify(message));
  assert.equal(run('post', file, '--kind', 'design', '--from', source).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], { evaluate, close } = await browse(join(dir, 'browser'), 390, 844, true);
  assert.equal((await post(url, 'api/answers', { key: 'd6-round', verdict: 'change', notes: [{ journey: 'flow', screen: 'a', verdict: 'change', note: 'Round one: bigger title' }] })).status, 200);
  const open = async () => {
    await evaluate(`(() => { const u = ${JSON.stringify(`${url}#designs/d6-round`)}; if (location.href === u) location.reload(); else location.href = u; })()`);
    await until(() => evaluate('!!document.querySelector(".design-review textarea")'));
    // The note box, and the card's Activity: each answer step and the notes it shows.
    return evaluate('({ note: document.querySelector(".design-review textarea").value, steps: [...document.querySelectorAll(".design-review .thread .th-t")].map((e) => e.textContent).filter((t) => t.startsWith("Your answer")), notes: [...document.querySelectorAll(".design-review .thread .th-n")].map((e) => e.textContent) })');
  };
  // The same round: the note is the one being written, nothing earlier.
  assert.deepEqual(await open(), { note: 'Round one: bigger title', steps: ['Your answer: Changes requested'], notes: [] });
  // The agent draws the screen again in place: same key, same fields, new bytes. That is a new round.
  writeFileSync(join(dir, 'design', 'a.png'), sized(4, 4));
  assert.deepEqual(await open(), { note: '', steps: ['Your answer on the earlier round: Changes requested (First)'], notes: ['“Round one: bigger title”'] });
  // In the viewer the screen is not reviewed yet, and approving it sends this round's note only: the earlier change does not carry over.
  await evaluate('document.querySelector("[aria-haspopup=dialog]").click()');
  await until(async () => (await evaluate('document.querySelector(".design-viewer[open] [role=status]")?.textContent')) === 'Not reviewed yet');
  await evaluate('document.querySelector(".design-viewer .open-link").click()');
  await until(async () => (await evaluate('document.querySelector(".design-viewer[open] [role=status]")?.textContent')) === 'Screen approved');
  const saved = JSON.parse(run('answers', file, '--json').out)['d6-round'];
  assert.deepEqual([saved.answer, saved.notes], ['screens', [{ journey: 'flow', screen: 'a', verdict: 'approve', note: '' }]]);
  // The earlier note stays in the Activity after this round's first save, with this round's answer after it.
  assert.deepEqual(await open(), { note: '', steps: ['Your answer on the earlier round: Changes requested (First)', 'Your answer: Screens reviewed'], notes: ['“Round one: bigger title”'] });
  // An answer saved before answers named their round counts as this round's only when it came after the design was filed.
  const answers = join(dir, 'board.answers.jsonl'), old = (at) => appendFileSync(answers, `${JSON.stringify({ key: 'd6-round', answer: 'change', label: 'Changes requested', close: 'done', at, notes: [{ journey: 'flow', screen: 'a', verdict: 'change', note: 'Older note' }] })}\n`);
  old('2026-10-19T08:00:00Z');
  // The Activity is in time order, and this older answer is dated before round one's.
  assert.deepEqual(await open(), { note: 'Older note', steps: ['Your answer: Changes requested', 'Your answer on the earlier round: Changes requested (First)'], notes: ['“Round one: bigger title”'] });
  old('2026-10-17T08:00:00Z');
  assert.deepEqual(await open(), { note: '', steps: ['Your answer on the earlier round: Changes requested (First)'], notes: ['“Older note”'] });
  close();
  proc.kill();
});

test('a design review shows its screen on a phone in light and dark: the page fills the preview, and a screen whose file is gone shows the preview picture and says so', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'design-preview-phone'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), sized(390, 844));
  const page = (bg, fg) => `<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:0;padding:24px;background:${bg};color:${fg};font:32px sans-serif"><h1>Fleet overview</h1><p>sign-off working</p><p>muxr needs a decision</p>`;
  writeFileSync(join(dir, 'design', 'light.html'), page('#fff', '#111'));
  writeFileSync(join(dir, 'design', 'dark.html'), page('#111', '#eee'));
  writeFileSync(join(dir, 'design', 'gone.html'), page('#fff', '#111'));
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd7-preview', title: 'Review the fleet screens',
    about: 'The fleet overview.', group: 'Fleet', filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png',
    journeys: [{ id: 'fleet', title: 'Fleet', screens: [
      { id: 'home', title: 'Overview', views: { phone_light: 'design/light.html', phone_dark: 'design/dark.html' } },
      { id: 'gone', title: 'Lanes', views: { phone_light: 'design/gone.html' } },
    ] }] };
  writeFileSync(source, JSON.stringify(message));
  assert.equal(run('post', file, '--kind', 'design', '--from', source).code, 0);
  rmSync(join(dir, 'design', 'gone.html'));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], { evaluate, send, capture, close } = await browse(join(dir, 'browser'), 390, 844, true);
  for (const theme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await evaluate(`(() => { const u = ${JSON.stringify(`${url}#designs/d7-preview`)}; if (location.href === u) location.reload(); else location.href = u; })()`);
    await until(() => evaluate('!!document.querySelector(".design-preview-window iframe")'));
    const box = await evaluate('(() => { const w = document.querySelector(".design-preview-window"); w.scrollIntoView({ block: "start" }); const f = w.firstElementChild.getBoundingClientRect(), r = w.getBoundingClientRect(); return { src: w.firstElementChild.getAttribute("src"), frame: [f.width, f.height], window: [r.left, r.top, r.width, r.height] }; })()');
    assert.ok(box.src.endsWith(`design%2F${theme}.html`), JSON.stringify(box));
    // The page fills the window it is drawn in: no 150px strip over an empty box.
    assert.deepEqual(box.frame, box.window.slice(2), JSON.stringify(box));
    assert.ok(box.frame[1] > 400, JSON.stringify(box));
    // What the screen shows there is the page: its text, not one flat colour.
    const [x, y, width, height] = box.window;
    await until(async () => {
      const { data } = await capture({ x, y, width, height });
      let lo = 255, hi = 0;
      for (let i = 0; i < data.length; i += 4) { const l = (data[i] + data[i + 1] + data[i + 2]) / 3; lo = Math.min(lo, l); hi = Math.max(hi, l); }
      return hi - lo > 150;
    });
    await evaluate('(() => { const s = document.querySelector("select[aria-label=\'Screen for note\']"); s.value = "fleet/gone"; s.dispatchEvent(new Event("change")); })()');
    await until(() => evaluate('document.querySelector(".design-preview-window .design-fallback img")?.naturalWidth > 0'));
    assert.equal(await evaluate('document.querySelector(".design-preview-window figcaption").textContent'), 'This screen could not be shown: this is the design’s preview picture.');
    assert.match(await evaluate('document.querySelector(".design-preview-full").getAttribute("href")'), /design%2Fpreview\.png$/);
  }
  close();
  proc.kill();
});

test('Evidence: an update with no run is never waiting on you, and is listed under Evidence as not run, with no project picker for one project', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'waiting-update'), file = join(dir, 'board.json');
  mkdirSync(dir);
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'upd', type: 'evidence', number: 5, title: 'Login checked', media: [{ path: 'evidence/5/shot.png', sha256: 'a'.repeat(64), bytes: 0 }] },
    { key: 'ship', type: 'ask', title: 'Ship it?' },
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  await until(async () => (await evaluate('document.querySelector("#item-upd") === null && document.querySelector(".dl-row") !== null')));
  assert.equal(await evaluate('document.querySelector("#item-upd")'), null);
  await evaluate(`location.href = ${JSON.stringify(`${url}#evidence`)}`);
  await until(async () => (await evaluate('document.querySelector("#item-upd") !== null')));
  assert.equal(await evaluate('document.querySelector("#item-upd .m span").textContent'), 'Not run');
  // With proof for only one project there is nothing to pick: the search box stands alone.
  assert.equal(await evaluate('document.getElementById("ev-project")'), null);
  close();
  proc.kill();
});

test('Evidence: with no --evidence-root a linked run is found in done-done\'s own folder for its app, so a passed run says Passed, and a run found nowhere is listed as not run rather than claimed', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'store'), file = join(dir, 'board.json'), home = join(dir, 'home'), app = join(home, '.done-done', 'evidence', 'sign-off');
  const shot = readFileSync(new URL('../fixtures/evidence/product-small.png', import.meta.url)), commit = 'c0ffee'.padEnd(40, '0'), runId = '20261011T120000Z-a1b2c3d4';
  mkdirSync(join(app, '.done-done', 'runs'), { recursive: true });
  mkdirSync(join(app, runId));
  writeFileSync(join(app, runId, 'after.png'), shot);
  writeFileSync(join(app, '.done-done', 'runs', `${runId}.json`), JSON.stringify({ schema: 1, run_id: runId, commit, tree: 'a'.repeat(40), dirty: false, exit: 0,
    files: [{ path: `${runId}/after.png`, sha256: createHash('sha256').update(shot).digest('hex'), bytes: shot.length }] }));
  const link = (run_id) => ({ run_id, commit, outcome: 'You can read every card on a phone.', repro: 'repro: npm test', proof: 'done-done-verify-sign-off: npm test, phone, 390, passed', evidence: 'after.png' });
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'found', type: 'evidence', number: 1, title: 'Run in the store', filed: new Date().toISOString(), evidence: link(runId) },
    { key: 'lost', type: 'evidence', number: 2, title: 'Run nowhere', filed: new Date().toISOString(), evidence: link('20261011T130000Z-b2c3d4e5') },
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env: { ...env, HOME: home }, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const api = await (await fetch(`${url}api/decisions`)).json();
  assert.deepEqual(api.decisions.map((d) => [d.key, d.evidenceCard?.result ?? null]), [['found', 'RUN PASS'], ['lost', null]]);
  // The run's own capture is served from the folder the record was found in.
  assert.equal((await fetch(`${url}${api.decisions[0].evidenceCard.media[0].url.slice(1)}`)).status, 200);
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#evidence`)}`);
  const result = (key) => evaluate(`document.querySelector("#item-${key} .m span")?.textContent`);
  await until(async () => (await result('found')) === 'Passed');
  // A run found nowhere is claimed as nothing: its update is on Evidence, saying it was not run.
  assert.equal(await result('lost'), 'Not run');
  close();
  proc.kill();
});

test('Today on a phone: the floating tab bar with its pill on Today, Up next with one main action, four tiles two by two, the latest proof as rows each with its tall capture filling a small frame from the top and proof with only text a row with its check and no empty frame, nothing wider than the screen, and Ask the agent one row at the foot', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'summary-wide'), file = join(dir, 'board.json');
  mkdirSync(join(dir, 'page'), { recursive: true });
  // A capture as tall and thin as a phone screenshot (414 x 2262).
  const bytes = sized(90, 492), sha = createHash('sha256').update(bytes).digest('hex');
  const fixture = new URL('../fixtures/contract/plan.v1/', import.meta.url).pathname;
  writeFileSync(join(dir, 'page', 'index.html'), readFileSync(join(fixture, 'page', 'index.html')));
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'a', type: 'ask', title: 'Keep the whole-fleet nightly reconciliation of the cross-repository dependency graph running at three in the morning?', about: `https://example.com/${'very-long-path/'.repeat(12)}end` },
    // Each update links a run so its card has a result; the third, like a CLI journey, posts no capture and its run kept only text.
    ...[1, 2, 3].map((n) => ({ key: `u${n}`, type: 'evidence', number: n, title: `Update ${n} proves it`, filed: new Date().toISOString(), ...(n < 3 && { media: [{ path: `evidence/${n}/shot.png`, sha256: sha, bytes: bytes.length }] }),
      evidence: { run_id: `2026101${n}T120000Z-a1b2c3d4`, commit: 'c0ffee'.padEnd(40, '0'), outcome: 'It works.', repro: 'repro: npm test', proof: 'done-done-verify-sign-off: npm test, passed', evidence: 'shot.png' } })),
  ] }));
  writeFileSync(join(dir, 'shot.png'), bytes);
  for (const n of [1, 2, 3]) { mkdirSync(join(dir, 'evidence', `${n}`), { recursive: true }); writeFileSync(join(dir, 'evidence', `${n}`, 'shot.png'), bytes); }
  mkdirSync(join(dir, '.done-done', 'runs'), { recursive: true });
  const tap = Buffer.from('ok 1 - stop leaves the other board running\n'), tapFile = { path: 'stop.txt', sha256: createHash('sha256').update(tap).digest('hex'), bytes: tap.length };
  writeFileSync(join(dir, 'stop.txt'), tap);
  for (const n of [1, 2, 3]) writeFileSync(join(dir, '.done-done', 'runs', `2026101${n}T120000Z-a1b2c3d4.json`), JSON.stringify({ schema: 1, run_id: `2026101${n}T120000Z-a1b2c3d4`, commit: 'c0ffee'.padEnd(40, '0'), tree: 'a'.repeat(40), dirty: false, exit: 0, files: [n < 3 ? { path: 'shot.png', sha256: sha, bytes: bytes.length } : tapFile] }));
  assert.equal(run('post', file, '--kind', 'plan', '--from', join(fixture, 'valid-full.json')).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0', '--evidence-root', dir], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390, 844);
  await evaluate(`location.href = ${JSON.stringify(url)}`);
  await until(async () => (await evaluate('document.querySelectorAll(".t-proof .lrow").length')) === 3);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= 390'));
  // The tab bar floats 12px over the bottom edge with 16px either side, 62px tall, and its pill sits on Today.
  const rect = (sel) => `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)]; })()`;
  const bar = await evaluate(rect('.tabs'));
  assert.deepEqual([bar[0], (await evaluate('document.documentElement.clientWidth')) - bar[1], bar[3] - bar[2], (await evaluate('innerHeight')) - bar[3]], [16, 16, 62, 12]);
  await until(async () => (await evaluate(rect('.tabs .hl')))[0] === (await evaluate(rect('.tabs a[href="#"]')))[0]);
  // Up next is the plan, to review: its kind in the line over its title and one main action that opens it.
  assert.equal(await evaluate('document.querySelector(".up-next .lk").textContent.startsWith("Up next · Review") + "|" + document.querySelector(".up-next .go").getAttribute("href")'), `true|#waiting/${JSON.parse(readFileSync(join(fixture, 'valid-full.json'), 'utf8')).key}`);
  // Four tiles, two by two, each 92px tall and as wide as its neighbour.
  const tiles = await evaluate('[...document.querySelectorAll(".tile")].map((t) => { const r = t.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })');
  assert.equal(tiles.length, 4);
  assert.ok(tiles[0][1] === tiles[1][1] && tiles[2][1] === tiles[3][1] && tiles[2][1] > tiles[0][1] && tiles[0][0] === tiles[2][0] && tiles.every((t) => t[2] === tiles[0][2] && t[3] === 92), JSON.stringify(tiles));
  // Each proof row with a capture carries it, filling a 36 by 48 frame from the top instead of shrinking to a sliver;
  // the proof that kept only text has its result's check where the frame would be, never an empty frame.
  await until(() => evaluate('[...document.querySelectorAll(".t-proof .mini img")].every((i) => i.naturalWidth > 0)'));
  assert.deepEqual(await evaluate('(() => { const a = document.querySelector(\'.t-proof a[href="#evidence/u3"]\'); return [!!a.querySelector(".mini"), a.querySelector(".donek")?.className, a.querySelector(".res").textContent]; })()'), [false, 'donek ok', 'Passed']);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".t-proof .mini")].map((f) => { const i = f.querySelector("img"), a = f.getBoundingClientRect(), b = i.getBoundingClientRect(), c = getComputedStyle(i); return [Math.round(a.width), Math.round(a.height), Math.round(b.width - a.width), Math.round(b.height - a.height), c.objectFit, c.objectPosition].join(); })'),
    Array(2).fill('36,48,0,0,cover,50% 0%'));
  // Closed, Ask the agent is one line of text in a 44px row with no box around it; a tap opens the prompt box.
  const ask = await evaluate('(() => { const a = document.querySelector("details.ask"), s = a.querySelector("summary"), r = document.createRange(); r.selectNodeContents(s); const box = a.getBoundingClientRect(), t = r.getBoundingClientRect(), c = getComputedStyle(a); return [a.open, Math.round(box.height), Math.abs(Math.round((t.top + t.bottom) / 2 - (box.top + box.bottom) / 2)) <= 2, c.borderTopWidth, c.backgroundColor, Math.round(t.left)]; })()');
  assert.deepEqual(ask, [false, 44, true, '0px', 'rgba(0, 0, 0, 0)', 20]);
  await evaluate('document.querySelector("details.ask summary").click()');
  assert.ok(await evaluate('document.querySelector("details.ask").open && document.getElementById("prompt").getBoundingClientRect().height > 40'));
  // The last thing on Today scrolls fully clear of the floating tab bar.
  await evaluate('scrollTo(0, document.documentElement.scrollHeight)');
  assert.ok(await evaluate('document.querySelector(".t-foot").getBoundingClientRect().bottom <= document.querySelector(".tabs").getBoundingClientRect().top'));
  // On Evidence the same proof is a compact row of its claim and its Passed check, with no frame left empty.
  await evaluate('location.hash = "#evidence"');
  await until(async () => await evaluate('!!document.getElementById("item-u3")'));
  assert.deepEqual(await evaluate('(() => { const c = document.getElementById("item-u3"); return [c.classList.contains("ev-text"), c.querySelectorAll(".ev-media").length, c.querySelector(".t").firstChild.textContent, c.querySelector(".m").textContent.startsWith("Passed")]; })()'),
    [true, 0, 'It works.', true]);
  // With no designs filed, the Designs screen still opens, under the lit Decide tab, and the pill slides to it.
  await evaluate('location.hash = "#designs"');
  await until(async () => (await evaluate('document.querySelector("#board h1").textContent')) === 'Designs');
  assert.equal(await evaluate('document.querySelector(".tabs [aria-current]").getAttribute("href")'), '#waiting');
  await until(async () => (await evaluate(rect('.tabs .hl')))[0] === (await evaluate(rect('.tabs a[href="#waiting"]')))[0]);
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

test('Decide: a diagram, an interactive page, an explainer and a free-form fed type each show the type their answers make', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'view-types'), file = join(dir, 'board.json'), mocks = join(dir, 'mocks');
  mkdirSync(mocks, { recursive: true });
  const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
  writeFileSync(join(mocks, 'flow.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>');
  writeFileSync(join(mocks, 'walk.html'), '<p>The new flow</p>');
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    { key: 'flow', type: 'diagram', title: 'Is this the sign-in flow?', view: 'mocks/flow.svg', options: yesNo, area: 'waiting' },
    { key: 'walk', type: 'interactive', title: 'Walk through the new flow?', view: 'mocks/walk.html', options: yesNo, area: 'waiting' },
    { key: 'tour', type: 'explainer', title: 'Take the tour?', media: [{ path: 'evidence/1/tour.webm', sha256: 'a'.repeat(64), bytes: 0 }], options: yesNo, area: 'waiting' },
    { key: 'site', type: 'site-check', title: 'Check the site?', options: yesNo, area: 'waiting' },
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'b'), 390);
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  const titles = () => evaluate('[...document.querySelectorAll(".ask-card .title")].map((e) => e.textContent)');
  // All four take a yes or a no, so each row says Yes/No, never its content type.
  await until(async () => (await titles()).length === 4);
  assert.equal(await evaluate('[...document.querySelectorAll(".dl-face .sub")].map((s) => s.textContent).join("|")'), Array(4).fill('Yes/No · Agent').join('|'));
  for (const [name, key] of [['Check the site?', 'site'], ['Take the tour?', 'tour'], ['Walk through the new flow?', 'walk'], ['Is this the sign-in flow?', 'flow']]) {
    // A click is retried while the list is still drawing: a card that is not there yet is not a missed tap.
    await until(async () => (await evaluate(`document.querySelector("#item-${key}")?.click() ?? true`))
      && (await evaluate('location.hash')) === `#decide/${key}`);
    assert.equal(await evaluate('document.querySelector(".decide .eyebrow")'), null);
    await evaluate('location.hash = "#waiting"');
    // Wait for the list to come back before the next card is tapped.
    await until(async () => (await titles()).length === 4);
  }
  close();
  proc.kill();
});

test('Clear all done on 201 answered items, one grouped list on a wide screen: the page empties in chunks, says so, and Undo brings all 201 back', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
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
  // On a wide screen the rows stay one grouped list: the second row sits under the first, at the same left edge.
  assert.ok(await evaluate('(([a, b]) => b.top >= a.bottom && b.left === a.left)([...document.querySelectorAll(".rows.i-answered > li")].map((li) => li.getBoundingClientRect()))'));
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
  const reader = document.getElementById('reader'), covered = reader && !reader.hidden ? document.getElementById('board') : null;
  for (const e of document.querySelectorAll('body *')) {
    const nodes = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()), t = nodes.map((n) => n.textContent).join('').trim();
    if (!t || !e.checkVisibility({ visibilityProperty: true }) || (covered && covered.contains(e))) continue;
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

test('a long answer at 390 px sits under its long title, which keeps most of the row and wraps by words, on Answered', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
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
  for (const [hash, h1] of [['#answered', 'Answered']]) {
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

test('Evidence: a card per proof ever filed, in one list, newest first, with a project picker, with its capture as the hero, its result, its time and what it proves; Proven today counts only the passed ones of the last day, and a failed run is on neither; the card opens the update, which shows the whole shot, what ran, who checked it, the change, when, and its verdict; at 1440 Today sets the proof beside the asks and Evidence is a list beside the selected update, and nothing squashed at 390', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'updates'), file = join(dir, '.sign-off', 'decisions.json');
  mkdirSync(dir);
  run('init', dir);
  const shot = (name, w, h) => (writeFileSync(join(dir, name), sized(w, h)), join(dir, name));
  const [tall, wide] = [shot('tall.png', 300, 600), shot('wide.png', 600, 300)];
  const update = (...media) => run('post', file, '--type', 'evidence', '--title', 'Sign-in', '--about', 'Loads in 1 second.', ...media.flatMap((m) => ['--media', m])).code;
  assert.deepEqual([update(tall), update(wide, tall), update(wide)], [0, 0, 0]);
  // No update is an ask: the first links a failed run, so its result shows as failed and it is no proof.
  // Legacy and done-done-prefixed proof lines name one project, regardless of case.
  const doc = JSON.parse(readFileSync(file, 'utf8')), old = new Date(Date.now() - 3 * 864e5), commit = 'c0ffee'.padEnd(40, '0');
  const outcome = 'You can read every card on a phone.', wideBytes = readFileSync(wide), hash = createHash('sha256').update(wideBytes).digest('hex');
  doc.items[0].filed = old.toISOString();
  // The run records the board verifies under --evidence-root list their file, hashed; the third one exited 1 and the fourth's hash no longer matches the file.
  const runs = ['20261011T120000Z-a1b2c3d4', '20261011T130000Z-b2c3d4e5', '20261011T140000Z-c3d4e5f6', '20261011T150000Z-d4e5f6a7'];
  const link = (run_id, proof = 'done-done-verify-sign-off: npm test, phone, 390, passed') => ({ run_id, commit, outcome, repro: 'repro: npm test', proof, evidence: 'wide.png' });
  mkdirSync(join(dir, '.done-done', 'runs'), { recursive: true });
  for (const [runId, exit, sha] of [[runs[0], 0, hash], [runs[1], 0, hash], [runs[2], 1, hash], [runs[3], 0, 'b'.repeat(64)]]) writeFileSync(join(dir, '.done-done', 'runs', `${runId}.json`), JSON.stringify({ schema: 1, run_id: runId, commit, tree: 'a'.repeat(40), dirty: false, exit,
    files: [{ path: 'wide.png', sha256: sha, bytes: wideBytes.length }] }));
  Object.assign(doc.items[0], { evidence: link(runs[2]) });
  Object.assign(doc.items[1], { evidence: link(runs[1], 'npm test, phone, passed') });
  Object.assign(doc.items[2], { title: 'sign-off board verify: pass', about: outcome, evidence: link(runs[1], 'verify-Sign-Off: npm test, phone, 390, passed') });
  // A link that is not a full URL stays text: the update it is on still opens.
  doc.items[1].link = 'http://%';
  mkdirSync(join(dir, '.sign-off', 'evidence', '4'), { recursive: true });
  writeFileSync(join(dir, '.sign-off', 'evidence', '4', '1.png'), wideBytes);
  const pr = 'https://github.com/umeranjum17/sign-off/pull/12';
  doc.items.push({ key: 'update-4', type: 'evidence', number: 4, title: 'sign-off board verify: pass', about: outcome, filed: new Date().toISOString(), link: pr,
    media: [{ path: 'evidence/4/1.png', sha256: hash, bytes: wideBytes.length }], evidence: link(runs[0]) });
  // A plain update with its own capture and no linked run is not proof, but it is still evidence and never an ask.
  doc.items.push({ key: 'update-5', type: 'evidence', number: 5, title: 'Sign-in, plain update', about: 'Umer checks the plain update.', filed: new Date(Date.now() + 1000).toISOString(),
    link: 'https://github.com/umeranjum17/sign-off/pull/13', media: [{ path: 'evidence/4/1.png', sha256: hash, bytes: wideBytes.length }] });
  // A run whose capture changed after it ran cannot be checked, so its update shows that instead of a pass.
  doc.items.push({ key: 'update-6', type: 'evidence', number: 6, title: 'A capture changed after the run', about: outcome, filed: new Date(Date.now() - 23 * 3_600_000).toISOString(), evidence: link(runs[3]) });
  // Evidence filed over a day ago archives by itself: update-1 was restored (a log line keeps it), update-7 was not.
  doc.items.push({ key: 'update-7', type: 'evidence', number: 7, title: 'Sign-in, last week', about: 'Umer checked it last week.', filed: old.toISOString(), media: [{ path: 'evidence/4/1.png', sha256: hash, bytes: wideBytes.length }] });
  writeFileSync(file, JSON.stringify(doc));
  writeFileSync(file.replace(/\.json$/, '.dismissed.jsonl'), JSON.stringify({ key: 'update-1', dismissed: false, at: new Date().toISOString() }) + '\n');
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0', '--evidence-root', dir], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  let { evaluate, close } = await browse(join(dir, 'b'), 1440);
  await evaluate(`location.href = ${JSON.stringify(`${url}#evidence`)}`);
  // Per card: its id, what it proves, its result and the picture that leads it; every card is drawn.
  const cards = '[...document.querySelectorAll(".ev-card")].map((a) => [a.id, a.querySelector(".t").firstChild.textContent, a.querySelector(".m span").textContent, a.querySelector(".m svg path")?.getAttribute("d") ?? "", a.querySelectorAll(".ev-media img").length])';
  await until(async () => (await evaluate(`${cards}.length === 6 && [...document.querySelectorAll(".ev-media img")].every((i) => i.complete && i.naturalWidth)`)));
  // Nothing is archived on its own: the week-old update-7 is listed, and no Archived row exists.
  assert.equal(await evaluate('document.querySelector(".gone-asks")'), null);
  const clock = (at) => at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const at = (i) => new Date(doc.items[i - 1].filed);
  // Evidence lists every proof in one list, newest first, however old: the plain update (5), the passed ones (4, 3, 2), the unchecked one (6) and last week's (7); only the failed run (1) is left off.
  const passed = ['m9 12 2 2 4-4', 1], none = ['', 1];
  assert.deepEqual(await evaluate(cards), [['item-update-5', 'Sign-in, plain update', 'Not run', ...none], ['item-update-4', outcome, 'Passed', ...passed], ['item-update-3', outcome, 'Passed', ...passed],
    ['item-update-2', outcome, 'Passed', ...passed], ['item-update-6', outcome, 'Could not check', 'M12 7v6', 0], ['item-update-7', 'Sign-in, last week', 'Not run', ...none]]);
  // Four cards share one headline, so each names what tells them apart best, here its own title; a card with a headline of its own names nothing more.
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".ev-card")].map((a) => a.querySelector(".t .also")?.textContent ?? "")'),
    ['', 'sign-off board verify: pass', 'sign-off board verify: pass', 'Sign-in', 'A capture changed after the run', '']);
  for (const n of [4, 3, 2]) assert.equal(await evaluate(`document.getElementById("item-update-${n}").querySelector(".m > span:last-child").textContent`), `Today, ${clock(at(n))}`, `update ${n}`);
  // No project or day headings break the list; a card filed on another day says that day itself.
  assert.equal(await evaluate('document.querySelectorAll("#board h2, #board h3").length'), 0);
  assert.match(await evaluate('document.getElementById("item-update-7").querySelector(".m > span:last-child").textContent'), new RegExp(`, ${clock(at(7))}$`));
  assert.equal(await evaluate('document.querySelector(\'#nav a[href="#evidence"] .n\').textContent'), '6');
  // The project picker: both proof-prefix forms are one project, a capture with no run takes the linked repository, and an unnamed project is Other, last.
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#ev-project option")].map((o) => o.textContent)'), ['All projects', 'sign-off', 'Other']);
  const pick = async (v) => evaluate(`(() => { const p = document.getElementById("ev-project"); p.value = ${JSON.stringify(v)}; p.dispatchEvent(new Event("change")); return [...document.querySelectorAll(".ev-card")].map((a) => a.id); })()`);
  assert.deepEqual(await pick('-'), ['item-update-2', 'item-update-7']);
  assert.deepEqual(await pick('sign-off'), ['item-update-5', 'item-update-4', 'item-update-3', 'item-update-6']);
  assert.equal((await pick('')).length, 6);
  // Today reads the same list: Latest proof is its three newest, and the Proof tile counts it and the failed run it leaves off.
  const newest = await evaluate('[...document.querySelectorAll(".ev-card")].slice(0, 3).map((a) => a.getAttribute("href"))');
  await evaluate('location.hash = ""');
  await until(async () => (await evaluate('document.querySelectorAll(".t-proof .lrow").length')) === 3);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".t-proof .lrow")].map((a) => a.getAttribute("href"))'), newest);
  assert.equal(await evaluate('document.querySelector(".tile.g-proof").getAttribute("aria-label")'), 'Proof, 7: 1 failed, 1 not checked, 5 fine');
  // A desk's Today is a dashboard: the latest proof and the new report sit in a column right of Up next, the proof stacked as rows.
  const box = (sel) => `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom }; })()`;
  const [asks, proof] = [await evaluate(box('.up-next')), await evaluate(box('.t-proof'))];
  assert.ok(proof.left > asks.right && Math.abs(proof.top - asks.top) < 2, 'Latest proof sits right of Up next, level with it');
  const proofRows = await evaluate('[...document.querySelectorAll(".t-proof .lrow")].map((a) => { const r = a.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.height)]; })');
  assert.ok(proofRows.every(([l, t, h], i) => l === proofRows[0][0] && h < 120 && (!i || t > proofRows[i - 1][1])), 'the proof rows stack, each one short');
  await evaluate('location.hash = "#evidence"');
  await until(async () => (await evaluate('document.querySelectorAll(".ev-card").length')) === 6);
  // Evidence on a desk is one list beside the selected update: the cards stack in one column, newest first, and the newest is selected and open beside it.
  const boxes = `[5, 4, 3, 2].map((n) => { const r = document.getElementById(\`item-update-\${n}\`).getBoundingClientRect(); return { n, top: r.top, left: r.left, right: r.right, bottom: r.bottom }; })`;
  const [five, four, three, two] = await evaluate(boxes);
  assert.ok(four.top >= five.bottom && three.top >= four.bottom && two.top >= three.bottom && [four, three, two].every((b) => b.left === five.left), 'one column, newest first, with no heading between');
  await until(async () => (await evaluate('(() => { const a = document.querySelector(".split-list .ev-card[aria-current]"); return a && document.querySelector(".split-detail .ev-title") ? a.id.slice(5) : ""; })()')) === 'update-5');
  assert.deepEqual(await evaluate('[!!document.querySelector(".split-list .ev-grid"), document.querySelector("main").inert, [...document.querySelectorAll(".ev-card[aria-current]")].map((a) => a.id), document.querySelector(".ev-title").textContent]'),
    [true, false, ['item-update-5'], 'Sign-in, plain update']);
  assert.ok((await evaluate(box('.split-detail'))).left >= five.right, 'the update opens right of the list');
  // Under the title: how many are listed, how many filed today and when the newest came.
  assert.equal(await evaluate('document.querySelector(".top .lede").textContent'), 'Every proof filed, newest first.');
  // No update is an ask, whatever its result: Decide counts none of them and Today says nothing needs you.
  // A failed or unchecked update still opens on Evidence with its result, the reason a run could not be checked, and the normal verdicts.
  await evaluate('location.hash = "#waiting"');
  await until(async () => (await evaluate('document.querySelector(".top h1")?.textContent')) === 'Waiting on you' || (await evaluate('document.querySelector(".top h1")?.textContent')) === 'Decide');
  // Decide's red count goes away at zero, as the tab bar's does.
  assert.deepEqual(await evaluate('[!!document.querySelector(\'#nav a[href="#waiting"] .n\'), document.querySelectorAll("[id^=item-update-]").length]'), [false, 0]);
  await evaluate('location.hash = ""');
  await until(async () => (await evaluate('!!document.querySelector(".tile.g-proof")')));
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".tile .n")].map((n) => n.textContent).join() + "|" + !!document.querySelector(".up-next.clear")'), '0,0,0,7|true');
  for (const [k, result, why] of [['update-1', 'Failed', ''], ['update-6', 'Could not check', 'A picture or recording changed after the run. Ask the agent to run the check again.']]) {
    await evaluate(`location.hash = "#evidence/${k}"`);
    await until(async () => (await evaluate('!!document.querySelector(".ev-item")')));
    assert.deepEqual(await evaluate('[document.querySelector(".ev-grp .v").textContent.trim(), [...document.querySelectorAll(".ev-grp .long")].find((c) => c.querySelector(".k").textContent === "Why")?.textContent.slice(3) ?? "", [...document.querySelectorAll(".ev-verdict .choices button")].map((b) => b.textContent)]'),
      [result, why, ['Pass', 'Fail', 'Needs work']]);
  }
  await evaluate('location.hash = "#evidence"');
  await until(async () => (await evaluate('document.querySelectorAll(".ev-card").length')) === 6);
  // An update that waits on nothing is only shown, even on a board that takes answers: no verdict, note or comment controls.
  const kept = doc.items[1].options;
  doc.answers_only = true;
  doc.items[1].options = [];
  writeFileSync(file, JSON.stringify(doc));
  await evaluate('refresh()');
  await evaluate('document.getElementById("item-update-2").click()');
  await until(async () => (await evaluate('location.hash')) === '#evidence/update-2' && (await evaluate('(() => { const a = document.querySelector(".split-list .ev-card[aria-current]"); return a && document.querySelector(".split-detail .ev-title") ? a.id.slice(5) : ""; })()')) === 'update-2');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".ev-verdict")].map((v) => v.textContent)'), []);
  await evaluate('location.hash = "#evidence"');
  await until(async () => (await evaluate('(() => { const a = document.querySelector(".split-list .ev-card[aria-current]"); return a && document.querySelector(".split-detail .ev-title") ? a.id.slice(5) : ""; })()')) === 'update-5');
  delete doc.answers_only;
  doc.items[1].options = kept;
  writeFileSync(file, JSON.stringify(doc));
  await evaluate('refresh()');
  await until(async () => (await evaluate('document.querySelectorAll(".ev-card").length')) === 6);
  // The card opens the update itself: the whole capture, what it proves, then what the check recorded.
  await evaluate('document.getElementById("item-update-4").click()');
  await until(async () => (await evaluate('location.hash')) === '#evidence/update-4' && (await evaluate('document.querySelector(".ev-title")?.textContent')) === outcome);
  // The selection follows the click and the list stays beside the update.
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".ev-card[aria-current]")].map((a) => a.id)'), ['item-update-4']);
  const rows = '[...document.querySelectorAll(".ev-grp .cell")].map((c) => [c.querySelector(".k").textContent, (c.querySelector(".v") ?? c.querySelector(".x")).textContent.trim()])';
  // Checked by is the checker before the proof line's first colon; What ran is the rest of that line.
  assert.deepEqual(await evaluate(rows), [['Result', 'Passed'], ['What ran', 'npm test, phone, 390, passed'], ['Change', 'Pull request 12'],
    ['Project', 'sign-off'], ['Checked by', 'done-done-verify-sign-off'], ['When', `Today, ${clock(at(4))}`]]);
  assert.deepEqual(await evaluate('[document.querySelector(".ev-grp a.cell[href]").getAttribute("href"), document.querySelector("header .change-link").getAttribute("href")]'), [pr, pr]);
  assert.deepEqual(await evaluate('[document.querySelector(".ev-title").textContent, document.querySelectorAll(".ev-hero img").length, document.querySelectorAll(".ev-verdict .choices button").length]'),
    [outcome, 1, 3]);
  assert.equal(await evaluate('document.querySelector(".ev-grp .v.ok svg path").getAttribute("d")'), 'm9 12 2 2 4-4');
  // On a desk the capture fills the preview's width and a tap opens it full size; Pass, Fail and Needs work sit on one row, equally wide.
  await until(() => evaluate('document.querySelector(".ev-hero img")?.naturalWidth > 0'));
  assert.deepEqual(await evaluate('(() => { const i = document.querySelector(".ev-hero img").getBoundingClientRect(), w = document.querySelector(".ev-item").getBoundingClientRect().width, a = document.querySelector(".ev-hero a"); return [Math.round(i.width - w), a.getAttribute("href").startsWith("/api/media?key=update-4"), a.target]; })()'),
    [0, true, '_blank']);
  const verdictRow = 'new Set([...document.querySelectorAll(".ev-verdict .choices button")].map((b) => { const r = b.getBoundingClientRect(); return `${Math.round(r.top)} ${Math.round(r.width)}`; })).size';
  assert.equal(await evaluate(verdictRow), 1);
  // A redraw of the same update keeps its headline, not the raw run title.
  await evaluate('dispatchEvent(new Event("resize"))');
  assert.equal(await evaluate('document.querySelector(".ev-title").textContent'), outcome);
  // The board changes under the open update: the next refresh shows its new proof, not the one it opened with.
  const changed = 'The check now proves something else.';
  doc.items[3].about = changed;
  writeFileSync(file, JSON.stringify(doc));
  await evaluate('refresh()');
  await until(async () => (await evaluate('document.querySelector(".ev-intro")?.textContent')) === changed);
  assert.equal(await evaluate('document.querySelector(".ev-title").textContent'), outcome);
  // A comment sent from the open item shows on it at once and clears the box.
  await evaluate('document.querySelector(".ev-verdict details.other summary").click()');
  await evaluate('(() => { const t = document.querySelector("#note-update-4"); t.value = "Looks right on my phone."; t.dispatchEvent(new Event("input")); })()');
  await evaluate('[...document.querySelectorAll(".ev-verdict button")].find((b) => b.textContent === "Send without answering").click()');
  await until(async () => (await evaluate('[...document.querySelectorAll(".ev-verdict .saved-note")].some((p) => p.textContent.includes("Looks right on my phone."))')));
  assert.equal(await evaluate('document.querySelector("#note-update-4").value'), '');
  // The run's raw lines stay folded under Details until they are asked for.
  await evaluate('document.querySelector(".ev-item .tech summary").click()');
  assert.match(await evaluate('document.querySelector(".ev-item .tech").textContent'), /Commit c0ffee0{34}.*repro: npm test/s);
  // A verdict is saved from the update's own screen, which stays open.
  await evaluate('[...document.querySelectorAll(".ev-verdict .choices button")].find((b) => b.textContent === "Pass").click()');
  await until(async () => (await evaluate('!document.querySelector("#toast").hidden && document.querySelector(".ev-verdict [aria-pressed=true]")?.textContent === "Pass"')));
  assert.equal(await evaluate('location.hash'), '#evidence/update-4');
  // Back on the list, that update is answered: it stays on Evidence, in the Proof tile's count and in Latest proof, since a verdict does not unprove it.
  await evaluate('location.hash = "#evidence"');
  await until(async () => (await evaluate('document.querySelectorAll(".ev-card").length')) === 6);
  await evaluate('location.hash = ""');
  await until(async () => (await evaluate('document.querySelectorAll(".t-proof .lrow").length')) === 3);
  assert.deepEqual(await evaluate('[document.querySelector(".tile.g-proof .n").textContent, [...document.querySelectorAll(".t-proof .lrow")].some((a) => a.getAttribute("href") === "#evidence/update-4")]'), ['7', true]);
  await evaluate('location.hash = "#evidence"');
  await until(async () => (await evaluate('document.querySelectorAll(".ev-card").length')) === 6);
  close();
  // On a phone the card keeps the screen's width, the update's own screen never scrolls sideways and nothing squashes.
  ({ evaluate, close } = await browse(join(dir, 'p'), 390));
  await evaluate(`location.href = ${JSON.stringify(`${url}#evidence`)}`);
  await until(async () => (await evaluate('document.querySelectorAll(".ev-card").length === 6')));
  assert.deepEqual(await evaluate(SQUASH), []);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".ev-card")].filter((a) => a.getBoundingClientRect().width < 0.95 * document.querySelector(".ev-grid").getBoundingClientRect().width).map((a) => a.id)'), []);
  // Each capture fills its tile from the top of the shot, and the tile is half as tall as it is wide.
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".ev-card .ev-media")].filter((m) => m.querySelector("img")).map((m) => { const a = m.getBoundingClientRect(), b = m.querySelector("img").getBoundingClientRect(), c = getComputedStyle(m.querySelector("img")); return [Math.round(b.width - a.width), Math.round(b.height - a.height), c.objectFit, c.objectPosition, Math.round(a.width / a.height)]; }).filter((x) => x.join() !== "0,0,cover,50% 0%,2")'), []);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await evaluate('document.getElementById("item-update-2").click()');
  await until(async () => (await evaluate('!!document.querySelector(".ev-item") && document.querySelectorAll(".ev-hero img").length === 2')));
  // A proof line without the checker prefix shows no Checked by row, and What ran is the whole line.
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".ev-grp .cell")].map((c) => [c.querySelector(".k").textContent, (c.querySelector(".v") ?? c.querySelector(".x")).textContent.trim()])'),
    [['Result', 'Passed'], ['What ran', 'npm test, phone, passed'], ['When', `Today, ${clock(at(2))}`]]);
  assert.equal(await evaluate('new Set([...document.querySelectorAll(".ev-verdict .choices button")].map((b) => { const r = b.getBoundingClientRect(); return `${Math.round(r.top)} ${Math.round(r.width)}`; })).size'), 1);
  assert.deepEqual(await evaluate(SQUASH), []);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  assert.ok(await evaluate('[...document.querySelectorAll(".ev-hero img")].every((i) => i.getBoundingClientRect().width <= document.querySelector(".ev-item").getBoundingClientRect().width)'));
  // Nothing was dismissed, so no log line was written beyond the restore the test itself made.
  assert.deepEqual(readFileSync(file.replace(/\.json$/, '.dismissed.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).key), ['update-1']);
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
  // A changed answer is new again, and says which answer it replaces; SIGN_OFF_FILER names the filer for wait too.
  assert.deepEqual((await read()).seen, ['b']);
  const changed = JSON.parse(as({ SIGN_OFF_FILER: 'agent-a' }, 'wait', file, '--json', '--timeout', '5').out).a;
  assert.deepEqual([changed.answer, changed.note, changed.replaces.answer, changed.replaces.label, changed.replaces.note], ['no', 'changed my mind', 'yes', 'Yes', undefined]);
  // The first answer stays in the history, the change after it.
  assert.deepEqual(readFileSync(join(dir, 'board.answers.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((a) => a.key === 'a').map((a) => [a.answer, a.replaces?.answer ?? '']), [['yes', ''], ['no', 'yes']]);
  assert.deepEqual((await read()).seen.sort(), ['a', 'b']);
  const hooked = () => readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  for (let i = 0; i < 50 && (!existsSync(out) || hooked().length < 4); i++) await new Promise((ok) => setTimeout(ok, 100));
  // Each hook runs on its own, so their lines may land in any order.
  assert.deepEqual(hooked().map(({ key, answer, filer = '', title }) => [key, answer, filer, title].join()).sort(),
    ['a,no,agent-a,Ship A?', 'a,yes,agent-a,Ship A?', 'b,yes,agent-b,Ship B?', 'none,yes,,Ship it?']);
  // Each line is an answer event: a board-format item reports as ask schema 1; the change carries what it replaces.
  assert.ok(hooked().every((h) => h.event === 'answer' && h.contract === 1 && h.kind === 'ask' && h.schema === 1), JSON.stringify(hooked()));
  assert.deepEqual(hooked().filter((h) => h.key === 'a').map((h) => h.replaces?.answer ?? '').sort(), ['', 'yes']);
  assert.equal(statSync(join(dir, 'board.seen.jsonl')).mode & 0o777, 0o600);
  // Undone back to no answer after the agent took it, the next answer still names the one the agent had; an undone answer no agent took is not named.
  for (const [key, answer] of [['a', ''], ['a', 'yes'], ['none', ''], ['none', 'no']]) assert.equal((await post(url, 'api/answers', { key, answer })).status, 200);
  const again = JSON.parse(as({}, 'answers', file, '--json').out);
  assert.deepEqual([again.a.answer, again.a.replaces?.answer, again.none.answer, again.none.replaces], ['yes', 'no', 'no', undefined]);
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

test('load budget: a board of 60 updates opens Evidence on a phone with at most 12 captures and 1.5 MB, sends text compressed, and a reload or a poll costs only 304s', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'budget'), file = join(dir, 'board.json'), capture = readFileSync(new URL('../fixtures/evidence/product-board.png', import.meta.url));
  const hash = createHash('sha256').update(capture).digest('hex');
  mkdirSync(join(dir, 'evidence', '1'), { recursive: true });
  writeFileSync(join(dir, 'evidence', '1', '1.png'), capture);
  const items = Array.from({ length: 60 }, (_, i) => ({ key: `update-${i + 1}`, type: 'evidence', number: i + 1, title: `Sign-in check ${i + 1}`, about: 'Umer checks the sign-in screen on a phone.',
    filed: new Date(Date.now() - i * 60_000).toISOString(), media: [{ path: 'evidence/1/1.png', sha256: hash, bytes: capture.length }] }));
  writeFileSync(file, JSON.stringify({ schema: 2, items }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  // Bytes as they go over the wire, with the headers a browser sends.
  const raw = (path, headers = {}) => new Promise((ok, no) => get(`${url}${path.slice(1)}`, { agent: false, headers: { 'accept-encoding': 'gzip, deflate, br', ...headers } }, (r) => {
    const parts = [];
    r.on('data', (b) => parts.push(b)).on('end', () => ok({ status: r.statusCode, headers: r.headers, bytes: Buffer.concat(parts).length }));
  }).on('error', no));
  const page = await raw('/'), state = await raw('/api/decisions'), plainPage = readFileSync(new URL('../web/index.html', import.meta.url)).length;
  assert.equal(page.headers['content-encoding'], 'br');
  assert.ok(page.bytes < plainPage / 3, `the page goes compressed: ${page.bytes} of ${plainPage} bytes`);
  assert.equal(state.headers['content-encoding'], 'br');
  // The page's 20-second poll of an unchanged board, and a reload of the page itself, answer 304 with no body.
  assert.deepEqual([(await raw('/api/decisions', { 'if-none-match': state.headers.etag })).status, (await raw('/', { 'if-none-match': page.headers.etag })).status], [304, 304]);
  // A capture's address carries its hash, so the browser keeps it and never asks again; asked by its tag, it is a 304.
  const media = await raw(`/api/media?key=update-1&i=0&h=${hash.slice(0, 16)}`);
  assert.equal(media.headers['cache-control'], 'private, max-age=31536000, immutable');
  assert.equal((await raw('/api/media?key=update-1&i=0', { 'if-none-match': media.headers.etag })).status, 304);

  const { evaluate, close } = await browse(join(dir, 'b'), 390, 844, true);
  try {
    // What the page fetched, settled: no new request for a second.
    const fetched = async () => {
      let last = -1;
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const now = await evaluate('performance.getEntriesByType("resource").length');
        if (now === last) break;
        last = now;
      }
      return evaluate(`(() => { const all = [...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")];
        return { captures: all.filter((e) => e.name.includes("/api/media")).length, kb: Math.round(all.reduce((a, e) => a + e.transferSize, 0) / 1024),
          page: all[0].transferSize, state: all.filter((e) => e.name.endsWith("/api/decisions")).map((e) => e.transferSize), media: all.filter((e) => e.name.includes("/api/media")).map((e) => e.transferSize) }; })()`);
    };
    await evaluate(`location.href = ${JSON.stringify(`${url}#evidence`)}`);
    await until(() => evaluate('document.querySelectorAll(".ev-card").length === 60 && !!document.querySelector(".ev-media img")?.complete'));
    const first = await fetched();
    // Only the captures near the screen load: 60 full captures would be over 6 MB.
    assert.ok(first.captures >= 1 && first.captures <= 12, `captures on the first screen: ${first.captures}`);
    assert.ok(first.kb <= 1536, `page weight of the first screen: ${first.kb} KB`);
    // Reloaded, the page and the state are 304s (headers only) and every capture comes from the browser's own copy. Chrome keeps a page
    // opened from about:blank apart from the same page reloaded, so the page reloads once to be kept, and the second reload is measured.
    // Each old page is marked, so the counts are read from the reloaded one.
    for (let i = 0; i < 2; i++) {
      await evaluate('window.before = true; location.reload()');
      await until(() => evaluate('!window.before && document.querySelectorAll(".ev-card").length === 60'));
    }
    const again = await fetched();
    assert.ok(again.page < 1024 && again.state.every((b) => b < 1024), `reload: page ${again.page} B, state ${again.state} B`);
    assert.ok(again.media.every((b) => b === 0), `reload refetched a capture: ${again.media}`);
    console.log(`Evidence on a phone: ${first.captures} of 60 captures, ${first.kb} KB; reload ${again.kb} KB`);
  } finally { close(); }
  proc.kill();
});

test('a card names its ticket: --ticket on every post, a Ticket row that opens the ticket, the ticket page lists its cards newest first, and each card shows its Activity', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'ticket'), file = join(dir, 'board.json'), fx = new URL('../fixtures/contract/', import.meta.url).pathname, now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  mkdirSync(join(dir, 'design'), { recursive: true });
  for (const f of readdirSync(join(fx, 'design.v1/design'))) writeFileSync(join(dir, 'design', f), readFileSync(join(fx, 'design.v1/design', f)));
  writeFileSync(join(dir, 'shot.png'), png);
  // A ticket stands alone: a new one needs a title, a later write changes only what it gives, and a bad value is refused before anything is written.
  assert.equal(run('ticket', file, '--id', 'T-29', '--progress', '20').code, 2);
  assert.equal(existsSync(join(dir, 'board.tickets.jsonl')), false);
  assert.equal(run('ticket', file, '--id', 'T-9', '--title', 'The new settings page', '--progress', '45').code, 0);
  assert.equal(run('ticket', file, '--id', 'T-29', '--title', 'Ship the new settings page', '--progress', '20', '--parent', 'T-9').code, 0);
  assert.match(run('ticket', file, '--id', 'T-29', '--progress', '60').out, /status: updated/);
  for (const bad of [['--progress', '101'], ['--progress', '4.5'], ['--parent', 'T-29'], ['--title', ' '], ['--id', 'bad id']]) assert.equal(run('ticket', file, '--id', 'T-29', ...bad).code, 2, bad.join(' '));
  // Every way a card gets in takes --ticket, or "ticket" in its message or --from item: flags, an evidence update, contract messages, a feed file and a sign-in.
  const fileOf = (name, m) => (writeFileSync(join(dir, name), JSON.stringify(m)), join(dir, name)), session = '5f0c2b7e-9a41-4c3e-8d2a-6b7f1e0c9d34';
  const report = JSON.parse(readFileSync(join(fx, 'report.v4/valid-minimal.json'), 'utf8'));
  const posts = [
    ['raise', file, '--ticket', 'T-29', '--key', 'ask-linked', '--title', 'Ship the settings page on Friday?', '--filer', session],
    ['raise', file, '--key', 'ask-plain', '--title', 'Keep the old settings link for a week?'],
    ['raise', file, '--ticket', 'T-404', '--key', 'ask-unknown', '--title', 'Move the theme switch to the top?'],
    ['post', file, '--type', 'evidence', '--ticket', 'T-29', '--title', 'Settings on a phone', '--about', 'Umer changes the theme in one tap.', '--media', join(dir, 'shot.png')],
    ['post', file, '--kind', 'design', '--from', fileOf('design.json', { ...JSON.parse(readFileSync(join(fx, 'design.v1/valid-basic.json'), 'utf8')), filed: now }), '--ticket', 'T-29'],
    ['post', file, '--kind', 'report', '--from', fileOf('report.json', { ...report, filed: now, ticket: 'T-29' })],
    ['post', file, '--kind', 'plan', '--from', join(fx, 'plan.v3/valid-full.json'), '--ticket', 'T-29'],
    ['post', file, '--from', fileOf('feed.json', { schema: 2, items: [{ contract: 1, kind: 'ask', schema: 1, key: 'from-linked', title: 'Turn on the settings search?', why: 'Umer asked for it twice this week.', recommend_value: 'yes', recommend_reason: 'It is small.', default_if_silent: 'no',
      options: [{ value: 'yes', label: 'Yes', outcome: 'Search ships with the page.' }, { value: 'no', label: 'No', outcome: 'It waits.' }] }] }), '--ticket', 'T-29'],
    ['post', file, '--type', 'signin', '--ticket', 'T-29', '--key', 'npm', '--service', 'npm', '--link', 'https://example.com/login', '--unlocks', 'Publishing the release', '--waits', 'Release agent'],
  ];
  for (const args of posts) assert.equal(run(...args).code, 0, args.join(' '));
  const stored = Object.fromEntries(JSON.parse(readFileSync(file, 'utf8')).items.map((i) => [i.key, i.ticket]));
  assert.deepEqual(stored, { 'ask-linked': 'T-29', 'ask-plain': undefined, 'ask-unknown': 'T-404', 'update-1': 'T-29', 'chat-journeys': 'T-29', 'digest-ran': 'T-29', 'faster-sign-in': 'T-29', 'from-linked': 'T-29', npm: 'T-29' });
  // A bad id, a message naming another ticket than --ticket, and a --replace feed with --ticket are refused, and nothing is written.
  const before = readFileSync(file, 'utf8');
  for (const args of [['raise', file, '--ticket', 'T 29', '--key', 'bad-ticket', '--title', 'Ship the settings help page now?'],
    ['post', file, '--kind', 'report', '--from', fileOf('other.json', { ...report, key: 'other', filed: now, ticket: 'T-1' }), '--ticket', 'T-29'],
    ['post', file, '--from', join(dir, 'feed.json'), '--replace', '--ticket', 'T-29'], ['validate', fileOf('broken.json', { ...report, ticket: 5 })]]) assert.equal(run(...args).code, 2, args.join(' '));
  assert.equal(readFileSync(file, 'utf8'), before);
  // The CLI shows the ticket with its cards, newest first; the card naming no ticket and the one naming a ticket not on the board are not among them.
  const shown = JSON.parse(run('ticket', file, '--id', 'T-29', '--json').out).ticket;
  assert.deepEqual([shown.title, shown.progress, shown.parent, shown.cards.length], ['Ship the new settings page', 60, 'T-9', 7]);
  const times = shown.cards.map((c) => Date.parse(c.filed));
  assert.deepEqual(times, [...times].sort((x, y) => y - x));
  assert.deepEqual(Object.fromEntries(shown.cards.map((c) => [c.key, `${c.kind} ${c.status}`])), { npm: 'ask waiting', 'from-linked': 'ask waiting', 'faster-sign-in': 'plan waiting', 'digest-ran': 'report shown', 'chat-journeys': 'design in review', 'update-1': 'proof shown', 'ask-linked': 'ask waiting' });
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(dir, 390, 844, true);
  try {
    // Each linked card's screen shows one Ticket row, the ticket's title, id and progress, opening its page; a card with no ticket, or one not on the board, shows none.
    const row = `(() => { const top = document.querySelector('#reader:not([hidden])') ?? document; const r = [...top.querySelectorAll('.ticket-row')]; return r.length + '|' + r.map((x) => x.getAttribute('href') + ' ' + x.innerText.replace(/\\s+/g, ' ').trim()).join(); })()`;
    for (const [hash, seen] of [['#decide/ask-linked', 1], ['#decide/ask-plain', 0], ['#decide/ask-unknown', 0], ['#decide/npm', 1], ['#decide/from-linked', 1], ['#evidence/update-1', 1], ['#designs/chat-journeys', 1], ['#reports/digest-ran', 1], ['#waiting/faster-sign-in', 1]]) {
      await evaluate(`location.href = ${JSON.stringify(url + hash)}`);
      await until(async () => (await evaluate(`document.querySelector('#board h1, #reader:not([hidden]) h1') !== null && location.hash === ${JSON.stringify(hash)}`)) === true && (await evaluate(row)) === (seen ? '1|#ticket/T-29 Ship the new settings page T-29 60%' : '0|'));
      assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true, hash);
    }
    // The row opens the ticket's page: where it sits, its progress, then its seven cards newest first, each opening where it lives; Back returns to the card.
    await evaluate(`location.href = ${JSON.stringify(`${url}#decide/ask-linked`)}`);
    await until(() => evaluate('!!document.querySelector(".decide .ticket-row")'));
    await evaluate('document.querySelector(".decide .ticket-row").click()');
    await until(async () => (await evaluate('location.hash')) === '#ticket/T-29' && (await evaluate('document.querySelectorAll("#board .card.rows li").length')) === 7);
    const page = JSON.parse(await evaluate(`JSON.stringify({ h1: document.querySelector('#board h1').textContent, kicker: document.querySelector('.tk-kicker').textContent, done: document.querySelector('.tk-done').textContent,
      rows: [...document.querySelectorAll('#board .card.rows a')].map((a) => [a.querySelector('strong').textContent.replace(/^Update \\d+ · /, ''), a.getAttribute('href')]), wide: document.documentElement.scrollWidth > 390 })`));
    assert.deepEqual({ ...page, rows: page.rows.map(([t]) => t) }, { h1: 'Ship the new settings page', kicker: 'The new settings page › T-29', done: '60% done', rows: shown.cards.map((c) => c.title), wide: false });
    assert.deepEqual(['Ship the settings page on Friday?', 'Settings on a phone', 'Chat app journeys', 'The weekly digest ran'].map((t) => Object.fromEntries(page.rows)[t]), ['#decide/ask-linked', '#evidence/update-1', '#designs/chat-journeys', '#reports/digest-ran']);
    await evaluate('document.querySelector(".top .back").click()');
    await until(async () => (await evaluate('location.hash')) === '#decide/ask-linked');
    // The ticket above it lists the ticket under it, and no card names it.
    await evaluate(`location.href = ${JSON.stringify(`${url}#ticket/T-9`)}`);
    await until(async () => (await evaluate('[...document.querySelectorAll(".tk-sub")].map((a) => a.getAttribute("href")).join()')) === '#ticket/T-29');
    assert.equal(await evaluate('document.querySelector("#board .empty")?.textContent'), 'No card on the board names this ticket yet.');
    // A card's Activity: nothing while its posting is all there is; then each answer with its note, the change, its agent taking it and a new round, oldest first.
    // The agent posted under a session id, which names nobody, so it reads Agent. The ticket's page shows those steps under the card's name.
    const thread = (hash) => `(async () => { location.hash = ${JSON.stringify(hash)}; await new Promise((ok) => setTimeout(ok, 50)); const top = document.querySelector('#reader:not([hidden])') ?? document;
      return [...top.querySelectorAll('.th-list li')].map((li) => li.innerText.replace(/\\s+/g, ' ').replace(/ (Today|\\d+ \\w+), \\d\\d:\\d\\d$/, '').trim()).join(' | '); })()`;
    assert.equal(await evaluate(thread('#decide/ask-linked')), '');
    for (const [answer, note] of [['no', 'Not this week.'], ['yes', 'After the Friday stand-up.']]) assert.equal((await post(url, 'api/answers', { key: 'ask-linked', answer, note })).status, 200);
    assert.equal(run('wait', file, '--filer', session, '--key', 'ask-linked', '--timeout', '5').code, 0);
    assert.equal((await post(url, 'api/rounds', { key: 'ask-linked', note: 'Show it on a phone first.' })).status, 200);
    await evaluate('window.old = true, location.reload()');
    await until(() => evaluate('!window.old'));
    const steps = ['Your answer: No “Not this week.”', 'Changed to: Yes “After the Friday stand-up.”', 'Agent picked it up', 'You asked for a new round “Show it on a phone first.”'];
    await until(async () => (await evaluate(thread('#decide/ask-linked'))) === ['Posted by Agent', ...steps].join(' | '));
    assert.equal(await evaluate(thread('#ticket/T-29')), steps.map((x) => `Ship the settings page on Friday? ${x}`).join(' | '));
    assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true);
  } finally { close(); }
  proc.kill();
});
