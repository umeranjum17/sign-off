// The new look's foundation (web/tokens.css, web/ui.css): the shell (title row, dock or sidebar), the Reports list on the shared row and the shared parts no screen uses yet, at 390x844 and 1280x800,
// light and dark, captured at 2x over the DevTools protocol with exact device metrics (a headless Chromium of its own), and measured in the browser:
// one left and right edge for every block, the 4px grid, 68px rows with 40px icon tiles and the title 12px after its tile, the dock's 56px pill 24px over
// the bottom with its round Search 12px beside it, or the 240px sidebar, Inter in use, no sideways overflow and no control under 44px on a phone.
// Usage: node .agents/skills/done-done-verify-sign-off/newlook-shots.mjs <output> [prototype index.html]
// With the approved prototype's page, each state is also captured from the prototype at the same size and theme, and saved beside the board's (vs-proto/).
// NEWLOOK_SIDE=before SIGN_OFF_REPO=<built base checkout> records the base under before/ (its measurements are kept, not asserted).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), proto = process.argv[3] && resolve(process.argv[3]);
const side = process.env.NEWLOOK_SIDE ?? 'after', here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), dest = side === 'after' ? out : join(out, 'before');
mkdirSync(join(dest, 'vs-proto'), { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-newlook-'));
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, env, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
// What the browser measures: every block's edges (against the content box of the page, or of the list column beside a desk's detail), the grid, the rows, the dock or sidebar, the type, and the done-done page checks.
const MEASURE = `(async () => {
  await document.fonts.ready;
  const w = document.documentElement.clientWidth, phone = innerWidth < 1024, box = (e) => e.getBoundingClientRect(), vis = (e) => { const r = box(e), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const r4 = (n) => Math.round(n * 100) / 100, grid = (n) => Math.abs(n / 4 - Math.round(n / 4)) < 0.02;
  const fail = [], blocks = [];
  const scrollY = window.scrollY;
  for (const e of document.querySelectorAll('main .top h1, main .ui-top, main .ui-seg, main .ui-sec, main .ui-card, main .ui-props')) if (vis(e)) {
    const r = box(e); blocks.push({ el: e.className || e.tagName, left: r4(r.left), right: r4(r.right), top: r4(r.top + scrollY), height: r4(r.height) });
  }
  const main = document.querySelector('.split-list') ?? document.querySelector('main'), edgeL = box(main).left + main.clientLeft + parseFloat(getComputedStyle(main).paddingLeft), edgeR = box(main).left + main.clientLeft + main.clientWidth - parseFloat(getComputedStyle(main).paddingRight);
  for (const b of blocks) {
    if (Math.abs(b.left - edgeL) > 0.5) fail.push('left edge ' + b.el + ' ' + b.left + ' not ' + edgeL);
    if (b.el.includes('ui-card') && Math.abs(b.right - edgeR) > 0.5) fail.push('right edge ' + b.el + ' ' + b.right + ' not ' + edgeR);
    if (b.el.includes('ui-') && !(grid(b.top) && grid(b.height))) fail.push('off the 4px grid ' + b.el + ' top ' + b.top + ' height ' + b.height);
  }
  const rows = [...document.querySelectorAll('.ui-row')].filter(vis).map((e) => { const r = box(e), t = box(e.querySelector('.ui-icon')), title = box(e.querySelector('.t')), card = box(e.closest('.ui-card'));
    return { height: r4(r.height), tile: r4(t.width) + 'x' + r4(t.height), tileIn: r4(t.left - card.left), titleGap: r4(title.left - t.right), titleX: r4(title.left - card.left), rightIn: r4(card.right - box(e.querySelector('.rm')).right) }; });
  rows.forEach((x, i) => { if (x.height !== 68 || x.tile !== '40x40' || x.tileIn !== 12 || x.titleGap !== 12 || x.rightIn !== 12) fail.push('row ' + i + ' ' + JSON.stringify(x)); });
  const tabs = document.querySelector('.tabs'), find = document.querySelector('.dock-find'), dock = tabs && vis(tabs) ? (() => { const p = box(tabs), f = box(find), a = box(tabs.querySelector('a'));
    return { pill: r4(p.width) + 'x' + r4(p.height), bottom: r4(innerHeight - p.bottom), tab: r4(a.width) + 'x' + r4(a.height), find: r4(f.width) + 'x' + r4(f.height), gap: r4(f.left - p.right), findBottom: r4(innerHeight - f.bottom), centred: r4(p.left - (innerWidth - f.right)) }; })() : null;
  if (dock && (dock.pill.split('x')[1] !== '56' || dock.bottom !== 24 || dock.tab !== '48x48' || dock.find !== '56x56' || dock.gap !== 12 || dock.findBottom !== 24 || Math.abs(dock.centred) > 1)) fail.push('dock ' + JSON.stringify(dock));
  const side = document.querySelector('.side'), sidebar = side && vis(side) ? { width: r4(box(side).width), current: getComputedStyle(side.querySelector('[aria-current]') ?? side).backgroundColor } : null;
  if (sidebar) {
    const text = (e) => { const tw = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, { acceptNode: (t) => t.data.trim() && !t.parentElement.closest('.n, .icon, .logo, small') ? 1 : 3 }), n = tw.nextNode(); if (!n) { fail.push('no words in ' + e.outerHTML.slice(0, 120)); return box(e); } const rg = document.createRange(); rg.selectNodeContents(n); return rg.getBoundingClientRect(); };
    const brand = side.querySelector('.brand'), mark = box(brand.querySelector('.logo')), word = text(brand.querySelector(':scope > span:not(.logo)')), glass = box(side.querySelector('.sfind svg')), areas = [...side.querySelectorAll('a[href^="#"]:not(.sfind)')];
    Object.assign(sidebar, { markLeft: r4(mark.left), glassLeft: r4(glass.left), iconLefts: [...new Set(areas.map((a) => r4(box(a.querySelector('.icon')).left)))], wordLeft: r4(word.left), searchLeft: r4(text(side.querySelector('.sfind')).left),
      labelLefts: [...new Set(areas.map((a) => r4(text(a).left)))], mark: r4(mark.width) + 'x' + r4(mark.height), icon: r4(box(areas[0].querySelector('.icon')).width), markCentre: r4((mark.top + mark.bottom) / 2 - (word.top + word.bottom) / 2) });
    const lefts = [sidebar.markLeft, sidebar.glassLeft, ...sidebar.iconLefts], words = [sidebar.wordLeft, sidebar.searchLeft, ...sidebar.labelLefts];
    if (new Set(lefts).size > 1 || new Set(words).size > 1 || sidebar.mark !== sidebar.icon + 'x' + sidebar.icon || Math.abs(sidebar.markCentre) > 0.5) fail.push('sidebar edges ' + JSON.stringify(sidebar));
  }
  if (!phone && sidebar?.width !== 240) fail.push('sidebar ' + JSON.stringify(sidebar));
  const h1 = document.querySelector('main .top h1'), type = { inter: document.fonts.check('14px Inter'), body: getComputedStyle(document.body).fontFamily.split(',')[0], h1: h1 && getComputedStyle(h1).fontSize + '/' + getComputedStyle(h1).lineHeight + ' ' + getComputedStyle(h1).fontWeight };
  if (!type.inter) fail.push('Inter not loaded');
  // A control's hit area counts a ::after that widens it, as the prototype's 32px segments and 24px links have.
  const hit = (e) => { const r = box(e), a = getComputedStyle(e, '::after'), out = (v) => Math.max(0, -parseFloat(v) || 0), wide = a.content !== 'none' && a.position === 'absolute';
    return { top: r.top, bottom: r.bottom, height: r.height + (wide ? out(a.top) + out(a.bottom) : 0), width: r.width + (wide ? out(a.left) + out(a.right) : 0) }; };
  const under = phone ? [...document.querySelectorAll('button, a[href], summary, select, input, textarea')].filter(vis).filter((e) => { const r = hit(e); return r.top < innerHeight && r.bottom > 0 && (r.height < 43.5 || r.width < 43.5); })
    .map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24) + ' ' + Math.round(box(e).width) + 'x' + Math.round(box(e).height)) : [];
  const overflowing = [...document.querySelectorAll('body *')].filter((e) => box(e).right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : ''));
  const ctx = document.createElement('canvas').getContext('2d'), squashed = [];
  for (const e of document.querySelectorAll('body *')) { const nodes = [...e.childNodes].filter((n) => n.nodeType === 3 && n.data.trim()); const text = nodes.map((n) => n.data).join(' ').replace(/\\s+/g, ' ').trim(); const s = getComputedStyle(e); const ew = e.offsetWidth; const eh = e.offsetHeight; if (!(e instanceof HTMLElement) || !text || !e.getClientRects().length || ((ew <= 1 || eh <= 1) && s.overflow !== 'visible') || s.visibility !== 'visible') continue; ctx.font = s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily; const chars = ew / (ctx.measureText('abcdefghijklmnopqrstuvwxyz').width / 26); const words = text.split(' ').length; const tops = new Set(); for (const n of nodes) { const rg = document.createRange(); rg.selectNodeContents(n); for (const b of rg.getClientRects()) if (b.width) tops.add(Math.round(b.top)); } if ((chars < 8 && ctx.measureText(text).width > ew + 1) || tops.size > words) squashed.push({ element: e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.classList[0] ? '.' + e.classList[0] : ''), text: text.slice(0, 40), chars: Math.round(chars * 10) / 10, lines: tops.size, words }); }
  return { viewport: innerWidth + 'x' + innerHeight, edges: [r4(edgeL), r4(edgeR)], blocks, rows, dock, sidebar, type, under, fail,
    dom: { url: location.href, overflow: document.documentElement.scrollWidth > w, overflowing, squashed_text: squashed } };
})()`;

// The shared parts no screen has taken up yet, drawn on the live page from ui.css with plain words: the title row, the segmented control, the hero,
// a section head, a list of rows (a bar and percent, a P1 and a P0 chip, a second line), two stat tiles, and the property panel (Its ask, Ticket, PR).
const PARTS = `(() => {
  const h = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; e.append(...kids.filter((k) => k !== '')); return e; };
  const svg = (d) => { const s = h('span', ''); s.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + d + '"/></svg>'; return s.firstChild; };
  const bar = (p) => { const b = h('span', 'ui-bar', h('i', '')); b.firstChild.style.width = p + '%'; return b; };
  const row = (title, pct, pc) => h('li', '', h('a', 'ui-row', h('span', 'ui-icon', svg('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v6h6M8 13h8M8 17h8M8 9h2')),
    h('span', 'rm', h('span', 'l1', h('span', 't', title), pc ? h('span', 'ui-pc ' + pc.toLowerCase(), pc) : ''), pct === undefined ? h('span', 'l2 meta', 'Settings · 07:19') : h('span', 'l2', bar(pct), h('span', 'pct', pct + '%'))))));
  const seg = h('div', 'ui-seg', ...['Newest', 'By project'].map((t, i) => { const b = h('button', '', t); b.setAttribute('aria-pressed', String(!i)); return b; }));
  const hero = h('section', 'ui-card ui-hero', h('div', 'hl', h('span', 'lab', 'Still to read')), h('div', 'hv', h('span', 'big', '4 ', h('small', '', 'of 15')), h('span', 'vs', '30 filed this week')));
  const sec = h('h2', 'ui-sec', 'Newest', h('a', 'see', 'See all'));
  const list = h('ul', 'ui-card ui-list', row('Settings now open from the profile', 100), row('What the release changes for a phone', 80, 'P1'), row('Why a message retries once', undefined, 'P0'));
  const stat = (d, lab, b, small) => h('a', 'ui-card ui-stat', h('span', 'si', svg(d)), h('span', 'lab', lab), h('b', '', b, small ? h('small', '', small) : ''));
  const tiles = h('div', 'ui-tiles', stat('M20 6 9 17l-5-5', 'Cleared today', '2 ', 'of 6'), stat('M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z', 'Proofs today', '12'));
  const pr = (k, ...v) => h('div', 'ui-pr', h('span', 'k', k), h('span', 'v', ...v));
  const props = h('div', 'ui-props', pr('Its ask', h('span', '', 'Ship the settings page Friday?')), pr('Ticket', h('span', '', 'Settings move'), bar(60), h('span', 'n', '60%')), pr('PR', h('span', '', 'Settings page')));
  document.getElementById('board').replaceChildren(h('header', 'ui-top', h('h1', '', 'Parts')), seg, hero, sec, list, tiles, h('p', 'ui-dl', 'Its ask'), props);
})()`;
const prof = mkdtempSync(join(tmpdir(), 'so-newlook-chrome-'));
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let url, ws;
const errors = [], failed = [], report = [], problems = [];
try {
  url = sh('bash', [join(here, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { cwd: repo }).trim().split('\n').pop();
  // Three more reports in three projects, so the list has rows to line up.
  const page = JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v2/valid-full.json'), 'utf8'));
  for (const [key, title, group] of [['settings-move', 'Settings now open from the profile', 'Settings'], ['release-notes', 'What the release changes for a phone', 'Release'], ['chat-retry', 'Why a message retries once', 'Chat app']]) {
    writeFileSync(join(dir, `${key}.json`), JSON.stringify({ ...page, key, title, group, filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') }));
    sh(process.execPath, [join(repo, 'dist/cli.js'), 'post', join(dir, 'board.json'), '--kind', 'report', '--from', join(dir, `${key}.json`)]);
  }
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
  const shot = async (file) => writeFileSync(file, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const go = async (address, ms = 1200) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: address }); await wait(ms); };
  // The prototype keys its states by address; the board by its hash routes.
  const STATES = [['today', '#', 'v=today'], ['reports', '#reports', 'v=reports'], ['parts', '#', 'v=reports', PARTS]];
  for (const [wd, metrics] of [['390w', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }], ['1280w', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }]]) {
    for (const theme of ['light', 'dark']) {
      await cdp('Emulation.setDeviceMetricsOverride', metrics);
      await cdp('Emulation.setTouchEmulationEnabled', metrics.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      for (const [state, hash, protoHash, draw] of STATES) {
        const name = `${state}.${theme}.${wd}`;
        errors.length = 0; failed.length = 0;
        await go(`${url}${hash}`);
        if (draw) { await cdp('Runtime.evaluate', { expression: draw }); await wait(300); }
        await shot(join(dest, `${name}.png`));
        const ev = await cdp('Runtime.evaluate', { expression: MEASURE, awaitPromise: true, returnByValue: true }), m = ev.result.value;
        assert.ok(m && !ev.exceptionDetails, `${name}: the measure ran: ${ev.exceptionDetails?.exception?.description}`);
        writeFileSync(join(dest, `${name}.dom.json`), JSON.stringify({ ...m.dom, console_errors: [...errors], failed_requests: [...failed] }, null, 2) + '\n');
        delete m.dom;
        writeFileSync(join(dest, `${name}.measure.json`), JSON.stringify(m, null, 2) + '\n');
        report.push(`${name}: edges ${m.edges.join('-')}, ${m.blocks.length} blocks, ${m.rows.length} rows${m.rows[0] ? ` (${m.rows[0].height}px, tile ${m.rows[0].tile}, title ${m.rows[0].titleGap}px after it)` : ''}, ${m.dock ? `dock ${m.dock.pill} ${m.dock.bottom}px up, Search ${m.dock.find} ${m.dock.gap}px beside` : `sidebar ${m.sidebar?.width}px`}, title ${m.type.h1}, ${m.type.body}${m.type.inter ? ' loaded' : ' NOT loaded'}, under 44px ${m.under.length}, failures ${m.fail.length}${m.fail.length ? ': ' + m.fail.join('; ') : ''}`);
        if ([m.fail, m.under, errors, failed].some((x) => x.length)) problems.push(`${name}: ${JSON.stringify({ fail: m.fail, under: m.under, errors, failed })}`);
        if (!proto) continue;
        await go(`file://${proto}#${protoHash}&theme=${theme}`);
        await shot(join(dest, 'vs-proto', `${name}.proto.png`));
        // The prototype on the left, the board on the right, each under its name, drawn by the browser itself.
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
  writeFileSync(join(dest, 'measure.txt'), report.join('\n') + '\n');
  if (side === 'after') writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board with asks, a plan, an update and four reports in three projects.',
    steps: ['Open Today, Reports and the shared parts (drawn on the live page from ui.css) at 390x844 and 1280x800 (2x), light and dark, over the DevTools protocol with exact device metrics.', 'Measure in the browser every block\'s left and right edge, the 4px grid, each row, the dock or sidebar, the typeface and every control against 44px.'],
    result: 'On a phone and on a desk, in light and in dark, the board is drawn in the new look: a warm canvas with cards a step lighter, Inter, a 24px medium title in a 44px row, every block on one 16px gutter and the 4px grid; Reports lists each report as a 68px row in one card (a 40px white icon tile, the title 12px after it, then the project and time), under 18px section heads; a phone has the floating dock (a 56px pill of round tabs, 24px over the bottom, the round Search button 12px beside it) and a desk the 240px sidebar with Search; the shared parts drawn from ui.css (a 40px segmented control, the hero card, rows with a bar and percent and P0 and P1 chips, two stat tiles and the Its ask, Ticket and PR panel) sit on the same edges and grid; no control under 44px on a phone, no sideways overflow, no console error.' }, null, 2) + '\n');
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
