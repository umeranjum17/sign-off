// A report acts from one place: its head's View and Activity, the one bar that acts on the part in view, the composer and Ask over it, and Activity (a sheet on a phone,
// a third column on a desk). An isolated board and this checkout's built CLI; nothing here touches ~/.sign-off, Firstmate or a real board.
// Usage: node .agents/skills/done-done-verify-sign-off/report-bar-shots.mjs <output> [light|dark] [360|390|445|1280|1440]
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { recordsDir } from './records.mjs';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const theme = process.argv[3] ?? process.env.DONE_DONE_THEME ?? 'light', width = +(process.argv[4] ?? process.env.DONE_DONE_WIDTH ?? 390);
assert.ok(['light', 'dark'].includes(theme) && [360, 390, 445, 1280, 1440].includes(width));
const mobile = width < 960;
mkdirSync(out, { recursive: true });
const records = recordsDir(out);
mkdirSync(records, { recursive: true });
const repo = resolve(process.env.SIGN_OFF_REPO ?? resolve(import.meta.dirname, '../../..')), cliJs = join(repo, 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'so-bar-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
for (const k of Object.keys(env)) if (/^(FM_|FIRSTMATE|SIGN_OFF_)/.test(k)) delete env[k];
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const cli = (...args) => run(process.execPath, [cliJs, ...args], { env });
const FILER = 'agent-41', KEY = 'bar-report', PART = 'found';
const m = JSON.parse(readFileSync(join(resolve(import.meta.dirname, '../../..'), 'fixtures/contract/report.v4/valid-full.json')));
m.key = KEY; m.filed = new Date().toISOString().replace(/\.\d+Z$/, 'Z'); m.filer = FILER;
m.sections.find((s) => s.id === PART).details = [{ label: 'Hangs', value: '3 of 40 runs' }];
writeFileSync(join(dir, 'report.json'), JSON.stringify(m));
cli('post', board, '--kind', 'report', '--from', join(dir, 'report.json'), '--filer', FILER);
const server = spawn(process.execPath, [cliJs, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
// A free port of its own, so another lane's browser bridge on the hashed one never blocks this run.
const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-bar-${theme}-${width}-${process.pid}-${Date.now()}`, CHROME_DEVTOOLS_AXI_PORT: String(port) };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const nap = (ms) => new Promise(r=>setTimeout(r,ms));\nconst wait = async (s) => { for (let i=0;i<100;i++) { if (await page.eval(`!!document.querySelector(${JSON.stringify(s)})`)) return; await nap(100); } throw new Error("Not ready: " + s); };\n' + script }).trim().split('\n').pop();
const page = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn})));`));
const click = (sel, i = 0) => drive(`await page.eval(() => document.querySelectorAll(${JSON.stringify(sel)})[${i}].click()); await nap(400);`);
// Scroll one part so its heading sits under the progress bar, the same place in every capture.
const show = (sel) => drive(`await page.eval(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'start' }); document.querySelector('.gd-scroll').scrollBy(0, -${mobile ? 64 : 24}); }); await nap(300);`);
// Where a control is, and whether the 44 px square around its centre lands on it: the tap target, not the drawn size.
const MEASURE = (sel) => `() => [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, hit = [[-21, -21], [21, -21], [-21, 21], [21, 21]].filter(([dx, dy]) => e.contains(document.elementFromPoint(cx + dx, cy + dy))).length;
  return { name: (e.getAttribute('aria-label') || e.title || e.textContent).trim().slice(0, 24), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), hit44: hit === 4 }; })`;
const capture = (name, claim, extra = {}) => {
  const stem = `${name}.${theme}.${width}w`;
  browser('screenshot', join(out, `${stem}.png`));
  const dom = page(`() => { const w = document.documentElement.clientWidth; return { overflow: document.documentElement.scrollWidth > w, overflowing: [...document.querySelectorAll('#reader *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > w + 1).slice(0, 10).map(e => e.tagName.toLowerCase() + '.' + e.className) }; }`);
  assert.equal(dom.overflow, false); assert.deepEqual(dom.overflowing, []);
  const squashed = page(`() => { const ctx = document.createElement('canvas').getContext('2d'), out = []; for (const e of document.querySelectorAll('#reader *')) { const nodes = [...e.childNodes].filter(n => n.nodeType === 3 && n.data.trim()), text = nodes.map(n => n.data).join(' ').trim(), s = getComputedStyle(e); if (!(e instanceof HTMLElement) || !text || !e.getClientRects().length || e.offsetWidth <= 1 || s.visibility !== 'visible') continue; ctx.font = s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily; const chars = e.offsetWidth / (ctx.measureText('abcdefghijklmnopqrstuvwxyz').width / 26), tops = new Set(); for (const n of nodes) { const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width) tops.add(Math.round(b.top)); } if ((chars < 8 && ctx.measureText(text).width > e.offsetWidth + 1) || tops.size > text.split(/\\s+/).length) out.push({element: e.tagName.toLowerCase(), text, chars, lines: tops.size, words: text.split(/\\s+/).length}); } return out; }`);
  writeFileSync(join(out, `${stem}.dom.json`), JSON.stringify({ url: page('() => location.href'), ...dom, console_errors: [], failed_requests: [], squashed_text: squashed }, null, 2));

  writeFileSync(join(records, `${stem}.network.txt`), browser('network'));
  const errors = browser('console', '--type', 'error');
  if (!/no console messages found/.test(errors)) assert.fail(errors);
  writeFileSync(join(out, `${stem}.txt`), `${width}px ${theme}: ${claim}\n${Object.entries(extra).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n`);
};
let base;
// The page scrolls smoothly; a capture needs it where the script put it, so it scrolls at once here.
const ready = () => drive("await wait('.gd-sec'); await page.eval(() => { document.querySelector('.gd-scroll').style.scrollBehavior = 'auto'; });");
try {
  base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const x = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (x) ok(x[0]); }); server.once('exit', (c) => no(new Error(`Server exited ${c}`))); });
  browser('open', base); browser('emulate', '--viewport', mobile ? `${width}x844x2,mobile,touch` : `${width}x${width === 1440 ? 900 : 860}x1`, '--color-scheme', theme);
  browser('open', `${base}#reports/${KEY}`);
  ready();
  show(`[data-part="${PART}"]`);
  // No part carries a row, a receipt or a Details button: one bar acts on the part in view, and it sits under the scroll, never over it.
  const one = page(`() => ({ bars: document.querySelectorAll('.ra-bar').length, partRows: document.querySelectorAll('.gd-main .gd-foot, .gd-main .gd-v, .gd-main .gd-more, .gd-main .gd-rc, .gd-main .gd-lnk.deep').length,
    on: document.querySelector('.ra-ont').textContent, bar: document.querySelector('.ra-bar').getBoundingClientRect().top >= document.querySelector('.gd-scroll').getBoundingClientRect().bottom - 0.5 })`);
  assert.deepEqual([one.bars, one.partRows, one.bar], [1, 0, true], JSON.stringify(one));
  const bar = page(MEASURE('.ra-bar button'));
  assert.deepEqual(bar.map((c) => c.name), ['Agree', 'Disagree', 'Comment', 'Ask']);
  assert.ok(bar.every((c) => c.hit44 && c.h >= 44), JSON.stringify(bar));
  if (mobile) assert.equal(page(`() => document.querySelector('.gd-progress .now-part').textContent === document.querySelector('.ra-ont').textContent && document.querySelector('.now-part').getClientRects().length > 0`), true, 'the sticky head names the part in view');
  capture('bar', 'One bar under the reading scroll acts on the part in view: Agree, Disagree, Comment, Ask; the part carries no buttons, and on a phone the head names the part.', { on: one.on, controls: bar });
  // Agree acts on the part in view and shows Agreed.
  click('.ra-b.agree'); drive(`await wait('.ra-b.agree[aria-pressed="true"]');`);
  assert.equal(page(`() => document.querySelector('.ra-b.agree').textContent`), 'Agreed');
  capture('agreed', 'Agree is saved at once and the bar shows Agreed for the part in view.');
  // Ask lists the five asks on the part in view.
  click('.ra-b.asks'); drive(`await wait('#sheet .ra-pre');`);
  const asks = page(MEASURE('#sheet .ra-pre'));
  assert.equal(asks.length, 4); assert.ok(asks.every((c) => c.hit44), JSON.stringify(asks));
  capture('ask', 'Ask opens Go deeper, Simplify this, Show an example, Why? and a box for your own question, on the part in view.', { items: asks });
  drive(`await page.eval(() => document.getElementById('sheet').close()); await nap(200);`);
  // Disagree opens one composer on the part; a note typed and sent reaches the author.
  const TEXT = 'The 6-second limit is short for a cold start. Did it also hang with 30 seconds?';
  click('.ra-b.disagree'); drive(`await wait('#sheet .ra-form textarea');`);
  assert.equal(page(`() => document.querySelector('#sheet .ra-part').value`), 'found');
  drive(`await page.eval(() => { const t = document.querySelector('#sheet textarea'); t.value = ${JSON.stringify(TEXT)}; t.dispatchEvent(new Event('input', { bubbles: true })); }); await nap(200);`);
  capture('composer', 'Disagree opens one composer on the part in view, its part changeable, with Send to the agent.');
  click('#sheet .ra-send'); drive(`await wait('.ra-note'); for (let i = 0; i < 50 && !(await page.eval(() => !document.querySelector('.ra-note').hidden)); i++) await nap(100);`);
  const raw = readFileSync(join(dir, 'board.annotations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(raw.map((l) => [l.part, l.verdict, l.text]), [['found', 'agree', undefined], ['found', 'disagree', TEXT]]);
  capture('sent', 'The note is saved and the bar says Sent to the agent, with where the answer comes.');
  // Activity: the note with its track, newest first; a sheet on a phone, a column on a desk. No track label is cut.
  if (mobile) click('.ra-actb');
  drive(`await wait('.gd-act .ra-e');`);
  const act = page(`() => ({ first: document.querySelector('.gd-act .ra-e .ra-eh b').textContent, titles: [...document.querySelectorAll('.gd-act .ra-e .ra-eh b')].map((b) => b.textContent),
    fit: [...document.querySelectorAll('.gd-act .ui-trail ol')].flatMap((o) => { const li = [...o.children], at = (b) => { const r = document.createRange(); r.selectNodeContents(b); return r.getBoundingClientRect(); };
      return li.map((l, i) => { const t = at(l.querySelector('b')), dot = l.querySelector('i').getBoundingClientRect(), next = li[i + 1] && at(li[i + 1].querySelector('b')); return t.width <= l.querySelector('b').getBoundingClientRect().width + 0.5 && Math.abs(t.left - dot.left) <= 2 && (!next || next.left - t.right >= 4); }); }).every(Boolean) })`);
  assert.equal(act.first, 'You disagreed'); assert.ok(act.titles.includes('You agreed') && act.titles.includes('Agent wrote this'), JSON.stringify(act));
  assert.equal(act.fit, true, 'every track label is whole, under its own dot and clear of the next');
  capture('activity', 'Activity lists the note with its track (Sent, Delivered, Read, Replied each under its own dot), the Agree, what was read and when the agent wrote it, newest first.', act);
  if (mobile) click('.ra-x');
  // View: once for the report.
  click('.ra-tool[aria-label="View"]'); drive(`await wait('#sheet .gd-seg');`);
  capture('view', 'View holds the pictures Drawn or As lists and the numbers shown or hidden, once for the report.');
  drive(`await page.eval(() => document.getElementById('sheet').close()); await nap(200);`);
  // The scroll's end: nothing sits under the bar.
  drive(`await page.eval(() => { document.querySelector('.gd-scroll').scrollTop = 1e6; }); await nap(300);`);
  assert.equal(page(`() => document.querySelector('.ra-bar').getBoundingClientRect().top >= document.querySelector('.gd-scroll').getBoundingClientRect().bottom - 0.5`), true);
  capture('end', 'At the end of the report the last words sit above the bar, none under it.');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board holding one guided report, filed by agent-41.',
    steps: [`The report is opened at ${width} px wide, ${theme}, a part scrolled into view: its head holds View and Activity, one bar holds Agree, Disagree, Comment and Ask, and no part carries buttons.`, 'The person taps Agree: it is saved and the bar shows Agreed.',
      'The person taps Ask: Go deeper, Simplify this, Show an example, Why? and a question box open on the part.', 'The person taps Disagree, types a note and taps Send to the agent: the note is saved and the bar says Sent to the agent.',
      'Activity lists the note with its track, the Agree, what was read and when the agent wrote it, newest first, every track label whole.', 'View holds the pictures and numbers choices once.', 'At the end of the report nothing sits under the bar.'],
    result: 'A report acts from one place: View and Activity in its head, one bar for Agree, Disagree, Comment and Ask on the part in view that sits under the scroll, and one Activity of every note, ask, reply and read, newest first.' }, null, 2) + '\n');
} finally {
  try { browser('stop'); } catch {}
  await new Promise((ok, no) => { const stop = spawn(process.execPath, [cliJs, 'stop', board], { env, stdio: 'ignore' }); stop.once('exit', c => c === 0 ? ok() : no(new Error('Isolated board did not stop'))); });
  rmSync(dir, { recursive: true, force: true });
}
