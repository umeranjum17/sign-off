// Records Decide's motion at phone size (390x844, 2x) in one theme, from a board seed-board.sh served:
// the shimmering rows while the board is read (the first read held for 1.2 s), rows rising in, a row's press, a short drag that
// springs back, a swipe right that answers (the toast and its countdown, then Undo and the row coming back), a swipe left to Later
// and Undo, an ask pushed in, a pick whose label slides onto Answer, Answer turning into a check, the pop back with the row folding
// away, More's menu, and Answer all recommended.
// With desk, it records the desk (1280x800) by keys instead: J and K moving the selection, Enter answering (the check, the row folding, the next ask
// sliding in), Cmd+Z, L to Later, the ? sheet, C and Cmd+Enter answering with a comment, a row's hover answer, and G then E and D; a pill names each key.
// Its own headless Chromium on a scratch profile, driven over the DevTools protocol; taps, drags and keys are events in the page.
// Usage: node decide-record.mjs <board url> <light|dark> <out.mp4> [desk]
// With `reports` last it records Reports instead, on a board reports-shots.mjs seeded: rows rising in, a press, a short drag that springs back,
// a swipe right that reads a report (its dot goes, Undo brings it back), a swipe left that archives one (it folds away, Undo flashes it back),
// a report opened and closed (its dot shrinks away), and More's Mark all as read with Undo.
// Its own headless Chromium on a scratch profile, driven over the DevTools protocol; taps and drags are pointer events in the page.
// With both, it records the desk's Reports by keys: J and K moving the selection (each report read as it is shown), U twice, a row's hover actions,
// E archiving the report shown (the row folds, the next is selected), Cmd+Z, Enter opening a guided report over the board and Escape, and the ? sheet.
// Usage: node decide-record.mjs <board url> <light|dark> <out.mp4> [desk] [reports]
// With `today` it records Today at phone size on a board feel-board.sh seeded: the page scrolled (the small title in its bar) and back, the Sign in tile opening Decide at its
// group (the pill sliding), the sign-in swiped to Later, the Today tab (Up next is now the next ask), a comment typed under it, Answer turning into a check (the ring closing a step,
// Decide's badge counting down, the next ask sliding in), Undo, the Review tile, the Evidence tab and a Latest proof row opening its update.
// Usage: node decide-record.mjs <board url> <light|dark> <out.mp4> today
// With `flows`, on a board seed-proto-board.sh seeded, it records the phone's answer flows: an ask with nothing picked, a pick naming the button, a note typed and sent with it;
// Your own answer opening its one box, Send answer off until words are typed, then sent; a pick sent with no note, and its Undo; More on the list; and an ask's More, Ask me later.
// Usage: node decide-record.mjs <board url> <light|dark> <out.mp4> flows
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [url, theme, out, ...modes] = process.argv.slice(2), desk = modes.includes('desk'), flows = modes.includes('flows'), screen = modes.includes('today') ? 'today' : modes.includes('reports') ? 'reports' : 'decide', [W, H] = desk ? [1280, 800] : [390, 844];
const dir = mkdtempSync(join(tmpdir(), 'decide-rec-'));
const chrome = spawn('/usr/bin/chromium', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(dir, 'profile')}`, `--window-size=${W},${H}`,
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
try {
  const active = join(dir, 'profile', 'DevToolsActivePort');
  // A loaded host can take a while to start the browser.
  for (let i = 0; i < 300 && !(existsSync(active) && readFileSync(active, 'utf8').includes('\n')); i++) await wait(100);
  const port = readFileSync(active, 'utf8').split('\n')[0];
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0, held = 0;
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
    // The first read of the board waits a moment, as on a slow phone network, so the skeleton shows.
    if (msg.method === 'Fetch.requestPaused') setTimeout(() => send('Fetch.continueRequest', { requestId: msg.params.requestId }), held++ ? 0 : 1200);
  };
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: desk ? 1 : 2, mobile: !desk });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/decisions' }] });
  await send('Page.enable');
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value;
  const inPage = (body) => evaluate(`(async () => { const s = (ms) => new Promise((z) => setTimeout(z, ms)); ${body} })()`);
  const tap = (q) => inPage(`const e = document.querySelector(${JSON.stringify(q)}); if (!e) return 'missing';
    const r = e.getBoundingClientRect(), o = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 3, pointerType: 'touch', isPrimary: true };
    e.dispatchEvent(new PointerEvent('pointerdown', o)); await s(120); e.dispatchEvent(new PointerEvent('pointerup', o)); e.click(); return 'ok';`);
  const drag = (key, dx, steps = 14, gap = 18) => inPage(`const e = document.querySelector('.dl-row[data-key="${key}"] .dl-face'); if (!e) return 'missing';
    const r = e.getBoundingClientRect(), y = r.top + r.height / 2; let x = ${dx} > 0 ? r.left + 40 : r.right - 40;
    const ev = (t) => e.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerId: 9, pointerType: 'touch', isPrimary: true }));
    ev('pointerdown'); for (let i = 0; i < ${steps}; i++) { x += ${dx} / ${steps}; await s(${gap}); ev('pointermove'); } await s(90); ev('pointerup'); return 'ok';`);
  const press = (key) => inPage(`const e = document.querySelector('.dl-row[data-key="${key}"] .dl-face'), r = e.getBoundingClientRect();
    const o = { bubbles: true, clientX: r.left + 120, clientY: r.top + 30, pointerId: 4, pointerType: 'touch', isPrimary: true };
    e.dispatchEvent(new PointerEvent('pointerdown', o)); await s(450); e.dispatchEvent(new PointerEvent('pointercancel', o)); return 'ok';`);
  // A key pressed where the focus is, as a keyboard would, with a pill at the bottom right naming it for whoever watches (not part of the board).
  const key = (k, mod = false) => inPage(`let p = document.getElementById('rec-key'); if (!p) { p = document.createElement('div'); p.id = 'rec-key';
    p.style.cssText = 'position:fixed;z-index:9;right:20px;bottom:20px;padding:6px 14px;border-radius:10px;background:rgba(0,0,0,.72);color:#fff;font:600 15px system-ui'; document.body.append(p); }
    p.textContent = ${JSON.stringify((mod ? 'Ctrl+' : '') + ({ Enter: '↵' }[k] ?? k.toUpperCase()))};
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, ctrlKey: ${mod} })); return 'ok';`);
  const type = (words) => inPage(`const t = document.activeElement; if (t?.tagName !== 'TEXTAREA') return 'missing'; for (const c of ${JSON.stringify(words)}) { t.value += c; t.dispatchEvent(new Event('input')); await s(45); } return 'ok';`);
  // A tap into a box focuses it and brings it into view, as a finger does.
  const into = (q) => inPage(`const t = document.querySelector(${JSON.stringify(q)}); if (!t) return 'missing'; t.focus({ preventScroll: true }); t.scrollIntoView({ block: 'center', behavior: 'smooth' }); return 'ok';`);
  await send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
  await send('Page.navigate', { url: `${url}${{ reports: '#reports', decide: '#waiting', today: '' }[screen]}` });
  const steps = flows ? [[2600], [() => tap('a.dl-face[href="#decide/ship"]'), 1800], [() => tap('.pick-list li:nth-child(2) .pick-option'), 1300], [() => into('.decide .note-box'), 900],
    [() => type('Keep support on call until Monday.'), 900], [() => tap('.decide-bar .answer'), 2600],
    [() => tap('a.dl-face[href="#decide/export"]'), 1800], [() => tap('.decide .own-option'), 1600], [() => type('Call it Download, and keep Export in the menu.'), 900], [() => tap('.decide-bar .answer'), 2600],
    [() => tap('a.dl-face[href="#decide/digest"]'), 1600], [() => tap('.pick-list li:nth-child(1) .pick-option'), 1100], [() => tap('.decide-bar .answer'), 2200], [() => tap('#undo'), 1600],
    [() => tap('.top .dl-more > summary'), 1600], [() => tap('.top .dl-more > summary'), 700], [() => tap('a.dl-face[href="#decide/digest"]'), 1500], [() => tap('.ask-nav .dl-more > summary'), 1500],
    [() => tap('[data-act="later"]'), 2200]]
    : screen === 'reports' && desk ? [[2600], [() => key('j'), 1100], [() => key('j'), 1100], [() => key('k'), 1100], [() => key('u'), 1600], [() => key('u'), 1400],
    [() => inPage("const b = document.querySelector('.split-list .dl-row:not(.sel) .dl-hover .read-q'); if (!b) return 'missing'; b.focus(); return 'ok';"), 1400],
    [() => inPage("document.querySelector('.split-list [data-row][aria-current]').focus(); return 'ok';"), 300], [() => key('e'), 1800], [() => key('z', true), 1600],
    [() => key('j'), 1100], [() => key('Enter'), 1800], [() => key('Escape'), 1200], [() => key('?'), 1800], [() => tap('#keys header button'), 900]]
    : screen === 'reports' ? [[2600], [() => press('settings-speed'), 700], [() => drag('settings-speed', 80, 10, 45), 1000], [() => drag('settings-speed', 300), 1600], [() => tap('#undo'), 1400],
    [() => drag('release-train', -280), 1600], [() => tap('#undo'), 1400], [() => tap('a.dl-face[href="#reports/new-sign-in"]'), 1600], [() => tap('#reader .close'), 1400],
    [() => tap('.top .dl-more > summary'), 1200], [() => tap('[data-act="read-all"]'), 1600], [() => tap('#undo'), 1500]] : desk ? [[2600], [() => key('j'), 900], [() => key('j'), 900], [() => key('k'), 900], [() => key('2'), 900], [() => key('Enter'), 1800], [() => key('z', true), 1500],
    [() => key('l'), 1500], [() => key('?'), 1800], [() => tap('#keys header button'), 700], [() => key('j'), 800], [() => key('1'), 700], [() => key('c'), 600], [() => type('After the demo'), 500], [() => key('Enter', true), 1800],
    [() => inPage("const b = document.querySelector('.split-list .dl-row:not(.sel) .dl-hover .yes'); if (!b) return 'missing'; b.focus(); await s(700); b.click(); return 'ok';"), 1600],
    [() => key('g'), 200], [() => key('e'), 1200], [() => key('g'), 200], [() => key('d'), 1500]]
    : screen === 'today' ? [[2600], [() => inPage("scrollTo({ top: 760, behavior: 'smooth' }); return 'ok';"), 1700], [() => inPage("scrollTo({ top: 0, behavior: 'smooth' }); return 'ok';"), 1500],
    [() => tap('.tile.g-signin'), 1800], [() => drag('npm', -280), 1700], [() => tap('.tabs a[href="#"]'), 1600], [() => tap('.up-next .cmt > summary'), 800],
    [() => type('Keep support on call until Monday.'), 700], [() => tap('.up-next .go'), 2400], [() => tap('#undo'), 1700], [() => tap('.tile.g-review'), 1800],
    [() => tap('.tabs a[href="#evidence"]'), 1600], [() => tap('.tabs a[href="#"]'), 1400],
    [() => inPage("document.querySelector('.t-proof .lrow').scrollIntoView({ block: 'center', behavior: 'smooth' }); return 'ok';"), 1300], [() => tap('.t-proof .lrow'), 2000], [() => tap('.tabs a[href="#"]'), 1600]] : [[2600], [() => press('ship'), 700], [() => drag('ship', 80, 10, 45), 1000], [() => drag('keep-the-weekly-digest', 300), 1600], [() => tap('#undo'), 1400],
    [() => drag('ship', -280), 1600], [() => tap('#undo'), 1300], [() => tap('a.dl-face[href="#decide/ship"]'), 900],
    [() => tap('.pick-list li:nth-child(2) .pick-option'), 900], [() => tap('.pick-list li:nth-child(1) .pick-option'), 900],
    [() => tap('.decide-bar .answer'), 1800], [() => tap('#undo'), 1200], [() => tap('.top .dl-more > summary'), 1200], [() => tap('[data-act="answer-all"]'), 2000], [() => tap('#undo'), 1500]];
  for (const [i, [act, ms]] of steps.map((s) => (s.length === 1 ? [null, s[0]] : s)).entries()) {
    const r = act && (await act());
    if (r === 'missing') throw new Error(`step ${i + 1} found nothing to tap at ${await evaluate('location.hash')}: ${act}`);
    await wait(ms);
  }
  await send('Page.stopScreencast');
  await wait(300);
  ws.close();
  // An ffmpeg concat list: each frame held until the next one arrived.
  const list = frames.map((f, i) => `file '${f.name}'\nduration ${((frames[i + 1]?.t ?? f.t + 1) - f.t).toFixed(4)}`);
  writeFileSync(join(dir, 'list.txt'), `${list.join('\n')}\nfile '${frames.at(-1).name}'\n`);
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', `fps=30,format=yuv420p,scale=${desk ? '1280:800' : '780:1688'}`, '-c:v', 'libx264', '-movflags', '+faststart', out], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg could not make the video');
  console.log(`${out}: ${frames.length} frames`);
} finally {
  chrome.kill();
  await wait(500);
  rmSync(dir, { recursive: true, force: true });
}
