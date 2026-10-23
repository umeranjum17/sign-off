// Records the desk's Today and Evidence at 1280x800 in one theme, from a board seed-board.sh served: Today's Proofs today tile under Up next,
// a real mouse over it, a press on it that opens Evidence with the newest update selected beside the list,
// then three more rows picked, each selection's tint and accent bar moving and its update sliding in.
// Its own headless Chromium on a scratch profile, driven over the DevTools protocol with real mouse events.
// Usage: node desk-evidence-record.mjs <board url> <light|dark> <out.mp4>
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [url, theme, out] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'desk-rec-'));
const chrome = spawn('/usr/bin/chromium', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(dir, 'profile')}`, '--window-size=1280,800',
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
try {
  const active = join(dir, 'profile', 'DevToolsActivePort');
  for (let i = 0; i < 100 && !(existsSync(active) && readFileSync(active, 'utf8').includes('\n')); i++) await wait(100);
  const port = readFileSync(active, 'utf8').split('\n')[0];
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0;
  const replies = new Map(), frames = [];
  const send = (method, params = {}) => new Promise((ok) => { replies.set(++id, ok); ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (replies.has(msg.id)) { replies.get(msg.id)(msg.result); replies.delete(msg.id); }
    if (msg.method === 'Page.screencastFrame') {
      const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
      writeFileSync(join(dir, name), Buffer.from(msg.params.data, 'base64'));
      frames.push({ name, t: msg.params.metadata.timestamp });
      send('Page.screencastFrameAck', { sessionId: msg.params.sessionId });
    }
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  await send('Page.enable');
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value;
  const centre = (q) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(q)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  const mouse = (type, [x, y]) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  // The pointer glides to the row, rests so its hover shows, then presses for a moment before it lets go.
  let at = [640, 400];
  const hover = async (q) => {
    const to = await centre(q);
    if (!to) return 'missing';
    for (let i = 1; i <= 12; i++) { await mouse('mouseMoved', [at[0] + ((to[0] - at[0]) * i) / 12, at[1] + ((to[1] - at[1]) * i) / 12]); await wait(16); }
    at = to;
    return 'ok';
  };
  const click = async (q) => { if ((await hover(q)) === 'missing') return 'missing'; await wait(500); await mouse('mousePressed', at); await wait(160); await mouse('mouseReleased', at); return 'ok'; };
  await send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
  await send('Page.navigate', { url });
  const row = (n) => `.ev-grid > :nth-child(${n}) .ev-card`;
  const steps = [[2200], [() => hover('.t-tiles a[href="#evidence"]'), 1200], [() => click('.t-tiles a[href="#evidence"]'), 1800],
    [() => click(row(3)), 1300], [() => click(row(5)), 1300], [() => click(row(1)), 1300], [() => hover(row(2)), 1400]];
  for (const [i, [act, ms]] of steps.map((s) => (s.length === 1 ? [null, s[0]] : s)).entries()) {
    const r = act && (await act());
    if (r === 'missing') throw new Error(`step ${i + 1} found nothing to point at on ${await evaluate('location.hash')}: ${act}`);
    await wait(ms);
  }
  await send('Page.stopScreencast');
  await wait(300);
  ws.close();
  // An ffmpeg concat list: each frame held until the next one arrived.
  const list = frames.map((f, i) => `file '${f.name}'\nduration ${((frames[i + 1]?.t ?? f.t + 1) - f.t).toFixed(4)}`);
  writeFileSync(join(dir, 'list.txt'), `${list.join('\n')}\nfile '${frames.at(-1).name}'\n`);
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', 'fps=30,format=yuv420p,scale=1280:800', '-c:v', 'libx264', '-movflags', '+faststart', out], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg could not make the video');
  console.log(`${out}: ${frames.length} frames`);
} finally {
  chrome.kill();
  await wait(500);
  rmSync(dir, { recursive: true, force: true });
}
