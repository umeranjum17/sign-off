import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer, get, request } from 'node:http';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';
import { asked } from './support/ask.mjs';
import { liveLinkVerdict } from './support/live-link.mjs';

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
  // Let Chrome flush its profile before deleting it; killing its parent can leave children writing into the removed folder.
  if (shared?.proc.exitCode === null) {
    const exited = new Promise((ok) => shared.proc.once('exit', ok));
    // Chrome can exit before replying to Browser.close. Await its exit, not an unref'ed
    // reply timeout that lets Node leave this hook before scratch cleanup runs.
    shared.call('Browser.close');
    await exited;
    shared.ws.close();
  }
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
  assert.match(html, /<nav class="side" id="nav" aria-label="Board areas">/);
  // The page is a small shell; its script is fetched beside it, and the renderers are in it.
  const script = await (await fetch(`${url}app.js?v=1`)).text();
  assert.match(script, /mockCards/);
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
  assert.match(script, /function chapters/);
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


test('a merged card is hidden while its shown merger waits, and shown again once the merger is dismissed', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const file = join(scratch, 'merged-hide.json');
  assert.equal(run('raise', file, '--key', 'hide-x', '--title', 'Keep the old login screen?').code, 0);
  assert.equal(run('raise', file, '--key', 'hide-y', '--title', 'Ship the new login screen?', '--merge', 'hide-x').code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(scratch);
  const visible = (key) => until(async () => (await evaluate(`[...document.querySelectorAll('.decide-list .dl-face[id]')].map((e) => e.id).join()`)) === `item-${key}`);
  try {
    // One isolated browser checks the actual list after each load. Three cold --dump-dom
    // processes with a virtual-time budget used process exit as a proxy for list readiness.
    await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
    await visible('hide-y');
    for (const [dismissed, shown] of [[true, 'hide-x'], [false, 'hide-y']]) {
      const response = await post(url, 'api/dismiss', { keys: ['hide-y'], dismissed });
      assert.equal(response.status, 200, await response.text());
      await evaluate('location.reload()');
      await visible(shown);
    }
  } finally {
    await close(); proc.kill();
  }
});

/** What is wrong with a "Waiting on you" total, in words naming both numbers: it must be the asks plus the designs waiting. */
const waitingFault = (shown, asks, designs) => (shown === asks + designs ? '' : `Waiting on you shows ${shown} but ${asks} asks + ${designs} ${designs === 1 ? 'design' : 'designs'} are waiting, so it should show ${asks + designs}`);

test('Waiting on you counts a waiting design as well as the asks, says the split in words, and shows that design above the tabs, in the hero, the dock, the sidebar and a desk\'s subtitle', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const file = join(scratch, 'waiting-total.json');
  const [asks, designs] = [3, 1];
  for (let i = 1; i <= asks; i++) assert.equal(run('raise', file, '--key', `ask-${i}`, '--title', `Ask number ${i}?`).code, 0);
  const board = JSON.parse(readFileSync(file, 'utf8'));
  board.items.push({ key: 'look', type: 'design', title: 'Which look should ship?', options: ['a', 'b'].map((v) => ({ value: v, label: v.toUpperCase() })), recommend_value: 'b', filed: new Date().toISOString() });
  writeFileSync(file, JSON.stringify(board));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const read = async (width, mobile, js) => {
    const { evaluate, close } = await browse(scratch, width, 900, mobile);
    try {
      await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
      let got;
      await until(async () => (got = await evaluate(js)) !== undefined && got !== null && got !== false);
      return got;
    } finally { await close(); }
  };
  try {
    // A phone: the hero, the split line, the tabs and the dock.
    const phone = await read(390, true, `(() => { const big = document.querySelector('.ui-hero .big'); if (!big) return; const num = (e) => Number(e?.textContent.match(/\\d+/)?.[0]);
      return { hero: num(big), split: document.querySelector('.ui-hero .hs')?.textContent, tabs: [...document.querySelectorAll('.dl-seg button small')].map((e) => Number(e.textContent)),
        dock: num(document.querySelector('#tabs a[href="#waiting"] .bd')), row: document.querySelector('.dl-dz')?.textContent ?? '',
        rowAboveTabs: !!(document.querySelector('.dl-dz')?.compareDocumentPosition(document.querySelector('.dl-seg')) & Node.DOCUMENT_POSITION_FOLLOWING), asksFirstScreen: document.querySelector('.dl-list .dl-face')?.getBoundingClientRect().top < innerHeight } })()`);
    assert.deepEqual(phone.tabs, [asks, designs], 'the tabs count the asks and the designs');
    assert.equal(waitingFault(phone.hero, asks, designs), '', waitingFault(phone.hero, asks, designs));
    assert.equal(phone.split, '3 asks · 1 design');
    assert.equal(waitingFault(phone.dock, asks, designs), '', `the dock: ${waitingFault(phone.dock, asks, designs)}`);
    assert.match(phone.row, /Which look should ship\?/, 'the waiting design is on the first screen');
    assert.ok(phone.rowAboveTabs, 'the design row sits above the tabs');
    assert.ok(phone.asksFirstScreen, 'the asks stay on the first screen');
    // A desk: the sidebar's badge and the page's subtitle say the same total and split.
    const desk = await read(1280, false, `(() => { const sub = document.querySelector('.split-head p, .ui-top p, header p')?.textContent; const side = document.querySelector('#nav a[href="#waiting"] .n'); if (!side) return;
      return { side: Number(side.textContent), sub: [...document.querySelectorAll('p')].map((p) => p.textContent).find((t) => /waiting on you/.test(t)) } })()`);
    assert.equal(waitingFault(desk.side, asks, designs), '', `the sidebar: ${waitingFault(desk.side, asks, designs)}`);
    assert.match(desk.sub, /^4 waiting on you · 3 asks · 1 design/);
  } finally { proc.kill(); }
});

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
  // A page mock's Open live is that option's own prototype, under its mock and outside the sandboxed frame; B's --link is the reference beside it.
  assert.match(figures[0], /<a class="option-link" href="[^"]*look~b\/quiet\.html" target="_blank" rel="noopener" data-live="look~b"[^>]*>Open live<\/a>/);
  assert.match(figures[0], /<a class="option-link ref-link" href="https:\/\/example\.com\/b" target="_blank" rel="noopener"[^>]*>Reference<\/a>/);
  assert.ok(figures[0].indexOf('</iframe>') < figures[0].indexOf('option-link'));
  assert.equal(figures.filter((f) => f.includes('ref-link')).length, 1);
  assert.equal(figures.filter((f) => f.includes('data-live')).length, 3);
  close();
  proc.kill();
});

test('the live-link check rejects a live link that is the reference, or another option\'s prototype, and passes the option\'s own', () => {
  const key = 'inbox', m = { value: 'a', link: 'https://linear.app/docs/inbox' }, own = 'http://127.0.0.1:4410/mock/local/inbox~a/index.html?variant=a';
  const verdict = (live) => liveLinkVerdict({ key, value: m.value, reference: m.link, live, prototype: own });
  assert.equal(verdict(own), '');
  assert.equal(verdict(m.link), 'Open live is the reference, inbox~a');
  assert.equal(verdict(own.replace('~a', '~b')), 'Open live is not inbox~a: http://127.0.0.1:4410/mock/local/inbox~b/index.html?variant=a');
  assert.equal(verdict(null), 'no Open live under inbox~a');
});

test("every existing design card's Open live opens that option's own prototype, never the reference beside it", { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'live-links'), file = join(dir, 'board.json');
  // One card per shape the board's design picks already use: a shared page per option with its variant in the query (the Inbox pick, with a reference doc
  // under each option), plain pages, pictures, a mix of both, one shared page without variants, and values that are not a, b, c.
  const design = (key, values, path, links = {}) => ({ key, type: 'design', title: `Which ${key}?`, options: values.map((v) => ({ value: v, label: `${v.toUpperCase()}: ${key}` })), recommend_value: values[0],
    mocks: values.map((v) => ({ value: v, path: path(v), ...(links[v] && { link: links[v] }) })) });
  const cards = [
    design('inbox', ['a', 'b', 'c'], (v) => `mocks/inbox/index.html?variant=${v}`,
      { a: 'https://linear.app/docs/inbox', b: 'https://slack.com/help/articles/threads', c: 'https://docs.github.com/inbox' }),
    design('plan', ['a', 'b', 'c'], (v) => `mocks/plan/${v}.html`),
    design('cloud', ['a', 'b', 'c'], (v) => `mocks/cloud/${v}.png`),
    design('wrapper', ['a', 'b'], (v) => `mocks/wrapper/${v}.html`, { a: 'https://example.com/branch' }),
    design('stealth', ['a', 'b', 'c'], (v) => 'mocks/stealth/index.html'),
    design('direction', ['a', 'a9', 'c', 'f', 'h', 'g'], (v) => `mocks/direction/${v}.png`),
  ];
  for (const d of cards) for (const m of d.mocks) {
    const mockFile = join(dir, m.path.split('?')[0]);
    mkdirSync(dirname(mockFile), { recursive: true });
    writeFileSync(mockFile, /\.html?$/i.test(m.path.split('?')[0]) ? '<a href="#next">Next</a>' : sized(60, 120));
  }
  writeFileSync(file, JSON.stringify({ schema: 2, items: cards }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { mockBase } = await (await fetch(`${url}api/decisions`)).json();
  // The prototype URL that option's mock is served at, exactly as the board serves it.
  const own = (d, m) => new URL(`${mockBase}${d.key}~${m.value}/${encodeURIComponent(m.path.split('?')[0].split('/').pop())}${m.path.includes('?') ? `?${m.path.split('?')[1]}` : ''}`, url).href;
  // The check: Open live must be that option's own prototype page, never the URL kept beside it as its reference.
  const check = (d, m, live) => liveLinkVerdict({ key: d.key, value: m.value, reference: m.link, live, prototype: own(d, m) });
  const { evaluate, close } = await browse(dir);
  try {
    for (const d of cards) {
      await evaluate(`location.href = ${JSON.stringify(`${url}#decide/${d.key}`)}`);
      await until(async () => (await evaluate('location.hash')) === `#decide/${d.key}` && (await evaluate("document.querySelectorAll('.ask-sheet figure.mock').length")) === d.options.length);
      const shown = await evaluate(`[...document.querySelectorAll('.ask-sheet figure.mock')].map((f) => ({
        label: f.querySelector('.label')?.textContent, live: f.querySelector('[data-live]')?.href ?? null, ref: f.querySelector('.ref-link')?.href ?? null, words: f.querySelector('.ref-link')?.textContent ?? null }))`);
      for (const m of d.mocks) {
        const o = d.options.find((x) => x.value === m.value), fig = shown.find((f) => f.label === o.label);
        assert.ok(fig, `${d.key}~${m.value} is drawn`);
        // A picture is not a prototype: only a page mock has an Open live link.
        if (/\.html?$/i.test(m.path.split('?')[0])) assert.equal(check(d, m, fig.live), '', `${d.key}~${m.value}: ${fig.live}`);
        else assert.equal(fig.live, null, `${d.key}~${m.value} is a picture, so it has no Open live`);
        // Its reference stays on the card as its own link, labelled as the reference.
        assert.equal(fig.ref, m.link ?? null, `${d.key}~${m.value} reference`);
        assert.equal(fig.words, m.link ? 'Reference' : null, `${d.key}~${m.value} reference label`);
      }
    }
  } finally {
    close(); proc.kill();
  }
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
            available: page.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight), scrollers: scrollers.map(e => e.classList.contains('split-detail') ? 'split-detail' : e.className) };
        })()`);
        let got;
        await until(async () => !!(got = await layout()));
        assert.ok(got.frameHeight >= got.height - 1, `${width} ${hash}: nested document scroll ${JSON.stringify(got)}`);
        assert.ok(got.frameWidth >= got.available - 1, `${width} ${hash}: narrow document frame ${JSON.stringify(got)}`);
        assert.ok(got.width <= got.frameWidth + 1 && got.inner === 0, JSON.stringify(got));
        // A forced document scrollbar must not paint a gutter even after its content fits.
        assert.equal(got.scrollbar, 0, `painted inner scrollbar at ${width}px (mobile=${mobile}): ${JSON.stringify(got)}`);
        assert.deepEqual(got.scrollers, [hash.includes('reports') ? (width === 1280 ? 'split-detail' : 'read rp-sheet-body') : 'plan-scroll']);
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
  // The ask is a sheet over Decide's list on this width: a tap off it closes it, so the page is tapped on the question.
  const blank = async () => click(await evaluate("(({ left, top }) => [left + 4, top + 4])(document.getElementById('ask-title')?.getBoundingClientRect() ?? { left: -3, top: -3 })"));
  const write = async (text) => {
    await evaluate(`(${button('Comment on the mocks')}).getAttribute('aria-pressed') === 'false' && (${button('Comment on the mocks')}).click()`);
    // A synthetic mouse stays aimed at the frame a redraw removed until it clicks elsewhere, so it clicks the page first.
    // A tap before the frame's bridge loads reaches nothing, so the test taps until the editor opens.
    await blank();
    await until(async () => (await click(await middle()), evaluate("!!document.getElementById('ann-text-look')")));
    const before = await evaluate("document.getElementById('ann-text-look').value");
    await evaluate(`(document.getElementById('ann-text-look').value = ${JSON.stringify(text)}, (${button('Save comment')}).click())`);
    await until(() => evaluate(`state.annotations?.some((a) => a.text === ${JSON.stringify(text)})`));
    return before;
  };
  // The design ask's mocks show on its Decide card.
  const at = JSON.stringify(`${url}#decide/look`);
  const reload = async () => {
    await evaluate(`window.old = true, location.href === ${at} ? location.reload() : (location.href = ${at})`);
    await until(() => evaluate(`!window.old && !!${frame}`));
    // Coordinates taken during sheet-up can land on the toggle after the sheet moves,
    // switching pointing off and opening full screen instead of the comment editor.
    await evaluate(`Promise.all((document.querySelector('.ask-sheet')?.getAnimations() ?? []).map((a) => a.finished))`);
  };
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
  const aim = async (i, name) => { await blank(); await until(async () => (await click(await middle(i)), evaluate(`!!${box} && ${label}.startsWith(${JSON.stringify(name)})`))); };
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
  assert.equal(run('report', 'init', join(dir, 'mocks', 'how'), '--page', '--purpose', 'other').code, 0);
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
  // Decide on a phone: Asks and Designs with their counts, the hero with how many wait, then the asks in one card of rows; More, the line under them, opens Select, Answer all recommended and Move all to later.
  assert.match(waiting, /<div class="ui-seg dl-seg" role="group" aria-label="Decide"><button type="button" aria-pressed="true">Asks<small>1<\/small><\/button><button type="button" aria-pressed="false">Designs<small>1<\/small><\/button><\/div><section class="ui-card ui-hero"><div class="hl"><span class="lab">Waiting on you<\/span><\/div><div class="hv"><span class="big">2<\/span><\/div><p class="hs">1 ask · 1 design<\/p><\/section><h2 class="ui-sec">Asks<\/h2><ul class="ui-card ui-list dl-list" aria-label="Asks">/);
  assert.match(waiting, /href="#decide\/ship"[^>]*><span class="ui-icon"[^>]*>.*?<span class="t" dir="auto">When should it ship\?<\/span>/s);
  // The design pick is no ask: it is counted and listed under Designs, so Asks does not hold it.
  assert.doesNotMatch(waiting, /<a class="dl-face[^>]*href="#decide\/look"/);
  // It is counted in the total and shown once, as the design row above the tabs.
  assert.match(waiting, /<a class="ui-card ui-row dl-dz" href="#decide\/look"/);
  assert.match(waiting, /<button class="t-more-line" type="button" aria-haspopup="dialog"><span>Select, answer all or move all to later<\/span>/);
  assert.doesNotMatch(waiting, /data-act="sort"|Oldest first/);
  assert.doesNotMatch(waiting, /<ol class="queue"|<p class="fhead"/);
  // Today: its title with the light-or-dark button, Up next (how many wait, the question, what it is, when and the answer recommended) with that answer as its main button beside Other answer,
  // the next ask under Waiting on you with See all, and two tiles: Cleared today opening Answered and Proofs today opening Evidence.
  const home = await dump('');
  assert.match(home, /<header class="ui-top today-top"><h1 tabindex="-1">Today<\/h1><button class="ui-rb theme" aria-label="Switch to (dark|light)">/);
  assert.match(home, /<section class="ui-card ui-hero t-up" aria-label="Up next"><div class="hl"><span class="lab">Up next · 1 of 1<\/span><\/div><h2 class="q" dir="auto">When should it ship\?<\/h2><p class="meta"><span dir="auto">Pick one · \d\d:\d\d · Recommended B<\/span><\/p><div class="t-btns"><button class="t-btn ink" aria-label="Answer B, When should it ship\?"><span class="lbl">Answer B<\/span>.*?<a class="t-btn white" href="#decide\/ship"><span class="lbl">Other answer<\/span><\/a>/s);
  assert.doesNotMatch(home, /aria-label="Waiting on you"/);
  assert.match(home, /<section class="t-wait" aria-label="Designs to review">.*?href="\#decide\/look"/s);
  assert.deepEqual([...home.matchAll(/<a class="ui-card ui-stat" href="([^"]*)" aria-label="([^"]*)"/g)].map((m) => `${m[1]} ${m[2]}`), ['#answered Cleared today: 0 of 1', '#evidence Proofs today: 0']);
  // An ask dismissed from Waiting on you is counted on the Archived line at its end; the line opens it in a sheet with Restore.
  const gone = file.replace(/\.json$/, '.dismissed.jsonl');
  writeFileSync(gone, JSON.stringify({ key: 'ship', dismissed: true, at: new Date().toISOString() }) + '\n');
  const pages = {};
  for (const hash of ['#waiting']) assert.match(pages[hash] = await dump(hash), /<button class="t-more-line ar-line" type="button" aria-haspopup="dialog"><span>Archived · 1<\/span>/, hash);
  // Nothing is left to ask: the design pick is not an ask.
  assert.match(await dump(''), /<section class="ui-card ui-hero t-up clear" aria-label="Up next">.*?Nothing waits on you/s);
  // Restore returns the dismissed ask to the grouped list.
  const { evaluate, close } = await browse(join(dir, 'live'));
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  await until(async () => (await evaluate('!!document.querySelector(".ar-line") && document.querySelectorAll(".decide-list .dl-row:not(.g-done)").length')) === 0);
  await evaluate('document.querySelector(".ar-line").click()');
  assert.equal(await evaluate('document.querySelector("#ar-sheet[open] .ar-list .t").textContent'), 'When should it ship?');
  await evaluate('document.querySelector("#ar-sheet .ar-back").click()');
  await until(async () => (await evaluate('!document.querySelector(".ar-line") && !document.getElementById("ar-sheet").open && document.querySelectorAll(".decide-list .dl-row:not(.g-done)").length')) === 1);
  close();
  assert.deepEqual(readFileSync(gone, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map(({ key, dismissed }) => [key, dismissed]), [['ship', true], ['ship', false]]);
  // Reports, as the approved prototype draws it: the title with the light-or-dark button at its right, Newest or By project, then how many are still to read of all listed and how many
  // were filed this week, and More as one quiet line under the list; its rows are the new look's, so a report with a page draws no steps in the list and no legend for them.
  const reports = await dump('#reports');
  assert.match(reports, /<header class="top ui-top rp-top"><h1 tabindex="-1">Reports<\/h1><button class="ui-rb theme" aria-label="Switch to (dark|light)">/);
  assert.match(reports, /<button class="t-more-line rp-more-line" aria-haspopup="dialog"><span>Mark all as read, Select and Archive all<\/span>/);
  assert.match(reports, /<div class="ui-seg rp-seg" role="group" aria-label="Order"><button aria-pressed="true">Newest<\/button><button aria-pressed="false">By project<\/button><\/div><section class="ui-card ui-hero rp-hero"><div class="hl"><span class="lab">Still to read<\/span><\/div><div class="hv"><span class="big">1<small> of 1<\/small><\/span><span class="vs">1 filed this week<\/span><\/div><\/section>/);
  assert.doesNotMatch(reports, /class="card legend"|class="flow"/);
  // The list row has no ×: Discard lives on the report's page.
  assert.doesNotMatch(reports, /aria-label="Discard, How it ships"/);
  // Newest heads one card of rows; the row is a link that opens it, with its project's initials (it has no icon), its title, then a bar of how much of it is read with its percent.
  assert.match(reports, /<h2 class="dl-head ui-sec" style="--n:0">Newest<\/h2><ul class="dl-list rp-list ui-card ui-list" aria-label="Newest">/);
  assert.match(reports, /id="item-how" data-row=""><span class="ui-icon" role="img" aria-label="How it works">.*?<svg.*?<span class="t" dir="auto">How it ships<\/span>(?:(?!rp-ticket).)*?role="progressbar".*?aria-valuenow="0"/s);
  // Under the row, a swipe right marks it read and a swipe left archives it.
  assert.match(reports, /<div class="dl-act yes" aria-hidden="true">.*?<span>Read<\/span><\/div><div class="dl-act later" aria-hidden="true">.*?<span>Archive<\/span><\/div>/s);
  // Only the report is a row and counted; the text-only one is folded under Notes, a short row with no page to open.
  assert.deepEqual([...reports.matchAll(/<li class="report dl-row" style="--n:\d+" data-key="(\w+)"/g)].map((m) => m[1]), ['how']);
  // The sidebar counts what is new under its short name; the phone's tab bar marks Reports as the area on screen and carries an ink count.
  assert.match(reports, /<\/svg><\/span>Reports<span class="n ink">1<\/span>/);
  assert.match(reports, /<a href="#reports" aria-label="Reports, 1 new" aria-current="page"><span class="icon i-tab-reports" aria-hidden="true">.*?<\/span><span class="bd ink" aria-hidden="true">1<\/span><\/a>/);
  assert.match(reports, /<details class="other notes"><summary>Notes \(1\)<\/summary>.*<strong dir="auto">Merged: the sign-in fix<\/strong>/s);
  // On a phone, a tap on the card opens the report in a sheet over the list with the focus on its title; the board under it takes no taps.
  // Close goes back to the card with the focus on its link, and Escape closes it too.
  {
    const { evaluate, tap, swipe, close } = await browse(join(dir, 'reader'), 390);
    await evaluate(`location.href = ${JSON.stringify(`${url}#reports`)}`);
    await until(async () => (await evaluate('document.querySelector("#item-how .t") && innerWidth')) === 390);
    const at = (sel) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    await tap(await at('#item-how .t'));
    await until(async () => (await evaluate('location.hash')) === '#reports/how');
    // The hash lands before its handler draws the reader, so wait for the drawn reader itself, not just the hash.
    let open;
    await until(async () => (open = await evaluate(`(() => { const f = reader.querySelector('iframe').getBoundingClientRect(); return { hidden: reader.hidden, title: document.activeElement.textContent,
      inert: document.querySelector('main').inert, src: reader.querySelector('iframe').getAttribute('src'), sandbox: reader.querySelector('iframe').getAttribute('sandbox'),
      frame: [f.x, Math.round(f.width) === reader.querySelector('.read').clientWidth - 32], back: reader.querySelector('.rp-x').getAttribute('aria-label'), what: reader.querySelector('.rp-what').textContent,
      decided: [...reader.querySelectorAll('.ui-dl, .rp-found')].map((e) => e.textContent) }; })()`))?.src?.startsWith('/mock/local/how~/index.html'));
    // The page sits in a tile inside the sheet's 16px gutters, under its kind (an older report's, other), its title and what it decided. Its address carries
    // the board's own light or dark (`?report=1&theme=`), which is how the page draws in the board's theme and not the system's (web/point.js).
    const picked = await evaluate('localStorage.getItem("so-theme") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")');
    assert.equal(open.src, `/mock/local/how~/index.html?report=1&theme=${picked}`);
    const { src: _src, ...sheet } = open;
    assert.deepEqual(sheet, { hidden: false, title: 'How it ships', inert: true, sandbox: 'allow-scripts', frame: [16, true], back: 'Close',
      what: `Other reportHow it works · ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date())}`, decided: ['What it decided', 'Ships only when the check passes.'] });
    // The page itself is served: the filled scaffold, with its steps to tap.
    assert.match(await (await fetch(new URL('/mock/local/how~/index.html', url))).text(), /<button type="button" class="next">Next<\/button>/);
    await tap(await at('#reader .rp-x'));
    await until(async () => (await evaluate('location.hash + reader.hidden')) === '#reportstrue');
    assert.deepEqual(await evaluate('[document.activeElement.getAttribute("href"), document.querySelector("main").inert, document.body.className]'), ['#reports/how', false, '']);
    await evaluate('location.hash = "#reports/how"');
    await until(async () => (await evaluate('reader.hidden')) === false);
    await evaluate('dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
    await until(async () => (await evaluate('location.hash + reader.hidden')) === '#reportstrue');
    // Opening it read it, beside the board: back on the list its progress track is gone, nothing is still to read and the tab bar's count is gone.
    const reads = () => readFileSync(file.replace(/\.json$/, '.reads.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map(({ key, read }) => [key, read]);
    await until(async () => (await evaluate('[document.querySelector("#item-how .pct")?.textContent ?? "read", document.querySelector(".rp-hero .big").textContent, !!document.querySelector(".tabs .bd.ink")].join()')) === 'read,0 of 1,false');
    assert.deepEqual(reads(), [['how', true]]);
    // A swipe right marks it unread again (its bar empties and the count comes back); a swipe left archives it, and Undo puts it back.
    const y = await evaluate('(() => { const r = document.querySelector("#item-how").getBoundingClientRect(); return r.y + 30; })()');
    await swipe({ x: 40, y }, { x: 360, y });
    await until(async () => (await evaluate('[document.querySelector("#item-how .pct").textContent, document.querySelector(".tabs .bd.ink")?.textContent, document.getElementById("toast-text").textContent].join()')) === '0%,1,Marked unread: How it ships');
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
  // Once both are answered, nothing needs you: Up next says so, nothing is listed under Waiting on you, and Cleared today counts both and opens Answered.
  const after = await dump('');
  assert.match(after, /<section class="ui-card ui-hero t-up clear" aria-label="Up next">.*?<h2 class="q">Nothing waits on you<\/h2>/s);
  assert.doesNotMatch(after, /class="t-wait"/);
  assert.match(after, /<a class="ui-card ui-stat" href="#answered" aria-label="Cleared today: 2 of 2">/);
  const answered = await dump('#answered');
  assert.match(answered, /<p class="lede">2 answers today\. Each one has gone back to its agent\.<\/p><div class="bulk">.*?<\/div><\/header><div class="sec-head"><h2>Today<\/h2><\/div>/);
  const lines = [...answered.matchAll(/<summary class="compact">.*?<strong[^>]*>(.*?)<\/strong>.*?<span class="ans"><b[^>]*>(\w+)<\/b><time>\d\d:\d\d<\/time><\/span><\/span><\/summary>.*?<\/details><button class="x" aria-label="Discard, [^"]+" aria-haspopup="dialog">×<\/button>/gs)];
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
  assert.match(await dump(''), /<a class="ui-card ui-stat" href="#answered" aria-label="Cleared today: 1 of 1">/);
  writeFileSync(file.replace(/\.json$/, '.dismissed.jsonl'), ['look', 'ship'].map((key) => JSON.stringify({ key, dismissed: true, at: new Date(Date.now() + 1000).toISOString() })).join('\n') + '\n');
  assert.match(await dump('#answered'), /<b>All done items cleared<\/b>/);
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
  const queue = () => evaluate('[...document.querySelectorAll(".decide-list .dl-row:not(.g-done) .dl-face .t")].map((s) => s.textContent).join("|")');
  await until(async () => (await queue()) === 'Sign in to GitHub|Sign in to npm|Keep the weekly digest?');
  // A sign-in's page: its headline, its facts (what it unlocks, a clock of the time left, where it signs in) and its one Open.
  const card = (key) => evaluate(`(() => { const c = document.querySelector(".ask-sheet .signin-ask"), o = c?.querySelector(".open-link");
    return c && [c.querySelector("h2")?.textContent, ...[...c.querySelectorAll(".fact")].map((p) => p.textContent), o ? [o.tagName, o.getAttribute("href"), o.target, o.rel, o.disabled].join(" ") : "no open"].join("|"); })()`);
  // Decide shows the card in focus: the GitHub sign-in is newest, so the npm one is tapped in the queue first.
  await evaluate('document.querySelector("#item-npm-login").click()');
  await until(async () => (await evaluate('location.hash')) === '#decide/npm-login' && (await card('npm-login')) !== null);
  assert.match(await card('npm-login'), new RegExp(`^Sign in to npm\\|UnlocksPublish npm\\|Expires\\d\\d:\\d\\d · 1[45]:\\d\\d left\\|Whereexample\\.com\\|A ${link.replace(/[.?]/g, '\\$&')} _blank noopener noreferrer $`));
  assert.match(await evaluate('document.querySelector(".ask-sheet .sh-lab").textContent'), /^Main · \d\d:\d\d$/);
  // A sign-in's More, in its sheet's head, holds Ask me later and Discard (its one button opens the link).
  assert.equal(await evaluate('[...document.querySelectorAll(".sh-head .dl-menu > button")].map((b) => b.textContent).join("|")'), 'Ask me later|Discard');
  // The page is not loaded again from here on: a mark set now is still there at the end.
  await evaluate('window.stillHere = true');
  // Discard on a sign-in's sheet, with a reason picked, closes it back to the list like any other ask, not to "Nothing to decide".
  signin('tmp-login', 'Tmp', 'https://example.com/tmp', '15m');
  await evaluate('location.hash = "#decide/tmp-login"');
  await until(async () => (await card('tmp-login')) !== null);
  await evaluate('document.querySelector(".sh-head .dis").click()');
  await evaluate('document.querySelector("#dc-sheet [data-reason=done-elsewhere]").click()');
  await until(async () => (await evaluate('location.hash')) === '#waiting' && !(await queue()).includes('Tmp'));
  assert.equal(await evaluate('document.querySelector("#board .es")?.textContent'), undefined);
  // Past its time the link has nothing left to open, and its card stays where it waits, plainly expired, for a new link or a discard.
  await evaluate('location.hash = "#waiting"');
  await until(async () => /Expired/.test(await evaluate('document.getElementById("item-gh-login")?.textContent ?? ""')));
  assert.equal(await evaluate('document.querySelectorAll(".decide-list .dl-row[data-group=signin]").length'), 2);
  // The same key with a new link opens the same card again, its link good once more.
  assert.match(signin('gh-login', 'GitHub', 'https://example.com/device?code=one-time-3', '10m').out, /gh-login,new link,GitHub,/);
  await until(async () => (await queue()).includes('GitHub'));
  await evaluate('document.querySelector("#item-gh-login").click()');
  await until(async () => (await evaluate('location.hash')) === '#decide/gh-login'
    && /^Sign in to GitHub\|UnlocksPublish GitHub\|Expires\d\d:\d\d · (10:00|9:\d\d) left\|Whereexample\.com\|A https:\/\/example\.com\/device\?code=one-time-3 _blank noopener noreferrer $/.test(await card('gh-login')));
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
  // Decide opens one card at a time, as a sheet over the list: tap the key's row first.
  const show = (key) => until(async () => evaluate(`document.querySelector("#item-${key}")?.click() ?? true`)
    .then(() => evaluate(`location.hash === "#decide/${key}" && !!document.querySelector(".ask-sheet .open-link")`)));
  const tapOpen = async (key) => { await show(key); await evaluate(`document.querySelector(".ask-sheet .open-link").click()`); };
  const line = () => evaluate(`document.querySelector(".ask-sheet .expiry, .ask-sheet .meta")?.textContent`);
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
  assert.equal(await evaluate('document.querySelector(".ask-sheet .open-link").disabled'), false);
  // Its exit 0 is the sign-in done: the card closes by itself.
  writeFileSync(join(dir, 'signed-in'), '');
  await evaluate('location.hash = "#waiting"');
  await until(async () => /fresh,done,/.test(run('answers', file).out) && !(await queue()).includes('fresh'));
  assert.equal(await evaluate('window.stillHere'), true);
  // A long sign-in link and a long Unlocks value: the label keeps its own word, the value takes the free width and wraps inside it, and nothing runs past the
  // sheet's right edge. A value that cannot wrap cleanly (the link's host) keeps one line with an ellipsis beside a 44px copy button that hands over all of it.
  const longLink = 'https://login.byokit-publisher.example.com/oauth/authorize?client_id=sign-off-axi&state=4f9c2a7e1b&code_challenge=Zx9Qm2Lp7Rt4Wv1Ny6Kc3Hb8Jd5Fg0Sa2De4Ui7Ol9Pq&code_challenge_method=S256';
  const longUnlocks = "npm 2FA approval for the 7 BYOKit packages (tick 'skip 2FA for 5 minutes' if offered)";
  assert.deepEqual([longLink.length, longUnlocks.length], [185, 85]);
  assert.equal(run('post', file, '--type', 'signin', '--key', 'long-link', '--service', 'npm', '--link', longLink, '--unlocks', longUnlocks, '--waits', 'Main', '--expires', '15m').code, 0);
  // On a phone-sized screen of its own, so the sheet's copy button sits where a thumb reaches it.
  const longView = await browse(join(dir, 'long'), 390, 844);
  const longEval = longView.evaluate;
  await longEval(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  await until(async () => (await longEval('!!document.getElementById("item-long-link")')));
  await longEval('document.querySelector("#item-long-link").click()');
  await until(async () => (await longEval('!!document.querySelector(".ask-sheet .signin-ask .facts .fact")')));
  // The sheet rises into place: wait for its rows to stop moving before measuring them or tapping one.
  const boxNow = () => longEval('(() => { const r = document.querySelector(".facts .cp").getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width)].join(); })()');
  await until(async () => { const was = await boxNow(); await new Promise((ok) => setTimeout(ok, 150)); return was === await boxNow(); });
  const long = await longEval(`(() => {
    const lines = (e) => { const r = document.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].filter((b) => b.width > 0.5).map((b) => Math.round(b.top))).size; };
    const sheet = document.querySelector('.ask-sheet'), right = sheet.getBoundingClientRect().right;
    const rows = [...sheet.querySelectorAll('.facts .fact')].map((r) => { const label = r.querySelector('.fl'), value = r.querySelector('b'), cp = r.querySelector('.cp');
      return { label: label.textContent, labelLines: lines(label), labelWidth: Math.round(label.getBoundingClientRect().width),
        value: value.textContent, valueLines: lines(value), valueRight: Math.round(value.getBoundingClientRect().right), clipped: value.scrollWidth > value.clientWidth + 1,
        copy: cp ? [Math.round(cp.getBoundingClientRect().width), Math.round(cp.getBoundingClientRect().height), cp.getAttribute('aria-label')] : null }; });
    return { right: Math.round(right), pageScrollWidth: document.documentElement.scrollWidth, past: [...sheet.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > right + 1).length, rows }; })()`);
  // Its right edge is the phone's, and nothing inside the sheet is past it or past the page.
  assert.deepEqual([long.past, long.pageScrollWidth], [0, 390]);
  // Every label keeps its word on one line, and the long value wraps inside the room the label leaves it.
  for (const r of long.rows) assert.deepEqual([r.labelLines, r.labelWidth > 30], [1, true], r.label);
  const [unlocks, where] = [long.rows.find((r) => r.label === 'Unlocks'), long.rows.find((r) => r.label === 'Where')];
  assert.deepEqual([unlocks.value, unlocks.valueLines > 1, unlocks.clipped, unlocks.valueRight <= long.right], [longUnlocks, true, false, true]);
  // The link's host cannot wrap cleanly: one line, an ellipsis, and the whole host behind a 44px copy button.
  assert.deepEqual([where.value, where.clipped, where.copy], ['login.byokit-publisher.example.com', true, [44, 44, 'Copy Where']]);
  // Tapped where it is, as a person taps it: a real click at the middle of its 44px box, with the clipboard allowed and the page focused, as a tab in front is.
  await longView.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: url.replace(/\/$/, '') });
  await longView.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  // What reaches the clipboard, watched through the browser's own write: the whole value, never the ellipsis the row shows.
  await longEval('window.copied = null; const w = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = (t) => (window.copied = t, w(t))');
  await longView.click(await longEval('(() => { const r = document.querySelector(".facts .cp").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()'));
  await until(async () => (await longEval('document.querySelector(".facts .cp").getAttribute("aria-label")')) === 'Copied');
  assert.equal(await longEval('window.copied'), 'login.byokit-publisher.example.com');
  // The board says so too, in its own toast.
  assert.equal(await longEval('document.getElementById("toast-text").textContent'), 'Copied');
  // It says Copied for a moment and then returns to its own name.
  await until(async () => (await longEval('document.querySelector(".facts .cp").getAttribute("aria-label")')) === 'Copy Where');
  await longView.close();
  close();
  proc.kill();
});

test('a sign-in card carries the poster\'s expiry as a live countdown in the person\'s own time, says plainly when the link has expired, reads Opened, waiting for approval once opened, and asks the poster for a new link', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'signin-expiry'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const signin = (key, service, url, expires) => run('post', file, '--type', 'signin', '--key', key, '--service', service, '--link', url, '--unlocks', `Publish ${service}`, '--waits', 'Main', '--expires', expires);
  assert.equal(signin('npm-login', 'npm', 'https://www.npmjs.com/login?next=/settings', '20m').code, 0);
  assert.equal(signin('gh-login', 'GitHub', 'https://login.example-publisher.example.com/oauth/authorize?code=one-time-1', '4s').code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'live'), 390, 844);
  // The end the poster set, in the person's own time, and under an hour the time left counting down.
  const ends = JSON.parse(await (await fetch(`${url}api/decisions`)).text()).decisions.find((d) => d.key === 'npm-login').expires;
  assert.ok(Date.parse(ends) > Date.now());
  const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(ends));
  const ticking = new RegExp(`^${clock} · \\d{1,2}:\\d\\d left$`);
  const sheet = () => evaluate(`(() => { const c = document.querySelector('.ask-sheet .signin-ask'); if (!c) return null;
    return { facts: [...c.querySelectorAll('.fact')].map((f) => [f.querySelector('.fl')?.textContent ?? '', f.querySelector('b')?.textContent ?? '']),
      bar: [...c.querySelectorAll('.decide-bar > *')].map((e) => e.tagName + ':' + e.textContent.trim()), hint: c.querySelector('.decide-bar .hint')?.textContent ?? '',
      open: (() => { const o = c.querySelector('.open-link'); return o && [o.tagName, o.disabled, o.getAttribute('href')].join(' '); })() }; })()`);
  const show = async (key) => {
    await until(async () => evaluate(`location.hash = "#waiting"`).then(() => evaluate(`document.querySelector("#item-${key}")?.click() ?? true`))
      .then(() => evaluate(`location.hash === "#decide/${key}" && !!document.querySelector(".ask-sheet .signin-ask")`)));
    return sheet();
  };
  const row = (key) => evaluate(`document.getElementById("item-${key}")?.textContent ?? ""`);
  const expiryOf = (s) => s.facts.find(([label]) => label === 'Expires')[1];
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  await until(async () => (await evaluate('!!document.getElementById("item-npm-login")')));
  // The card carries the end time too, not only the time left.
  assert.match(await row('npm-login'), new RegExp(`Main · until ${clock} · \\d{1,2}:\\d\\d left`));
  const npm = await show('npm-login');
  assert.match(expiryOf(npm), ticking);
  // It counts down while the page sits there, without a reload.
  const before = expiryOf(npm);
  await until(async () => expiryOf(await sheet()) !== before);
  // Opened, it reads as waiting for approval, on this page and after a reload, and it is not done.
  await evaluate('document.addEventListener("click", (e) => e.target.closest?.(".open-link") && e.preventDefault(), true)');
  await evaluate('document.querySelector(".ask-sheet .open-link").click()');
  await until(async () => /Opened/.test((await sheet()).hint));
  await evaluate('location.reload()');
  await until(async () => (await evaluate('!!document.getElementById("item-npm-login")')));
  const opened = await show('npm-login');
  assert.match(opened.hint, /^Opened — waiting for approval\./);
  assert.match(await row('npm-login'), /Main · Opened — waiting for approval/);
  assert.doesNotMatch(run('answers', file).out, /npm-login,done/);
  // Past the poster's time the card stays, plainly expired: Open is off, and what it unlocks and where stay readable.
  await evaluate('location.hash = "#waiting"');
  await until(async () => /Expired/.test(await row('gh-login')));
  // The server's own answer, not only the page's clock: the card the board would refuse already says expired.
  await until(async () => JSON.parse(await (await fetch(`${url}api/decisions`)).text()).decisions.find((d) => d.key === 'gh-login').expired === true);
  const gone = await show('gh-login');
  assert.equal(gone.open, 'BUTTON true ');
  assert.deepEqual(gone.facts.filter(([label, value]) => ['Unlocks', 'Where'].includes(label) && value).map(([label]) => label), ['Unlocks', 'Where']);
  // The value that cannot wrap stays readable beside its copy button, expired or not.
  assert.deepEqual(await evaluate('(() => { const b = document.querySelector(".ask-sheet .facts .cp"); return b && [b.getAttribute("aria-label"), Math.round(b.getBoundingClientRect().width)]; })()'), ['Copy Where', 44]);
  assert.equal(expiryOf(gone), 'Expired');
  // One action asks the poster for a fresh link, and the poster reads it as a comment with poll or wait.
  const ask = async (text) => {
    const poll = spawn('node', [cli, 'poll', file, '--json', '--timeout', '20']);
    let polled = '';
    poll.stdout.on('data', (b) => (polled += b));
    const exited = new Promise((ok) => poll.on('exit', ok));
    await new Promise((ok) => setTimeout(ok, 300));
    await until(async () => (await sheet()).bar.some((e) => e === 'BUTTON:Ask for a new link'));
    await evaluate('[...document.querySelectorAll(".ask-sheet .decide-bar button")].find((b) => b.textContent === "Ask for a new link").click()');
    assert.equal(await exited, 0);
    assert.deepEqual(JSON.parse(polled).messages.map(({ kind, text }) => [kind, text]), [['comment', text]]);
  };
  await ask('Reissue the GitHub sign-in link: the one on the card has expired.');
  // Asked, the card says so until its poster posts a new link.
  await until(async () => (await sheet()).bar.some((e) => e === 'BUTTON:Asked for a new link'));
  // The same action works while the link still does: a person may need a fresh one before the old one dies.
  const valid = await show('npm-login');
  assert.match(valid.open, /^A\s+https:\/\/www\.npmjs\.com\/login/);
  await ask('Reissue the npm sign-in link: the one on the card expires at ' + clock + '.');
  // A new link on the same key is a new sign-in: the card waits again, its old open does not count, and it never reads as done.
  assert.equal(signin('npm-login', 'npm', 'https://www.npmjs.com/login?next=/settings&code=two', '20m').code, 0);
  await until(async () => !/Opened/.test(await row('npm-login')));
  assert.doesNotMatch(await row('npm-login'), /Acted/);
  assert.doesNotMatch(run('answers', file).out, /npm-login,done/);
  await close();
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
  assert.equal(await evaluate('document.querySelectorAll(".dl-row[data-group=review] .dl-face[href^=\'#waiting/\']").length'), 1);
  assert.equal(run('list', file).out.includes('for-reading'), false);
  await evaluate('location.hash = "#reports"');
  await until(async () => (await count('Reports')) === '1' && (await evaluate('document.getElementById("board").textContent')).includes('A plan to read'));
  close();
  proc.kill();
});

test('a guided report: item detail keeps its line breaks, same-axis options read as one comparison table at 390 and 1280', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'compare'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const report = JSON.parse(readFileSync(new URL('../fixtures/contract/report.v4/valid-full.json', import.meta.url)));
  report.about += ' <img src=x onerror=alert(1)> [unsafe](javascript:alert(1))';
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
      assert.equal(await evaluate(`document.querySelectorAll('#board img[onerror], #board a[href^="javascript:"]').length`), 0, 'report text cannot become executable HTML or a javascript link');
      // The stacked table at 390 reads at the 16 px body size; with room for columns it is the 13 px table.
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('#gd-compare .gd-ct td')).fontSize`), width === 1280 ? '13px' : '16px', `${width}`);
      // Detail that is not a table keeps one line per point.
      await evaluate(`document.querySelector('#gd-lines .rowbtn').click()`);
      const lines = await evaluate(`(() => { const f = document.querySelector('#gd-lines .body [data-sf="more"]') ?? document.querySelector('#gd-lines .body .gd-md'), r = document.createRange(), tops = new Set(), walk = document.createTreeWalker(f, NodeFilter.SHOW_TEXT);
        for (let n; (n = walk.nextNode());) if (n.data.trim()) { r.selectNodeContents(n); for (const b of r.getClientRects()) tops.add(Math.round(b.top)); }
        return { text: f.textContent, lines: [...f.querySelectorAll('p')].map((p) => p.textContent), tops: tops.size }; })()`);
      assert.deepEqual(lines, { text: 'Close the input.\nPin the version.\nReady the backup.', lines: ['Close the input.', 'Pin the version.', 'Ready the backup.'], tops: 3 }, `${width}`);
    } finally { close(); }
  }
  proc.kill();
});

// A capture of a report is a desktop screenshot: on a phone its tap stays on the board's own live page, never the raw file shrunk in a tab.
test('an ask on a guided report answers the tap on a phone: the bar\'s Ask sends the part in view, Activity shows Sent to the agent with the time, a repeated tap says Already sent and sends nothing more, and Agent replied shows once the agent answers', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'ask-feedback'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const report = { ...JSON.parse(readFileSync(new URL('../fixtures/contract/report.v4/valid-full.json', import.meta.url))), filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  const posted = run('post', file, '--kind', 'report', '--from', join(dir, 'report.json'));
  assert.equal(posted.code, 0, posted.out);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const asks = () => { try { return readFileSync(join(dir, 'board.deeper.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.op === 'ask'); } catch { return []; } };
  const { evaluate, close } = await browse(join(dir, 'b'), 390, 844, true);
  const goDeeper = () => evaluate(`document.querySelector('.ra-b.asks').click(), document.querySelector('#sheet .ra-pre').click()`);
  const entry = `(() => { const e = document.querySelector('.gd-act .ra-e[data-ask]'); return e ? [e.querySelector('.ra-eh b').textContent, e.querySelector('.ra-st')?.textContent ?? '', document.querySelectorAll('.gd-act .ra-e[data-ask]').length].join('|') : ''; })()`;
  try {
    await evaluate(`location.href = ${JSON.stringify(`${url}#reports/${report.key}`)}`);
    await until(() => evaluate(`!!document.querySelector('.ra-bar .ra-b.asks')?.getClientRects().length`));
    // One bar for the report: the part in view is named in it, and no part carries a row of its own.
    assert.equal(await evaluate(`document.querySelectorAll('.ra-bar').length + ':' + document.querySelectorAll('.gd-sec .gd-v, .gd-sec .gd-more, .gd-rc').length`), '1:0');
    await goDeeper();
    await until(async () => /^You asked Go deeper\|Sent to the agent \d\d:\d\d\|1$/.test(await evaluate(entry)));
    assert.match(await evaluate(`document.querySelector('.ra-note').textContent`), /^Sent to the agent \d\d:\d\d\./);
    assert.equal(asks().length, 1);
    // The same tap again sends nothing and says so on the ask already sent.
    await goDeeper();
    await until(async () => /^You asked Go deeper\|Already sent \d\d:\d\d\|1$/.test(await evaluate(entry)));
    await evaluate('new Promise((ok) => setTimeout(ok, 300))');
    assert.equal(asks().length, 1);
    // The author agent answers it: the entry reads Agent replied with the time, and the answer is in it.
    const replied = run('deeper', file, '--filer', report.filer, '--id', asks()[0].id, '--text', 'The code now comes with the password, so one screen is gone.');
    assert.equal(replied.code, 0, replied.out);
    await until(async () => /^Agent replied to your Go deeper\|\|1$/.test(await evaluate(entry)));
    assert.match(await evaluate(`document.querySelector('.gd-act .ra-e[data-ask]').textContent`), /The code now comes with the password/);
    // The feedback trail: under the entry its track reads Sent, Delivered, Read and Replied (a wait handed it over, so Delivered is the same moment),
    // and once the report is left the reply waits in Today, the report's row on Reports carrying its badge until the report is opened again.
    const track = `[...document.querySelectorAll('.gd-act .ra-e[data-ask] .ui-trail li')].map((l) => l.querySelector('b').textContent + (l.classList.contains('on') ? '+' : '')).join(' ')`;
    await until(async () => (await evaluate(track)) === 'Sent+ Delivered+ Read+ Replied+');
    await evaluate(`location.href = ${JSON.stringify(url)}`);
    await until(async () => (await evaluate('[...document.querySelectorAll(".t-replies .ui-row .t")].map((t) => t.textContent).join()')) === report.title);
  } finally { close(); }
  proc.kill();
});

test('Not quite with a note and Tell the agent, on a phone on an answers-only board: the note is taken, saved, handed to the report\'s author by wait --filer, its track at Sent, then Read in Activity', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'fed-not-quite'), file = join(dir, 'board.json'), note = 'It is VMs, not containers: each agent gets its own machine.';
  mkdirSync(dir);
  const report = { ...JSON.parse(readFileSync(new URL('../fixtures/contract/report.v4/valid-full.json', import.meta.url))), key: 'mx-agents-on-vms-v2', filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  assert.equal(run('post', file, '--kind', 'report', '--from', join(dir, 'report.json')).code, 0);
  // The owner's board is fed by another program, so it takes answers only.
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), answers_only: true }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, tap, insertText, close } = await browse(join(dir, 'b'), 390, 844, true);
  // The middle of an element, as a finger would find it: scrolled to, then waited out. The page reflows under a point that was measured too
  // soon (a font swapping in, a picture above arriving and taking its room), and a tap at the old point lands on whatever moved there: this
  // one waited 60 seconds for a note box that a tap had missed by 77 pixels. So the point is only returned once the element holds still.
  const centre = (sel) => evaluate(`(async () => { const b = document.querySelector(${JSON.stringify(sel)}); b.scrollIntoView({ block: 'center' });
    const at = () => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; };
    await document.fonts?.ready;
    let last = at().join();
    for (let i = 0; i < 20; i++) { await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))); const now = at();
      if (now.join() === last) return now; last = now.join(); }
    return at(); })()`);
  // A point over an element, or nothing while the element is not under it: the layout still moves under a point measured a moment ago (a font
  // swapping in, a picture above taking its room, a caret scrolling into view after typing), and a phone's tap at the stale point lands on
  // whatever moved there. Measured here as the "Not quite" tap landing on the understood text, 77 pixels lower, and the card never told.
  const pointAt = (sel) => evaluate(`(async () => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return null;
    const at = () => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; };
    const under = () => { const p = at(); return document.elementFromPoint(p[0], p[1])?.closest(${JSON.stringify(sel)}) === b ? p : null; };
    b.scrollIntoView({ block: 'center' }); await document.fonts?.ready;
    for (let i = 0; i < 30; i++) { const p = under(); await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const q = under(); if (p && q && p.join() === q.join()) return q; }
    return under(); })()`);
  // A tap that lands and is taken: the point is read again whenever the page has moved the button out from under it, and the press is given
  // the seconds a send takes to come back before it counts as missed. A press the button felt that the card ignored fails here.
  const tapOn = async (sel, took) => {
    for (let i = 0; i < 3; i++) {
      const point = await pointAt(sel);
      if (!point) continue;
      await tap(point);
      for (let n = 0; n < 30; n++) { if (await evaluate(took)) return; await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.fail(`the card never felt the tap on ${sel}`);
  };
  const card = '[data-part="understood"]';
  // Each note in Activity: what was said, its part, the words, and the step its track has reached (Sent, Delivered, Read, Replied).
  const status = `[...document.querySelectorAll('.gd-act .ra-e')].filter((e) => e.querySelector('.ra-say, .tr-you')).map((c) => c.querySelector('.ra-eh b').textContent + '|' + c.querySelector('.ra-chip').textContent + '|' + (c.querySelector('.ra-say') ?? { textContent: '“' + c.querySelector('.tr-you p').textContent + '”' }).textContent + '|' + c.querySelector('.ui-trail')?.getAttribute('aria-label').split(':')[0]).join('#')`;
  try {
    await evaluate(`location.href = ${JSON.stringify(`${url}#reports/${report.key}`)}`);
    await until(() => evaluate(`!!document.querySelector('${card} .gd-choice[data-u="no"]')?.getClientRects().length`));
    await evaluate(`document.querySelector('.gd-scroll').style.scrollBehavior = 'auto'`);
    await tapOn(`${card} .gd-choice[data-u="no"]`, `document.querySelector('${card} .gd-choice[data-u="no"]').getAttribute('aria-pressed') === 'true'`);
    await until(() => evaluate(`!document.querySelector('${card} .gd-note').hidden`));
    await evaluate(`document.querySelector('${card} .gd-note').focus()`);
    await insertText(note);
    await until(() => evaluate(`!document.querySelector('${card} .gd-tell').hidden`));
    await tapOn(`${card} .gd-tell`, `document.querySelector('${card} .gd-tell').hidden`);
    // Accepted, no "takes answers only": the note is in Activity as sent, and the note box and Tell the agent make way for it.
    const shown = (state) => `You said Not quite|What I understood|“${note}”|${state}`;
    await until(async () => (await evaluate(status)) === shown('Sent'));
    assert.equal(await evaluate(`[document.querySelector('${card} .gd-note').hidden, document.querySelector('${card} .gd-tell').hidden].join()`), 'true,true');
    const saved = readFileSync(join(dir, 'board.annotations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(saved.map(({ key, part, verdict, text }) => [key, part, verdict, text]), [[report.key, 'understood', 'disagree', note]]);
    // The report's author gets it from its own wait, once.
    const taken = execFileSync(process.execPath, [cli, 'wait', file, '--filer', report.filer, '--events', '--timeout', '10'], { encoding: 'utf8', env });
    const event = JSON.parse(taken.trim());
    assert.deepEqual([event.event, event.key, event.part, event.verdict, event.text], ['comment', report.key, 'understood', 'disagree', note]);
    await until(async () => (await evaluate(status)) === shown('Read'));
    // That is right is the same part's Agree, saved and taken the same way.
    await tap(await centre(`${card} .gd-choice[data-u="yes"]`));
    await until(() => readFileSync(join(dir, 'board.annotations.jsonl'), 'utf8').includes('"verdict":"agree"'));
    assert.equal(JSON.parse(execFileSync(process.execPath, [cli, 'wait', file, '--filer', report.filer, '--events', '--timeout', '10'], { encoding: 'utf8', env }).trim()).verdict, 'agree');
  } finally { close(); }
  proc.kill();
});

test('a guided report acts from one place: the parts carry no buttons or receipts, the bar acts on the part in view (Agree is saved and shows Agreed, Comment sends one note), and Activity lists both, with the numbers kept under their part', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'one-bar'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const report = { ...JSON.parse(readFileSync(new URL('../fixtures/contract/report.v4/valid-full.json', import.meta.url))), filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
  report.sections.push({ id: 'steps', stage: 'found', heading: 'Two steps', body: 'The second one opens.', items: [{ title: 'Close the input', text: 'One line.' }, { title: 'Pin the version', text: 'Tap for why.', more: 'The newer one hangs.' }],
    details: [{ label: 'Hangs', value: '3 of 40 runs' }] });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  const posted = run('post', file, '--kind', 'report', '--from', join(dir, 'report.json'));
  assert.equal(posted.code, 0, posted.out);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const saved = () => { try { return readFileSync(join(dir, 'board.annotations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; } };
  const { evaluate, close } = await browse(join(dir, 'b'), 390, 844, true);
  try {
    await evaluate(`location.href = ${JSON.stringify(`${url}#reports/${report.key}`)}`);
    await until(() => evaluate(`!!document.querySelector('.ra-bar .ra-b.agree')?.getClientRects().length`));
    // No part has a button row, a Details or Go deeper button, or a receipt; the numbers are plain content under their part.
    assert.equal(await evaluate(`[document.querySelectorAll('.gd-main .gd-foot, .gd-main .gd-lnk.deep, .gd-main .gd-rc').length, [...document.querySelectorAll('.gd-main button.gd-lnk')].filter((b) => b.getClientRects().length).length, [...document.querySelectorAll('[data-part="steps"] > .gd-nums td')].map((t) => t.textContent).join()].join('|')`), '0|0|3 of 40 runs');
    // Agree acts on the part in view and shows Agreed there.
    await evaluate(`document.querySelector('.gd-scroll').style.scrollBehavior = 'auto'; document.querySelector('[data-part="steps"]').scrollIntoView({ block: 'center' })`);
    await until(async () => (await evaluate(`document.querySelector('.ra-ont').textContent`)) === 'Two steps');
    await evaluate(`document.querySelector('.ra-b.agree').click()`);
    await until(async () => saved().length === 1 && (await evaluate(`document.querySelector('.ra-b.agree').getAttribute('aria-pressed') + document.querySelector('.ra-b.agree').textContent`)) === 'trueAgreed');
    assert.deepEqual(saved().map(({ part, verdict }) => [part, verdict]), [['steps', 'agree']]);
    // Comment opens one composer on that part and sends one note.
    await evaluate(`document.querySelector('.ra-b.cmt').click()`);
    await until(() => evaluate(`document.querySelector('#sheet .ra-part')?.value === 'steps'`));
    await evaluate(`(() => { const t = document.querySelector('#sheet textarea'); t.value = 'Pin it to 2.4.'; t.dispatchEvent(new Event('input')); document.querySelector('#sheet .ra-send').click(); })()`);
    await until(() => saved().length === 2);
    assert.deepEqual(saved().map(({ part, verdict, text }) => [part, verdict, text]).at(-1), ['steps', undefined, 'Pin it to 2.4.']);
    // The comment is a bubble in place under its part with Sent under it, not only a line in Activity; the box is closed and Send is itself again.
    await until(async () => (await evaluate(`(() => { const c = document.querySelector('[data-part="steps"] .gd-thread .gd-cmt'); return c ? c.querySelector('p').textContent + '|' + [...c.querySelectorAll('.ui-trail li.on b')].map((b) => b.textContent).join() : ''; })()`)) === 'Pin it to 2.4.|Sent');
    assert.equal(await evaluate(`!document.querySelector('#sheet[open]')`), true);
    // Activity lists both, newest first, each naming its part.
    await until(async () => (await evaluate(`[...document.querySelectorAll('.gd-act .ra-e')].filter((e) => e.querySelector('.ra-chip')?.textContent === 'Two steps').map((e) => e.querySelector('.ra-eh b').textContent).join('|')`)) === 'You commented|You agreed');
    // Nothing sits under the bar at 390, and at 1280 and 1440 with Activity open as a column: it sits under the scroll, never over it; and every track label in Activity is whole, under its own dot, clear of the next.
    const clear = `(() => { const sc = document.querySelector('.gd-scroll').getBoundingClientRect(), bar = document.querySelector('.ra-bar').getBoundingClientRect(), fit = [...document.querySelectorAll('.gd-act .ui-trail ol')].filter((o) => o.getClientRects().length).flatMap((o) => { const li = [...o.children], at = (b) => { const r = document.createRange(); r.selectNodeContents(b); return r.getBoundingClientRect(); };
        // Each label is whole, starts under its own dot and ends clear of the next label.
        return li.map((l, i) => { const t = at(l.querySelector('b')), dot = l.querySelector('i').getBoundingClientRect(), next = li[i + 1] && at(li[i + 1].querySelector('b')); return t.width <= l.querySelector('b').getBoundingClientRect().width + 0.5 && Math.abs(t.left - dot.left) <= 2 && (!next || next.left - t.right >= 4); }); });
      document.querySelector('.gd-scroll').scrollTop = 1e6; return [bar.top >= sc.bottom - 0.5, fit.length > 0 && fit.every(Boolean)].join(); })()`;
    assert.equal(await evaluate(`(() => { document.querySelector('.ra-actb').click(); return true; })()`), true);
    assert.equal(await evaluate(clear), 'true,true', '390');
    // On a phone the sticky head names the part in view, as the bar does.
    assert.equal(await evaluate(`document.querySelector('.gd-progress .now-part').textContent === document.querySelector('.ra-ont').textContent && document.querySelector('.now-part').getClientRects().length > 0 && document.querySelector('.now-part').textContent.length > 3`), true);
    for (const width of [1280, 1440]) {
      const desk = await browse(join(dir, `b${width}`), width, 800);
      try {
        await desk.evaluate(`location.href = ${JSON.stringify(`${url}#reports/${report.key}`)}`);
        await until(() => desk.evaluate(`!!document.querySelector('.gd-act .ui-trail b')?.getClientRects().length`));
        assert.equal(await desk.evaluate(clear), 'true,true', String(width));
      } finally { desk.close(); }
    }
  } finally { close(); }
  proc.kill();
});

test('a report names the part in view as its reader scrolls it, and the page keeps no error of its own', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'reader-measure'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const report = { ...JSON.parse(readFileSync(new URL('../fixtures/contract/report.v4/valid-full.json', import.meta.url))), filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
  report.sections.push({ id: 'steps', stage: 'found', heading: 'Two steps', body: 'The second one opens.', items: [{ title: 'Close the input', text: 'One line.' }] });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  const posted = run('post', file, '--kind', 'report', '--from', join(dir, 'report.json'));
  assert.equal(posted.code, 0, posted.out);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, send, close } = await browse(join(dir, 'b'), 390, 844, true);
  try {
    // The page keeps its own errors: a throw inside a redraw or a scroll leaves a screen half drawn, and no screenshot or click can see that.
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "globalThis.__errors = []; addEventListener('error', (e) => globalThis.__errors.push(String(e && e.message))); addEventListener('unhandledrejection', (e) => globalThis.__errors.push(String(e && e.reason)));" });
    await evaluate(`location.href = ${JSON.stringify(`${url}#reports/${report.key}`)}`);
    await until(() => evaluate(`!!document.querySelector('.ra-bar .ra-b.agree')?.getClientRects().length`));
    // The reader is scrolled by hand, the typeface swaps in under it, and the bar names the part the person has in front of them.
    await evaluate(`document.querySelector('.gd-scroll').style.scrollBehavior = 'auto'; document.querySelector('[data-part="steps"]').scrollIntoView({ block: 'center' })`);
    await until(async () => (await evaluate(`document.querySelector('.ra-ont').textContent`)) === 'Two steps');
    await evaluate(`document.fonts.ready.then(() => document.querySelector('[data-part="this"]').scrollIntoView({ block: 'center' }))`);
    await until(async () => (await evaluate(`document.querySelector('.ra-ont').textContent`)) !== 'Two steps');
    assert.deepEqual(await evaluate('globalThis.__errors'), []);
  } finally { close(); proc.kill(); }
});

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
  const askTitles = () => evaluate('[...document.querySelectorAll(".decide-list .dl-row:not(.g-done) .dl-face .t")].map((s) => s.textContent).join("|")');
  const heads = () => evaluate('[...document.querySelectorAll(".decide-list .ui-sec")].map((h) => h.textContent).join("|")');
  // A More item: the menu opens, then the item is tapped.
  const more = (act) => evaluate(`(() => { document.querySelector(".decide-list .t-more-line").click(); document.querySelector('#d-more [data-act="${act}"]').click(); return true; })()`);
  // Decide lists the asks newest first in one card (a board with no filed times reads the file reversed), under the hero's count.
  await until(async () => (await askTitles()) === 'Which day for release?|Keep the weekly digest?');
  // The total counts the design waiting beside the two asks.
  assert.equal(await evaluate('document.querySelector(".decide-list .ui-hero .big").textContent'), '3');
  assert.equal(await heads(), 'Asks');
  // Every row uses the shared project tile; an unlinked ask labels its project as absent.
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".decide-list .dl-list .ui-icon")].map((p) => p.getAttribute("aria-label"))'), ["No project", "No project"]);
  // With no project and no filed time, a row's second line says who asked.
  assert.equal(await evaluate('[...document.querySelectorAll(".decide-list .dl-list .ui-row .meta")].map((s) => s.textContent).join("|")'), 'Agent|Agent');
  // A design pick is no ask: Asks does not list it, and it opens by its address.
  assert.equal(await evaluate('!!document.querySelector("#item-look")'), false);
  await evaluate('location.hash = "#decide/look"');
  await until(async () => (await evaluate('location.hash')) === '#decide/look');
  assert.equal(await evaluate('document.querySelector(".decide .why")?.textContent'), 'No new bugs in three weeks, and support is fully staffed on Friday.');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".decide-preview .mock")].map((f) => [f.querySelector(".label").textContent, f.querySelector(".shot.none")?.textContent ?? null])'),
    [['B', null], ['A', 'No mock for this option'], ['C', 'No mock for this option']]);
  assert.equal(await evaluate('document.querySelector(".silent-line")?.textContent'), 'If you stay quiet, the agent waits for your answer.');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".pick-option"), "::before").content'), 'none');
  // The bar sits under the last card and the quiet line once the sheet scrolls to its end.
  await evaluate('document.querySelector(".ask-sheet").scrollTop = 1e5');
  assert.equal(await evaluate('(() => { const b = document.querySelector(".decide-bar").getBoundingClientRect().top; return document.querySelector(".pick-list").getBoundingClientRect().bottom <= b && document.querySelector(".decide > .silent-line").getBoundingClientRect().bottom <= b; })()'), true);
  // Ask me later beside the one answer button at the sheet's foot, and More and Close in its head, all big enough for a thumb.
  assert.equal(await evaluate('[...document.querySelectorAll(".decide-bar > *")].map((e) => e.className).join() + "|" + [document.querySelector(".decide-bar .later-btn"), document.querySelector(".decide-bar .answer"), document.querySelector(".sh-head > .dl-more > summary")].map((e) => e.getBoundingClientRect().height >= 44).join()'), 'later-btn,answer|true,true,true');
  await evaluate('location.hash = "#waiting"');
  await until(async () => (await askTitles()) === 'Which day for release?|Keep the weekly digest?');
  // The head holds the title, the order and the light-or-dark button; More is the line under the list, whose sheet holds no sort.
  assert.equal(await evaluate('[...document.querySelectorAll(".ui-top > *")].map((e) => e.tagName.toLowerCase() + (e.classList.contains("theme") ? ".theme" : e.classList.contains("dl-rb") ? ".order" : "")).join("|")'), 'h1|button.order|button.theme');
  // The order button opens a sheet of Newest and By priority; By priority marks the button and puts P0 first, Newest puts the board's order back.
  const order = () => evaluate('[document.querySelector(".dl-rb").getAttribute("aria-label"), document.querySelector(".dl-rb").classList.contains("on"), document.getElementById("dl-sort").open ? [...document.querySelectorAll("#dl-sort .dl-pick")].map((b) => b.textContent + (b.hasAttribute("aria-current") ? "*" : "")).join() : ""].join("|")');
  await evaluate('document.querySelector(".dl-rb").click()');
  await until(async () => (await evaluate('document.getElementById("dl-sort").open')) === true);
  assert.equal(await order(), 'Order: Newest|false|Newest*,By priority');
  await evaluate('document.querySelectorAll("#dl-sort .dl-pick")[1].click()');
  await until(async () => (await order()) === 'Order: By priority|true|');
  await evaluate('document.querySelector(".dl-rb").click()');
  await until(async () => (await evaluate('document.getElementById("dl-sort").open')) === true);
  await evaluate('document.querySelectorAll("#dl-sort .dl-pick")[0].click()');
  await until(async () => (await order()) === 'Order: Newest|false|' && (await askTitles()) === 'Which day for release?|Keep the weekly digest?');
  // Its button is Today's: a tap switches light and dark for the whole board, and a second tap switches back.
  const scheme = () => evaluate('document.querySelector(".ui-top .theme").getAttribute("aria-label") + "|" + document.documentElement.style.colorScheme');
  const was = await scheme();
  await evaluate('document.querySelector(".ui-top .theme").click()');
  await until(async () => (await scheme()) !== was && /^Switch to (light|dark)\|(dark|light)$/.test(await scheme()));
  await evaluate('document.querySelector(".ui-top .theme").click()');
  await until(async () => (await scheme()).split('|')[0] === was.split('|')[0]);
  assert.equal(await evaluate('(() => { document.querySelector(".decide-list .t-more-line").click(); const acts = [...document.querySelectorAll("#d-more[open] [data-act]")].map((b) => b.dataset.act).join("|"); document.getElementById("d-more").close(); return acts; })()'), 'select|answer-all|later-all');
  // Today's Up next is the first ask Decide lists with a recommended answer, and Other answer opens it; Waiting on you's See all opens Decide.
  await evaluate('location.hash = ""');
  await until(async () => (await evaluate('document.querySelector(".t-up .q")?.textContent')) === 'Which day for release?');
  assert.equal(await evaluate('document.querySelector(".t-up .t-btn.ink .lbl").textContent + "|" + document.querySelector(".t-up .t-btn.white").textContent'), 'Answer friday|Other answer');
  await evaluate('document.querySelector(".t-up .t-btn.white").click()');
  await until(async () => await evaluate('location.hash === "#decide/release" && document.querySelector(".decide h2")?.textContent === "Which day for release?"'));
  await evaluate('location.hash = ""');
  await until(async () => await evaluate('!!document.querySelector(".t-wait .see")'));
  await evaluate('document.querySelector(".t-wait .see").click()');
  await until(async () => (await evaluate('location.hash')) === '#waiting');
  await evaluate("location.hash = '#waiting'");
  await until(async () => (await evaluate('location.hash')) === '#waiting');
  // Decide shows the ask's context line when it carries no reason text of its own.
  await evaluate('location.hash = "#decide/digest"');
  await until(async () => (await evaluate('location.hash')) === '#decide/digest');
  assert.equal(await evaluate('document.querySelector(".decide .why")?.textContent'), 'Open rate held steady.');
  // Answer, undo, then accept by keyboard so the Waiting list and its toast reflect the durable answer.
  await evaluate("location.hash = '#waiting'");
  await until(async () => (await askTitles()) === 'Which day for release?|Keep the weekly digest?');
  // On a phone the ask rises as a sheet over the list, which stays under it.
  assert.equal(await evaluate('new Promise((ok) => { document.querySelector(`a[href="#decide/release"]`).click(); setTimeout(() => ok(location.hash + "|" + !!document.querySelector(".ask-over.up .ask-sheet") + "|" + !!document.querySelector(".decide-list")), 30); })'), '#decide/release|true|true');
  await until(async () => (await evaluate('location.hash')) === '#decide/release');
  assert.equal(await evaluate('document.querySelector(".decide h2").textContent'), 'Which day for release?');
  // A reason text wins over the ask's context line.
  assert.equal(await evaluate('document.querySelector(".decide .why").textContent'), 'The release needs one calm day.');
  // Three answers then Your own answer; nothing is picked yet: Recommended is a tag on its card, and the button waits, off, until a pick.
  assert.equal(await evaluate('[...document.querySelectorAll(".pick-option")].map((b) => b.querySelector(".label").textContent + (b.querySelector(".recommend") ? "*" : "") + ":" + b.getAttribute("aria-pressed")).join("|")'),
    'today:false|friday*:false|next-week:false|Your own answer:false');
  assert.equal(await evaluate('(() => { const a = document.querySelector(".decide-bar .answer"); return a.textContent + "|" + a.disabled; })()'), 'Pick an answer|true');
  // A pick slides the button's label to it; the answer turns the button green with a check, then the sheet closes back to the list.
  await evaluate('document.querySelector(".pick-option").click()');
  assert.equal(await evaluate('document.querySelector(".decide-bar .answer").textContent + "|" + document.querySelector(".answer .lbl").classList.contains("swap")'), 'Answer today|true');
  await evaluate('document.querySelector(".decide-bar .answer").click()');
  assert.equal(await evaluate('document.querySelector(".decide-bar .answer").classList.contains("done")'), true);
  await until(async () => (await evaluate('location.hash + "|" + !!document.querySelector(".ask-sheet")')) === '#waiting|false');
  await until(async () => (await evaluate('!document.querySelector("#toast").hidden && document.querySelector("#toast").dataset.mark')) === 'ok');
  assert.match(run('answers', file, '--key', 'release').out, /today/);
  // On the list it is under Answered.
  await until(async () => (await askTitles()) === 'Keep the weekly digest?' && (await heads()) === 'Asks|Answered1');
  // Undo on the list puts the row back in place, with a flash, and stays on the list.
  await evaluate('document.querySelector("#undo").click()');
  await until(async () => !/today/.test(run('answers', file, '--key', 'release').out));
  await until(async () => (await askTitles()) === 'Which day for release?|Keep the weekly digest?');
  assert.equal(await evaluate('location.hash'), '#waiting');
  await evaluate("location.hash = '#decide/release'");
  await until(async () => (await evaluate('location.hash')) === '#decide/release' && (await evaluate('document.querySelectorAll(".pick-option").length')) === 4);
  // A number picks that answer, and Enter sends it.
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }))');
  assert.equal(await evaluate('document.querySelector(".decide-bar .answer").textContent'), 'Answer today');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))');
  // On a phone the answer closes the sheet once its check has played; waiting for that keeps the late step from landing on Answered below.
  await until(async () => /today/.test(run('answers', file, '--key', 'release').out) && (await evaluate('location.hash')) === '#waiting');
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
  await until(async () => (await evaluate('document.querySelector("#board .es b")?.textContent')) === 'That question isn’t waiting');
  await evaluate("location.hash = '#waiting'");
  await until(async () => (await evaluate('location.hash')) === '#waiting');
  // A posted plan waits with the asks: its card gives the title, its counts and one Open plan, which opens its page over the board with the pointing script.
  const fixture = new URL('../fixtures/contract/plan.v1/', import.meta.url).pathname;
  mkdirSync(join(dir, 'page'));
  writeFileSync(join(dir, 'page', 'index.html'), readFileSync(join(fixture, 'page', 'index.html')));
  assert.equal(run('post', file, '--kind', 'plan', '--from', join(fixture, 'valid-full.json')).code, 0);
  await evaluate('window.old = true, location.reload()');
  await until(() => evaluate('!window.old'));
  // The plan is a row with the asks, opening its own page; the page never scrolls sideways.
  await until(async () => (await heads()) === 'Asks|Answered1' && (await askTitles()).includes('Show plans on the board'));
  const planRow = 'document.getElementById("item-plan-kind-board")';
  assert.equal(await evaluate(`${planRow}.querySelector(".t").textContent + "|" + ${planRow}.closest(".dl-row").dataset.group + "|" + ${planRow}.getAttribute("href")`), 'Show plans on the board|review|#waiting/plan-kind-board');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true);
  // Move all to later, from More: every row goes under Later, with a toast and Undo, which brings them back.
  await more('later-all');
  await until(async () => (await heads()) === 'Asks|Later2|Answered1' && (await evaluate('document.querySelector(".decide-list .dl-clear b")?.textContent')) === 'All clear');
  await evaluate('document.getElementById("undo").click()');
  await until(async () => (await heads()) === 'Asks|Answered1');
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
  // A plan with one section and no decisions waits as a row of its own too.
  assert.equal(run('post', file, '--kind', 'plan', '--from', join(fixture, 'valid-minimal.json')).code, 0);
  await evaluate('location.hash = "#waiting"');
  await evaluate('window.old = true, location.reload()');
  await until(() => evaluate('!window.old'));
  await until(async () => (await evaluate('document.querySelector("#item-plan-filter-waiting .t")?.textContent')) !== undefined);
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
  const queue = () => evaluate('[...document.querySelectorAll(".decide-list .dl-row:not(.g-done) .dl-face .t")].map((s) => s.textContent).join("|")');
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
  const queue = () => evaluate('[...document.querySelectorAll(".decide-list .dl-row:not(.g-done) .dl-face .t")].map((s) => s.textContent).join("|")');
  await until(async () => (await queue()) === 'Third ask|Second ask|First ask');
  close();
  proc.kill();
});

// Fed boards arrive with shapes the poster chose: a stored type-ask keeps its stored type but shows the type its shape answers as,
// and one shared classifier names every ask, so a row with no recommended pick says the type its shape answers as.
test('Waiting on you: asks share project tiles while a reply-only ask, a yes/no and a decision with mocks keep their own answer flows', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
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
  const titles = () => evaluate('[...document.querySelectorAll(".decide-list .dl-row:not(.g-done) .dl-face .t")].map((s) => s.textContent).join("|")');
  await until(async () => (await titles()) === 'Pick a cover|Ship it?|Say ready when you are');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".decide-list .ui-icon")].map((p) => p.getAttribute("aria-label"))'), ["No project", "No project", "No project"]);
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

test('Decide on a pick-one ask: nothing is picked until you pick and the button then names the pick, Your own answer is the last card and opens one box whose words Send answer sends, one note goes with any pick, More holds only Ask me later and Discard, and E moves to the next ask', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async (t) => {
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
  // Hold the real comment response until the next ask is being typed in. The answer has
  // already navigated there, but its follow-up comment request can still redraw the board.
  const comment = Promise.withResolvers();
  let arrived = false;
  const proxy = createHttpServer((req, res) => {
    const forward = request(new URL(req.url, url), { method: req.method, headers: { ...req.headers, host: new URL(url).host } }, async (upstream) => {
      if (req.url === '/api/messages') { arrived = true; await comment.promise; }
      res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
    });
    forward.on('error', (error) => res.destroy(error));
    req.pipe(forward);
  });
  await new Promise((ok) => proxy.listen(0, '127.0.0.1', ok));
  t.after(async () => { comment.resolve(); proxy.closeAllConnections(); await new Promise((ok) => proxy.close(ok)); });
  const { evaluate, close } = await browse(join(dir, 'b'), 1280);
  await evaluate(`location.href = ${JSON.stringify(`http://127.0.0.1:${proxy.address().port}/#decide/beta`)}`);
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === 'Beta question?');
  const cards = () => evaluate('[...document.querySelectorAll(".decide .pick-option")].map((b) => b.querySelector(".label").textContent + (b.querySelector(".recommend") ? "*" : "") + ":" + b.getAttribute("aria-pressed")).join("|")');
  const button = () => evaluate('(() => { const a = document.querySelector(".decide-bar .answer"); return a.textContent + "|" + a.disabled; })()');
  // The answers then Your own answer, as cards side by side in the answer area pinned at the ask's foot (each 160px or wider, radius 16); nothing is picked, Recommended is only a tag, and the button waits, off.
  assert.equal(await cards(), 'A:false|B*:false|C:false|Your own answer:false');
  assert.equal(await evaluate('(() => { const rows = [...document.querySelectorAll(".decide .ppin .pick-list > li")], b = (e) => e.getBoundingClientRect(); return rows.length === 4 && rows.every((li) => li.firstElementChild?.classList.contains("pick-option") && b(li).width >= 160) && getComputedStyle(rows[0].firstElementChild).borderTopLeftRadius === "16px" && b(rows[0]).top === b(rows[1]).top; })()'), true);
  assert.equal(await button(), 'Pick an answer|true');
  // One note, open under the cards with no toggle to find it, and no box for your own answer until you pick it.
  assert.equal(await evaluate('[!!document.querySelector(".decide .note-field .note-box"), !!document.querySelector(".decide details:not(.dl-more)"), document.querySelector(".decide .own-field").getBoundingClientRect().height].join("|")'), 'true|false|0');
  // More, on the ask's head line, holds only Discard, in red: Ask me later is the bar's, beside the answer.
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".split-bar .dl-menu > button")].map((b) => [b.textContent, b.classList.contains("dis")])'), [['Discard', true]]);
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
  await until(async () => (await evaluate('location.hash + "|" + document.querySelector(".split-detail #ask-title")?.textContent')) === '#decide/alpha|Alpha question?');
  await evaluate('(() => { const t = document.querySelector(".decide .note-box"); t.value = "A note that stays behind"; t.dispatchEvent(new Event("input")); })()');
  await evaluate('document.querySelector(".decide .own-option").click()');
  assert.equal(await cards(), 'A*:false|B:false|C:false|Your own answer:true');
  assert.equal(await button(), 'Send answer|true');
  await until(async () => (await evaluate('document.querySelector(".decide .own-field").getBoundingClientRect().height')) > 60);
  assert.equal(await evaluate('[document.activeElement === document.querySelector(".decide .own-box"), getComputedStyle(document.querySelector(".decide .note-field")).display].join("|")'), 'true|none');
  await evaluate('(() => { const t = document.querySelector(".decide .own-box"); t.value = "Ship it Thursday"; t.dispatchEvent(new Event("input")); t.setSelectionRange(5, 13, "backward"); })()');
  assert.equal(await button(), 'Send answer|false');
  await until(() => arrived);
  comment.resolve();
  await until(() => evaluate("state.messages?.some((m) => m.key === 'beta' && m.text === 'Only after the release')"));
  assert.deepEqual(await evaluate(`(() => {
    const box = document.querySelector('.decide .own-box');
    return [document.activeElement === box, box.value, box.selectionStart, box.selectionEnd, box.selectionDirection];
  })()`), [true, 'Ship it Thursday', 5, 13, 'backward']);
  await evaluate('document.querySelector(".decide-bar .answer").click()');
  await until(async () => /alpha,text,/.test(run('answers', file).out));
  assert.equal(JSON.parse(run('answers', file, '--json').out).alpha.note, 'Ship it Thursday');
  close();
  proc.kill();
});

test('Add a comment on every answer: a yes/no on a phone and a pick-one on a desk each send the one note under the cards with the answer picked, Ask me later and Discard are its only other ways, an answer with no note carries none, typing leaves no focus ring, and answers reads it back', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
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
  // The note is one box after the cards, before the bar's buttons (on a desk on the bar's own line), open with no toggle to find it; what is typed goes with the answer picked.
  const comment = async ({ evaluate, insertText }, key, text) => {
    await evaluate(`location.href = ${JSON.stringify(`${url}#decide/${key}`)}`);
    await until(async () => (await evaluate('document.querySelector(".decide .pick-option") && location.hash')) === `#decide/${key}`);
    assert.deepEqual(await evaluate(`(() => { const box = document.querySelector('.decide .note-box'), list = document.querySelector('.decide .pick-list'), bar = document.querySelector('.decide .decide-bar');
      return { shown: box.getClientRects().length > 0, after: !!(list.compareDocumentPosition(box) & 4), before: !!(box.compareDocumentPosition(bar.querySelector('button')) & 4), name: box.getAttribute('aria-label').split(',')[0], placeholder: box.placeholder, toggles: document.querySelectorAll('.decide details:not(.dl-more)').length }; })()`),
      { shown: true, after: true, before: true, name: 'Note', placeholder: 'A note for the agent, optional', toggles: 0 }, key);
    await evaluate('document.querySelector(".decide .note-box").focus()');
    await insertText(text);
    // The page keeps one way to answer, the bar's one button, off until a pick, with Ask me later beside it; More holds Discard.
    assert.deepEqual(await evaluate(`(() => ({ bar: [...document.querySelectorAll('.decide-bar button')].map((b) => b.textContent + (b.disabled ? ' (off)' : '')),
      folded: [...document.querySelectorAll('.sh-head .dl-menu > *, .split-bar .dl-menu > *')].map((b) => b.textContent) }))()`),
      { bar: ['Ask me later', 'Pick an answer (off)'], folded: ['Discard'] }, key);
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

test('Decide on a phone: an ask is a sheet over the list with its bar at the foot, a pick then the button closes it back to the list with the toast, the Answered row opens the answer, which changes (sent as a change the agent reads, with Undo), the toast never covers the sheet’s button, and a row swipes right to answer and left to Later', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
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
  const { evaluate, swipe, send, close } = await browse(join(dir, 'b'), 390, 844);
  await evaluate(`location.href = ${JSON.stringify(`${url}#decide/alpha`)}`);
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === 'Alpha question?');
  await evaluate('document.getElementById("board").getAnimations({ subtree: true }).forEach((a) => a.finish())'); // the sheet has risen
  // The ask is a sheet over the list: its bar keeps to the foot of the screen, and the dock sits dimmed under it.
  assert.equal(await evaluate('document.querySelector(".decide-bar").getBoundingClientRect().bottom <= innerHeight'), true);
  assert.equal(await evaluate('document.querySelector(".decide-bar").getBoundingClientRect().top > innerHeight / 2'), true);
  assert.equal(await evaluate('(() => { const r = document.querySelector(".tabs").getBoundingClientRect(); return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(".ask-over"); })()'), true);
  await evaluate('document.querySelector(".decide .pick-option").click()');
  await evaluate('document.querySelector(".decide-bar .answer").click()');
  // The sheet closes back to the list with the toast; the answer is under Answered, whose row opens it.
  const heads = () => evaluate('[...document.querySelectorAll(".decide-list .ui-sec")].map((h) => h.textContent).join("|")');
  await until(async () => (await evaluate('location.hash + "|" + !!document.querySelector(".ask-sheet")')) === '#waiting|false' && (await evaluate('!document.querySelector("#toast").hidden')) && (await heads()) === 'Asks|Answered1');
  await evaluate('document.querySelector(".g-done .dl-face").click()');
  await until(async () => (await evaluate('location.hash + "|" + document.querySelector(".decide .ans-card b")?.textContent')) === '#decide/alpha|A');
  // There it shows the answer, when and that the agent has not read it, with Change answer as its one button and a More that holds only Reopen this question.
  assert.equal(await evaluate('[document.querySelector(".decide .ans-meta").textContent.split(" · ")[0], document.querySelector(".decide .ui-trail").getAttribute("aria-label").replace(/\\d\\d:\\d\\d/, "hh:mm"), document.querySelector(".decide-bar .answer").textContent, !!document.querySelector(".sh-head .dl-more")].join("|")'), 'Answered|Sent: Sent hh:mm|Change answer|true');
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
  // Close goes back to the list, where the answer reads as changed.
  await evaluate('document.querySelector(".sh-x").click()');
  await until(async () => (await evaluate('location.hash + "|" + document.querySelector(".g-done .meta")?.textContent.split(" · ")[0]')) === '#waiting|Changed to A');
  // From the list, an ask answered closes back to it; once the list is in place the toast sits over the tab bar.
  await evaluate('document.querySelector(".dl-row[data-key=beta] .dl-face").click()');
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === 'Beta question?');
  await until(() => evaluate('!document.getElementById("board").getAnimations({ subtree: true }).length'));
  await evaluate('document.querySelectorAll(".decide .pick-option")[1].click()');
  await evaluate('document.querySelector(".decide-bar .answer").click()');
  await until(async () => (await evaluate('location.hash')) === '#waiting' && /beta,b,/.test(run('answers', file).out) && (await evaluate('!document.querySelector("#toast").hidden')));
  assert.equal(await evaluate('Promise.all(document.querySelector("#toast").getAnimations().map((a) => a.finished)).then(() => document.querySelector("#toast").getBoundingClientRect().bottom <= document.querySelector(".tabs").getBoundingClientRect().top)'), true);
  // On the next question the toast never covers its button.
  await evaluate('location.hash = "#decide/gamma"');
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === 'Gamma question?' && (await evaluate('!document.querySelector("#toast").hidden')));
  await until(() => evaluate('!document.getElementById("board").getAnimations({ subtree: true }).length')); // the sheet has risen
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
  await until(async () => (await heads()) === 'Asks|Later1|Answered2');
  assert.equal(await evaluate('document.querySelector("#toast-text").textContent + "|" + document.querySelector(".ui-hero .big").textContent + " · " + document.querySelector(".ui-hero .vs").textContent + "|" + (document.querySelector(".tabs .bd")?.textContent ?? "none")'), 'Gamma question? · moved to later|0 · 1 for later|none');
  await evaluate('window.old = true, location.reload()');
  await until(async () => (await evaluate('!window.old')) && (await heads()) === 'Asks|Later1|Answered2');
  // A swipe on an answered row does nothing: it is changed on its ask.
  ({ y } = await evaluate('(() => { const r = document.querySelector(".g-done .dl-face").getBoundingClientRect(); return { y: r.top + r.height / 2 }; })()'));
  await swipe({ x: 40, y }, { x: 360, y });
  assert.equal(await evaluate('location.hash + "|" + document.querySelector(".g-done .dl-face").style.transform'), '#waiting|');
  // From Later a swipe left brings it back to Answer.
  ({ y } = await row('gamma'));
  await swipe({ x: 360, y }, { x: 30, y });
  await until(async () => (await heads()) === 'Asks|Answered2');
  // A large phone list keeps its full count and queue without constructing every row.
  const large = Array.from({ length: 60 }, (_, i) => ({ key: `large-${i}`, title: `Umer's question ${i}?`, options: abc, recommend_value: 'a' }));
  writeFileSync(file, JSON.stringify({ schema: 2, items: large }));
  await evaluate('location.reload()');
  await until(async () => (await evaluate('document.querySelector(".decide-list .ui-hero .big")?.textContent')) === '60');
  const rows = () => evaluate('document.querySelectorAll(".decide-list ul[aria-label=Asks] .dl-row").length');
  assert.equal(await rows(), 24);
  await evaluate('document.getElementById("decide-more-now").click()');
  assert.equal(await rows(), 48);
  assert.equal(await evaluate('document.activeElement.id'), 'item-large-35');
  await evaluate('document.getElementById("decide-more-now").click()');
  assert.equal(await rows(), 60);
  assert.equal(await evaluate('!!document.getElementById("decide-more-now")'), false);
  await evaluate('document.querySelector(".decide-list ul[aria-label=Asks] li:last-child a").click()');
  await until(async () => (await evaluate('document.querySelector(".decide h2")?.textContent')) === "Umer's question 0?");
  await evaluate('document.querySelector(".decide .pick-option").click(); document.querySelector(".decide-bar .answer").click()');
  await until(async () => /large-0,a,/.test(run('answers', file).out) && (await evaluate('location.hash === "#waiting" && !document.querySelector(".ask-sheet")')));
  // The selected set still includes asks beyond the first batch; desk J/K still gets every row.
  await evaluate('location.reload()');
  await until(async () => (await evaluate('location.hash + "|" + document.querySelector(".decide-list .ui-hero .big")?.textContent')) === '#waiting|59');
  await evaluate('document.querySelector(".decide-list .t-more-line").click(); document.querySelector("#d-more [data-act=select]").click()');
  await until(() => evaluate('!!document.querySelector(".sel-bar")'));
  await evaluate('document.querySelector(".sel-all").click()');
  assert.equal(await evaluate('document.querySelector(".sel-go").textContent'), 'Discard 59');
  await evaluate('document.querySelector(".sel-cancel").click()');
  const history = Array.from({ length: 90 }, (_, i) => ({ key: `large-${i}`, title: `Umer's question ${i}?`, options: abc, recommend_value: 'a' }));
  writeFileSync(file, JSON.stringify({ schema: 2, items: history }));
  writeFileSync(file.replace('.json', '.answers.jsonl'), history.slice(0, 30).map((d) => JSON.stringify({ key: d.key, answer: 'a', label: 'A', close: 'done', at: new Date().toISOString() })).join('\n') + '\n');
  await evaluate(`(async () => { const s = await (await fetch('/api/decisions')).json(); localStorage.setItem('sign-off-later ' + s.file, JSON.stringify(${JSON.stringify(history.slice(30, 60).map((d) => d.key))})); location.reload(); })()`);
  await until(async () => (await evaluate('document.querySelector(".decide-list .ui-hero .vs")?.textContent')) === '30 for later');
  for (const [group, name] of [['now', 'Asks'], ['later', 'Later'], ['done', 'Answered']]) {
    assert.equal(await evaluate(`document.querySelectorAll('.decide-list ul[aria-label="${name}"] .dl-row').length`), 24);
    await evaluate(`document.getElementById('decide-more-${group}').click()`);
    assert.equal(await evaluate(`document.querySelectorAll('.decide-list ul[aria-label="${name}"] .dl-row').length`), 30);
    assert.equal(await evaluate(`!!document.getElementById('decide-more-${group}')`), false);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await evaluate('location.reload()');
  await until(() => evaluate('!!document.querySelector(".split-list")'));
  assert.equal(await evaluate('document.querySelectorAll(".split-list .dl-row").length'), 90);
  assert.equal(await evaluate('!!document.querySelector(".decide-more")'), false);
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
  const seen = () => evaluate('[location.hash, document.querySelector(".split-list .sel")?.dataset.key, document.querySelector(".split-detail #ask-title")?.textContent, document.activeElement === document.querySelector(".split-list .sel .dl-face")].join("|")');
  const rows = () => evaluate('[...document.querySelectorAll(".split-list .dl-row:not(.leaving, .g-done)")].map((r) => r.dataset.key).join(",")');
  const done = () => evaluate('[...document.querySelectorAll(".split-list .g-done")].map((r) => r.dataset.key).join(",")');
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  // One screen as the prototype's desk: the head across, then the list in four of 12 columns beside the first ask in eight, 16px apart and 24px over the foot.
  await until(async () => (await evaluate('document.querySelector(".split-detail #ask-title")?.textContent')) === 'Alpha question?');
  assert.equal(await evaluate('document.querySelector(".split-list .sel").dataset.key + "|" + (document.scrollingElement.scrollHeight <= innerHeight) + "|" + document.querySelector(".ui-dhead h1").textContent'), 'alpha|true|Decide');
  // The asks' card carries its own head and count inside it, as the prototype's list card: Asks 4, then its rows.
  const asksHead = () => evaluate('(() => { const h = document.querySelector(".split-list .decide-list .ui-sec"); return [h.textContent, h.parentElement.classList.contains("dl-asks"), h.parentElement.querySelectorAll(".dl-row").length].join("|"); })()');
  assert.equal(await asksHead(), 'Asks4|true|4');
  assert.equal(await evaluate('(() => { const l = document.querySelector(".split-list").getBoundingClientRect(), d = document.querySelector(".split-detail").getBoundingClientRect(), s = document.querySelector(".side").getBoundingClientRect(); return s.right <= l.left && Math.abs(d.left - l.right - 16) < 0.5 && Math.abs(innerWidth - 24 - d.right) < 0.5 && Math.abs(innerHeight - 24 - d.bottom) < 0.5 && l.width >= 320; })()'), true);
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
  await until(async () => (await seen()) === '#decide/delta|delta|Delta question?|true' && (await evaluate('[...document.querySelectorAll(".decide-list .ui-sec")].map((h) => h.textContent).join("|")')) === 'Asks3|Later1');
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
  assert.equal(await evaluate('document.getElementById("keys").open + "|" + document.querySelector("#keys h2").textContent + "|" + document.querySelectorAll("#keys li").length'), 'true|Keyboard shortcuts|19');
  await evaluate('document.querySelector("#keys header button").click()');
  await key('g'), await key('e');
  await until(async () => (await evaluate('location.hash + "|" + !!document.querySelector(".split-list") + "|" + document.querySelector(".split-detail")?.textContent')) === '#evidence|true|No evidence updates.Proof an agent files for a change shows here.');
  await key('g'), await key('d');
  await until(async () => (await evaluate('location.hash + "|" + !!document.querySelector(".split")')) === '#waiting|true');
  // A sign-in reads like any ask beside the list: who waits, its headline, what it unlocks and Open as the bar's one button, with its time left only on its row.
  const board = JSON.parse(readFileSync(file, 'utf8')), many = 'abcdef'.split('').map((l) => ({ value: l, label: `Option ${l}`, outcome: `What happens after option ${l}.` }));
  board.items.push({ key: 'npm', title: 'npm', type: 'signin', link: 'https://example.com/login', unlocks: 'Publishing the release', waits: 'Release agent', expires: new Date(Date.now() + 2 * 3600_000).toISOString() },
    { key: 'tall', title: 'Which of six?', options: many, recommend_value: 'a' });
  writeFileSync(file, JSON.stringify(board));
  await evaluate('location.hash = "#decide/npm"; location.reload()');
  await until(async () => (await evaluate('document.querySelector(".split-detail #ask-title")?.textContent')) === 'Sign in to npm');
  assert.equal(await evaluate(`(() => { const p = document.querySelector(".split-detail.decide, .split-detail .decide"), o = p.querySelector(".decide-bar .open-link");
    return [document.querySelector(".split-bar .crumb").textContent, [...p.querySelectorAll(".fact")].map((f) => f.textContent).join(","), o.textContent, o.getAttribute("href"), !!p.querySelector(".row"),
      /Expires|left/.test(p.textContent), /^until \\d\\d:\\d\\d$/.test(document.querySelector('.dl-row[data-key="npm"] [data-left]').textContent), !!document.querySelector(".split-bar .dl-more")].join("|"); })()`),
  `Sign in · Release agent|UnlocksPublishing the release,Expires${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(board.items.find((i) => i.key === 'npm').expires))},Whereexample.com|Open sign-in|https://example.com/login|false|true|true|true`);
  // An ask with six answers: they stay pinned in view at the pane's foot, its bar after the last one, never over it.
  await evaluate('location.hash = "#decide/tall"');
  await until(async () => (await evaluate('document.querySelectorAll(".split-detail .pick-option:not(.own-option)").length')) === 6);
  // Measured once the ask has slid in (a new ask beside the list rises 16px over 260ms).
  const measurePin = async () => JSON.parse(await evaluate(`(() => { const p = document.querySelector(".ask2 .ppin").getBoundingClientRect(), pane = document.querySelector(".ask2").getBoundingClientRect(), bar = document.querySelector(".ask2 .decide-bar").getBoundingClientRect(),
    last = [...document.querySelectorAll(".ask2 .pick-option")].at(-1).getBoundingClientRect(); return JSON.stringify({ inPane: p.top >= pane.top && Math.abs(p.bottom - pane.bottom) < 0.5, inView: pane.bottom <= innerHeight + 0.5, barAfter: bar.top >= last.bottom, barIn: bar.bottom <= p.bottom + 0.5, p: [p.top, p.bottom], pane: [pane.top, pane.bottom], innerHeight }); })()`));
  let pinned;
  await until(async () => (pinned = await measurePin()).inPane).catch(() => {});
  assert.ok(pinned.inPane && pinned.inView && pinned.barAfter && pinned.barIn, JSON.stringify(pinned));
  close();
  // Under 1024px the board keeps the phone's layout: the tab bar, and an ask as a sheet over the list.
  const narrow = await browse(join(dir, 'n'), 1000, 800);
  await narrow.evaluate(`location.href = ${JSON.stringify(`${url}#decide/gamma`)}`);
  await until(async () => (await narrow.evaluate('document.querySelector(".decide h2")?.textContent')) === 'Gamma question?');
  assert.equal(await narrow.evaluate('!!document.querySelector(".split") + "|" + getComputedStyle(document.querySelector(".tabs")).display + "|" + getComputedStyle(document.querySelector(".side")).display + "|" + !!document.querySelector(".ask-sheet .decide")'), 'false|flex|none|true');
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
  const seen = () => evaluate('[location.hash, document.querySelector(".split-list .sel")?.dataset.key, document.querySelector(".split-detail .read h1")?.textContent, [...document.querySelectorAll("#board .report .pct")].filter((m) => m.textContent === "0%").length].join("|")');
  const rows = () => evaluate('[...document.querySelectorAll(".split-list .dl-row[data-key]")].filter((r) => r.style.height !== "0px").map((r) => r.dataset.key).join(",")');
  await evaluate(`location.href = ${JSON.stringify(`${url}#reports`)}`);
  // The newest report is shown beside the list, not yet marked read; its head line says what it is and the day, beside Mark read and Archive.
  await until(async () => (await seen()) === `#reports|alpha|Alpha report|4`);
  // The bar names the report's kind (an older report's, other), then its day.
  assert.match(await evaluate('[document.querySelector(".rp-bar .rkc").textContent, document.querySelector(".rp-bar > span[dir]").textContent].join("|")'), /^Other report\|\d{1,2} [A-Z][a-z]{2}$/);
  assert.equal(await evaluate('[...document.querySelectorAll(".rp-bar > button")].map((b) => b.textContent).join(",") + "|" + !!document.querySelector(".split-detail .read iframe")'), 'Mark read,Archive|true');
  assert.equal(await rows(), `alpha,beta,${guided.key},gamma`);
  assert.equal(reads(), '');
  // J selects the next report and reads it: its progress track disappears and the read is saved beside the board.
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

test('report kinds and their workflows: post names what a report is for and holds it to its kind\'s parts, report init writes them, each row leads with its kind (an older report\'s other, a plan\'s bar its parts), Filter by kind lists only that kind under its pill, a report\'s head names its kind over a line on what it is for, its parts strip and the next one, and research shows its sources, on a phone and a desk', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'report-kinds'), file = join(dir, 'board.json');
  mkdirSync(join(dir, 'diagrams'), { recursive: true });
  writeFileSync(join(dir, 'diagrams', 'flow.html'), readFileSync(new URL('../.agents/skills/done-done-verify-sign-off/diagram-sample/flow.html', import.meta.url)));
  const at = (m) => new Date(Date.now() - m * 60e3).toISOString().replace(/\.\d+Z$/, 'Z'), base = JSON.parse(readFileSync(new URL('../fixtures/contract/report.v5/valid-full.json', import.meta.url), 'utf8'));
  const post = (name, m) => { writeFileSync(join(dir, `${name}.json`), JSON.stringify(m)); return run('post', file, '--kind', 'report', '--from', join(dir, `${name}.json`)); };
  // A report 5 must say what it is for, one of the seven kinds, and have each part of its kind; nothing is written when it does not.
  const { purpose, ...none } = { ...base, key: 'no-kind', filed: at(9) };
  for (const [m, rule] of [[none, /purpose is required[^]*research, plan, decision, audit, incident, status, other/], [{ ...none, purpose: 'Research' }, /purpose \\?"Research\\?" is not one of research, plan/],
    [{ ...base, key: 'no-plan', purpose: 'plan', sections: base.sections.map(({ part, ...x }) => x) }, /sections has no \\?"goal\\?" part \(Goal and non-goals\): a plan report needs goal, current, design, slices, tests, risks, rollout, estimate, owner-calls[^]*report init <new folder> --purpose plan/]]) {
    const r = post('bad', m);
    assert.equal(r.code, 2, r.out); assert.match(r.out, rule);
  }
  assert.ok(!existsSync(file) || !/no-kind|no-plan/.test(readFileSync(file, 'utf8')));
  // report init --purpose writes the kind's parts to fill, each a section naming its part; posted as it is, it is refused for its FILL lines.
  assert.equal(run('report', 'init', join(dir, 'tmpl'), '--purpose', 'plan').code, 0);
  const tmpl = JSON.parse(readFileSync(join(dir, 'tmpl', 'report.json'), 'utf8'));
  assert.deepEqual([tmpl.schema, tmpl.purpose, tmpl.sections.map((x) => x.part).join(',')], [5, 'plan', 'goal,current,design,slices,tests,risks,rollout,estimate,owner-calls']);
  assert.match(run('post', file, '--kind', 'report', '--from', join(dir, 'tmpl', 'report.json')).out, /still has FILL: lines/);
  // A full plan: every part, the design with its diagram, each slice sized, each tested.
  const sec = (part, heading, more = {}) => ({ id: part, part, stage: 'found', heading, body: `${heading}, in a line.`, ...more });
  const plan = { ...base, key: 'k-plan', purpose: 'plan', title: 'Move settings into the profile page', filed: at(1), sections: [sec('goal', 'Goal and non-goals'), sec('current', 'How it works today'),
    sec('design', 'Design', { diagram: [{ label: 'Flow', src: 'diagrams/flow.html' }] }), sec('slices', 'Slices', { items: [{ title: 'Move the page', text: 'Settings open from the profile.', size: 'S, half a day' }] }),
    sec('tests', 'Tests and proof', { items: [{ title: 'Move the page', text: 'A browser test opens it from the profile.' }] }), sec('risks', 'Risks and rollback'), sec('rollout', 'Rollout'), sec('estimate', 'Time'), sec('owner-calls', 'Your calls')] };
  writeFileSync(join(dir, 'muxr.svg'), readFileSync(new URL('../docs/logo.svg', import.meta.url)));
  assert.equal(run('project', file, '--name', 'Muxr', '--icon', 'muxr.svg').code, 0);
  assert.equal(run('ticket', file, '--id', 'T-29', '--title', 'Move settings', '--project', 'Muxr').code, 0);
  plan.group = plan.project = 'Muxr'; plan.ticket = 'T-29';
  assert.equal(post('plan', plan).code, 0);
  assert.equal(post('research', { ...base, key: 'k-research', filed: at(2) }).code, 0);
  assert.equal(post('retro', { ...JSON.parse(readFileSync(new URL('../fixtures/contract/report.v4/valid-full.json', import.meta.url), 'utf8')), key: 'k-retro', purpose: 'incident', title: 'Why messages were sent twice: a retro', filed: at(3) }).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  for (const part of ['goal', 'current', 'design']) await fetch(`${url}api/reads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'k-plan', part }) });
  assert.equal((await fetch(url + 'api/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'comment', key: 'k-plan', text: 'Umer: keep its ticket visible.' }) })).status, 200);
  const { evaluate, close } = await browse(join(dir, 'b'), 390, 844, true);
  const rows = () => evaluate('[...document.querySelectorAll(".rp-list .ui-row")].map((r) => [r.querySelector(".t").textContent, r.querySelector(".l2 .rkc")?.textContent, r.querySelector(".rp-progress .rp-strip") ? [...r.querySelectorAll(".rp-strip > i")].map((i) => +i.classList.contains("on")).join("") : "bar", r.querySelector(".pct").textContent].join(" ")).join("|")');
  await evaluate(`location.href = ${JSON.stringify(`${url}#reports`)}`);
  // Each row leads its second line with its kind; the plan's bar is its nine parts, three read; the older report's kind is other.
  await until(async () => (await rows()) === `Move settings into the profile page Plan 111000000 33%|${base.title} Research bar 0%|Why messages were sent twice: a retro Incident bar 0%`);
  assert.equal(await evaluate('document.querySelector("#item-k-retro .rkc").textContent'), 'Incident');
  assert.ok(await evaluate('(() => { const r = document.querySelector("#item-k-retro"); return r.querySelector(".rp-progress").getBoundingClientRect().top - r.querySelector(".rp-meta").getBoundingClientRect().bottom >= 6; })()'), "unread progress leaves six pixels below the kind and ticket");
  assert.equal(await evaluate('document.querySelector("#item-k-plan .rp-ticket").textContent'), 'T-29');
  assert.equal(await evaluate('!!document.querySelector("#item-k-plan .l1 .ui-tb") && !!document.querySelector("#item-k-plan .l2 .rkc")'), true);
  // The row's picture is requested once the row is drawn, so it is waited for like every other picture here; it must still load, with a width, or the test times out.
  await until(() => evaluate('document.querySelector("#item-k-plan .ui-icon img")?.naturalWidth > 0'));
  assert.equal(await evaluate('!!document.querySelector("#item-k-research .rp-ticket")'), false);
  // Filter by kind lists each kind with its count; a kind picked leaves only its reports under its pill, and the pill's close lists them all again.
  await evaluate('document.querySelector(".rp-fb").click()');
  await until(async () => (await evaluate('[...document.querySelectorAll("#sheet[open] .rp-pick .ui-pr")].map((b) => b.dataset.kind + " " + b.querySelector(".n").textContent).join(",")')) === 'all 3,research 1,plan 1,incident 1');
  await evaluate('document.querySelector("#sheet .rp-pick [data-kind=\\"incident\\"]").click()');
  await until(async () => (await rows()) === 'Why messages were sent twice: a retro Incident bar 0%' && (await evaluate('document.querySelector(".rp-pill").textContent + "|" + document.querySelector(".rp-fb b").textContent + "|" + !document.querySelector(".rp-hero")')) === 'Incident and retro1 of 3|1|true');
  await evaluate('document.querySelector(".rp-pill .ev-unpick").click()');
  await until(async () => (await rows()).split('|').length === 3 && !(await evaluate('!!document.querySelector(".rp-pill, .rp-fb b")')));
  // A report's sheet heads with its kind's full name, then a line on what it is for, and over its kind's parts a strip of them with the next one to read.
  await evaluate('document.querySelector("#item-k-plan").click()');
  await until(async () => (await evaluate('[".rp-what .rkc", ".rp-for", ".rp-next"].map((s) => document.querySelector("#reader " + s)?.textContent).join("|") + "|" + [...document.querySelectorAll("#reader .rp-strip-row .rp-strip > i")].map((i) => +i.classList.contains("on")).join("") + "|" + document.querySelectorAll("#reader .rp-part").length'))
    === 'Implementation plan|How the work gets built, step by step, before it starts.|Next: Slices|111000000|9');
  await evaluate(`location.href = ${JSON.stringify(`${url}#reports`)}`);
  await until(() => evaluate('!!document.querySelector("#item-k-plan") && !document.querySelector("#item-k-plan .rp-progress")'));
  await evaluate('document.querySelector("#item-k-retro").click()');
  await until(async () => (await evaluate('document.querySelector("#reader .rkc")?.textContent')) === 'Incident and retro');
  // Research shows its sources, how many link out and how many are what users report; a tap opens the report at its sources, each with its tag and link.
  await evaluate(`location.href = ${JSON.stringify(`${url}#reports`)}`);
  await until(() => evaluate('!!document.querySelector("#item-k-research")'));
  await evaluate('document.querySelector("#item-k-research").click()');
  await until(async () => (await evaluate('[...document.querySelectorAll("#reader .rp-src")].map((b) => b.textContent).join("|")')) === 'Linked sources3|What users report1');
  await evaluate('document.querySelector("#reader .rp-src").click()');
  await until(async () => (await evaluate('[...document.querySelectorAll("#gd-sources .gd-tag")].map((t) => t.textContent).join(",") + "|" + [...document.querySelectorAll("#gd-sources .gd-src")].map((a) => a.textContent + " " + a.target).join(",")'))
    === 'Primary source,Primary source,User report|Open on docs.ntfy.sh _blank,Open on pushover.net _blank,Open on github.com _blank');
  close();
  // On a desk the bar names the kind, the line on what it is for sits under the title, and beside the report the strip, the next part and its kind's parts each with its check.
  const desk = await browse(join(dir, 'd'), 1280, 800);
  await desk.evaluate(`location.href = ${JSON.stringify(`${url}#reports`)}`);
  await until(() => desk.evaluate('!!document.querySelector(".split-list #item-k-plan")'));
  await desk.evaluate('document.querySelector(".split-list #item-k-plan").click()');
  await until(async () => (await desk.evaluate('document.querySelector(".rp-bar .rkc")?.textContent + "|" + document.querySelector(".split-detail .rp-for")?.textContent + "|" + [...document.querySelectorAll(".split-detail .rp-strip-row .rp-strip > i")].map((i) => +i.classList.contains("on")).join("") + "|" + document.querySelector(".split-detail .rp-next")?.textContent + "|" + document.querySelectorAll(".split-detail .rp-part").length'))
    === 'Implementation plan|How the work gets built, step by step, before it starts.|111000000|Next: Slices|9');
  // An icon removed after pinning falls back to the shared project outline, never initials or a broken image.
  rmSync(join(dir, 'muxr.svg'));
  desk.close();
  const missingIcon = await browse(join(dir, 'missing-icon'), 1280, 800);
  await missingIcon.evaluate(`location.href = ${JSON.stringify(`${url}#reports`)}`);
  await until(() => missingIcon.evaluate('!!document.querySelector("#item-k-plan .ui-icon svg") && !document.querySelector("#item-k-plan .ui-icon img, #item-k-plan .mono")'));
  missingIcon.close();
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
  await until(async () => (await evaluate('location.hash')) === '#waiting' && /look,a,/.test(run('answers', file).out));
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

test('Open full screen: a design pick\'s prototype over the whole screen takes real taps on its own links (Desktop on a phone too, at its own size or fitted to the width), loads the files beside it, switches option and size, shows the other option over it on a phone and beside it on a desk, and Close goes back; an interactive page has no Reference; while pointing, a tap on a mock does not open it', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'full'), file = join(dir, 'board.json'), a = join(dir, 'mocks', 'fleet', 'a'), b = join(dir, 'mocks', 'fleet', 'b');
  mkdirSync(a, { recursive: true }); mkdirSync(b, { recursive: true });
  // Each page is one link that fills its frame, to the other page beside it, and says which page it is and the colour its stylesheet gave it.
  const page = (to) => `<link rel="stylesheet" href="style.css"><a href="${to}" style="display: block; height: 100vh">Go</a><script>parent.postMessage({ at: location.pathname.split('/').pop(), color: getComputedStyle(document.body).color }, '*')</script>`;
  writeFileSync(join(a, 'index.html'), page('lanes.html'));
  writeFileSync(join(a, 'lanes.html'), page('index.html'));
  writeFileSync(join(a, 'style.css'), 'body { margin: 0; color: rgb(1, 2, 3) }');
  // B has one small button near the far corner of a desk's 1280 by 800, which says when it is clicked.
  writeFileSync(join(b, 'index.html'), '<p>B</p><button style="position: fixed; left: 1100px; top: 700px; width: 80px; height: 40px" onclick="parent.postMessage({ corner: true }, \'*\')">Corner</button>');
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
  // The viewport a frame gives its page, then its box on the screen and the stage's: a device's own size, scaled down to fit the stage.
  const viewport = (n = 0) => `[getComputedStyle(${port(n)}.firstChild).width, getComputedStyle(${port(n)}.firstChild).height]`;
  const fits = (n = 0) => `(({ width, height }, s) => width <= s.width + 0.5 && height <= s.height + 0.5)(${port(n)}.getBoundingClientRect(), ${full}.querySelector('.pf-stage').getBoundingClientRect())`;
  {
    const { evaluate, tap, click, close } = await browse(join(dir, 'phone'), 390, 844, true);
    await evaluate(`location.href = ${JSON.stringify(`${url}#decide/fleet`)}`);
    await until(() => evaluate("!!document.querySelector('.decide .full-open')"));
    assert.equal(await evaluate("document.querySelector('.decide .full-open').textContent"), 'Open full screen');
    await evaluate("window.got = [], addEventListener('message', (e) => e.data?.at && got.push({ ...e.data, full: e.source === document.querySelector('.proto-full iframe')?.contentWindow }))");
    // The ask rises as a sheet: it is landed (a page in a background tab does not run its animations), with the button in view.
    await evaluate("document.getElementById('board').getAnimations({ subtree: true }).forEach((a) => a.finish())");
    await evaluate("document.querySelector('.decide .full-open').scrollIntoView({ block: 'center' })");
    await tap(await evaluate(centre("document.querySelector('.decide .full-open')")));
    await until(() => evaluate(`${pages}.includes('index.html')`));
    // The whole screen, the recommended option first, at phone size, its live link in the bar, and the files beside the page loaded.
    assert.deepEqual(await evaluate(box(full)), [0, 0, 390, 844]);
    // Open live in the bar is the option's own prototype, not its reference link.
    assert.deepEqual(await evaluate(`[${full}.querySelector('.pf-pick').value, ${full}.querySelector('.pf-size [aria-pressed=true]').dataset.size, ${full}.querySelector('.pf-ref').getAttribute('aria-pressed'), ${full}.querySelector('.pf-live').href.endsWith('fleet~a/index.html')]`),
      ['a', 'phone', 'false', true]);
    // Phone is a phone's own 390 by 844, scaled down to the stage under the bar.
    assert.deepEqual(await evaluate(viewport()), ['390px', '844px']);
    assert.equal(await evaluate(fits()), true);
    assert.equal(await evaluate("got.find((m) => m.full).color"), 'rgb(1, 2, 3)');
    // A real click on the prototype's own link goes to the page beside it: the board takes none of the prototype's input.
    // (Headless Chrome puts the sandboxed frame in a process of its own and misplaces the click it makes from an emulated tap there; a phone keeps the frame in-process, and a mouse click lands.)
    await click(await evaluate(centre(port())));
    await until(() => evaluate(`${pages}.includes('lanes.html')`));
    // Desktop on a phone draws the same page a desk's own 1280 wide at its own size, as tall as the stage, without loading it again, and the stage scrolls sideways:
    // never a strip a third of its size. A tap there still reaches the prototype's link.
    await tap(await evaluate(centre(`${full}.querySelector('[data-size=desktop]')`)));
    await until(async () => (await evaluate(`getComputedStyle(${port()}.firstChild).width`)) === '1280px');
    const stage = `${full}.querySelector('.pf-stage')`, tall = await evaluate(`${stage}.getBoundingClientRect().height`);
    assert.ok(Math.abs(parseFloat((await evaluate(viewport()))[1]) - tall) < 1, 'the desk page is as tall as the stage');
    assert.deepEqual(await evaluate(`[${box(port())}.slice(2), +${port()}.style.getPropertyValue('--s'), ${stage}.scrollWidth > ${stage}.clientWidth, ${full}.querySelector('.pf-fit').hidden, ${pages}.length]`),
      [[1280, Math.round(tall)], 1, true, false, 2]);
    await click(await evaluate(centre(stage)));
    await until(() => evaluate(`${pages}.length === 3 && ${pages}.at(-1) === 'index.html'`));
    // Fit takes it to the screen's width and the stage's whole height, and the stage no longer scrolls.
    await tap(await evaluate(centre(`${full}.querySelector('.pf-fit')`)));
    await until(() => evaluate(`${full}.querySelector('.pf-fit').getAttribute('aria-pressed') === 'true'`));
    assert.deepEqual(await evaluate(`[${box(port())}.slice(2), ${stage}.scrollWidth > ${stage}.clientWidth, getComputedStyle(${port()}.firstChild).width]`), [[390, Math.round(tall)], false, '1280px']);
    assert.ok(Math.abs((await evaluate(`+${port()}.style.getPropertyValue('--s')`)) - 390 / 1280) < 0.001);
    // Reference on a phone covers the prototype with the other option, labelled; off again, the prototype is as it was.
    await tap(await evaluate(centre(`${full}.querySelector('.pf-ref')`)));
    await until(() => evaluate(`${full}.querySelector('.pf-stage').dataset.mode === 'over'`));
    assert.deepEqual(await evaluate(`[${full}.querySelector('.pf-back figcaption').textContent, ${full}.querySelector('.pf-back iframe').title, ${box(port(1))}.join() === ${box(port(0))}.join()]`), ['ReferenceB: Cards', 'Reference: B: Cards', true]);
    await tap(await evaluate(centre(`${full}.querySelector('.pf-ref')`)));
    await until(() => evaluate(`${full}.querySelector('.pf-stage').dataset.mode === 'one' && ${full}.querySelector('.pf-back').hidden`));
    // Another option replaces the page shown, and Open live follows it to that option's own prototype.
    await evaluate(`(s => { s.value = 'b'; s.dispatchEvent(new Event('change')); })(${full}.querySelector('.pf-pick'))`);
    assert.deepEqual(await evaluate(`[${full}.querySelector('.pf-main iframe').title, ${full}.querySelector('.pf-live').href.endsWith('fleet~b/index.html')]`), ['Prototype: B: Cards', true]);
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
    assert.deepEqual(await evaluate(`[${full}.querySelector('.pf-size [aria-pressed=true]').dataset.size, ...${viewport()}, ${fits()}, ${full}.querySelector('.pf-fit').hidden]`), ['desktop', '1280px', '800px', true, true]);
    // A real click lands where the scaled page draws a control: B's small corner button, at its place times the scale.
    await evaluate(`window.corner = 0, addEventListener('message', (e) => e.data?.corner && corner++), (s => { s.value = 'b'; s.dispatchEvent(new Event('change')); })(${full}.querySelector('.pf-pick'))`);
    const corner = await evaluate(`(({ left, top }, s) => s < 1 && [left + 1140 * s, top + 720 * s])(${port()}.getBoundingClientRect(), +${port()}.style.getPropertyValue('--s'))`);
    assert.ok(corner, 'the desk frame is scaled');
    await until(async () => { await click(corner); return evaluate('corner > 0'); });
    await click(await evaluate(centre(`${full}.querySelector('[data-size=phone]')`)));
    await click(await evaluate(centre(`${full}.querySelector('.pf-ref')`)));
    await until(() => evaluate(`${full}.querySelector('.pf-stage').dataset.mode === 'beside'`));
    const [one, two] = [await evaluate(box(port(0))), await evaluate(box(port(1)))];
    assert.deepEqual([...await evaluate(viewport(0)), ...await evaluate(viewport(1)), await evaluate(fits(0)), await evaluate(fits(1))], ['390px', '844px', '390px', '844px', true, true]);
    assert.deepEqual([one[2] === two[2], one[1] === two[1]], [true, true]);
    assert.ok(Math.abs(one[0] + (two[0] + two[2]) - 1280) <= 2, `${one} ${two} centred`);
    assert.ok(two[0] >= one[0] + one[2], 'side by side');
    await evaluate(`${full}.querySelector('.pf-close').click()`);
    await evaluate(`location.href = ${JSON.stringify(`${url}#decide/tour`)}`);
    await until(() => evaluate("document.querySelector('.decide h2')?.textContent === 'Does the tour feel right?' && !!document.querySelector('.decide .full-open')"));
    await click(await evaluate(centre("document.querySelector('.decide .full-open')")));
    await until(() => evaluate(`!!${full}?.querySelector('iframe[title=\"Prototype: Does the tour feel right?\"]')`));
    // An interactive page's Open live is its own page, so the bar never hides it.
    assert.deepEqual(await evaluate(`[!!${full}.querySelector('.pf-ref'), !!${full}.querySelector('.pf-pick'), ${full}.querySelector('.pf-live').hidden, ${full}.querySelector('.pf-live').href.endsWith('tour.html'), ${full}.querySelector('iframe').getAttribute('sandbox')]`), [false, false, false, true, 'allow-scripts']);
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

test('Designs phone rows paint real image and page thumbnails, never blank boxes', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'design-phone-paint'), file = join(dir, 'board.json');
  mkdirSync(dir);
  writeFileSync(join(dir, 'picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><path fill="#cf291e" d="M0 0h390v844H0z"/></svg>');
  writeFileSync(join(dir, 'page.html'), '<!doctype html><style>html,body{margin:0;min-height:100%;background:#cf291e}</style><h1>Actual preview</h1>');
  const keys = ['fd-wrapper-design', 'inbox-design', 'animation-design'];
  const items = keys.map((key, i) => ({ key, type: 'design', title: `Which layout should screen ${i + 1} use?`, filer: key,
    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], recommend_value: 'a',
    mocks: [{ value: 'a', path: i ? 'page.html' : 'picture.svg' }, { value: 'b', path: 'page.html' }] }));
  writeFileSync(file, JSON.stringify({ schema: 2, items }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, capture, close } = await browse(join(dir, 'browser'), 390, 844, true);
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs`)}`);
  await until(async () => await evaluate('document.querySelectorAll(".dz-list > li").length === 3'));
  // Sample the real compositor output: a white/empty frame, a zero-size frame or a project icon cannot satisfy this check.
  for (const key of keys) {
    const painted = async () => {
      const box = await evaluate(`(() => { const e = document.querySelector('#item-${key} .pk-thumb'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
      if (!box || box.width < 30 || box.height < 30) return false;
      const image = await capture(box);
      let red = 0;
      for (let i = 0; i < image.data.length; i += 4) if (image.data[i] > 130 && image.data[i] > image.data[i + 1] * 2 && image.data[i] > image.data[i + 2] * 2) red++;
      return red > image.width * image.height / 2;
    };
    await until(painted);
  }
  close();
  proc.kill();
});

test('opened design headers show a plain title, never a raw filer id, on phone and desktop', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'design-plain-header'), file = join(dir, 'board.json');
  mkdirSync(dir);
  const key = 'fd-wrapper-design', title = 'Which look should the app wrapper get?';
  writeFileSync(file, JSON.stringify({ schema: 2, items: [{ key, type: 'design', title, filer: key,
    options: [{ value: 'a', label: 'Studio' }, { value: 'b', label: 'Focus' }], recommend_value: 'a' }] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  for (const width of [390, 1280]) {
    const { evaluate, close } = await browse(join(dir, `browser-${width}`), width, 844, width === 390);
    await evaluate(`location.href = ${JSON.stringify(`${url}#decide/${key}`)}`);
    await until(async () => await evaluate('!!document.querySelector(".ask-sheet .sh-lab, .split-detail .crumb")'));
    const headers = await evaluate('[...document.querySelectorAll("header, .crumb")].filter(e => e.getBoundingClientRect().height).map(e => e.textContent).join("|")');
    assert.ok(!headers.includes(key), `screen header exposes raw id ${key}: ${headers}`);
    assert.ok(headers.includes(title), 'opened design header names the design in plain words');
    close();
  }
  proc.kill();
});

test('a design pick\'s option previews and their Recommended pill are never clipped by the preview\'s edges at 1280: two fit whole, four scroll from the first option', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'design-preview-edges'), file = join(dir, 'board.json');
  mkdirSync(join(dir, 'mocks', 'layout-pick'), { recursive: true });
  // The option row is a scroller inside the preview's inset: it starts at the inset's own left edge whatever it holds.
  const options = [['warm', 'Studio (warm, brief column left)'], ['focus', 'Focus (big canvas, bottom composer)'],
    ['ledger', 'Ledger (dense, tables first)'], ['quiet', 'Quiet (one column, no rail)']];
  for (const [value, label] of options) writeFileSync(join(dir, 'mocks', 'layout-pick', `${value}.html`), `<!doctype html><title>${value}</title><p>${label}</p>`);
  const pick = (key, n) => ({ key, type: 'design', title: `Which studio layout should screen ${n} use?`, filed: new Date().toISOString(),
    options: options.slice(0, n).map(([value, label]) => ({ value, label })), recommend_value: 'warm',
    mocks: options.slice(0, n).map(([value]) => ({ value, path: `mocks/layout-pick/${value}.html` })) });
  writeFileSync(file, JSON.stringify({ schema: 2, items: [pick('pick-two', 2), pick('pick-four', 4)] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'browser'), 1280, 800);
  // The inset, the row, and every option's frame, label and Recommended tag against the inset's own two edges.
  const measure = `(() => { const r2 = (n) => Math.round(n * 10) / 10, box = (e) => e.getBoundingClientRect(),
    inset = document.querySelector('.decide-preview'), row = inset.querySelector('.mocks'),
    pad = (e) => ({ left: box(e).left + parseFloat(getComputedStyle(e).paddingLeft), right: box(e).right - parseFloat(getComputedStyle(e).paddingRight) });
    const cards = [...row.querySelectorAll('.mock')].map((f) => { const label = f.querySelector('.label'), badge = f.querySelector('.badge'),
      at = (e) => e && { left: r2(box(e).left), right: r2(box(e).right), cut: e.scrollWidth > e.clientWidth + 1 };
      return { left: r2(box(f).left), right: r2(box(f).right), label: at(label), badge: at(badge), words: badge?.textContent ?? '' }; });
    return { inset: { left: r2(box(inset).left), right: r2(box(inset).right), content: pad(inset) }, row: { left: r2(box(row).left), right: r2(box(row).right), ...pad(row),
      scrollWidth: row.scrollWidth, clientWidth: row.clientWidth, scrollLeft: row.scrollLeft }, cards }; })()`;
  try {
    const seen = {};
    for (const [key, count] of [['pick-two', 2], ['pick-four', 4]]) {
      await evaluate(`location.href = ${JSON.stringify(`${url}#decide/${key}`)}`);
      await until(async () => (await evaluate(`document.querySelectorAll('.decide-preview .mocks .mock').length`)) === count);
      const m = await evaluate(measure);
      seen[key] = m;
      // The row begins at the inset's own left edge: centred at its own min-content, a wide row ran past both edges and its first label and tag were cut off.
      // The row keeps 4px of its own for focus rings, so its first option starts on the inset's left edge within that.
      assert.ok(Math.abs(m.cards[0].left - m.inset.content.left) <= 4.5, `${key}: the first option starts at ${m.cards[0].left}, not the inset's left edge ${m.inset.content.left}: ${JSON.stringify(m)}`);
      assert.ok(m.row.left >= m.inset.left - 0.5 && m.row.right <= m.inset.right + 0.5, `${key}: the option row is not inside the inset: ${JSON.stringify(m.row)}`);
      for (const [i, card] of m.cards.entries()) {
        // Every option is reachable from the first, and no label or tag is cut by the row's own edge.
        assert.ok(card.left >= m.row.left - 0.5, `${key}: option ${i} starts at ${card.left}, left of the row's edge ${m.row.left}`);
        if (card.right <= m.row.right + 0.5) assert.ok(card.label.left >= m.row.left - 0.5 && card.label.right <= m.row.right + 0.5, `${key}: option ${i} label is cut by the row's edges: ${JSON.stringify(card)}`);
        if (card.badge) {
          assert.equal(card.words, 'Recommended');
          assert.equal(card.badge.cut, false, `${key}: the Recommended tag cuts its own words: ${JSON.stringify(card)}`);
          assert.ok(card.badge.left >= m.row.left - 0.5 && card.badge.right <= Math.min(m.row.right + 0.5, card.right + 0.5), `${key}: the Recommended tag is cut by the edges: ${JSON.stringify(card)}`);
        }
      }
    }
    // Two options fit whole at 1280: no scrolling, and both are inside the inset's box.
    const two = seen['pick-two'];
    assert.equal(two.row.scrollWidth <= two.row.clientWidth + 1, true, `two options do not fit: ${JSON.stringify(two.row)}`);
    assert.equal(two.cards.length, 2);
    assert.equal(two.cards.every((c) => c.left >= two.row.left - 0.5 && c.right <= two.row.right + 0.5), true, `both previews sit whole inside the row: ${JSON.stringify(two.cards)}`);
    const tags = two.cards.filter((c) => c.badge);
    assert.deepEqual(tags.map((c) => c.words), ['Recommended'], 'only the recommended option carries the tag');
    assert.equal(tags.every((c) => c.badge.left >= two.row.left - 0.5 && c.badge.right <= Math.min(two.row.right, c.right) + 0.5), true, `the Recommended tag sits whole inside the row: ${JSON.stringify(tags)}`);
    // Four do not fit at 1280, so the row scrolls and its last option can be reached from the first.
    const four = seen['pick-four'];
    assert.equal(four.row.scrollWidth > four.row.clientWidth + 1, true, `four options neither fit nor scroll: ${JSON.stringify(four.row)}`);
    assert.equal(four.row.scrollLeft, 0, 'the row starts at its first option');
    const last = four.cards.at(-1);
    assert.equal(last.right > four.row.right, true, 'the last option starts out past the row, so the row has somewhere to scroll');
    await evaluate(`(() => { const row = document.querySelector('.decide-preview .mocks'); row.scrollLeft = row.scrollWidth; return row.scrollLeft; })()`);
    await until(async () => (await evaluate(`(() => { const row = document.querySelector('.decide-preview .mocks'); return row.scrollLeft > 0 && row.scrollLeft >= row.scrollWidth - row.clientWidth - 1; })()`)));
    const reached = await evaluate(`(() => { const row = document.querySelector('.decide-preview .mocks'), f = [...row.querySelectorAll('.mock')].at(-1), b = f.getBoundingClientRect(), l = f.querySelector('.label').getBoundingClientRect();
      return { card: [b.left, b.right], label: [l.left, l.right], row: [row.getBoundingClientRect().left, row.getBoundingClientRect().right] }; })()`);
    assert.ok(reached.card[0] >= reached.row[0] - 0.5 && reached.card[1] <= reached.row[1] + 0.5, `the last option is reachable at the row's end: ${JSON.stringify(reached)}`);
  } finally {
    await close();
    proc.kill();
  }
});

test('the phone\'s Designs layout keeps its count on its rows, its real thumbnails and a plain title on an opened pick, and its option row inside the sheet', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'design-phone-intact'), file = join(dir, 'board.json');
  mkdirSync(join(dir, 'mocks', 'phone-pick'), { recursive: true });
  writeFileSync(join(dir, 'mocks', 'phone-pick', 'warm.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><path fill="#cf291e" d="M0 0h390v844H0z"/></svg>');
  const pick = (key, title) => ({ key, type: 'design', title, filed: new Date().toISOString(), filer: key,
    options: [{ value: 'warm', label: 'Studio (warm, brief column left)' }, { value: 'focus', label: 'Focus (big canvas, bottom composer)' }], recommend_value: 'warm',
    mocks: [{ value: 'warm', path: 'mocks/phone-pick/warm.svg' }, { value: 'focus', path: 'mocks/phone-pick/warm.svg' }] });
  writeFileSync(file, JSON.stringify({ schema: 2, items: [pick('studio-pick', 'Which studio layout should the brief use?'), pick('canvas-pick', 'Which canvas should the editor open?')] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'browser'), 390, 844, true);
  try {
    await evaluate(`location.href = ${JSON.stringify(`${url}#designs`)}`);
    await until(async () => await evaluate('document.querySelectorAll(".dz-list > li").length === 2'));
    // The Designs label counts the rows the list draws, and every row's thumbnail is a decoded picture, never a blank tile.
    const list = await evaluate(`(async () => { const rows = document.querySelectorAll('.dz-list > li'),
      thumbs = [...document.querySelectorAll('.dz-list .pk-thumb img')];
      for (const img of thumbs) try { await img.decode(); } catch {}
      return { label: [...document.querySelectorAll('.dl-seg button')].map((b) => /^Designs(\\d+)$/.exec(b.textContent.trim())?.[1]).find(Boolean),
        rows: rows.length, titles: [...rows].map((r) => r.querySelector('.t')?.textContent ?? ''), thumbs: thumbs.length,
        painted: thumbs.filter((i) => i.naturalWidth > 0 && i.naturalHeight > 0).length }; })()`);
    assert.equal(Number(list.label), list.rows, `the Designs label reads ${list.label} but the list draws ${list.rows} rows`);
    assert.deepEqual(list.titles.sort(), ['Which canvas should the editor open?', 'Which studio layout should the brief use?'].sort(), 'each row names its design in plain words');
    assert.equal(list.thumbs, list.rows, 'each pick row draws its own thumbnail');
    assert.equal(list.painted, list.rows, 'every thumbnail is a decoded picture');
    // An opened pick's sheet names the design plainly, never its key, and its option row and Recommended tag sit inside the sheet.
    await evaluate(`location.href = ${JSON.stringify(`${url}#decide/studio-pick`)}`);
    await until(async () => await evaluate('!!document.querySelector(".ask-sheet .mocks .badge")'));
    const sheet = await evaluate(`(() => { const r2 = (n) => Math.round(n * 10) / 10, box = (e) => e.getBoundingClientRect(),
      sheet = document.querySelector('.ask-sheet'), row = document.querySelector('.ask-sheet .mocks'), badge = row.querySelector('.badge'),
      head = [...document.querySelectorAll('.ask-sheet header, .ask-sheet .crumb, .ask-sheet .sh-lab')].map((e) => e.textContent).join('|');
      return { head, sheet: [r2(box(sheet).left), r2(box(sheet).right)], row: [r2(box(row).left), r2(box(row).right)],
        badge: [r2(box(badge).left), r2(box(badge).right)], cards: [...row.querySelectorAll('.mock')].map((f) => r2(box(f).width)),
        scrollLeft: row.scrollLeft }; })()`);
    assert.ok(!sheet.head.includes('studio-pick'), `the sheet header exposes the raw key: ${sheet.head}`);
    assert.ok(sheet.head.includes('Which studio layout should the brief use?'), `the sheet header names the design plainly: ${sheet.head}`);
    assert.equal(sheet.scrollLeft, 0, 'the phone row starts at its first option');
    assert.ok(sheet.row[0] >= sheet.sheet[0] - 0.5 && sheet.row[1] <= sheet.sheet[1] + 0.5, `the option row sits inside the sheet: ${JSON.stringify(sheet)}`);
    assert.ok(sheet.cards.every((w) => w <= 128.5), `the phone keeps its option width: ${JSON.stringify(sheet.cards)}`);
    assert.ok(sheet.badge[0] >= sheet.row[0] - 0.5 && sheet.badge[1] <= sheet.row[1] + 0.5, `the Recommended tag sits inside the row: ${JSON.stringify(sheet)}`);
  } finally {
    await close();
    proc.kill();
  }
});

test('a posted contract design is listed under Designs only, never in Decide or a count of asks until Main promotes it, with its preview and date, and opens for a saved approve/change review', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'contract-design-plain-row'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(join(dir, 'design', 'welcome.png'), png);
  // The security screen's views say the viewport they are drawn in, as a prototype's breakpoints see it, once loaded and on each resize
  // (headless Chrome can give a sandboxed frame in a process of its own its size just after the page starts).
  const says = '<script>const say = (load) => parent.postMessage({ vp: [innerWidth, innerHeight], load }, "*"); say(true); addEventListener("resize", () => say(false))</script>';
  writeFileSync(join(dir, 'design', 'security.html'), `<!doctype html><title>Security view</title><h1>Security preview</h1>${says}`);
  writeFileSync(join(dir, 'design', 'security-desk.html'), `<!doctype html><title>Security on a desk</title><h1>Security preview</h1>${says}`);
  writeFileSync(join(dir, 'design', 'welcome.webp'), readFileSync(new URL('../docs/media/phone-light.webp', import.meta.url)));
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd1-design', title: 'Approve the welcome screen?',
    about: 'Check the welcome screen before release.', group: 'Sign-in', filed: '2026-10-18T12:00:00Z', status: 'in_review',
    preview: 'design/preview.png', link: 'https://example.test/design/original',
    options: [{ value: 'quick', label: 'Quick' }, { value: 'guided', label: 'Guided' }], recommend: 'guided',
    journeys: [{ id: 'account-setup', title: 'Account setup', screens: [
      { id: 'welcome', title: 'Welcome', views: { phone_light: 'design/welcome.webp' } },
      { id: 'security', title: 'Security', views: { phone_light: 'design/security.html', computer_light: 'design/security-desk.html' } },
      ...Array.from({ length: 15 }, (_, i) => ({ id: `screen-${i + 3}`, title: `Journey screen ${i + 3}`, views: { phone_light: 'design/welcome.png' } })),
    ] }] };
  writeFileSync(source, JSON.stringify(message));
  const posted = run('post', file, '--kind', 'design', '--from', source);
  assert.equal(posted.code, 0, posted.out);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, close } = await browse(join(dir, 'browser'));
  // A lead's design is Main's to review: Today counts no ask for it and links it under Designs in its More, and Decide is all clear with no badge.
  await evaluate(`location.href = ${JSON.stringify(url)}`);
  await until(async () => await evaluate('!!document.querySelector(".t-more-line")'));
  await evaluate('document.querySelector(".t-more-line").click()');
  const moreLinks = () => evaluate('[...document.querySelectorAll("#t-more a.ui-pr")].map((a) => a.getAttribute("href") + " " + a.textContent).join("|")');
  await until(async () => (await moreLinks()).includes('Designs1'));
  // Channels is one more place in the same sheet, and it carries no count.
  assert.equal(await moreLinks(), '#designs Designs1|#channels Channels');
  assert.equal(await evaluate('document.querySelector(".t-up .q").textContent + "|" + document.querySelector(".t-tiles .ui-stat").getAttribute("aria-label")'), 'Nothing waits on you|Cleared today: 0 of 0');
  await evaluate('document.getElementById("t-more").close()');
  // Today lists it under Designs to review, its tile a thumbnail of its first screen, one tap from its review.
  assert.equal(await evaluate('(() => { const s = document.querySelector(".t-wait[aria-label=\'Designs to review\']"), a = s?.querySelector(".ui-row"); return [s?.querySelector(".see").getAttribute("href"), a?.getAttribute("href"), a?.querySelector(".t").textContent, decodeURIComponent(a?.querySelector(".ui-icon img.design-thumb")?.getAttribute("src") ?? "").split("/").pop()].join("|"); })()'),
    `#designs|#designs/d1-design|${message.title}|welcome.webp`);
  await evaluate(`location.href = ${JSON.stringify(`${url}#waiting`)}`);
  await until(async () => (await evaluate('document.querySelector(".decide-list .ui-hero .big")?.textContent')) === '0');
  assert.equal(await evaluate('!document.querySelector("#item-d1-design") && !document.querySelector("#tabs a[href=\'#waiting\'] .bd, #nav a[href=\'#waiting\'] .n")'), true);
  // On a phone Decide's Designs counts it apart from the asks, one tap from its list.
  assert.equal(await evaluate('[...document.querySelectorAll(".dl-seg button")].map((b) => b.textContent + (b.getAttribute("aria-pressed") === "true" ? "*" : "")).join()'), 'Asks0*,Designs1');
  // Main promotes it: it waits in Decide like any ask, and --undo puts it back under Designs.
  assert.match(run('promote', 'd1-design', file).out, /promoted\[1\]: d1-design/);
  await evaluate('location.reload()');
  await until(async () => (await evaluate('document.querySelector("#item-d1-design .t")?.textContent')) === message.title);
  assert.match(await evaluate('document.querySelector("#item-d1-design .meta")?.textContent'), / · 18 Oct$/); // the row is its title, whose it is and when it came
  assert.equal(await evaluate('document.querySelector("#item-d1-design")?.getAttribute("href")'), '#designs/d1-design');
  assert.equal(await evaluate('document.querySelector(".decide-list .ui-hero .big")?.textContent'), '1'); // the promoted design is the one ask
  assert.match(run('promote', 'd1-design', file, '--undo').out, /unpromoted\[1\]: d1-design/);
  await evaluate('window.old = true, location.reload()');
  await until(async () => (await evaluate('!window.old && document.querySelector(".decide-list .ui-hero .big")?.textContent')) === '0');
  // Only a design is promoted, and only a key on the board.
  assert.equal(run('promote', 'nope', file).code, 1);
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs`)}`);
  // On a phone the design row leads with its first frame, its title, and its state and day.
  await until(async () => (await evaluate('document.querySelector(".dz-list .t")?.textContent')) === message.title);
  assert.equal(await evaluate('document.querySelector(".dz-list .ui-icon img")?.getAttribute("src")?.includes("welcome.webp") && !document.querySelector(".dz-list .mono")'), true);
  assert.equal(await evaluate('(async () => { const i = document.querySelector(".dz-list .design-thumb"); await i.decode(); return i.getBoundingClientRect().height <= i.parentElement.getBoundingClientRect().height; })()'), true, 'portrait thumbnail fits its tile');
  assert.equal(await evaluate('document.querySelector(".dz-list .meta")?.textContent'), 'In review · 18 Oct');
  // The row carries its project, never the words "No project".
  assert.equal(await evaluate('document.querySelector(".dz-list .ui-icon")?.getAttribute("aria-label")'), 'Sign-in');
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs/d1-design`)}`);
  await until(async () => (await evaluate('document.querySelector(".design-review .foot button")?.textContent')) === 'Approve');
  assert.equal(await evaluate('document.querySelector(".design-preview-full")?.getAttribute("target")'), '_blank');
  assert.equal(await evaluate('document.querySelector(".design-review-preview")?.getAttribute("src")'), `/design/local/d1-design/${encodeURIComponent('design/welcome.webp')}`);
  assert.equal(await evaluate('document.querySelector("[aria-label=\\"Screen for note\\"]")?.options.length'), 17);
  await evaluate('window.vp = [], window.loads = 0, addEventListener("message", (e) => { if (!e.data?.vp) return; loads += e.data.load; vp.push(e.data.vp.join("x")); })');
  await evaluate('(() => { const s = document.querySelector("[aria-label=\\"Screen for note\\"]"); s.value = "account-setup/security"; s.dispatchEvent(new Event("change")); })()');
  // Below 960 wide a page view runs in a phone's own 390 by 844, its box the phone's shape with nothing blank under the page.
  await until(async () => (await evaluate('vp.at(-1)')) === '390x844');
  const preview = '(() => { const w = document.querySelector(".design-preview-window"), a = w.getBoundingClientRect(), b = w.querySelector("iframe").getBoundingClientRect(); return { box: [a.width, a.height].map(Math.round), frame: [b.width, b.height].map(Math.round), blankBelow: Math.round(a.bottom - b.bottom), column: Math.round(document.querySelector(".design-review textarea").getBoundingClientRect().width) }; })()';
  const phone = await evaluate(preview);
  assert.deepEqual([phone.box, phone.frame, phone.blankBelow], [[390, 844], [390, 844], 0]);
  assert.equal(await evaluate('document.querySelector(".design-preview-full")?.getAttribute("href")'), `/design/local/d1-design/${encodeURIComponent('design/security.html')}`);
  assert.equal(await evaluate('document.querySelector(".design-review-preview")?.tagName'), 'IFRAME');
  assert.equal(await evaluate('document.querySelector(".design-review-preview")?.getAttribute("src")'), `/design/local/d1-design/${encodeURIComponent('design/security.html')}`);
  await evaluate('document.querySelector("[aria-label=\\"Pick a direction\\"]").value = "quick"');
  await evaluate('document.querySelector(".design-review .foot button").click()');
  await until(async () => (await evaluate('document.querySelector(".design-review [role=status]")?.textContent')) === 'Approved');
  await evaluate('document.querySelector("[aria-label=\\"Screen for note\\"]").value = "account-setup/security"');
  await evaluate('document.querySelector(".design-review textarea").value = "Make the title clearer"');
  await evaluate('document.querySelector(".design-review .foot .dz-change").click()');
  await until(async () => (await evaluate('document.querySelector(".design-review [role=status]")?.textContent')) === 'Changes requested');
  assert.deepEqual(JSON.parse(run('answers', file, '--json').out)['d1-design'].notes, [{ journey: 'account-setup', screen: 'security', verdict: 'change', note: 'Make the title clearer' }]);
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs`)}`);
  await until(async () => (await evaluate('document.querySelector(".dz-list .meta")?.textContent')).startsWith('Changes requested'));
  // Its Designs label counts the row the list draws, though the design is no longer open to review.
  assert.equal(await evaluate('[...document.querySelectorAll(".dl-seg button")].map((b) => b.textContent).join() + "|" + document.querySelectorAll(".dz-list > li").length'), 'Asks0,Designs1|1');
  // Main's verdict is no answer of the user's: Today's More lists nothing under Answered for it, and Cleared today counts nothing.
  await evaluate(`location.href = ${JSON.stringify(url)}`);
  await until(async () => await evaluate('!!document.querySelector(".t-more-line")'));
  await evaluate('document.querySelector(".t-more-line").click()');
  await until(async () => (await evaluate('[...document.querySelectorAll("#t-more a.ui-pr")].map((a) => a.getAttribute("href") + " " + a.textContent).join("|")')) === '#designs Designs1|#channels Channels');
  assert.equal(await evaluate('document.querySelector(".t-tiles .ui-stat").getAttribute("aria-label")'), 'Cleared today: 0 of 0');
  await evaluate('document.getElementById("t-more").close()');
  const desktop = await browse(join(dir, 'desktop-browser'), 1280);
  await desktop.evaluate(`location.href = ${JSON.stringify(`${url}#designs`)}`);
  // The desk's sidebar holds Designs after Reports with its count, lit on Designs, and Channels after Tickets; Decide is not.
  await until(async () => (await desktop.evaluate('[...document.querySelectorAll("#nav a:not(.sfind)")].map((a) => [...a.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join("") + (a.hasAttribute("aria-current") ? "*" : "")).join("|") + " " + document.querySelector("#nav a[href=\\"#designs\\"] .n")?.textContent')) === 'Today|Inbox|Decide|Evidence|Reports|Designs*|Tickets|Channels 1');
  await desktop.evaluate(`location.href = ${JSON.stringify(`${url}#designs/d1-design`)}`);
  await until(async () => (await desktop.evaluate('document.querySelector(".design-review .foot button")?.textContent')) === 'Approve');
  assert.equal(await desktop.evaluate('document.querySelector("#nav a[href=\\"#designs\\"][aria-current=page]")?.getClientRects().length > 0'), true);
  assert.equal(await desktop.evaluate('document.querySelector(".design-review")?.getBoundingClientRect().bottom <= innerHeight'), true);
  // On a desk the design opens in the board, its card marked, beside where it stands; the reader stays shut.
  assert.equal(await desktop.evaluate('document.getElementById("reader").hidden && document.querySelector(".dz-card[aria-current]")?.id === "item-d1-design" && !!document.querySelector(".dz-open .dz-fill .design-preview-window") && !!document.querySelector(".dz-info .foot .dz-ink")'), true);
  // On a desk the security screen's computer view runs in a desk's own 1280 by 800, scaled down to fit the open design's picture area, in the desk's shape: no blank band under it.
  await desktop.evaluate('window.vp = [], window.frameLoads = [], addEventListener("message", (e) => { if (!e.data?.vp) return; if (e.data.load) frameLoads.push(e.source); vp.push(e.data.vp.join("x")); })');
  await desktop.evaluate('(() => { const s = document.querySelector("[aria-label=\\"Screen for note\\"]"); s.value = "account-setup/security"; s.dispatchEvent(new Event("change")); })()');
  await until(async () => (await desktop.evaluate('vp.at(-1)')) === '1280x800');
  await until(async () => { const p = await desktop.evaluate(preview); return p.frame[0] === p.box[0]; });
  const desk = await desktop.evaluate(preview), area = await desktop.evaluate('(() => { const r = document.querySelector(".dz-fill").getBoundingClientRect(); return [r.width, r.height].map(Math.round); })()');
  assert.deepEqual([desk.frame, desk.blankBelow], [desk.box, 0]);
  assert.ok(Math.abs(desk.box[1] - desk.box[0] * 800 / 1280) <= 1 && desk.box[0] <= area[0] && desk.box[1] <= area[1] && (desk.box[0] === area[0] || Math.abs(desk.box[1] - area[1]) <= 1), JSON.stringify({ desk, area }));
  // A narrower box scales the same page again, without loading it again.
  // The board may draw the open design again while it settles, so the page that is measured is the one on the desk now: once it has loaded, narrowing the box must not load it again, and it is still the one in the board.
  await desktop.evaluate('window.testFrame = document.querySelector(".design-preview-window iframe")');
  await until(async () => (await desktop.evaluate('frameLoads.filter((w) => w === testFrame.contentWindow).length')) >= 1);
  await desktop.evaluate('document.querySelector(".design-preview-window").style.width = "500px"');
  await until(async () => (await desktop.evaluate(preview)).frame.join() === '500,313');
  assert.deepEqual(await desktop.evaluate('[testFrame === document.querySelector(".design-preview-window iframe"), frameLoads.filter((w) => w === testFrame.contentWindow).length, vp.at(-1), document.querySelector(".design-preview-window").getBoundingClientRect().height]'), [true, 1, '1280x800', 312.5]);
  desktop.close();
  // The inline Change saved a change note on this screen: the viewer must show it as a change, not an approval.
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs/d1-design`)}`);
  await until(async () => (await evaluate('document.querySelector("[data-design]")?.textContent')) === 'Review full screen');
  await evaluate('document.querySelector("[data-design]").click()');
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
  await evaluate('document.querySelector(".design-viewer .foot .dz-change").click()');
  await until(async () => (await evaluate('document.querySelector(".design-viewer[open] [role=status]")?.textContent')) === 'Changes requested');
  await evaluate('document.querySelector("[aria-label=\\"Close viewer\\"]").click()');
  await until(() => evaluate('!document.querySelector(".design-viewer[open]")'));
  assert.equal(await evaluate('location.hash'), '#designs/d1-design');
  await until(async () => (await evaluate('String(document.querySelector(".design-review textarea").compareDocumentPosition([...document.querySelectorAll(".design-review > a")].find((a) => a.textContent === "Open original design")))')) === '4');
  // The old page stays readable for a moment after location.reload(), so the wait names this load: a button read and clicked
  // on the outgoing page goes away with it, and the viewer it opened never shows.
  await evaluate('window.old = true, location.reload()');
  await until(async () => (await evaluate('!window.old && document.querySelector("[data-design]")?.textContent')) === 'Review full screen');
  await evaluate('document.querySelector("[data-design]").click()');
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
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd1-no-screens', title: 'Approve the settings direction?',
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
  assert.match(await evaluate('document.querySelector(".design-review .dz-said")?.textContent'), /Clarify the overall hierarchy/);
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs`)}`);
  await until(async () => (await evaluate('document.querySelector(".dz-list .meta")?.textContent'))?.startsWith('Changes requested'));
  close();
  proc.kill();
});

test('an answers-only board takes a screen review: typing a note in the viewer enables Request change, and a tap sends it', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'answers-only-viewer'), file = join(dir, 'board.json'), source = join(dir, 'design-message.json');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(join(dir, 'design', 'a.png'), png);
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd3-fed', title: 'Approve the fed screen?', about: 'A program feeds this board.', group: 'Sign-in',
    filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png',
    journeys: [{ id: 'flow', title: 'Flow', screens: [{ id: 'a', title: 'First', views: { phone_light: 'design/a.png' } }] }] };
  writeFileSync(source, JSON.stringify(message));
  assert.equal(run('post', file, '--kind', 'design', '--from', source).code, 0);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), answers_only: true }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], { evaluate, tap, insertText, close } = await browse(join(dir, 'browser'), 390, 844, true);
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs/d3-fed`)}`);
  await until(async () => (await evaluate('document.querySelector("[data-design]")?.textContent')) === 'Review full screen');
  await evaluate('document.querySelector("[data-design]").click()');
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
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd2-screens', title: 'Approve the flow screens?',
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
  await until(async () => (await evaluate('document.querySelector("[data-design]")?.textContent')) === 'Review full screen');
  await evaluate('document.querySelector("[data-design]").click()');
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
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd3-verdicts', title: 'Approve the flow screens?',
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

const flowMessage = (key, screens) => ({ contract: 1, kind: 'design', schema: 1, key, title: 'Approve the flow screens?',
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
  await evaluate('document.querySelector(".design-review .foot .dz-change").click()');
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
  const design = { contract: 1, kind: 'design', schema: 1, key: 'd4-relock', title: 'Approve the flow screens?',
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
  const design = (options) => ({ contract: 1, kind: 'design', schema: 1, key: 'd5-pick', title: 'Approve this look?', about: 'Pick a look.', group: 'Sign-in',
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
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd3-change-again', title: 'Approve the flow screens?',
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
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd3-rerequest', title: 'Approve the flow screens?',
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
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd5-rewake', title: 'Approve the flow screens?',
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
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd3-direction', title: 'Approve the flow screens?',
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
  await until(async () => (await evaluate('document.querySelector("[data-design]")?.textContent')) === 'Review full screen');
  await evaluate('document.querySelector("[data-design]").click()');
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
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd3-plain', title: 'Approve the plain page?',
    about: 'One page.', group: 'Sign-in', filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png', journeys: [] };
  writeFileSync(source, JSON.stringify(message));
  assert.equal(run('post', file, '--kind', 'design', '--from', source).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], { evaluate, close } = await browse(join(dir, 'browser'), 1280);
  await evaluate(`location.href = ${JSON.stringify(`${url}#designs/d3-plain`)}`);
  await until(async () => (await evaluate('document.querySelector(".design-review .foot button")?.textContent')) === 'Approve');
  await evaluate('document.querySelector(".design-review textarea").value = "Fix spacing"');
  await evaluate('document.querySelector(".design-review .foot .dz-change").click()');
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
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd6-round', title: 'Approve the flow screens?',
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
    return evaluate('({ note: document.querySelector(".design-review textarea").value, steps: [...document.querySelectorAll(".design-review .thread .aw b")].map((e) => e.textContent).filter((t) => t.startsWith("Your answer")), notes: [...document.querySelectorAll(".design-review .thread .th-n")].map((e) => e.textContent) })');
  };
  // The same round: its saved note appears in Activity as well as the editor; nothing is from an earlier round.
  assert.deepEqual(await open(), { note: 'Round one: bigger title', steps: ['Your answer: Changes requested'], notes: ['“Round one: bigger title”'] });
  // The agent draws the screen again in place: same key, same fields, new bytes. That is a new round.
  writeFileSync(join(dir, 'design', 'a.png'), sized(4, 4));
  assert.deepEqual(await open(), { note: '', steps: ['Your answer on the earlier round: Changes requested (First)'], notes: ['“Round one: bigger title”'] });
  // In the viewer the screen is not reviewed yet, and approving it sends this round's note only: the earlier change does not carry over.
  await evaluate('document.querySelector("[data-design]").click()');
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
  assert.deepEqual(await open(), { note: 'Older note', steps: ['Your answer: Changes requested', 'Your answer on the earlier round: Changes requested (First)'], notes: ['“Older note”', '“Round one: bigger title”'] });
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
  const message = { contract: 1, kind: 'design', schema: 1, key: 'd7-preview', title: 'Approve the fleet screens?',
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
    // The page is drawn scaled to the window, to a tenth of a pixel (the window's height is in layout units).
    const read = '(() => { const w = document.querySelector(".design-preview-window"); w.scrollIntoView({ block: "start" }); const f = w.firstElementChild.getBoundingClientRect(), r = w.getBoundingClientRect(), px = (n) => Math.round(n * 10) / 10; return { src: w.firstElementChild.getAttribute("src"), frame: [f.width, f.height].map(px), window: [r.left, r.top, r.width, r.height].map(px) }; })()';
    await until(async () => { const b = await evaluate(read); return b.frame.join() === b.window.slice(2).join(); });
    const box = await evaluate(read);
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

test('Evidence: an update with no run is never waiting on you, and is listed under Evidence as not checked, with no project filter for one project', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
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
  // Nothing checked it: no check at its tile's corner, and it says so to a screen reader.
  assert.deepEqual(await evaluate('[document.querySelector("#item-upd .ev-ok"), document.querySelector("#item-upd").getAttribute("aria-label")]'), [null, 'Login checked, Not checked']);
  // With proof for only one project there is nothing to pick: the title stands alone.
  assert.equal(await evaluate('document.querySelector(".ev-fb")'), null);
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
  const result = (key) => evaluate(`(() => { const a = document.querySelector("#item-${key}"); return a ? [a.querySelector(".ev-ok")?.className ?? "", a.getAttribute("aria-label").split(", ")[1]] : null; })()`);
  await until(async () => (await result('found'))?.[0] === 'ev-ok held');
  assert.deepEqual(await result('found'), ['ev-ok held', 'Holds up']);
  // A run found nowhere is claimed as nothing: its update is on Evidence, saying nothing checked it.
  assert.deepEqual(await result('lost'), ['', 'Not checked']);
  close();
  proc.kill();
});

test('Today on a phone: the floating tab bar with its pill on Today, Up next with one main action in ink, Waiting on you as 68px rows with a long title on one line, two tiles side by side, nothing wider than the screen, a line under the tiles opening More with Ask the agent as one row, the last line clear of the tab bar, the title row\'s button switching light and dark, and the dock\'s Search a sheet over the screen it is opened on', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
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
  await until(async () => (await evaluate('document.querySelectorAll(".t-wait .ui-row").length')) === 1);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= 390'));
  // The dock floats 24px over the bottom edge: a 56px pill of six 48px tabs, then the round 56px Search 12px beside it, the two centred together; its pill sits on Today.
  const rect = (sel) => `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)]; })()`;
  const bar = await evaluate(rect('.tabs')), find = await evaluate(rect('.dock-find')), tab = await evaluate(rect('.tabs a')), [vw, vh] = await evaluate('[document.documentElement.clientWidth, innerHeight]');
  assert.deepEqual([bar[1] - bar[0], bar[3] - bar[2], vh - bar[3], tab[1] - tab[0], find[1] - find[0], find[3] - find[2], vh - find[3], find[0] - bar[1], Math.abs(bar[0] - (vw - find[1])) <= 1], [306, 56, 24, 48, 56, 56, 24, 12, true]);
  await until(async () => (await evaluate(rect('.tabs .hl')))[0] === (await evaluate(rect('.tabs a[href="#"]')))[0]);
  // Up next is the plan, to review: one main action in ink that opens it, and no second.
  const plan = JSON.parse(readFileSync(join(fixture, 'valid-full.json'), 'utf8')).key;
  assert.deepEqual(await evaluate('(() => { const b = document.querySelectorAll(".t-up .t-btns > *"), c = getComputedStyle(b[0]); return [document.querySelector(".t-up .lab").textContent, b.length, b[0].textContent, b[0].getAttribute("href"), Math.round(b[0].getBoundingClientRect().height), c.backgroundColor === getComputedStyle(document.querySelector(".today-top h1")).color]; })()'),
    ['Up next · 1 of 2', 1, 'Review', `#waiting/${plan}`, 44, true]);
  // The other ask is one 68px row: its long title on one line, cut with an ellipsis, its kind and when under it.
  assert.deepEqual(await evaluate('(() => { const r = document.querySelector(".t-wait .ui-row"), t = r.querySelector(".t"); return [Math.round(r.getBoundingClientRect().height), Math.round(t.getBoundingClientRect().height), t.scrollWidth > t.clientWidth, getComputedStyle(t).textOverflow, r.querySelector(".meta").textContent.split(" · ")[0], r.getAttribute("href")]; })()'),
    [68, 20, true, 'ellipsis', 'Yes/No', '#decide/a']);
  // Two tiles side by side, each 96px tall, as wide as each other and 8px apart.
  const tiles = await evaluate('[...document.querySelectorAll(".t-tiles .ui-stat")].map((t) => { const r = t.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })');
  assert.ok(tiles.length === 2 && tiles[0][1] === tiles[1][1] && tiles[0][2] === tiles[1][2] && tiles.every((t) => t[3] === 96) && tiles[1][0] - (tiles[0][0] + tiles[0][2]) === 8, JSON.stringify(tiles));
  // The line under the tiles opens More, which holds Ask the agent: closed, one line of text in a 44px row with no box around it; a tap opens the prompt box.
  await evaluate('document.querySelector(".t-more-line").click()');
  await until(async () => await evaluate('document.getElementById("t-more").open'));
  const ask = await evaluate('(() => { const a = document.querySelector("#t-more details.ask"), s = a.querySelector("summary"), r = document.createRange(); r.selectNodeContents(s); const box = a.getBoundingClientRect(), t = r.getBoundingClientRect(), c = getComputedStyle(a); return [a.open, Math.round(box.height), Math.abs(Math.round((t.top + t.bottom) / 2 - (box.top + box.bottom) / 2)) <= 2, c.borderTopWidth, c.backgroundColor, Math.round(t.left)]; })()');
  assert.deepEqual(ask, [false, 44, true, '0px', 'rgba(0, 0, 0, 0)', 16]);
  await evaluate('document.querySelector("#t-more details.ask summary").click()');
  assert.ok(await evaluate('document.querySelector("#t-more details.ask").open && document.getElementById("prompt").getBoundingClientRect().height > 40'));
  await evaluate('document.getElementById("t-more").close()');
  // The last thing on Today scrolls fully clear of the floating tab bar.
  await evaluate('scrollTo(0, document.documentElement.scrollHeight)');
  assert.ok(await evaluate('document.querySelector(".t-more-line").getBoundingClientRect().bottom <= document.querySelector(".tabs").getBoundingClientRect().top - 16'));
  // The round button in the title row switches light and dark: the page and its cards take the other theme, the button says so, the pick holds across a reload, and a second tap puts it back.
  const look = () => evaluate('[document.querySelector(".today-top .ui-rb").getAttribute("aria-label"), getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector(".t-up")).backgroundColor].join("|")');
  const first = await look(), other = first.startsWith('Switch to dark|') ? 'Switch to light|' : 'Switch to dark|';
  assert.match(first, /^Switch to (dark|light)\|/);
  await evaluate('document.querySelector(".today-top .ui-rb").click()');
  await until(async () => (await look()).startsWith(other));
  const picked = await look();
  assert.ok(picked.split('|')[1] !== first.split('|')[1] && picked.split('|')[2] !== first.split('|')[2], `${first} -> ${picked}`);
  await evaluate('location.reload()');
  await until(async () => (await evaluate('!!document.querySelector(".t-up")')) && (await look()) === picked);
  await evaluate('document.querySelector(".today-top .ui-rb").click()');
  await until(async () => (await look()) === first);
  await evaluate('localStorage.removeItem("so-theme")');
  // On Evidence the same proof is a row of its claim with done-done's check at its tile's corner, with no frame left empty.
  await evaluate('location.hash = "#evidence"');
  await until(async () => await evaluate('!!document.getElementById("item-u3")'));
  assert.deepEqual(await evaluate('(() => { const c = document.getElementById("item-u3"); return [c.classList.contains("ui-row"), c.querySelectorAll("img:not(.ui-icon img)").length, c.querySelector(".t").textContent, c.querySelector(".ev-ok")?.className]; })()'),
    [true, 0, 'It works.', 'ev-ok held']);
  // With no designs filed, Designs still opens from Decide's Designs; the dock keeps its six and lights Decide, and the pill slides there.
  await evaluate('location.hash = "#waiting"');
  await until(async () => !!(await evaluate('document.querySelector(".dl-seg button[aria-pressed=false]")')));
  await evaluate('document.querySelector(".dl-seg button[aria-pressed=false]").click()');
  await until(async () => (await evaluate('location.hash + "|" + document.querySelector("#board h1").textContent + "|" + document.querySelector(".dl-seg [aria-pressed=true]")?.textContent')) === '#designs|Decide|Designs0');
  assert.deepEqual(await evaluate('[document.querySelectorAll(".tabs a").length, document.querySelector(".tabs [aria-current]").getAttribute("href")]'), [6, '#waiting']);
  await until(async () => (await evaluate(rect('.tabs .hl')))[0] === (await evaluate(rect('.tabs a[href="#waiting"]')))[0]);
  // The dock's round Search opens a sheet over the screen it is tapped on, its box in hand; what is typed lists in groups that open where each card lives, and Escape closes it there.
  await evaluate('document.querySelector(".dock-find").click()');
  await until(async () => (await evaluate('[location.hash, document.getElementById("t-search").open, document.activeElement?.id, document.querySelector("#board h1")?.textContent].join("|")')) === '#designs|true|find|Decide');
  await evaluate('(() => { const b = document.getElementById("find"); b.value = "update"; b.dispatchEvent(new Event("input")); })()');
  assert.deepEqual(await evaluate('[[...document.querySelectorAll("#t-search .t-grp")].map((g) => g.textContent).join(), [...document.querySelectorAll("#t-search .ui-row")].map((a) => a.getAttribute("href")).join()]'), ['Proof', '#evidence/u3,#evidence/u2,#evidence/u1']);
  // close() clears .open immediately, but its close event (and the route cleanup) is queued.
  // Finish that event before opening #find, so the previous close cannot clear the new address.
  await evaluate(`new Promise((ok) => {
    const sheet = document.getElementById('t-search');
    sheet.addEventListener('close', () => ok(true), { once: true });
    sheet.dispatchEvent(new Event('cancel')); sheet.close();
  })`);
  assert.equal(await evaluate('location.hash + "|" + document.getElementById("t-search").open'), '#designs|false');
  // The address #find opens Today with Search over it; closing it leaves Today at its own address.
  await evaluate('location.hash = "#find"');
  await until(async () => (await evaluate('[document.getElementById("t-search").open, document.querySelector("#board h1")?.textContent, document.querySelector(".tabs [aria-current]")?.getAttribute("href")].join("|")')) === 'true|Today|#');
  await evaluate('document.getElementById("t-search").close()');
  await until(async () => (await evaluate('location.hash')) === '');
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
  const titles = () => evaluate('[...document.querySelectorAll(".decide-list .dl-row:not(.g-done) .dl-face .t")].map((e) => e.textContent)');
  // All four use the same project tile; their answer choices still determine each detail flow.
  await until(async () => (await titles()).length === 4);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".decide-list .ui-icon")].map((p) => p.getAttribute("aria-label"))'), ["No project", "No project", "No project", "No project"]);
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
  await until(async () => (await evaluate(`${rows} === 0 && document.querySelector(".es b")?.textContent === "All done items cleared"`)));
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

test('Evidence: a row per proof ever filed, in one list, newest first, each with its project, done-done\'s check and its time; Held up today over the day\'s proofs; a project filter; a failed run is not listed; the row opens the proof, which shows its project and time, the whole shot, done-done\'s word, its change, its Activity and its verdict; at 1440 Today sets its tiles under Up next and Evidence is a list beside the selected update; at 390 rows of 68px, a sheet 48px down and nothing squashed', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
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
  // Per row: its id, what it proves, done-done's check at its tile's corner, its second line and whether it carries a picture (a row never does: the capture is the proof's own).
  const cards = '[...document.querySelectorAll(".ev-card")].map((a) => [a.id, a.querySelector(".t").textContent, a.querySelector(".ev-ok")?.className ?? "", a.querySelector(".l2").textContent, a.querySelectorAll(".ev-media, .ev-hero").length])';
  await until(async () => (await evaluate(`${cards}.length`)) === 6);
  // Nothing is archived on its own: the week-old update-7 is listed, and no Archived row exists.
  assert.equal(await evaluate('document.querySelector(".ar-line")'), null);
  const clock = (at) => at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const at = (i) => new Date(doc.items[i - 1].filed), when = (i) => (at(i).toDateString() === new Date().toDateString() ? clock(at(i)) : at(i).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
  // Evidence lists every proof in one list, newest first, however old: the plain update (5), the passed ones (4, 3, 2), the unchecked one (6) and last week's (7); only the failed run (1) is left off.
  // Both proof-prefix forms name one project, a capture with no run takes its linked repository, and a proof with neither names none.
  assert.deepEqual(await evaluate(cards), [['item-update-5', 'Sign-in, plain update', '', `Not checked · sign-off · ${when(5)}`, 0], ['item-update-4', outcome, 'ev-ok held', `Holds up · sign-off · ${when(4)}`, 0],
    ['item-update-3', outcome, 'ev-ok held', `Holds up · sign-off · ${when(3)}`, 0], ['item-update-2', outcome, 'ev-ok held', `Holds up · ${when(2)}`, 0], ['item-update-6', outcome, '', `Could not check · sign-off · ${when(6)}`, 0], ['item-update-7', 'Sign-in, last week', '', `Not checked · ${when(7)}`, 0]]);
  // One head over the list, Latest proof; no project or day headings break it.
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#board h2, #board h3")].map((h) => h.firstChild.textContent)'), ['Latest proof']);
  assert.equal(await evaluate('document.querySelector(\'#nav a[href="#evidence"] .n\').textContent'), '6');
  // The head: the title with the project filter, Newest and By priority, and Held up today over the proofs filed today, one square each, ink where the check passed.
  const today = doc.items.filter((d) => new Date(d.filed).toDateString() === new Date().toDateString()), held = today.filter((d) => ['update-2', 'update-3', 'update-4'].includes(d.key)).length;
  assert.deepEqual(await evaluate('[document.querySelector(":is(.ev-top, .ui-dhead) h1").textContent, !!document.querySelector(":is(.ev-top, .ui-dhead) .ev-fb"), [...document.querySelectorAll(".ev-seg button")].map((b) => b.textContent + " " + b.getAttribute("aria-pressed")), document.querySelector(".ev-held").innerText.replace(/\\s+/g, " ").trim(), document.querySelectorAll(".ev-dots i").length, document.querySelectorAll(".ev-dots i.held").length]'),
    ['Evidence', true, ['Newest true', 'By priority false'], `Held up today ${held} of ${today.length} ${today.length - held} not checked`, today.length, held]);
  // The project filter: a sheet of each project with its count, then No project; a pick lists only its proof, newest first, under a pill that clears it.
  const pick = async (name) => evaluate(`(async () => { document.querySelector(".ev-fb").click(); await new Promise((r) => setTimeout(r, 200));
    const opts = [...document.querySelectorAll("#sheet .ev-pick button")].map((b) => [b.querySelector(".pn").textContent, b.querySelector(".n").textContent]);
    [...document.querySelectorAll("#sheet .ev-pick button")].find((b) => b.querySelector(".pn").textContent === ${JSON.stringify(name)}).click(); await new Promise((r) => setTimeout(r, 200));
    return [opts, document.querySelector(".ev-pill > span[dir]")?.textContent ?? "", !!document.querySelector(".ev-held"), [...document.querySelectorAll(".ev-card")].map((a) => a.id)]; })()`);
  assert.deepEqual(await pick('No project'), [[['sign-off', '4'], ['No project', '2']], 'No project', false, ['item-update-2', 'item-update-7']]);
  await evaluate('document.querySelector(".ev-pill .ev-unpick").click()');
  await until(async () => (await evaluate('document.querySelectorAll(".ev-card").length')) === 6);
  assert.deepEqual((await pick('sign-off')).slice(1), ['sign-off', false, ['item-update-5', 'item-update-4', 'item-update-3', 'item-update-6']]);
  await evaluate('document.querySelector(".ev-pill .ev-unpick").click()');
  await until(async () => (await evaluate('document.querySelectorAll(".ev-card").length')) === 6);
  // Today's Proofs today counts each update filed today, the failed run too, and opens Evidence; on a desk its tiles sit under Up next in the left column.
  const filedToday = `Proofs today: ${doc.items.filter((d) => d.type === 'evidence' && d.filed && new Date(d.filed).toDateString() === new Date().toDateString()).length}`;
  await evaluate('location.hash = ""');
  await until(async () => await evaluate('!!document.querySelector(".t-tiles .ui-stat[href=\'#evidence\']")'));
  assert.equal(await evaluate('document.querySelector(".t-tiles .ui-stat[href=\'#evidence\']").getAttribute("aria-label")'), filedToday);
  const box = (sel) => `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom }; })()`;
  const [asks, tiles] = [await evaluate(box('.t-up')), await evaluate(box('.t-tiles'))];
  assert.ok(tiles.left === asks.left && tiles.right === asks.right && tiles.top >= asks.bottom, 'the tiles sit under Up next, as wide');
  await evaluate('location.hash = "#evidence"');
  await until(async () => (await evaluate('document.querySelectorAll(".ev-card").length')) === 6);
  // Evidence on a desk is one list beside the selected update: the rows stack in one column, newest first, and the newest is selected and open beside it.
  const boxes = `[5, 4, 3, 2].map((n) => { const r = document.getElementById(\`item-update-\${n}\`).getBoundingClientRect(); return { n, top: r.top, left: r.left, right: r.right, bottom: r.bottom }; })`;
  // Measured once the list has laid out its cards (a busy runner can still be drawing them when the sixth card arrives).
  const stacked = ([five, four, three, two]) => four.top >= five.bottom && three.top >= four.bottom && two.top >= three.bottom && [four, three, two].every((b) => b.left === five.left);
  let laid = [];
  await until(async () => stacked(laid = await evaluate(boxes))).catch(() => assert.fail(`one column, newest first, with no heading between: ${JSON.stringify(laid)}`));
  const [five] = laid;
  await until(async () => (await evaluate('(() => { const a = document.querySelector(".split-list .ev-card[aria-current]"); return a && document.querySelector(".split-detail .ev-title") ? a.id.slice(5) : ""; })()')) === 'update-5');
  assert.deepEqual(await evaluate('[!!document.querySelector(".split-list .ev-list"), document.querySelector("main").inert, [...document.querySelectorAll(".ev-card[aria-current]")].map((a) => a.id), document.querySelector(".ev-title").textContent]'),
    [true, false, ['item-update-5'], 'Sign-in, plain update']);
  assert.ok((await evaluate(box('.split-detail'))).left >= five.right, 'the update opens right of the list');
  // Under the title: how many are listed, how many filed today and when the newest came.
  assert.match(await evaluate('document.querySelector(".ui-dhead .tx > p:last-child").textContent'), /^\d+ proofs? on your board, newest first$/);
  // No update is an ask, whatever its result: Decide counts none of them and Today says nothing needs you.
  await evaluate('location.hash = "#waiting"');
  await until(async () => (await evaluate('document.querySelector("#board :is(.top, .ui-top, .ui-dhead) h1")?.textContent')) === 'Waiting on you' || (await evaluate('document.querySelector("#board :is(.top, .ui-top, .ui-dhead) h1")?.textContent')) === 'Decide');
  // Decide's red count goes away at zero, as the tab bar's does.
  assert.deepEqual(await evaluate('[!!document.querySelector(\'#nav a[href="#waiting"] .n\'), document.querySelectorAll("[id^=item-update-]").length]'), [false, 0]);
  await evaluate('location.hash = ""');
  await until(async () => (await evaluate('!!document.querySelector(".t-tiles")')));
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".t-tiles .ui-stat")].map((t) => t.getAttribute("aria-label")).join() + "|" + !!document.querySelector(".t-up.clear")'), `Cleared today: 0 of 0,${filedToday}|true`);
  // A failed or unchecked update still opens on Evidence with done-done's word, the reason a run could not be checked, and the verdicts, Pass last.
  for (const [k, result, why] of [['update-1', 'Failed', ''], ['update-6', 'Could not check', 'A picture or recording changed after the run. Ask the agent to run the check again.']]) {
    await evaluate(`location.hash = "#evidence/${k}"`);
    await until(async () => (await evaluate('!!document.querySelector(".split-detail .ev-title")')));
    assert.deepEqual(await evaluate('[document.querySelector(".ev-props .ev-word").textContent, document.querySelector(".ev-why")?.textContent ?? "", [...document.querySelectorAll(".ev-verdict .choices button")].map((b) => b.textContent)]'),
      [result, why, ['Fail', 'Needs work', 'Pass']]);
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
  // The row opens the update itself: its project and time, the whole capture, what it proves, then done-done's word and its change.
  await evaluate('document.getElementById("item-update-4").click()');
  await until(async () => (await evaluate('location.hash')) === '#evidence/update-4' && (await evaluate('document.querySelector(".ev-title")?.textContent')) === outcome);
  // The selection follows the click and the list stays beside the update.
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".ev-card[aria-current]")].map((a) => a.id)'), ['item-update-4']);
  const props = '[...document.querySelectorAll(".ev-props .ui-pr")].map((p) => [p.querySelector(".k").textContent, p.querySelector(".v").textContent])';
  assert.deepEqual(await evaluate(props), [['done-done', 'Holds up'], ['Pull request', '#12']]);
  assert.deepEqual(await evaluate('[document.querySelector(".split-detail .split-bar .pt").textContent, document.querySelector(".ev-props a.ui-pr").getAttribute("href")]'), [`sign-off · ${clock(at(4))}`, pr]);
  assert.deepEqual(await evaluate('[document.querySelector(".ev-title").textContent, document.querySelectorAll(".ev-hero img").length, document.querySelectorAll(".ev-verdict .choices button").length]'),
    [outcome, 1, 3]);
  // On a desk the capture fills the proof's width and a tap opens it full size; Fail, Needs work and Pass sit on one row, equally wide.
  await until(() => evaluate('document.querySelector(".ev-hero img")?.naturalWidth > 0'));
  assert.deepEqual(await evaluate('(() => { const i = document.querySelector(".ev-hero img").getBoundingClientRect(), w = document.querySelector(".split-detail .pmain").getBoundingClientRect().width, a = document.querySelector(".ev-hero a"); return [Math.round(i.width - w), a.getAttribute("href").startsWith("/api/media?key=update-4"), a.target]; })()'),
    [0, true, '_blank']);
  const verdictRow = 'new Set([...document.querySelectorAll(".ev-verdict .choices button")].map((b) => { const r = b.getBoundingClientRect(); return `${Math.round(r.top)} ${Math.round(r.width)}`; })).size';
  assert.equal(await evaluate(verdictRow), 1);
  // A redraw of the same update keeps its headline, not the raw run title.
  await evaluate('dispatchEvent(new Event("resize"))');
  assert.equal(await evaluate('document.querySelector(".ev-title").textContent'), outcome);
  // The board changes under the open update: the next refresh shows what it now says, not what it opened with.
  const changed = 'The check now proves something else.';
  doc.items[3].about = changed;
  writeFileSync(file, JSON.stringify(doc));
  await evaluate('refresh()');
  await until(async () => (await evaluate('document.querySelector(".ev-about")?.textContent')) === changed);
  assert.equal(await evaluate('document.querySelector(".ev-title").textContent'), outcome);
  // A comment sent from the open item shows on it at once, clears the box and joins its Activity.
  await evaluate('document.querySelector(".ev-verdict details.other summary").click()');
  await evaluate('(() => { const t = document.querySelector("#note-update-4"); t.value = "Looks right on my phone."; t.dispatchEvent(new Event("input")); })()');
  await evaluate('[...document.querySelectorAll(".ev-verdict button")].find((b) => b.textContent === "Send without answering").click()');
  await until(async () => (await evaluate('[...document.querySelectorAll(".ev-verdict .saved-note")].some((p) => p.textContent.includes("Looks right on my phone."))')));
  assert.equal(await evaluate('document.querySelector("#note-update-4").value'), '');
  await until(async () => (await evaluate('[...document.querySelectorAll(".split-detail .ui-act li .aw b")].map((t) => t.textContent).at(-1)')) === 'Your comment' || await evaluate('!![...document.querySelectorAll(".split-detail .tr-you p")].some((p) => p.textContent === "Looks right on my phone.")'));
  // A verdict is saved from the update's own screen, which stays open.
  await evaluate('[...document.querySelectorAll(".ev-verdict .choices button")].find((b) => b.textContent === "Pass").click()');
  await until(async () => (await evaluate('!document.querySelector("#toast").hidden && document.querySelector(".ev-verdict [aria-pressed=true]")?.textContent === "Pass"')));
  assert.equal(await evaluate('location.hash'), '#evidence/update-4');
  // Back on the list, that update is answered: it stays on Evidence and in Proofs today's count, since a verdict does not unprove it.
  await evaluate('location.hash = "#evidence"');
  await until(async () => (await evaluate('document.querySelectorAll(".ev-card").length')) === 6);
  await evaluate('location.hash = ""');
  await until(async () => await evaluate('!!document.querySelector(".t-tiles")'));
  assert.equal(await evaluate('document.querySelector(".t-tiles .ui-stat[href=\'#evidence\']").getAttribute("aria-label")'), filedToday);
  await evaluate('location.hash = "#evidence"');
  await until(async () => (await evaluate('document.querySelectorAll(".ev-card").length')) === 6);
  close();
  // On a phone each row is 68px with its 40px tile and keeps the list's width, the proof opens as a sheet 48px down, nothing scrolls sideways and nothing squashes.
  ({ evaluate, close } = await browse(join(dir, 'p'), 390));
  await evaluate(`location.href = ${JSON.stringify(`${url}#evidence`)}`);
  await until(async () => (await evaluate('document.querySelectorAll(".ev-card").length === 6')));
  assert.deepEqual(await evaluate(SQUASH), []);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".ev-card")].map((a) => { const r = a.getBoundingClientRect(), t = a.querySelector(".ui-icon").getBoundingClientRect(), l = a.closest(".ev-list").getBoundingClientRect(); return [Math.round(r.height) - (a.querySelector(".t").getBoundingClientRect().height > 20 ? 84 : 68), Math.round(t.width), Math.round(l.right - r.right), Math.round(r.left - l.left)].join(); }).filter((x) => x !== "0,40,0,0")'), []);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  // The shared light or dark button (Today's) sits in Evidence's title row too: a tap turns the board to the other theme and keeps the pick in this browser; a second tap turns it back.
  const look = '(() => [getComputedStyle(document.body).backgroundColor, document.querySelector(".ev-top .ui-rb[aria-label^=Switch] circle") ? "sun" : "moon", localStorage.getItem("so-theme")])()';
  const system = await evaluate(look);
  await evaluate('document.querySelector(".ev-top .ui-rb[aria-label^=Switch]").click()');
  const picked = await evaluate(look);
  assert.notEqual(picked[0], system[0]);
  assert.deepEqual(picked.slice(1), system[1] === 'moon' ? ['sun', 'dark'] : ['moon', 'light']);
  await evaluate('document.querySelector(".ev-top .ui-rb[aria-label^=Switch]").click()');
  assert.deepEqual((await evaluate(look)).slice(0, 2), system.slice(0, 2));
  await evaluate('localStorage.removeItem("so-theme")');
  // Select and Clear all stay reachable: one quiet line under the list opens them; Select puts Cancel and Dismiss under the title and a tap picks a row.
  await evaluate('document.querySelector(".ev-more").click()');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#sheet .ev-pick .pn")].map((p) => p.textContent)'), ['Select', 'Clear all']);
  await evaluate('[...document.querySelectorAll("#sheet .ev-pick button")][0].click()');
  await until(async () => (await evaluate('[...document.querySelectorAll("#board .bulk button")].map((b) => b.textContent).join()')) === 'Cancel,Dismiss');
  await evaluate('document.getElementById("item-update-3").click()');
  await until(async () => (await evaluate('document.getElementById("item-update-3").closest("li").classList.contains("picked") && document.querySelector(".sel-go").textContent')) === 'Dismiss 1');
  assert.equal(await evaluate('location.hash'), '#evidence');
  await evaluate('[...document.querySelectorAll("#board .bulk button")].find((b) => b.textContent === "Cancel").click()');
  await until(async () => (await evaluate('!document.querySelector("#board .bulk") && !!document.querySelector(".ev-more")')));
  // A tap on a row opens it in place: its captures in a strip with a dot each, then Open proof; the list and the address stay as they were, and a second tap closes it.
  await evaluate('document.getElementById("item-update-2").click()');
  await until(async () => await evaluate('!!document.querySelector("#item-update-2 + .ev-open")'));
  assert.deepEqual(await evaluate('[location.hash, document.getElementById("item-update-2").getAttribute("aria-expanded"), document.querySelectorAll(".ev-open .ev-strip a").length, document.querySelectorAll(".ev-open .ev-dots-n i").length, document.querySelector(".ev-open .ev-go").getAttribute("href"), document.querySelectorAll(".ev-card").length]'),
    ['#evidence', 'true', 2, 2, '#evidence/update-2', 6]);
  await evaluate('document.getElementById("item-update-2").click()');
  await until(async () => await evaluate('!document.querySelector(".ev-open")'));
  // Previews: every row shows its first capture large beside its title; the pick is kept in this browser and a reload keeps it.
  const views = '[document.querySelector(".ev-pv").getAttribute("aria-pressed"), document.querySelectorAll(".ev-card.rich").length, localStorage.getItem("so-ev-view")]';
  assert.deepEqual(await evaluate(views), ['false', 0, null]);
  await evaluate('document.querySelector(".ev-pv").click()');
  await until(async () => (await evaluate(views))[1] === 6);
  assert.deepEqual(await evaluate(views), ['true', 6, 'rich']);
  await evaluate('location.reload()');
  await until(async () => (await evaluate(views))?.[1] === 6);
  await evaluate('document.querySelector(".ev-pv").click()');
  await until(async () => (await evaluate(views))[1] === 0);
  assert.equal((await evaluate(views))[2], 'compact');
  await evaluate('document.getElementById("item-update-2").click()');
  await until(async () => await evaluate('!!document.querySelector(".ev-open .ev-go")'));
  await evaluate('document.querySelector(".ev-open .ev-go").click()');
  await until(async () => (await evaluate('!!document.querySelector(".ev-item") && document.querySelectorAll(".ev-hero img").length === 2')));
  // A proof with no project says so in its head, and a link that is not a full URL is no Pull request row.
  assert.deepEqual(await evaluate(`[document.querySelector(".ev-shd .pt").textContent, ${props}, Math.round(document.getElementById("reader").getBoundingClientRect().top)]`), [`No project · ${clock(at(2))}`, [['done-done', 'Holds up']], 48]);
  assert.equal(await evaluate(verdictRow), 1);
  assert.deepEqual(await evaluate(SQUASH), []);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  assert.ok(await evaluate('[...document.querySelectorAll(".ev-hero img")].every((i) => i.getBoundingClientRect().width <= document.querySelector(".ev-item").getBoundingClientRect().width)'));
  // Nothing was dismissed, so no log line was written beyond the restore the test itself made.
  assert.deepEqual(readFileSync(file.replace(/\.json$/, '.dismissed.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).key), ['update-1']);
  close();
  // On a phone as it is held (390x844 with an iPhone's 34px home bar): no row carries a picture or a close, and a proof's Close sits in its sheet's head, above its captures and over none of them.
  const iphone = await browse(join(dir, 'i'), 390, 844, true);
  await iphone.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 34 } });
  await iphone.evaluate(`location.href = ${JSON.stringify(`${url}#evidence`)}`);
  await until(async () => (await iphone.evaluate('document.querySelectorAll(".ev-card").length')) === 6);
  assert.equal(await iphone.evaluate('document.querySelectorAll(".ev-list img:not(.ui-icon img):not(.ev-th img), .ev-list video, .ev-list :is(.x, .ev-x, [aria-label=Close])").length'), 0);
  await iphone.evaluate('document.getElementById("item-update-2").click()');
  await until(() => iphone.evaluate('!!document.querySelector(".ev-open .ev-go")'));
  await iphone.evaluate('document.querySelector(".ev-open .ev-go").click()');
  await until(() => iphone.evaluate('[...document.querySelectorAll(".ev-hero img")].filter((i) => i.naturalWidth).length === 2'));
  assert.deepEqual(await iphone.evaluate(`(() => { const x = document.querySelector("#reader .ev-x").getBoundingClientRect(), shots = [...document.querySelectorAll("#reader .ev-hero img")].map((i) => i.getBoundingClientRect());
    return [x.bottom <= Math.min(...shots.map((s) => s.top)), shots.filter((s) => x.left < s.right && s.left < x.right && x.top < s.bottom && s.top < x.bottom).length]; })()`), [true, 0]);
  // Discarded from its sheet, the proof goes under Archived; at the list's scroll end the last row, Select or clear all and Archived all end above the dock, which rises over the home bar.
  await iphone.evaluate('document.querySelector(".ev-verdict > .dis").click()');
  await iphone.evaluate('document.querySelector("#dc-sheet [data-reason=not-relevant]").click()');
  await until(async () => (await iphone.evaluate('document.querySelector("main .ar-line")?.textContent')) === 'Archived · 1' && (await iphone.evaluate('document.getElementById("reader").hidden && document.querySelectorAll(".ev-card").length')) === 5);
  const end = await iphone.evaluate(`(() => { scrollTo(0, document.documentElement.scrollHeight); const bottom = (s) => Math.round(document.querySelector(s).getBoundingClientRect().bottom), dock = document.querySelector(".tabs").getBoundingClientRect();
    return { dockTop: Math.round(dock.top), dockBottom: Math.round(dock.bottom), lastRow: bottom(".ev-list > li:last-child"), more: bottom(".ev-more"), archived: bottom("main .ar-line") }; })()`);
  assert.equal(end.dockBottom, 844 - 24 - 34, JSON.stringify(end));
  assert.ok([end.lastRow, end.more, end.archived].every((b) => b <= end.dockTop), `under the dock at the scroll end: ${JSON.stringify(end)}`);
  iphone.close();
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
  for (const [path, body] of [['api/rounds', { key: 'ask-1', note: 'again' }], ['api/messages', { kind: 'prompt', text: 'hi' }], ['api/messages', { kind: 'comment', key: 'ask-1', text: 'hi' }],
    ['api/annotations', { key: 'ask-1', mock: 'a', ref: '#x', tag: 'p', words: 'x', text: 'hi' }]]) {
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
  assert.match(await (await fetch(`${url}app.js`)).text(), /Seen by agent/);
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
  // An on_answer hook that ran hands the answer over: the card no filer took shows it delivered, not read.
  for (let i = 0; i < 50 && !(await read()).trail.filter((t) => t.key === 'none').every((t) => t.delivered); i++) await new Promise((ok) => setTimeout(ok, 100));
  assert.deepEqual((await read()).trail.filter((t) => t.key === 'none').map((t) => [!!t.delivered, !!t.read]), [[true, false]]);
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
  // The shell is small and goes compressed; the stylesheets and the script it names go compressed beside it.
  assert.equal(page.headers['content-encoding'], 'br');
  assert.ok(page.bytes < plainPage, `the page goes compressed: ${page.bytes} of ${plainPage} bytes`);
  for (const name of ['tokens.css', 'ui.css', 'app.css', 'app.js']) {
    const res = await raw(`/${name}`);
    assert.equal(res.headers['content-encoding'], 'br', name);
    assert.ok(res.bytes < readFileSync(new URL(`../web/${name}`, import.meta.url)).length, `${name} goes compressed`);
  }
  assert.equal(state.headers['content-encoding'], 'br');
  // The page's 20-second poll of an unchanged board, and a reload of the page itself, answer 304 with no body.
  assert.deepEqual([(await raw('/api/decisions', { 'if-none-match': state.headers.etag })).status, (await raw('/', { 'if-none-match': page.headers.etag })).status], [304, 304]);
  // A capture's address carries its hash, so the browser keeps it and never asks again; asked by its tag, it is a 304.
  const media = await raw(`/api/media?key=update-1&i=0&h=${hash.slice(0, 16)}`);
  assert.equal(media.headers['cache-control'], 'private, max-age=31536000, immutable');
  assert.equal((await raw('/api/media?key=update-1&i=0', { 'if-none-match': media.headers.etag })).status, 304);

  const { evaluate, send, close } = await browse(join(dir, 'b'), 390, 844, true);
  try {
    // The service worker hands the page back as a body it holds, which the page cannot tell from a download: this test measures the network, so the page goes round it.
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
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
    // The list is rows, six until See all, and no row carries a capture; See all lists all 60 and still loads none: 60 full captures would be over 6 MB.
    await until(() => evaluate('document.querySelectorAll(".ev-card").length === 6'));
    await evaluate('document.querySelector(".ev-sec .see").click()');
    await until(() => evaluate('document.querySelectorAll(".ev-card").length === 60'));
    const first = await fetched();
    assert.ok(first.captures <= 12, `captures on the first screen: ${first.captures}`);
    assert.ok(first.kb <= 1536, `page weight of the first screen: ${first.kb} KB`);
    // Reloaded, the page and the state are 304s (headers only) and every capture comes from the browser's own copy. Chrome keeps a page
    // opened from about:blank apart from the same page reloaded, so the page reloads once to be kept, and the second reload is measured.
    // Each old page is marked, so the counts are read from the reloaded one.
    for (let i = 0; i < 2; i++) {
      await evaluate('window.before = true; location.reload()');
      await until(() => evaluate('!window.before && document.querySelectorAll(".ev-card").length === 6'));
    }
    const again = await fetched();
    assert.ok(again.page < 1024 && again.state.every((b) => b < 1024), `reload: page ${again.page} B, state ${again.state} B`);
    assert.ok(again.media.every((b) => b === 0), `reload refetched a capture: ${again.media}`);
    console.log(`Evidence on a phone: ${first.captures} of 60 captures, ${first.kb} KB; reload ${again.kb} KB`);
  } finally { close(); }
  proc.kill();
});

test('a report opened before its own file arrives draws the moment it does', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  // The screen app-more.js draws, opened cold and while that file is held back: the reader must draw on its own once the file lands, without a second tap.
  const dir = join(scratch, 'late-more'), file = join(dir, 'board.json');
  mkdirSync(dir, { recursive: true });
  const report = { ...JSON.parse(readFileSync(new URL('../fixtures/contract/report.v4/valid-full.json', import.meta.url))), filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  const posted = run('post', file, '--kind', 'report', '--from', join(dir, 'report.json'));
  assert.equal(posted.code, 0, posted.out);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, send, close } = await browse(join(dir, 'b'), 390, 844, true);
  try {
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Fetch.enable', { patterns: [{ urlPattern: '*app-more.js*' }] });
    await evaluate(`location.href = ${JSON.stringify(`${url}#reports/${report.key}`)}`);
    // The page is loaded and the file is still held: the reader is not drawn yet.
    await until(() => evaluate('document.readyState === "complete"'));
    assert.equal(await evaluate('!!document.querySelector(".ra-bar .ra-b.agree")'), false, 'the reader is not drawn before its file');
    await send('Fetch.disable');
    await until(() => evaluate('!!document.querySelector(".ra-bar .ra-b.agree")?.getClientRects().length'));
    assert.equal(await evaluate('!!document.querySelector(".gd-main .gd-foot")'), false, 'the parts carry no buttons of their own');
  } finally { close(); }
  proc.kill();
});

test('the first screen arrives as a small shell beside its own styles and script, and the rest of both only after it has painted', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  // Two asks: the first screen needs the shell, its two base sheets, the state and the small sheet inside the page, and none of the code or rules the
  // screens beyond Today draw with.
  const dir = join(scratch, 'shell'), file = join(dir, 'board.json'), at = new Date().toISOString();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ schema: 2, items: [1, 2].map((n) => ({ key: `ask-${n}`, type: 'decision', number: n, title: `Ship the sign-in change ${n}?`,
    filed: at, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] })) }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const raw = (path, headers = {}) => new Promise((ok, no) => get(`${url}${path.slice(1)}`, { agent: false, headers: { 'accept-encoding': 'gzip, deflate, br', ...headers } }, (r) => {
    const parts = [];
    r.on('data', (b) => parts.push(b)).on('end', () => ok({ status: r.statusCode, headers: r.headers, bytes: Buffer.concat(parts).length, body: Buffer.concat(parts).toString() }));
  }).on('error', no));
  const page = await raw('/'), shell = await (await fetch(url)).text();
  // The shell is a shell: it goes compressed, it is far under 16 KB, and it carries none of the app's code.
  assert.equal(page.headers['content-encoding'], 'br');
  assert.ok(page.bytes < 16 * 1024, `the shell is small: ${page.bytes} bytes`);
  assert.match(shell, /<style id="first">/);
  assert.doesNotMatch(shell, /function render\(|function el\(/, 'the shell carries no app code');
  assert.match(shell, /data-css="app\.css\?v=[0-9a-f]{12}"/);
  assert.match(shell, /data-more="app-more\.js\?v=[0-9a-f]{12}"/);
  // The first screen's files are named in the answer itself, so they start with the page rather than two round trips behind it.
  assert.deepEqual([...String(page.headers.link).matchAll(/<\/(\S+?)\?v=[0-9a-f]{12}>; rel=preload; as=(\w+)/g)].map((m) => `${m[1]} ${m[2]}`),
    ['tokens.css style', 'ui.css style', 'app.js script']);
  // Each file beside it is there, compressed, and a file of its own rather than part of the page.
  for (const name of ['app.css', 'app.js', 'app-more.js']) {
    const res = await raw(`/${name}`);
    assert.equal(res.headers['content-encoding'], 'br', name);
    assert.ok(res.bytes > 1024 && res.bytes < 100 * 1024, `${name}: ${res.bytes} B`);
  }
  const { evaluate, send, close } = await browse(join(dir, 'b'), 390, 844, true);
  try {
    // The page goes round the worker's own copy, so what is held back below is held from the page itself.
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    // Hold the rest of the styles and the rest of the script back: the first screen must still draw, from the small sheet alone and in the phone's own typeface.
    await send('Fetch.enable', { patterns: [{ urlPattern: '*app.css*' }, { urlPattern: '*app-more.js*' }] });
    await evaluate(`location.href = ${JSON.stringify(url)}`);
    await until(() => evaluate('document.querySelectorAll("#board .t-wait .ui-row").length > 0 && !document.querySelector("#board .skel")'));
    assert.equal(await evaluate('document.getElementById("first") !== null'), true, 'the small sheet is still the only one');
    assert.equal(await evaluate('/inter/i.test(getComputedStyle(document.body).fontFamily)'), false, 'the typeface waits with the rest of the styles');
    // Let it go: the small sheet steps aside, the full rules and the rest of the script land, and a screen beyond Today draws with them.
    await send('Fetch.disable');
    await until(() => evaluate('document.getElementById("first") === null'));
    await until(() => evaluate('/inter/i.test(getComputedStyle(document.body).fontFamily)'));
    await evaluate(`location.hash = '#waiting'`);
    await until(() => evaluate('document.querySelectorAll("#board .ui-row").length === 2 && !document.querySelector("#board .skel") && !document.getElementById("banner")?.textContent.trim()'));
  } finally { close(); }
  proc.kill();
});

test('the board paints its first screen from one page of asks, and never asks for the whole board', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  // A board shaped like a long-running one: 1,600 proofs and 20 plans, whose report bodies are what a first screen must never carry.
  const dir = join(scratch, 'first-screen'), file = join(dir, 'board.json');
  mkdirSync(dir, { recursive: true });
  copyFileSync(new URL('../fixtures/sample-decisions.json', import.meta.url), file);
  const board = JSON.parse(readFileSync(file, 'utf8')), at = (n) => new Date(Date.UTC(2026, 9, 11, 12, n)).toISOString();
  const capture = readFileSync(new URL('../fixtures/evidence/product-board.png', import.meta.url)), sha = createHash('sha256').update(capture).digest('hex');
  mkdirSync(join(dir, 'evidence', '1'), { recursive: true });
  writeFileSync(join(dir, 'evidence', '1', '1.png'), capture);
  for (let i = 0; i < 1600; i++) board.decisions.push({ key: `proof-${i}`, type: 'evidence', number: i + 1, title: `Proof ${i}`, about: 'Umer checked the sign-in on a phone. '.repeat(20),
    filed: at(i % 60), media: [{ path: 'evidence/1/1.png', sha256: sha, bytes: capture.length }] });
  for (let i = 0; i < 20; i++) board.decisions.push({ key: `plan-${i}`, type: 'plan', kind: 'plan', view: `plan-${i}.html`, title: `Plan ${i} to approve`, filed: at(i),
    sections: [{ id: 's1', stage: 'overview', heading: 'Detail', body: `plan body ${i} `.repeat(700), blocks: [] }] });
  for (let i = 0; i < 20; i++) board.decisions.push({ key: `ask-${i}`, type: 'decision', title: `Ship the sign-in change ${i}?`, filed: at(i), options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] });

  writeFileSync(file, JSON.stringify(board));
  const whole = Buffer.byteLength(JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, click, send, close } = await browse(join(dir, 'b'), 390, 844, true);
  // What the page asked the board for, as the browser recorded it: the address and the bytes it took.
  const reads = () => evaluate(`performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/decisions'))
    .map((e) => [e.name.slice(e.name.indexOf('/api')), e.transferSize])`);
  try {
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await evaluate(`location.href = ${JSON.stringify(url)}`);
    // The asks are on screen, drawn, with the skeleton gone.
    await until(() => evaluate('!!document.querySelector("#board .t-wait .ui-row, #board .t-up") && !document.querySelector("#board .skel")'));
    const first = await reads();
    assert.match(first[0][0], /^\/api\/decisions\?view=asks&limit=20$/, `the first board read is one page of asks: ${first[0][0]}`);
    assert.ok(first[0][1] < 100_000, `the first screen is under 100 KB: ${first[0][1]} bytes, on a board of ${whole}`);
    // The whole board is never asked for, before or after the paint: not once, on any screen this journey opens.
    const asked = async () => (await reads()).filter(([path]) => path === '/api/decisions' || path === '/api/state');
    assert.deepEqual(await asked(), [], 'no read of the whole board');
    assert.ok(!(await reads()).some(([path]) => !/^\/api\/decisions\?view=(asks|items|lists|card|tickets)\b/.test(path)), 'every read is a part of the board');
    // The board fills in from pages: the Evidence screen lists proofs, and each row still says what done-done says of it.
    await evaluate('location.hash = "#evidence"');
    await until(() => evaluate('document.querySelectorAll("#board .ev-card").length > 0'));
    assert.ok((await reads()).some(([path]) => path.startsWith('/api/decisions?view=items')), 'the rest of the board comes a page at a time');
    assert.equal(await evaluate('document.querySelectorAll("#board .skel").length'), 0, 'a painted board never falls back to the skeleton');
    // A proof opens where it is tapped, and the proof itself comes whole: its captures and its panel are not in the row it was listed in.
    const box = await evaluate('(() => { const r = document.querySelector("#board .ev-card").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()');
    await click(box);
    await until(() => evaluate('!!document.querySelector("#board .ev-open .ev-go")'));
    await until(async () => (await reads()).some(([path]) => path.startsWith('/api/decisions?view=card&key=')));
    // The Tickets screen asks for its own roll-up, which no page carries.
    await evaluate('location.hash = "#tickets"');
    await until(() => evaluate('(performance.getEntriesByType("resource") ?? []).some((e) => e.name.includes("view=tickets"))'));
    assert.deepEqual(await asked(), [], 'still no read of the whole board');
    console.log(`first screen: ${first[0][1]} B of a ${whole} B board; reads: ${(await reads()).map(([p, b]) => `${p} ${b}B`).join(', ')}`);
  } finally { close(); proc.kill(); }
});

test('installable app: a valid manifest, a service worker that keeps the page and the last state, and the board read offline with a clear line, nothing written', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const file = join(scratch, 'installable.json');
  assert.equal(run('raise', file, '--key', 'offline-x', '--title', 'Keep the old login screen?').code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const manifest = await (await fetch(`${url}manifest.webmanifest`)).json();
  assert.deepEqual([manifest.name, manifest.short_name, manifest.display, manifest.start_url, manifest.scope, manifest.id], ['sign-off', 'sign-off', 'standalone', '/', '/', '/']);
  assert.deepEqual(manifest.icons.map((i) => [i.sizes, i.purpose]), [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]);
  for (const icon of manifest.icons) assert.equal((await fetch(`${url}${icon.src}`)).headers.get('content-type'), 'image/png');
  const worker = await fetch(`${url}sw.js`);
  assert.deepEqual([worker.status, worker.headers.get('content-type'), worker.headers.get('cache-control')], [200, 'text/javascript; charset=utf-8', 'no-cache']);
  assert.match(await worker.text(), /^const BUILD = "[0-9a-f]{16}";/);
  const { evaluate, send, close } = await browse(scratch, 390, 844, true);
  try {
    await evaluate(`location.href = ${JSON.stringify(url)}`);
    await until(() => evaluate('!!document.querySelector("#board .t-wait, #board .t-up, #board h1")'));
    // The worker takes over the page, and a read of the state through it is the copy kept for later.
    await until(() => evaluate('navigator.serviceWorker.ready.then(() => !!navigator.serviceWorker.controller)'));
    assert.equal(await evaluate('fetch("/api/decisions").then((r) => r.status)'), 200);
    // The test's browser context is private, which Chrome alone refuses an install for: no manifest, icon, worker or origin error.
    assert.deepEqual((await send('Page.getInstallabilityErrors')).installabilityErrors.map((e) => e.errorId), ['in-incognito']);
    assert.equal(await evaluate('document.getElementById("offline").hidden'), true);
    // The board goes away. A reload still draws it from the kept page and state, says so, and a send fails and leaves nothing kept.
    proc.kill();
    await new Promise((ok) => proc.once('exit', ok));
    await evaluate('window.before = true; location.reload()');
    await until(() => evaluate('!window.before && !document.getElementById("offline").hidden && document.body.innerText.includes("Keep the old login screen?")'));
    assert.equal(await evaluate('document.getElementById("offline").textContent'), 'Offline, showing the last update');
    assert.equal(await evaluate('fetch("/api/answers", { method: "POST", body: "{}" }).then(() => "sent", () => "failed")'), 'failed');
    assert.deepEqual(await evaluate('caches.open("state").then((c) => c.keys()).then((k) => k.map((r) => new URL(r.url).pathname))'), ['/api/decisions']);
  } finally { await close(); proc.kill(); }
});

test('a card names its ticket: --ticket on every post, a Ticket row that opens the ticket, the ticket lists its cards newest first, each card shows its Activity, and the Tickets tab lists the tickets', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'ticket'), file = join(dir, 'board.json'), fx = new URL('../fixtures/contract/', import.meta.url).pathname, now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  mkdirSync(join(dir, 'design'), { recursive: true });
  for (const f of readdirSync(join(fx, 'design.v1/design'))) writeFileSync(join(dir, 'design', f), readFileSync(join(fx, 'design.v1/design', f)));
  writeFileSync(join(dir, 'shot.png'), png);
  writeFileSync(join(dir, 'settings.svg'), readFileSync(new URL('../docs/logo.svg', import.meta.url)));
  assert.equal(run('project', file, '--name', 'Settings', '--icon', 'settings.svg').code, 0);
  // A ticket stands alone: a new one needs a title, a later write changes only what it gives, and a bad value is refused before anything is written.
  assert.equal(run('ticket', file, '--id', 'T-29', '--progress', '20').code, 2);
  assert.equal(existsSync(join(dir, 'board.tickets.jsonl')), false);
  assert.equal(run('ticket', file, '--id', 'T-9', '--title', 'The new settings page', '--progress', '45').code, 0);
  assert.equal(run('ticket', file, '--id', 'T-29', '--title', 'Ship the new settings page', '--progress', '20', '--parent', 'T-9').code, 0);
  assert.match(run('ticket', file, '--id', 'T-29', '--progress', '60').out, /status: updated/);
  for (const bad of [['--progress', '101'], ['--progress', '4.5'], ['--parent', 'T-29'], ['--title', ' '], ['--id', 'bad id']]) assert.equal(run('ticket', file, '--id', 'T-29', ...bad).code, 2, bad.join(' '));
  // A ticket may carry a priority, a project, whether it is on hold and whether the user asked for it; an empty value takes one off, and a bad one is refused.
  assert.equal(run('ticket', file, '--id', 'T-9', '--priority', 'P1', '--project', 'Settings', '--asked', 'yes').code, 0);
  assert.equal(run('ticket', file, '--id', 'T-31', '--title', 'Write the release notes', '--priority', 'P2', '--hold', 'yes', '--hold-reason', 'waiting on the store review', '--stage', 'building', '--last-event-at', String(Math.floor(Date.now() / 1000) - 18 * 3600)).code, 0);
  assert.equal(run('ticket', file, '--id', 'T-32', '--title', 'Choose the rollout date', '--progress', '25', '--state', 'on hold', '--hold-reason', 'waiting on the rollout date', '--asked', 'yes').code, 0);
  assert.equal(run('ticket', file, '--id', 'T-31', '--priority', '').code, 0);
  // Sync fields round-trip through the public CLI, preserve old flags and clear independently.
  const getTicket = () => JSON.parse(run('ticket', file, '--id', 'T-29', '--json').out).ticket;
  const prs = ['https://github.com/example/app/pull/1', 'https://github.com/example/app/pull/2'];
  assert.equal(run('ticket', file, '--id', 'T-29', '--release', '0.6.1', '--state', 'queued', '--pr', prs.join(','), '--pr', prs[0]).code, 0);
  assert.deepEqual([getTicket().release, getTicket().state, getTicket().prs], ['0.6.1', 'queued', prs]);
  assert.match(run('ticket', file, '--id', 'T-29', '--release', '0.6.1').out, /status: unchanged/);
  for (const bad of [['--state', 'unknown'], ['--pr', 'javascript:alert(1)'], ['--pr', '/pull/1'], ['--release', 'x'.repeat(41)]]) {
    const before = readFileSync(join(dir, 'board.tickets.jsonl'), 'utf8');
    assert.equal(run('ticket', file, '--id', 'T-29', ...bad).code, 2);
    assert.equal(readFileSync(join(dir, 'board.tickets.jsonl'), 'utf8'), before);
  }
  assert.equal(run('ticket', file, '--id', 'T-29', '--release', '', '--state', '', '--pr', '').code, 0);
  assert.deepEqual([getTicket().release, getTicket().state, getTicket().prs], [undefined, undefined, undefined]);
  // Stage and last event are sync facts, independent of the percentage and legacy state.
  assert.equal(run('ticket', file, '--stage', 'review').code, 2);
  assert.equal(run('ticket', file, '--last-event-at', '1792820000').code, 2);
  for (const stage of ['queued', 'building', 'review', 'merging', 'done']) {
    assert.equal(run('ticket', file, '--id', 'T-29', '--stage', stage, '--last-event-at', '1792820000').code, 0);
    assert.deepEqual([getTicket().stage, getTicket().last_event_at, getTicket().progress], [stage, 1792820000, 60]);
  }
  assert.equal(run('ticket', file, '--id', 'T-29', '--last-event-at', '2026-10-24T06:53:20Z').code, 0);
  assert.equal(getTicket().last_event_at, 1792824800);
  assert.match(run('ticket', file, '--id', 'T-29', '--stage', 'done').out, /status: unchanged/);
  for (const bad of [['--stage', 'started'], ['--last-event-at', 'yesterday'], ['--last-event-at', '-1'], ['--last-event-at', 'Infinity'], ['--last-event-at', '2026-02-30T00:00:00Z'], ['--last-event-at', '2026-10-24T00:00:00+04:00'], ['--last-event-at', '99999999999999999'], ['--comment', '{}', '--stage', 'done']]) {
    const before = readFileSync(join(dir, 'board.tickets.jsonl'), 'utf8');
    assert.equal(run('ticket', file, '--id', 'T-29', ...bad).code, 2, bad.join(' '));
    assert.equal(readFileSync(join(dir, 'board.tickets.jsonl'), 'utf8'), before);
  }
  assert.equal(run('ticket', file, '--id', 'T-29', '--stage', '', '--last-event-at', '').code, 0);
  assert.deepEqual([getTicket().stage, getTicket().last_event_at], [undefined, undefined]);
  const lines = readFileSync(join(dir, 'board.tickets.jsonl'), 'utf8');
  for (const bad of [['--priority', 'P7'], ['--hold', 'maybe'], ['--asked', '1'], ['--project', 'x'.repeat(41)]]) assert.equal(run('ticket', file, '--id', 'T-31', ...bad).code, 2, bad.join(' '));
  assert.equal(readFileSync(join(dir, 'board.tickets.jsonl'), 'utf8'), lines);
  // The roll-up: T-9 is as far along as the one ticket under it (60%), though its own line says 45; the file keeps what was written.
  const tickets = Object.fromEntries(JSON.parse(run('ticket', file, '--json').out).tickets.map((t) => [t.id, t]));
  assert.deepEqual([tickets['T-9'].progress, tickets['T-9'].priority, tickets['T-9'].project, tickets['T-9'].asked, tickets['T-31'].hold, tickets['T-31'].priority], [60, 'P1', 'Settings', true, true, undefined]);
  assert.equal(lines.trim().split('\n').map((l) => JSON.parse(l)).filter((t) => t.id === 'T-9').at(-1).progress, 45);
  // Every way a card gets in takes --ticket, or "ticket" in its message or --from item: flags, an evidence update, contract messages, a feed file and a sign-in.
  const fileOf = (name, m) => (writeFileSync(join(dir, name), JSON.stringify(m)), join(dir, name)), session = '5f0c2b7e-9a41-4c3e-8d2a-6b7f1e0c9d34';
  const report = JSON.parse(readFileSync(join(fx, 'report.v4/valid-minimal.json'), 'utf8'));
  const posts = [
    ['raise', file, '--ticket', 'T-29', '--key', 'ask-linked', '--title', 'Ship the settings page on Friday?', '--filer', session],
    ['raise', file, '--ticket', 'T-32', '--key', 'ask-hold-release', '--title', 'Can the rollout proceed now?'],
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
  assert.deepEqual(stored, { 'ask-linked': 'T-29', 'ask-hold-release': 'T-32', 'ask-plain': undefined, 'ask-unknown': 'T-404', 'update-1': 'T-29', 'chat-journeys': 'T-29', 'digest-ran': 'T-29', 'faster-sign-in': 'T-29', 'from-linked': 'T-29', npm: 'T-29' });
  // The captain's own words sit on an ask card as its body, longer than its short title: the board keeps them as written.
  const askBody = 'Make the settings page ship on Friday, but only if the theme switch is done.\n\nIf it slips, say so on Thursday and move the date. Do not drop the theme switch to make the day.';
  const filed = JSON.parse(readFileSync(file, 'utf8'));
  for (const i of filed.items) if (['ask-linked', 'from-linked', 'chat-journeys'].includes(i.key)) i.body = askBody;
  writeFileSync(file, JSON.stringify(filed));
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
  const askReleaseBefore = Math.floor(Date.now() / 1000);
  assert.equal((await post(url, 'api/answers', { key: 'ask-hold-release', answer: 'yes' })).status, 200);
  const askReleased = JSON.parse(run('ticket', file, '--id', 'T-32', '--json').out).ticket;
  assert.deepEqual([askReleased.hold, askReleased.state], [false, 'in progress']);
  assert.ok(askReleased.last_event_at >= askReleaseBefore && askReleased.last_event_at <= Math.floor(Date.now() / 1000), JSON.stringify(askReleased));
  const askActivity = await (await fetch(`${url}api/state?view=tickets`)).json();
  assert.ok(Array.isArray(askActivity.ticketActivity) && askActivity.ticketActivity.some((e) => e.ticket === 'T-32' && e.kind === 'release' && e.text === 'Hold released'), JSON.stringify(askActivity));
  const { evaluate, send, close } = await browse(dir, 390, 844, true);
  try {
    // Each linked card's screen shows one Ticket row of its panel (on an ask, Its ask), the ticket's title and progress, opening its page; a card with no ticket, or one not on the board, shows none.
    const row = `(() => { const top = document.querySelector('#reader:not([hidden])') ?? document; const r = [...top.querySelectorAll('.ui-props a.ui-pr[href^="#ticket/"]')];
      return r.length + '|' + r.map((x) => x.getAttribute('href') + ' ' + x.getAttribute('aria-label').replace(/^.*?: (.*), (\\d+)% done$/i, '$1 $2%')).join(); })()`;
    for (const [hash, seen] of [['#decide/ask-linked', 1], ['#decide/ask-plain', 0], ['#decide/ask-unknown', 0], ['#decide/npm', 1], ['#decide/from-linked', 1], ['#evidence/update-1', 1], ['#designs/chat-journeys', 1], ['#reports/digest-ran', 1], ['#waiting/faster-sign-in', 1]]) {
      await evaluate(`location.href = ${JSON.stringify(url + hash)}`);
      await until(async () => (await evaluate(`document.querySelector('#board h1, #reader:not([hidden]) h1') !== null && location.hash === ${JSON.stringify(hash)}`)) === true && (await evaluate(row)) === (seen ? '1|#ticket/T-29 Ship the new settings page 60%' : '0|'));
      assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true, hash);
    }
    // A proof's sheet shows its ticket as the Its ask row of its panel, as the prototype names it: the title, a bar once work on it has begun (full at 100%) and the percent, opening the ticket's page.
    await evaluate(`location.href = ${JSON.stringify(`${url}#evidence/update-1`)}`);
    await until(async () => (await evaluate('(() => { const r = [...document.querySelectorAll("#reader:not([hidden]) .ev-props a.ui-pr")].filter((a) => a.getAttribute("href").startsWith("#ticket/")); return r.length + "|" + r.map((x) => x.getAttribute("href") + " " + x.innerText.replace(/\\s+/g, " ").trim() + " " + !!x.querySelector(".ui-bar")).join(); })()')) === '1|#ticket/T-29 Its ask Ship the new settings page 60% true');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true);
    // On Evidence the proof's row shows done-done's word, not a bar (the opened row's panel and the proof's sheet carry it); a finished ticket shows a full bar at 100%, and one not begun shows no bar: its row shows the project and time, and its panel reads Not started.
    const bars = `(() => { const row = document.querySelector("#item-update-1 .l2"), sheet = [...document.querySelectorAll("#reader:not([hidden]) .ev-props a.ui-pr")].find((a) => a.getAttribute("href").startsWith("#ticket/"));
      return JSON.stringify([row?.querySelector(".ui-bar i")?.style.width ?? "none", row?.querySelector(".pct")?.textContent ?? "", sheet?.querySelector(".ui-bar i")?.style.width ?? "none", sheet?.querySelector(".n").textContent]); })()`;
    for (const [progress, want] of [[100, ['none', '', '100%', '100%']], [0, ['none', '', 'none', 'Not started']], [60, ['none', '', '60%', '60%']]]) {
      assert.equal(run('ticket', file, '--id', 'T-29', '--progress', String(progress)).code, 0);
      await evaluate('refresh()');
      await until(async () => (await evaluate(bars)) === JSON.stringify(want));
    }
    // The row opens the ticket over Tickets: its project (its epic's) and where it stands, its title, what it sits under, then its seven cards newest first, each opening where it lives; Close returns to the card.
    await evaluate(`location.href = ${JSON.stringify(`${url}#decide/ask-linked`)}`);
    await until(() => evaluate('!!document.querySelector(".decide .ui-props a[href^=\'#ticket/\']")'));
    await evaluate('document.querySelector(".decide .ui-props a[href^=\'#ticket/\']").click()');
    await until(async () => (await evaluate('location.hash')) === '#ticket/T-29' && (await evaluate('document.querySelectorAll(".tk-sheet .tk-in li").length')) === 7);
    const page = JSON.parse(await evaluate(`JSON.stringify({ head: document.querySelector('.tk-sheet .tk-shd p > span:last-child').textContent, title: document.querySelector('.tk-sheet .tk-dt').textContent,
      props: [...document.querySelectorAll('.tk-sheet > .ui-props > .ui-pr')].map((p) => p.innerText.replace(/\\s+/g, ' ').trim()).filter((p) => !p.startsWith('Last update')),
      rows: [...document.querySelectorAll('.tk-sheet .tk-in a')].map((a) => [a.querySelector('.t').textContent.replace(/^Update \\d+ · /, ''), a.getAttribute('href')]),
      tab: document.querySelector('#tabs a[aria-current]')?.getAttribute('href'), wide: document.documentElement.scrollWidth > 390 })`));
    assert.deepEqual({ ...page, rows: page.rows.map(([t]) => t) }, { head: 'Settings · In progress', title: 'Ship the new settings page', props: ['Progress 60%', 'Part of The new settings page', 'Assignee No assignee'], rows: shown.cards.map((c) => c.title), tab: '#tickets', wide: false });
    assert.deepEqual(['Ship the settings page on Friday?', 'Settings on a phone', 'Approve the chat app journeys?', 'The weekly digest ran'].map((t) => Object.fromEntries(page.rows)[t]), ['#decide/ask-linked', '#evidence/update-1', '#designs/chat-journeys', '#reports/digest-ran']);
    assert.equal(run('ticket', file, '--id', 'T-29', '--release', '0.6.1', '--state', 'on hold', '--hold-reason', 'waiting on the store review', '--pr', prs[0], '--pr', prs[1]).code, 0);
    await evaluate('refresh()');
    await until(() => evaluate('document.querySelector(".tk-sheet .tk-release")?.textContent === "0.6.1"'));
    assert.equal(await evaluate('document.querySelector(".tk-sheet .tk-shd").textContent.includes("On hold")'), true);
    assert.deepEqual(JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll(".tk-sheet .tk-in a[target]")].map(a => a.href))')), prs);
    for (const [value, word] of [['queued', 'To do'], ['in progress', 'In progress'], ['done', 'Done']]) {
      assert.equal(run('ticket', file, '--id', 'T-29', '--state', value).code, 0);
      await evaluate('refresh()');
      await until(() => evaluate(`document.querySelector('.tk-sheet .tk-shd').textContent.includes(${JSON.stringify(word)})`));
    }
    assert.equal(run('ticket', file, '--id', 'T-29', '--release', '', '--state', '', '--pr', '').code, 0);
    await evaluate('refresh()');
    await until(() => evaluate('!document.querySelector(".tk-sheet .tk-release")'));
    await evaluate('document.querySelector(".tk-sheet .tk-shd .x").click()');
    await until(async () => (await evaluate('location.hash')) === '#decide/ask-linked');
    // The ticket above it lists the ticket under it, and no card names it.
    await evaluate(`location.href = ${JSON.stringify(`${url}#ticket/T-9`)}`);
    await until(async () => (await evaluate('[...document.querySelectorAll(".tk-sheet a.tk-row")].map((a) => a.getAttribute("href")).join()')) === '#ticket/T-29');
    assert.equal(await evaluate('[...document.querySelectorAll(".tk-sheet > .ui-dl, .tk-sheet > .es b")].map((p) => p.textContent).join(" | ")'), 'Assigned | Tickets in this epic · 0 of 1 done | Linked | No cards yet');
    // A ticket's tiles wear its type's own glyph, never the project's picture or its initials.
    assert.equal(await evaluate('[...document.querySelectorAll(".tk-sheet .tk-shd .ui-icon, .tk-sheet .tk-in .tk-row .ui-icon")].every((t) => /\\btk-tile t-/.test(t.className)) && !document.querySelector(".tk-sheet .mono") && !document.querySelector(".tk-sheet .ui-icon img")'), true);
    // The Tickets tab lists the tickets under no other, all of them unless the filter's Who asked says From you (T-9 and T-32, which the user asked for) or Fleet upkeep (T-31, on hold). T-29 sits under T-9, so it is not listed on its own.
    const tab = `JSON.stringify({ seg: [...document.querySelectorAll('.tk-seg button')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? ' on' : '')), hero: document.querySelector('.tk-hero').innerText.replace(/\\s+/g, ' ').trim(),
      lists: [...document.querySelectorAll('main section[aria-label]:not(.tk-activity)')].map((x) => x.getAttribute('aria-label') + ' ' + [...x.querySelectorAll('a.tk-row')].map((a) => a.getAttribute('href')).join()) })`;
    await evaluate(`location.href = ${JSON.stringify(`${url}#tickets`)}`);
    await until(() => evaluate('!!document.querySelector(".tk-hero")'));
    assert.equal(await evaluate('[...document.querySelectorAll("main .tk-row .ui-icon")].every((t) => /\\btk-tile t-/.test(t.className)) && !document.querySelector("main .tk-row .mono") && !document.querySelector("main .tk-row .ui-icon img")'), true);
    assert.deepEqual(JSON.parse(await evaluate(tab)), { seg: ['All tickets on', 'Epics', 'Activity'], hero: 'Tickets done 0 of 3 2 moving', lists: ['In progress #ticket/T-9,#ticket/T-32', 'On hold #ticket/T-31'] });
    const who = (word) => evaluate(`document.querySelector('.tk-rb').click(), [...document.querySelectorAll('#tk-filter .tk-pick')].find((b) => b.textContent.startsWith(${JSON.stringify(word)})).click()`);
    await who('Fleet upkeep');
    await until(async () => JSON.parse(await evaluate(tab)).lists.join() === 'On hold #ticket/T-31');
    await who('From you');
    await until(async () => JSON.parse(await evaluate(tab)).lists.join() === 'In progress #ticket/T-9,#ticket/T-32');
    await who('Everyone');
    await until(async () => JSON.parse(await evaluate(tab)).lists.join() === 'In progress #ticket/T-9,#ticket/T-32,On hold #ticket/T-31');
    await who('Fleet upkeep');
    await until(async () => JSON.parse(await evaluate(tab)).lists.join() === 'On hold #ticket/T-31');
    assert.equal(run('ticket', file, '--id', 'new-arrival', '--title', 'A newly synced ticket').code, 0);
    // No manual refresh: the open Tickets page finds this standalone ticket on its next 20-second poll.
    await until(async () => JSON.parse(await evaluate(tab)).lists.includes('To do #ticket/new-arrival'));
    // Activity is collapsed by default on a phone; open it before checking its entries.
    await evaluate('document.querySelector(".tk-activity > summary").click()');
    await until(() => evaluate('document.querySelector(".tk-activity").open'));
    const feed = await evaluate('JSON.stringify([...document.querySelectorAll(".tk-activity .tk-ev")].map((b) => b.getAttribute("aria-label")))');
    assert.match(feed, /Ticket created/); assert.match(feed, /Stage moved to done/); assert.match(feed, /Progress changed to 60%/); assert.match(feed, /Ticket merged/); assert.match(feed, /Put on hold/);
    const oldEvent = Math.floor(Date.now() / 1000) - 18 * 3600;
    const reply = JSON.stringify({ id: 'hold-reply', at: oldEvent, text: 'What should I choose?', picked: oldEvent, replies: [{ at: oldEvent, text: 'Squad Lead' }] });
    assert.equal(run('ticket', file, '--id', 'T-31', '--comment', reply).code, 0);
    const inspectRelease = `(async () => { const fresh = await fetch('/api/decisions?view=tickets').then((r) => r.json()), feed = document.querySelector('.tk-activity'); return { ticket: fresh.tickets.find((t) => t.id === 'T-31'), client: state.tickets.find((t) => t.id === 'T-31'), rows: [...document.querySelectorAll('.tk-row')].map((a) => (a.closest('section[aria-label]')?.getAttribute('aria-label') ?? '') + ' ' + a.getAttribute('href')), activityOpen: feed?.open, activityText: [...(feed?.querySelectorAll('.tk-ev') ?? [])].map((b) => b.getAttribute('aria-label')).join(' | ') }; })()`;
    // The next poll must clear the held row and paint its release event without a reload or manual refresh.
    await until(async () => { const r = await evaluate(inspectRelease); return !r.ticket.hold && !r.client.hold && r.rows.includes('To do #ticket/T-31') && r.activityOpen && r.activityText.includes('Hold released'); });
    const releaseCheck = await evaluate(inspectRelease);
    const released = releaseCheck;
    assert.equal(released.ticket.hold, false, JSON.stringify(releaseCheck));
    assert.equal(released.ticket.state, 'queued', JSON.stringify(releaseCheck));
    assert.equal(released.client.hold, false, JSON.stringify(releaseCheck));
    assert.ok(released.rows.includes('To do #ticket/T-31'), JSON.stringify(releaseCheck));
    assert.ok(!released.rows.includes('On hold #ticket/T-31'), JSON.stringify(releaseCheck));
    await until(() => evaluate('document.querySelector(".tk-activity").open && !!document.querySelector(".tk-activity .tk-ev[aria-label*=\\"Hold released\\"]")'));
    for (let i = 0; i < 51; i++) assert.equal(run('ticket', file, '--id', `feed-cap-${i}`, '--title', `Feed cap ${i}`).code, 0);
    await evaluate('refresh()');
    await until(() => evaluate('document.querySelectorAll(".tk-activity .tk-ev").length === 50'));
    // A row of the phone's card opens the same view as a sheet over the board; Escape closes it and the focus is back on that row.
    await evaluate('document.querySelector(".tk-activity .tk-ev").click()');
    await until(() => evaluate('!!document.querySelector("dialog.tk-evs[open]")'));
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(() => evaluate('!document.querySelector("dialog.tk-evs[open]") && document.activeElement === document.querySelector(".tk-activity .tk-ev")'));
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(`location.href = ${JSON.stringify(`${url}#ticket/T-31`)}`);
    await until(() => evaluate('!!document.querySelector(".tk-sheet") && !document.querySelector(".tk-sheet .tk-stuck")'));
    assert.equal(await evaluate('document.querySelector(".tk-sheet .tk-shd").innerText.includes("On hold")'), false);
    assert.match(await evaluate('document.querySelector(".tk-sheet .ui-act").innerText'), /Hold released/);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true);
    // A card's Activity: nothing while its posting is all there is; then each answer with its note, the change, its agent taking it and a new round, oldest first.
    // The agent posted under a session id, which names nobody, so it reads Agent. The ticket's page shows those steps under the card's name.
    const thread = (hash) => `(async () => { location.hash = ${JSON.stringify(hash)}; await new Promise((ok) => setTimeout(ok, 50)); const top = document.querySelector('#reader:not([hidden])') ?? document;
      return [...top.querySelectorAll('.ui-act li')].map((li) => [li.querySelector('b').textContent, li.querySelector('.th-n')?.textContent].filter(Boolean).join(' ')).join(' | '); })()`;
    assert.equal(await evaluate(thread('#decide/ask-linked')), '');
    for (const [answer, note] of [['no', 'Not this week.'], ['yes', 'After the Friday stand-up.']]) assert.equal((await post(url, 'api/answers', { key: 'ask-linked', answer, note })).status, 200);
    assert.equal(run('wait', file, '--filer', session, '--key', 'ask-linked', '--timeout', '5').code, 0);
    assert.equal((await post(url, 'api/rounds', { key: 'ask-linked', note: 'Show it on a phone first.' })).status, 200);
    await evaluate('window.old = true, location.reload()');
    await until(() => evaluate('!window.old'));
    const steps = ['Your answer: No “Not this week.”', 'Changed to: Yes “After the Friday stand-up.”', 'Delivered to Agent', 'Agent read it', 'You asked for a new round “Show it on a phone first.”'];
    await until(async () => (await evaluate(thread('#decide/ask-linked'))) === ['Posted by Agent', ...steps].join(' | '));
    // The ticket shows its cards' steps newest first, each naming its card.
    const tkThread = `(async () => { location.hash = '#ticket/T-29'; await new Promise((ok) => setTimeout(ok, 50));
      return [...document.querySelectorAll('.ui-act li')].filter((li) => li.querySelector('.on')).map((li) => [li.querySelector('b').textContent, li.querySelector('.th-n')?.textContent, li.querySelector('.on').textContent].filter(Boolean).join(' ')).join(' | '); })()`;
    assert.equal(await evaluate(tkThread), [...steps].reverse().map((x) => `${x} Ship the settings page on Friday?`).join(' | '));
    assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true);
    // The Activity tab: every row carries the cards' tags and opens an expanded view, by tap and by key; Escape puts the focus back on the row; the ticket opens from the view.
    assert.equal(run('ticket', file, '--id', 'T-29', '--progress', '75', '--pr', prs.join(','), '--asked', 'yes', '--filer', 'firstmate-crew').code, 0);
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`location.hash = '#tickets'`);
    await until(() => evaluate('document.querySelectorAll(".tk-seg button").length === 3'));
    assert.equal(await evaluate('[...document.querySelectorAll(".tk-seg button")].map((b) => b.textContent + (b.getAttribute("aria-pressed") === "true" ? " on" : "")).join()'), 'All tickets on,Epics,Activity');
    await evaluate('document.querySelector(".tk-seg button:last-child").click()');
    await evaluate('refresh()');
    const evRow = (text) => `[...document.querySelectorAll('.tk-day .tk-ev')].find((b) => b.getAttribute('aria-label').includes(${JSON.stringify(text)}))`;
    await until(() => evaluate(`location.hash === '#activity' && !!${evRow('Progress changed to 75%')}`));
    // Tags as on the In progress cards: the project's icon and name, the priority chip, the stage chip.
    const tagged = JSON.parse(await evaluate(`JSON.stringify({ days: document.querySelectorAll('.tk-day h2').length > 0, chips: [...document.querySelectorAll('.tk-ev .ui-pc')].map((c) => c.textContent),
      meta: ${evRow('The new settings page P1, ')}.querySelector('.meta').textContent, icon: !!${evRow('The new settings page P1, ')}.querySelector('.ui-icon img'), button: ${evRow('The new settings page P1, ')}.tagName,
      bare: [...document.querySelectorAll('.tk-ev')].filter((r) => !r.querySelector('.ui-pc.p0, .ui-pc.p1, .ui-pc.p2, .ui-pc.p3') && r.getAttribute('aria-label').includes('The new settings page')).length })`));
    assert.deepEqual([tagged.days, tagged.meta, tagged.icon, tagged.button, tagged.bare], [true, 'Settings · Created', true, 'BUTTON', 0]);
    assert.ok(tagged.chips.includes('P1') && tagged.chips.includes('building'), tagged.chips.join());
    const open = () => until(() => evaluate('!!document.querySelector("dialog.tk-evs[open]")'));
    const key = (name, code, vk, text) => send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: vk, ...(text && { text }) }).then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: vk }));
    const sheet = `JSON.stringify((() => { const d = document.querySelector('dialog.tk-evs[open]'); return { title: d.querySelector('h2').textContent, text: d.querySelector('.ui-props').innerText.replace(/\\s+/g, ' '), ticket: d.querySelector('a[href^="#ticket/"]').getAttribute('href'),
      prs: [...d.querySelectorAll('.tk-in a')].map((a) => a.href), time: d.querySelector('time').textContent }; })())`;
    // Tap.
    await evaluate(`${evRow('Progress changed to 75%')}.click()`);
    await open();
    const seen = JSON.parse(await evaluate(sheet));
    assert.equal(seen.title, 'Ship the new settings page');
    assert.match(seen.text, /Progress 60% → to 75%/); assert.match(seen.text, /Made by worker/); assert.doesNotMatch(seen.text, /firstmate/);
    // T-29 changed many times within a minute: one row for the burst, and the view names every change and the captain's own words with their date.
    assert.equal(await evaluate(`[...document.querySelectorAll('.tk-day .tk-ev')].filter((b) => b.getAttribute('aria-label').startsWith('Ship the new settings page')).length`), 1);
    const burstView = JSON.parse(await evaluate(`JSON.stringify({ changes: [...document.querySelectorAll('dialog.tk-evs[open] .tk-chg li')].map((li) => li.textContent), ask: document.querySelector('dialog.tk-evs[open] .tk-ask')?.innerText.replace(/\\s+/g, ' ') })`));
    assert.ok(burstView.changes.length >= 3 && burstView.changes.some((c) => /Ticket created/.test(c)) && burstView.changes.some((c) => /Progress changed to 60%/.test(c)) && /Progress changed to 75% \(60% → 75%\)/.test(burstView.changes.at(-1)), burstView.changes.join(' | '));
    assert.equal(burstView.ask, `${askBody.replace(/\s+/g, ' ')} ${burstView.ask.slice(-21)}`); assert.match(burstView.ask, /\d{1,2} \w{3} \d{4}, \d{2}:\d{2}:\d{2}$/);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
    assert.equal(seen.ticket, '#ticket/T-29'); assert.deepEqual(seen.prs, prs); assert.match(seen.time, /^\d{1,2} \w{3} \d{4}, \d{2}:\d{2}:\d{2}$/);
    // Escape closes it and the focus is back on the row that opened it.
    await key('Escape', 'Escape', 27);
    await until(() => evaluate('!document.querySelector("dialog.tk-evs[open]")'));
    assert.equal(await evaluate(`document.activeElement === ${evRow('Progress changed to 75%')}`), true);
    // Keys: Enter and Space on the focused row open it too.
    for (const [name, code, vk, text] of [['Enter', 'Enter', 13, '\r'], [' ', 'Space', 32, ' ']]) {
      await evaluate(`${evRow('Progress changed to 75%')}.focus()`);
      await key(name, code, vk, text);
      await open();
      assert.equal(JSON.parse(await evaluate(sheet)).title, 'Ship the new settings page');
      await key('Escape', 'Escape', 27);
      await until(() => evaluate('!document.querySelector("dialog.tk-evs[open]")'));
      assert.equal(await evaluate(`document.activeElement === ${evRow('Progress changed to 75%')}`), true);
    }
    // An event written before a writer was named shows no Made by, and a ticket the captain did not ask for shows no words.
    await evaluate(`${evRow('A newly synced ticket')}.click()`);
    await open();
    assert.doesNotMatch(JSON.parse(await evaluate(sheet)).text, /Made by/);
    assert.equal(await evaluate(`document.querySelector('dialog.tk-evs[open] .tk-ask, dialog.tk-evs[open] .tk-chg')`), null);
    await key('Escape', 'Escape', 27);
    await until(() => evaluate('!document.querySelector("dialog.tk-evs[open]")'));
    // The ticket opens from the view; a modified click stays on the board.
    await evaluate(`${evRow('Progress changed to 75%')}.click()`);
    await open();
    assert.equal(await evaluate(`(() => { const link = document.querySelector('dialog.tk-evs[open] a[href^="#ticket/"]');
      for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) { const event = new MouseEvent('click', { bubbles: true, cancelable: true, [key]: true });
        link.addEventListener('click', (e) => e.preventDefault(), { once: true }); link.dispatchEvent(event);
        if (!document.querySelector('dialog.tk-evs[open]')) return false; }
      return true; })()`), true);
    await evaluate(`document.querySelector('dialog.tk-evs[open] a[href^="#ticket/"]').click()`);
    await until(() => evaluate(`location.hash === '#ticket/T-29' && !!document.querySelector('.tk-pane') && !document.querySelector('dialog.tk-evs[open]')`));
    // Filters narrow the timeline; one that matches nothing says so and clears.
    await evaluate(`location.hash = '#activity'`);
    await until(() => evaluate('!!document.querySelector(".tk-sel")'));
    const pick = (i, v) => evaluate(`(() => { const s = document.querySelectorAll('.tk-sel')[${i}]; s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); })()`);
    await pick(1, 'P1');
    assert.equal(await evaluate('[...document.querySelectorAll(".tk-ev")].every((b) => b.querySelector(".ui-pc.p1"))'), true);
    assert.match(await evaluate('document.querySelector(".tk-count").textContent'), /^\d+ of \d+ events$/);
    await pick(1, '');
    await evaluate(`(() => { const s = document.querySelectorAll('.tk-sel')[0]; s.add(new Option('Nowhere', 'Nowhere')); s.value = 'Nowhere'; s.dispatchEvent(new Event('change')); })()`);
    await until(() => evaluate('document.querySelector(".es")?.textContent.includes("No activity matches")'));
    await evaluate('[...document.querySelectorAll(".es button")].find((b) => b.textContent === "Clear filters").click()');
    await until(() => evaluate('document.querySelectorAll(".tk-ev").length > 0'));
  } finally { close(); }
  proc.kill();
});

test('a ticket says who works on it: the tool\'s mark, the model and the lead on its row and in a block on its page, Live for a running worker, a finished task without one, and Unassigned with no Juggernaut home', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'assignee'), file = join(dir, 'board.json'), home = join(dir, 'fleet'), state = join(home, 'state');
  mkdirSync(state, { recursive: true });
  assert.equal(run('raise', file, '--title', 'Ship the page on Friday?', '--why', 'The page is ready.', '--outcome', 'yes=It ships.', '--outcome', 'no=It waits.', '--recommend', 'yes', '--recommend-reason', 'Every check passed.', '--default', 'no', '--ask-ref', 'assignee-test').code, 0);
  // Three tickets: a running Claude Code worker, a Pi task that finished, and one no task record names.
  for (const [id, title, progress] of [['A-1', 'Build the page', '40'], ['A-2', 'Publish it', '70'], ['A-3', 'Write the notes', '10']]) assert.equal(run('ticket', file, '--id', id, '--title', title, '--progress', progress).code, 0);
  writeFileSync(join(state, 'A-1.meta'), 'window=default:w1:p1\nendpoint_task_id=A-1\ntitle=Build the page\nproject=~/fleet/projects/web-app\nharness=claude\nmodel=claude-opus-5-5\n');
  writeFileSync(join(state, 'A-1.status'), 'working [at=1]: building\n');
  writeFileSync(join(state, 'A-2.meta'), 'window=default:w1:p2\nproject=~/fleet/projects/notes\nharness=pi\nmodel=ollama-cloud/deepseek-v4.1-flash\n');
  writeFileSync(join(state, 'A-2.status'), 'done [at=2]: shipped\n');
  const open = async (withHome, width, mobile) => {
    const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env: { ...env, ...(withHome && { SIGN_OFF_FLEET_HOME: home }) }, stdio: ['ignore', 'pipe', 'ignore'] });
    procs.push(proc);
    const url = /url: "(\S+)"/.exec(await served(proc))[1], page = await browse(dir, width, 900, mobile);
    return { url, proc, ...page };
  };
  const line = (id) => `(() => { const r = [...document.querySelectorAll('a.tk-row')].find((a) => a.getAttribute('href') === '#ticket/${id}'); const w = r?.querySelector('.tk-as');
    return w && JSON.stringify({ text: w.innerText.replace(/\\s+/g, ' ').trim(), cls: w.className, logo: w.querySelector('.tk-logo:nth-of-type(2)')?.getAttribute('aria-label') ?? null, vendor: w.querySelector('.tk-logo')?.getAttribute('aria-label') ?? null, vmask: w.querySelector('.tk-logo') ? getComputedStyle(w.querySelector('.tk-logo')).maskImage || getComputedStyle(w.querySelector('.tk-logo')).webkitMaskImage : null, live: !!w.querySelector('.tk-live'),
      mask: w.querySelector('.tk-logo:nth-of-type(2)') ? getComputedStyle(w.querySelector('.tk-logo:nth-of-type(2)')).maskImage || getComputedStyle(w.querySelector('.tk-logo:nth-of-type(2)')).webkitMaskImage : null }); })()`;
  const block = (id) => `(async () => { location.hash = '#ticket/${id}'; await new Promise((ok) => setTimeout(ok, 80)); const b = document.querySelector('.tk-assigned'); return b && JSON.stringify([...b.querySelectorAll('.ui-pr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())); })()`;
  for (const [width, mobile] of [[390, true], [1280, false]]) {
    const { url, proc, evaluate, close } = await open(true, width, mobile);
    try {
      await evaluate(`location.href = ${JSON.stringify(`${url}#tickets`)}`);
      await until(async () => !!(await evaluate(line('A-1'))));
      const a1 = JSON.parse(await evaluate(line('A-1'))), a2 = JSON.parse(await evaluate(line('A-2'))), a3 = JSON.parse(await evaluate(line('A-3')));
      // A row wears one mark, the model's own (the tool's mark is in the ticket's Assigned block), and says who owns it as lead · model.
      assert.deepEqual([a1.vendor, /logos\/anthropic\.svg/.test(a1.vmask), a2.vendor, /logos\/deepseek\.svg/.test(a2.vmask), a1.logo, a2.logo], ['Opus 5.5', true, 'DeepSeek V4.1 Flash', true, null, null]);
      assert.deepEqual([a1.text, a1.live], ['web-app · Opus 5.5 Live', true]);
      // A finished task names its model but shows no Live.
      assert.deepEqual([a2.text, a2.live], ['notes · DeepSeek V4.1 Flash', false]);
      // No record: a quiet word, no mark and no empty box.
      assert.deepEqual([a3.text, a3.cls, a3.logo], ['No assignee', 'tk-as missing', null]);
      // The page of a ticket: one labelled block with the lead, worker, model, tool and whether the worker is live.
      await until(async () => !!(await evaluate(block('A-1'))));
      assert.deepEqual(JSON.parse(await evaluate(block('A-1'))), ['Assignee web-app · Opus 5.5 Live', 'Lead web-app', 'Worker Build the page', 'Model Opus 5.5', 'Tool Claude Code', 'Worker live Live']);
      assert.deepEqual(JSON.parse(await evaluate(block('A-2'))), ['Assignee notes · DeepSeek V4.1 Flash', 'Lead notes', 'Worker None running', 'Model DeepSeek V4.1 Flash', 'Tool Pi', 'Worker live Not running']);
      assert.deepEqual(JSON.parse(await evaluate(block('A-3'))), ['Assignee No assignee']);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      // The row keeps its project icon or kind icon: no monogram tile came with the line.
      assert.equal(await evaluate('!document.querySelector(".tk-row .mono")'), true);
    } finally { await close(); await new Promise((ok) => (proc.exitCode !== null ? ok() : (proc.once('exit', ok), proc.kill()))); }
  }
  // With no home named the same board reads every ticket as unassigned, and nothing breaks.
  const { url, proc, evaluate, close } = await open(false, 390, true);
  try {
    await evaluate(`location.href = ${JSON.stringify(`${url}#tickets`)}`);
    await until(async () => !!(await evaluate(line('A-1'))));
    // A-1 and A-2 are moving with no record, so they read as the defect; A-3 has not started and reads quietly.
    assert.deepEqual([JSON.parse(await evaluate(line('A-1'))).text, JSON.parse(await evaluate(line('A-2'))).text, JSON.parse(await evaluate(line('A-3'))).text], ['No assignee', 'No assignee', 'No assignee']);
    assert.equal(await evaluate('document.querySelectorAll(".tk-logo").length'), 0);
  } finally { await close(); proc.kill(); }
});

test('Tickets on a phone: with one section expanded, See all on each other section expands it, and a list that moves under the finger before the tap lands does not open a ticket', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'see-all'), file = join(dir, 'board.json');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ schema: 2, items: [] }));
  for (const [list, n, flags] of [['mv', 7, ['--progress', '30']], ['hold', 8, ['--hold', 'yes', '--hold-reason', 'waiting on the store review']], ['todo', 6, []], ['done', 7, ['--progress', '100']]])
    for (let i = 0; i < n; i++) assert.equal(run('ticket', file, '--id', `${list}${i}`, '--title', `${list} ticket ${i}`, '--asked', 'yes', ...flags).code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const { evaluate, tap, send, close } = await browse(dir, 390, 844, true);
  try {
    const names = ['In progress', 'On hold', 'To do', 'Done'];
    const see = (name) => `main section[aria-label="${name}"] .ui-sec .see`;
    const where = (name) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(see(name))}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    const lists = () => evaluate(`JSON.stringify({ hash: location.hash, rows: Object.fromEntries([...document.querySelectorAll('main section[aria-label]:not(.tk-activity)')].map((s) => [s.getAttribute('aria-label'), s.querySelectorAll('a.tk-row').length])) })`).then((v) => JSON.parse(v));
    await evaluate(`location.href = ${JSON.stringify(`${url}#tickets`)}`);
    const fresh = async () => { await until(async () => (await evaluate('!!document.querySelector("main section[aria-label] .see")')) === true); await evaluate('window.old = true, location.reload()'); await until(async () => (await evaluate('!window.old && document.querySelectorAll("main section[aria-label] .see").length')) === 4); };
    const sizes = { 'In progress': 7, 'On hold': 8, 'To do': 6, Done: 7 };
    await until(() => evaluate('!!document.querySelector(".tk-activity > summary") && document.querySelectorAll("main section[aria-label]:not(.tk-activity)").length === 4'));
    const activity = await evaluate(`(() => { const feed = document.querySelector('.tk-activity'), lists = [...document.querySelectorAll('main section[aria-label]:not(.tk-activity)')]; return JSON.stringify({ collapsed: !feed.open, listsVisible: lists.length === 4 && lists.every((s) => s.getBoundingClientRect().height > 0), summary: feed.querySelector('summary > span:first-child')?.textContent.trim() }); })()`);
    assert.deepEqual(JSON.parse(activity), { collapsed: true, listsVisible: true, summary: 'Activity' });
    await evaluate('document.querySelector(".tk-activity > summary").click()');
    await until(() => evaluate('document.querySelector(".tk-activity").open'));
    assert.equal(await evaluate('document.querySelectorAll(".tk-activity .tk-ev").length > 0'), true);
    assert.equal(await evaluate('document.querySelector(".tk-activity .tk-feed").scrollHeight > document.querySelector(".tk-activity .tk-feed").clientHeight'), true);
    assert.equal(await evaluate('[...document.querySelectorAll("main section[aria-label]:not(.tk-activity)")].every((s) => s.getBoundingClientRect().height > 0)'), true);
    // Each section expanded in turn, then See all on every other one: it expands, and no ticket opens.
    for (const open of names) for (const other of names.filter((n) => n !== open)) {
      await fresh();
      await tap(await where(open));
      await until(async () => (await lists()).rows[open] === sizes[open]);
      await tap(await where(other));
      await until(async () => (await lists()).rows[other] === sizes[other]);
      const now = await lists();
      assert.equal(now.hash, '#tickets', `${open} expanded, See all on ${other} opened ${now.hash}`);
      assert.deepEqual(now.rows, { 'In progress': 3, 'On hold': 3, 'To do': 3, Done: 3, ...{ [open]: sizes[open], [other]: sizes[other] } });
    }
    // The list moves under the finger between touchstart and the tap (the board redraws, the page settles): the tap still does what its See all does.
    for (const shift of [-30, 30, 60, 120]) {
      await fresh();
      await tap(await where('On hold'));
      await until(async () => (await lists()).rows['On hold'] === 8);
      const [x, y] = await where('To do');
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await evaluate(`document.querySelector('main').style.paddingTop = 'calc(' + getComputedStyle(document.querySelector('main')).paddingTop + ' + ${shift}px)'`);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await until(async () => (await lists()).rows['To do'] === 6);
      assert.equal((await lists()).hash, '#tickets', `a ${shift}px shift opened a ticket`);
    }
    // A tap on a row still opens its ticket.
    await fresh();
    await tap(await evaluate(`(() => { const e = document.querySelector('main a.tk-row'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`));
    await until(async () => /^#ticket\//.test(await evaluate('location.hash')));
  } finally { close(); }
  proc.kill();
});

test('the feedback trail: what the person sends on a card goes Sent, Delivered, Read, then Replied with the agent\'s words and link, on the card, in its Activity, as a badge in the lists and in Today until opened', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'trail'), file = join(dir, 'board.json');
  mkdirSync(dir);
  // Two agents: the release agent's answers are only ever handed over, the settings agent takes its own.
  for (const [key, title, filer] of [['digest', 'Keep the weekly digest?', 'release-agent'], ['export', 'Turn on the CSV export?', 'release-agent'], ['beta', 'Open the beta to every team?', 'settings-agent']]) {
    assert.equal(run('raise', file, '--key', key, '--title', title, '--filer', filer).code, 0);
  }
  // The agent's command refuses what it cannot mark, and writes nothing.
  for (const [args, why] of [[['digest'], /one of --delivered, --read, --reply/], [['digest', '--read', '--acted'], /one of --delivered, --read, --reply/], [['digest', '--read'], /nothing was sent on digest yet/],
    [['digest', '--acted'], /--acted needs --link/], [['digest', '--reply', 'Done.', '--link', 'not a link'], /http\(s\) address/], [['nope', '--read'], /no card with key nope/]]) {
    const r = run('feedback', ...args.slice(0, 1), file, ...args.slice(1));
    assert.notEqual(r.code, 0, args.join(' ')); assert.match(r.out, why, args.join(' '));
  }
  assert.equal(existsSync(join(dir, 'board.trail.jsonl')), false);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  const trail = async (key) => (await (await fetch(`${url}api/decisions`)).json()).trail.filter((x) => x.key === key).at(-1);
  // Sent: answered, and nothing has taken it.
  assert.equal((await post(url, 'api/answers', { key: 'digest', answer: 'yes' })).status, 200);
  // Delivered: a wait that is not the agent's own (a hook's poller) hands the answer over.
  const handing = spawn(process.execPath, [cli, 'wait', file, '--key', 'export', '--timeout', '20'], { env, stdio: 'ignore' });
  await new Promise((ok) => setTimeout(ok, 700));
  assert.equal((await post(url, 'api/answers', { key: 'export', answer: 'yes', note: 'Only the admin role.' })).status, 200);
  assert.equal(await new Promise((ok) => handing.once('exit', ok)), 0);
  // Read, then Replied: the agent's own wait takes the beta answer, and it replies with what it did and the pull request; another filer may not mark it.
  assert.equal((await post(url, 'api/answers', { key: 'beta', answer: 'no', note: 'Wait for the import fix.' })).status, 200);
  assert.equal(run('wait', file, '--filer', 'settings-agent', '--timeout', '5').code, 0);
  const steps = async (key) => { const t = await trail(key); return [t.at, t.delivered, t.read, t.reply?.at].map(Boolean).join(); };
  assert.deepEqual([await steps('digest'), await steps('export'), await steps('beta')], ['true,false,false,false', 'true,true,false,false', 'true,true,true,false']);
  assert.match(run('feedback', 'beta', file, '--reply', 'Kept it to ten teams.', '--filer', 'other-agent').out, /was not posted by other-agent/);
  assert.match(run('feedback', 'beta', file, '--reply', 'Kept it to ten teams until the import fix lands.', '--link', 'https://github.com/example/settings/pull/245', '--filer', 'settings-agent').out, /shows: Replied/);
  assert.deepEqual((await trail('beta')).reply, { at: (await trail('beta')).reply.at, text: 'Kept it to ten teams until the import fix lands.', link: 'https://github.com/example/settings/pull/245' });
  // A comment the person made on a ticket in the fleet dashboard arrives in the dashboard's own thread record, again as it moves: delivered, then picked up and answered.
  assert.equal(run('ticket', file, '--id', 'T-1', '--title', 'Ship the CSV export').code, 0);
  const sec = Math.floor(Date.now() / 1000), said = { id: '3f9a1c2e7b6d4a10', at: sec - 600, text: 'Is the export in this release?', to: 'release-agent', error: null, picked: null, replies: [] };
  for (const [args, why] of [[['--id', 'T-2', '--comment', JSON.stringify(said)], /no ticket T-2/], [['--id', 'T-1', '--comment', '{'], /one JSON object/], [['--id', 'T-1', '--comment', JSON.stringify({ ...said, at: 'now' })], /at must be/],
    [['--id', 'T-1', '--title', 'x', '--comment', JSON.stringify(said)], /on its own/]]) { const r = run('ticket', file, ...args); assert.notEqual(r.code, 0, args.join(' ')); assert.match(r.out, why, args.join(' ')); }
  assert.match(run('ticket', file, '--id', 'T-1', '--comment', JSON.stringify(said)).out, /shows: Delivered/);
  assert.match(run('ticket', file, '--id', 'T-1', '--comment', JSON.stringify({ ...said, picked: sec - 500, replies: [{ at: sec - 60, text: 'Yes, it ships Friday with the release.', by: 'release-agent' }] })).out, /shows: Replied/);
  assert.deepEqual(Object.fromEntries(Object.entries((await (await fetch(`${url}api/decisions`)).json()).trail.find((t) => t.kind === 'ticket')).map(([k, v]) => [k, typeof v === 'string' && /^\d{4}-/.test(v) ? 'time' : v])),
    { id: '3f9a1c2e7b6d4a10', key: 'T-1', kind: 'ticket', said: 'Is the export in this release?', at: 'time', delivered: 'time', read: 'time', reply: { at: (await (await fetch(`${url}api/decisions`)).json()).trail.find((t) => t.kind === 'ticket').reply.at, text: 'Yes, it ships Friday with the release.' } });
  const { evaluate, send, close } = await browse(join(dir, 'b'), 390, 844, true);
  try {
    // Today: the reply above Waiting on you, its words as the row's second line.
    await evaluate(`location.href = ${JSON.stringify(url)}`);
    await until(() => evaluate('!!document.querySelector(".t-replies")'));
    assert.equal(await evaluate('[...document.querySelectorAll(".t-replies .ui-row")].map((r) => r.querySelector(".t").textContent + " / " + r.querySelector(".meta").textContent.replace(/^\\d\\d:\\d\\d · /, "")).join(" | ")'),
      'Open the beta to every team? / Kept it to ten teams until the import fix lands. | Ship the CSV export / Yes, it ships Friday with the release.');
    // Decide: each answered row carries its badge, four marks and the step's word; the reply not opened yet is ink.
    await evaluate('location.hash = "#waiting"');
    await until(async () => (await evaluate('document.querySelectorAll(".ui-tb").length')) === 3);
    assert.deepEqual(JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll(".ui-row")].filter((r) => r.querySelector(".ui-tb")).map((r) => [r.querySelector(".t").textContent, r.querySelector(".ui-tb").textContent, r.querySelectorAll(".ui-tb i.on").length, r.querySelector(".ui-tb").classList.contains("new")]).sort())')),
      [['Keep the weekly digest?', 'Sent', 1, false], ['Open the beta to every team?', 'Replied', 4, true], ['Turn on the CSV export?', 'Delivered', 2, false]]);
    // The badge is one 20px line at the end of the second line at 360, 390 and 445, whatever the title and the line before it say: the words before it take the ellipsis.
    // The page names its stylesheets by their content, so a phone holding the stylesheet of an older version (kept a day) never draws the badge without its rules.
    // The page names the base sheets it is read with, and the stylesheet it asks for after the first paint by its content too, so a phone never draws a
    // screen with half an upgrade's rules.
    const served = await (await fetch(url)).text();
    assert.deepEqual([...served.matchAll(/<link rel="stylesheet" href="(\S+\.css)\?v=[0-9a-f]{12}">/g)].map((m) => m[1]), ['tokens.css', 'ui.css']);
    assert.match(served, /data-css="app\.css\?v=[0-9a-f]{12}"|data-css="app\.css"/);
    assert.equal(await evaluate('[...document.querySelectorAll("link[rel=stylesheet]")].map((l) => l.getAttribute("href").replace(/[?]v=[0-9a-f]{12}$/, "")).join()'), 'tokens.css,ui.css,app.css');
    assert.match((await (await fetch(`${url}ui.css?v=0123456789ab`)).text()), /\.ui-tb \{ display: inline-flex/);
    const wrap = () => evaluate(`JSON.stringify([...document.querySelectorAll(".ui-row")].filter((r) => r.querySelector(".ui-tb")).map((r) => { const b = r.querySelector(".ui-tb"), m = r.querySelector(".meta"), t = r.querySelector(".t");
      const x = b.getBoundingClientRect(), y = m.getBoundingClientRect(), z = r.getBoundingClientRect(); return { word: b.textContent, h: Math.round(x.height), lines: b.getClientRects().length, clear: y.right <= x.left + 0.5, inside: x.right <= z.right + 0.5 && x.bottom <= z.bottom, cut: m.scrollWidth > m.clientWidth, t: t.scrollWidth > t.clientWidth }; }))`);
    for (const w of [360, 390, 445]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: true });
      await evaluate(`document.querySelectorAll(".ui-row .meta").forEach((m) => (m.textContent = "Yes · “" + "A long note about why the answer is what it is, to the whole team. ".repeat(3) + "” · 14:42")); document.querySelectorAll(".ui-row .t").forEach((t) => (t.textContent += " and a title long enough to need its own ellipsis before the priority chip"))`);
      const rows = JSON.parse(await wrap());
      assert.equal(rows.length, 3, `${w}`);
      for (const r of rows) assert.deepEqual({ h: r.h, lines: r.lines, clear: r.clear, inside: r.inside, cut: r.cut, t: r.t }, { h: 20, lines: 1, clear: true, inside: true, cut: true, t: true }, `${w} ${r.word}`);
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate('location.reload()');
    await until(async () => (await evaluate('document.querySelectorAll(".ui-tb").length')) === 3);
    // The card: the track's reached steps with their times, then the reply and its link; the Activity names each step.
    const card = async (key) => { await evaluate(`location.hash = "#decide/${key}"`); await until(() => evaluate(`!!document.querySelector(".decide .ui-trail") && location.hash === "#decide/${key}"`));
      return JSON.parse(await evaluate('JSON.stringify({ track: [...document.querySelectorAll(".decide .ui-trail li")].map((l) => l.querySelector("b").textContent + (l.classList.contains("on") && /^\\d\\d:\\d\\d$/.test(l.querySelector("time").textContent) ? "+" : "")).join(" "), said: document.querySelector(".decide .tr-said")?.innerText.replace(/\\s+/g, " ") ?? "", link: document.querySelector(".decide .tr-said a")?.getAttribute("href") ?? "", act: [...document.querySelectorAll(".decide .ui-act li .aw b")].map((b) => b.textContent).filter((t) => !/^(Posted|Your answer)/.test(t)) })')); };
    assert.deepEqual(await card('digest'), { track: 'Sent+ Delivered Read Replied', said: '', link: '', act: [] });
    assert.deepEqual(await card('export'), { track: 'Sent+ Delivered+ Read Replied', said: '', link: '', act: ['Delivered to release-agent'] });
    assert.deepEqual(await card('beta'), { track: 'Sent+ Delivered+ Read+ Replied+', said: 'What was done Kept it to ten teams until the import fix lands. Pull request 245', link: 'https://github.com/example/settings/pull/245',
      act: ['Delivered to settings-agent', 'settings-agent read it'] });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true);
    // Opened, the reply is seen: it leaves Today, and its badge is no longer ink. The ticket shows the comment with its track and the lead's reply, and opening it is seeing that reply.
    await until(async () => !!(await trail('beta')).seen);
    await evaluate('location.hash = "#ticket/T-1"');
    await until(() => evaluate('!!document.querySelector(".tk-said .ui-trail")'));
    assert.equal(await evaluate('[document.querySelector(".tk-said .tr-you p").textContent, [...document.querySelectorAll(".tk-said .ui-trail li.on b")].map((b) => b.textContent).join(" "), document.querySelector(".tk-said .tr-said p").innerText.trim()].join(" | ")'),
      'Is the export in this release? | Sent Delivered Read Replied | Yes, it ships Friday with the release.');
    await evaluate(`location.href = ${JSON.stringify(url)}`);
    await until(() => evaluate('!!document.querySelector(".t-up") && !document.querySelector(".t-replies")'));
    // Posting the card again after the answer is acting on it: the track reads Acted, with Posted a new version.
    assert.equal(run('feedback', 'export', file, '--read').code, 0);
    const items = JSON.parse(readFileSync(file, 'utf8'));
    items.items.find((d) => d.key === 'export').filed = new Date(Date.now() + 2000).toISOString().replace(/\.\d+Z$/, 'Z');
    writeFileSync(file, JSON.stringify(items));
    await evaluate('location.reload()');
    assert.deepEqual(await card('export'), { track: 'Sent+ Delivered+ Read+ Acted+', said: 'What was done Posted a new version', link: '', act: ['Delivered to release-agent', 'release-agent read it'] });
  } finally { close(); }
  proc.kill();
});

test('feedback --at replays a step that happened earlier: Delivered, Read and Acted take their own past times, never before the send or in the future, and never turn a later real state back into an older one', async () => {
  const dir = join(scratch, 'replay'), file = join(dir, 'board.json');
  mkdirSync(dir);
  assert.equal(run('raise', file, '--key', 'old', '--title', 'Ship the export?', '--filer', 'release-agent').code, 0);
  // An answer from three days ago, as an older board holds it: the board has no step after it.
  const sent = Math.floor(Date.now() / 1000) - 3 * 86400, iso = (n) => new Date(n * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  writeFileSync(join(dir, 'board.answers.jsonl'), JSON.stringify({ key: 'old', answer: 'yes', label: 'Yes', close: 'done', at: iso(sent) }) + '\n');
  const board = JSON.parse(readFileSync(file, 'utf8'));
  board.items.find((d) => d.key === 'old').filed = iso(sent - 3600);
  writeFileSync(file, JSON.stringify(board));
  const step = () => JSON.parse(readFileSync(join(dir, 'board.trail.jsonl'), 'utf8').trim().split('\n').at(-1));
  for (const [args, why] of [[['--read', '--at', String(sent - 60)], /before what was sent/], [['--read', '--at', String(Math.floor(Date.now() / 1000) + 600)], /not in the future/], [['--read', '--at', 'yesterday'], /whole seconds/]]) {
    const r = run('feedback', 'old', file, ...args); assert.notEqual(r.code, 0, args.join(' ')); assert.match(r.out, why, args.join(' '));
  }
  assert.equal(existsSync(join(dir, 'board.trail.jsonl')), false);
  assert.match(run('feedback', 'old', file, '--delivered', '--at', String(sent + 5)).out, /shows: Delivered/);
  assert.equal(step().at, iso(sent + 5));
  assert.match(run('feedback', 'old', file, '--read', '--at', String(sent + 60)).out, /shows: Read/);
  assert.match(run('feedback', 'old', file, '--acted', '--link', 'https://github.com/example/settings/pull/9', '--at', String(sent + 3600)).out, /shows: Replied/);
  // Run again, or with an older time, nothing is written and the later state stays.
  const lines = readFileSync(join(dir, 'board.trail.jsonl'), 'utf8');
  for (const args of [['--delivered', '--at', String(sent + 5)], ['--read', '--at', String(sent + 30)], ['--acted', '--link', 'https://github.com/example/settings/pull/9', '--at', String(sent + 3600)], ['--reply', 'Done.', '--at', String(sent + 7200)]]) {
    assert.match(run('feedback', 'old', file, ...args).out, /already shows that step/, args.join(' '));
  }
  assert.equal(readFileSync(join(dir, 'board.trail.jsonl'), 'utf8'), lines);
  // The board shows each step at the time given.
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], t = (await (await fetch(`${url}api/decisions`)).json()).trail.find((x) => x.key === 'old');
  assert.deepEqual([t.delivered, t.read, t.reply], [iso(sent + 5), iso(sent + 60), { at: iso(sent + 3600), link: 'https://github.com/example/settings/pull/9' }]);
  proc.kill();
});

test('Discard: every card offers three reasons, one tap each; the card moves to Archived with its reason and Restore, Undo takes it back for 10 seconds before its agent hears, the agent\'s wait then hands the reason over, and Select in Designs and Decide discards several at once', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'discard'), file = join(dir, 'board.json'), fx = new URL('../fixtures/contract/', import.meta.url).pathname;
  mkdirSync(join(dir, 'design'), { recursive: true });
  for (const f of readdirSync(join(fx, 'design.v1/design'))) writeFileSync(join(dir, 'design', f), readFileSync(join(fx, 'design.v1/design', f)));
  for (const [key, title, filer] of [['digest', 'Keep the weekly digest?', 'release-agent'], ['export', 'Turn on the CSV export?', 'release-agent']]) assert.equal(run('raise', file, '--key', key, '--title', title, '--filer', filer).code, 0);
  const design = JSON.parse(readFileSync(join(fx, 'design.v1/valid-basic.json'), 'utf8'));
  for (const [key, title] of [['dash-v1', 'Ship the first fleet dashboard?'], ['dash-v2', 'Ship the fleet dashboard redesign?']]) {
    writeFileSync(join(dir, `${key}.json`), JSON.stringify({ ...design, key, title, filer: 'dashboard-agent' }));
    assert.equal(run('post', file, '--kind', 'design', '--from', join(dir, `${key}.json`)).code, 0);
  }
  // The agent's command takes only the three reasons, for one card.
  for (const [args, why] of [[['digest', '--reason', 'bored'], /--reason must be one of not-relevant, replaced, done-elsewhere/], [['--filer', 'release-agent', '--reason', 'replaced'], /does not take --filer/]]) {
    const r = run('dismiss', ...args.slice(0, args[0] === '--filer' ? 0 : 1), file, ...args.slice(args[0] === '--filer' ? 0 : 1));
    assert.notEqual(r.code, 0, args.join(' ')); assert.match(r.out, why, args.join(' '));
  }
  assert.equal(existsSync(join(dir, 'board.dismissed.jsonl')), false);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  assert.equal((await post(url, 'api/dismiss', { keys: ['digest'], dismissed: true, reason: 'bored' })).status, 400);
  const lines = () => readFileSync(join(dir, 'board.dismissed.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map(({ key, dismissed, reason }) => [key, dismissed, reason ?? '']);
  const discards = async () => (await (await fetch(`${url}api/decisions`)).json()).trail.filter((t) => t.kind === 'discard');
  const { evaluate, close } = await browse(join(dir, 'b'), 390, 844, true);
  try {
    // An ask's More holds Discard; its sheet names the card and its agent, and offers the three reasons.
    await evaluate(`location.href = ${JSON.stringify(`${url}#decide/digest`)}`);
    await until(() => evaluate('!!document.querySelector(".sh-head .dl-more")'));
    await evaluate('document.querySelector(".sh-head .dl-more").open = true; document.querySelector(".sh-head [aria-label^=\'Discard,\']").click()');
    await until(() => evaluate('document.getElementById("dc-sheet").open'));
    assert.deepEqual(JSON.parse(await evaluate('JSON.stringify([document.querySelector(".dc-t").textContent, document.querySelector("#dc-sheet .t-line").textContent, [...document.querySelectorAll("#dc-sheet [data-reason]")].map((b) => b.textContent)])')),
      ['Keep the weekly digest?', 'It moves to Archived, and release-agent is told why.', ['Not relevant', 'Replaced by newer', 'Done elsewhere']]);
    // One tap discards it: the toast names the reason and holds Undo for 10 seconds; Undo inside them puts it back, and the agent is never told.
    await evaluate('document.querySelector("#dc-sheet [data-reason=not-relevant]").click()');
    await until(async () => (await evaluate('document.getElementById("toast").hidden ? "" : document.getElementById("toast-text").textContent + "|" + document.getElementById("toast").style.getPropertyValue("--tms")')) === 'Discarded · Not relevant|10000ms');
    await evaluate('document.getElementById("undo").click()');
    await until(async () => (await evaluate('document.getElementById("toast-text").textContent')) === 'Back on the board');
    assert.deepEqual(lines(), [['digest', true, 'not-relevant'], ['digest', false, '']]);
    assert.deepEqual(await discards(), []);
    // Designs: More's Select, both designs picked with their checks, Discard 2 with one reason for both.
    await evaluate('location.hash = "#designs"');
    await until(() => evaluate('!!document.querySelector(".dz-more")'));
    await evaluate('document.querySelector(".dz-more").click(); [...document.querySelectorAll("#dz-sheet .ui-pr")].find((b) => b.textContent === "Select").click()');
    await until(() => evaluate('!!document.querySelector(".sel-bar")'));
    await evaluate('document.getElementById("item-dash-v1").click()');
    await evaluate('document.getElementById("item-dash-v2").click()');
    await until(async () => (await evaluate('[document.querySelector("main h1").textContent, document.querySelectorAll(".dz-list .sel-c.on").length, [...document.querySelectorAll(".sel-bar button")].map((b) => b.textContent).join()].join("|")')) === '2 selected|2|Cancel,Discard 2');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".tabs")).display'), 'none');
    await evaluate('document.querySelector(".sel-go").click()');
    await until(() => evaluate('document.getElementById("dc-sheet").open && document.querySelector("#dc-sheet h2").textContent === "Discard 2"'));
    await evaluate('document.querySelector("#dc-sheet [data-reason=replaced]").click()');
    await until(async () => (await evaluate('!document.querySelector(".sel-bar") && document.querySelector(".ar-line")?.textContent')) === 'Archived · 2');
    // The agent's own wait hands the discards over once Undo's 10 seconds are over, and the trail marks them read.
    // Run without blocking this process, so the board's idle connections close as they would.
    const started = Date.now(), handed = await new Promise((ok) => execFile(process.execPath, [cli, 'wait', file, '--filer', 'dashboard-agent', '--timeout', '30'], { env }, (e, out) => ok({ code: e?.code ?? 0, out })));
    assert.equal(handed.code, 0, handed.out);
    assert.ok(Date.now() - started >= 7000, 'the wait handed the discards over inside the Undo window');
    assert.match(handed.out, /discarded\[2\]\{key,reason,at,title\}:\n {2}dash-v1,Replaced by newer,"[^"]+",(Ship the first fleet dashboard\?|"Ship the first fleet dashboard\?")\n {2}dash-v2,Replaced by newer,/);
    assert.deepEqual((await discards()).map((t) => [t.key, t.reason, !!t.read]).sort(), [['dash-v1', 'replaced', true], ['dash-v2', 'replaced', true]]);
    assert.match(run('list', file, '--full').out, /dash-v1,"discarded: Replaced by newer"/);
    assert.deepEqual(JSON.parse(run('answers', file, '--json').out)['dash-v2'].discarded.label, 'Replaced by newer');
    // Archived: each card with its reason and how far its agent got (read, once the board is loaded again), and Restore, which puts it back under Designs with the discard in its Activity.
    await evaluate('location.reload()');
    await until(() => evaluate('!!document.querySelector(".ar-line")'));
    await evaluate('document.querySelector(".ar-line").click()');
    await until(async () => (await evaluate('[...document.querySelectorAll("#ar-sheet .ar-list li")].map((li) => li.querySelector(".t").textContent + " / " + li.querySelector(".meta").textContent + " / " + li.querySelector(".ui-tb").textContent).join(" | ")'))
      === 'Ship the first fleet dashboard? / Replaced by newer / Read | Ship the fleet dashboard redesign? / Replaced by newer / Read');
    await evaluate('document.querySelector("#ar-sheet [aria-label=\'Restore, Ship the fleet dashboard redesign?\']").click()');
    await until(() => evaluate('!!document.getElementById("item-dash-v2") && document.querySelectorAll("#ar-sheet .ar-list li").length === 1'));
    await evaluate('document.getElementById("ar-sheet").close(); location.hash = "#designs/dash-v2"');
    await until(async () => (await evaluate('[...document.querySelectorAll(".thread .ui-act b")].map((t) => t.textContent).join("|")'))?.includes('Discarded: Replaced by newer|Delivered to dashboard-agent|dashboard-agent read it'));
    // Decide: More's Select, one ask picked, Discard 1 as done elsewhere; it waits under Archived.
    await evaluate('location.hash = "#waiting"');
    await until(() => evaluate('!!document.querySelector(".decide-list .t-more-line")'));
    await evaluate('document.querySelector(".decide-list .t-more-line").click(); document.querySelector("#d-more [data-act=select]").click()');
    await until(() => evaluate('!!document.querySelector(".sel-bar")'));
    await evaluate('document.getElementById("item-export").click()');
    await until(async () => (await evaluate('document.querySelector(".sel-go").textContent')) === 'Discard 1');
    await evaluate('document.querySelector(".sel-go").click()');
    await until(() => evaluate('document.getElementById("dc-sheet").open'));
    await evaluate('document.querySelector("#dc-sheet [data-reason=done-elsewhere]").click()');
    await until(async () => (await evaluate('!document.getElementById("item-export") && document.querySelector(".decide-list .ar-line")?.textContent')) === 'Archived · 1');
    assert.deepEqual(lines().slice(-1), [['export', true, 'done-elsewhere']]);
  } finally { close(); }
});

// The approved prototype's palette (mocks/signoff-proto-3/index.html): every colour its :root and dark blocks define, and the few it writes in place
// (the dock's Search, a count's white, the toast button's tint, the up arrow's green, the warn amber), each theme its own. Its secondary and tertiary text, the quiet
// P3 chip's text and, in dark, the words on a red count are set to tones that read at 4.5:1 on every surface they sit on (the accessibility floor), not the prototype's own.
const PROTO = {
  light: ['#E8E4E0', '#F3F3F0', '#FFFFFF', '#FBFBFA', '#EAE7E3', '#121210', '#21211E', '#5C5C59', '#666663', '#AAAAAA', '#E5E3DE', '#2D2D2A', '#D3CCC9', '#E6E2DE', '#DCD8D4',
    'rgba(255,255,255,0.75)', '#D7372B', '#F6DCD8', '#B42318', '#F5E6CF', '#8F4E08', '#E6E3DE', '#4F4B46', '#ECEAE6', '#6B6761', 'rgba(30,24,18,0.28)',
    'rgba(60,40,20,0.05)', 'rgba(60,40,20,0.045)', 'rgba(40,30,20,0.1)', 'rgba(40,30,20,0.06)', 'rgba(40,30,20,0.08)', 'rgba(40,30,20,0.05)', 'rgba(30,20,10,0.12)',
    'rgba(20,16,12,0.25)', 'rgba(0,0,0,0.2)', 'rgba(255,255,255,0.14)', '#262624', '#2BB673', '#C8841A'],
  dark: ['#131210', '#1E1D1A', '#2A2825', '#34322E', '#262421', '#F4F2EE', '#E9E6E1', '#BDB8B1', '#A59F98', '#6C6863', '#2F2D2A', '#ECE9E4', '#55514C', '#2B2926', '#2E2C29',
    'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.5)', '#FF6B5E', 'rgba(255,107,94,0.16)', '#FF8E84', 'rgba(242,166,72,0.15)', '#F2B262', '#CFCAC3',
    '#2C2A27', '#9C978F', 'rgba(0,0,0,0.1)', 'rgba(0,0,0,0.2)', 'rgba(30,20,10,0.12)', 'rgba(20,16,12,0.25)', '#FFFFFF', '#2BB673', '#C8841A'],
};
/** Every colour the page draws, as `colour  where`, read from each shown element's computed style (and its ::before, ::after and placeholder):
 * text that has words, a ground, a drawn border or outline, a shadow, a gradient, an icon's fill and stroke, a native control's accent. A colour with no alpha left is skipped. */
const drawnColours = `(() => {
  const seen = new Map();
  // A computed colour as its rgb channels (0-255) and alpha: rgb(), rgba() and a color-mix()'s color(srgb ...).
  const norm = (c) => { const n = c.match(/-?[\\d.]+(e-?\\d+)?/g).map(Number), srgb = c.startsWith('color('), [r, g, b] = n.slice(0, 3).map((x) => Math.round(srgb ? x * 255 : x)), a = n[3] ?? 1;
    return a === 0 ? null : a === 1 ? '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase() : 'rgba(' + [r, g, b, +a.toFixed(3)].join(',') + ')'; };
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].slice(0, 3).map((c) => '.' + c).join('');
  // A gradient's stops fade a colour toward clear, so a stop counts by its colour alone.
  const add = (value, where, fade) => { for (const c of value.match(/rgba?\\([^)]*\\)|color\\([^)]*\\)/g) ?? []) { const n = norm(c), k = n && fade ? n.replace(/^rgba\\((\\d+),(\\d+),(\\d+),.*$/, (_, ...rgb) => '#' + rgb.slice(0, 3).map((x) => (+x).toString(16).padStart(2, '0')).join('').toUpperCase()) : n; if (k && !seen.has(k)) seen.set(k, where); } };
  const box = (s, where, text) => {
    if (text) add(s.color, where + ' color');
    add(s.backgroundColor, where + ' background');
    if (s.backgroundImage !== 'none') add(s.backgroundImage, where + ' gradient', true);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(s['border' + side + 'Width']) > 0 && !/none|hidden/.test(s['border' + side + 'Style'])) add(s['border' + side + 'Color'], where + ' border');
    if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) add(s.outlineColor, where + ' outline');
    if (s.boxShadow !== 'none') add(s.boxShadow, where + ' shadow');
    if (s.textShadow !== 'none' && text) add(s.textShadow, where + ' text-shadow');
    if (text && s.textDecorationLine !== 'none') add(s.textDecorationColor, where + ' underline');
  };
  for (const el of document.querySelectorAll('body *')) {
    if (!el.getClientRects().length || el.closest('[hidden], template, iframe')) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden') continue;
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.value);
    box(s, name(el), text);
    if (el instanceof SVGGeometryElement || el instanceof SVGTextElement) for (const p of ['fill', 'stroke']) if (s[p] !== 'none') add(s[p], name(el.closest('svg').parentElement) + ' svg ' + p);
    if (/^(checkbox|radio|range)$/.test(el.type) && s.appearance !== 'none') s.accentColor === 'auto' ? seen.set('accent-color auto', name(el)) : add(s.accentColor, name(el) + ' accent');
    if (el.placeholder && !el.value) add(getComputedStyle(el, '::placeholder').color, name(el) + ' placeholder');
    for (const pseudo of ['::before', '::after']) { const p = getComputedStyle(el, pseudo); if (p.content !== 'none' && p.content !== 'normal') box(p, name(el) + pseudo, p.content.length > 2); }
  }
  return [...seen].map(([c, where]) => c + '  ' + where);
})()`;
// A colour written as #RRGGBB, rgb(), rgba() or color(srgb ...), as [r, g, b, alpha]; the gate matches within one step a channel, as a colour-mix rounds.
const channels = (c) => { if (c.startsWith('#')) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).concat(1);
  const n = c.match(/-?[\d.]+(e-?\d+)?/g)?.map(Number); if (!n || n.length < 3) return null; const srgb = c.startsWith('color('); return [...n.slice(0, 3).map((x) => (srgb ? x * 255 : x)), n[3] ?? 1]; };
const normColour = (c) => { const [r, g, b, a] = channels(c); return a === 0 ? null : a === 1 ? `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase()}` : `rgba(${[r, g, b].map(Math.round).join(',')},${+a.toFixed(3)})`; };
// The focused control's ring and fill after each Tab, as a keyboard user sees them.
const focusColours = `(() => { const el = document.activeElement; if (!el || el === document.body) return []; const s = getComputedStyle(el), out = [];
  if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) out.push([s.outlineColor, 'outline']); if (s.boxShadow !== 'none') out.push([s.boxShadow, 'shadow']);
  return out.map(([v, p]) => v + '|' + el.tagName.toLowerCase() + [...el.classList].slice(0, 2).map((c) => '.' + c).join('') + ':focus-visible ' + p); })()`;

test('the new look draws only the approved prototype\'s colours: Today, Decide, Designs, Reports, Evidence and Tickets, their sheets and keyboard focus, at 390 and 1280, light and dark', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'palette'), file = join(dir, 'board.json'), fx = new URL('../fixtures/contract/', import.meta.url).pathname, now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  mkdirSync(join(dir, 'design'), { recursive: true });
  for (const f of readdirSync(join(fx, 'design.v1/design'))) writeFileSync(join(dir, 'design', f), readFileSync(join(fx, 'design.v1/design', f)));
  writeFileSync(join(dir, 'shot.png'), png);
  const fileOf = (name, m) => (writeFileSync(join(dir, name), JSON.stringify(m)), join(dir, name));
  // A board with every kind of card on it: asks with and without a priority, a pick-one, a plan, a guided report, a design on a ticket, a proof and a sign-in,
  // an epic with a ticket under it, a ticket on hold and a system one, so each screen draws its chips, bars, dots and rows.
  for (const args of [['--id', 'T-9', '--title', 'The new settings page', '--priority', 'P1', '--project', 'Settings', '--asked', 'yes'], ['--id', 'T-29', '--title', 'Ship the new settings page', '--progress', '60', '--parent', 'T-9', '--priority', 'P0', '--stage', 'review', '--last-event-at', '1790000000'],
    ['--id', 'T-31', '--title', 'Write the release notes', '--priority', 'P2', '--hold', 'yes', '--hold-reason', 'waiting on the store review', '--asked', 'yes', '--stage', 'building', '--last-event-at', '1790000000'], ['--id', 'T-40', '--title', 'Rotate the nightly logs', '--priority', 'P3', '--progress', '100']]) assert.equal(run('ticket', file, ...args).code, 0, args.join(' '));
  for (const args of [
    ['raise', file, '--ticket', 'T-29', '--priority', 'P0', '--key', 'ask-linked', '--title', 'Ship the settings page on Friday?'],
    ['raise', file, '--priority', 'P1', '--key', 'ask-plain', '--title', 'Keep the old settings link for a week?'],
    ['post', file, '--kind', 'ask', '--from', fileOf('pick.json', { ...JSON.parse(readFileSync(join(fx, 'ask.v1/valid-pick-one.json'), 'utf8')), merges: undefined, silent_by: undefined })],
    ['post', file, '--type', 'evidence', '--ticket', 'T-29', '--title', 'Settings on a phone', '--about', 'Umer changes the theme in one tap.', '--media', join(dir, 'shot.png')],
    ['post', file, '--kind', 'design', '--from', fileOf('design.json', { ...JSON.parse(readFileSync(join(fx, 'design.v1/valid-basic.json'), 'utf8')), filed: now }), '--ticket', 'T-40'],
    // An older report whose kind the board guesses, then a research report (its sheet shows its Sources), so Reports draws its kind filter and two kinds' chips.
    ['post', file, '--kind', 'report', '--from', fileOf('report-old.json', { ...JSON.parse(readFileSync(join(fx, 'report.v4/valid-minimal.json'), 'utf8')), title: 'Where the weekly digest stands', filed: now })],
    ['post', file, '--kind', 'report', '--priority', 'P2', '--from', fileOf('report.json', { ...JSON.parse(readFileSync(join(fx, 'report.v5/valid-full.json'), 'utf8')), filed: now })],
    ['post', file, '--kind', 'plan', '--from', join(fx, 'plan.v3/valid-full.json')],
    ['post', file, '--type', 'signin', '--key', 'npm', '--service', 'npm', '--link', 'https://example.com/login', '--unlocks', 'Publishing the release', '--waits', 'Release agent'],
  ]) { const r = run(...args); assert.equal(r.code, 0, `${args.join(' ')}\n${r.out}`); }
  const keys = Object.fromEntries(JSON.parse(readFileSync(file, 'utf8')).items.map((i) => [i.kind ?? i.type, i.key]));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  // A comment on the linked ask and the report, so a card's own screen draws its Activity beside its property panel.
  for (const key of ['ask-linked', keys.report]) assert.equal((await post(url, 'api/messages', { kind: 'comment', key, text: 'Looks right on my phone.' })).status, 200);
  // Each state: its address and what is tapped on it, on a phone and on a desk; a report tapped in its list opens its own screen (a sheet on a phone, beside the list on a desk).
  const states = {
    390: [['#', ''], ['#', '.t-more-line'], ['#find', ''], ['#answered', ''], ['#waiting', ''], ['#decide/release-day', '.decide [role="radio"], .decide input[type="radio"]'], ['#decide/npm', ''],
      ['#reports', ''], ['#reports', '.rp-fb'], [`#reports/${keys.report}`, ''], ['#reports', `.rp-list a[data-row][href="#reports/${keys.report}"]`], ['#decide/ask-linked', ''], ['#designs', ''], [`#designs/${keys.design}`, ''], ['#evidence', ''], ['#evidence', '.ev-more'], [`#evidence/${keys.evidence}`, ''], ['#tickets', ''], ['#ticket/T-29', ''],
      // Last, an answer and the toast it raises: a yes/no in light, the pick-one in dark.
      [(theme) => (theme === 'light' ? '#decide/ask-plain' : '#decide/release-day'), ['.decide .pick-option', '.decide-bar .answer']]],
    1280: [['#', ''], ['#find', ''], ['#waiting', ''], ['#decide/ask-linked', ''], ['#reports', ''], ['#reports', `.rp-list a[data-row][href="#reports/${keys.report}"]`], ['#designs', ''], [`#designs/${keys.design}`, ''], ['#evidence', ''], ['#tickets', ''], ['#ticket/T-29', '']],
  };
  const off = [];
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
    const { evaluate, send, close } = await browse(dir, width, width === 390 ? 844 : 800, width === 390);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    const allowed = PROTO[theme].map(channels);
    // The board's mark keeps the prototype's blue check (web/icon.svg's gradient): those two blues count on the mark alone.
    const near = (c) => (p) => p.every((x, i) => Math.abs(x - c[i]) <= (i < 3 ? 1 : 0.005)), logo = ['#6A93FF', '#2C48D3'].map(channels);
    const check = (list, at) => { for (const line of list) { const c = channels(line.split('  ')[0]); if (!c || !(allowed.some(near(c)) || (/^span\.logo\b/.test(line.split('  ')[1] ?? '') && logo.some(near(c))))) off.push(`${theme} ${width} ${at}: ${line}`); } };
    try {
      for (const [hashOf, tap] of states[width]) {
        const hash = typeof hashOf === 'function' ? hashOf(theme) : hashOf;
        await evaluate(`location.href = ${JSON.stringify(url + hash)}`);
        await until(() => evaluate(`location.hash === ${JSON.stringify(hash === '#' ? '' : hash)} && !!document.querySelector('#board h1, #reader:not([hidden]) h1, dialog[open]')`));
        for (const t of [tap].flat().filter(Boolean)) await evaluate(`document.querySelector(${JSON.stringify(t)})?.click(), new Promise((ok) => setTimeout(ok, 300))`);
        if (Array.isArray(tap)) await until(() => evaluate('!document.getElementById("toast").hidden'));
        await evaluate('new Promise((ok) => setTimeout(ok, 400))');
        if (hash === '#find') await evaluate('document.querySelector("#find").value = "settings", document.querySelector("#find").dispatchEvent(new Event("input"))');
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".ui-row .ui-icon, .dz-shot, .t-up .meta")].filter(e => e.querySelector(".mono") || (!e.querySelector("img,svg") && /^[A-Z]{2}$/.test(e.textContent.trim()))).map(e => e.textContent)'), [], 'no monogram tiles in any list');
        const at = hash + (tap ? ` (${[tap].flat().map((t) => t.split(',')[0]).join(' then ')} tapped)` : '');
        // On Designs the colours read include the sidebar's own Designs place, lit, on a desk, and the dock with Decide lit on a phone.
        if (hash.startsWith('#designs')) assert.deepEqual(await evaluate('[...document.querySelectorAll(".side [aria-current], .tabs [aria-current]")].filter((a) => a.getClientRects().length).map((a) => a.getAttribute("href"))'), [width === 390 ? '#waiting' : '#designs'], at);
        check(await evaluate(drawnColours), at);
        // A keyboard user's first dozen stops on the screen.
        for (let i = 0; i < 12; i++) {
          for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
          const ring = await evaluate(focusColours);
          for (const line of ring ?? []) { const [v, where] = line.split('|'); check((v.match(/rgba?\([^)]*\)|color\([^)]*\)/g) ?? []).map((c) => `${normColour(c)}  ${where}`).filter((l) => !l.startsWith('null')), at); }
        }
      }
    } finally { close(); }
  }
  assert.deepEqual([...new Set(off)], []);
  proc.kill();
});

test('detail sequence follows the originating list across phone sheets, desk panes, reload, keys and swipes', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'detail-sequence'), file = join(dir, 'board.json'); mkdirSync(dir);
  const options = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
  writeFileSync(join(dir, 'report.html'), '<!doctype html><p>A report for Umer.</p>');
  writeFileSync(join(dir, 'screen.png'), sized(300, 650));
  writeFileSync(file, JSON.stringify({ schema: 2, items: [
    ...['alpha', 'beta', 'gamma'].map((key) => ({ key, title: `${key} question?`, group: 'Release agent', filed: new Date().toISOString(), options, ...(key === 'alpha' && { options: ['a','b','c','d'].map(value => ({ value, label: value.toUpperCase() })), mocks: ['a','b','c','d'].map(value => ({ value, path: 'screen.png' })) }), ...(key === 'beta' && { about: 'Umer can scroll this detailed explanation without leaving the question. '.repeat(30) }) })),
    ...['research', 'other', 'research'].map((report_kind, i) => ({ contract: 1, kind: 'report', schema: 2, key: `r${i}`, title: `Report ${i}`, group: 'Sign-in', view: 'report.html', preview: 'preview.svg', purpose: report_kind, filed: new Date().toISOString() })),
  ] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] }); procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  for (const width of [390, 1280]) {
    const { evaluate, send, swipe, close } = await browse(dir, width, 844, width === 390);
    try {
      await evaluate(`location.href = ${JSON.stringify(url + '#waiting')}`);
      await until(async () => await evaluate('!!document.querySelector("#item-beta")'));
      const routes = await evaluate('[...document.querySelectorAll(".dl-face[data-row]")].map(a => a.hash)');
      await evaluate('document.querySelector("#item-beta").click()');
      await until(async () => (await evaluate('document.querySelector(".detail-sequence .position")?.textContent')) === '2 of 3');
      const metadataFits = () => evaluate('[...document.querySelectorAll(".ask-sheet .sh-lab, .rp-bar > span[dir], .rp-shd .rp-when")].every(n => n.scrollWidth <= n.clientWidth + 1)');
      assert.equal(await metadataFits(), true, 'the full who/when label fits beside navigation');
      const key = (key) => send('Input.dispatchKeyEvent', { type: 'keyDown', key });
      await key('j'); await until(async () => (await evaluate('location.hash')) === routes[2]);
      assert.equal(await evaluate('document.querySelector(".detail-sequence button:last-child").disabled'), true);
      await key('ArrowRight'); assert.equal(await evaluate('location.hash'), routes[2]);
      await key('k'); await until(async () => (await evaluate('location.hash')) === routes[1]);
      if (width === 390) {
        // Next and previous swap what is inside the open sheet: the same elements, no new open animation, and the top of the sheet.
        await evaluate('new Promise((ok) => setTimeout(ok, 500))'); // let the first open finish
        await evaluate(`(() => { const o = document.querySelector('.ask-over'), s = document.querySelector('.ask-sheet'); window.__sheet = { o, s, opens: 0 };
                    document.querySelector('#board').addEventListener('animationstart', (e) => { if (e.animationName === 'sheet-up') window.__sheet.opens++; }, true);
          s.scrollTop = 40; })()`);
        for (const [nav, to] of [['last-child', 2], ['first-child', 1], ['last-child', 2], ['first-child', 1]]) {
          await evaluate(`document.querySelector('.ask-sheet').scrollTop = 40; document.querySelector('.detail-sequence button:${nav}').click()`);
          await until(async () => (await evaluate('location.hash')) === routes[to]);
          await evaluate('new Promise((ok) => setTimeout(ok, 250))');
          assert.deepEqual(await evaluate('({ same: document.querySelector(".ask-over") === window.__sheet.o && document.querySelector(".ask-sheet") === window.__sheet.s, opens: window.__sheet.opens, top: document.querySelector(".ask-sheet").scrollTop })'), { same: true, opens: 0, top: 0 }, 'the sheet swaps its content in place');
        }
      }
      await evaluate('location.reload()');
      await until(async () => (await evaluate('document.querySelector(".detail-sequence .position")?.textContent')) === '2 of 3');
      await evaluate('document.querySelector(".decide .note-box").focus()');
      await key('ArrowLeft'); assert.equal(await evaluate('location.hash'), routes[1]);
      await evaluate('document.activeElement.blur()');
      if (width === 390) {
        const settled = () => evaluate(`(async () => {
          await Promise.all(document.getAnimations().filter(a => a.playState === 'running' && a.effect.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
          // Native fling momentum is not a CSS animation: wait for scroll position to stop changing too.
          const sheet = document.querySelector('.ask-sheet'); let top = sheet.scrollTop, quiet = performance.now();
          await new Promise(resolve => { const frame = now => {
            if (sheet.scrollTop !== top) { top = sheet.scrollTop; quiet = now; }
            if (now - quiet >= 120) resolve(); else requestAnimationFrame(frame);
          }; requestAnimationFrame(frame); });
        })()`);
        await settled();
        await evaluate('document.querySelector("#ask-title").scrollIntoView({ block: "center" })');
        await settled();
        const y = await evaluate('document.querySelector("#ask-title").getBoundingClientRect().top + 12');
        assert.ok(y > 0 && y < 844, 'the real finger lands inside the viewport');
        assert.equal(await evaluate(`!!document.elementFromPoint(320, ${y})?.closest('.ask-sheet')`), true);
        // Native vertical scrolling must move the sheet, without changing which question is open.
        const top = await evaluate('document.querySelector(".ask-sheet").scrollTop');
        await swipe({ x: 200, y: 550 }, { x: 205, y: 300 });
        await until(async () => (await evaluate('document.querySelector(".ask-sheet").scrollTop')) > top);
        assert.equal(await evaluate('location.hash'), routes[1]);
        await settled(); // Let the native vertical fling end before resetting the position for another gesture.
        await evaluate('document.querySelector("#ask-title").scrollIntoView({ block: "center" })');
        await settled();
        await evaluate('new Promise(requestAnimationFrame)');
        const sy = await evaluate('document.querySelector("#ask-title").getBoundingClientRect().top + 12');
        assert.equal(await evaluate(`!!document.elementFromPoint(320, ${sy})?.closest('.ask-sheet')`), true, 'the post-scroll swipe starts on the sheet');
        await swipe({ x: 320, y: sy }, { x: 70, y: sy });
        await until(async () => (await evaluate('location.hash')) === routes[2]);
        await settled();
        // A screenshot strip scrolls its pictures, keeping the current card and sequence intact.
        await evaluate('document.querySelector(".mock figcaption").scrollIntoView({ block: "center" })');
        await settled();
        assert.equal(await evaluate('document.querySelector(".mocks").scrollWidth > document.querySelector(".mocks").clientWidth'), true, 'the fixture has a swipeable strip');
        const my = await evaluate('document.querySelector(".mock figcaption").getBoundingClientRect().top + 12');
        assert.ok(my > 0 && my < 844);
        await swipe({ x: 320, y: my }, { x: 70, y: my });
        await until(async () => (await evaluate('document.querySelector(".mocks").scrollLeft')) > 0);
        assert.equal(await evaluate('location.hash'), routes[2], 'the screenshot strip owns its gesture');
      }
      await evaluate('document.querySelector(".detail-sequence button:first-child").click()');
      await until(async () => (await evaluate('location.hash')) === routes[width === 390 ? 1 : 0]);
      await evaluate('location.hash = "#reports"');
      await until(async () => await evaluate('!!document.querySelector(".rp-fb")'));
      await evaluate('document.querySelector(".rp-fb").click()');
      await evaluate('document.querySelector(".rp-pick button[data-kind=research]").click()');
      if (width === 1280) assert.equal(await evaluate('document.querySelector(".detail-sequence .position")?.textContent'), '1 of 2', 'a desk filter updates its implicit selection sequence');
      const filtered = await evaluate(`[...document.querySelectorAll('.rp-page a.dl-face, .split-list a.dl-face')].map(a => a.hash)`);
      assert.equal(filtered.length, 2);
      assert.equal(await metadataFits(), true, 'report metadata fits beside its controls');
      await evaluate(`document.querySelector('.rp-page a.dl-face, .split-list a.dl-face').click()`);
      await until(async () => (await evaluate('document.querySelector(".detail-sequence .position")?.textContent')) === '1 of 2');
      assert.equal(await metadataFits(), true, 'phone report metadata fits beside navigation');
      if (width === 390) assert.equal(await evaluate(`document.querySelector('.rp-sheet-body .detail-sequence').getBoundingClientRect().bottom <= document.querySelector('.rp-sheet-body h1').getBoundingClientRect().top`), true, 'the pager sits above the report title, not over it');
      await key('j'); await until(async () => (await evaluate('location.hash')) === filtered[1]);
      assert.equal(await evaluate('document.querySelector(".detail-sequence button:last-child").disabled'), true);
    } finally { await close(); }
  }
});

test('replies thread under what they answer: Your question or Your action, then Reply or What was done with its track; no reply, several replies, and a reply that asks for a next step keeps the card in Decide until a final tap', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'pairs'), file = join(dir, 'board.json');
  mkdirSync(dir);
  for (const [key, title] of [['quiet', 'Ship the quiet one?'], ['many', 'Ship the busy one?'], ['build', 'Build the export?'], ['chat', 'Ship the chatty one?']]) assert.equal(run('raise', file, '--key', key, '--title', title, '--filer', 'pair-agent').code, 0);
  // The agent's follow-up buttons: at most four, each value once, and only with a reply.
  assert.notEqual(run('feedback', 'quiet', file, '--read', '--option', 'yes=Yes').code, 0);
  assert.notEqual(run('feedback', 'quiet', file, '--reply', 'Which?', '--option', 'a=A', '--option', 'a=B').code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], state = async () => (await fetch(`${url}api/decisions`)).json();
  // quiet: answered, no reply. many: two comments, each answered by its own reply. build: answered in words, the reply asks for a next step. chat: a comment whose reply asks.
  assert.equal((await post(url, 'api/answers', { key: 'quiet', answer: 'yes' })).status, 200);
  assert.equal((await post(url, 'api/messages', { kind: 'comment', key: 'many', text: 'Is the cache warm?' })).status, 200);
  await new Promise((ok) => setTimeout(ok, 1100));
  assert.equal(run('feedback', 'many', file, '--reply', 'Yes, it was warmed at nine.', '--filer', 'pair-agent').code, 0);
  await new Promise((ok) => setTimeout(ok, 1100));
  assert.equal((await post(url, 'api/messages', { kind: 'comment', key: 'many', text: 'And the CDN?' })).status, 200);
  await new Promise((ok) => setTimeout(ok, 1100));
  assert.equal(run('feedback', 'many', file, '--reply', 'The CDN is purged.', '--filer', 'pair-agent').code, 0);
  assert.equal((await post(url, 'api/answers', { key: 'build', answer: 'text', note: 'What would it cost?' })).status, 200);
  await new Promise((ok) => setTimeout(ok, 1100));
  assert.equal(run('feedback', 'build', file, '--reply', 'About two days. Say yes to build.', '--option', 'yes=Yes', '--option', 'no=No', '--filer', 'pair-agent').code, 0);
  assert.equal((await post(url, 'api/messages', { kind: 'comment', key: 'chat', text: 'Can it wait?' })).status, 200);
  await new Promise((ok) => setTimeout(ok, 1100));
  assert.equal(run('feedback', 'chat', file, '--reply', 'It can. Wait until Friday?', '--option', 'wait=Wait', '--option', 'now=Do it now', '--filer', 'pair-agent').code, 0);
  const trail = (await state()).trail;
  assert.deepEqual(trail.find((t) => t.key === 'build').reply.options, [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]);
  assert.equal(trail.find((t) => t.key === 'quiet').reply, undefined);
  assert.deepEqual(trail.filter((t) => t.key === 'many').map((t) => t.reply.text), ['Yes, it was warmed at nine.', 'The CDN is purged.']);
  const { evaluate, send, close } = await browse(join(dir, 'b'), 390, 844, true);
  try {
    await evaluate(`location.href = ${JSON.stringify(url)}`);
    const card = async (key) => { await evaluate(`location.hash = "#decide/${key}"`); await until(() => evaluate(`!!document.querySelector(".decide") && location.hash === "#decide/${key}"`)); await new Promise((ok) => setTimeout(ok, 300)); };
    const sides = () => evaluate('JSON.stringify([...document.querySelectorAll(".decide .tr-lab")].map((l) => l.textContent + ": " + (l.nextElementSibling?.textContent ?? "")))').then(JSON.parse);
    // No reply: the track and nothing from the agent.
    await card('quiet');
    assert.equal(await evaluate('[!!document.querySelector(".decide .ui-trail"), !!document.querySelector(".decide .tr-said"), !!document.querySelector(".decide .tr-opt")].join()'), 'true,false,false');
    // Several replies: each comment is a pair with its own reply, none twice.
    await card('many');
    assert.deepEqual(await sides(), ['Your question: Is the cache warm?', 'Reply: Yes, it was warmed at nine.', 'Your question: And the CDN?', 'Reply: The CDN is purged.']);
    assert.equal(await evaluate('[...document.querySelectorAll(".decide .ui-act li .aw b")].filter((b) => /replied/.test(b.textContent)).length'), 0, 'the Activity does not repeat the replies');
    // A comment whose reply asks: one tap answers it, and it shows what was answered.
    await card('chat');
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".decide .tr-opt")].map((b) => b.textContent).join()'), 'Wait,Do it now');
    await evaluate('document.querySelector(".decide .tr-opt").click()');
    await until(() => evaluate('!!document.querySelector(".decide .tr-picked")'));
    assert.equal(await evaluate('document.querySelector(".decide .tr-picked").textContent'), 'You answered: Wait');
    // A text answer whose reply asks: the card stays in Decide with its buttons, and moves to Answered on the final tap.
    await evaluate('location.hash = "#waiting"');
    await until(() => evaluate('!!document.querySelector(".ui-row")'));
    assert.ok(await evaluate('[...document.querySelectorAll(".ui-row .t")].some((t) => t.textContent === "Build the export?" && !t.closest("[aria-label=Answered]"))'), 'the exchange keeps the card in Decide');
    await card('build');
    assert.deepEqual(await sides(), ['Reply: About two days. Say yes to build.']);
    assert.ok(await evaluate('[...document.querySelectorAll(".decide .ui-dl")].some((p) => p.textContent === "Your action") && document.querySelector(".decide .ans-card").textContent.includes("What would it cost?")'));
    assert.match(await evaluate('document.querySelector(".decide .tr-said").innerText'), /About two days\. Say yes to build\./);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".decide .tr-opt")].map((b) => b.textContent).join()'), 'Yes,No');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true);
    await evaluate('document.querySelector(".decide .tr-opt").click()');
    await until(async () => (await state()).answers.build.answer === 'yes');
    await evaluate('location.hash = "#waiting"');
    await until(() => evaluate('!!document.querySelector(".ui-row")'));
    await until(async () => !(await evaluate('[...document.querySelectorAll(".ui-row .t")].some((t) => t.textContent === "Build the export?" && !t.closest("[aria-label=Answered]"))')));
  } finally { await close(); }
});

test('the inbox: one list of every kind with new replies first, then Decide, then Waiting on agents, archived folded; kind chips and search filter it; a row opens its thread in pairs; writing back keeps a card in Decide and a follow-up tap answers it', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'inbox'), file = join(dir, 'board.json'), pause = () => new Promise((ok) => setTimeout(ok, 1100));
  mkdirSync(dir);
  for (const [key, title] of [['open', 'Keep the weekly digest?'], ['asked', 'Ship the settings page Friday?'], ['built', 'Open the beta to every team?'], ['taken', 'Turn on the CSV export?'], ['old', 'Send the digest on Mondays?']]) assert.equal(run('raise', file, '--key', key, '--title', title, '--filer', 'inbox-agent').code, 0);
  assert.equal(run('ticket', file, '--id', 'T-1', '--title', 'Ship the CSV export', '--project', 'Settings', '--progress', '40').code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1], state = async () => (await fetch(`${url}api/decisions`)).json();
  // old: answered, replied and the reply opened. built: answered, and the agent says what was done with its link. asked: answered in words, and the reply asks for a next step.
  // taken: answered, and the agent's wait has read it. open: not answered.
  assert.equal((await post(url, 'api/answers', { key: 'old', answer: 'yes' })).status, 200);
  assert.equal(run('wait', file, '--filer', 'inbox-agent', '--timeout', '5').code, 0);
  assert.equal(run('feedback', 'old', file, '--reply', 'Moved to Mondays.', '--filer', 'inbox-agent').code, 0);
  assert.equal((await post(url, 'api/trail', { key: 'old' })).status, 200);
  assert.equal((await post(url, 'api/answers', { key: 'built', answer: 'no', note: 'Wait for the import fix.' })).status, 200);
  assert.equal((await post(url, 'api/answers', { key: 'asked', answer: 'text', note: 'What does Friday need?' })).status, 200);
  assert.equal(run('wait', file, '--filer', 'inbox-agent', '--timeout', '5').code, 0);
  await pause();
  assert.equal(run('feedback', 'built', file, '--reply', 'Kept it to ten teams.', '--link', 'https://github.com/example/settings/pull/245', '--filer', 'inbox-agent').code, 0);
  assert.equal(run('feedback', 'asked', file, '--reply', 'QA signs off Thursday. Ship Friday?', '--option', 'yes=Ship Friday', '--option', 'no=Wait a week', '--filer', 'inbox-agent').code, 0);
  assert.equal((await post(url, 'api/answers', { key: 'taken', answer: 'yes' })).status, 200);
  assert.equal(run('wait', file, '--filer', 'inbox-agent', '--timeout', '5').code, 0);
  // The asks page carries a thread still in play, so the inbox and its poll see a reply land on an answered card.
  const asks = await (await fetch(`${url}api/decisions?view=asks&limit=20`)).json();
  assert.deepEqual(asks.decisions.map((d) => d.key).sort(), ['asked', 'built', 'open']);
  const { evaluate, close } = await browse(join(dir, 'b'), 390, 844, true);
  try {
    const list = () => evaluate('JSON.stringify([...document.querySelectorAll(".ib-sec")].map((s) => [s.getAttribute("aria-label"), ...[...s.querySelectorAll(".ib-row")].map((r) => (r.classList.contains("unread") ? "* " : "") + r.querySelector(".t").textContent)]))').then(JSON.parse);
    await evaluate(`location.href = ${JSON.stringify(`${url}#inbox`)}`);
    await until(() => evaluate('!!document.querySelector(".ib-sec")'));
    // New replies first and unread, newest first; then what waits on the person; then what waits on an agent; archived folded.
    assert.deepEqual(await list(), [['New', '* Ship the settings page Friday?', '* Open the beta to every team?'], ['Waiting on agents', 'Turn on the CSV export?']]);
    assert.equal(await evaluate('document.querySelector(".ib-done").textContent'), 'Done1');
    assert.equal(await evaluate('[...document.querySelectorAll(".ib-row")].find((r) => r.textContent.includes("Turn on the CSV")).querySelector(".l2").textContent'), 'You: Yes · Read');
    // Every place stays, the inbox one more and Channels beside Designs.
    assert.deepEqual(await evaluate('[...new Set([...document.querySelectorAll(".side a, .tabs a")].map((a) => a.getAttribute("href")))]'), ['#find', '#', '#inbox', '#waiting', '#evidence', '#reports', '#designs', '#tickets', '#channels']);
    // The kind chips, each with what is still open; Tickets reads the board's ticket roll-up when picked. A pick filters the list, and search narrows it.
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".ib-chip")].map((c) => c.textContent)'), ['All3', 'Decisions3', 'Tickets']);
    // A ticket nobody commented on is not a thread: it stays in Tickets.
    await evaluate('[...document.querySelectorAll(".ib-chip")].find((c) => c.textContent.startsWith("Tickets")).click()');
    await until(() => evaluate('document.querySelector(".ib-empty")?.textContent === "Nothing here."'));
    await evaluate('[...document.querySelectorAll(".ib-chip")].find((c) => c.textContent.startsWith("All")).click()');
    await evaluate('{ const b = document.getElementById("ib-find"); b.value = "beta"; b.dispatchEvent(new Event("input")); }');
    await until(async () => JSON.stringify(await list()) === JSON.stringify([['New', '* Open the beta to every team?']]));
    await evaluate('{ const b = document.getElementById("ib-find"); b.value = ""; b.dispatchEvent(new Event("input")); }');
    await evaluate('document.querySelector(".ib-done").click()');
    await until(async () => (await list()).at(-1)?.[0] === 'Done');
    // A row opens its thread: the action and what was done with its link, then the item it reaches.
    await evaluate('[...document.querySelectorAll(".ib-row")].find((r) => r.textContent.includes("Open the beta")).click()');
    await until(() => evaluate('!!document.querySelector(".ib-thread") && location.hash === "#inbox/built"'));
    // The thread is a chat: the agent on the left, the person's words as a bubble on the right, time order, the pull request inline as a card.
    const chat = () => evaluate('JSON.stringify([...document.querySelectorAll(".ib-thread .ib-msg")].map((m) => [m.classList.contains("you") ? "you" : "agent", m.querySelector(".ib-say")?.textContent ?? ""]))').then(JSON.parse);
    assert.deepEqual((await chat()).map((m) => m[0]), ['agent', 'you', 'agent']);
    assert.match((await chat())[1][1], /^No · .Wait for the import fix\./);
    assert.equal((await chat())[2][1], 'Kept it to ten teams.');
    assert.equal(await evaluate('(() => { const log = document.querySelector(".ib-chat").getBoundingClientRect(), you = document.querySelector(".ib-msg.you .ib-say").getBoundingClientRect(), art = document.querySelector(".ib-msg:not(.you) .ib-art").getBoundingClientRect(); return Math.abs(you.right - log.right) < 1 && Math.abs(art.left - log.left) < 1 && you.left > log.left; })()'), true);
    assert.equal(await evaluate('[...document.querySelectorAll(".ib-thread .ib-art a")].map((a) => a.href).at(-1)'), 'https://github.com/example/settings/pull/245');
    assert.equal(await evaluate('document.querySelector(".ib-thread .ib-art .ib-at b").textContent'), 'Open the beta to every team?');
    assert.equal(await evaluate('document.querySelector(".ib-thread .ib-art .ib-open").getAttribute("href")'), '#inbox/built/open');
    // A written answer is the person's question, and the reply's follow-ups sit under it, the first one set apart.
    await evaluate('location.hash = "#inbox/asked"');
    await until(() => evaluate('!!document.querySelector(".ib-thread .tr-opt")'));
    assert.deepEqual((await chat()).map((m) => m[0]), ['agent', 'you', 'agent']);
    assert.equal((await chat())[1][1], 'What does Friday need?');
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".ib-thread .tr-opt")].map((b) => b.textContent)'), ['Ship Friday', 'Wait a week']);
    assert.notEqual(await evaluate('getComputedStyle(document.querySelectorAll(".ib-thread .tr-opt")[0]).backgroundColor'), await evaluate('getComputedStyle(document.querySelectorAll(".ib-thread .tr-opt")[1]).backgroundColor'));
    // Opening the thread marked its reply seen: it is in Decide now, still waiting on a final pick.
    await until(async () => (await state()).trail.find((t) => t.key === 'asked' && t.reply)?.seen);
    // Writing back never answers: the card stays in Decide.
    await evaluate('{ const b = document.querySelector(".ib-compose textarea"); b.value = "Is QA booked?"; b.dispatchEvent(new Event("input")); document.querySelector(".ib-send").click(); }');
    await until(async () => (await state()).messages?.some((m) => m.text === 'Is QA booked?'));
    assert.equal((await state()).answers.asked.answer, 'text');
    await evaluate('location.hash = "#inbox"');
    await until(async () => (await list()).find((s) => s[0] === 'Decide')?.includes('Ship the settings page Friday?'));
    // A follow-up tap is the final answer: the card leaves Decide, and the answer does not replace the written one.
    await evaluate('location.hash = "#inbox/asked"');
    await until(() => evaluate('!!document.querySelector(".ib-thread .tr-opt")'));
    // Answers are stamped in whole seconds: the tap waits one out, so it is plainly after the reply it answers.
    await pause();
    await evaluate('document.querySelector(".ib-thread .tr-opt").click()');
    await until(async () => (await state()).answers.asked.answer === 'yes');
    assert.equal(JSON.parse(readFileSync(join(dir, 'board.answers.jsonl'), 'utf8').trim().split('\n').at(-1)).replaces, undefined);
    await evaluate('location.hash = "#inbox"');
    // On a timeout, say where the card is and what its trail holds.
    await until(async () => (await list()).find((s) => s[0] === 'Waiting on agents')?.includes('Ship the settings page Friday?'))
      .catch(async (e) => assert.fail(`${e.message}: ${JSON.stringify(await list())} ${await evaluate('JSON.stringify([state.answers.asked, (state.trail ?? []).filter((t) => t.key === "asked")])')}`));
    assert.ok(!(await list()).find((s) => s[0] === 'Decide')?.includes('Ship the settings page Friday?'));
    assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true);
  } finally { await close(); }
});

test('the inbox rail: a row counts the replies not opened and says when the agent has not read what was sent; two filters count and narrow the threads; Agents leads to the read-only Channels and Done folds the finished ones', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'inbox-rail'), file = join(dir, 'board.json'), pause = () => new Promise((ok) => setTimeout(ok, 1100));
  mkdirSync(dir);
  for (const [key, title] of [['sent', 'Keep the weekly digest?'], ['replied', 'Ship the settings page Friday?'], ['quiet', 'Turn on the CSV export?']]) assert.equal(run('raise', file, '--key', key, '--title', title, '--filer', 'rail-agent').code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  // sent: the person wrote on it, and no agent has read it. replied: answered, the agent's wait took it, and it replied. quiet: answered and read, no reply.
  assert.equal((await post(url, 'api/messages', { kind: 'comment', key: 'sent', text: 'Can you hold it until Monday?' })).status, 200);
  assert.equal((await post(url, 'api/answers', { key: 'replied', answer: 'text', note: 'What does Friday need?' })).status, 200);
  assert.equal((await post(url, 'api/answers', { key: 'quiet', answer: 'yes' })).status, 200);
  assert.equal(run('wait', file, '--filer', 'rail-agent', '--timeout', '5').code, 0);
  await pause();
  assert.equal(run('feedback', 'replied', file, '--reply', 'QA signs off Thursday.', '--filer', 'rail-agent').code, 0);
  const { evaluate, close } = await browse(join(dir, 'b'), 390, 844, true);
  try {
    const rows = () => evaluate('JSON.stringify([...document.querySelectorAll(".ib-row")].map((r) => [r.querySelector(".t").textContent, r.querySelector(".ib-n")?.textContent ?? "", r.querySelector(".ib-nr")?.textContent ?? ""]))').then(JSON.parse);
    const flts = () => evaluate('JSON.stringify([...document.querySelectorAll(".ib-flt")].map((b) => [b.textContent, b.getAttribute("aria-pressed")]))').then(JSON.parse);
    await evaluate(`location.href = ${JSON.stringify(`${url}#inbox`)}`);
    await until(() => evaluate('!!document.querySelector(".ib-row")'));
    // The two sides of unread sit on the rows: the reply not opened (a count), and what the agent has not read (a quiet mark).
    await until(async () => (await rows()).some((r) => r[0] === 'Ship the settings page Friday?' && r[1] === '1'));
    const all = await rows();
    assert.deepEqual(all.find((r) => r[0] === 'Keep the weekly digest?'), ['Keep the weekly digest?', '', 'Not read']);
    assert.deepEqual(all.find((r) => r[0] === 'Ship the settings page Friday?'), ['Ship the settings page Friday?', '1', '']);
    assert.deepEqual(all.find((r) => r[0] === 'Turn on the CSV export?'), ['Turn on the CSV export?', '', '']);
    // Each filter counts the threads it lists, and a second tap lets it go.
    assert.deepEqual(await flts(), [['Unread from agents1', 'false'], ['Not read by agents1', 'false']]);
    // On a phone the kinds and both unread filters are one row that scrolls sideways, never two; Agents and Done are one short row right under it, above the first thread.
    assert.deepEqual(await evaluate('JSON.stringify((() => { const bar = document.querySelector(".ib-bar"), tops = new Set([...document.querySelectorAll(".ib-chip, .ib-flt")].map((b) => Math.round(b.getBoundingClientRect().top))), foot = document.querySelector(".ib-foot").getBoundingClientRect(), ents = [...document.querySelectorAll(".ib-ent")].map((e) => Math.round(e.getBoundingClientRect().top)); return [tops.size, bar.scrollWidth > bar.clientWidth, getComputedStyle(bar).flexWrap, new Set(ents).size, foot.top >= bar.getBoundingClientRect().bottom && foot.bottom <= document.querySelector(".ib-row").getBoundingClientRect().top, foot.height < 56]; })())').then(JSON.parse), [1, true, 'nowrap', 1, true, true]);
    await evaluate('document.querySelectorAll(".ib-flt")[1].click()');
    await until(async () => (await flts())[1][1] === 'true');
    assert.deepEqual((await rows()).map((r) => r[0]), ['Keep the weekly digest?']);
    await evaluate('document.querySelectorAll(".ib-flt")[0].click()');
    await until(async () => (await flts())[0][1] === 'true');
    assert.deepEqual((await rows()).map((r) => r[0]), ['Ship the settings page Friday?']);
    await evaluate('document.querySelectorAll(".ib-flt")[0].click()');
    await until(async () => (await rows()).length === 3);
    // The rail ends on Agents (the read-only Channels room) and Done, which holds none of these.
    assert.equal(await evaluate('document.querySelector(".ib-agents").getAttribute("href")'), '#channels');
    assert.equal(await evaluate('document.querySelector(".ib-done").textContent'), 'Done0');
    // Opening the reply's thread marks it seen: the count leaves its row and the filter.
    await evaluate('[...document.querySelectorAll(".ib-row")].find((r) => r.textContent.includes("Ship the settings")).click()');
    await until(() => evaluate('!!document.querySelector(".ib-thread")'));
    await evaluate('location.hash = "#inbox"');
    await until(async () => (await flts())[0][0] === 'Unread from agents0');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true);
  } finally { await close(); }
});

test('the inbox groups threads by agent and topic: an agent\'s cards on one ticket share one thread named by the ticket, another agent or a card with no ticket is its own, and both unread counts, the filters and a card\'s own address still work', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'inbox-groups'), file = join(dir, 'board.json'), pause = () => new Promise((ok) => setTimeout(ok, 1100));
  mkdirSync(dir);
  assert.equal(run('ticket', file, '--id', 'T-7', '--title', 'Ship the CSV export', '--project', 'Settings').code, 0);
  // Two cards of one agent on T-7, one card of another agent on T-7, and one lone ask of the first agent.
  for (const [key, title, filer, ticket] of [['plan', 'Which columns does the export have?', 'csv-agent', 'T-7'], ['proof', 'Is the export tested?', 'csv-agent', 'T-7'], ['other', 'Who reviews the export?', 'review-agent', 'T-7'], ['lone', 'Rename the export button?', 'csv-agent', '']]) {
    assert.equal(run('raise', file, '--key', key, '--title', title, '--filer', filer, ...(ticket ? ['--ticket', ticket] : [])).code, 0);
  }
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  // The person wrote on both cards of csv-agent (neither read), answered the other agent's, and the lone one; csv-agent replies on the first.
  assert.equal((await post(url, 'api/messages', { kind: 'comment', key: 'plan', text: 'Include the owner column.' })).status, 200);
  assert.equal((await post(url, 'api/messages', { kind: 'comment', key: 'proof', text: 'Which browsers?' })).status, 200);
  assert.equal((await post(url, 'api/answers', { key: 'other', answer: 'text', note: 'Who reviews it?' })).status, 200);
  assert.equal((await post(url, 'api/messages', { kind: 'comment', key: 'lone', text: 'Call it Download.' })).status, 200);
  assert.equal(run('wait', file, '--filer', 'review-agent', '--timeout', '5').code, 0);
  await pause();
  assert.equal(run('feedback', 'other', file, '--reply', 'Dana reviews it.', '--filer', 'review-agent').code, 0);
  const { evaluate, close } = await browse(join(dir, 'b'), 390, 844, true);
  try {
    const rows = () => evaluate('JSON.stringify([...document.querySelectorAll(".ib-row")].map((r) => [r.querySelector(".ib-ag").textContent, r.querySelector(".t").textContent, r.querySelector(".ib-n")?.textContent ?? "", r.querySelector(".ib-nr")?.textContent ?? ""]).sort())').then(JSON.parse);
    await evaluate(`location.href = ${JSON.stringify(`${url}#inbox`)}`);
    await until(async () => (await rows()).length === 3);
    // csv-agent's two cards on T-7 are one thread named by the ticket, with both unsent-reads counted; the other agent's card on the same ticket and the lone ask are their own.
    assert.deepEqual(await rows(), [['csv-agent · 2 items', 'Ship the CSV export', '', 'Not read'], ['csv-agent', 'Rename the export button?', '', 'Not read'], ['review-agent', 'Ship the CSV export', '1', '']]);
    assert.equal(await evaluate('document.querySelector(".ib-flt:last-of-type b").textContent'), '2');
    // The thread holds both cards, each as an inline card, and both comments as bubbles on the right (everything here happened in one second, so each card's first words come before what was sent).
    await evaluate('[...document.querySelectorAll(".ib-row")].find((r) => r.textContent.includes("2 items")).click()');
    await until(() => evaluate('!!document.querySelector(".ib-thread")'));
    assert.deepEqual(await evaluate('JSON.stringify([...document.querySelectorAll(".ib-thread .ib-art .ib-at b")].map((b) => b.textContent))').then(JSON.parse), ['Which columns does the export have?', 'Is the export tested?']);
    assert.deepEqual(await evaluate('JSON.stringify([...document.querySelectorAll(".ib-thread .ib-msg")].map((m) => [m.classList.contains("you") ? "you" : "agent", m.querySelector(".ib-say")?.textContent ?? ""]))').then(JSON.parse), [['agent', ''], ['agent', ''], ['you', 'Include the owner column.'], ['you', 'Which browsers?']]);
    assert.equal(await evaluate('document.querySelector(".ib-thread .ib-ttl").textContent'), 'Ship the CSV export');
    assert.equal(await evaluate('document.querySelector(".ib-thread .ib-crumb").textContent.includes("csv-agent")'), true);
    // A card's own address opens the same thread, and its Open link names that card.
    assert.deepEqual(await evaluate('JSON.stringify([...document.querySelectorAll(".ib-thread .ib-art .ib-open")].map((a) => a.getAttribute("href")))').then(JSON.parse), ['#inbox/plan/open', '#inbox/proof/open']);
    await evaluate('location.hash = "#inbox/proof"');
    await until(() => evaluate('document.querySelector(".ib-thread .ib-ttl")?.textContent === "Ship the CSV export" && document.querySelectorAll(".ib-thread .ib-art").length === 2'));
    // Writing in the thread goes to its latest card (proof), as a comment.
    await evaluate('{ const b = document.querySelector(".ib-compose textarea"); b.value = "And Safari?"; b.dispatchEvent(new Event("input")); document.querySelector(".ib-send").click(); }');
    await until(async () => ((await (await fetch(`${url}api/decisions`)).json()).messages ?? []).some((m) => m.text === 'And Safari?' && m.key === 'proof'));
    assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true);
  } finally { await close(); }
});

test('the inbox: a thread whose question is answered and whose card is marked acted leaves New for the archived fold, stays searchable, and returns when a new message lands', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'inbox-acted'), file = join(dir, 'board.json'), pause = () => new Promise((ok) => setTimeout(ok, 1100));
  mkdirSync(dir);
  const link = 'https://github.com/example/digest/pull/9';
  for (const [key, title] of [['acted', 'Send the digest on Mondays?'], ['worded', 'Keep the weekly digest?'], ['quiet', 'Turn on the CSV export?'], ['back', 'Open the beta to every team?'], ['again', 'Ship the settings page Friday?']]) assert.equal(run('raise', file, '--key', key, '--title', title, '--filer', 'acted-agent').code, 0);
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  // acted: answered, and the agent marked it acted. worded: answered, and the agent wrote back. quiet: answered, nothing back yet.
  // back: acted, then the agent wrote again. again: acted, then the person wrote on it.
  for (const key of ['acted', 'worded', 'quiet', 'back', 'again']) assert.equal((await post(url, 'api/answers', { key, answer: 'yes' })).status, 200);
  assert.equal(run('wait', file, '--filer', 'acted-agent', '--timeout', '5').code, 0);
  await pause();
  assert.equal(run('feedback', 'worded', file, '--reply', 'Moved to Mondays.', '--filer', 'acted-agent').code, 0);
  for (const key of ['acted', 'back', 'again']) assert.equal(run('feedback', key, file, '--acted', '--link', link, '--filer', 'acted-agent').code, 0);
  const { evaluate, close } = await browse(join(dir, 'b'), 390, 844, true);
  try {
    const list = () => evaluate('JSON.stringify([...document.querySelectorAll(".ib-sec")].map((s) => [s.getAttribute("aria-label"), ...[...s.querySelectorAll(".ib-row")].map((r) => (r.classList.contains("unread") ? "* " : "") + r.querySelector(".t").textContent)]))').then(JSON.parse);
    const chips = () => evaluate('JSON.stringify([...document.querySelectorAll(".ib-chip")].map((c) => c.textContent))').then(JSON.parse);
    await evaluate(`location.href = ${JSON.stringify(`${url}#inbox`)}`);
    await until(() => evaluate('!!document.querySelector(".ib-sec")'));
    // Answered and acted is archived, though its reply was never opened; answered and worded back, or not yet answered back, is not.
    await until(async () => JSON.stringify(await list()) === JSON.stringify([['New', '* Keep the weekly digest?'], ['Waiting on agents', 'Turn on the CSV export?']]))
      .catch(async (e) => assert.fail(`${e.message}: ${JSON.stringify(await list())}`));
    assert.equal(await evaluate('document.querySelector(".ib-done").textContent'), 'Done3');
    // Every chip counts the rows it lists, and the archived ones are not among them.
    assert.deepEqual(await chips(), ['All2', 'Decisions2', 'Tickets']);
    // Search finds an archived thread without opening the fold; the fold lists them with the same rows.
    await evaluate('{ const b = document.getElementById("ib-find"); b.value = "digest on mondays"; b.dispatchEvent(new Event("input")); }');
    await until(async () => JSON.stringify(await list()) === JSON.stringify([['Done', 'Send the digest on Mondays?']]));
    await evaluate('{ const b = document.getElementById("ib-find"); b.value = ""; b.dispatchEvent(new Event("input")); }');
    await evaluate('document.querySelector(".ib-done").click()');
    await until(async () => (await list()).at(-1)?.[0] === 'Done');
    assert.deepEqual((await list()).at(-1).slice(1).sort(), ['Open the beta to every team?', 'Send the digest on Mondays?', 'Ship the settings page Friday?']);
    // A new message brings a thread back: the agent writes again (New), the person writes (waiting on the agent).
    await pause();
    assert.equal(run('feedback', 'back', file, '--reply', 'Beta is open to ten teams.', '--filer', 'acted-agent').code, 0);
    assert.equal((await post(url, 'api/messages', { kind: 'comment', key: 'again', text: 'Can you also post the link in the channel?' })).status, 200);
    await evaluate('location.hash = "#inbox"; location.reload()');
    await until(async () => (await list()).some((s) => s[0] === 'New' && s.includes('* Open the beta to every team?')));
    await evaluate('document.querySelector(".ib-done").click()');
    await until(async () => (await list()).at(-1)?.[0] === 'Done');
    assert.deepEqual(await list(), [['New', '* Open the beta to every team?', '* Keep the weekly digest?'], ['Waiting on agents', 'Ship the settings page Friday?', 'Turn on the CSV export?'], ['Done', 'Send the digest on Mondays?']]);
    assert.deepEqual(await chips(), ['All4', 'Decisions4', 'Tickets']);
  } finally { await close(); }
});

test('the inbox holds only the threads the person took part in: an ask they never touched and an unread report are absent, an answered one and a comment are present, the badge ignores the untouched, and a thread shows sent, read, acted and its named result', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'inbox-members'), file = join(dir, 'board.json'), pause = () => new Promise((ok) => setTimeout(ok, 1100));
  mkdirSync(dir);
  const link = 'https://github.com/example/digest/pull/9';
  for (const [key, title] of [['untouched', 'Keep the weekly digest?'], ['answered', 'Send the digest on Mondays?'], ['chatted', 'Open the beta to every team?'], ['unread', 'Turn on the CSV export?']]) assert.equal(run('raise', file, '--key', key, '--title', title, '--filer', 'member-agent').code, 0);
  writeFileSync(join(dir, 'report.html'), '<!doctype html><title>Weekly digest</title><p>Open rate held steady.</p>');
  writeFileSync(join(dir, 'preview.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#ccc"/></svg>');
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  stored.items.push({ contract: 1, kind: 'report', schema: 2, key: 'digest', title: 'Weekly digest', group: 'Settings', view: 'report.html', preview: 'preview.svg', purpose: 'other', filed: new Date().toISOString() });
  writeFileSync(file, JSON.stringify(stored));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  // answered: the person answered and the agent acted with a link. chatted: the person only commented. untouched, unread: never touched, and the report: not read.
  assert.equal((await post(url, 'api/answers', { key: 'answered', answer: 'yes' })).status, 200);
  assert.equal((await post(url, 'api/messages', { kind: 'comment', key: 'chatted', text: 'Which teams first?' })).status, 200);
  assert.equal(run('wait', file, '--filer', 'member-agent', '--timeout', '5').code, 0);
  await pause();
  assert.equal(run('feedback', 'answered', file, '--acted', '--link', link, '--filer', 'member-agent').code, 0);
  const { evaluate, close } = await browse(join(dir, 'b'), 390, 844, true);
  try {
    const rows = () => evaluate('JSON.stringify([...document.querySelectorAll(".ib-row .t")].map((t) => t.textContent).sort())').then(JSON.parse);
    const badge = () => evaluate('document.querySelector("#tabs a[href=\\"#inbox\\"] .bd")?.textContent ?? ""');
    await evaluate(`location.href = ${JSON.stringify(`${url}#inbox`)}`);
    await until(() => evaluate('!!document.querySelector(".ib-sec")'));
    await evaluate('document.querySelector(".ib-done")?.click()');
    // Present: the one answered and the one commented on. Absent: the ask, the unread report and the other ask nobody touched.
    assert.deepEqual(await rows(), ['Open the beta to every team?', 'Send the digest on Mondays?']);
    assert.equal(await badge(), '');
    // The other places keep what the inbox does not hold.
    const decide = await (await fetch(`${url}api/decisions`)).json();
    assert.ok(['untouched', 'unread', 'digest'].every((k) => decide.decisions.some((d) => d.key === k)));
    // The answered thread's life: sent, read, acted, and its result named.
    await evaluate('location.hash = "#inbox/answered"');
    await until(() => evaluate('!!document.querySelector(".ib-thread .ib-rcpt")'));
    assert.deepEqual(await evaluate('JSON.stringify([[...document.querySelectorAll(".ib-thread .ib-rcpt time")].map((t) => t.textContent.replace(/\\d\\d:\\d\\d|\\d+ \\w+$/, "").trim()), [...document.querySelectorAll(".ib-thread .ib-art b")].map((b) => b.textContent), document.querySelectorAll(".ib-thread .ib-nr").length])').then(JSON.parse), [['Read'], ['Send the digest on Mondays?', 'Pull request 9'], 0]);
    // A comment the agent has not read says Sent, and Not read beside it; nothing says Read.
    await evaluate('location.hash = "#inbox/chatted"');
    await until(() => evaluate('!!document.querySelector(".ib-thread .ib-rcpt")'));
    assert.deepEqual(await evaluate('JSON.stringify([[...document.querySelectorAll(".ib-thread .ib-rcpt time")].map((t) => t.textContent.replace(/\\d\\d:\\d\\d|\\d+ \\w+$/, "").trim()), [...document.querySelectorAll(".ib-thread .ib-nr")].map((n) => n.textContent)])').then(JSON.parse), [['Sent'], ['Not read']]);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true);
  } finally { await close(); }
});

test('the inbox badge counts only the threads that need the person: an answered, an acted on and an archived thread leave it, a new message brings its thread back, and it equals the rows that ask for them', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'inbox-badge'), file = join(dir, 'board.json'), pause = () => new Promise((ok) => setTimeout(ok, 1100));
  mkdirSync(dir);
  const link = 'https://github.com/example/digest/pull/9';
  for (const [key, title] of [['open', 'Send the digest on Mondays?'], ['quiet', 'Turn on the CSV export?'], ['acted', 'Open the beta to every team?'], ['gone', 'Ship the settings page Friday?']]) assert.equal(run('raise', file, '--key', key, '--title', title, '--filer', 'badge-agent').code, 0);
  // A report not read yet is listed under New, but asks nothing of the person.
  writeFileSync(join(dir, 'report.html'), '<!doctype html><title>Weekly digest</title><p>Open rate held steady.</p>');
  writeFileSync(join(dir, 'preview.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#ccc"/></svg>');
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  stored.items.push({ contract: 1, kind: 'report', schema: 2, key: 'digest', title: 'Weekly digest', group: 'Settings', view: 'report.html', preview: 'preview.svg', purpose: 'other', filed: new Date().toISOString() });
  writeFileSync(file, JSON.stringify(stored));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const url = /url: "(\S+)"/.exec(await served(proc))[1];
  // quiet: answered, nothing back yet. acted: answered, and the agent marked it acted. gone: archived. open: still waiting on the person, who never touched it.
  for (const key of ['quiet', 'acted', 'gone']) assert.equal((await post(url, 'api/answers', { key, answer: 'yes' })).status, 200);
  assert.equal(run('wait', file, '--filer', 'badge-agent', '--timeout', '5').code, 0);
  await pause();
  assert.equal(run('feedback', 'acted', file, '--acted', '--link', link, '--filer', 'badge-agent').code, 0);
  assert.equal((await post(url, 'api/dismiss', { keys: ['gone'], dismissed: true })).status, 200);
  const { evaluate, close } = await browse(join(dir, 'b'), 390, 844, true);
  try {
    const badge = () => evaluate('document.querySelector("#tabs a[href=\\"#inbox\\"] .bd")?.textContent ?? ""');
    // What the inbox lists as asking for the person: every New row an agent wrote on, and every row under Decide.
    const asking = () => evaluate('[...document.querySelectorAll(".ib-sec")].filter((s) => ["New", "Decide"].includes(s.getAttribute("aria-label"))).reduce((n, s) => n + [...s.querySelectorAll(".ib-row")].filter((r) => !/Weekly digest/.test(r.textContent)).length, 0)');
    await evaluate(`location.href = ${JSON.stringify(`${url}#inbox`)}`);
    await until(() => evaluate('!!document.querySelector(".ib-sec")'));
    // Nothing new has been written to the person: the open ask they never touched, the answered, the acted on, the archived and an unread report are none of them a reply to read.
    await until(() => evaluate('!!document.querySelector(".ib-sec")'));
    assert.equal(await badge(), '');
    assert.equal(await asking(), 0);
    assert.equal(await evaluate('[...document.querySelectorAll(".ib-row")].some((r) => /Weekly digest|digest on Mondays/.test(r.textContent))'), false, 'a report and an ask the person never touched are not threads');
    // The agent writes on the acted thread: it returns, and the count goes up by one.
    await pause();
    assert.equal(run('feedback', 'acted', file, '--reply', 'Beta is open to ten teams.', '--filer', 'badge-agent').code, 0);
    await evaluate('location.reload()');
    await until(async () => (await badge()) === '1').catch(async (e) => assert.fail(`${e.message}: ${await badge()}`));
    assert.equal(await asking(), 1);
  } finally { await close(); }
});
