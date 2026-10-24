// Evidence in the new look (list and one proof), on the approved prototype's own proof rows: a throwaway board is filled with the prototype's 40 newest proofs
// (their titles, done-done's line, captures, projects and project icons, priorities and tickets), the day's earlier proofs to fill Held up today, and served
// with no evidence root as the fleet's board is. Each state is captured at 390x844 (2x) in light and dark over the DevTools protocol with exact device metrics
// (a headless Chromium of its own) and measured in the browser: one left and right edge, the 4px grid, 68px rows with 40px tiles, the priority chip and the
// percent on one right edge, square dots on the grid, the last row clear of the dock, the proof's sheet 48px down with its whole title, its verdicts on one row,
// no picture or close on a row, the proof's Close above its captures and over none, no file path in what the owner reads, no control under 44px and no sideways overflow. The desk (1280x800) is captured too, to show it still works.
// Usage: node .agents/skills/done-done-verify-sign-off/evidence-shots.mjs <output> <prototype index.html>
// Each phone state is also captured from the prototype at the same size and theme and saved beside the board's (vs-proto/<state>.<theme>.390w.pair.png).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), proto = resolve(process.argv[3] ?? process.env.EVIDENCE_PROTO ?? '');
assert.ok(existsSync(proto), 'the approved prototype\'s index.html is the second argument (or EVIDENCE_PROTO)');
const repo = resolve('.');
mkdirSync(join(out, 'vs-proto'), { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-ev-')), board = join(dir, 'board.json');
// The board's folder goes however the run ends, a seed that fails included.
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'done-done' };
const sh = (args) => { const r = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120000, env }); assert.equal(r.status, 0, args.join(' ') + '\n' + r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);

// The prototype's data, as its page carries it: the proof rows, today's verdicts in the order filed, and the project icons.
const page = readFileSync(proto, 'utf8'), constant = (name) => { const i = page.indexOf(`const ${name} = `), j = page.indexOf('\nconst ', i + 1); return JSON.parse(page.slice(i + name.length + 9, j).trim().replace(/;$/, '')); };
const D = constant('D'), TP = constant('TP'), ICONS = constant('ICONS'), ALIAS = { muxr: 'pockit', writeboost: 'ownvoice', 'done-done-axi': 'done-done' };
const rows = [...D.evidence.rows].sort((x, y) => Date.parse(x.filed) - Date.parse(y.filed));
const today = (iso) => { const t = new Date(iso), n = new Date(); n.setUTCHours(t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds(), 0); return n.toISOString().replace(/\.\d+Z$/, 'Z'); };
const SAID = { held: 'done-done checked the proof and it holds up: ', 'not confirmed': 'done-done could not confirm the proof: ' };
const post = (msg, name) => { writeFileSync(join(dir, `${name}.json`), JSON.stringify({ contract: 1, kind: 'evidence', schema: 1, filer: 'done-done', ...msg })); sh(['post', board, '--kind', 'evidence', '--from', join(dir, `${name}.json`)]); };
// A run names the proof's project in its check line (done-done-verify-<project>: ...), as the fleet's proofs do; with no evidence root it is not checked.
const runOf = (key, outcome, project) => ({ run_id: `20261023T000000Z-${key.length.toString(16).padStart(8, '0')}`, commit: '0'.repeat(40), outcome, repro: 'repro: n/a: no bug',
  proof: project ? `done-done-verify-${project}: sealed receipt` : 'done-done: sealed receipt', evidence: 'receipt.json' });
