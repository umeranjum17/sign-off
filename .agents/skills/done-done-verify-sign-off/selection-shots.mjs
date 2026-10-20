// Selected text on a guided plan and report: native selection of one authored field is offered the same presets, through the one engagement path.
// An isolated board and this checkout's built CLI; nothing here touches ~/.sign-off, Firstmate or a real board. The replies here are a labelled
// stand-in (`deeper --filer`), so the owner-wake proof stays with the real-owner journeys; this one proves targets, offsets and the page.
// Usage: node .agents/skills/done-done-verify-sign-off/selection-shots.mjs <output> [light|dark] [390|1280]
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { recordsDir } from './records.mjs';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const theme = process.argv[3] ?? process.env.DONE_DONE_THEME ?? 'light', width = +(process.argv[4] ?? process.env.DONE_DONE_WIDTH ?? 390);
assert.ok(['light', 'dark'].includes(theme) && [390, 1280].includes(width));
mkdirSync(out, { recursive: true });
const records = recordsDir(out);
mkdirSync(records, { recursive: true });
const repo = resolve(import.meta.dirname, '../../..'), cliJs = join(repo, 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'so-select-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
for (const k of Object.keys(env)) if (/^(FM_|FIRSTMATE|SIGN_OFF_)/.test(k)) delete env[k];
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const cli = (...args) => run(process.execPath, [cliJs, ...args], { env });

// Two synthetic documents whose first understood line repeats a phrase and holds an emoji, so offsets must count code points.
const TEXT = 'Ask 🙂 once, then ask 🙂 again, and ask 🙂 a third time.', docs = {};
for (const [kind, schema, dated] of [['plan', 3, false], ['report', 4, true]]) {
  const m = JSON.parse(readFileSync(join(repo, `fixtures/contract/${kind}.v${schema}/valid-full.json`)));
  m.key = `select-${kind}`; m.understood[0].text = TEXT;
  if (dated) m.filed = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const file = join(dir, `${kind}.json`); writeFileSync(file, JSON.stringify(m)); cli('post', board, '--kind', kind, '--from', file); docs[kind] = m;
}
const server = spawn(process.execPath, [cliJs, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-select-${theme}-${width}-${process.pid}-${Date.now()}` };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const nap = (ms) => new Promise(r=>setTimeout(r,ms));\nconst wait = async (s) => { for (let i=0;i<100;i++) { if (await page.eval(`!!document.querySelector(${JSON.stringify(s)})`)) return; await nap(100); } throw new Error("Not ready: " + s); };\n' + script }).trim().split('\n').pop();
const page = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn})));`));
const cp = (s, n) => [...s].slice(0, n).join('').length; // code point offset -> UTF-16 index, the page works in both
// Select [from, to) code points of one authored field by Selection API, as a drag or the handles would leave it.
const select = (kind, part, field, from, to, toField = field, toPart = part) => drive(`await page.eval(() => {
  const at = (p, f) => document.querySelector('[data-sp="' + p + '"][data-sf="' + f + '"]'), a = at(${JSON.stringify(part)}, ${JSON.stringify(field)}), b = at(${JSON.stringify(toPart)}, ${JSON.stringify(toField)});
  a.scrollIntoView({ block: 'center' }); const u = (n, el) => [...el.textContent].slice(0, n).join('').length, r = document.createRange();
  r.setStart(a.firstChild, u(${from}, a)); r.setEnd(b.firstChild, u(${to}, b)); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}); await nap(300);`);
const tray = () => page(`() => { const t = document.querySelector('.gd-selq'), r = getSelection().rangeCount ? getSelection().getRangeAt(0).getClientRects() : []; return { shown: !!t && !t.hidden && t.isConnected, text: t?.innerText ?? '', buttons: [...(t?.querySelectorAll('.gd-acts button') ?? [])].map(b => b.textContent), after: t?.previousElementSibling?.dataset.sf ?? t?.previousElementSibling?.className, gap: t && r.length ? Math.round(t.getBoundingClientRect().top - r[r.length - 1].bottom) : null }; }`);
const click = (sel) => drive(`await page.eval(() => document.querySelector(${JSON.stringify(sel)}).click()); await nap(400);`);
const state = () => new Promise((ok, no) => { const req = get(`${base}api/decisions`, { agent: false }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => { try { ok(JSON.parse(b)); } catch (e) { no(e); } }); }); req.on('error', no); });
const asks = async (key) => (await state()).deeper.filter(a => a.key === key);
let base;
const capture = (kind, name, claim) => {
  const stem = `${kind}-${name}.${theme}.${width}w`;
  browser('screenshot', join(out, `${stem}.png`));
  const dom = page(`() => { const w = document.documentElement.clientWidth; return { overflow: document.documentElement.scrollWidth > w, overflowing: [...document.querySelectorAll('#reader *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > w + 1).slice(0, 10).map(e => e.tagName + '.' + e.className), rawIds: /\\bundefined\\b|\\[object|\\bNaN\\b/.test(document.body.innerText) }; }`);
  assert.equal(dom.overflow, false); assert.deepEqual(dom.overflowing, []); assert.equal(dom.rawIds, false);
  const errors = browser('console', '--type', 'error');
  if (!/no console messages found/.test(errors)) assert.fail(errors + browser('network', '--limit', '60'));
  writeFileSync(join(records, `${stem}.claim.txt`), `${width}px ${theme}: ${claim}\n`);
};
try {
  base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (c) => no(new Error(`Server exited ${c}`))); });
  browser('open', base); browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x860x1', '--color-scheme', theme);
  for (const kind of ['plan', 'report']) {
    const m = docs[kind], key = m.key, sec = m.sections[0].id, log = {};
    browser('open', `${base}#${kind === 'plan' ? 'waiting' : 'reports'}/${key}`);
    drive("await wait('.gd-sec');");
    // 1. A repeated phrase in one field: the second repeat, by code points (UTF-16 would say 18). The tray sits under that field, clear of the handles.
    const second = TEXT.indexOf('ask 🙂'), at2 = [...TEXT.slice(0, second)].length;
    select(kind, 'understood', 'understood.0.text', at2, at2 + 5);
    let t = await tray(); log.tray = t;
    assert.ok(t.shown && t.after === 'understood.0.text' && /ask 🙂/.test(t.text), JSON.stringify(t));
    assert.deepEqual(t.buttons, ['Ask a question', 'Go deeper', 'Simplify this', 'Show an example', 'Why?']);
    assert.ok(t.gap >= 20, `room for the native handles under the selection: ${t.gap}px`);
    // Copying is the browser's: the page never cancels it, and the selection stays selectable.
    assert.deepEqual(page(`() => { const e = new ClipboardEvent('copy', { bubbles: true, cancelable: true }); document.dispatchEvent(e); return { cancelled: e.defaultPrevented, select: getComputedStyle(document.querySelector('[data-sf="understood.0.text"]')).userSelect, held: getSelection().toString() }; }`), { cancelled: false, select: 'auto', held: 'ask 🙂' });
    capture(kind, 'tray', 'Selecting the second repeat of a phrase offers the presets right under that paragraph, with its quote.');
    click('.gd-selq .why');
    let list = await asks(key);
    assert.deepEqual(list.map(a => [a.action, a.part, a.selection]), [['why', 'understood', { field: 'understood.0.text', start: at2, end: at2 + 5, quote: 'ask 🙂' }]]);
    assert.equal(list[0].q, undefined); assert.match((await tray()).text, /Asked/);
    assert.equal(page(`() => document.querySelector('[data-part="understood"] > .gd-ans .gask blockquote').textContent`), 'ask 🙂');
    drive(`await page.eval(() => { const s = document.querySelector('.gd-scroll'); s.style.scrollBehavior = 'auto'; document.querySelector('[data-part="understood"] > .gd-ans').scrollIntoView({ block: 'center' }); }); await nap(500);`);
    capture(kind, 'pending', 'The request waits under its section with the quoted words and the Why? action.');
    // 2. The third repeat, by keyboard: a one-letter selection grown with Shift+ArrowRight, then Tab into the tray and Enter on Go deeper.
    const third = [...TEXT.slice(0, TEXT.indexOf('ask 🙂', second + 1))].length;
    select(kind, 'understood', 'understood.0.text', third, third + 1);
    for (let i = 0; i < 4; i++) browser('press', 'Shift+ArrowRight');
    browser('press', 'Tab'); browser('press', 'Tab'); browser('press', 'Enter');
    drive('await nap(400);');
    list = await asks(key);
    assert.deepEqual(list.map(a => [a.action, a.selection.start, a.selection.end]), [['why', at2, at2 + 5], ['deeper', third, third + 5]]);
    // 3. Ask a question about two words: the composer opens inside the tray and the text goes with the quote.
    select(kind, 'understood', 'understood.0.text', 6, 10);
    click('.gd-selq .question');
    assert.equal(page(`() => document.activeElement === document.querySelector('.gd-selq input')`), true);
    drive(`await page.eval(() => { const f = document.querySelector('.gd-selq .gd-fu'); f.querySelector('input').value = 'Why this word?'; f.requestSubmit(); }); await nap(400);`);
    list = await asks(key);
    assert.deepEqual([list[2].action, list[2].q, list[2].selection.quote], ['question', 'Why this word?', 'once']);
    // 4. Cancelling: collapsing the selection removes the tray, and a plain preset after that carries no quote.
    select(kind, 'understood', 'understood.0.text', 6, 10);
    assert.equal((await tray()).shown, true);
    drive('await page.eval(() => getSelection().removeAllRanges()); await nap(400);');
    assert.equal((await tray()).shown, false);
    click('[data-part="understood"] > .gd-acts .deep');
    list = await asks(key);
    assert.equal(list.length, 4); assert.equal(list[3].selection, undefined);
    // 5. Escape in the tray cancels too.
    select(kind, 'understood', 'understood.0.text', 6, 10); browser('press', 'Tab'); browser('press', 'Escape');
    assert.deepEqual(page(`() => [!document.querySelector('.gd-selq') || document.querySelector('.gd-selq').hidden, getSelection().isCollapsed]`), [true, true]);
    // 6. Across two fields, or two sections: no presets, a plain hint, nothing saved.
    select(kind, sec, 'heading', 3, 8, 'body'); t = await tray();
    assert.ok(t.shown && t.buttons.length === 0 && /one paragraph/.test(t.text), JSON.stringify(t));
    select(kind, sec, 'body', 2, 6, 'heading', m.sections[1].id); t = await tray();
    assert.ok(t.shown && t.buttons.length === 0, JSON.stringify(t));
    assert.equal((await asks(key)).length, 4);
    // 7. A stand-in reply fills the first request in its section with the quote above it.
    cli('deeper', board, '--filer', m.filer, '--id', list[0].id, '--text', 'Stand-in reply for the screenshot: the phrase repeats on purpose.');
    browser('open', `${base}#${kind === 'plan' ? 'waiting' : 'reports'}/${key}`);
    drive(`await wait('.gd-sec'); await page.eval(() => { document.querySelector('[data-part="understood"] > .gd-ans').scrollIntoView({ block: 'center' }); }); await nap(800);`);
    capture(kind, 'answer', 'A stand-in reply (not an owner proof) lands in the section under the quoted words.');
    writeFileSync(join(records, `${kind}-selection.${theme}.${width}w.json`), JSON.stringify({ tray: log.tray, asks: await asks(key) }));
  }
  // 8. A revised document makes the open page stale: the tray's request is refused and nothing is saved. Last, since the refusal is a console error by design.
  for (const kind of ['plan', 'report']) {
    const key = docs[kind].key;
    browser('open', `${base}#${kind === 'plan' ? 'waiting' : 'reports'}/${key}`); drive("await wait('.gd-sec');");
    select(kind, 'understood', 'understood.0.text', 6, 10);
    const file = JSON.parse(readFileSync(board, 'utf8')); file.items.find(i => i.key === key).title += ' revised'; writeFileSync(board, JSON.stringify(file));
    click('.gd-selq .deep');
    assert.match(page(`() => document.querySelector('[data-part="understood"] > .gd-ans').innerText`), /stale/);
    assert.equal((await asks(key)).length, 4);
  }
} finally {
  try { browser('stop'); } catch {}
  server.kill();
  console.log(`Scratch for cleanup: ${dir}`);
}
