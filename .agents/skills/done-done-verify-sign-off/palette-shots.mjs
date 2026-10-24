// The new look's colours: every merged screen in the new look (Today, Decide, Designs, Reports, Tickets) and its sheets, at 390x844 and 1280x800, light and dark,
// captured at 2x over the DevTools protocol with exact device metrics (a headless Chromium of its own) beside the approved prototype in the same state,
// and every colour each page draws read from the computed styles in the browser (text, grounds, borders, outlines, shadows, gradients, icon fills and strokes,
// native control accents, ::before and ::after) and checked against the prototype's palette, on the board and on the prototype alike.
// Evidence (not yet in the new look) is captured and its colours listed, but not checked.
// Usage: node .agents/skills/done-done-verify-sign-off/palette-shots.mjs <output> <prototype index.html>
// PALETTE_SIDE=before SIGN_OFF_REPO=<built base checkout> records the base under before/ (its colours are listed, not asserted).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), proto = resolve(process.argv[3] ?? process.env.PALETTE_PROTO);
assert.ok(existsSync(proto), 'the approved prototype\'s index.html is the second argument');
const side = process.env.PALETTE_SIDE ?? 'after', here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), dest = side === 'after' ? out : join(out, 'before');
mkdirSync(join(dest, 'vs-proto'), { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-palette-'));
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, env, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);

// The prototype's palette, read from its own :root and dark blocks plus the few colours it writes in place (as test/design.test.mjs holds it).
const protoCss = readFileSync(proto, 'utf8').replace(/base64,[A-Za-z0-9+/=]+/g, '');
const block = (sel) => protoCss.slice(protoCss.indexOf(sel), protoCss.indexOf('}', protoCss.indexOf(sel)));
const colours = (text) => text.match(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b|rgba?\([^)]*\)/g) ?? [];
const inPlace = ['#262624', '#FFFFFF', '#2BB673', '#C8841A', 'rgba(255, 255, 255, .14)', 'rgba(0, 0, 0, .2)', 'rgba(0, 0, 0, .1)', 'rgba(30, 20, 10, .12)', 'rgba(20, 16, 12, .25)', 'rgba(40, 30, 20, .08)', 'rgba(40, 30, 20, .05)', 'rgba(40, 30, 20, .06)', 'rgba(40, 30, 20, .10)'];
const channels = (c) => { if (c.startsWith('#')) { const h = c.length === 4 ? [...c.slice(1)].map((x) => x + x).join('') : c.slice(1); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1); }
  const n = c.match(/-?[\d.]+(e-?\d+)?/g).map(Number), srgb = c.startsWith('color('); return [...n.slice(0, 3).map((x) => (srgb ? x * 255 : x)), n[3] ?? 1]; };