const filed = new Map(), tickets = new Map();
// The day's earlier proofs (the prototype counts 189 today), each with its verdict from the prototype's sequence, filed a minute apart before its rows.
const earlier = [...TP.seq].slice(0, Math.max(0, TP.seq.length - rows.length)), first = Date.parse(today(rows[0].filed));
earlier.forEach((c, i) => {
  const key = `earlier-${i + 1}`;
  post({ key, title: `An earlier proof of the day, ${i + 1}`, about: `${{ h: SAID.held, x: SAID['not confirmed'] }[c] ?? ''}The proof filed earlier today.`, run: runOf(key, 'The proof filed earlier today.') }, key);
  filed.set(key, new Date(first - (earlier.length - i) * 60000).toISOString().replace(/\.\d+Z$/, 'Z'));
});
for (const r of rows) {
  const ticket = r.ask && (tickets.get(r.ask.title) ?? `T-${tickets.size + 1}`);
  if (ticket && !tickets.has(r.ask.title)) { tickets.set(r.ask.title, ticket); sh(['ticket', board, '--id', ticket, '--title', r.ask.title, '--progress', String(r.ask.pct)]); }
  const media = r.capture ? [`${r.key}.jpg`] : undefined;
  if (media) writeFileSync(join(dir, media[0]), Buffer.from(r.capture.split(',')[1], 'base64'));
  const about = (r.about || 'No note.').slice(0, 500);
  post({ key: r.key, title: r.title.slice(0, 160), about, ...(/^https?:\/\/\S+$/.test(r.link ?? '') && { link: r.link }), ...(media && { media }), run: runOf(r.key, r.title.slice(0, 160), r.project),
    ...(ticket && { ticket }), ...(r.priority != null && { priority: `P${r.priority}` }) }, r.key);
  filed.set(r.key, today(r.filed));
}
// The earlier proofs count in Held up today but are archived, so the list, its filter and its counts hold the prototype's rows alone.
for (let i = 1; i <= earlier.length; i++) sh(['dismiss', `earlier-${i}`, board]);
// Each project's own icon, as the prototype draws it (a sprite crop is left to its initials).
mkdirSync(join(dir, 'icons'));
for (const name of new Set(rows.map((r) => r.project).filter(Boolean))) {
  const ic = ICONS[ALIAS[name] ?? name];
  if (!ic || ic.crop) continue;
  const [, type, data] = /^data:image\/(png|svg\+xml|jpeg);base64,(.*)$/.exec(ic.src) ?? [];
  if (!type) continue;
  const file = `icons/${name}.${type === 'svg+xml' ? 'svg' : type === 'jpeg' ? 'jpg' : type}`;
  writeFileSync(join(dir, file), Buffer.from(data, 'base64'));
  sh(['project', board, '--name', name, '--icon', file]);
}
// The board stamps each post as it lands; the prototype's proofs keep the time of day they were filed, today.
const doc = JSON.parse(readFileSync(board, 'utf8'));
for (const d of doc.items) if (filed.has(d.key)) d.filed = filed.get(d.key);
writeFileSync(board, JSON.stringify(doc, null, 2));

