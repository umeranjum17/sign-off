import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const run = promisify(execFile), cli = new URL('../dist/cli.js', import.meta.url).pathname;
const tour = (ext) => new URL(`../fixtures/demo-video/board-tour.${ext}`, import.meta.url).pathname;

// A short synthetic recording of the board's own UI is the demo of an option (post --video and --score): the board plays it in the card and full screen, and the Designs row shows its first frame.
const home = mkdtempSync(join(tmpdir(), 'dv-')), board = join(home, 'board.json');
const env = { ...process.env, PATH: `/usr/bin:${process.env.PATH}`, HOME: home, XDG_CONFIG_HOME: join(home, 'c'), XDG_STATE_HOME: join(home, 's'), XDG_DATA_HOME: join(home, 'd'), XDG_CACHE_HOME: join(home, 'k') };
delete env.SIGN_OFF_FILER; delete env.CLAUDE_CODE_SESSION_ID;
const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].flatMap((b) => process.env.PATH.split(':').map((d) => join(d, b))).find(existsSync);
// Chrome puts a socket in its TMPDIR and stops when that path passes 107 characters, so it gets one short throwaway folder of its own.
const chromeTmp = chrome && mkdtempSync('/tmp/so-');
const procs = [];
after(async () => {
  for (const p of procs) p.kill();
  if (chromeTmp) await new Promise((ok) => setTimeout(ok, 300));
  rmSync(home, { recursive: true, force: true });
  if (chromeTmp) rmSync(chromeTmp, { recursive: true, force: true });
});
mkdirSync(join(home, 'mocks/k'), { recursive: true });
writeFileSync(join(home, 'mocks/k/live.html'), '<h1>Sign-in</h1><button onclick="document.title=1">Next</button>');
copyFileSync(tour('webm'), join(home, 'tour-a.webm'));
copyFileSync(tour('mp4'), join(home, 'tour-b.mp4'));
const post = (key, title, ...more) => run(process.execPath, [cli, 'post', board, '--type', 'design', '--key', key, '--title', title, '--option', 'a=A', '--option', 'b=B', '--mock', 'a=mocks/k/live.html', '--mock', 'b=mocks/k/live.html', '--recommend', 'a', ...more], { env });
const items = () => JSON.parse(readFileSync(board, 'utf8')).items;
const refused = (p, pattern) => assert.rejects(p, (e) => pattern.test(e.stdout + e.stderr));

test('post copies a demo recording byte for byte with its score, refuses what is not a recording, and leaves a card without one as it was', async () => {
  const bytes = readFileSync(tour('webm')), hash = createHash('sha256').update(bytes).digest('hex');
  assert.match((await post('plain', 'Which sign-in layout should it use?')).stdout, /plain/);
  assert.equal(items().find((d) => d.key === 'plain').mocks.some((m) => m.video), false);
  assert.match((await post('demo', 'Which sign-in flow reads best?', '--video', 'a=tour-a.webm', '--score', 'a=8.5', '--video', 'b=tour-b.mp4', '--score', 'b=7')).stdout, /demo/);
  const [a, b] = items().find((d) => d.key === 'demo').mocks;
  assert.deepEqual(a.video, { path: `evidence/video/${hash.slice(0, 16)}.webm`, sha256: hash, bytes: bytes.length, score: 8.5 });
  assert.equal(b.video.score, 7);
  assert.match(b.video.path, /\.mp4$/);
  // Never converted: the stored file is the posted one.
  assert.ok(readFileSync(join(home, a.video.path)).equals(bytes));
  assert.deepEqual(readdirSync(join(home, 'evidence/video')).sort(), [a.video.path, b.video.path].map((p) => p.split('/').pop()).sort());
  // Refused: a text or picture file with a recording's name, a file that is not there, a score without its recording, a score off the scale, a video for an option with no mock.
  writeFileSync(join(home, 'fake.webm'), 'this is plain text, not a recording');
  writeFileSync(join(home, 'fake.mp4'), readFileSync(new URL('../fixtures/evidence/product-small.png', import.meta.url)));
  await refused(post('x1', 'Which sign-in flow reads clearest?', '--video', 'a=fake.webm'), /is not a real webm recording/);
  await refused(post('x2', 'Which sign-in flow reads clearest today?', '--video', 'a=fake.mp4'), /is not a real mp4 recording/);
  await refused(post('x3', 'Which sign-in flow reads quickest?', '--video', 'a=missing.webm'), /--video missing.webm/);
  await refused(post('x4', 'Which sign-in flow reads easiest?', '--score', 'a=8'), /needs a --video for that value/);
  await refused(post('x5', 'Which sign-in flow reads simplest?', '--video', 'a=tour-a.webm', '--score', 'a=101'), /from 0 to 100/);
  await refused(post('x6', 'Which sign-in flow reads plainest?', '--video', 'c=tour-a.webm'), /need a --mock for that value/);
  await refused(post('x7', 'Which sign-in flow reads brightest?', '--video', 'a=tour-a.gif'), /must end in .mp4 or .webm/);
  assert.deepEqual(items().map((d) => d.key), ['plain', 'demo']);
});