const PALETTE = { light: [...colours(block(':root {')), ...inPlace].map(channels), dark: [...colours(block(':root[data-theme="dark"] {')), ...inPlace].map(channels) };
const allowed = (c, theme) => PALETTE[theme].some((p) => p.every((x, i) => Math.abs(x - c[i]) <= (i < 3 ? 1 : 0.005)));
// The board's mark keeps the prototype's blue check (web/icon.svg's gradient): those two blues count on the mark alone.
const LOGO = ['#6A93FF', '#2C48D3'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1)), onLogo = (c, where) => /^span\.logo\b/.test(where) && LOGO.some((p) => p.every((x, i) => Math.abs(x - c[i]) <= (i < 3 ? 1 : 0.005)));
// Every colour the page draws, each with the first place it is drawn (as test/design.test.mjs reads them).
const DRAWN = `(() => {
  const seen = new Map();
  const norm = (c) => { const n = c.match(/-?[\\d.]+(e-?\\d+)?/g).map(Number), srgb = c.startsWith('color('), [r, g, b] = n.slice(0, 3).map((x) => Math.round(srgb ? x * 255 : x)), a = n[3] ?? 1;
    return a === 0 ? null : a === 1 ? '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase() : 'rgba(' + [r, g, b, +a.toFixed(3)].join(',') + ')'; };
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].slice(0, 3).map((c) => '.' + c).join('');
  // A gradient's stops fade a colour toward clear, so a stop counts by its colour alone.
  const add = (value, where, fade) => { for (const c of value.match(/rgba?\\([^)]*\\)|color\\([^)]*\\)/g) ?? []) { const n = norm(c), k = n && fade ? n.replace(/^rgba\\((\\d+),(\\d+),(\\d+),.*$/, (_, ...rgb) => '#' + rgb.slice(0, 3).map((x) => (+x).toString(16).padStart(2, '0')).join('').toUpperCase()) : n; if (k && !seen.has(k)) seen.set(k, where); } };
  const box = (s, where, text) => {
    if (text) add(s.color, where + ' color');
    add(s.backgroundColor, where + ' background');
    if (s.backgroundImage !== 'none') add(s.backgroundImage, where + ' gradient', true);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(s['border' + side + 'Width']) > 0 && !/none|hidden/.test(s['border' + side + 'Style'])) add(s['border' + side + 'Color'], where + ' border');
    if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) add(s.outlineColor, where + ' outline');
    if (s.boxShadow !== 'none') add(s.boxShadow, where + ' shadow');
    if (s.textShadow !== 'none' && text) add(s.textShadow, where + ' text-shadow');
    if (text && s.textDecorationLine !== 'none') add(s.textDecorationColor, where + ' underline');
  };
  for (const el of document.querySelectorAll('body *')) {
    if (!el.getClientRects().length || el.closest('[hidden], template, iframe')) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden') continue;
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.value);
    box(s, name(el), text);
    if (el instanceof SVGGeometryElement || el instanceof SVGTextElement) for (const p of ['fill', 'stroke']) if (s[p] !== 'none') add(s[p], name(el.closest('svg').parentElement) + ' svg ' + p);
    if (/^(checkbox|radio|range)$/.test(el.type) && s.appearance !== 'none') s.accentColor === 'auto' ? seen.set('accent-color auto', name(el)) : add(s.accentColor, name(el) + ' accent');
    if (el.placeholder && !el.value) add(getComputedStyle(el, '::placeholder').color, name(el) + ' placeholder');
    for (const pseudo of ['::before', '::after']) { const p = getComputedStyle(el, pseudo); if (p.content !== 'none' && p.content !== 'normal') box(p, name(el) + pseudo, p.content.length > 2); }
  }
  return [...seen].map(([c, where]) => [c, where]);
})()`;