const MEASURE = `(async () => {
  await document.fonts.ready;
  const w = document.documentElement.clientWidth, phone = innerWidth < 1024, box = (e) => e.getBoundingClientRect(), vis = (e) => { const r = box(e), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const r4 = (n) => Math.round(n * 100) / 100, grid = (n) => Math.abs(n / 4 - Math.round(n / 4)) < 0.02, fail = [], blocks = [], sy = scrollY;
  const main = document.querySelector('.split-list') ?? document.querySelector('main'), edgeL = box(main).left + main.clientLeft + parseFloat(getComputedStyle(main).paddingLeft), edgeR = box(main).left + main.clientLeft + main.clientWidth - parseFloat(getComputedStyle(main).paddingRight);
  for (const e of document.querySelectorAll('main .ui-top, main .ui-seg, main .ui-sec, main .ui-card')) if (vis(e)) { const r = box(e); blocks.push({ el: e.className, left: r4(r.left), right: r4(r.right), top: r4(r.top + sy), height: r4(r.height) }); }
  for (const b of blocks) {
    if (Math.abs(b.left - edgeL) > 0.5) fail.push('left edge ' + b.el + ' ' + b.left + ' not ' + edgeL);
    if (/ui-(card|seg)/.test(b.el) && Math.abs(b.right - edgeR) > 0.5) fail.push('right edge ' + b.el + ' ' + b.right + ' not ' + edgeR);
    if (!(grid(b.top) && grid(b.height))) fail.push('off the 4px grid ' + b.el + ' top ' + b.top + ' height ' + b.height);
  }
  const rows = [...document.querySelectorAll('main .ev-card')].filter(vis).map((e) => { const r = box(e), t = box(e.querySelector('.ui-icon')), title = box(e.querySelector('.t')), card = box(e.closest('.ui-card')), chip = e.querySelector('.ui-pc'), pct = e.querySelector('.pct');
    return { id: e.id, height: r4(r.height), tile: r4(t.width) + 'x' + r4(t.height), tileIn: r4(t.left - card.left), titleGap: r4(title.left - t.right), rightIn: r4(card.right - box(e.querySelector('.rm')).right),
      chipIn: chip ? r4(card.right - box(chip).right) : null, pctIn: pct ? r4(card.right - box(pct).right) : null, chip: chip?.textContent ?? '', line2: (e.querySelector('.l2').textContent || '').trim(), check: e.querySelector('.ev-ok')?.className ?? '' }; });
  const onRows = [...document.querySelectorAll('main .ev-list :is(img:not(.ui-icon img), video, .x, .ev-x, [aria-label=Close])')].filter(vis).length;
  if (onRows) fail.push(onRows + ' pictures or closes on the rows');
  rows.forEach((x) => { if ((phone ? x.height !== 68 : x.height < 68) || x.tile !== '40x40' || x.tileIn !== 12 || x.titleGap !== 12 || x.rightIn !== 12 || (x.chipIn !== null && x.chipIn !== 12) || (x.pctIn !== null && x.pctIn !== 12)) fail.push('row ' + JSON.stringify(x)); });
  const dots = document.querySelector('.ev-dots'), dot = dots && [...dots.children].map(box);
  const held = dots ? { box: r4(box(dots).width) + 'x' + r4(box(dots).height), cells: dot.length, cell: r4(dot[0].width) + 'x' + r4(dot[0].height), ink: dots.querySelectorAll('.held').length, red: dots.querySelectorAll('.not').length, columns: getComputedStyle(dots).getPropertyValue('--cols'),
    right: r4(box(dots).right - Math.max(...dot.map((d) => d.right))), words: document.querySelector('.ev-held').innerText.replace(/\\s+/g, ' ').trim() } : null;
  if (held && (Math.abs(dot[0].width - dot[0].height) > 0.05 || !grid(box(dots).height) || held.right > 0.5)) fail.push('dots ' + JSON.stringify(held));
  const tabs = document.querySelector('.tabs'), last = [...document.querySelectorAll('main .ev-card')].filter(vis).pop();
  const dock = phone && tabs && vis(tabs) ? { top: r4(box(tabs).top), lastRowBottom: last ? r4(box(last).bottom) : null } : null;
  // At the scroll end the last row and the Archived row clear the dock (measured with the page scrolled to its end, then put back).
  const open = !document.getElementById('reader')?.hidden || document.getElementById('sheet')?.open;
  const end = dock && !open && last ? (() => { const y = scrollY; scrollTo(0, document.documentElement.scrollHeight); const fold = document.querySelector('main .gone-asks > summary');
    const r = { dockTop: r4(box(tabs).top), dockBottom: r4(box(tabs).bottom), lastRowBottom: r4(box(last).bottom), archivedBottom: fold ? r4(box(fold).bottom) : null }; scrollTo(0, y); return r; })() : null;
  if (end && (end.lastRowBottom > end.dockTop || (end.archivedBottom ?? 0) > end.dockTop)) fail.push('under the dock at the scroll end ' + JSON.stringify(end));
  // The light or dark button in the title row: a moon on a light page, a sun on a dark one.
  const tb = document.querySelector('main .ev-top .ui-rb[aria-label^=Switch]'), canvas = getComputedStyle(document.documentElement).getPropertyValue('--tk-canvas').trim().toLowerCase();
  const theme = document.querySelector('main .ev-top') ? { button: !!tb && r4(box(tb).width) + 'x' + r4(box(tb).height), icon: tb?.querySelector('path, circle') && (tb.querySelector('circle') ? 'sun' : 'moon'), page: canvas === '#131210' ? 'dark' : 'light' } : null;
  if (theme && (theme.button !== '40x40' || theme.icon !== (theme.page === 'dark' ? 'sun' : 'moon'))) fail.push('theme button ' + JSON.stringify(theme));
  const reader = document.getElementById('reader'), sheet = reader && !reader.hidden && reader.querySelector('.ev-scroll') ? (() => { const r = box(reader), t = document.querySelector('.ev-title'), v = [...document.querySelectorAll('.ev-verdict .choices button')];
    return { top: r4(r.top), title: t.textContent, titleLines: Math.round(box(t).height / parseFloat(getComputedStyle(t).lineHeight)), titleWhole: t.scrollHeight <= t.clientHeight + 1 && getComputedStyle(t).webkitLineClamp === 'none',
      verdicts: v.map((b) => b.textContent), verdictRows: new Set(v.map((b) => Math.round(box(b).top))).size, props: [...document.querySelectorAll('.ev-props .ui-pr')].map((p) => p.innerText.replace(/\\s+/g, ' ').trim()),
      activity: [...document.querySelectorAll('.ev-item .th-list li')].map((l) => l.innerText.replace(/\\s+/g, ' ').trim()), close: (() => { const x = reader.querySelector('.ev-x'), shots = [...reader.querySelectorAll('.ev-hero :is(img, video)')].map(box);
        if (!x || !vis(x)) return null; const c = box(x); return { bottom: r4(c.bottom), firstCapture: shots.length ? r4(Math.min(...shots.map((s) => s.top))) : null, over: shots.filter((s) => c.left < s.right && s.left < c.right && c.top < s.bottom && s.top < c.bottom).length }; })() }; })() : null;
  if (sheet?.close && (sheet.close.over || (sheet.close.firstCapture !== null && sheet.close.bottom > sheet.close.firstCapture))) fail.push('the close over a capture ' + JSON.stringify(sheet.close));
  if (sheet && phone && (sheet.top !== 48 || !sheet.titleWhole || (sheet.verdicts.length && sheet.verdictRows !== 1))) fail.push('sheet ' + JSON.stringify(sheet));
  const words = document.body.innerText, paths = words.match(/(?:~|\\/home)\\/\\S+|\\b[\\w.-]+\\/[\\w./-]+\\.(?:md|json|mjs|sh|ts|html)\\b/g) ?? [];
  if (paths.length) fail.push('a file path shows: ' + paths.slice(0, 3).join(', '));
  const hit = (e) => { const r = box(e), a = getComputedStyle(e, '::after'), o = (v) => Math.max(0, -parseFloat(v) || 0), wide = a.content !== 'none' && a.position === 'absolute';
    return { top: r.top, bottom: r.bottom, height: r.height + (wide ? o(a.top) + o(a.bottom) : 0), width: r.width + (wide ? o(a.left) + o(a.right) : 0) }; };
  const scope = sheet ? reader : document.getElementById('sheet')?.open ? document.getElementById('sheet') : document;
  const under = phone ? [...scope.querySelectorAll('button, a[href], summary, select, input, textarea')].filter(vis).filter((e) => { const r = hit(e); return r.top < innerHeight && r.bottom > 0 && (r.height < 43.5 || r.width < 43.5); })
    .map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24) + ' ' + Math.round(box(e).width) + 'x' + Math.round(box(e).height)) : [];
  const overflowing = [...document.querySelectorAll('body *')].filter((e) => box(e).right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : ''));
  const ctx = document.createElement('canvas').getContext('2d'), squashed = [];
  for (const e of document.querySelectorAll('body *')) { const nodes = [...e.childNodes].filter((n) => n.nodeType === 3 && n.data.trim()); const text = nodes.map((n) => n.data).join(' ').replace(/\\s+/g, ' ').trim(); const s = getComputedStyle(e); const ew = e.offsetWidth; const eh = e.offsetHeight; if (!(e instanceof HTMLElement) || !text || !e.getClientRects().length || ((ew <= 1 || eh <= 1) && s.overflow !== 'visible') || s.visibility !== 'visible') continue; ctx.font = s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily; const chars = ew / (ctx.measureText('abcdefghijklmnopqrstuvwxyz').width / 26); const ws = text.split(' ').length; const tops = new Set(); for (const n of nodes) { const rg = document.createRange(); rg.selectNodeContents(n); for (const b of rg.getClientRects()) if (b.width) tops.add(Math.round(b.top)); } if ((chars < 8 && ctx.measureText(text).width > ew + 1) || tops.size > ws) squashed.push({ element: e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.classList[0] ? '.' + e.classList[0] : ''), text: text.slice(0, 40), chars: Math.round(chars * 10) / 10, lines: tops.size, words: ws }); }
  return { viewport: innerWidth + 'x' + innerHeight, edges: [r4(edgeL), r4(edgeR)], blocks, rows, held, dock, end, theme, sheet, under, fail, inter: document.fonts.check('14px Inter'),
    dom: { url: location.href, overflow: document.documentElement.scrollWidth > w, overflowing, squashed_text: squashed } };
})()`;

