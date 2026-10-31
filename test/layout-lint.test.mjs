import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { asked } from './support/ask.mjs';
import { lint } from './support/layout-lint.mjs';

// The layout lint on Decide's ask, a sheet on a phone and a pane on a desk, at 360, 390, 445, 1280 and 1440 in light and dark: the lint's faults fail the build,
// the strip between the header's icon and its label must be empty ground (the captain's frame had a tile painted into it), and the header's boxes must match
// test/layout-baseline.json (LAYOUT_BASELINE=write records it again after a deliberate change).
const cli = new URL('../dist/cli.js', import.meta.url).pathname, baseline = new URL('./layout-baseline.json', import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-layout-')), env = { ...process.env, HOME: scratch };
const procs = [];
// The run's own Chrome may still hold its profile in this folder for a moment after it is killed, so the sweep asks again rather than leaving the folder
// the suite's temp folder guard names on both the pass and the failure path.
after(async () => {
  await Promise.allSettled(procs.map((p) => p.exitCode ?? p.signalCode ?? new Promise((ok) => p.once('exit', ok).kill())));
  rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});
const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].flatMap((b) => process.env.PATH.split(':').map((d) => join(d, b))).find(existsSync);
// Chrome's socket path must stay under 107 characters, so its TMPDIR is a short one of its own.
const chromeTmp = chrome && mkdtempSync('/tmp/so-');
after(() => chromeTmp && rmSync(chromeTmp, { recursive: true, force: true }));
const until = async (check) => { for (const end = Date.now() + 60000; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) { const v = await check(); if (v) return v; } assert.fail('the page did not reach the expected state'); };

test('Decide\'s ask header sits on one grid at every width and theme: icon and label a token apart on one line, 44px controls, nothing cut off', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const board = join(scratch, 'board.json'), so = (...a) => execFileSync(process.execPath, [cli, ...asked(a)], { env, encoding: 'utf8' });
  so('raise', board, '--key', 'ship', '--title', 'When should the new settings page ship to everyone on the team?', '--option', 'fri=Friday', '--option', 'next=Next week', '--priority', 'P1');
  so('raise', board, '--key', 'digest', '--title', 'Keep the weekly digest?');
  so('raise', board, '--key', 'later', '--title', 'Turn on the quiet hours for alerts?');
  // Filed now, so the label reads "Agent · HH:MM" on any day (an older card would read Yesterday or a date, and wrap the header at another width).
  const b = JSON.parse(readFileSync(board, 'utf8'));
  for (const d of b.items) d.filed = new Date().toISOString();
  writeFileSync(board, JSON.stringify(b));
  const server = spawn(process.execPath, [cli, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(server);
  let log = ''; server.stdout.on('data', (d) => (log += d));
  const url = await until(() => /http:\/\/127\.0\.0\.1:\d+\//.exec(log)?.[0]);
  const profile = mkdtempSync(join(scratch, 'chrome-')), active = join(profile, 'DevToolsActivePort');
  procs.push(spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { env: { ...process.env, TMPDIR: chromeTmp }, stdio: 'ignore' }));
  await until(() => existsSync(active) && readFileSync(active, 'utf8').includes('\n'));
  const page = (await (await fetch(`http://127.0.0.1:${readFileSync(active, 'utf8').split('\n')[0]}/json`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let seq = 0; const replies = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); replies.get(x.id)?.(x.result); replies.delete(x.id); };
  // A call the browser never answers gives undefined after 10 s instead of hanging the run.
  const send = (method, params = {}) => new Promise((ok) => { const id = ++seq; replies.set(id, ok); setTimeout(() => replies.delete(id) && ok(undefined), 10000).unref(); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
  const faults = [], boxes = {};
  for (const theme of ['light', 'dark']) for (const width of [360, 390, 445, 1280, 1440]) {
    const desk = width >= 1024, scope = desk ? '.split-detail' : '.ask-sheet', head = desk ? '.split-detail .split-bar' : '.ask-sheet .sh-head', at = `${width} ${theme}`;
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: !desk });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    await send('Page.navigate', { url: 'about:blank' });
    await send('Page.navigate', { url: `${url}#decide/ship` });
    await until(() => evaluate(`document.fonts.ready.then(() => !!document.querySelector(${JSON.stringify(head)} + ' .detail-sequence'))`));
    faults.push(...(await evaluate(lint(scope, head))).map((f) => `${at}: ${f}`));
    // The header's boxes against its sheet's, rounded: the icon, the label's line, each control, the header and the title under it.
    const geo = await evaluate(`(() => { const h = document.querySelector(${JSON.stringify(head)}), o = h.parentElement.getBoundingClientRect(), r = (e) => { const b = e.getBoundingClientRect(); return [b.left - o.left, b.top - o.top, b.width, b.height].map(Math.round); };
      const lab = h.querySelector('.ui-lab > :last-child, .sh-lab, .crumb'), icon = h.querySelector('.ui-icon'), g = document.createRange(); g.selectNodeContents(lab);
      return { head: r(h), icon: r(icon), controls: [...h.querySelectorAll('a, summary, button')].filter((e) => e.getClientRects().length).map(r), title: r(document.querySelector(${JSON.stringify(scope)} + ' h2')), gap: [icon.getBoundingClientRect(), g.getClientRects()[0]].map((b) => [b.right, b.left]).flat() }; })()`);
    boxes[at] = { head: geo.head, icon: geo.icon, controls: geo.controls, title: geo.title.slice(0, 2) };
    // The strip between the icon and its label's first letter is the header's own ground: no tile, no ink.
    const [iconRight, , , textLeft] = geo.gap, top = geo.icon[1] + (await evaluate(`document.querySelector(${JSON.stringify(head)}).parentElement.getBoundingClientRect().top`));
    if (textLeft - iconRight >= 2) {
      const shot = jpeg.decode(Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: 100, clip: { x: iconRight + 0.5, y: top, width: Math.floor(textLeft - iconRight - 1), height: geo.icon[3], scale: 1 } })).data, 'base64'));
      const px = (i) => [shot.data[i], shot.data[i + 1], shot.data[i + 2]], ground = px(0);
      for (let i = 0; i < shot.data.length; i += 4) if (px(i).some((v, c) => Math.abs(v - ground[c]) > 24)) { faults.push(`${at}: ink in the gap between the header's icon and its label`); break; }
    }
  }
  ws.close();
  if (process.env.LAYOUT_BASELINE === 'write') writeFileSync(baseline, `{\n${Object.entries(boxes).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`);
  assert.deepEqual(faults, [], `the layout lint found:\n${faults.join('\n')}`);
  assert.deepEqual(boxes, JSON.parse(readFileSync(baseline, 'utf8')), 'Decide\'s ask header moved from test/layout-baseline.json; if the move is meant, run with LAYOUT_BASELINE=write and commit the file');
});
