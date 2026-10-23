// A card's own screen in the new look, as the approved prototype draws an open ask, an open proof and an open report, at one theme and width per run (so a run's steps.json
// holds one claim), driven and measured in a headless Chromium of its own over the DevTools protocol with exact device metrics (390x844, 1280x800 or 1440x900, 2x).
// The board is feel-board.sh's, then through the real CLI: a ticket the ship ask, the settings proof and a guided report belong to, a priority on each, a pull request on the proof,
// the settings project's own icon, and a comment on each so each shows its Activity.
// States at 390: ask (the ship ask's sheet over Decide), ask-end (that sheet scrolled to its end), proof (the settings proof's screen), proof-end, report (the guided report's
// sheet, tapped in the list) and report-end. At 1280 and 1440: decide, evidence and reports (the desk: the head, the list in four columns and the open item in eight), and report-page
// (a page report, its page at the open item's width).
// Each capture is measured in the browser: the property panel's rows (48px or more, Its ask's title in full, a bar only once work has begun), the Activity (each step's words and
// time, none cut), the title in full, no words over other words, no file path or internal code in the words, no sideways overflow, no console error; on a phone the panels on the
// sheet's two 16px edges and no control under 44px; on a desk one screen with no page scroll, the list and the open item on one top and one bottom 24px over the foot, on the
// 12-column lines (4 and 8 with a 16px gutter), the open item's two parts split 3 : 2 with 24px between, an ask's answers pinned in view, every scroll area that holds more than
// it shows fading at its foot, and the empty share of the viewport.
// Usage: node .agents/skills/done-done-verify-sign-off/detail-shots.mjs <output> [light|dark|light,dark] [390|1280|1440]
// DETAIL_PROTO=<the approved prototype's index.html (v3)> captures the prototype at the same size and theme and saves each pair (vs-proto/). SIGN_OFF_REPO names another built
// checkout to drive, such as the base for a before (DETAIL_SIDE=before keeps its measures unasserted).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024;
const side = process.env.DETAIL_SIDE ?? 'after', here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), proto = process.env.DETAIL_PROTO && resolve(process.env.DETAIL_PROTO);
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
const dir = mkdtempSync(join(tmpdir(), 'so-detail-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, env, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const cli = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args]);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const metrics = phone ? { width, height: 844, deviceScaleFactor: 2, mobile: true } : { width, height: width >= 1440 ? 900 : 800, deviceScaleFactor: 2, mobile: false };
const name = (state) => `${state}.${side}.${theme}.${width}w`;

// What the browser measures on an open card: on a phone in its sheet or screen, on a desk the shell around it.
const MEASURE = `(async () => {
  await document.fonts.ready;
  const w = document.documentElement.clientWidth, H = innerHeight, box = (e) => e.getBoundingClientRect(), vis = (e) => { const r = box(e), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const r2 = (n) => Math.round(n * 100) / 100, fail = [], desk = innerWidth >= 1024, onScreen = (e) => { const r = box(e); return r.bottom > 0 && r.top < H; };
  const scope = desk ? document.querySelector('.ui-desk') ?? document.querySelector('main') : ['.ask-sheet', '#reader:not([hidden]) .rp-sheet-body', '#reader:not([hidden]) .ev-scroll', 'main'].map((q) => document.querySelector(q)).find(Boolean);
  const open = desk ? document.querySelector('.split-detail') : scope;
  if (!scope || !open) return { fail: ['nothing open'], dom: { url: location.href, overflow: false, overflowing: [] } };
  const lines = (e) => Math.round(box(e).height / parseFloat(getComputedStyle(e).lineHeight));
  // The title in full: never cut or set on one clipped line.
  const t = open.querySelector('#ask-title, #report-title, #reader-title, h1'), title = t && { text: t.textContent.slice(0, 80), size: getComputedStyle(t).fontSize + '/' + getComputedStyle(t).lineHeight, lines: lines(t),
    cut: t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1 || getComputedStyle(t).textOverflow === 'ellipsis' && t.scrollWidth > t.clientWidth };
  if (!title) fail.push('no title'); else if (title.cut) fail.push('the title is cut');
  // The property panel: each row 48px or more, its value in full where it is a title, a bar only once work has begun.
  const props = [...open.querySelectorAll('.ui-props:not(.ui-act):not(.rp-found):not(.rp-next):not(.rp-parts) > .ui-pr')].filter(vis).map((r) => { const v = r.querySelector('.v'), wt = r.querySelector('.wt'), bar = r.querySelector('.ui-bar i');
    return { name: r.querySelector('.k')?.textContent, value: v?.innerText.replace(/\\s+/g, ' ').trim(), height: r2(box(r).height), cut: !!wt && (wt.scrollWidth > wt.clientWidth + 1 || wt.scrollHeight > wt.clientHeight + 1), bar: bar?.style.width ?? null,
      link: r.tagName === 'A' ? r.getAttribute('href') : null }; });
  props.forEach((p) => { if (p.height < 47.5) fail.push('panel row under 48px ' + p.name + ' ' + p.height); if (p.cut) fail.push('panel value cut ' + p.name); if (p.bar === '0%') fail.push('an empty bar on ' + p.name); });
  // The Activity: one sunk group, each step's words and time on one line with nothing cut.
  const act = [...open.querySelectorAll('.ui-act > li')].map((li) => { const b = li.querySelector('.aw b'), tm = li.querySelector('time'); return { words: b.textContent, time: tm.textContent, note: li.querySelector('.th-n')?.textContent ?? '',
    cut: [b, tm].some((e) => e.scrollWidth > e.clientWidth + 1), height: r2(box(li).height) }; });
  act.forEach((a) => { if (a.cut) fail.push('activity step cut ' + a.words); });
  // No words drawn over other words: the text boxes of the open item and the list do not meet.
  const clear = (e) => { for (let x = e; x; x = x.parentElement) if (getComputedStyle(x).opacity === '0') return true; return false; };
  const texts = []; for (const e of scope.querySelectorAll('*')) { if (!vis(e) || !onScreen(e) || e.closest('iframe, svg, .ui-icon') || clear(e)) continue; for (const n of e.childNodes) { if (n.nodeType !== 3 || !n.data.trim()) continue; const r = document.createRange(); r.selectNodeContents(n);
    // Only words drawn on top count: a line scrolled under a pinned bar is covered, not drawn over.
    for (const b of r.getClientRects()) { const top = b.width > 1 && b.height > 1 && document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); if (top && (top === e || e.contains(top))) texts.push({ el: e, b }); } } }
  const over = []; for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) { const a = texts[i], c = texts[j]; if (a.el === c.el || a.el.contains(c.el) || c.el.contains(a.el)) continue;
    const x = Math.min(a.b.right, c.b.right) - Math.max(a.b.left, c.b.left), y = Math.min(a.b.bottom, c.b.bottom) - Math.max(a.b.top, c.b.top); if (x > 2 && y > 2) over.push(a.el.textContent.slice(0, 24) + ' / ' + c.el.textContent.slice(0, 24)); }
  if (over.length) fail.push('words over words: ' + over.slice(0, 4).join('; '));
  let phoneM, deskM;
  if (!desk) {
    // A phone: the panels on the sheet's two 16px edges; no control under 44px.
    const sb = box(scope), padL = parseFloat(getComputedStyle(scope).paddingLeft), padR = parseFloat(getComputedStyle(scope).paddingRight), edges = [r2(sb.left + padL), r2(sb.right - padR)];
    const panels = scope.matches('.ev-scroll') ? [] : [...open.querySelectorAll(':scope .ui-props')].filter(vis).map((e) => ({ el: e.className, left: r2(box(e).left), right: r2(box(e).right) }));
    panels.forEach((p) => { if (Math.abs(p.left - edges[0]) > 0.5 || Math.abs(p.right - edges[1]) > 0.5) fail.push('panel off the edges ' + JSON.stringify(p) + ' ' + edges); });
    const hit = (e) => { const r = box(e), a = getComputedStyle(e, '::after'), o = (v) => Math.max(0, -parseFloat(v) || 0), wide = a.content !== 'none' && a.position === 'absolute';
      return { top: r.top, bottom: r.bottom, height: r.height + (wide ? o(a.top) + o(a.bottom) : 0), width: r.width + (wide ? o(a.left) + o(a.right) : 0) }; };
    const under = [...scope.querySelectorAll('button, a[href], summary, input, textarea')].filter(vis).filter((e) => !e.closest('.ui-act, iframe')).filter((e) => { const r = hit(e); return r.top < H && r.bottom > 0 && (r.height < 43.5 || r.width < 43.5); })
      .map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24) + ' ' + Math.round(box(e).width) + 'x' + Math.round(box(e).height));
    if (under.length) fail.push('under 44px: ' + under.join(', '));
    phoneM = { edges, panels, under };
  } else {
    // A desk: one screen; the list and the open item on one top and one bottom, on the 12-column lines; the open item's parts 3 : 2; an ask's answers pinned in view;
    // each scroll area that holds more than it shows fading at its foot; the empty share of the viewport.
    const main = document.querySelector('main'), edgeL = box(main).left + parseFloat(getComputedStyle(main).paddingLeft), edgeR = box(main).right - parseFloat(getComputedStyle(main).paddingRight);
    const col = box(document.querySelector('.split-list')), pane = box(open), gut = 16, unit = (edgeR - edgeL - 11 * gut) / 12;
    const cols = { list: [r2(col.left), r2(col.right), r2(col.top), r2(col.bottom)], pane: [r2(pane.left), r2(pane.right), r2(pane.top), r2(pane.bottom)], unit: r2(unit) };
    if (document.documentElement.scrollHeight > H + 1) fail.push('the desk page scrolls');
    if (Math.abs(col.left - edgeL) > 0.5 || Math.abs(col.width - (4 * unit + 3 * gut)) > 0.5) fail.push('the list is not on columns 1 to 4 ' + JSON.stringify(cols));
    if (Math.abs(pane.right - edgeR) > 0.5 || Math.abs(pane.width - (8 * unit + 7 * gut)) > 0.5 || Math.abs(pane.left - col.right - gut) > 0.5) fail.push('the open item is not on columns 5 to 12 ' + JSON.stringify(cols));
    if (Math.abs(col.top - pane.top) > 0.5 || Math.abs(col.bottom - pane.bottom) > 0.5 || Math.abs(pane.bottom - (H - 24)) > 0.5) fail.push('list and open item on different tops or bottoms ' + JSON.stringify(cols));
    const head = document.querySelector('.ui-dhead'), h1 = head?.querySelector('h1'), headM = head && { crumb: head.querySelector('.crumb')?.textContent, title: h1 && getComputedStyle(h1).fontSize + '/' + getComputedStyle(h1).lineHeight,
      sub: head.querySelector('.tx > p:last-child')?.textContent, acts: [...head.querySelectorAll('.acts > *')].filter(vis).map((e) => e.getAttribute('aria-label') || e.textContent), gap: r2(col.top - box(head).bottom) };
    if (!headM || headM.title !== '32px/40px' || headM.gap !== 16) fail.push('the head ' + JSON.stringify(headM));
    // The light-or-dark button sits at the sidebar's foot beside whose board it is, as the prototype draws it, and nowhere in the page's head; the mark is the blue check.
    const me = document.querySelector('.side .me'), sideM = me && { who: me.querySelector('span')?.textContent, theme: !!me.querySelector('.theme') && vis(me.querySelector('.theme')), bottom: r2(H - box(me).bottom),
      logo: getComputedStyle(document.querySelector('.side .logo')).backgroundImage.replace(/\s+/g, ' ') };
    if (!sideM?.who || !sideM.theme) fail.push('the sidebar foot ' + JSON.stringify(sideM));
    if (headM?.acts.some((a) => /light|dark/i.test(a))) fail.push('a light-or-dark button in the head');
    if (!/106, 147, 255.*44, 72, 211/.test(sideM?.logo ?? '')) fail.push('the mark is not the blue check ' + sideM?.logo);
    // The report an ask is about, beside it: what it says, its numbers and Open report.
    const rp = open.querySelector('.ask-rp'), askReport = rp && { says: rp.querySelector('.cx')?.textContent, tiles: [...rp.querySelectorAll('.cxn span')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()), open: rp.querySelector('a.see')?.getAttribute('href') };
    const ps = getComputedStyle(open.matches('.ask2') ? open.querySelector('.pbody') : open), pad = [ps.paddingTop, ps.paddingRight, ps.paddingBottom, ps.paddingLeft].join(' ');
    const parts = [...open.querySelectorAll(':scope > .pmain, :scope > .pside, :scope > .pbody > .pmain, :scope > .pbody > .pside')].filter(vis).map((e) => r2(box(e).width));
    const split2 = parts.length === 2 ? { main: parts[0], side: parts[1], ratio: r2(parts[0] / parts[1]) } : { one: parts[0] ?? null };
    if (split2.ratio && Math.abs(split2.ratio - 1.5) > 0.02) fail.push('the open item is not split 3 : 2 ' + JSON.stringify(split2));
    const pin = open.querySelector('.ppin'), pinM = pin && (() => { const p = box(pin), cards = [...pin.querySelectorAll('.pick-option')].map((c) => r2(box(c).width)), line = [...pin.querySelectorAll('.decide-bar > *')].filter(vis).map((e) => ({ what: e.className.split(' ')[0], top: r2(box(e).top), height: r2(box(e).height) }));
      return { top: r2(p.top), bottom: r2(p.bottom), inView: p.top >= 0 && p.bottom <= H - 24 + 0.5, cards, line }; })();
    if (pinM && !pinM.inView) fail.push('the answers are not in view');
    if (pinM?.cards.some((x) => x < 159.5)) fail.push('an answer card under 160px ' + pinM.cards);
    if (pinM && (new Set(pinM.line.map((x) => x.top)).size > 1 || pinM.line.some((x) => Math.abs(x.height - 48) > 0.5))) fail.push('the note, Ask me later and Answer are not one 48px line ' + JSON.stringify(pinM.line));
    const areas = [...document.querySelectorAll('.ui-desk :is(.ui-col, .ui-pane:not(.ask2), .ask2 > .pbody)')].map((a) => ({ el: a.className.split(' ').find((c) => /ui-col|ui-pane|pbody/.test(c)), more: a.scrollHeight > a.clientHeight + 1, fades: a.classList.contains('fades') && !a.classList.contains('at-end') }));
    areas.forEach((a) => { if (a.more && !a.fades) fail.push(a.el + ' holds more than it shows with no fade'); });
    // The empty share, as the prototype's check counts it: viewport points every 4px outside the sidebar, the head and each card, a card counted down to its last content.
    const content = [...document.querySelectorAll('nav.side, .ui-dhead, .split-list .ui-card, .split-list .ui-sec, .split-list > * > :not(.ui-card):not(.ui-sec), .split-detail')].filter(vis).map((e) => { const q = box(e); let last = q.top;
      for (const d of e.querySelectorAll('*')) { const z = box(d); if (z.width && z.height) last = Math.max(last, Math.min(z.bottom, q.bottom)); }
      return { left: q.left, top: q.top, right: q.right, bottom: e.matches('.ui-card') ? Math.min(q.bottom, last + parseFloat(getComputedStyle(e).paddingBottom) + 4) : q.bottom }; });
    let all = 0, empty = 0; for (let py = 2; py < H; py += 4) for (let px = 2; px < innerWidth; px += 4) { all++; if (!content.some((b) => px >= b.left && px < b.right && py >= b.top && py < b.bottom)) empty++; }
    deskM = { cols, head: headM, side: sideM, askReport, pad, split: split2, pin: pinM, areas, emptyShare: r2((empty / all) * 100) };
    // The rule holds a board in use to it: while a scroll area holds more than it shows, at most 15% may be empty. A board with a few cards leaves room under its list, and is reported.
    if (deskM.emptyShare > 15 && areas.some((a) => a.more && a.el === 'ui-col')) fail.push('empty share ' + deskM.emptyShare + '%');
  }
  // Words a user reads: no file path, no internal code (a ticket or message id, a run id), no raw key.
  const words = scope.innerText, bad = words.match(/(?:^|\\s)(?:[\\w.-]+\\/)+[\\w.-]+\\.(?:md|json|html|png|txt)\\b|\\b[A-Z][a-z]+\\d{3,}\\b|\\b\\d{8}T\\d{6}Z\\b|\\b(?:fm|msg)-[\\w-]{6,}|\\bT-\\d+\\b|\\bsettings-publish\\b|\\bsign-in-faster\\b/g) ?? [];
  if (bad.length) fail.push('raw words: ' + bad.join(', '));
  const overflowing = [...document.querySelectorAll('body *')].filter((e) => vis(e) && box(e).right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + '.' + (e.classList[0] ?? ''));
  if (document.documentElement.scrollWidth > w) fail.push('sideways overflow ' + overflowing.join(' '));
  return { viewport: innerWidth + 'x' + innerHeight, title, props, act, phone: phoneM, desk: deskM, fail, words: words.replace(/\\s+/g, ' ').trim().slice(0, 1400),
    dom: { url: location.href, overflow: document.documentElement.scrollWidth > w, overflowing } };
})()`;

const prof = mkdtempSync(join(tmpdir(), 'so-detail-chrome-'));
// A desk runs with the classic scrollbars a Linux or Windows viewer has, so a scrollbar taking room would show; a phone's are overlays.
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', ...(phone ? ['--hide-scrollbars'] : []), 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let ws;
const errors = [], failed = [], report = [], problems = [], shots = [];
try {
  const url = sh('bash', [join(here, '.agents/skills/done-done-verify-sign-off/feel-board.sh'), dir], { cwd: repo }).trim().split('\n').pop();
  // A ticket the ship ask, the settings proof and a guided report belong to; the digest ask's own, not started.
  cli('ticket', board, '--id', 'settings-publish', '--title', 'Publish the settings page to the app stores', '--progress', '56', '--priority', 'P1', '--project', 'settings', '--asked', 'yes');
  cli('ticket', board, '--id', 'digest-monday', '--title', 'Send the weekly digest on Mondays', '--project', 'newsletter', '--asked', 'yes');
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z'), guided = JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v4/valid-full.json'), 'utf8'));
  // Its picture with four rows, so the ask about it shows four of its numbers as the prototype does.
  const visual = { ...guided.visual, rows: [...guided.visual.rows, { label: 'Code step', value: 1.1, note: 'after' }, { label: 'Password step', value: 0.7, note: 'after' }] };
  writeFileSync(join(dir, 'guided.json'), JSON.stringify({ ...guided, visual, ticket: 'settings-publish', group: 'Settings', filed: now, priority: 'P1' }));
  cli('post', board, '--kind', 'report', '--from', join(dir, 'guided.json'));
  const b = JSON.parse(readFileSync(board, 'utf8'));
  const set = { ship: { ticket: 'settings-publish', priority: 'P1', report: guided.key }, ev1: { ticket: 'settings-publish', priority: 'P1', link: 'https://github.com/example/settings/pull/176' }, digest: { ticket: 'digest-monday' } };
  for (const d of b.items) if (set[d.key]) Object.assign(d, set[d.key]);
  writeFileSync(board, JSON.stringify(b, null, 2) + '\n');
  writeFileSync(join(dir, 'settings.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#E8590C"/><circle cx="12" cy="12" r="3" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 4.5v3M12 16.5v3M4.5 12h3M16.5 12h3" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>');
  cli('project', board, '--name', 'settings', '--icon', 'settings.svg');
  // A comment on each, so each has its Activity, and one part of the guided report read.
  const post = (path, body) => fetch(new URL(path, url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => assert.ok(r.ok, `${path} ${r.status}`));
  await wait(1100);
  for (const [key, text] of [['ship', 'Support is fully staffed that day, so Friday works.'], ['ev1', 'Fast on my phone too.'], [guided.key, 'Send me the tablet numbers when you have them.']]) await post('api/messages', { kind: 'comment', key, text });
  await post('api/reads', { key: guided.key, part: 'this' });

  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium opened its DevTools port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
    if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push(x.params.args.map((a) => a.value ?? a.description).join(' '));
    if (x.method === 'Network.responseReceived' && x.params.response.status >= 400 && !x.params.response.url.startsWith('file:')) failed.push({ url: x.params.response.url, status: x.params.response.status }); };
  const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  const js = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, `${expression.slice(0, 80)}: ${r.exceptionDetails?.exception?.description}`); return r.result.value; };
  const until = async (expression, what) => { for (let i = 0; i < 60; i++) { if (await js(expression)) return; await wait(100); } assert.fail(`timed out: ${what}${errors.length ? `; page errors: ${errors.join(' | ')}` : ''}`); };
  // A real tap or click, as a finger or mouse sends it: on its middle line, near its start (a row's hover actions sit at its end).
  const tap = async (sel) => { const [x, y] = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return [r.left + Math.min(r.width / 2, 80), r.top + r.height / 2]; })()`);
    if (phone) { await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else { for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); } };
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  const setup = async () => { await cdp('Emulation.setDeviceMetricsOverride', metrics); await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }); };
  await setup();
  const png = async (file) => writeFileSync(file, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const go = async (address, ms = 1200) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: address }); await wait(ms); };
  const capture = async (state) => {
    // The pointer rests off the page, so a row's hover actions are not caught in the still.
    if (!phone) await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: metrics.height - 1 });
    await wait(600);
    await png(join(out, `${name(state)}.png`)); shots.push(`${name(state)}.png`);
    const m = await js(MEASURE);
    writeFileSync(join(out, `${name(state)}.dom.json`), JSON.stringify({ ...m.dom, console_errors: [...errors], failed_requests: [...failed] }, null, 2) + '\n');
    delete m.dom;
    writeFileSync(join(out, `${name(state)}.measure.json`), JSON.stringify(m, null, 2) + '\n');
    report.push(`${name(state)}: title ${m.title?.size} ${m.title?.lines} lines; panel ${m.props.map((p) => `${p.name} ${p.height}px${p.bar ? ' bar ' + p.bar : ''}`).join(' | ')}; activity ${m.act.length} steps`
      + `${m.phone ? `; edges ${m.phone.edges}; under 44px ${m.phone.under.length}` : ''}`
      + `${m.desk ? `; list ${m.desk.cols.list} open ${m.desk.cols.pane}; split ${JSON.stringify(m.desk.split)}; pad ${m.desk.pad}${m.desk.pin ? `; answers ${m.desk.pin.top}-${m.desk.pin.bottom} in view ${m.desk.pin.inView}, cards ${m.desk.pin.cards}` : ''}; fades ${m.desk.areas.map((a) => `${a.el} ${a.more ? (a.fades ? 'fades' : 'NO FADE') : 'fits'}`).join(', ')}; empty ${m.desk.emptyShare}%` : ''}`
      + `; failures ${m.fail.length}${m.fail.length ? ': ' + m.fail.join('; ') : ''}`);
    if ([m.fail, errors, failed].some((x) => x.length)) problems.push(`${name(state)}: ${JSON.stringify({ fail: m.fail, errors, failed })}`);
    errors.length = 0; failed.length = 0;
    return m;
  };
  // The prototype's own state at the same size and theme: its screen by its address, then on a phone its first row of that kind tapped open (act names it).
  const pair = async (state, hash, act) => {
    if (!proto) return;
    await go(`file://${proto}#${hash}&theme=${theme}`, 1400);
    if (act) { await js(`document.querySelector('.row[data-act="${act}"]').click()`); await wait(900); }
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
  const read = () => js(`(() => { const o = document.querySelector('.split-detail, .ask-sheet, #reader:not([hidden])'); return { hash: location.hash, head: document.querySelector('.ui-dhead .tx')?.innerText.replace(/\\s+/g, ' ').trim() ?? null,
    open: o ? o.innerText.replace(/\\s+/g, ' ').trim().slice(0, 1000) : null }; })()`);
  const scrollEnd = (sel) => js(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.scrollTo(0, 1e6); return Math.round(s.scrollTop); })()`);
  if (phone) {
    // An ask: its row tapped in Decide rises as a sheet over the list.
    await go(url + '#waiting');
    await until(`!!document.querySelector('.dl-row[data-key="ship"] .dl-face')`, 'Decide listed');
    await tap('.dl-row[data-key="ship"] .dl-face');
    await until(`location.hash === '#decide/ship' && !!document.querySelector('.ask-sheet #ask-title')`, 'the ask open');
    facts.ask = await read();
    await capture('ask'); await pair('ask', 'v=decide', 'ask');
    await go(url + '#decide/ship'); await until(`!!document.querySelector('.ask-sheet')`, 'the ask again');
    facts.askEnd = await scrollEnd('.ask-sheet'); await capture('ask-end');
    // A proof: its screen.
    await go(url + '#evidence/ev1');
    await until(`!!document.querySelector('#reader:not([hidden]) .ev-title')`, 'the proof open');
    facts.proof = await read();
    await capture('proof'); await pair('proof', 'v=evidence', 'proof');
    await go(url + '#evidence/ev1'); await until(`!!document.querySelector('#reader:not([hidden]) .ev-title')`, 'the proof again');
    facts.proofEnd = await scrollEnd('#reader .ev-scroll'); await capture('proof-end');
    // A report: the guided report's row tapped in Reports opens its sheet with its parts.
    await go(url + '#reports');
    await until(`!!document.querySelector('.rp-list a[data-row][href="#reports/${guided.key}"]')`, 'Reports listed');
    await tap(`.rp-list a[data-row][href="#reports/${guided.key}"]`);
    await until(`!!document.querySelector('#reader.rp-sheet .rp-sheet-body #reader-title')`, 'the report open');
    facts.report = await read();
    await capture('report'); await pair('report', 'v=reports', 'report');
    await go(url + '#reports'); await until(`!!document.querySelector('.rp-list a[data-row][href="#reports/${guided.key}"]')`, 'Reports listed again');
    await tap(`.rp-list a[data-row][href="#reports/${guided.key}"]`); await until(`!!document.querySelector('#reader.rp-sheet .rp-sheet-body #reader-title')`, 'the report again');
    facts.reportEnd = await scrollEnd('#reader .rp-sheet-body'); await capture('report-end');
  } else {
    await go(url + '#decide/ship');
    await until(`!!document.querySelector('.split-detail #ask-title')`, 'the ask open on the desk');
    facts.decide = await read();
    const shown = await capture('decide');
    // The ask names the guided report (its --report): Its report beside it with what the report says, its numbers and Open report.
    if (!(shown.desk.askReport?.tiles.length >= 2 && shown.desk.askReport.open === `#reports/${guided.key}`)) problems.push(`decide: Its report ${JSON.stringify(shown.desk.askReport)}`);
    // Picking an answer names it on the button, beside Ask me later, with the answers still in view.
    await js(`document.querySelectorAll('.split-detail .pick-option')[1].click()`);
    facts.picked = await js(`document.querySelector('.split-detail .decide-bar .answer').textContent + ' | disabled ' + document.querySelector('.split-detail .decide-bar .answer').disabled`);
    await pair('decide', 'v=decide');
    await go(url + '#evidence/ev1');
    await until(`!!document.querySelector('.split-detail .ev-title')`, 'the proof open on the desk');
    facts.evidence = await read();
    await capture('evidence'); await pair('evidence', 'v=evidence');
    // A guided report clicked in the list opens beside it (reached by its address it opens in full over the board).
    await go(url + '#reports', 1600);
    await until(`!!document.querySelector('.rp-list a[data-row][href="#reports/${guided.key}"]')`, 'Reports listed on the desk');
    await tap(`.rp-list a[data-row][href="#reports/${guided.key}"]`);
    await until(`location.hash === '#reports/${guided.key}' && !!document.querySelector('.split-detail #report-title') && document.getElementById('reader').hidden`, 'the guided report open on the desk');
    facts.reports = await read();
    await capture('reports');
    await tap('.rp-list a[data-row][href="#reports/new-sign-in"]'); await wait(2200);
    await until(`!!document.querySelector('.split-detail .read iframe')`, 'the page report open on the desk');
    facts.reportPage = await read();
    await capture('report-page');
    await pair('reports', 'v=reports');
  }
  facts.answers = cli('answers', board).slice(0, 600);
  writeFileSync(join(out, `${name('detail')}.facts.json`), JSON.stringify(facts, null, 2) + '\n');
  writeFileSync(join(out, `measure.${side}.${theme}.${width}w.txt`), report.join('\n') + '\n');
  if (side === 'after') writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board (feel-board.sh) plus, through sign-off-axi: a ticket (Publish the settings page to the app stores, 56% done) that the ship ask, the settings proof and a guided report belong to, the ship ask about that report, a P1 priority on each, a pull request on the proof, the settings project\'s own icon, and a comment on each.',
    steps: phone ? [`Open Decide at ${metrics.width}x${metrics.height} (2x), ${theme}, in a headless Chromium of its own, tap the ship ask's row and measure its sheet in the browser; scroll the sheet to its end and measure it.`,
      'Open the settings proof\'s screen and measure it; scroll it to its end and measure it.', 'Open Reports, tap the guided report\'s row and measure its sheet; scroll it to its end and measure it.',
      ...(proto ? ['Capture the approved prototype\'s open ask, open proof and open report at the same size and theme and save each pair.'] : [])]
      : [`Open the ship ask on a desk at ${metrics.width}x${metrics.height} (2x), ${theme}, in a headless Chromium of its own and measure the shell and the open ask in the browser; pick an answer and read the button.`,
        'Open the settings proof on the desk and measure it.', 'Open the guided report on the desk and measure it; open the page report and measure it.',
        ...(proto ? ['Capture the approved prototype\'s Decide, Evidence and Reports desk at the same size and theme and save each pair.'] : [])],
    result: `${theme}, ${metrics.width}px: ${phone ? 'an open ask, proof and report each show their title in full, then one property panel (Priority, Its ask with its title in full and its bar and percent, the pull request on the proof) on the sheet\'s two 16px edges, and the Activity as one panel of plain steps with their times; no control is under 44px'
      : 'Decide, Evidence and Reports each fill one screen as the approved prototype draws the desk: the sidebar with the blue check and, at its foot, whose board it is with the light-or-dark button; the head (where you are, the 32px title, one line of what it holds, the order at its right) 16px over the list in columns 1 to 4 and the open item in columns 5 to 12, on one top and one bottom 24px over the foot; the open item splits 3 : 2 (the ask and what it carries beside Its report, with what the report says, its numbers and Open report, and its Activity; the proof\'s capture beside done-done\'s word, what it proves and the verdict; a guided report\'s key points beside its parts, next step, ticket and Activity), an ask\'s answers are pinned in view as cards side by side over the note, Ask me later and Answer, and each area that holds more than it shows fades at its foot'}; no words over other words, no file path or code in the words, no sideways overflow, no console error.` }, null, 2) + '\n');
  console.log(report.join('\n'));
  if (side === 'after') assert.deepEqual(problems, [], 'every capture measures clean');
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { cli('stop', board); } catch {}
  await wait(300);
  rmSync(prof, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}