const prof = mkdtempSync(join(tmpdir(), 'so-palette-chrome-'));
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let ws;
const errors = [], report = [], problems = [], found = {};
try {
  const url = sh('bash', [join(here, '.agents/skills/done-done-verify-sign-off/feel-board.sh'), dir], { cwd: repo }).trim().split('\n').pop();
  // Tickets for the Tickets screen and a ticket's sheet (an epic, a P0 ticket under it, one on hold, a done system one), and a P0 ask and a P1 report on them.
  const so = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args]), board = join(dir, 'board.json');
  for (const args of [['--id', 'T-9', '--title', 'The new settings page', '--priority', 'P1', '--project', 'Settings', '--asked', 'yes'], ['--id', 'T-29', '--title', 'Ship the new settings page', '--progress', '60', '--parent', 'T-9', '--priority', 'P0'],
    ['--id', 'T-31', '--title', 'Write the release notes', '--priority', 'P2', '--hold', 'yes', '--asked', 'yes'], ['--id', 'T-40', '--title', 'Rotate the nightly logs', '--priority', 'P3', '--progress', '100']]) so('ticket', board, ...args);
  so('post', board, '--ask-ref', 'message-feel', '--ticket', 'T-29', '--priority', 'P0', '--key', 'friday', '--title', 'Ship the settings page on Friday?', '--why', 'Support is fully staffed on Friday.', '--outcome', 'yes=It ships Friday.', '--outcome', 'no=It waits a week.',
    '--recommend', 'yes', '--recommend-reason', 'Support is on hand.', '--default', 'no');
  const reportKey = JSON.parse(readFileSync(board, 'utf8')).items.filter((i) => i.kind === 'report').at(-1).key;
  // A comment on the P0 ask, a report and a proof, so each card's own screen draws its Activity beside its property panel.
  for (const key of ['friday', reportKey, 'ev1']) assert.ok((await fetch(new URL('api/messages', url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'comment', key, text: 'Looks right on my phone.' }) })).ok);
  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium opened its DevTools port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception'); };
  const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  const ev = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, r.exceptionDetails?.exception?.description); return r.result.value; };
  const shot = async (file) => writeFileSync(file, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const go = async (address, ms = 1200) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: address }); await wait(ms); };
  // Each state: its name, the board's address and what is tapped there, the prototype's address for the same state, and whether its colours are checked.
  const pq = 'fm-4a662adc-addons-approval-audit-fixplan-20261023T034710Z';
  const STATES = {
    390: [['today', '#', '', 'v=today'], ['search', '#find', '', 'v=today&s'], ['decide', '#waiting', '', 'v=decide'], ['ask', '#decide/ship', '.decide .pick-option', `v=decide&o=${pq}`],
      ['reports', '#reports', '', 'v=reports'], ['report', `#reports/${reportKey}`, '', `v=reports&rep=${pq}`], ['designs', '#designs', '', 'v=designs'], ['design', '#designs/onboarding', '', 'v=designs&d=epics-prototype-redesign-2'],
      ['tickets', '#tickets', '', 'v=tickets'], ['ticket', '#ticket/T-29', '', 'v=tickets&t=firstmate-addons/addons-epics-prototype'], ['evidence', '#evidence', '', 'v=evidence', 'listed'],
      // A card's own screen: the P0 ask's sheet (its panel and Activity) and a report's sheet opened from the list (its parts, Ticket row and Activity).
      ['ask-detail', '#decide/friday', '', `v=decide&o=${pq}`], ['report-detail', '#reports', `.rp-list a[data-row][href="#reports/${reportKey}"]`, 'v=reports'],
      // Last, an answer and the toast it raises over Decide: the yes/no in light, the pick-one in dark.
      ['toast', (theme) => (theme === 'light' ? '#decide/digest' : '#decide/export'), ['.decide .pick-option', '.decide-bar .answer'], 'v=decide']],
    1280: [['today', '#', '', 'v=today'], ['decide', '#decide/friday', '', 'v=decide'], ['reports', '#reports', '', 'v=reports'], ['designs', '#designs', '', 'v=designs'],
      ['tickets', '#tickets', '', 'v=tickets'], ['ticket', '#ticket/T-29', '', 'v=tickets&t=firstmate-addons/addons-epics-prototype'], ['evidence', '#evidence', '', 'v=evidence', 'listed'],
      // A card's own screen on the desk: a report opened from the list beside it, and a proof (listed, as Evidence's list is not yet in the new look).
      ['report-detail', '#reports', `.rp-list a[data-row][href="#reports/${reportKey}"]`, 'v=reports'], ['proof-detail', '#evidence/ev1', '', 'v=evidence', 'listed']],
  };
  for (const [width, metrics] of [[390, { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }], [1280, { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }]]) {
    for (const theme of ['light', 'dark']) {
      const cell = `${theme}.${width}w`, sheet = (found[cell] = {});
      await cdp('Emulation.setDeviceMetricsOverride', metrics);
      await cdp('Emulation.setTouchEmulationEnabled', metrics.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      for (const [state, hashOf, tap, protoHash, listed] of STATES[width]) {
        const name = `${state}.${cell}`, hash = typeof hashOf === 'function' ? hashOf(theme) : hashOf;
        errors.length = 0;
        await go(`${url}${hash}`);
        for (const t of [tap].flat().filter(Boolean)) { await ev(`document.querySelector(${JSON.stringify(t)})?.click()`); await wait(400); }
        await shot(join(dest, `${name}.png`));
        const drawn = await ev(DRAWN), off = drawn.filter(([c, where]) => c === 'accent-color auto' || !(allowed(channels(c), theme) || onLogo(channels(c), where)));
        // The place lit in the sidebar (a desk: Designs on Designs) or the dock (a phone: Today on Designs), whose colours are among those read.
        const lit = await ev('[...document.querySelectorAll(".side [aria-current], .tabs [aria-current]")].filter((a) => a.getClientRects().length).map((a) => a.getAttribute("href")).join()');
        if (state.startsWith('design') && lit !== (metrics.mobile ? '#' : '#designs')) problems.push(`${name}: lit ${lit}`);
        await go(`file://${proto}#${protoHash}&theme=${theme}`);
        await shot(join(dest, 'vs-proto', `${name}.proto.png`));
        const protoDrawn = await ev(DRAWN), protoOff = protoDrawn.filter(([c]) => !allowed(channels(c), theme));
        sheet[state] = { lit, board: drawn.map(([c]) => c).sort(), off: off.map(([c, w]) => `${c}  ${w}`), prototype: protoDrawn.map(([c]) => c).sort(), prototype_off: protoOff.map(([c, w]) => `${c}  ${w}`), console_errors: [...errors] };
        report.push(`${name}: lit ${lit || 'none'}, ${drawn.length} colours drawn, ${off.length} outside the prototype's palette${listed ? ' (listed, not checked)' : ''}; the prototype draws ${protoDrawn.length}, ${protoOff.length} outside it`);
        if (!listed && off.length) problems.push(`${name}: ${off.map(([c, w]) => `${c} ${w}`).join('; ')}`);
        if (protoOff.length) problems.push(`${name} prototype: ${protoOff.map(([c, w]) => `${c} ${w}`).join('; ')}`);
        if (errors.length) problems.push(`${name}: console ${errors.join('; ')}`);
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
      writeFileSync(join(dest, `colours.${cell}.json`), JSON.stringify(sheet, null, 2) + '\n');
    }
  }
  writeFileSync(join(dest, 'palette.txt'), report.join('\n') + '\n');
  if (side === 'after') writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board with asks (one P0 on a ticket), a sign-in, a design to review, five updates, two reports, and four tickets (an epic, a P0 ticket under it, one on hold and a done one).',
    steps: ['Open Today, Search, Decide and an ask, Reports and a report, Designs and a design, Tickets and a ticket, Evidence, and an answer\'s toast at 390x844, and the desk\'s screens at 1280x800 (2x), light and dark, over the DevTools protocol with exact device metrics.',
      'Read every colour each page draws from its computed styles in the browser (text, grounds, borders, outlines, shadows, gradients, icon fills and strokes, ::before and ::after), on the board and on the approved prototype in the same state, size and theme.',
      'Check each against the prototype\'s palette (its :root and dark blocks, and the colours it writes in place), and set the board beside the prototype.'],
    result: 'On a phone and on a desk, in light and in dark, Today, Decide, Designs, Reports and Tickets and their sheets draw only the approved prototype\'s colours: a warm canvas and cards, ink for the main buttons, links, focus and the toast, red for what waits, amber for a warning, the prototype\'s P0-P3 chips, and no blue. The prototype itself draws only the same palette. Evidence, not yet in the new look, is listed with whatever colours it still draws outside it.' }, null, 2) + '\n');
  console.log(report.join('\n'));
  if (side === 'after') assert.deepEqual(problems, [], 'every checked screen draws only the prototype\'s palette');
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { sh(process.execPath, [join(repo, 'dist/cli.js'), 'stop', join(dir, 'board.json')]); } catch {}
  await wait(300);
  rmSync(prof, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}
