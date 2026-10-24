// Designs in the new look, at one theme and width per run (so a run's steps.json holds one claim), driven and measured in a headless Chromium of its own over the DevTools
// protocol with exact device metrics (390x844, 1280x800 or 1440x900, 2x).
// The board holds three designs posted through the real CLI (Umer's demo data, under Designs, none promoted to Decide; their screens are the board's own docs/media shots):
// Today on a phone (three screens and two directions; changes asked with a pick and a note on one screen), Today on a desk in one column or two (a pick, approved) and the Reports list on a phone (in review).
// The Sign-off project has its own icon (sign-off-axi project --icon); the others show initials. Today on a desk sits on a finished ticket (its row's full bar). Three evidence updates give the sidebar's Evidence a count.
// States at 390: designs (the list), design (a row tapped: its review), design-end (scrolled to its end), change (a note typed and Change tapped: the list reads Changes requested),
// more (the title row's More), full (Review full screen). At 1280 and 1440: designs (the newest open beside where it stands), design-picked (another card clicked) and full.
// Each capture is measured in the browser: on a phone every block on the 16px gutter's two edges and the 4px grid, 68px rows, the last row clear of the dock, no control under 44px;
// on a desk every card on the 12-column grid's lines, shared tops, the 4px grid, no page scroll, the empty share of the viewport, no text cut but a card title past two lines,
// the sidebar's places in the prototype's order with Designs lit and the Evidence and Designs counts the board's (a phone: the dock's five with Decide lit, Designs being Decide's second list there),
// no words drawn over other words; everywhere no file path or internal code in the words on screen, no sideways overflow and no console error.
// Usage: node .agents/skills/done-done-verify-sign-off/designs-shots.mjs <output> [light|dark|light,dark] [390|1280|1440]
// DESIGNS_PROTO=<the approved prototype's index.html (v3)> also captures the prototype at the same size and theme and saves each pair (vs-proto/): on a desk its Designs,
// on a phone its Reports list and an open report (Designs is not in the phone's dock; it follows Reports' look), and its Designs address (Today, lit in the dock) beside the board's dock on Designs.
// SIGN_OFF_REPO names another built checkout to drive, such as the base for a before (DESIGNS_SIDE=before names its files and keeps its measurements unasserted).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024;
const side = process.env.DESIGNS_SIDE ?? 'after', repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), proto = process.env.DESIGNS_PROTO && resolve(process.env.DESIGNS_PROTO);
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
const dir = mkdtempSync(join(tmpdir(), 'so-designs-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, env, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const cli = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args]);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const metrics = { width, height: phone ? 844 : width === 1440 ? 900 : 800, deviceScaleFactor: 2, mobile: phone };
const name = (state) => `${state}.${side}.${theme}.${width}w`;

// What the browser measures: the blocks against main's content box (a phone) or the 12-column grid (a desk), the rows, the dock, the words, cut and overlapping text, and the page checks.
const MEASURE = `(async () => {
  await document.fonts.ready;
  const w = document.documentElement.clientWidth, box = (e) => e.getBoundingClientRect(), vis = (e) => { const r = box(e), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const r2 = (n) => Math.round(n * 100) / 100, grid = (n) => Math.abs(n / 4 - Math.round(n / 4)) < 0.02, fail = [], y = scrollY, desk = innerWidth >= 1024;
  const sheet = document.querySelector('dialog[open]'), reader = document.getElementById('reader'), open = reader && !reader.hidden ? reader : null, scope = sheet ?? open ?? document.querySelector('main');
  const main = document.querySelector('main'), edgeL = box(main).left + parseFloat(getComputedStyle(main).paddingLeft), edgeR = box(main).right - parseFloat(getComputedStyle(main).paddingRight);
  const pick = (sel) => [...scope.querySelectorAll(sel)].filter(vis).map((e) => { const r = box(e); return { el: [...e.classList].find((c) => c.startsWith('dz-')) ?? e.className.split(' ')[0], left: r2(r.left), right: r2(r.right), top: r2(r.top + y), height: r2(r.height), bottom: r2(r.bottom + y) }; });
  let blocks = [], columns = null, empty = null;
  // The places: the sidebar on a desk (its names, the one lit, its counts), the dock on a phone (its five, the one lit).
  const nav = desk ? [...document.querySelectorAll('#nav a:not(.sfind)')].filter(vis).map((a) => ({ name: [...a.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join('').trim(), current: a.getAttribute('aria-current') === 'page', n: a.querySelector('.n')?.textContent ?? null }))
    : [...document.querySelectorAll('.tabs a')].map((a) => ({ name: a.getAttribute('aria-label').split(',')[0], current: a.getAttribute('aria-current') === 'page' }));
  const lit = nav.filter((x) => x.current).map((x) => x.name).join(',');
  if (desk && nav.length && nav.map((x) => x.name).join(',') !== 'Today,Decide,Evidence,Reports,Designs,Tickets') fail.push('sidebar places ' + nav.map((x) => x.name));
  if (desk && nav.length && lit !== 'Designs') fail.push('sidebar lights ' + lit);
  if (desk && nav.length && (nav.find((x) => x.name === 'Designs')?.n !== '3' || nav.find((x) => x.name === 'Evidence')?.n !== '3')) fail.push('sidebar counts ' + JSON.stringify(nav));
  if (!desk && (nav.length !== 5 || (!open && !sheet && lit !== 'Decide'))) fail.push('dock ' + JSON.stringify(nav));
  if (sheet) {}
  else if (!desk) {
    // A phone: every block on the gutter's two edges and the 4px grid.
    const [l, r] = open ? [box(open.querySelector('.design-review')).left + 16, box(open.querySelector('.design-review')).right - 16] : [edgeL, edgeR];
    blocks = pick(open ? '.design-review > :is(.dz-lab, h1, .dz-about, .design-preview-window, .dz-full, .ui-props, .dz-said, .dz-ctl)' : '.dz-top, .dz-hero, .ui-sec, .ui-list');
    for (const b of blocks) {
      if (Math.abs(b.left - l) > 0.5) fail.push('left edge ' + b.el + ' ' + b.left + ' not ' + r2(l));
      if (b.el !== 'ui-sec' && b.el !== 'dz-lab' && b.el !== 'dz-about' && Math.abs(b.right - r) > 0.5) fail.push('right edge ' + b.el + ' ' + b.right + ' not ' + r2(r));
      if (!open && !(grid(b.top) && grid(b.height))) fail.push('off the 4px grid ' + b.el + ' top ' + b.top + ' height ' + b.height);
    }
  } else if (document.querySelector('.dz-grid')) {
    // A desk: the 12 columns of the grid, every card starting and ending on a column line, the top row's cards sharing a top, all on the 4px grid, no page scroll.
    const g = document.querySelector('.dz-grid'), gb = box(g), gap = parseFloat(getComputedStyle(g).columnGap), col = (gb.width - 11 * gap) / 12;
    const lines = [...Array(12)].flatMap((_, i) => [gb.left + i * (col + gap), gb.left + i * (col + gap) + col]);
    columns = { left: r2(gb.left), width: r2(gb.width), col: r2(col), gap };
    blocks = pick('.dz-grid > .dz-strip > .dz-card, .dz-grid > .dz-open, .dz-grid > .dz-info');
    for (const b of blocks) {
      if (!lines.some((x) => Math.abs(x - b.left) < 0.6) || !lines.some((x) => Math.abs(x - b.right) < 0.6)) fail.push('off the column lines ' + b.el + ' ' + b.left + '-' + b.right);
      if (!(grid(b.top) && grid(b.height))) fail.push('off the 4px grid ' + b.el + ' top ' + b.top + ' height ' + b.height);
    }
    const cards = blocks.filter((b) => b.el === 'dz-card'), lower = blocks.filter((b) => b.el !== 'dz-card');
    if (new Set(cards.map((b) => b.top)).size > 1 || new Set(lower.map((b) => b.top)).size > 1) fail.push('tops differ ' + JSON.stringify(blocks.map((b) => b.el + ' ' + b.top)));
    if (document.documentElement.scrollHeight > innerHeight + 1) fail.push('the page scrolls: ' + document.documentElement.scrollHeight);
    if (lower.some((b) => Math.abs(innerHeight - b.bottom - 24) > 0.5)) fail.push('the open design does not reach 24px over the foot: ' + JSON.stringify(lower.map((b) => innerHeight - b.bottom)));
    // The empty share, as the prototype's DESK_MEASURE takes it: the viewport outside every content box (the sidebar, the header, each card down to its last content), sampled every 4px.
    const boxes = [...document.querySelectorAll('.side, .dz-head, .dz-card, .dz-open, .dz-info')].filter(vis).map((c) => { const q = box(c); let bot = q.bottom;
      if (!c.matches('.side, .dz-head')) { let last = q.top; for (const d of c.querySelectorAll('*')) { const z = box(d); if (z.width && z.height) last = Math.max(last, Math.min(z.bottom, q.bottom)); } bot = Math.min(q.bottom, last + parseFloat(getComputedStyle(c).paddingBottom) + 4); }
      return { left: q.left, right: q.right, top: q.top, bottom: bot }; });
    let n = 0, e = 0;
    for (let yy = 2; yy < innerHeight; yy += 4) for (let x = 2; x < innerWidth; x += 4) { n++; if (!boxes.some((b) => x >= b.left && x < b.right && yy >= b.top && yy < b.bottom)) e++; }
    empty = r2((e / n) * 100);
    if (empty >= 15) fail.push('empty share ' + empty + '%');
  }
  // Rows (a phone's list): 68px, the 40px tile 12px in, the title 12px after it.
  const rows = [...scope.querySelectorAll('.ui-row')].filter(vis).map((e) => { const r = box(e), t = box(e.querySelector('.ui-icon')), title = box(e.querySelector('.t')), card = box(e.closest('.ui-list'));
    return { height: r2(r.height), tile: r2(t.width) + 'x' + r2(t.height), tileIn: r2(t.left - card.left), titleGap: r2(title.left - t.right), rightIn: r2(card.right - box(e.querySelector('.rm')).right),
      icon: e.querySelector('.ui-icon img') ? 'picture' : e.querySelector('.ui-icon .mono') ? 'initials' : 'drawing', meta: e.querySelector('.meta')?.textContent ?? '' }; });
  rows.forEach((x, i) => { if (x.height !== 68 || x.tile !== '40x40' || x.tileIn !== 12 || x.titleGap !== 12 || x.rightIn !== 12) fail.push('row ' + i + ' ' + JSON.stringify(x)); });
  // Cut text: an element whose words run past its box, except a row's title (one line on a phone) and a desk card's title past two lines.
  const cut = [...scope.querySelectorAll('h1, h2, h3, p, span, a, button, blockquote, strong, b, label')].filter(vis).filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim()))
    .filter((e) => (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible') || (e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).overflowY !== 'visible' && !['auto', 'scroll'].includes(getComputedStyle(e).overflowY)))
    .filter((e) => !e.matches('.ui-row .t, .dz-card .dz-ct'))
    .map((e) => e.tagName.toLowerCase() + '.' + (e.classList[0] ?? '') + ' "' + e.textContent.trim().slice(0, 40) + '"');
  if (cut.length) fail.push('cut text: ' + cut.join(' | '));
  const clamped = [...scope.querySelectorAll('.dz-card .dz-ct')].filter(vis).map((e) => r2(box(e).height / parseFloat(getComputedStyle(e).lineHeight)));
  if (clamped.some((n) => n > 2)) fail.push('a card title over two lines ' + clamped);
  // Words drawn over other words: two text leaves whose boxes overlap.
  const leaves = [...scope.querySelectorAll('*')].filter(vis).filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim())).filter((e) => !e.closest('iframe, svg, .design-preview-window, .dz-shot, .design-stage'))
    .map((e) => { const r = document.createRange(); r.selectNodeContents(e); let b = r.getBoundingClientRect(); b = { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
      // What shows of it: each ancestor that clips its overflow narrows the box.
      for (let a = e.parentElement; a; a = a.parentElement) if (getComputedStyle(a).overflow !== 'visible') { const c = box(a); b = { left: Math.max(b.left, c.left), right: Math.min(b.right, c.right), top: Math.max(b.top, c.top), bottom: Math.min(b.bottom, c.bottom) }; }
      return { e, b: { ...b, width: b.right - b.left, height: b.bottom - b.top } }; }).filter((x) => x.b.width > 0 && x.b.height > 0);
  const over = [];
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) { const a = leaves[i], b = leaves[j]; if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const ox = Math.min(a.b.right, b.b.right) - Math.max(a.b.left, b.b.left), oy = Math.min(a.b.bottom, b.b.bottom) - Math.max(a.b.top, b.b.top);
    if (ox > 2 && oy > 2) over.push(a.e.textContent.trim().slice(0, 20) + ' / ' + b.e.textContent.trim().slice(0, 20)); }
  if (over.length) fail.push('words over words: ' + over.slice(0, 5).join(' | '));
  const tabs = document.querySelector('.tabs'), dock = tabs && vis(tabs) && !open ? (() => { const p = box(tabs); return { top: r2(p.top), bottom: r2(innerHeight - p.bottom) }; })() : null;
  const last = !open && !sheet ? [...document.querySelectorAll('main .ui-list, main .dz-hero')].filter(vis).map((e) => box(e).bottom).sort((a, b) => b - a)[0] : undefined;
  const atEnd = Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1, clear = dock && last !== undefined ? r2(dock.top - last) : null;
  if (atEnd && clear !== null && clear < 16) fail.push('the last block is ' + clear + 'px from the dock');
  // Actions in ink: the main button of the review has the ink ground.
  const ink = [...scope.querySelectorAll('.dz-ink')].filter(vis).map((b) => ({ words: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color, h: r2(box(b).height) }));
  const words = scope.innerText, bad = words.match(/(?:^|\\s)(?:[\\w.-]+\\/)+[\\w.-]+\\.(?:md|json|html|png|webp|txt)\\b|\\b[A-Z][a-z]+\\d{3,}\\b|\\b\\d{8}T\\d{6}Z\\b|\\b(?:fm|msg)-[\\w-]{6,}/g) ?? [];
  if (bad.length) fail.push('raw words: ' + bad.join(', '));
  const hit = (e) => { const r = box(e), a = getComputedStyle(e, '::after'), o = (v) => Math.max(0, -parseFloat(v) || 0), wide = a.content !== 'none' && a.position === 'absolute';
    return { top: r.top, bottom: r.bottom, height: r.height + (wide ? o(a.top) + o(a.bottom) : 0), width: r.width + (wide ? o(a.left) + o(a.right) : 0) }; };
  const under = !desk ? [...(sheet ?? open ?? document).querySelectorAll('button, a[href], summary, input, select, textarea')].filter(vis).filter((e) => { const r = hit(e); return r.top < innerHeight && r.bottom > 0 && (r.height < 43.5 || r.width < 43.5); })
    .map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24) + ' ' + Math.round(box(e).width) + 'x' + Math.round(box(e).height)) : [];
  const overflowing = [...document.querySelectorAll('body *')].filter((e) => vis(e) && box(e).right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + '.' + (e.classList[0] ?? ''));
  if (overflowing.length) fail.push('wider than the page: ' + overflowing.join(', '));
  return { viewport: innerWidth + 'x' + innerHeight, edges: [r2(edgeL), r2(edgeR)], nav, columns, blocks, rows, ink, dock, clear: atEnd ? clear : undefined, empty, under, fail,
    words: words.replace(/\\s+/g, ' ').trim().slice(0, 900), dom: { url: location.href, overflow: document.documentElement.scrollWidth > w, overflowing } };
})()`;

const prof = mkdtempSync(join(tmpdir(), 'so-designs-chrome-'));
// A phone draws overlay scrollbars, so its captures hide them; a desk keeps the classic ones, so a list cut by a scrollbar shows.
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', ...(phone ? ['--hide-scrollbars'] : []), 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let ws;
const errors = [], failed = [], report = [], problems = [], shots = [];
try {
  // The board: three designs under Designs, newest last, as an agent posts them.
  mkdirSync(join(dir, 'design'));
  writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
  const media = join(repo, 'docs/media'), day = (n) => new Date(Date.now() - n * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
  for (const f of ['phone-today', 'phone-today-dark', 'phone-decide', 'phone-decide-dark', 'phone-signin', 'phone-signin-dark', 'phone-reports', 'phone-reports-dark', 'desk-today', 'desk-today-dark'])
    copyFileSync(join(media, `${f}.webp`), join(dir, 'design', `${f}.webp`));
  const post = (msg) => { writeFileSync(join(dir, `${msg.key}.json`), JSON.stringify({ contract: 1, kind: 'design', schema: 1, filer: 'design-agent', status: 'in_review', ...msg })); cli('post', board, '--kind', 'design', '--from', join(dir, `${msg.key}.json`)); };
  const views = (f, form = 'phone') => ({ [`${form}_light`]: `design/${f}.webp`, [`${form}_dark`]: `design/${f}-dark.webp` });
  post({ key: 'reports-phone', title: 'Reports list that reads well on a phone', group: 'Reports', filed: day(2), preview: 'design/phone-reports.webp',
    about: 'The reports list at phone width: each title on one line with its form and day, the newest first, and the last row clear of the dock.',
    journeys: [{ id: 'reports', title: 'Reports', screens: [{ id: 'list', title: 'The list', views: views('phone-reports') }] }] });
  post({ key: 'today-desk', title: 'Today on a desk in one column or two', group: 'Board desk', filed: day(1), preview: 'design/desk-today.webp',
    about: 'Two ways to lay out Today on a computer. One column reads top to bottom; two columns keep Up next beside what else waits.',
    options: [{ value: 'one', label: 'One column' }, { value: 'two', label: 'Two columns' }], recommend: 'two',
    journeys: [{ id: 'today', title: 'Today', screens: [{ id: 'desk', title: 'On a desk', views: views('desk-today', 'computer') }] }] });
  post({ key: 'today-phone', title: 'Today on a phone, with Up next first and then what waits on you', group: 'Sign-off', filed: day(0), preview: 'design/phone-today.webp',
    about: 'Three screens a person sees each morning: Today with Up next, the ask it opens, and a sign-in that waits.',
    options: [{ value: 'up-next', label: 'Up next first' }, { value: 'waits', label: 'What waits first' }], recommend: 'up-next',
    journeys: [{ id: 'morning', title: 'Morning', screens: [['today', 'Today', 'phone-today'], ['ask', 'The ask', 'phone-decide'], ['signin', 'A sign-in', 'phone-signin']]
      .map(([id, title, f]) => ({ id, title, views: views(f) })) }] });
  // Today on a desk sits on a finished ticket, so its row shows the full bar.
  const b = JSON.parse(readFileSync(board, 'utf8'));
  for (const d of b.items) if (d.key === 'today-desk') d.ticket = 'today-desk';
  writeFileSync(board, JSON.stringify(b, null, 2) + '\n');
  cli('ticket', board, '--id', 'today-desk', '--title', 'Today on a desk', '--progress', '100');
  // Three proofs filed, so the sidebar's Evidence count is the board's own.
  for (const [f, title] of [['phone-decide', 'The ask fits a phone'], ['phone-signin', 'A sign-in waits on Today'], ['phone-reports', 'Reports reads well on a phone']])
    cli('post', board, '--type', 'evidence', '--title', title, '--about', 'Umer checks the screen.', '--media', join(dir, 'design', `${f}.webp`));
  copyFileSync(join(repo, 'web/icon-192.png'), join(dir, 'sign-off.png'));
  cli('project', board, '--name', 'Sign-off', '--icon', 'sign-off.png');
  // The board in the foreground of this run: stopped with sign-off-axi stop at the end, like the seed scripts' boards.
  const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', (b) => (log += b)); server.stderr.on('data', (b) => (log += b));
  let base; for (let i = 0; i < 100 && !base; i++) { await wait(100); base = /http:\/\/127\.0\.0\.1:\d+\//.exec(log)?.[0]; }
  assert.ok(base, `the board answers: ${log}`);
  // Umer has answered two: Change on Today on a phone with the Up next pick and a note on one screen, and Approve on Today on a desk with the two-column pick.
  const answer = async (body) => { const r = await fetch(new URL('/api/answers', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(r.status, 200, await r.text()); };
  await answer({ key: 'today-phone', verdict: 'change', pick: 'up-next', notes: [{ journey: 'morning', screen: 'ask', verdict: 'change', note: 'The ask cuts its last answer at the foot of a small phone; let the answers scroll above the button.' }] });
  await answer({ key: 'today-desk', verdict: 'approve', pick: 'two', notes: [] });

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
  const tap = async (sel) => { const [x, y] = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
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
    await js(`document.activeElement?.blur?.()`);
    await png(join(out, `${name(state)}.png`)); shots.push(`${name(state)}.png`);
    const m = await js(MEASURE);
    writeFileSync(join(out, `${name(state)}.dom.json`), JSON.stringify({ ...m.dom, console_errors: [...errors], failed_requests: [...failed] }, null, 2) + '\n');
    delete m.dom;
    writeFileSync(join(out, `${name(state)}.measure.json`), JSON.stringify(m, null, 2) + '\n');
    report.push(`${name(state)}: ${m.blocks.map((x) => `${x.el} ${x.left}-${x.right} top ${x.top}+${x.height}`).join(', ')}${m.columns ? `; grid ${JSON.stringify(m.columns)}; empty ${m.empty}%` : ''}`
      + `; ${phone ? 'dock' : 'sidebar'} ${m.nav.map((x) => `${x.name}${x.n ? ' ' + x.n : ''}${x.current ? ' (lit)' : ''}`).join(', ')}`
    + `${m.rows.length ? `; rows ${m.rows.map((r) => `${r.height}px ${r.icon} "${r.meta}"`).join(' | ')}` : ''}${m.ink.length ? `; ink ${m.ink.map((b) => `${b.words} ${b.h}px ${b.bg}`).join(' | ')}` : ''}`
      + `${m.clear !== undefined && m.clear !== null ? `; last block ${m.clear}px above the dock` : ''}; under 44px ${m.under.length}; failures ${m.fail.length}${m.fail.length ? ': ' + m.fail.join('; ') : ''}`);
    if ([m.fail, m.under, errors, failed].some((x) => x.length)) problems.push(`${name(state)}: ${JSON.stringify({ fail: m.fail, under: m.under, errors, failed })}`);
    errors.length = 0; failed.length = 0;
    return m;
  };
  const pair = async (state, protoHash, scroll = 0, shot = state) => {
    if (!proto) return;
    await go(`file://${proto}#${protoHash}&theme=${theme}`, 900);
    if (scroll) await js(`(document.querySelector('.sheet .sb, .sheet') ?? document.scrollingElement).scrollTop = 1e5`), await wait(300);
    await png(join(out, 'vs-proto', `${name(state)}.proto.png`));
    const img = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
    const html = `<body style="margin:0;padding:24px;display:flex;${phone ? '' : 'flex-direction:column;'}gap:24px;background:#888;font:600 26px system-ui;color:#fff">${[['Approved prototype', img(join(out, 'vs-proto', `${name(state)}.proto.png`))], ['Board, this build', img(join(out, `${name(shot)}.png`))]]
      .map(([t, s]) => `<figure style="margin:0"><figcaption style="margin:0 0 12px">${t}: ${state}, ${metrics.width} x ${metrics.height}, ${theme}</figcaption><img src="${s}" style="display:block;width:${metrics.width}px"></figure>`).join('')}</body>`;
    writeFileSync(join(dir, 'pair.html'), html);
    await cdp('Emulation.setDeviceMetricsOverride', { width: phone ? metrics.width * 2 + 72 : metrics.width + 48, height: phone ? metrics.height + 96 : metrics.height * 2 + 144, deviceScaleFactor: 1, mobile: false });
    await go(`file://${join(dir, 'pair.html')}`, 600);
    await png(join(out, 'vs-proto', `${name(state)}.pair.png`)); shots.push(`vs-proto/${name(state)}.pair.png`);
    await setup();
  };
  const after = side === 'after', facts = {};
  const protoKey = async (i) => (proto ? (await go(`file://${proto}#v=designs`, 700), js(`DESIGNS[${i}].key`)) : '');
  const firstReport = async () => (proto ? (await go(`file://${proto}#v=reports`, 700), js(`document.querySelector('[data-act="report"]').dataset.id`)) : '');
  // Designs: the list on a phone, the newest open beside where it stands on a desk.
  await go(`${base}#designs`);
  await until(`document.querySelectorAll('#board [id^="item-"], #board .dz-card').length === 3`, 'three designs drawn');
  facts.designs = await js(`document.querySelector('main').innerText.replace(/\\s+/g, ' ').trim()`);
  await capture('designs');
  await pair('designs', phone ? 'v=reports' : 'v=designs');
  // The prototype's phone keeps its five tabs and draws Designs' address as Today; the board's dock on Designs (Decide lit) beside it.
  if (phone) await pair('designs-dock', 'v=designs', 0, 'designs');
  if (phone) {
    // A row tapped opens its review over the list.
    await go(`${base}#designs`);
    await until(`document.querySelectorAll('#board [id^="item-"]').length === 3`, 'three designs drawn');
    await tap(after ? '#item-today-phone .ui-row' : '#item-today-phone a');
    await until(`!document.getElementById('reader').hidden && !!document.querySelector('#reader .design-review')`, 'the review open');
    await wait(400);
    facts.design = await js(`document.querySelector('#reader').innerText.replace(/\\s+/g, ' ').trim()`);
    await capture('design');
    await js(`document.querySelector('#reader .design-review').scrollTop = 1e5; scrollTo(0, 1e5)`);
    await capture('design-end');
    const rep = await firstReport();
    await pair('design', `v=reports&o=${encodeURIComponent(rep)}`);
    await pair('design-end', `v=reports&o=${encodeURIComponent(rep)}`, 1);
  } else {
    // Another card clicked opens that design beside where it stands.
    await go(`${base}#designs`);
    await until(`document.querySelectorAll('#board [id^="item-"], #board .dz-card').length === 3`, 'three designs drawn');
    // A base with the desk's cards (or, older, the list that opened the reader) is driven the same way.
    await tap('.dz-card[href="#designs/today-desk"], #item-today-desk a');
    await until(`(location.hash === '#designs/today-desk' && document.querySelector('.dz-open h2')?.textContent.startsWith('Today on a desk')) || !!document.querySelector('#reader:not([hidden]) h1')`, 'the settings design open');
    facts.picked = await js(`(document.querySelector('.dz-grid') ?? document.getElementById('reader')).innerText.replace(/\\s+/g, ' ').trim()`);
    await capture('design-picked');
    await pair('design-picked', `v=designs&d=${encodeURIComponent(await protoKey(1))}`);
  }
  if (after) {
    // Review full screen: the screen viewer over the whole page, as before.
    await go(`${base}#designs/today-phone`);
    await until(`!!document.querySelector('[data-design="today-phone"]')`, 'Review full screen drawn');
    await tap('[data-design="today-phone"]');
    await until(`!!document.querySelector('.design-viewer[open]')`, 'the viewer open');
    facts.full = await js(`document.querySelector('.design-viewer[open]').innerText.replace(/\\s+/g, ' ').trim()`);
    await capture('full');
    await js(`document.querySelector('.design-viewer[open] [aria-label="Close viewer"]').click()`);
  }
  if (phone && after) {
    // The title row's More: Select and Clear all.
    await go(`${base}#designs`);
    await until(`!!document.querySelector('.dz-top .dz-more')`, 'More drawn');
    await tap('.dz-top .dz-more');
    await until(`!!document.querySelector('#dz-sheet[open]')`, 'More open');
    facts.more = await js(`document.getElementById('dz-sheet').innerText.replace(/\\s+/g, ' ').trim()`);
    await capture('more');
    await pair('more', 'v=evidence&fs');
    // A note typed on the Reports list design and Change tapped: the answer is saved and the list says so.
    await go(`${base}#designs/reports-phone`);
    await until(`!!document.querySelector('#reader textarea')`, 'the note box drawn');
    await tap('#reader textarea');
    await cdp('Input.insertText', { text: 'Put the day of each report on the right, as the desk does.' });
    await tap('#reader .dz-change');
    await until(`(() => { try { return document.querySelector('#reader .ui-props').textContent.includes('Changes requested'); } catch { return false; } })()`, 'the answer saved');
    facts.answers = readFileSync(join(dir, 'board.answers.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((a) => `${a.key}=${a.answer}${a.notes?.length ? ` "${a.notes.at(-1).note}"` : ''}`);
    await go(`${base}#designs`);
    await until(`document.querySelector('#item-reports-phone .meta')?.textContent.startsWith('Changes requested')`, 'the row says Changes requested');
    await js(`scrollTo(0, 1e5)`);
    facts.change = await js(`document.querySelector('main').innerText.replace(/\\s+/g, ' ').trim()`);
    await capture('change');
  }
  writeFileSync(join(out, `${name('designs')}.facts.json`), JSON.stringify(facts, null, 2) + '\n');
  writeFileSync(join(out, `measure.${side}.${theme}.${width}w.txt`), report.join('\n') + '\n');
  if (after) writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board with three designs posted through sign-off-axi post --kind design (Today on a phone, Today on a desk in one column or two, the Reports list on a phone), three evidence updates posted with sign-off-axi post --type evidence, the Sign-off project given its own icon, changes asked on Today on a phone with the Up next pick and a note and Today on a desk approved with the two-column pick.',
    steps: [`Open Designs at ${metrics.width}x${metrics.height} (2x), ${theme}, in a headless Chromium of its own, and measure every block in the browser${phone ? ' and the dock' : ' and the sidebar'}.`,
      ...(phone ? ['Tap the Today on a phone row: its review opens; read and measure it, then scroll it to its end.', 'Tap Review full screen: the screen viewer opens over the page.', 'Tap More in the title row and read it.',
        'Open the Reports list design, type a note, tap Change; the board\'s answers file holds it and the list reads Changes requested; scroll the list to its end and measure it against the dock.']
        : ['Click the Today on a desk card: it opens beside where it stands, its pick and answer shown.', 'Click Review full screen: the screen viewer opens over the page.']),
      ...(proto ? [`Capture the approved prototype at the same size and theme (${phone ? 'its Reports list, an open report and the filter sheet, the look Designs follows on a phone, and its Designs address' : 'its Designs, the first and second design open'}) and save each beside the board.`] : [])],
    result: phone
      ? `${theme}, 390px: the dock keeps its five tabs with Decide lit on Designs, Decide's second list on a phone; Designs is drawn in the new look as Reports' list: the title Decide with More and the round light-or-dark button, Asks and Designs with their counts (Designs pressed), a To review card, and the designs as 68px rows in one card, each with a thumbnail of its first screen, its title on one line (cut with an ellipsis when long) and its state and day, or a finished ticket's full bar; a row opens its review with the project and day, the whole title, what it shows, the screen in its device's viewport, Review full screen, Where it stands (state, your pick, when answered) and what you said, then the note with Approve in ink beside Change; Change with a note saves the answer and the row reads Changes requested; More holds Select and Clear all; every block on one gutter, the last row clear of the dock, no control under 44px, no file path or code in the words, no sideways overflow, no console error.`
      : `${theme}, ${metrics.width}px: the sidebar lists Today, Decide, Evidence 3, Reports, Designs 3 (lit) and Tickets, the prototype's places in its order; Designs fills the window as the approved prototype's desk draws it: the crumb, the 32px title and what is on the board, then the designs as picture cards across the top (title, project and day, state) and the open design (its picture filling the card) beside Where it stands (state, your pick, when answered, what you said, what it shows; the newest open shows its pick, as the prototype's does) with the note and Approve in ink beside Change; a card clicked opens that design; every card on the 12-column lines and the 4px grid, no page scroll, under 15% of the window empty, no text cut but a card title past two lines, no words over words, no console error.` }, null, 2) + '\n');
  console.log(report.join('\n'));
  console.log(JSON.stringify(facts, null, 2));
  if (after) assert.deepEqual(problems, [], 'every capture measures clean');
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { cli('stop', board); } catch {}
  await wait(300);
  rmSync(prof, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}