for (const [name, width, mobile] of [['a phone', 390, true], ['a desk', 1280, false]]) {
  test(`on ${name}, a demo plays muted in place on a tap, opens full screen with its score, and the Designs row shows its first frame`, { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
    const dir = join(home, name.replace(' ', '-')), file = join(dir, 'board.json');
    mkdirSync(join(dir, 'mocks/k'), { recursive: true });
    copyFileSync(join(home, 'mocks/k/live.html'), join(dir, 'mocks/k/live.html'));
    copyFileSync(tour('webm'), join(dir, 'tour.webm'));
    await run(process.execPath, [cli, 'post', file, '--type', 'design', '--key', 'tour', '--title', 'Which sign-in flow reads best?', '--option', 'a=Calm', '--option', 'b=Bold', '--mock', 'a=mocks/k/live.html', '--mock', 'b=mocks/k/live.html',
      '--video', 'a=tour.webm', '--score', 'a=8.5', '--recommend', 'a'], { env });
    const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    procs.push(proc);
    const url = await new Promise((ok) => { let out = ''; proc.stdout.on('data', (b) => { out += b; const m = /url: "(\S+)"/.exec(out); if (m) ok(m[1]); }); });
    const profile = mkdtempSync(join(chromeTmp, 'p-')), active = join(profile, 'DevToolsActivePort');
    const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { env: { ...process.env, TMPDIR: chromeTmp }, stdio: 'ignore' });
    procs.push(browser);
    const until = async (check) => { for (const end = Date.now() + 60000; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await check()) return; assert.fail('the page did not reach the expected state'); };
    await until(() => existsSync(active) && readFileSync(active, 'utf8').includes('\n'));
    const version = await (await fetch(`http://127.0.0.1:${readFileSync(active, 'utf8').split('\n')[0]}/json/version`)).json();
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((ok) => { ws.onopen = ok; });
    const replies = new Map();
    let seq = 0;
    ws.onmessage = (m) => { const msg = JSON.parse(m.data), done = replies.get(msg.id); if (done) { replies.delete(msg.id); done(msg.result); } };
    const call = (method, params, sessionId) => new Promise((ok) => { const id = ++seq; replies.set(id, ok); ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) })); });
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => call(method, params, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile });
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
    // A real mouse click at the middle of an element, as a person's tap is.
    const tap = async (selector) => {
      const [x, y] = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    };
    try {
      // The Designs row: the video's own first frame is its media, no picture.
      await evaluate(`location.href = ${JSON.stringify(`${url}#designs`)}`);
      await until(async () => (await evaluate(`document.querySelector('#board video.design-thumb')?.videoWidth`)) > 0);
      assert.equal(await evaluate(`document.querySelectorAll('#board .dz-list img').length`), 0);
      assert.equal(await evaluate(`document.querySelector('#board video.design-thumb').muted`), true);
      // The card: the recommended option's demo sits under its mock with its score, and is not playing until tapped.
      await evaluate(`location.href = ${JSON.stringify(`${url}#decide/tour`)}`);
      await until(() => evaluate(`!!document.querySelector('.demo video')`));
      assert.equal(await evaluate(`document.querySelectorAll('.demo').length`), 1);
      assert.match(await evaluate(`document.querySelector('.demo .demo-score').textContent`), /8\.5/);
      assert.equal(await evaluate(`document.querySelector('.demo video').paused`), true);
      await tap('.demo .demo-play');
      await until(() => evaluate(`(() => { const v = document.querySelector('.demo video'); return !v.paused && v.currentTime > 0.2; })()`));
      assert.equal(await evaluate(`document.querySelector('.demo video').muted`), true);
      assert.equal(await evaluate(`document.querySelector('.demo-stage').classList.contains('playing')`), true);
      assert.equal(await evaluate(`!!document.querySelector('dialog[open]')`), false);
      // Full screen: the whole viewport, the option and its score in the bar, the recording playing.
      await tap('.demo .demo-full-open');
      await until(() => evaluate(`!!document.querySelector('dialog.demo-full[open] video')`));
      const full = await evaluate(`(() => { const d = document.querySelector('dialog.demo-full'), r = d.getBoundingClientRect(), v = d.querySelector('video');
        return { w: r.width, h: r.height, iw: innerWidth, ih: innerHeight, title: d.querySelector('h2').textContent, score: d.querySelector('.demo-score').textContent, vw: v.getBoundingClientRect().width, vh: v.getBoundingClientRect().height, controls: v.controls }; })()`);
      assert.deepEqual([full.w, full.h], [full.iw, full.ih]);
      assert.equal(full.title, 'Calm');
      assert.match(full.score, /Round score\s*8\.5/);
      assert.ok(full.controls && full.vw > 0.9 * width && full.vh > 0.7 * full.ih, JSON.stringify(full));
      await until(() => evaluate(`(() => { const v = document.querySelector('dialog.demo-full video'); return !v.paused && v.currentTime > 0.2 && v.muted; })()`));
      await tap('.demo-full .pf-close');
      await until(async () => !(await evaluate(`!!document.querySelector('dialog.demo-full')`)));
    } finally {
      ws.close(); browser.kill(); proc.kill();
    }
  });
}
