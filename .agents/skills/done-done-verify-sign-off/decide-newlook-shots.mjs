// Decide in the new look (slice 3): the list (Newest and By priority, the hero, the asks in one card with their P0-P3 chips, ticket bars and project tiles, Later and Answered)
// and an ask as a sheet over it (nothing picked, an answer picked, an answered ask), at 390x844 light and dark, and the same list and ask beside each other at 1280x800.
// Captured at 2x over the DevTools protocol with exact device metrics (a headless Chromium of its own) on a board seeded here with the prototype's four asks,
// and measured in the browser: one left and right edge, the 4px grid, 68px rows, the sheet's edges, the title wrapping in full, no control under 44px, the last row clearing the dock.
// Usage: node .agents/skills/done-done-verify-sign-off/decide-newlook-shots.mjs <output> [prototype index.html]
// With the approved prototype's page, each state that has a prototype frame is also captured from it at the same size and theme, and saved beside the board's (vs-proto/).
// DECIDE_SIDE=before SIGN_OFF_REPO=<built base checkout> records the base under before/ (its measurements are kept, not asserted). DECIDE_RECORD=1 also records the motion.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), proto = process.argv[3] && resolve(process.argv[3]);
const side = process.env.DECIDE_SIDE ?? 'after', repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), dest = side === 'after' ? out : join(out, 'before');
mkdirSync(join(dest, 'vs-proto'), { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-decide-'));
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache') };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, env, ...options }); assert.equal(r.status, 0, `${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const so = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args], { cwd: dir });
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const board = join(dir, 'board.json');

// The board: the prototype's four asks (a P0 fix plan on a ticket 26% done, the Mac screen recording grant, a P1 repeated cause, yesterday's yes or no),
// two asks answered today, and two projects with their own icons (an ask filed by a project's tool takes its tile; one with no icon shows its initials).
function seed() {
  writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
  mkdirSync(join(dir, 'icons'));
  writeFileSync(join(dir, 'icons/takeone.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#16161A"/><path d="M7 9V7h2M15 7h2v2M17 15v2h-2M9 17H7v-2" stroke="#fff" stroke-width="1.6" fill="none"/><circle cx="12" cy="12" r="2.6" fill="#5B6CFF"/></svg>');
  writeFileSync(join(dir, 'icons/addons.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#1F2A44"/><circle cx="12" cy="7" r="2" stroke="#fff" stroke-width="1.6" fill="none"/><path d="M12 9v9M7 13c0 3 2.2 5 5 5s5-2 5-5M9.5 12h5" stroke="#fff" stroke-width="1.6" fill="none"/><circle cx="18" cy="18" r="3" fill="#F04E37"/></svg>');
  const ask = (key, filer, title, why, extra) => so('post', board, '--ask-ref', 'message-demo', '--key', key, '--filer', filer, '--title', title, '--why', why, ...extra);
  ask('digest', 'newsletter-agent', 'Keep the weekly digest?', 'About a third of readers opened it in each of the last two months.', ['--outcome', 'yes=It keeps going out each Monday.', '--outcome', 'no=It stops after this week.', '--recommend', 'yes', '--recommend-reason', 'Readers still open it.', '--default', 'yes']);
  ask('ship', 'release-agent', 'Ship the settings page on Friday?', 'Support is fully staffed on Friday.', ['--outcome', 'yes=It ships with support on hand.', '--outcome', 'no=It waits for next week.', '--recommend', 'yes', '--recommend-reason', 'Support is on hand.', '--default', 'no']);
  ask('screen-on', 'takeone', 'Have you turned on Screen Recording for Node.js?', 'TakeOne cannot record the Mac until it is on.', ['--outcome', 'yes=TakeOne records the Mac again.', '--outcome', 'no=TakeOne waits.', '--recommend', 'yes', '--recommend-reason', 'It is one switch.', '--default', 'no']);
  ask('cache-lock', 'learn-from-mistakes', 'Fix the shared cache lock that keeps coming back?', 'Two incidents over one day, both a build waiting on the same cache lock.', ['--priority', 'P1', '--outcome', 'yes=A fix task is filed for the lock.', '--outcome', 'no=It is left as it is.', '--recommend', 'yes', '--recommend-reason', 'It keeps coming back.', '--default', 'no']);
  ask('mac-screen', 'takeone', 'Allow Node.js screen recording on the Mac?', 'Its answer resumes TakeOne\'s Mac recording.', ['--option', 'allow=Allow', '--option', 'wait=Not yet', '--outcome', 'allow=TakeOne Mac recording resumes', '--outcome', 'wait=Mac recording stays parked', '--recommend', 'allow', '--recommend-reason', 'One switch; only you can grant it.', '--default', 'wait']);
  so('ticket', board, '--id', 'T-41', '--title', 'Add-ons approval audit fixes', '--progress', '26');
  ask('fix-plan', 'firstmate-addons', 'Approve the fix plan from the add-ons approval audit?', 'Eighteen of the approved screens match; the plan fixes the rest in three passes.', ['--priority', 'P0', '--ticket', 'T-41', '--option', 'approve=Approve', '--option', 'hold=Hold it', '--outcome', 'approve=The three passes start today.', '--outcome', 'hold=Nothing changes until you look again.', '--recommend', 'approve', '--recommend-reason', 'The plan only touches the screens that differ.', '--default', 'hold']);
  so('project', board, '--name', 'takeone', '--icon', 'icons/takeone.svg');
  so('project', board, '--name', 'firstmate-addons', '--icon', 'icons/addons.svg');
  // The prototype's clock: each ask filed at the time its row shows, today in this computer's time zone (two of them two days ago).
  const b = JSON.parse(readFileSync(board, 'utf8')), at = (h, m, back = 0) => { const t = new Date(); t.setDate(t.getDate() - back); t.setHours(h, m, 0, 0); return t.toISOString().replace(/\.\d+Z$/, 'Z'); };
  const filed = { 'fix-plan': at(7, 45), 'mac-screen': at(6, 36), 'cache-lock': at(9, 10, 2), 'screen-on': at(8, 20, 2), digest: at(6, 5), ship: at(6, 10) };
  for (const d of b.items) if (filed[d.key]) d.filed = filed[d.key];
  writeFileSync(board, JSON.stringify(b, null, 2) + '\n');
}
const MEASURE = `(async () => {
  await document.fonts.ready;
  const w = document.documentElement.clientWidth, phone = innerWidth < 1024, box = (e) => e.getBoundingClientRect(), vis = (e) => { const r = box(e), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const r4 = (n) => Math.round(n * 100) / 100, grid = (n) => Math.abs(n / 4 - Math.round(n / 4)) < 0.02, fail = [], sheet = document.querySelector('.ask-sheet');
  const pad = (e) => { const r = box(e), c = getComputedStyle(e); return [r.left + e.clientLeft + parseFloat(c.paddingLeft), r.left + e.clientLeft + e.clientWidth - parseFloat(c.paddingRight)]; };
  const col = document.querySelector('.split-list') ?? document.querySelector('main'), [edgeL, edgeR] = pad(col), blocks = [];
  for (const e of document.querySelectorAll('.decide-list > :is(.ui-seg, .ui-hero, .ui-sec, .ui-card), #board .ui-top')) if (vis(e)) {
    const r = box(e); blocks.push({ el: e.className.split(' ').slice(0, 2).join('.'), left: r4(r.left), right: r4(r.right), top: r4(r.top + scrollY), height: r4(r.height) });
    if (Math.abs(r.left - edgeL) > 0.5) fail.push('left edge ' + e.className + ' ' + r4(r.left) + ' not ' + r4(edgeL));
    if (!e.matches('.ui-sec, .ui-top') && Math.abs(r.right - edgeR) > 0.5) fail.push('right edge ' + e.className + ' ' + r4(r.right) + ' not ' + r4(edgeR));
    if (!grid(r.top + scrollY - (col === document.querySelector('main') ? 0 : box(col).top)) || !grid(r.height)) fail.push('off the 4px grid ' + e.className + ' top ' + r4(r.top + scrollY) + ' height ' + r4(r.height));
  }
  const rows = [...document.querySelectorAll('.decide-list .ui-row')].filter(vis).map((e) => { const r = box(e), t = box(e.querySelector('.ui-icon')), title = box(e.querySelector('.t')), card = box(e.closest('.ui-card'));
    return { height: r4(r.height), tile: r4(t.width) + 'x' + r4(t.height), tileIn: r4(t.left - card.left), titleGap: r4(title.left - t.right), rightIn: r4(card.right - box(e.querySelector('.rm')).right),
      chip: e.querySelector('.ui-pc')?.textContent ?? '', bar: e.querySelector('.ui-bar') ? e.querySelector('.pct').textContent : '', tileKind: e.querySelector('.ui-icon img') ? 'icon' : e.querySelector('.ui-icon .mono') ? 'initials:' + e.querySelector('.mono').textContent : 'drawing',
      title: e.querySelector('.t').textContent, cut: e.querySelector('.t').scrollWidth > e.querySelector('.t').clientWidth + 1 }; });
  rows.forEach((x, i) => { if ((phone ? x.height !== 68 : x.height < 68) || x.tile !== '40x40' || x.tileIn !== 12 || x.titleGap !== 12 || x.rightIn !== 12) fail.push('row ' + i + ' ' + JSON.stringify(x)); });
  const icons = [...document.querySelectorAll('.ui-icon img')].map((i) => ({ src: i.getAttribute('src'), loaded: i.complete && i.naturalWidth > 0 }));
  icons.filter((i) => !i.loaded).forEach((i) => fail.push('icon not drawn ' + i.src));
  let ask = null;
  if (sheet) {
    const [sl, sr] = pad(sheet), parts = [...sheet.querySelectorAll('.sh-head, .lead h2, .since, .ui-props, .pick-list, .note-box')].filter(vis);
    const h2 = sheet.querySelector('h2');
    ask = { sheet: [r4(box(sheet).left), r4(box(sheet).right), r4(box(sheet).top)], edges: [r4(sl), r4(sr)], title: h2.textContent, titleLines: Math.round(box(h2).height / parseFloat(getComputedStyle(h2).lineHeight)), titleWhole: h2.scrollHeight <= h2.clientHeight + 1,
      parts: parts.map((e) => ({ el: e.className || e.tagName.toLowerCase(), left: r4(box(e).left), right: r4(box(e).right), top: r4(box(e).top), height: r4(box(e).height) })),
      button: sheet.querySelector('.decide-bar .answer')?.textContent ?? '', picked: [...sheet.querySelectorAll('.pick-option[aria-pressed="true"] .label')].map((e) => e.textContent),
      panel: [...sheet.querySelectorAll('.ui-props .ui-pr')].map((e) => e.textContent.replace(/\\s+/g, ' ').trim()) };
    // Every block starts on the sheet's left edge; the panels and the note end on its right edge, and the bar's buttons span it.
    for (const p of ask.parts) if (Math.abs(p.left - sl) > 0.5) fail.push('sheet left edge ' + p.el + ' ' + p.left);
    for (const p of ask.parts.filter((x) => /ui-props|pick-list|note-box|sh-head/.test(x.el))) if (Math.abs(p.right - sr) > 0.5) fail.push('sheet right edge ' + p.el + ' ' + p.right);
    const btns = [...sheet.querySelectorAll('.decide-bar > button')].filter(vis).map(box);
    if (btns.length && (Math.abs(btns[0].left - sl) > 0.5 || Math.abs(btns.at(-1).right - sr) > 0.5)) fail.push('sheet bar ' + btns.map((b) => r4(b.left) + '-' + r4(b.right)).join(', '));
    if (!ask.titleWhole) fail.push('title cut: ' + ask.title);
  }
  // At the foot of the list the last card clears the dock.
  const tabs = document.querySelector('.tabs'), dockTop = tabs && vis(tabs) ? box(tabs).top : innerHeight, cards = [...document.querySelectorAll('.decide-list > .ui-card, .decide-list > .gone-asks')].filter(vis);
  let clears = null;
  if (phone && !sheet && cards.length) { const y = scrollY; scrollTo(0, document.documentElement.scrollHeight); await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))); clears = r4(dockTop - box(cards.at(-1)).bottom); scrollTo(0, y); if (clears < 16) fail.push('last card under the dock: ' + clears); }
  const hit = (e) => { const r = box(e), a = getComputedStyle(e, '::after'), o = (v) => Math.max(0, -parseFloat(v) || 0), wide = a.content !== 'none' && a.position === 'absolute';
    return { top: r.top, bottom: r.bottom, height: r.height + (wide ? o(a.top) + o(a.bottom) : 0), width: r.width + (wide ? o(a.left) + o(a.right) : 0) }; };
  const scope = sheet ?? document;
  const under = phone ? [...scope.querySelectorAll('button, a[href], summary, textarea')].filter(vis).filter((e) => !e.closest('.dl-menu, .dl-act')).filter((e) => { const r = hit(e); return r.top < innerHeight && r.bottom > 0 && (r.height < 43.5 || r.width < 43.5); })
    .map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24) + ' ' + Math.round(box(e).width) + 'x' + Math.round(box(e).height)) : [];
  const words = [...document.querySelectorAll('#board *')].filter((e) => e.childElementCount === 0 && vis(e)).map((e) => e.textContent).join(' ');
  const raw = words.match(/\\b(?:[\\w.-]+\\/){2,}[\\w.-]+|\\b[a-f0-9]{12,}\\b|\\.json\\b|\\bundefined\\b|\\bnull\\b|\\[object/g) ?? [];
  if (raw.length) fail.push('raw text on screen: ' + raw.join(', '));
  const overflowing = [...document.querySelectorAll('body *')].filter((e) => box(e).right > w + 1 && !e.closest('.dl-act')).slice(0, 10).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + e.classList[0]);
  const ctx = document.createElement('canvas').getContext('2d'), squashed = [];
  for (const e of document.querySelectorAll('body *')) { const nodes = [...e.childNodes].filter((n) => n.nodeType === 3 && n.data.trim()); const text = nodes.map((n) => n.data).join(' ').replace(/\\s+/g, ' ').trim(); const s = getComputedStyle(e); const ew = e.offsetWidth; const eh = e.offsetHeight; if (!(e instanceof HTMLElement) || !text || !e.getClientRects().length || ((ew <= 1 || eh <= 1) && s.overflow !== 'visible') || s.visibility !== 'visible') continue; ctx.font = s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily; const chars = ew / (ctx.measureText('abcdefghijklmnopqrstuvwxyz').width / 26); const wc = text.split(' ').length; const tops = new Set(); for (const n of nodes) { const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width) tops.add(Math.round(b.top)); } if ((chars < 8 && ctx.measureText(text).width > ew + 1) || tops.size > wc) squashed.push({ element: e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.classList[0] ? '.' + e.classList[0] : ''), text: text.slice(0, 40), chars: Math.round(chars * 10) / 10, lines: tops.size, words: wc }); }
  const hero = document.querySelector('.decide-list .ui-hero');
  return { viewport: innerWidth + 'x' + innerHeight, edges: [r4(edgeL), r4(edgeR)], blocks, rows, icons, ask, clears, under, fail,
    seg: [...document.querySelectorAll('.decide-list .ui-seg button')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? ' (on)' : '')), hero: hero?.textContent.replace(/\\s+/g, ' ').trim(),
    inter: document.fonts.check('14px Inter'), dom: { url: location.href, overflow: document.documentElement.scrollWidth > w, overflowing, squashed_text: squashed } };
})()`;
const prof = mkdtempSync(join(tmpdir(), 'so-decide-chrome-'));
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let ws, server;
const errors = [], failed = [], report = [], problems = [];
try {
  seed();
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', (b) => (log += b)); server.stderr.on('data', (b) => (log += b));
  let url; for (let i = 0; i < 100 && !url; i++) { await wait(100); url = /http:\/\/127\.0\.0\.1:\d+\//.exec(log)?.[0]; }
  assert.ok(url, `the board served: ${log}`);
  for (const [key, answer] of [['digest', 'yes'], ['ship', 'yes']]) assert.ok((await fetch(`${url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, answer, note: '' }) })).ok, `answered ${key}`);
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
  const run = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, `${expression}: ${r.exceptionDetails?.exception?.description}`); return r.result.value; };
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  const shot = async (file) => writeFileSync(file, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const go = async (address, ms = 1200) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: address }); await wait(ms); };
  // Each state: the board's address, what is done on it by hand (a tap on the page's own control), and the prototype's address for the same state (none where it has no frame).
  const tap = (sel) => `(async () => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.click(); await new Promise((ok) => setTimeout(ok, 600)); })()`;
  // On a phone the order is the round button in Decide's head, opening a sheet of Newest (1) and By priority (2).
  const order = (n) => `(async () => { await ${tap('#board .dl-rb')}; await ${tap(`#dl-sort .dl-pick:nth-child(${n})`)}; })()`;
  const STATES = [
    ['decide', '#waiting', '', 'v=decide'],
    ['decide-priority', '#waiting', order(2), 'v=decide&dsort=prio'],
    ['ask', '#decide/mac-screen', '', 'v=decide&o=ask-mac-screen-grant'],
    ['ask-picked', '#decide/mac-screen', tap('.decide .pick-option'), 'v=decide&o=ask-mac-screen-grant&pick=done'],
    ['ask-ticket', '#decide/fix-plan', '', ''],
    ['ask-answered', '#decide/digest', '', ''],
  ];
  const sizes = [['390w', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, STATES], ['1280w', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }, STATES.filter(([s]) => ['decide', 'ask-picked'].includes(s))]];
  for (const [wd, metrics, states] of sizes) {
    for (const theme of ['light', 'dark']) {
      await cdp('Emulation.setDeviceMetricsOverride', metrics);
      await cdp('Emulation.setTouchEmulationEnabled', metrics.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      for (const [state, hash, act, protoHash] of states) {
        const name = `${state}.${theme}.${wd}`;
        errors.length = 0; failed.length = 0;
        await go(`${url}${hash}`);
        // The base has no such control for some states: its capture is kept as it is.
        if (act) try { await run(act); } catch (e) { if (side === 'after') throw e; }
        await wait(400);
        await shot(join(dest, `${name}.png`));
        const m = await run(MEASURE);
        writeFileSync(join(dest, `${name}.dom.json`), JSON.stringify({ ...m.dom, console_errors: [...errors], failed_requests: [...failed] }, null, 2) + '\n');
        delete m.dom;
        writeFileSync(join(dest, `${name}.measure.json`), JSON.stringify(m, null, 2) + '\n');
        report.push(`${name}: edges ${m.edges.join('-')}, seg ${m.seg.join(' | ')}, hero "${m.hero}", ${m.rows.length} rows (${m.rows.map((r) => `${r.height}px ${r.tileKind}${r.chip ? ' ' + r.chip : ''}${r.bar ? ' bar ' + r.bar : ''}`).join('; ')})${m.ask ? `, sheet ${m.ask.edges.join('-')} title "${m.ask.title}" in ${m.ask.titleLines} lines, button "${m.ask.button}", panel [${m.ask.panel.join(' / ')}]` : ''}${m.clears !== null ? `, last card ${m.clears}px over the dock` : ''}, Inter ${m.inter}`);
        if ([m.fail, m.under, errors, failed].some((x) => x.length)) problems.push(`${name}: ${JSON.stringify({ fail: m.fail, under: m.under, errors, failed })}`);
        // By priority is kept in the browser: put Newest back for the next state.
        if (state === 'decide-priority' && side === 'after') await run(order(1));
        if (!proto || !protoHash) continue;
        await go(`file://${proto}#${protoHash}&theme=${theme}`);
        await shot(join(dest, 'vs-proto', `${name}.proto.png`));
        const img = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
        const html = `<body style="margin:0;padding:24px;display:flex;${metrics.mobile ? '' : 'flex-direction:column;'}gap:24px;background:#888;font:600 28px system-ui;color:#fff">${[['Approved prototype', img(join(dest, 'vs-proto', `${name}.proto.png`))], ['Board, this build', img(join(dest, `${name}.png`))]]
          .map(([t, s]) => `<figure style="margin:0"><figcaption style="margin:0 0 12px">${t}: ${state}, ${metrics.width} x ${metrics.height}, ${theme}</figcaption><img src="${s}" style="display:block;width:${metrics.width}px"></figure>`).join('')}</body>`;
        writeFileSync(join(dir, 'pair.html'), html);
        const pw = metrics.mobile ? metrics.width * 2 + 72 : metrics.width + 48, ph = metrics.mobile ? metrics.height + 96 : metrics.height * 2 + 144;
        await cdp('Emulation.setDeviceMetricsOverride', { width: pw, height: ph, deviceScaleFactor: 1, mobile: false });
        await go(`file://${join(dir, 'pair.html')}`, 600);
        await shot(join(dest, 'vs-proto', `${name}.pair.png`));
        await cdp('Emulation.setDeviceMetricsOverride', metrics);
      }
    }
  }
  // A finished ticket fills its row's bar and reads 100%: the P0 ask's ticket goes to 100 and Decide is read again, on a phone in light.
  if (side === 'after') {
    so('ticket', board, '--id', 'T-41', '--progress', '100');
    await cdp('Emulation.setDeviceMetricsOverride', sizes[0][1]);
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await go(`${url}#waiting`);
    const done = await run(`(() => { const r = document.querySelector('.dl-row[data-key="fix-plan"]'), i = r?.querySelector('.ui-bar i'); return r && [r.querySelector('.pct')?.textContent, i && Math.round(i.getBoundingClientRect().width) === Math.round(i.parentElement.getBoundingClientRect().width)].join('|'); })()`);
    await shot(join(dest, 'decide-ticket-done.light.390w.png'));
    report.push(`decide-ticket-done.light.390w: the P0 ask's ticket at 100%: ${done}`);
    if (done !== '100%|true') problems.push(`decide-ticket-done.light.390w: expected a full bar at 100%, got ${done}`);
  }
  writeFileSync(join(dest, 'measure.txt'), report.join('\n') + '\n');
  if (side === 'after') writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board with four asks waiting (a P0 fix plan on a ticket 26% done, the Mac screen recording grant, a P1 yes or no, an older yes or no), two answered today, and two projects with their own icons.',
    steps: ['Open Decide on a phone (390x844, 2x) in light and in dark over the DevTools protocol with exact device metrics, and tap By priority.',
      'Tap the Mac screen recording ask: its sheet rises over the list; tap Allow; open the P0 fix plan; open an answered ask.',
      'At 1280x800 open Decide beside an ask with an answer picked.',
      'Measure in the browser every block\'s left and right edge, the 4px grid, each row, the sheet\'s edges, the title wrapping in full and every control against 44px, and capture the approved prototype in the same state, size and theme beside each.'],
    result: 'On a phone, in light and in dark, Decide is drawn in the new look as the approved prototype draws it: the title Decide with the round light-or-dark button, Newest and By priority, a Waiting on you card with 4 and 2 answered today, then the asks in one card of 68px rows, each its icon tile, its question, a P0 or P1 chip where it has a priority, and a 26% bar for the ask whose ticket has progress, else whose it is and when (a ticket at 100% fills the bar); By priority puts the P0 then the P1 ask first. An ask opens as a sheet over the dimmed list with its question in full, since when it has waited, Priority and Its ask in one panel, the answers with a radio each, a note, and Ask me later beside one ink button that reads Pick an answer and then Answer Allow. An answered ask shows its answer, its Activity and Change answer. On a desk the list sits beside the ask in the same parts.' }, null, 2) + '\n');
  // DECIDE_RECORD=1: the motion at 390 in light, on this board (decide-record.mjs): press, swipes with Undo, the sheet rising, a pick, the answer folding the row away, Close, By priority, Answer all.
  if (process.env.DECIDE_RECORD === '1' && side === 'after') sh(process.execPath, [join(repo, '.agents/skills/done-done-verify-sign-off/decide-record.mjs'), url, 'light', join(out, 'decide-flow.light.390w.mp4')], { timeout: 240000 });
  console.log(report.join('\n'));
  if (problems.length) console.log(problems.join('\n'));
  if (side === 'after') assert.deepEqual(problems, [], 'every capture measures clean');
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { if (server) so('stop', board); } catch {}
  await wait(300);
  rmSync(prof, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}