const prof = mkdtempSync(join(tmpdir(), 'so-ev-chrome-'));
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let ws, log = '';
server.stdout.on('data', (b) => (log += b)); server.stderr.on('data', (b) => (log += b));
const errors = [], failed = [], report = [], problems = [];
try {
  let url; for (let i = 0; i < 100 && !url; i++) { await wait(100); url = /http:\/\/127\.0\.0\.1:\d+\//.exec(log)?.[0]; }
  assert.ok(url, `the board served: ${log}`);
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
  const go = async (address, ms = 1500) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: address }); await wait(ms); };
  const js = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, `${expression.slice(0, 80)}: ${r.exceptionDetails?.exception?.description}`); await wait(500); return r.result.value; };
  const pickProject = (name) => js(`(async () => { document.querySelector('.ev-fb').click(); await new Promise((r) => setTimeout(r, 300)); [...document.querySelectorAll('#sheet .ev-pick button')].find((b) => b.querySelector('.pn').textContent === ${JSON.stringify(name)}).click(); })()`);
  const takeone = 'merge-umeranjum17-takeone-pull-176';
  // Each state: its name, what it shows, the board's address, what to do there, and the prototype's address for the same state (none: a state the prototype has no frame of).
  const STATES = [
    ['evidence', 'Evidence, newest first', '#evidence', '', 'v=evidence'],
    ['evidence-priority', 'Evidence, by priority', '#evidence', "document.querySelector('.ev-seg button:nth-child(2)').click()", 'v=evidence&esort=prio'],
    ['filter', 'Evidence, the project filter', '#evidence', "document.querySelector('.ev-fb').click()", 'v=evidence&fs'],
    ['evidence-crewhouse', 'Evidence, one project', '#evidence', 'crewhouse', 'v=evidence&eproj=crewhouse'],
    ['evidence-toggled', 'Evidence, the other theme picked with the light or dark button', '#evidence', "document.querySelector('.ev-top .ui-rb[aria-label^=Switch]').click()", 'v=evidence&theme=OTHER'],
    ['evidence-all', 'Evidence, See all, at its end', '#evidence', "(async () => { document.querySelector('.ev-sec .see').click(); await new Promise((r) => setTimeout(r, 300)); scrollTo(0, document.documentElement.scrollHeight); })()", ''],
    ['evidence-end-iphone', 'Evidence, See all, at its end, on an iPhone with its 34px home bar', '#evidence', "(async () => { document.querySelector('.ev-sec .see').click(); await new Promise((r) => setTimeout(r, 300)); scrollTo(0, document.documentElement.scrollHeight); })()", '', 34],
    ['proof', 'A proof, open', `#evidence/${takeone}`, '', `v=evidence&o=${takeone}`],
    ['proof-end', 'A proof, open, at its end', `#evidence/${takeone}`, "document.querySelector('.ev-scroll').scrollTo(0, 1e5)", ''],
  ];
  // A comment on the open proof, sent from its sheet once, so its Activity has a step after its posting.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await go(`${url}#evidence/${takeone}`);
  await js(`(async () => { document.querySelector('.ev-verdict details.other summary').click(); const t = document.querySelector('#note-${takeone}'); t.value = 'The Learn more list reads well on my phone.'; t.dispatchEvent(new Event('input'));
    [...document.querySelectorAll('.ev-verdict button')].find((b) => b.textContent === 'Send without answering').click(); for (let i = 0; i < 50 && !document.querySelector('.ev-item .th-list'); i++) await new Promise((r) => setTimeout(r, 100)); })()`);
  for (const [wd, metrics] of [['390w', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }], ['1280w', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }]]) {
    for (const theme of ['light', 'dark']) {
      for (const [state, what, hash, act, protoHash, homeBar = 0] of metrics.mobile ? STATES : [['evidence', 'Evidence on a desk, the newest proof beside the list', '#evidence', '', ''], ['evidence-priority', 'Evidence on a desk, by priority', '#evidence', "document.querySelector('.ev-seg button:nth-child(2)').click()", '']]) {
        const name = `${state}.${theme}.${wd}`;
        await cdp('Emulation.setDeviceMetricsOverride', metrics);
        // The phone's bottom safe area: none, as a browser window has it, or an iPhone's home bar.
        await cdp('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: homeBar } });
        await cdp('Emulation.setTouchEmulationEnabled', metrics.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
        await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        errors.length = 0; failed.length = 0;
        await go(`${url}${hash}`);
        if (act === 'crewhouse') await pickProject('crewhouse'); else if (act) await js(act);
        await wait(400);
        await shot(join(out, `${name}.png`));
        const m = await js(MEASURE);
        writeFileSync(join(out, `${name}.dom.json`), JSON.stringify({ ...m.dom, console_errors: [...errors], failed_requests: [...failed] }, null, 2) + '\n');
        delete m.dom;
        writeFileSync(join(out, `${name}.measure.json`), JSON.stringify({ state: what, ...m }, null, 2) + '\n');
        report.push(`${name} (${what}): edges ${m.edges.join('-')}, ${m.blocks.length} blocks, ${m.rows.length} rows${m.rows[0] ? ` (${m.rows[0].height}px, tile ${m.rows[0].tile}, title ${m.rows[0].titleGap}px after it)` : ''}`
          + `${m.held ? `, Held up today "${m.held.words}" ${m.held.cells} squares of ${m.held.cell} in ${m.held.columns} columns` : ''}${m.dock?.lastRowBottom ? `, last row ends ${m.dock.lastRowBottom} with the dock at ${m.dock.top}` : ''}`
          + `${m.end ? `, at the scroll end the last row ends ${m.end.lastRowBottom}${m.end.archivedBottom ? ` and Archived ${m.end.archivedBottom}` : ''} with the dock at ${m.end.dockTop}-${m.end.dockBottom}` : ''}${m.theme ? `, ${m.theme.icon} button on a ${m.theme.page} page` : ''}`
          + `${m.sheet ? `, sheet at ${m.sheet.top}px, title in ${m.sheet.titleLines} lines${m.sheet.titleWhole ? ' whole' : ' CUT'}, verdicts ${m.sheet.verdicts.join('/')} on ${m.sheet.verdictRows} row, Activity ${m.sheet.activity.length}${m.sheet.close ? `, Close ends at ${m.sheet.close.bottom}, the capture starts at ${m.sheet.close.firstCapture}, Close over ${m.sheet.close.over} captures` : ''}` : ''}, under 44px ${m.under.length}, failures ${m.fail.length}${m.fail.length ? ': ' + m.fail.join('; ') : ''}`);
        if ([m.fail, m.under, errors, failed].some((x) => x.length) || !m.inter) problems.push(`${name}: ${JSON.stringify({ fail: m.fail, under: m.under, errors, failed, inter: m.inter })}`);
        // A pick of light or dark stays in this browser: each state starts back on the system's theme.
        await js("localStorage.removeItem('so-theme')");
        if (!protoHash) continue;
        await go(`file://${proto}#${protoHash.replace('OTHER', theme === 'light' ? 'dark' : 'light')}&theme=${theme}`);
        await shot(join(out, 'vs-proto', `${name}.proto.png`));
        // The prototype on the left, the board on the right, each under its name, drawn by the browser itself.
        const img = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
        writeFileSync(join(dir, 'pair.html'), `<body style="margin:0;padding:24px;display:flex;gap:24px;background:#888;font:600 22px system-ui;color:#fff">${[['Approved prototype', img(join(out, 'vs-proto', `${name}.proto.png`))], ['Board, this build', img(join(out, `${name}.png`))]]
          .map(([t, s]) => `<figure style="margin:0"><figcaption style="margin:0 0 12px">${t}: ${what}, on a phone, ${theme}</figcaption><img src="${s}" style="display:block;width:${metrics.width}px"></figure>`).join('')}</body>`);
        await cdp('Emulation.setDeviceMetricsOverride', { width: metrics.width * 2 + 72, height: metrics.height + 90, deviceScaleFactor: 1, mobile: false });
        await go(`file://${join(dir, 'pair.html')}`, 600);
        await shot(join(out, 'vs-proto', `${name}.pair.png`));
      }
    }
  }
  writeFileSync(join(out, 'measure.txt'), report.join('\n') + '\n');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: `A throwaway board holding the approved prototype's own proof: its ${rows.length} newest proofs (titles, done-done's line, captures, projects with their icons, priorities and tickets) and ${earlier.length} earlier proofs of the day, served with no evidence root, as the fleet's board is.`,
    steps: ['Open Evidence on a phone (390x844, 2x) in light and in dark over the DevTools protocol with exact device metrics, and the same state of the approved prototype beside it.',
      'Evidence newest first: the title row with the project filter, Newest and By priority, Held up today with a square per proof filed today, and the six latest proofs as rows.',
      'Tap the light or dark button: the board turns to the other theme and the button to its other icon (a sun on a dark page, a moon on a light one).',
      'Tap By priority: the P0 proofs lead, each row with its chip and its ticket\'s progress.', 'Tap the filter: the sheet lists each project with its icon and count.',
      'Pick crewhouse: a pill with its icon replaces the hero and only its proofs are listed.', 'Tap See all and scroll to the end: the last row clears the dock, and with an iPhone\'s 34px home bar the dock rises and the last row and Archived still end above it.',
      'Open the takeone proof: a sheet over the list with its project and time, its whole title, its capture, done-done\'s word, its priority, its ticket and its pull request; scroll it to its end: its Activity (posted, then the comment sent from the sheet) and Fail, Needs work and Pass on one row.',
      'Measure each in the browser: edges, the 4px grid, rows, the dots, the last row and the Archived row against the dock at the scroll end, the light or dark button, the sheet, file paths and controls under 44px.', 'Open Evidence at 1280x800 in both themes: the list beside the newest proof.'],
    result: 'On a phone, in light and dark, Evidence matches the approved prototype: a 24px title with the round filter button and the light or dark button (a moon on a light page, a sun on a dark one, a tap turns the board to the other theme), Newest and By priority, the Held up today card (the count, how many are not checked, and one square per proof filed today, ink where done-done says it holds up), and the latest proof as 68px rows (at the scroll end the last row and the Archived row clear the dock), each its project\'s icon with done-done\'s check at its corner, the title, a P0-P3 chip only where a priority is set, and its ticket\'s bar and percent or its project and time; one project picked shows as a pill; a proof opens as a sheet with its whole title, its capture, its done-done, Priority, Ticket and Pull request rows, its Activity and Fail, Needs work and Pass in ink; every block on one 16px gutter and the 4px grid, no file path, nothing under 44px, no sideways overflow.' }, null, 2) + '\n');
  console.log(report.join('\n'));
  assert.deepEqual(problems, [], 'every capture measures clean');
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { sh(['stop', board]); } catch {}
  try { server.kill(); } catch {}
  await wait(300);
  rmSync(prof, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}
