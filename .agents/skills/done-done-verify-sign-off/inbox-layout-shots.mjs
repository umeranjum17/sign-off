// The Inbox layout pick's three option pages (fixtures/inbox-layout), each on its own at a phone's 390 and a desk's 1280, light and dark,
// and option A's Desktop layout opened full screen on a phone: at its own size with the stage scrolling sideways, then fitted to the width.
// A throwaway board holds the pick; nothing is posted anywhere else. Side "before" (SIGN_OFF_REPO=<base build>, INBOX_LAYOUT_SIDE=before)
// captures only the viewer, as the base draws it.
// Usage: node inbox-layout-shots.mjs <output>
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const pages = resolve(process.env.INBOX_LAYOUT_DIR ?? join(here, 'fixtures/inbox-layout'));
const before = process.env.INBOX_LAYOUT_SIDE === 'before', dest = before ? join(out, 'before') : out;
mkdirSync(dest, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-layout-'));
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.c'), XDG_DATA_HOME: join(dir, '.d'), XDG_STATE_HOME: join(dir, '.s'), XDG_CACHE_HOME: join(dir, '.k') };
const OPTIONS = [['a', 'A: List with the open thread beside it'], ['b', 'B: One feed of the messages'], ['c', 'C: One conversation, the list as a rail']];
const board = join(dir, 'board.json');
mkdirSync(join(dir, 'mocks/inbox-layout'), { recursive: true });
for (const [v] of OPTIONS) copyFileSync(join(pages, `option-${v}.html`), join(dir, `mocks/inbox-layout/option-${v}.html`));
writeFileSync(board, JSON.stringify({ schema: 2, items: [{ filed: new Date().toISOString(), key: 'inbox-layout', title: 'Which layout should the Inbox use?', about: 'Three ways to hold your threads.',
  options: OPTIONS.map(([value, label]) => ({ value, label })), recommend_value: 'a', type: 'design', tradeoff: 'A keeps the list beside the thread; B answers in the feed; C reads as one conversation.',
  mocks: OPTIONS.map(([value]) => ({ value, path: `mocks/inbox-layout/option-${value}.html` })), filer: 'sign-off' }] }));
const sh = (bin, args, options = {}) => spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let server, chrome, ws;
const prof = mkdtempSync(join(tmpdir(), 'so-layout-chrome-'));
try {
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127.0.0.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', () => no(Error('server exited'))); });
  chrome = spawn('/usr/lib/chromium/chromium', ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); if (existsSync(join(prof, 'DevToolsActivePort'))) port = readFileSync(join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0]; }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description ?? x.params.exceptionDetails.text);
    if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push(x.params.args.map((a) => a.value ?? a.description).join(' ')); };
  const cdp = (method, params = {}) => new Promise((r, j) => { const n = ++id; pending.set(n, (x) => (x.error ? j(new Error(`${method}: ${x.error.message}`)) : r(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  const evalIn = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert.ok(!r.exceptionDetails, r.exceptionDetails?.exception?.description); return r.result.value; };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  const HEIGHT = { 390: 844, 1280: 800 }, records = [];
  const open = async (width, theme, address) => {
    const phone = width < 1024;
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: HEIGHT[width], deviceScaleFactor: 2, mobile: phone });
    await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await cdp('Page.navigate', { url: 'about:blank' }); await wait(150);
    await cdp('Page.navigate', { url: address }); await wait(1500);
  };
  const shoot = async (file) => writeFileSync(join(dest, file), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  if (!before) for (const [v, label] of OPTIONS) for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
    errors.length = 0;
    await open(width, theme, `${url}mock/local/inbox-layout~${v}/option-${v}.html`);
    await wait(600);
    const file = `option-${v}.${width}.${theme}.png`;
    await shoot(file);
    // The page as drawn: no sideways scroll, its smallest visible text, and the page's own background (a dark theme is its own, not the light one).
    const r = await evalIn(`(() => { const sizes = [...document.querySelectorAll('body *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
        .filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.height && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth; }).map((e) => parseFloat(getComputedStyle(e).fontSize));
      return { width: innerWidth, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth, smallest: Math.min(...sizes), background: getComputedStyle(document.body).backgroundColor,
        text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 200) }; })()`);
    records.push({ file, option: label, theme, ...r, console_errors: [...errors] });
    assert.equal(r.overflowX, false, `${file}: no sideways scroll`);
    assert.match(r.text, /Ship the new settings page Friday\?/, `${file}: the page shows the inbox's threads`);
    assert.deepEqual(errors, [], `${file}: no console error`);
  }
  // Option A full screen on a phone, Desktop picked: at its own size, as tall as the stage, the stage scrolling sideways; then Fit.
  const full = "document.querySelector('dialog.proto-full[open]')", frame = `${full}.querySelector('.pf-main .pf-port')`, stage = `${full}.querySelector('.pf-stage')`;
  const measure = `(() => { const p = ${frame}.getBoundingClientRect(), s = ${stage}.getBoundingClientRect(), f = getComputedStyle(${frame}.firstChild);
    return { option: ${full}.querySelector('.pf-pick').value, size: ${full}.querySelector('.pf-size [aria-pressed=true]').dataset.size, fit: ${full}.querySelector('.pf-fit')?.getAttribute('aria-pressed') ?? 'none',
      scale: +${frame}.style.getPropertyValue('--s'), viewport: [f.width, f.height], frame: [p.width, p.height].map(Math.round), stage: [s.width, s.height].map(Math.round),
      scrolls_sideways: ${stage}.scrollWidth > ${stage}.clientWidth, page_overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; })()`;
  for (const theme of ['light', 'dark']) {
    await open(390, theme, `${url}#decide/inbox-layout`);
    await evalIn(`localStorage.setItem('so-theme', '${theme}'); 0`); await cdp('Page.reload'); await wait(1500);
    await evalIn(`(async () => { for (let i = 0; i < 40 && !document.querySelector('.full-open'); i++) await new Promise((r) => setTimeout(r, 100));
      document.querySelector('.full-open').click(); for (let i = 0; i < 40 && !${full}; i++) await new Promise((r) => setTimeout(r, 100));
      ${full}.querySelector('[data-size=desktop]').click(); })()`);
    await wait(1800);
    const name = before ? 'viewer-desktop' : 'viewer-actual';
    await shoot(`${name}.390.${theme}.png`);
    const actual = await evalIn(measure);
    records.push({ file: `${name}.390.${theme}.png`, theme, ...actual });
    if (before) continue;
    assert.deepEqual([actual.option, actual.size, actual.fit, actual.scale, actual.viewport[0], actual.scrolls_sideways, actual.page_overflow], ['a', 'desktop', 'false', 1, '1280px', true, false], `${theme}: Desktop at its own size`);
    assert.equal(actual.frame[1], actual.stage[1], `${theme}: the frame is as tall as the stage`);
    await evalIn(`${full}.querySelector('.pf-fit').click()`); await wait(1200);
    await shoot(`viewer-fit.390.${theme}.png`);
    const fit = await evalIn(measure);
    records.push({ file: `viewer-fit.390.${theme}.png`, theme, ...fit });
    assert.deepEqual([fit.fit, fit.frame, fit.scrolls_sideways, fit.viewport[0]], ['true', fit.stage, false, '1280px'], `${theme}: Fit fills the stage at its width`);
    // Fit is kept while the board is open: put it back for the next theme's own load.
    await evalIn(`${full}.querySelector('.pf-fit').click()`);
  }
  writeFileSync(join(dest, 'checks.json'), JSON.stringify(records, null, 2));
  writeFileSync(join(dest, 'steps.json'), JSON.stringify({ commit: sh('git', ['rev-parse', 'HEAD'], { cwd: repo }).stdout.trim(), before, target: { version: sh(process.execPath, [join(repo, 'dist/cli.js'), '--version']).stdout.trim() },
    start: 'A throwaway board holding one design pick of three Inbox layouts, each option a page that runs.',
    steps: [...(before ? [] : ['Open each option page on its own at 390 and 1280, light and dark']), 'Open the pick in Decide on a phone (390 by 844)', 'Open full screen and tap Desktop', ...(before ? [] : ['Tap Fit']), 'Capture light and dark'],
    result: `${before ? 'before' : 'after'} frames and checks.json` }, null, 2));
} finally {
  try { ws?.close(); chrome?.kill(); server?.kill(); } catch {}
  await wait(400); rmSync(dir, { recursive: true, force: true }); rmSync(prof, { recursive: true, force: true });
}
