// Reports in the new look on a fresh board of eight reports in five projects and one with none (two projects with their own icon; two with a priority;
// a guided report with two of its five parts read), at 390x844 and 1280x800, light and dark, captured at 2x over the DevTools protocol with exact device metrics
// (a headless Chromium of its own), and measured in the browser.
// Usage: node .agents/skills/done-done-verify-sign-off/reports-shots.mjs <output> [prototype index.html]   (REPORTS_WIDTHS="390" keeps one width)
// With the approved prototype's page, each phone state is also captured from the prototype at the same size and theme, and saved beside the board's (vs-proto/<state>.pair.png).
// Saves <state>.<theme>.<width>w.png with its .dom.json, and reports.<theme>.<width>w.txt: the head, the rows with their bars, the edges and grid, the last row against the dock,
// the sheet's title and parts, every control against 44px, raw codes or paths in the text, overflow and console errors; asserts each.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), proto = (process.argv[3] ?? process.env.REPORTS_PROTO) && resolve(process.argv[3] ?? process.env.REPORTS_PROTO);
const here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(join(out, 'vs-proto'), { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-reports-'));
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, env, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
// What the browser measures on the list: the head, each block's edges and the 4px grid, the rows (68px, a 40px tile, the bar and its percent), the last row against the dock
// at the scroll's end, helper lines cut short, raw codes or paths, controls under 44px, overflow and squashed text.
const MEASURE = `(async () => {
  await document.fonts.ready;
  // The rows rise in when the tab opens; a busy host can still be running that motion after the fixed wait, so measure once it has settled.
  await Promise.all(document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => a.finished.catch(() => {})));
  const w = document.documentElement.clientWidth, phone = innerWidth < 1024, box = (e) => e.getBoundingClientRect(), vis = (e) => { const r = box(e), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const r2 = (n) => Math.round(n * 100) / 100, grid = (n) => Math.abs(n / 4 - Math.round(n / 4)) < 0.02, fail = [];
  const sheet = document.querySelector('#reader.rp-sheet:not([hidden]) .rp-sheet-body'), scope = sheet ?? document.querySelector('.split-list') ?? document.querySelector('main');
  const edgeL = box(scope).left + scope.clientLeft + parseFloat(getComputedStyle(scope).paddingLeft), edgeR = box(scope).left + scope.clientLeft + scope.clientWidth - parseFloat(getComputedStyle(scope).paddingRight);
  const blocks = [...scope.querySelectorAll(sheet ? '.rp-shd, h1, .about, .ui-dl, .ui-props, .rp-open-full, .thread' : '.rp-top, .rp-seg, .rp-hero, .ui-sec, .rp-list')].filter(vis).map((e) => { const r = box(e); return { el: e.className || e.tagName, left: r2(r.left), right: r2(r.right), top: r2(r.top + scrollY), height: r2(r.height) }; });
  for (const b of blocks) {
    if (Math.abs(b.left - edgeL) > 0.5) fail.push('left edge ' + b.el + ' ' + b.left + ' not ' + r2(edgeL));
    if (/rp-(top|seg|hero|list|shd)|ui-props|rp-open/.test(b.el) && Math.abs(b.right - edgeR) > 0.5) fail.push('right edge ' + b.el + ' ' + b.right + ' not ' + r2(edgeR));
    if (!sheet && /rp-(seg|hero|list)|ui-sec/.test(b.el) && !(grid(b.top) && grid(b.height))) fail.push('off the 4px grid ' + b.el + ' top ' + b.top + ' height ' + b.height);
  }
  const rows = sheet ? [] : [...document.querySelectorAll('.rp-list .ui-row')].filter(vis).map((e) => { const r = box(e), t = box(e.querySelector('.ui-icon')), title = e.querySelector('.t'), bar = e.querySelector('.ui-bar'), pct = e.querySelector('.pct'), card = box(e.closest('.ui-card'));
    return { title: title.textContent, pct: pct?.textContent ?? '', fill: bar ? r2(box(bar.firstChild).width / box(bar).width * 100) : null, chip: e.querySelector('.ui-pc')?.textContent ?? '', icon: e.querySelector('.ui-icon img') ? 'icon' : e.querySelector('.ui-icon .mono')?.textContent ?? 'drawing',
      height: r2(r.height), tile: r2(t.width) + 'x' + r2(t.height), tileIn: r2(t.left - card.left), titleGap: r2(box(title).left - t.right), rightIn: r2(card.right - box(e.querySelector('.rm')).right), pctW: pct ? r2(box(pct).width) : null, titleLines: Math.round(box(title).height / parseFloat(getComputedStyle(title).lineHeight)), lineGap: r2(box(e.querySelector('.l2')).top - box(e.querySelector('.l1')).bottom) }; });
  // Every row has a bar with its percent; a phone's rows are 68px on one line, a desk's take two lines for a long title.
  rows.forEach((x, i) => { if ((phone ? x.height !== 68 : x.height < 68) || x.tile !== '40x40' || x.tileIn !== 12 || x.titleGap !== 12 || x.rightIn !== 12 || x.lineGap !== 4 || (x.pct && x.pctW !== 1)) fail.push('row ' + i + ' ' + JSON.stringify(x));
    if ((x.pct && Math.abs(x.fill - parseFloat(x.pct)) > 1) || (!x.pct && x.fill !== null)) fail.push('row ' + i + ' bar ' + x.fill + ' against ' + x.pct); });
  // A helper line or label cut short: one that holds less than its text.
  const cut = [...document.querySelectorAll('.rp-hero .lab, .rp-hero .vs, .rp-hero .big, .ui-sec, .rp-what span, #reader.rp-sheet h1, #reader.rp-sheet .about, .rp-part .k, .rp-seg button')].filter(vis).filter((e) => { const rg = document.createRange(); rg.selectNodeContents(e); const t = rg.getBoundingClientRect(), b = box(e), c = getComputedStyle(e);
    return t.right > b.right + 1 || t.bottom > b.bottom + 1 || t.left < b.left - 1 || (c.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1); }).map((e) => e.className + ': ' + e.textContent.trim().slice(0, 40));
  if (cut.length) fail.push('cut short: ' + cut.join('; '));
  // Text an owner reads: no home path, file name or ticket code.
  const words = (sheet ?? document.querySelector('main')).innerText, raw = words.match(/\\/home\\/|~\\/|\\b[\\w-]+\\.(md|json|html)\\b|\\b6198\\b|\\bRL-02\\b/g);
  if (raw) fail.push('raw text: ' + raw.join(', '));
  // At the end of the list the More line, the last thing on the page, clears the dock.
  const tabs = document.querySelector('.tabs'), last = document.querySelector('.rp-page')?.lastElementChild;
  let clear = null;
  if (!sheet && phone && tabs && last) { const y0 = scrollY; scrollTo(0, document.documentElement.scrollHeight); await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))); clear = r2(box(tabs).top - box(last).bottom); scrollTo(0, y0); if (clear < 16) fail.push('the list ends ' + clear + 'px over the dock'); }
  // The title's round light-or-dark button: 40px, on the right edge, a moon in light and a sun in dark.
  const tb = !sheet && document.querySelector('.rp-top .ui-rb.theme'), toggle = tb && { size: r2(box(tb).width) + 'x' + r2(box(tb).height), right: r2(box(tb).right), icon: tb.querySelector('circle') ? 'sun' : 'moon', label: tb.getAttribute('aria-label') };
  const seg = document.querySelector('.rp-seg');
  if (toggle && (toggle.size !== '40x40' || Math.abs(toggle.right - edgeR) > 0.5 || (seg && box(tb).bottom > box(seg).top))) fail.push('theme button ' + JSON.stringify(toggle));
  const hit = (e) => { const r = box(e), a = getComputedStyle(e, '::after'), o = (v) => Math.max(0, -parseFloat(v) || 0), wide = a.content !== 'none' && a.position === 'absolute'; return { top: r.top, bottom: r.bottom, height: r.height + (wide ? o(a.top) + o(a.bottom) : 0), width: r.width + (wide ? o(a.left) + o(a.right) : 0) }; };
  const under = phone ? [...(sheet ?? document).querySelectorAll('button, a[href], summary')].filter(vis).filter((e) => !e.closest('.dl-hover, .rp-scrim') && (!sheet || sheet.contains(e))).filter((e) => { const r = hit(e); return r.top < innerHeight && r.bottom > 0 && (r.height < 43.5 || r.width < 43.5); })
    .map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24) + ' ' + Math.round(box(e).width) + 'x' + Math.round(box(e).height)) : [];
  if (under.length) fail.push('under 44px: ' + under.join(', '));
  const head = { title: document.querySelector('.rp-top h1')?.textContent ?? '', seg: [...document.querySelectorAll('.rp-seg button')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? ' (on)' : '')).join(' / '),
    hero: [...document.querySelectorAll('.rp-hero :is(.lab, .big, .vs)')].map((e) => e.textContent).join(' | '), heads: [...document.querySelectorAll('.rp-page .ui-sec')].map((h) => [...h.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(' ')), tab: document.querySelector('.tabs a[href="#reports"]')?.getAttribute('aria-label') ?? '', toggle, more: document.querySelector('.rp-more-line')?.textContent ?? '' };
  const sh = sheet && { what: sheet.querySelector('.rp-what')?.innerText ?? '', title: sheet.querySelector('h1')?.textContent ?? '', titleLines: Math.round(box(sheet.querySelector('h1')).height / parseFloat(getComputedStyle(sheet.querySelector('h1')).lineHeight)),
    found: sheet.querySelector('.rp-found')?.textContent ?? '', ticket: sheet.querySelector('.ui-props a.ui-pr[href^="#ticket/"]')?.getAttribute('aria-label') ?? '', activity: [...sheet.querySelectorAll('.ui-act .aw b')].map((e) => e.textContent), parts: [...sheet.querySelectorAll('.rp-part')].map((p) => p.getAttribute('aria-label')), dl: [...sheet.querySelectorAll('.ui-dl')].map((e) => e.textContent), page: !!sheet.querySelector('iframe'), top: r2(box(sheet).top) };
  const overflowing = [...document.querySelectorAll('body *')].filter((e) => box(e).right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : ''));
  const ctx = document.createElement('canvas').getContext('2d'), squashed = [];
  for (const e of document.querySelectorAll('body *')) { const nodes = [...e.childNodes].filter((n) => n.nodeType === 3 && n.data.trim()); const text = nodes.map((n) => n.data).join(' ').replace(/\\s+/g, ' ').trim(); const s = getComputedStyle(e); const ew = e.offsetWidth; const eh = e.offsetHeight; if (!(e instanceof HTMLElement) || !text || !e.getClientRects().length || ((ew <= 1 || eh <= 1) && s.overflow !== 'visible') || s.visibility !== 'visible') continue; ctx.font = s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily; const chars = ew / (ctx.measureText('abcdefghijklmnopqrstuvwxyz').width / 26); const words = text.split(' ').length; const tops = new Set(); for (const n of nodes) { const rg = document.createRange(); rg.selectNodeContents(n); for (const b of rg.getClientRects()) if (b.width) tops.add(Math.round(b.top)); } if ((chars < 8 && ctx.measureText(text).width > ew + 1) || tops.size > words) squashed.push({ element: e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.classList[0] ? '.' + e.classList[0] : ''), text: text.slice(0, 40), chars: Math.round(chars * 10) / 10, lines: tops.size, words }); }
  if (overflowing.length) fail.push('overflow: ' + overflowing.join(', '));
  return { viewport: innerWidth + 'x' + innerHeight, edges: [r2(edgeL), r2(edgeR)], head, blocks, rows, clear, sheet: sh, under, fail, dom: { url: location.href, overflow: document.documentElement.scrollWidth > w, overflowing, squashed_text: squashed } };
})()`;

const prof = mkdtempSync(join(tmpdir(), 'so-reports-chrome-'));
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let ws;
const errors = [], failed = [], problems = [], lines = [];
try {
  const url = sh('bash', [join(here, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { cwd: repo }).trim().split('\n').pop(), board = join(dir, 'board.json');
  const so = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args]);
  // Seven more reports beside the seeded one, all filed in the last day (a board archives a report a day after it was filed).
  const base = JSON.parse(readFileSync(join(dir, 'report-now.json'), 'utf8')), ago = (h) => new Date(Date.now() - h * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z');
  const more = [
    { key: 'settings-speed', title: 'Where the settings page spends its first second', about: 'It is ready in 0.8 seconds. Most of that is the script, which can load after the page shows.', form: 'chart', group: 'Settings', filed: ago(0.5), priority: 'P1' },
    { key: 'chat-retry', title: '6198 RL-02: Why a message retries once', about: 'One retry covers a dropped connection; a second would send it twice. See notes/chat/retry.md.', group: 'Chat app', filed: ago(2), priority: 'P0' },
    { key: 'settings-move', title: 'Settings now open from the profile', about: 'One tap from the profile picture, as people looked for it there first.', group: 'Settings', filed: ago(3) },
    { key: 'release-notes', title: 'What the release changes for a phone', about: 'Three screens change; the rest stay as they are.', group: 'Release', filed: ago(4) },
    { key: 'release-train', title: 'Why the release train has three stages', about: 'Build, check and publish each have one owner, so a failed check stops the train before anything ships.', form: 'diagram', group: 'Release', filed: ago(20) },
    { key: 'next-question', title: 'How sign-off picks the next question', about: 'The soonest deadline comes first, then anything that blocks other work, then the rest by age.', filed: ago(22) },
  ];
  for (const m of more) {
    const msg = { ...base, ...m }; delete msg.video; delete msg.decided; delete msg.asked_by; if (!m.form) delete msg.form; if (!m.group) delete msg.group;
    writeFileSync(join(dir, `${m.key}.json`), JSON.stringify(msg)); so('post', board, '--kind', 'report', '--from', join(dir, `${m.key}.json`));
  }
  const guided = JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v4/valid-full.json'), 'utf8')); guided.filed = ago(1);
  writeFileSync(join(dir, 'guided.json'), JSON.stringify(guided)); so('post', board, '--kind', 'report', '--from', join(dir, 'guided.json'));
  // Two projects carry their own icon from the board's folder; Chat app and Release show their initials.
  mkdirSync(join(dir, 'icons'));
  copyFileSync(join(repo, 'web/icon-192.png'), join(dir, 'icons/beacon.png')); copyFileSync(join(repo, 'web/apple-touch-icon.png'), join(dir, 'icons/settings.png'));
  so('project', board, '--name', 'Beacon', '--icon', 'icons/beacon.png'); so('project', board, '--name', 'Settings', '--icon', 'icons/settings.png');
  const post = (path, body) => spawnSync('curl', ['-sf', `${url}${path}`, '-H', 'content-type: application/json', '-d', JSON.stringify(body)]);
  // Each cell starts from the same read state: three opened (read), the rest new; the guided report not opened, with two of its five parts read.
  const reset = () => { post('api/reads', { keys: ['settings-move', 'release-train', 'next-question'], read: true }); post('api/reads', { keys: [base.key, 'settings-speed', 'chat-retry', 'release-notes', guided.key], read: false }); };
  for (const part of ['this', 'understood']) post('api/reads', { key: guided.key, part });
  // The guided report names ticket T-29: the ticket is on the board, and a comment on the report gives it Activity.
  so('ticket', board, '--id', 'T-29', '--title', 'Make sign-in quicker on a phone', '--progress', '60');
  post('api/messages', { kind: 'comment', key: guided.key, text: 'Is 2.8 minutes the median of all 200?' });

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
  // Every board page opens on Newest, whatever the state before it chose; a state that wants By project taps it.
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.origin === ${JSON.stringify(new URL(url).origin)}) localStorage.setItem('sign-off-reports-by', 'new'), localStorage.removeItem('so-theme')` });
  const ev = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, `${expression.slice(0, 80)}: ${r.exceptionDetails?.exception?.description}`); return r.result.value; };
  const shot = async (file) => writeFileSync(file, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const go = async (address, ms = 1300) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: address }); await wait(ms); };
  // A finger on a row: pointer events through the page's own handlers, moved sideways in eight steps, released or held.
  const drag = (key, dx, release) => ev(`new Promise(async (ok) => { const f = document.querySelector('.dl-row[data-key="${key}"] .dl-face'); if (!f) return ok('none'); const r = f.getBoundingClientRect(), y = r.top + r.height / 2, x0 = r.left + 60;
    const o = (x) => ({ bubbles: true, pointerId: 7, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y }); f.dispatchEvent(new PointerEvent('pointerdown', o(x0)));
    for (let i = 1; i <= 8; i++) { await new Promise((w) => setTimeout(w, 16)); f.dispatchEvent(new PointerEvent('pointermove', o(x0 + ${dx} * i / 8))); } if (${release}) f.dispatchEvent(new PointerEvent('pointerup', o(x0 + ${dx}))); ok('ok'); })`);
  const pctOf = (key) => ev(`document.querySelector('.dl-row[data-key="${key}"] .pct')?.textContent ?? (document.querySelector('.dl-row[data-key=\"${key}\"]') ? '' : 'gone')`);
  const measure = async (name) => {
    const m = await ev(MEASURE);
    writeFileSync(join(out, `${name}.dom.json`), JSON.stringify({ ...m.dom, console_errors: [...errors], failed_requests: [...failed] }, null, 2) + '\n');
    delete m.dom;
    writeFileSync(join(out, `${name}.measure.json`), JSON.stringify(m, null, 2) + '\n');
    if ([m.fail, errors, failed].some((x) => x.length)) problems.push(`${name}: ${JSON.stringify({ fail: m.fail, errors, failed })}`);
    return m;
  };
  const pair = async (name, metrics, protoHash, theme) => {
    if (!proto) return;
    await cdp('Emulation.setDeviceMetricsOverride', metrics);
    await go(`file://${proto}#${protoHash}&theme=${theme}`);
    await shot(join(out, 'vs-proto', `${name}.proto.png`));
    const img = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
    writeFileSync(join(dir, 'pair.html'), `<body style="margin:0;padding:24px;display:flex;gap:24px;background:#888;font:600 22px system-ui;color:#fff">${[['Approved prototype', img(join(out, 'vs-proto', `${name}.proto.png`))], ['Board, this build', img(join(out, `${name}.png`))]]
      .map(([t, s]) => `<figure style="margin:0"><figcaption style="margin:0 0 12px">${t}: ${name}</figcaption><img src="${s}" style="display:block;width:${metrics.width}px"></figure>`).join('')}</body>`);
    await cdp('Emulation.setDeviceMetricsOverride', { width: metrics.width * 2 + 72, height: metrics.height + 84, deviceScaleFactor: 1, mobile: false });
    await go(`file://${join(dir, 'pair.html')}`, 500);
    await shot(join(out, 'vs-proto', `${name}.pair.png`));
    await cdp('Emulation.setDeviceMetricsOverride', metrics);
  };
  for (const wd of (process.env.REPORTS_WIDTHS ?? '390 1280').split(' ').map(Number)) for (const theme of ['light', 'dark']) {
    const metrics = wd === 390 ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false };
    await cdp('Emulation.setDeviceMetricsOverride', metrics);
    await cdp('Emulation.setTouchEmulationEnabled', metrics.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    const cell = `${theme}.${wd}w`, txt = [`${theme} ${wd}w Reports`];
    const state = async (s, hash, setup, protoHash) => {
      errors.length = 0; failed.length = 0;
      await go(`${url}${hash}`);
      if (setup) { await setup(); await wait(600); }
      await shot(join(out, `${s}.${cell}.png`));
      const m = await measure(`${s}.${cell}`);
      txt.push(`${s}: ${m.fail.length ? 'FAIL ' + m.fail.join('; ') : 'clean'}`);
      if (protoHash && metrics.mobile) await pair(`${s}.${cell}`, metrics, protoHash, theme);
      return m;
    };
    reset();
    if (metrics.mobile) {
      const list = await state('reports', '#reports', null, 'v=reports');
      txt.push(`head: ${list.head.title}; ${list.head.seg}; "${list.head.hero}"; sections ${list.head.heads.join(' | ')}; Reports tab "${list.head.tab}"`,
        `edges ${list.edges.join('-')}; rows (${list.rows.length}): ${list.rows.map((r) => `${r.title} [${r.icon}${r.chip ? ', ' + r.chip : ''}] ${r.pct}`).join(' | ')}`,
        `rows ${list.rows[0]?.height}px, tile ${list.rows[0]?.tile}, title ${list.rows[0]?.titleGap}px after it, percent column ${list.rows[0]?.pctW}px, second line ${list.rows[0]?.lineGap}px under the title; last row ${list.clear}px over the dock at the end of the scroll; controls under 44px ${list.under.length}`);
      assert.equal(list.rows.length, 6, 'Newest shows six'); assert.match(list.head.hero, /^Still to read \| 5 of 8 \| \d+ filed this week$/);
      assert.deepEqual(list.rows.map((r) => r.pct), ['0%', '0%', '40%', '0%', '', '0%'], 'newest first, each with a bar of how much of it is read');
      const all = await state('reports-all', '#reports', () => ev(`(document.querySelector('.rp-page .ui-sec .see').click(), 1)`));
      assert.equal(all.rows.length, 8, 'See all shows every report');
      txt.push(`See all: ${all.rows.length} rows, last row ${all.clear}px over the dock`);
      const byp = await state('reports-project', '#reports', () => ev(`([...document.querySelectorAll('.rp-seg button')][1].click(), 1)`), 'v=reports&rsort=project');
      txt.push(`By project: ${byp.head.heads.join(' | ')}`);
      assert.deepEqual(byp.head.heads, ['Settings 2', 'Release 2', 'Sign-in 1', 'Beacon 1', 'Chat app 1', 'No project 1']);
      // A guided report tapped in the list opens its sheet; reached by its link it opens in full at once.
      const g = await state('report-guided', '#reports', () => ev(`(document.querySelector('#item-${guided.key}').click(), 1)`), `v=reports&o=ch-research-helper`);
      txt.push(`guided sheet: "${g.sheet.what}" / "${g.sheet.title}" (${g.sheet.titleLines} lines) / found "${g.sheet.found}" / ${g.sheet.dl.join(', ')} / parts ${g.sheet.parts.join('; ')} / ticket "${g.sheet.ticket}" / Activity: ${g.sheet.activity.join('; ')}`);
      assert.equal(g.sheet.parts.length, 5); assert.match(g.sheet.ticket, /^Ticket: Make sign-in quicker on a phone, 60% done$/); assert.deepEqual(g.sheet.activity.slice(-1), ['Your comment']);
      // Under the parts, the sheet scrolls to the report's ticket and its Activity.
      await state('report-guided-end', '#reports', async () => { await ev(`(document.querySelector('#item-${guided.key}').click(), 1)`); await wait(800); await ev(`(document.querySelector('#reader .rp-sheet-body').scrollTo(0, 1e5), 1)`); }); assert.deepEqual(g.sheet.parts.slice(0, 2).map((p) => /, read$/.test(p)), [true, true]);
      const p = await state('report-page', `#reports/${base.key}`, null, `v=reports&o=ch-research-helper`);
      txt.push(`page sheet: "${p.sheet.what}" / "${p.sheet.title}" (${p.sheet.titleLines} lines) / ${p.sheet.dl.join(', ')} "${p.sheet.found}" / page ${p.sheet.page ? 'yes' : 'no'}`);
      assert.ok(p.sheet.page, 'a page report shows its page in the sheet');
      // Read the report opens the guided report in full; back on the list it reads 100%.
      await go(`${url}#reports/${guided.key}`); const linked = await ev(`!!document.querySelector('#reader:not(.rp-sheet) .gd-scroll')`);
      await go(`${url}#reports`); await ev(`(document.querySelector('#item-${guided.key}').click(), 1)`); await wait(800); await ev(`(document.querySelector('.rp-open-full').click(), 1)`); await wait(800);
      const full = await ev(`!!document.querySelector('#reader:not(.rp-sheet) .gd-scroll')`);
      await go(`${url}#reports`); const afterOpen = await pctOf(guided.key);
      txt.push(`by its link the guided report opens in full ${linked ? 'yes' : 'no'}; Read the report opens it in full ${full ? 'yes' : 'no'}; its row then reads ${afterOpen}`);
      assert.ok(linked && full); assert.equal(afterOpen, '');
      // Swipes: right marks unread (its bar empties), left archives with Undo, More holds Mark all as read.
      await go(`${url}#reports`); await drag('settings-move', 150, false); await wait(300); await shot(join(out, `reports-swipe-right.${cell}.png`));
      await go(`${url}#reports`); await drag('settings-move', 320, true); await wait(900); const unreadNow = await pctOf('settings-move');
      await go(`${url}#reports`); await drag('settings-speed', -320, true); await wait(900); await shot(join(out, `reports-archived.${cell}.png`));
      const archived = await ev(`!document.querySelector('.dl-row[data-key="settings-speed"]:not(.leaving)') && !document.getElementById('toast').hidden`);
      await ev(`(document.getElementById('undo').click(), 1)`); await wait(1200); const back = await pctOf('settings-speed');
      await go(`${url}#reports`); await ev(`(document.querySelector('.rp-more-line').click(), 1)`); await wait(500); await shot(join(out, `reports-menu.${cell}.png`));
      const menu = await ev(`[...document.querySelectorAll('#rp-more .ui-pr .k')].map((b) => b.textContent).join(', ')`);
      // The light-or-dark button picks the other theme: its icon flips and the canvas changes; the pick is kept in this browser.
      await go(`${url}#reports`); const canvas = () => ev(`getComputedStyle(document.body).backgroundColor`), before = await canvas();
      await ev(`(document.querySelector('.rp-top .ui-rb.theme').click(), 1)`); await wait(500); await shot(join(out, `reports-toggled.${cell}.png`));
      const flipped = await ev(`[document.querySelector('.rp-top .ui-rb.theme').getAttribute('aria-label'), localStorage.getItem('so-theme')].join('|')`), after = await canvas();
      txt.push(`light-or-dark button: "${list.head.toggle.label}" (${list.head.toggle.icon}, ${list.head.toggle.size}, right edge ${list.head.toggle.right}); tapped: ${flipped}, canvas ${before} -> ${after}; More line "${list.head.more}"`);
      assert.deepEqual([list.head.toggle.icon, flipped, before !== after], [theme === 'dark' ? 'sun' : 'moon', theme === 'dark' ? 'Switch to dark|light' : 'Switch to light|dark', true]);
      txt.push(`swipe right on a read row: ${unreadNow}; swipe left archives ${archived ? 'yes' : 'no'}, Undo brings it back at ${back}; More: ${menu}`);
      assert.deepEqual([unreadNow, archived, back, /Mark all as read/.test(menu)], ['0%', true, '0%', true]);
    } else {
      // A desk keeps the list beside the report shown: J moves (and reads it), U marks it unread, and a guided report opens over the board from Enter.
      const desk = await state('reports-desk', '#reports');
      txt.push(`desk: ${desk.head.hero}; rows ${desk.rows.length}; edges ${desk.edges.join('-')}; titles on two lines: ${desk.rows.filter((r) => r.titleLines === 2).map((r) => r.title).join(' | ')}`);
      assert.ok(desk.rows.some((r) => r.titleLines === 2) && desk.rows.every((r) => r.titleLines <= 2), 'a long title wraps to two lines on a desk');
      const key = (k) => ev(`((document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true })), 1)`);
      await key('j'); await wait(900); const sel = await ev(`document.querySelector('.split-list [data-row][aria-current]')?.getAttribute('href')`); const readJ = await pctOf('settings-speed');
      await key('u'); await wait(700); const unreadU = await pctOf('settings-speed');
      await shot(join(out, `reports-desk-next.${cell}.png`));
      txt.push(`J: ${sel}, its row ${readJ}; U: ${unreadU}`);
      assert.deepEqual([sel, readJ, unreadU], ['#reports/settings-speed', '', '0%']);
      await go(`${url}#reports/${guided.key}`); await wait(300); await shot(join(out, `reports-guided-open.${cell}.png`));
      const over = await ev(`!document.getElementById('reader').hidden`);
      txt.push(`a guided report by its link opens over the board ${over ? 'yes' : 'no'}`); assert.ok(over);
    }
    writeFileSync(join(out, `reports.${cell}.txt`), txt.join('\n') + '\n');
    lines.push(...txt);
  }
  // REPORTS_RECORD=1 also records the phone at 390, light and dark (reports.<theme>.390w.mp4), from the same read state.
  if (process.env.REPORTS_RECORD) for (const theme of ['light', 'dark']) {
    reset();
    sh(process.execPath, [join(here, '.agents/skills/done-done-verify-sign-off/decide-record.mjs'), url, theme, join(out, `reports.${theme}.390w.mp4`), 'reports'], { timeout: 180000, env: process.env });
  }
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board with eight reports filed in the last day in five projects plus one with none (Beacon and Settings with their own icon, two with a priority, one titled with a ticket code), three of them read and a guided report with two of its five parts read, naming ticket T-29 and carrying one comment.',
    steps: ['Open Reports at 390x844 (2x) in light and dark, and measure the head, every row and the edges in the browser.', 'Tap See all, then By project.', 'Tap the guided report in the list, then scroll its sheet to its ticket and Activity, then open a page report, each in its sheet.',
      'Open the guided report by its link, then tap it in the list and tap Read the report, then go back to the list.', 'Swipe a read row right, swipe a row left and tap Undo, tap the More line under the list, tap the light-or-dark button.', 'At 1280: J to the next report, U to mark it unread, open the guided report by its link.'],
    result: 'On a phone Reports reads as the approved prototype: the title with the round light-or-dark button (a moon in light, a sun in dark, which switches the theme), Newest or By project, Still to read 5 of 8 and how many were filed this week, then six rows newest first (See all for the rest), each with its project\'s icon or initials, its title in plain words with a P0 or P1 chip only where one is set, and a bar with its percent read (0%, 40% for the guided one with two of five parts read, 100% once read); By project groups them, the most reports first and No project last; a report opens in a sheet over the list with its kind, project and day, its title in full and what it found, and a guided one tapped in the list lists its five parts with a check on the two read, then its ticket row (T-29, 60%) and its Activity with the comment (reached by its link it opens in full at once); Read the report opens it in full and its row then reads 100%; a swipe right marks a row unread (0%), a swipe left archives it with Undo; More is a quiet line under the list opening a sheet of Mark all as read, Select and Archive all, and it clears the dock; on a desk a long title wraps to two lines, J reads the next report and U marks it unread.' }, null, 2) + '\n');
  console.log(lines.join('\n'));
  assert.deepEqual(problems, [], 'every capture measures clean');
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { sh(process.execPath, [join(repo, 'dist/cli.js'), 'stop', join(dir, 'board.json')]); } catch {}
  await wait(300);
  rmSync(prof, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}
