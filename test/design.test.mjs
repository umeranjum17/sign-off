import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, get } from 'node:http';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';

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
const run = (...args) => {
  try {
    return { out: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout}`, code: e.status };
  }
};
const post = (url, path, body) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
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
  writeFileSync(join(scratch, 'report.json'), JSON.stringify({ schema: 1, decisions: [{ key: 'weekly-report', type: 'report', title: 'Approve the weekly report?' }] }));
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
  assert.match(html, /<h1>Dashboard<\/h1>/);
  const api = await (await fetch(`${url}api/decisions`)).json();
  assert.equal(api.decisions[0].type, 'design');
  assert.equal(api.decisions[0].title, 'Pick the sign-in layout');
  assert.equal(api.decisions[0].tradeoff, 'B scans fastest; A is simplest.');
  assert.equal(api.decisions[0].mocks.length, 3);
  assert.deepEqual(api.decisions.map((d) => d.type), ['design', 'report', 'decision', 'design', 'diagram', 'interactive', 'explainer']);
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
    '--mock', 'a=mocks/card/index.html?variant=a', '--mock', 'b=mocks/card/index.html?variant=b').out, /card,raised,/);
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
  for (const [path, body] of [['api/answers', { key: 'ask-1', answer: 'yes' }], ['api/rounds', { key: 'ask-1', note: 'again' }], ['api/messages', { kind: 'prompt', text: 'hi' }]]) {
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
