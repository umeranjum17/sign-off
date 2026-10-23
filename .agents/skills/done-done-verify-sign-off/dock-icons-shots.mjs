// The dock's and the sidebar's filled icons (Today, Decide, Evidence, Reports), beside the approved prototype's: Today at 390x844 and 1280x800, light and dark, captured at 2x
// over the DevTools protocol with exact device metrics (a headless Chromium of its own), and measured in the browser on the board and on the prototype alike:
// each icon's box and its drawing's ink box, filled (no stroke) in the link's own colour, the tab on screen in ink and the others quiet grey, the box centred in its
// 48px tab on a phone, and on a desk one left edge for the icons, one for the labels and each icon centred on its label's line; every tab is opened in turn to
// check the raised one and its ink icon follow it.
// Usage: node .agents/skills/done-done-verify-sign-off/dock-icons-shots.mjs <output> <prototype index.html>
// It saves only the pairs (vs-proto/<dock|sidebar>.<theme>.<width>w.pair.png, the prototype's crop then the board's), each cell's measure.json and measure.txt.
// DOCK_SIDE=before SIGN_OFF_REPO=<built base checkout> records the base under before/ (its measurements are kept, not asserted).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), proto = process.argv[3] && resolve(process.argv[3]);
assert.ok(proto && existsSync(proto), 'the approved prototype\'s index.html is the second argument');
const side = process.env.DOCK_SIDE ?? 'after', here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), dest = side === 'after' ? out : join(out, 'before');
mkdirSync(join(dest, 'vs-proto'), { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-dock-'));
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, env, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
// The same measure on both pages: the board's dock is .tabs and its sidebar .side; the prototype's are .dock nav and .side's .nav rows.
const MEASURE = `(async () => {
  await document.fonts.ready;
  const r2 = (n) => Math.round(n * 100) / 100, box = (e) => e.getBoundingClientRect(), vis = (e) => e && box(e).width > 0 && getComputedStyle(e).display !== 'none';
  const dockEl = document.querySelector('.tabs') ?? document.querySelector('.dock nav'), sideEl = document.querySelector('.side');
  const phone = vis(dockEl), links = phone ? [...dockEl.querySelectorAll('a')] : [...sideEl.querySelectorAll('a.nav, a[href^="#"]:not(.sfind)')];
  const icons = links.map((a) => {
    const svg = a.querySelector('svg'), path = svg.querySelector('path'), vb = svg.viewBox.baseVal, s = box(svg), k = s.width / vb.width, b = path.getBBox(), l = box(a), ps = getComputedStyle(path);
    const ink = { left: s.left + (b.x - vb.x) * k, top: s.top + (b.y - vb.y) * k, width: b.width * k, height: b.height * k };
    const words = [...a.childNodes].find((n) => n.nodeType === 3 && n.data.trim()), rg = words && document.createRange(); if (rg) rg.selectNodeContents(words); const w = rg && rg.getBoundingClientRect();
    return { name: (a.getAttribute('aria-label') ?? words.data).split(',')[0].trim(), current: a.getAttribute('aria-current') === 'page', box: r2(s.width) + 'x' + r2(s.height), ink: r2(ink.width) + 'x' + r2(ink.height),
      fill: ps.fill, stroke: ps.stroke, rule: ps.fillRule, colour: getComputedStyle(a).color, boxLeft: r2(s.left),
      boxOffset: [r2(s.left + s.width / 2 - (l.left + l.width / 2)), r2(s.top + s.height / 2 - (l.top + l.height / 2))],
      ...(w ? { labelLeft: r2(w.left), labelGap: r2(w.left - s.right), onLabel: r2(s.top + s.height / 2 - (w.top + w.height / 2)) } : {}) };
  });
  const hl = document.querySelector('.tabs .hl'), cur = links.find((a) => a.getAttribute('aria-current') === 'page');
  const raised = phone && hl && cur ? r2(box(hl).left - box(cur).left) : null;
  // The crop: the dock and Search with 16px round them, or the sidebar from its top to 16px under its last area; the page's own scroll added, as the capture counts from the page's top.
  const find = document.querySelector('.dock-find') ?? document.querySelector('.dock .go'), d = phone && box(dockEl), f = phone && box(find), sd = !phone && box(sideEl), last = box(links.at(-1));
  const clip = phone ? { x: scrollX + d.left - 16, y: scrollY + d.top - 16, width: f.right - d.left + 32, height: d.height + 32 } : { x: scrollX + sd.left, y: scrollY + sd.top, width: sd.width, height: last.bottom - sd.top + 16 };
  return { phone, icons, raised, clip };
})()`;
const prof = mkdtempSync(join(tmpdir(), 'so-dock-chrome-'));
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let url, ws;
const errors = [], failed = [], report = [], problems = [];
try {
  url = sh('bash', [join(here, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { cwd: repo }).trim().split('\n').pop();
  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium opened its DevTools port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
    if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push(x.params.args.map((a) => a.value ?? a.description).join(' '));
    if (x.method === 'Network.responseReceived' && x.params.response.status >= 400) failed.push({ url: x.params.response.url, status: x.params.response.status });
    if (x.method === 'Network.loadingFailed' && !x.params.canceled) failed.push({ url: x.params.requestId, status: 0 }); };
  const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  const shot = async (file, clip) => writeFileSync(file, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png', ...(clip && { clip: { ...clip, scale: 1 } }) })).data, 'base64'));
  const go = async (address, ms = 1200) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: address }); await wait(ms); };
  const measure = async (name) => { const ev = await cdp('Runtime.evaluate', { expression: MEASURE, awaitPromise: true, returnByValue: true }); assert.ok(ev.result.value && !ev.exceptionDetails, `${name}: the measure ran: ${ev.exceptionDetails?.exception?.description}`); return ev.result.value; };
  const steps = {};
  for (const [wd, metrics] of [['390w', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }], ['1280w', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }]]) {
    for (const theme of ['light', 'dark']) {
      const name = `today.${theme}.${wd}`, part = metrics.mobile ? 'dock' : 'sidebar';
      await cdp('Emulation.setDeviceMetricsOverride', metrics);
      await cdp('Emulation.setTouchEmulationEnabled', metrics.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      errors.length = 0; failed.length = 0;
      await go(`${url}#`);
      // On a phone both pages are scrolled to their end first, so the dock sits on the canvas the last row clears rather than over words.
      const end = async () => { if (metrics.mobile) { await cdp('Runtime.evaluate', { expression: 'scrollTo(0, document.scrollingElement.scrollHeight)' }); await wait(500); } };
      await end();
      const m = await measure(name);
      await shot(join(dir, `${part}.board.png`), m.clip);
      // Each tab opened in turn: the raised one and its ink icon follow it.
      const turns = [];
      for (const hash of ['#waiting', '#evidence', '#reports', '#']) {
        await cdp('Runtime.evaluate', { expression: `location.hash = '${hash}'` }); await wait(700);
        const t = await measure(`${name} ${hash}`); turns.push({ hash, current: t.icons.filter((i) => i.current).map((i) => i.name), raised: t.raised, ink: t.icons.find((i) => i.current)?.fill });
      }
      await go(`file://${proto}#v=today&theme=${theme}`);
      await end();
      const p = await measure(`${name} prototype`), tickets = p.icons.filter((q) => q.name === 'Tickets').length;
      p.icons = p.icons.filter((q) => q.name !== 'Tickets');
      await shot(join(dir, `${part}.proto.png`), p.clip);
      // The board against the prototype: the same names in the same order, filled and not stroked, the same ink and grey, the drawing's ink box at the size of the box,
      // and the box in its place (centred in a tab, or on one icon edge with each icon on its label's line).
      const fail = [], b = m.icons, scale = parseFloat(b[0].box) / parseFloat(p.icons[0].box);
      // The prototype's dock and sidebar also hold Tickets, which waits for its own tab here.
      if (b.map((i) => i.name).join() !== p.icons.map((i) => i.name).join() || tickets !== 1) fail.push(`names ${b.map((i) => i.name)} not ${p.icons.map((i) => i.name)} and Tickets`);
      b.forEach((i, n) => { const q = p.icons[n]; if (!q) return;
        if (i.stroke !== 'none' || i.fill !== i.colour || i.rule !== 'evenodd') fail.push(`${i.name} not filled: fill ${i.fill}, stroke ${i.stroke}, colour ${i.colour}, rule ${i.rule}`);
        if (i.current !== q.current || i.fill !== q.fill) fail.push(`${i.name} ${i.current ? 'on screen' : 'idle'} in ${i.fill}, the prototype's ${q.current ? 'on screen' : 'idle'} in ${q.fill}`);
        const [iw, ih] = i.ink.split('x').map(Number), [qw, qh] = q.ink.split('x').map(Number);
        if (Math.abs(iw - qw * scale) > 0.5 || Math.abs(ih - qh * scale) > 0.5) fail.push(`${i.name} ink ${i.ink} not the prototype's ${q.ink} at ${Math.round(scale * 1000) / 1000}x`);
        if (metrics.mobile && i.boxOffset.some((o) => Math.abs(o) > 0.5)) fail.push(`${i.name} box ${i.boxOffset} off its tab's centre`);
        if (!metrics.mobile && Math.abs(i.onLabel) > 0.5) fail.push(`${i.name} box ${i.onLabel}px off its label's line`); });
      if (!metrics.mobile && (new Set(b.map((i) => i.boxLeft)).size > 1 || new Set(b.map((i) => i.labelLeft)).size > 1)) fail.push(`edges: icons ${[...new Set(b.map((i) => i.boxLeft))]}, labels ${[...new Set(b.map((i) => i.labelLeft))]}`);
      const ink = b.find((i) => i.current)?.fill;
      turns.forEach((t, n) => { const want = ['Decide', 'Evidence', 'Reports', 'Today'][n];
        if (t.current.join() !== want || t.ink !== ink || (metrics.mobile && Math.abs(t.raised) > 0.5)) fail.push(`${t.hash}: on screen ${t.current}, ink ${t.ink}, raised ${t.raised}`); });
      const rec = { board: m, prototype: p, turns, scale: Math.round(scale * 1000) / 1000, fail, console_errors: [...errors], failed_requests: [...failed] };
      writeFileSync(join(dest, `${name}.measure.json`), JSON.stringify(rec, null, 2) + '\n');
      const idle = b.find((i) => !i.current);
      report.push(`${name}: ${part} ${b.map((i) => `${i.name} ${i.box} box, ink ${i.ink} (prototype ${p.icons.find((q) => q.name === i.name)?.ink ?? '?'} in a ${p.icons[0].box} box)`).join('; ')}; filled ${b.every((i) => i.stroke === 'none') ? 'yes' : 'NO'}; on screen ${b.find((i) => i.current)?.name} in ${ink}, idle in ${idle?.fill} (prototype ${p.icons.find((q) => q.current)?.fill}, ${p.icons.find((q) => !q.current)?.fill})` +
        `${metrics.mobile ? `; boxes off their tab's centre by at most ${Math.max(...b.flatMap((i) => i.boxOffset.map(Math.abs)))}px` : `; icon edge ${[...new Set(b.map((i) => i.boxLeft))]}, label edge ${[...new Set(b.map((i) => i.labelLeft))]} (prototype ${[...new Set(p.icons.map((i) => i.boxLeft))]}, ${[...new Set(p.icons.map((i) => i.labelLeft))]}), off the label's line by at most ${Math.max(...b.map((i) => Math.abs(i.onLabel)))}px`}` +
        `; tabs opened ${turns.map((t) => `${t.hash} -> ${t.current}${metrics.mobile ? ` raised ${t.raised}` : ''}`).join(', ')}; failures ${fail.length}${fail.length ? ': ' + fail.join('; ') : ''}`);
      if ([fail, errors, failed].some((x) => x.length)) problems.push(`${name}: ${JSON.stringify({ fail, errors, failed })}`);
      steps[name] = rec;
      // The prototype's crop over (dock) or beside (sidebar) the board's, at the same scale, each under its name, drawn by the browser itself.
      const img = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
      const html = `<!doctype html><body style="margin:0;padding:24px;display:flex;${metrics.mobile ? 'flex-direction:column;' : ''}gap:32px;background:#888;font:600 24px system-ui;color:#fff;width:max-content">${[['Approved prototype', 'proto'], [side === 'after' ? 'Board, this build' : 'Board, before this change', 'board']]
        .map(([t, f]) => `<figure style="margin:0"><figcaption style="margin:0 0 12px">${t}: the ${part}, ${theme}</figcaption><img src="${img(join(dir, `${part}.${f}.png`))}" style="display:block"></figure>`).join('')}</body>`;
      writeFileSync(join(dir, 'pair.html'), html);
      // The page is sized to what it draws, captions included.
      await cdp('Emulation.setDeviceMetricsOverride', { width: 2400, height: 1600, deviceScaleFactor: 1, mobile: false });
      await go(`file://${join(dir, 'pair.html')}`, 600);
      const [pw, ph] = (await cdp('Runtime.evaluate', { expression: '[Math.ceil(document.body.getBoundingClientRect().width), Math.ceil(document.body.getBoundingClientRect().height)]', returnByValue: true })).result.value;
      await cdp('Emulation.setDeviceMetricsOverride', { width: pw, height: ph, deviceScaleFactor: 1, mobile: false });
      await wait(300);
      await shot(join(dest, 'vs-proto', `${part}.${theme}.${wd}.pair.png`));
    }
  }
  writeFileSync(join(dest, 'measure.txt'), report.join('\n') + '\n');
  if (side === 'after') writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board with asks, a plan, an update and a report, and the approved prototype\'s page.',
    steps: ['Open Today on the board and on the prototype at 390x844 (the dock) and 1280x800 (the sidebar), 2x, light and dark, over the DevTools protocol with exact device metrics.',
      'Measure in the browser each of the four icons, Today (a house), Decide (a speech bubble with two lines), Evidence (a shield with a check) and Reports (a page with two lines): its box, its drawing\'s ink box, its fill and stroke, and where it sits.',
      'Open Decide, Evidence, Reports and Today in turn and check the raised tab and its ink icon follow.',
      'Save the board\'s dock and sidebar beside the prototype\'s at the same scale.'],
    result: 'On a phone and on a desk, in light and in dark, the board\'s dock and sidebar draw the approved prototype\'s filled icons: Today a house, Decide a speech bubble with two lines, Evidence a shield with a check and Reports a page with two lines, solid shapes with no outline. The tab on screen is the raised round one with its icon in ink; the other icons are quiet grey filled shapes. In the dock each icon is drawn at 24px, centred in its round 48px tab; in the sidebar each is 20px, the size the prototype draws there, on one left edge with the labels on the next and each icon centred on its label\'s line.',
    measured: steps }, null, 2) + '\n');
  console.log(report.join('\n'));
  if (side === 'after') assert.deepEqual(problems, [], 'every capture measures clean');
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { sh(process.execPath, [join(repo, 'dist/cli.js'), 'stop', join(dir, 'board.json')]); } catch {}
  await wait(300);
  rmSync(prof, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}
