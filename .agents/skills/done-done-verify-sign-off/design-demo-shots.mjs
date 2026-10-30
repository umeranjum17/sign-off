// A design card whose options carry a demo recording (post --video and --score): the card plays it muted in place on a tap, opens it full screen with the option's
// round score, and the Designs row shows the recording's own first frame. The recording is fixtures/demo-video/board-tour.webm, a short synthetic clip of this board's own UI.
// Frames at 390 (phone) and 1280 (desk), light and dark: the card with the demo playing, and the demo full screen; at 390 light also the Designs row, and the desk's Designs screen at 1440 in dark.
// Usage: node design-demo-shots.mjs <output>
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-demo-')), prof = mkdtempSync(join(tmpdir(), 'so-demo-chrome-'));
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.c'), XDG_DATA_HOME: join(dir, '.d'), XDG_STATE_HOME: join(dir, '.s'), XDG_CACHE_HOME: join(dir, '.k') };
const board = join(dir, 'board.json');
const chromium = ['/usr/bin/chromium', '/usr/lib/chromium/chromium'].find(existsSync);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let server, chrome, ws;
try {
  mkdirSync(join(dir, 'mocks/sign-in'), { recursive: true });
  for (const [v, name] of [['calm', 'Calm'], ['bold', 'Bold']]) writeFileSync(join(dir, `mocks/sign-in/${v}.html`), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><body style="margin:0;font:16px system-ui;background:#f4f2ef"><header style="padding:16px;font-weight:600">${name} sign-in</header><button style="margin:16px;padding:12px 16px;font:inherit">Send me a code</button>`);
  copyFileSync(join(repo, 'fixtures/demo-video/board-tour.webm'), join(dir, 'calm-demo.webm'));
  copyFileSync(join(repo, 'fixtures/demo-video/board-tour.mp4'), join(dir, 'bold-demo.mp4'));
  const post = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), 'post', board, '--type', 'design', '--key', 'sign-in-demo', '--title', 'Which sign-in flow reads best?', '--option', 'calm=Calm', '--option', 'bold=Bold',
    '--mock', 'calm=mocks/sign-in/calm.html', '--mock', 'bold=mocks/sign-in/bold.html', '--video', 'calm=calm-demo.webm', '--score', 'calm=8.5', '--video', 'bold=bold-demo.mp4', '--score', 'bold=7.2', '--recommend', 'calm'], { env, encoding: 'utf8' });
  assert.equal(post.status, 0, post.stdout + post.stderr);
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127.0.0.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', () => no(Error('server exited'))); });
  chrome = spawn(chromium, ['--headless=new', '--no-sandbox', '--autoplay-policy=document-user-activation-required', `--user-data-dir=${prof}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); if (existsSync(join(prof, 'DevToolsActivePort'))) port = readFileSync(join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0]; }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } };
  const cdp = (method, params = {}) => new Promise((r, j) => { const n = ++id; pending.set(n, (x) => (x.error ? j(new Error(`${method}: ${x.error.message}`)) : r(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  const evalIn = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert.ok(!r.exceptionDetails, r.exceptionDetails?.exception?.description); return r.result.value; };
  const until = async (expression, what) => { for (let i = 0; i < 150; i++) { if (await evalIn(expression)) return; await wait(100); } assert.fail(`never: ${what}`); };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  const HEIGHT = { 390: 844, 1280: 800, 1440: 900 }, records = [];
  const open = async (width, theme, hash) => {
    const phone = width < 1024;
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: HEIGHT[width], deviceScaleFactor: 1, mobile: phone });
    await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await cdp('Page.navigate', { url: 'about:blank' }); await wait(150);
    await cdp('Page.navigate', { url: `${url}${hash}` }); await wait(1200);
    await evalIn(`localStorage.setItem('so-theme', '${theme}'); 0`); await cdp('Page.reload'); await wait(1500);
  };
  const frame = async (file) => { writeFileSync(join(out, file), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64')); };
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
    await open(width, theme, '#decide/sign-in-demo');
    await until(`!!document.querySelector('.demo video')`, 'the card draws its demos');
    const cards = await evalIn(`[...document.querySelectorAll('.demo')].map((f) => ({ label: f.querySelector('figcaption').textContent, score: f.querySelector('.demo-score')?.textContent, paused: f.querySelector('video').paused, muted: f.querySelector('video').muted }))`);
    assert.deepEqual(cards.map((c) => [c.label, c.score, c.paused, c.muted]), [['Calm', 'Round score8.5', true, true], ['Bold', 'Round score7.2', true, true]], `${width} ${theme}: both demos wait to be tapped, muted, with their scores`);
    // A tap plays the recommended option's demo in place: no screen opens, and the video moves.
    await evalIn(`(() => { const b = document.querySelector('.demo .demo-play'); b.scrollIntoView({ block: 'center' }); b.click(); return 1; })()`);
    await until(`(() => { const v = document.querySelector('.demo video'); return !v.paused && v.currentTime > 0.4; })()`, 'the demo plays in place');
    const playing = await evalIn(`(() => { const v = document.querySelector('.demo video'), r = v.getBoundingClientRect(); return { paused: v.paused, muted: v.muted, time: v.currentTime, width: r.width, height: r.height, dialog: !!document.querySelector('dialog[open]'), overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth }; })()`);
    assert.equal(playing.paused, false); assert.equal(playing.muted, true); assert.equal(playing.dialog, false); assert.ok(playing.width > 150 && playing.height > 100, JSON.stringify(playing));
    await wait(300);
    const cardFile = `card-playing.${width}.${theme}.png`;
    await frame(cardFile); records.push({ file: cardFile, ...playing });
    // Full screen: the option and its round score in the bar, the recording playing over the whole viewport.
    await evalIn(`document.querySelector('.demo .demo-full-open').click(); 1`);
    await until(`(() => { const v = document.querySelector('dialog.demo-full[open] video'); return !!v && !v.paused && v.currentTime > 0.4; })()`, 'the demo opens full screen');
    const full = await evalIn(`(() => { const d = document.querySelector('dialog.demo-full'), r = d.getBoundingClientRect(), v = d.querySelector('video').getBoundingClientRect();
      return { w: r.width, h: r.height, iw: innerWidth, ih: innerHeight, title: d.querySelector('h2').textContent, score: d.querySelector('.demo-score').textContent, vw: v.width, vh: v.height, muted: d.querySelector('video').muted }; })()`);
    assert.deepEqual([full.w, full.h], [full.iw, full.ih]); assert.equal(full.title, 'Calm'); assert.match(full.score, /8\.5/); assert.ok(full.vw >= 0.9 * width && full.vh >= 0.7 * full.ih, JSON.stringify(full));
    const fullFile = `full-screen.${width}.${theme}.png`;
    await frame(fullFile); records.push({ file: fullFile, ...full });
  }
  // The Designs row: the recording's own first frame is its media.
  for (const width of [390, 1280]) {
    await open(width, 'light', '#designs');
    await until(`document.querySelector('#board video.design-thumb')?.videoWidth > 0`, 'the row draws the recording\'s first frame');
    const row = await evalIn(`(() => ({ row: document.querySelector('#board .dz-list li')?.innerText.replace(/\\s+/g, ' '), pictures: document.querySelectorAll('#board .dz-list img').length, videos: document.querySelectorAll('#board .dz-list video.design-thumb').length, frame: document.querySelector('#board video.design-thumb').videoWidth }))()`);
    assert.equal(row.pictures, 0); assert.equal(row.videos, 1); assert.match(row.row, /Which sign-in flow reads best\?/);
    if (width === 390) await frame(`designs-row.${width}.light.png`);
    records.push({ file: `designs-row.${width}.light`, ...row });
  }
  // The desk's Designs screen in dark, where the pick is listed with the recording's frame: the capture the approved design-pick-listing spec names.
  await open(1440, 'dark', '#designs');
  await until(`document.querySelector('#board video.design-thumb')?.videoWidth > 0`, 'the desk Designs list draws the recording\'s first frame');
  assert.match(await evalIn(`document.querySelector('#board').innerText`), /Which sign-in flow reads best\?/);
  await frame('designs.1440.dark.png');
  const refused = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), 'post', board, '--type', 'design', '--key', 'not-a-recording', '--title', 'Which sign-in flow reads clearest?', '--option', 'calm=Calm', '--option', 'bold=Bold', '--mock', 'calm=mocks/sign-in/calm.html', '--video', 'calm=mocks/sign-in/calm.html'], { env, encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  writeFileSync(join(out, 'checks.json'), JSON.stringify(records, null, 2));
  writeFileSync(join(out, 'post.txt'), `${post.stdout}\n--video with an .html file:\n${refused.stdout}${refused.stderr}`);
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ commit: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), before: false, target: { version: spawnSync(process.execPath, [join(repo, 'dist/cli.js'), '--version'], { encoding: 'utf8' }).stdout.trim() },
    start: 'A throwaway board holding one design pick of two sign-in flows, each option posted with --video (a short synthetic recording of this board) and --score.',
    steps: ['Open the card in Decide', 'Tap the first demo: it plays muted in place', 'Open it full screen: the option and its round score show', 'Open Designs: the row shows the recording\'s first frame', 'Capture at 390 and 1280 wide, light and dark'],
    result: 'frames and checks' }, null, 2));
} finally {
  try { ws?.close(); chrome?.kill(); server?.kill(); } catch {}
  await wait(400); rmSync(dir, { recursive: true, force: true }); rmSync(prof, { recursive: true, force: true });
}
