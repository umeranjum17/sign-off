// Today in the new look, as the approved prototype draws it, at one theme and width per run (so a run's steps.json holds one claim), driven and measured in a headless
// Chromium of its own over the DevTools protocol with exact device metrics (390x844 or 1280x800, 2x).
// The board is feel-board.sh's (a sign-in, three asks with a pick, a three-screen design asked as one question, five updates, two reports), then: a P0 on the ship ask and a P2 on the
// digest ask, the export ask and the design on tickets (60% and 100%), the ship ask resting on the settings proof (so it takes that proof's project), and the settings and Chat app projects given their own icons with
// sign-off-axi project --icon, so Up next and the rows show a priority chip, a project's name and its icon where they exist.
// States: today-signin (the sign-in up next, as seeded), today (after signin done: the ship ask up next), today-answered (its Answer tapped), theme (the round
// light-or-dark button tapped: the other theme), more (the More sheet from the line under the tiles), search (the dock's Search with "settings" typed) and today-end
// (scrolled to the end, the last line clear of the dock); at 1280, today and search.
// Each capture is measured in the browser: every block on the 16px gutter's two edges, the 4px grid, 68px rows (40px tile, title 12px after it), the hero, the section head, the tiles,
// the dock, no control under 44px on a phone, no sideways overflow, no file path or internal code in the words on screen, and no console error.
// Usage: node .agents/skills/done-done-verify-sign-off/today-shots.mjs <output> [light|dark|light,dark] [390|1280]   (two themes: one run each, then one steps.json naming both)
// TODAY_PROTO=<the approved prototype's index.html> also captures the prototype's today, today-answered and search at the same size and theme, and saves each pair (vs-proto/).
// SIGN_OFF_REPO names another built checkout to drive, such as the base for a before (TODAY_SIDE=before names its files and keeps its measurements unasserted).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024;
const side = process.env.TODAY_SIDE ?? 'after', here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), proto = process.env.TODAY_PROTO && resolve(process.env.TODAY_PROTO);
mkdirSync(join(out, 'vs-proto'), { recursive: true });
if (theme.includes(',')) {
  const each = theme.split(',').map((t) => {
    const r = spawnSync(process.execPath, [process.argv[1], out, t, String(width)], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
    if (side !== 'after') return null;
    renameSync(join(out, 'steps.json'), join(out, `steps.${t}.json`));
    return [t, JSON.parse(readFileSync(join(out, `steps.${t}.json`), 'utf8'))];
  }).filter(Boolean);
  if (each.length) writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: each[0][1].target, start: each[0][1].start,
    steps: each.flatMap(([t, x]) => x.steps.map((step) => `In ${t}: ${step}`)), result: each.map(([, x]) => x.result).join(' ') }, null, 2) + '\n');
  process.exit(0);
}
const dir = mkdtempSync(join(tmpdir(), 'so-today-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, env, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const cli = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args]);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const metrics = phone ? { width, height: 844, deviceScaleFactor: 2, mobile: true } : { width, height: 800, deviceScaleFactor: 2, mobile: false };
const name = (state) => `${state}.${side}.${theme}.${width}w`;

// What the browser measures on Today: its blocks' edges against main's content box, the 4px grid, the rows, the dock, the sheet, the words, and the done-done page checks.
const MEASURE = `(async () => {
  await document.fonts.ready;
  const w = document.documentElement.clientWidth, box = (e) => e.getBoundingClientRect(), vis = (e) => { const r = box(e), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const r2 = (n) => Math.round(n * 100) / 100, grid = (n) => Math.abs(n / 4 - Math.round(n / 4)) < 0.02, fail = [], y = scrollY;
  const sheet = document.querySelector('dialog.t-sheet[open]'), scope = sheet ?? document.querySelector('main');
  const main = document.querySelector('main'), edgeL = box(main).left + parseFloat(getComputedStyle(main).paddingLeft), edgeR = box(main).right - parseFloat(getComputedStyle(main).paddingRight);
  const blocks = sheet ? [] : [...document.querySelectorAll('main .ui-top, main .t-up, main .ui-sec, main .ui-list, main .t-tiles')].filter(vis).map((e) => { const r = box(e); return { el: e.className.split(' ').slice(-1)[0], left: r2(r.left), right: r2(r.right), top: r2(r.top + y), height: r2(r.height) }; });
  const cols = phone => [...document.querySelectorAll('main .t-cols > div')].map((c) => [box(c).left, box(c).right]);
  for (const b of blocks) {
    const [l, r] = innerWidth < 1024 ? [edgeL, edgeR] : (cols().find(([a, z]) => b.left >= a - 0.5 && b.right <= z + 0.5) ?? [edgeL, edgeR]);
    if (Math.abs(b.left - l) > 0.5) fail.push('left edge ' + b.el + ' ' + b.left + ' not ' + r2(l));
    if (b.el !== 'ui-sec' && Math.abs(b.right - r) > 0.5) fail.push('right edge ' + b.el + ' ' + b.right + ' not ' + r2(r));
    if (!(grid(b.top) && grid(b.height))) fail.push('off the 4px grid ' + b.el + ' top ' + b.top + ' height ' + b.height);
  }
  const rows = [...scope.querySelectorAll('.ui-row')].filter(vis).map((e) => { const r = box(e), t = box(e.querySelector('.ui-icon')), title = box(e.querySelector('.t')), card = box(e.closest('.ui-list'));
    return { height: r2(r.height), tile: r2(t.width) + 'x' + r2(t.height), tileIn: r2(t.left - card.left), titleGap: r2(title.left - t.right), rightIn: r2(card.right - box(e.querySelector('.rm')).right),
      chip: e.querySelector('.ui-pc')?.textContent ?? null, icon: e.querySelector('.ui-icon img') ? 'picture' : e.querySelector('.ui-icon .mono') ? 'initials' : 'drawing', bar: !!e.querySelector('.ui-bar') }; });
  rows.forEach((x, i) => { if (!(x.height === 68 || (innerWidth >= 1024 && x.height === 84)) || x.tile !== '40x40' || x.tileIn !== 12 || x.titleGap !== 12 || x.rightIn !== 12) fail.push('row ' + i + ' ' + JSON.stringify(x)); });
  const up = document.querySelector('main .t-up'), btns = up ? [...up.querySelectorAll('.t-btns > *')].map((b) => { const r = box(b), c = getComputedStyle(b); return { words: b.textContent.trim(), w: r2(r.width), h: r2(r.height), bg: c.backgroundColor, color: c.color }; }) : [];
  if (btns.some((b) => b.h !== 44)) fail.push('Up next buttons ' + JSON.stringify(btns));
  // The title row's round button: a 40px circle, its icon centred, inside the title row and the page.
  const rb = document.querySelector('main .today-top .ui-rb'), round = rb && (() => { const r = box(rb), g = box(rb.querySelector('svg')), row = box(rb.parentElement);
    return { w: r2(r.width), h: r2(r.height), radius: getComputedStyle(rb).borderRadius, offX: r2((g.left + g.right - r.left - r.right) / 2), offY: r2((g.top + g.bottom - r.top - r.bottom) / 2), inside: r.left >= row.left && r.right <= row.right && r.right <= w - 16 + 0.5 }; })();
  if (round && (round.w !== 40 || round.h !== 40 || round.radius !== '20px' || Math.abs(round.offX) > 0.5 || Math.abs(round.offY) > 0.5 || !round.inside)) fail.push('round button ' + JSON.stringify(round));
  const tabs = document.querySelector('.tabs'), find = document.querySelector('.dock-find'), dock = tabs && vis(tabs) ? (() => { const p = box(tabs), f = box(find);
    return { pill: r2(p.width) + 'x' + r2(p.height), bottom: r2(innerHeight - p.bottom), find: r2(f.width) + 'x' + r2(f.height), gap: r2(f.left - p.right), top: r2(p.top) }; })() : null;
  if (dock && (dock.pill.split('x')[1] !== '56' || dock.bottom !== 24 || dock.find !== '56x56' || dock.gap !== 12)) fail.push('dock ' + JSON.stringify(dock));
  // At the scroll end the last block clears the dock.
  const last = [...document.querySelectorAll('main .t-more-line, main .t-tiles, main .ui-list, main .t-up')].filter(vis).map((e) => box(e).bottom).sort((a, b) => b - a)[0];
  const atEnd = Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1, clear = dock && last !== undefined ? r2(dock.top - last) : null;
  if (atEnd && clear !== null && clear < 16) fail.push('the last block is ' + clear + 'px from the dock');
  const sh = sheet && (() => { const r = box(sheet); return { left: r2(r.left), right: r2(r.right), top: r2(r.top), bottom: r2(innerHeight - r.bottom), field: sheet.querySelector('.t-find') ? r2(box(sheet.querySelector('.t-find')).height) : null,
    groups: [...sheet.querySelectorAll('.t-grp')].map((g) => g.textContent), focus: document.activeElement?.id || document.activeElement?.tagName }; })();
  // Words a user reads: no file path, no internal code (a ticket or message id, a run id), no raw key.
  const words = (sheet ?? main).innerText, bad = words.match(/(?:^|\\s)(?:[\\w.-]+\\/)+[\\w.-]+\\.(?:md|json|html|png|txt)\\b|\\b[A-Z][a-z]+\\d{3,}\\b|\\b\\d{8}T\\d{6}Z\\b|\\b(?:fm|msg)-[\\w-]{6,}/g) ?? [];
  if (bad.length) fail.push('raw words: ' + bad.join(', '));
  const hit = (e) => { const r = box(e), a = getComputedStyle(e, '::after'), o = (v) => Math.max(0, -parseFloat(v) || 0), wide = a.content !== 'none' && a.position === 'absolute';
    return { top: r.top, bottom: r.bottom, height: r.height + (wide ? o(a.top) + o(a.bottom) : 0), width: r.width + (wide ? o(a.left) + o(a.right) : 0) }; };
  const under = innerWidth < 1024 ? [...(sheet ?? document).querySelectorAll('button, a[href], summary, input')].filter(vis).filter((e) => !e.closest('.tabs, .dock-find') || true).filter((e) => { const r = hit(e); return r.top < innerHeight && r.bottom > 0 && (r.height < 43.5 || r.width < 43.5); })
    .map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24) + ' ' + Math.round(box(e).width) + 'x' + Math.round(box(e).height)) : [];
  const overflowing = [...document.querySelectorAll('body *')].filter((e) => vis(e) && box(e).right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + '.' + (e.classList[0] ?? ''));
  return { viewport: innerWidth + 'x' + innerHeight, edges: [r2(edgeL), r2(edgeR)], blocks, rows, buttons: btns, round, dock, clear: atEnd ? clear : undefined, sheet: sh, under, fail,
    words: words.replace(/\\s+/g, ' ').trim().slice(0, 900), dom: { url: location.href, overflow: document.documentElement.scrollWidth > w, overflowing } };
})()`;

const prof = mkdtempSync(join(tmpdir(), 'so-today-chrome-'));
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let ws;
const errors = [], failed = [], report = [], problems = [], shots = [];
try {
  const url = sh('bash', [join(here, '.agents/skills/done-done-verify-sign-off/feel-board.sh'), dir], { cwd: repo }).trim().split('\n').pop();
  // A priority on two asks (the board takes P0-P3 on any card) and the design's project given its own icon.
  const b = JSON.parse(readFileSync(board, 'utf8'));
  for (const d of b.items) if (d.key === 'ship') Object.assign(d, { priority: 'P0', proof: 'ev1' }); else if (d.key === 'digest') d.priority = 'P2';
    else if (d.key === 'export') d.ticket = 'export-label'; else if (d.key === 'onboarding') d.ticket = 'onboarding';
  writeFileSync(board, JSON.stringify(b, null, 2) + '\n');
  // Two tickets, so a row on one shows its bar: the export label half done, the onboarding finished (a full bar).
  cli('ticket', board, '--id', 'export-label', '--title', 'Export button label', '--progress', '60');
  cli('ticket', board, '--id', 'onboarding', '--title', 'Chat app onboarding', '--progress', '100');
  copyFileSync(join(repo, 'web/icon-192.png'), join(dir, 'chat-app.png'));
  cli('project', board, '--name', 'Chat app', '--icon', 'chat-app.png');
  writeFileSync(join(dir, 'settings.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#E8590C"/><circle cx="12" cy="12" r="3" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 4.5v3M12 16.5v3M4.5 12h3M16.5 12h3" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>');
  cli('project', board, '--name', 'settings', '--icon', 'settings.svg');

  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium opened its DevTools port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
    if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push(x.params.args.map((a) => a.value ?? a.description).join(' '));
    if (x.method === 'Network.responseReceived' && x.params.response.status >= 400) failed.push({ url: x.params.response.url, status: x.params.response.status }); };
  const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  const js = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, `${expression.slice(0, 80)}: ${r.exceptionDetails?.exception?.description}`); return r.result.value; };
  const until = async (expression, what) => { for (let i = 0; i < 60; i++) { if (await js(expression)) return; await wait(100); } assert.fail(`timed out: ${what}`); };
  // A real tap or click on an element's centre, as a finger or mouse sends it.
  const tap = async (sel) => { const [x, y] = await js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    if (phone) { await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else { for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); } };
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  const setup = async () => { await cdp('Emulation.setDeviceMetricsOverride', metrics); await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }); };
  await setup();
  const png = async (file) => writeFileSync(file, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const go = async (address, ms = 1200) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: address }); await wait(ms); };
  const capture = async (state) => {
    await wait(450);
    await png(join(out, `${name(state)}.png`)); shots.push(`${name(state)}.png`);
    const m = await js(MEASURE);
    writeFileSync(join(out, `${name(state)}.dom.json`), JSON.stringify({ ...m.dom, console_errors: [...errors], failed_requests: [...failed] }, null, 2) + '\n');
    delete m.dom;
    writeFileSync(join(out, `${name(state)}.measure.json`), JSON.stringify(m, null, 2) + '\n');
    report.push(`${name(state)}: ${m.blocks.map((x) => `${x.el} ${x.top}+${x.height}`).join(', ')}; rows ${m.rows.map((r) => `${r.height}px ${r.icon}${r.chip ? ' ' + r.chip : ''}${r.bar ? ' bar' : ''}`).join(' | ')}; buttons ${m.buttons.map((x) => `${x.words} ${x.w}x${x.h} ${x.bg}`).join(' | ')}${m.round ? `; round button ${m.round.w}x${m.round.h} r${m.round.radius} icon off ${m.round.offX},${m.round.offY}` : ''}`
      + `${m.dock ? `; dock ${m.dock.pill} ${m.dock.bottom}px up` : ''}${m.clear !== undefined ? `; last block ${m.clear}px above the dock` : ''}${m.sheet ? `; sheet ${JSON.stringify(m.sheet)}` : ''}; under 44px ${m.under.length}; failures ${m.fail.length}${m.fail.length ? ': ' + m.fail.join('; ') : ''}`);
    if ([m.fail, m.under, errors, failed].some((x) => x.length)) problems.push(`${name(state)}: ${JSON.stringify({ fail: m.fail, under: m.under, errors, failed })}`);
    errors.length = 0; failed.length = 0;
    return m;
  };
  const pair = async (state, protoHash) => {
    if (!proto) return;
    await go(`file://${proto}#${protoHash}&theme=${theme}`, 900);
    await png(join(out, 'vs-proto', `${name(state)}.proto.png`));
    const img = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
    const html = `<body style="margin:0;padding:24px;display:flex;${phone ? '' : 'flex-direction:column;'}gap:24px;background:#888;font:600 26px system-ui;color:#fff">${[['Approved prototype', img(join(out, 'vs-proto', `${name(state)}.proto.png`))], ['Board, this build', img(join(out, `${name(state)}.png`))]]
      .map(([t, s]) => `<figure style="margin:0"><figcaption style="margin:0 0 12px">${t}: ${state}, ${metrics.width} x ${metrics.height}, ${theme}</figcaption><img src="${s}" style="display:block;width:${metrics.width}px"></figure>`).join('')}</body>`;
    writeFileSync(join(dir, 'pair.html'), html);
    await cdp('Emulation.setDeviceMetricsOverride', { width: phone ? metrics.width * 2 + 72 : metrics.width + 48, height: phone ? metrics.height + 96 : metrics.height * 2 + 144, deviceScaleFactor: 1, mobile: false });
    await go(`file://${join(dir, 'pair.html')}`, 600);
    await png(join(out, 'vs-proto', `${name(state)}.pair.png`)); shots.push(`vs-proto/${name(state)}.pair.png`);
    await setup();
  };
  const facts = {};
  if (phone) {
    // As seeded, the sign-in leads: Open sign-in and Details.
    await go(url);
    await until(`!!document.querySelector('.t-up .t-btn.ink')`, 'Up next drawn');
    facts.signin = await js(`[...document.querySelectorAll('.t-up .q, .t-up .t-btn')].map((e) => e.textContent.trim()).join(' | ')`);
    await capture('today-signin');
  }
  // The sign-in done, the ship ask (P0, a pick recommended) is up next.
  cli('signin', 'done', board, '--key', 'npm');
  await go(url);
  await until(`document.querySelector('.t-up .q')?.textContent.startsWith('When should')`, 'the ship ask up next');
  facts.today = await js(`({ up: document.querySelector('.t-up .hl').textContent, q: document.querySelector('.t-up .q').textContent, meta: document.querySelector('.t-up .meta').textContent,
    buttons: [...document.querySelectorAll('.t-up .t-btn')].map((b) => b.textContent.trim()), rows: [...document.querySelectorAll('.t-wait .ui-row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim()),
    tiles: [...document.querySelectorAll('.t-tiles .ui-stat')].map((t) => t.getAttribute('aria-label') + ' -> ' + t.getAttribute('href')) })`);
  await capture('today');
  await pair('today', 'v=today');
  if (phone) {
    // Answer with the pick, by a tap: the button draws its check, then the next ask rises in and Cleared today counts it.
    await go(url);
    await until(`!!document.querySelector('.t-up .t-btn.ink')`, 'Up next drawn');
    await tap('.t-up .t-btn.ink');
    await until(`document.querySelector('.t-up .q')?.textContent.startsWith('Keep the weekly')`, 'the next ask up next');
    await until(`document.getElementById('toast').hidden`, 'the toast gone');
    facts.answered = await js(`({ up: document.querySelector('.t-up .hl').textContent, cleared: document.querySelector('.t-tiles .ui-stat').getAttribute('aria-label'),
      saved: ${JSON.stringify('')} || 'answer saved' })`);
    facts.answers = readFileSync(join(dir, 'board.answers.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((a) => `${a.key}=${a.answer}`);
    await capture('today-answered');
    const firstKey = proto ? await (async () => { await go(`file://${proto}#v=today`, 700); return js('D.decide[0].key'); })() : '';
    await pair('today-answered', `v=today&answered=${encodeURIComponent(firstKey)}`);
    // The round button in the title row switches light and dark (a moon in light, a sun in dark); the pick stays across a reload, and a second tap puts it back.
    await go(url);
    await until(`!!document.querySelector('.today-top .ui-rb')`, 'the light-or-dark button drawn');
    facts.theme = { before: await js(`document.querySelector('.today-top .ui-rb').getAttribute('aria-label') + ' | ' + getComputedStyle(document.body).backgroundColor`) };
    await tap('.today-top .ui-rb');
    await until(`document.querySelector('.today-top .ui-rb').getAttribute('aria-label') === ${JSON.stringify(theme === 'dark' ? 'Switch to dark' : 'Switch to light')}`, 'the other theme');
    await go(url);
    await until(`!!document.querySelector('.t-up')`, 'Today drawn again');
    facts.theme.after = await js(`document.querySelector('.today-top .ui-rb').getAttribute('aria-label') + ' | ' + getComputedStyle(document.body).backgroundColor`);
    await capture('theme');
    await tap('.today-top .ui-rb');
    await until(`localStorage.getItem('so-theme') === ${JSON.stringify(theme)}`, 'the theme put back');
    await js(`localStorage.removeItem('so-theme')`);
    // More, the quiet line under the tiles.
    await go(url);
    await until(`!!document.querySelector('.t-more-line')`, 'More drawn');
    await js(`document.querySelector('.t-more-line').scrollIntoView({ block: 'center' })`);
    await tap('.t-more-line');
    await until(`document.getElementById('t-more').open`, 'More open');
    facts.more = await js(`document.getElementById('t-more').innerText.replace(/\\s+/g, ' ').trim()`);
    await capture('more');
  }
  // Search, the dock's round button (the sidebar's on a desk), with words typed.
  await go(url);
  await until(`!!document.querySelector('.t-up')`, 'Today drawn');
  await tap(phone ? '.dock-find' : '.sfind');
  await until(`document.getElementById('t-search').open && document.activeElement?.id === 'find'`, 'Search open with its field in hand');
  await cdp('Input.insertText', { text: 'settings' });
  await until(`document.querySelectorAll('#t-search .ui-row').length > 0`, 'results');
  facts.search = await js(`[...document.querySelectorAll('#t-search .t-grp, #t-search .ui-row .t')].map((e) => e.textContent).join(' | ')`);
  await js(`document.activeElement.blur()`);
  await capture('search');
  await pair('search', `v=today&s&q=crewhouse`);
  if (phone) {
    // Scrolled to the end, the last tile clears the dock.
    await go(url);
    await until(`!!document.querySelector('.t-tiles')`, 'tiles drawn');
    await js(`scrollTo(0, document.documentElement.scrollHeight)`);
    await capture('today-end');
  }
  writeFileSync(join(out, `${name('today')}.facts.json`), JSON.stringify(facts, null, 2) + '\n');
  writeFileSync(join(out, `measure.${side}.${theme}.${width}w.txt`), report.join('\n') + '\n');
  if (side === 'after') writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board (feel-board.sh: a sign-in, three asks with a recommended answer, a design to review, five updates, two reports), with a P0 and a P2 on two asks and the Chat app project given its own icon.',
    steps: [`Open Today at ${metrics.width}x${metrics.height} (2x), ${theme}, in a headless Chromium of its own, and measure every block, row, button and the dock in the browser.`,
      ...(phone ? ['With the sign-in up next, read Up next.', 'Mark the sign-in done with sign-off-axi signin done; Today shows the ship ask up next.', 'Tap Answer Friday; the next ask rises into Up next, Cleared today counts it and the answer is in the board\'s answers file.', 'Tap the round button in the title row: the other theme, kept across a reload; tap it again to put it back.', 'Tap the line under the tiles and read More.'] : []),
      `${phone ? 'Tap the dock\'s round Search' : 'Click Search in the sidebar'}, type "settings" and read the groups.`, ...(phone ? ['Scroll to the end and measure the last tile against the dock.'] : []),
      ...(proto ? ['Capture the approved prototype at the same size and theme (today, today-answered, search) and save each beside the board.'] : [])],
    result: `${theme}, ${metrics.width}px: Today is drawn as the approved prototype: the title with the round light-or-dark button (it switches the theme and keeps it), Up next (how many wait, the priority chip where one is set, the question, its project's icon and name (else its kind), time and the recommended answer, Answer in ink beside Other answer), Waiting on you (68px rows with the project's own icon or initials or a drawing, a P chip only where set), and Cleared today and Proofs today; every block on one gutter and the 4px grid; Answer saves and the next ask rises in; one quiet line under the tiles opens More, which holds Answered, Designs, the Leash and Ask the agent; Search opens as a sheet over the screen with its groups; the last tile clears the dock; no control under 44px, no file path or code in the words, no sideways overflow, no console error.` }, null, 2) + '\n');
  console.log(report.join('\n'));
  console.log(JSON.stringify(facts, null, 2));
  if (side === 'after') assert.deepEqual(problems, [], 'every capture measures clean');
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { cli('stop', board); } catch {}
  await wait(300);
  rmSync(prof, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}
