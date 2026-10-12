import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { networkInterfaces, tmpdir } from 'node:os';
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
  writeFileSync(join(so, 'config.yaml'), 'board: decisions.json\nport: 4410\n');
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
  for (const [key, type] of [['flow', 'image/svg+xml'], ['demo', 'text/html'], ['pick-the-sign-in-layout&value=a', 'text/html']]) {
    const res = await fetch(`${url}api/mock?key=${key}`);
    assert.equal(res.headers.get('content-type'), type);
    assert.match(res.headers.get('content-security-policy'), /connect-src 'none'.*sandbox allow-scripts/);
  }
  assert.equal((await post(url, 'api/answers', { key: 'demo', answer: 'needs-work', note: 'Umer: the back step is lost.' })).status, 200);
  assert.equal(JSON.parse(run('answers', board, '--key', 'demo', '--json').out).demo.answer, 'needs-work');
  assert.deepEqual(api.rounds, []);
  assert.equal(await (await fetch(`${url}api/mock?key=pick-the-sign-in-layout&value=a`)).text(), '<h1>Mock A</h1>');
  assert.equal((await fetch(`${url}api/mock?key=pick-the-sign-in-layout&value=z`)).status, 404);
  assert.equal(await (await fetch(`${url}api/mock?key=nav&value=b&variant=b`)).text(), '<p>variant page</p>');
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
  assert.match(run('export', board, '--out', out).out, /items: 7\ninlined: 8\nmissing: 1\n/);
  const frozen = readFileSync(out, 'utf8');
  assert.match(frozen, /<meta http-equiv="content-security-policy" content="default-src 'none';/);
  const data = JSON.parse(/window\.FROZEN = (.*);<\/script>/.exec(frozen)[1]);
  assert.equal(data.files['/api/mock?key=pick-the-sign-in-layout&value=a'], `data:text/html;base64,${Buffer.from('<h1>Mock A</h1>').toString('base64')}`);
  // A one-page mock keeps its ?variant= in the frame URL; the trailing comment hides it from the page text.
  assert.equal(data.files['/api/mock?key=nav&value=b&variant=b'], `data:text/html;charset=utf-8,${encodeURIComponent('<p>variant page</p>')}%3C!--?variant=b`);
  assert.equal(data.answers['pick-the-sign-in-layout'].answer, 'b');
  assert.equal(data.messages.length, 2);
  // A diagram and an interactive page are inlined too, so the frozen copy shows them with no server.
  assert.equal(data.files['/api/mock?key=flow'], `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>').toString('base64')}`);
  assert.ok(data.files['/api/mock?key=demo']);
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
  for (const path of ['/', '/api/decisions', '/api/board', '/api/mock?key=pick-the-sign-in-layout&value=a', '/api/media?key=x&i=0', `/?token=${'x'.repeat(token.length)}`]) {
    assert.equal((await fetch(`${origin}${path}`)).status, 401, path);
  }
  assert.equal((await post(`${origin}/`, 'api/messages', { kind: 'prompt', text: 'hi' })).status, 401);
  const entry = await fetch(link, { redirect: 'manual' });
  assert.deepEqual([entry.status, entry.headers.get('location')], [303, '/']);
  const cookie = entry.headers.get('set-cookie').split(';')[0];
  assert.match(entry.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const api = await fetch(`${origin}/api/decisions`, { headers: { cookie } });
  assert.equal(api.status, 200);
  assert.equal(api.headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(`${origin}/api/mock?key=pick-the-sign-in-layout&value=a`, { headers: { cookie } })).status, 200);
  assert.match(run('status', board).out, /status: running/);
  assert.match(run('stop', board).out, /status: stopped/);
  const reopened = run('open', board, '--port', String(port), '--bind', mine.address);
  assert.equal(new URL(/url: "(.+)"/.exec(reopened.out)[1]).searchParams.get('token'), token);
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
});
