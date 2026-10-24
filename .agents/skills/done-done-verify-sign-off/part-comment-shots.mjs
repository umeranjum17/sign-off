// Agree, Disagree and Comment on a part, and its Ask menu: on a guided report, then a comment reaching the author agent's `wait --filer`
// and its reply coming back under the part. An isolated board and this checkout's built CLI; nothing here touches ~/.sign-off, Firstmate or a real board.
// Usage: node .agents/skills/done-done-verify-sign-off/part-comment-shots.mjs <output> [light|dark] [390|1280]
// PART_COMMENT_BEFORE=1 SIGN_OFF_REPO=<base checkout, built> records only the same page without the new controls, under the same names.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { recordsDir } from './records.mjs';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const theme = process.argv[3] ?? process.env.DONE_DONE_THEME ?? 'light', width = +(process.argv[4] ?? process.env.DONE_DONE_WIDTH ?? 390);
assert.ok(['light', 'dark'].includes(theme) && [390, 1280].includes(width));
const before = process.env.PART_COMMENT_BEFORE === '1';
mkdirSync(out, { recursive: true });
const records = recordsDir(out);
mkdirSync(records, { recursive: true });
const repo = resolve(process.env.SIGN_OFF_REPO ?? resolve(import.meta.dirname, '../../..')), cliJs = join(repo, 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'so-comment-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
for (const k of Object.keys(env)) if (/^(FM_|FIRSTMATE|SIGN_OFF_)/.test(k)) delete env[k];
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const cli = (...args) => run(process.execPath, [cliJs, ...args], { env });
const FILER = 'agent-41', KEY = 'part-report', REC = 'part-report-2', PART = 'found', FOOT = 'this', ITEM = 'found:0';

const m = JSON.parse(readFileSync(join(resolve(import.meta.dirname, '../../..'), 'fixtures/contract/report.v4/valid-full.json')));
m.key = KEY; m.filed = new Date().toISOString().replace(/\.\d+Z$/, 'Z'); m.filer = FILER;
// The part's own row shows only while its last item shows none (never two rows stacked), so that item opens in place here and stays closed.
m.sections.find((s) => s.id === PART).items.at(-1).more = 'The second screen asked for the password again.';
writeFileSync(join(dir, 'report.json'), JSON.stringify(m));
cli('post', board, '--kind', 'report', '--from', join(dir, 'report.json'), '--filer', FILER);
// A second report, untouched, for the short recording of scrolling and tapping on a phone.
writeFileSync(join(dir, 'report2.json'), JSON.stringify({ ...m, key: REC }));
cli('post', board, '--kind', 'report', '--from', join(dir, 'report2.json'), '--filer', FILER);
if (process.env.SEND_FEEDBACK_ONLY) {
  cli('post', board, '--key', 'send-answer', '--title', 'Ship the settings page?', '--ask-ref', 'message-demo', '--why', 'Umer needs the settings checked.', '--outcome', 'yes=The page ships.', '--outcome', 'no=The page waits.', '--recommend', 'yes', '--recommend-reason', 'The checks passed.', '--default', 'no');
  cli('post', board, '--type', 'evidence', '--title', 'Umer checks the settings page', '--about', 'The settings fit.', '--media', join(repo, 'fixtures/evidence/product-small.png'));
  mkdirSync(join(dir, 'design'));
  for (const f of readdirSync(join(repo, 'fixtures/contract/design.v1/design'))) writeFileSync(join(dir, 'design', f), readFileSync(join(repo, 'fixtures/contract/design.v1/design', f)));
  writeFileSync(join(dir, 'design.json'), readFileSync(join(repo, 'fixtures/contract/design.v1/valid-basic.json')));
  cli('post', board, '--kind', 'design', '--from', join(dir, 'design.json'));
}
const server = spawn(process.execPath, [cliJs, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
// A free port of its own, so another lane's browser bridge on the hashed one never blocks this run.
const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-comment-${theme}-${width}-${process.pid}-${Date.now()}`, CHROME_DEVTOOLS_AXI_PORT: String(port) };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const nap = (ms) => new Promise(r=>setTimeout(r,ms));\nconst wait = async (s) => { for (let i=0;i<100;i++) { if (await page.eval(`!!document.querySelector(${JSON.stringify(s)})`)) return; await nap(100); } throw new Error("Not ready: " + s); };\n' + script }).trim().split('\n').pop();
const page = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn})));`));
const click = (sel, i = 0) => drive(`await page.eval(() => document.querySelectorAll(${JSON.stringify(sel)})[${i}].click()); await nap(400);`);
// Scroll one part so its heading sits under the progress bar, the same place in every capture.
const show = (sel) => drive(`await page.eval(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'start' }); document.querySelector('.gd-scroll').scrollBy(0, -${width === 390 ? 64 : 24}); }); await nap(300);`);
// Where a control is, and whether the 44 px square around its centre lands on it: the tap target, not the drawn size.
const MEASURE = (sel) => `() => [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, hit = [[-21, -21], [21, -21], [-21, 21], [21, 21]].filter(([dx, dy]) => e.contains(document.elementFromPoint(cx + dx, cy + dy))).length;
  return { name: (e.getAttribute('aria-label') || e.title || e.textContent).trim().slice(0, 24), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), hit44: hit === 4 }; })`;
const capture = (name, claim, extra = {}) => {
  const stem = `${name}.${theme}.${width}w`;
  browser('screenshot', join(out, `${stem}.png`));
  const dom = page(`() => { const w = document.documentElement.clientWidth; return { overflow: document.documentElement.scrollWidth > w, overflowing: [...document.querySelectorAll('#reader *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > w + 1).slice(0, 10).map(e => e.tagName.toLowerCase() + '.' + e.className) }; }`);
  assert.equal(dom.overflow, false); assert.deepEqual(dom.overflowing, []);
  const squashed = page(`() => { const ctx = document.createElement('canvas').getContext('2d'), out = []; for (const e of document.querySelectorAll('#reader *')) { const nodes = [...e.childNodes].filter(n => n.nodeType === 3 && n.data.trim()), text = nodes.map(n => n.data).join(' ').trim(), s = getComputedStyle(e); if (!(e instanceof HTMLElement) || !text || !e.getClientRects().length || e.offsetWidth <= 1 || s.visibility !== 'visible') continue; ctx.font = s.font; const chars = e.offsetWidth / (ctx.measureText('abcdefghijklmnopqrstuvwxyz').width / 26), tops = new Set(); for (const n of nodes) { const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width) tops.add(Math.round(b.top)); } if ((chars < 8 && ctx.measureText(text).width > e.offsetWidth + 1) || tops.size > text.split(/\\s+/).length) out.push({element: e.tagName.toLowerCase(), text, chars, lines: tops.size, words: text.split(/\\s+/).length}); } return out; }`);
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
  browser('open', base); browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x860x1', '--color-scheme', theme);
  browser('open', `${base}#reports/${KEY}`);
  ready();
  show(`[data-part="${FOOT}"]`);
  if (before) {
    capture('part-foot-before', 'Before: a part ends with its Details and preset pills; no Agree, Disagree or Comment.', { controls: page(MEASURE(`[data-part="${FOOT}"] > .gd-acts button`)) });
  } else {
  if (!process.env.SEND_FEEDBACK_ONLY) {
  const foot = page(MEASURE(`[data-part="${FOOT}"] > .gd-foot button`));
  assert.deepEqual(foot.map((c) => c.name), ['Agree', 'Disagree', 'Comment', 'Details', 'Ask']);
  assert.ok(foot.every((c) => c.hit44 && c.h >= 32), JSON.stringify(foot));
  assert.ok(new Set(foot.map((c) => c.y)).size === 1, 'one row ' + JSON.stringify(foot));
  capture('part-foot', 'A part ends with one quiet row: Agree, Disagree, Comment, then Details and Ask.', { controls: foot });

  // The sticky step header with the first intro box scrolled under it: opaque, nothing reads through. A desk has no sticky header, so this is the phone's.
  if (width === 390) {

  show('[data-part="this"]'); drive(`await page.eval(() => { const h = document.querySelector('.gd-progress').getBoundingClientRect().bottom, t = document.querySelector('[data-part="this"] h2').getBoundingClientRect(); document.querySelector('.gd-scroll').scrollBy(0, t.top + t.height / 2 - h); }); await nap(300);`);
  const hdr = page(`() => { const h = document.querySelector('.gd-progress'), c = getComputedStyle(h); return { background: c.backgroundColor, backdrop: c.backdropFilter, display: c.display }; }`);
  const alpha = hdr.background.startsWith('rgba') ? +hdr.background.split(',')[3] : 1;
  assert.equal(alpha, 1, JSON.stringify(hdr));
  capture('step-header', 'The sticky step header is solid: a line of body text is cut off cleanly at its bottom edge and none of it shows through.', { header_background: hdr.background, header_alpha: alpha });
  }
  // The foot at the bottom of the screen, so the menu that opens upward from it is whole on screen.
  drive(`await page.eval(() => { document.querySelector('[data-part="${PART}"] > .gd-foot').scrollIntoView({ block: 'end' }); document.querySelector('.gd-scroll').scrollBy(0, 40); }); await nap(300);`);
  click(`[data-part="${PART}"] > .gd-foot .gd-more`);
  const menu = page(MEASURE(`[data-part="${PART}"] > .gd-foot .gd-menu button`));
  ['Ask a question', 'Go deeper', 'Simplify this', 'Show an example', 'Why?'].forEach((l, i) => assert.ok(menu[i].name.startsWith(l), `${l} is menu item ${i + 1}`));
  assert.ok(menu.every((c) => c.h >= 44 && c.hit44), JSON.stringify(menu));
  capture('ask-menu', 'The Ask menu lists the five asks, each row 44 px tall.', { items: menu });
  click(`[data-part="${PART}"] > .gd-foot .gd-menu button.question`);
  assert.equal(page(`() => document.querySelector('[data-part="${PART}"] > .gd-cbox textarea').placeholder`), 'Ask about this part');
  click(`[data-part="${PART}"] > .gd-cbox .gd-cbar .gd-q`);

  }
  // Disagree opens the comment box: What is off?
  click(`[data-part="${PART}"] > .gd-foot .disagree`);
  assert.equal(page(`() => document.querySelector('[data-part="${PART}"] > .gd-cbox textarea').placeholder`), 'What is off?');
  drive(`await page.eval(() => document.querySelector('[data-part="${PART}"] > .gd-cbox').scrollIntoView({ block: 'center' })); await nap(300);`);
  const box = page(MEASURE(`[data-part="${PART}"] > .gd-cbox .gd-cbar button`));
  assert.ok(box.every((c) => c.hit44), JSON.stringify(box));
  const empty = page(`() => document.querySelector('[data-part="${PART}"] > .gd-cbox').getBoundingClientRect().top`);
  capture('disagree-box', 'Tapping Disagree opens the comment box asking What is off?, with Cancel and Send.', { question: 'What is off?', controls: box, box_top: Math.round(empty) });
  const TEXT = 'The 6-second limit is short for a cold start. Did it also hang with 30 seconds?';
  drive(`await page.eval(() => { const t = document.querySelector('[data-part="${PART}"] > .gd-cbox textarea'); t.value = ${JSON.stringify(TEXT)}; t.dispatchEvent(new Event('input', { bubbles: true })); }); await nap(200);`);

  capture('comment-typing', 'The report section keeps the typed comment beside Send.');
  if (!process.env.SEND_FEEDBACK_BEFORE) {
  // Hold the real request at the browser boundary, as on a slow connection. The first attempt loses its connection.
  drive(`await page.eval(() => { const real = window.realCommentFetch ??= window.fetch; window.fetch = (url, options) => url === '/api/annotations' ? new Promise((ok, no) => { window.releaseComment = () => ok(real(url, options)); window.failComment = () => no(new Error('Connection interrupted')); }) : real(url, options); });`);
  const feedback = `[data-send-feedback="part:${KEY}:${PART}"]`;
  const instant = page(`() => { document.querySelector('[data-part="${PART}"] > .gd-cbox .gd-send').click(); return document.querySelector('${feedback}')?.textContent; }`);
  assert.equal(instant, 'Sending…', 'Send must answer in the same frame');
  capture('comment-sending', 'Send answers immediately with Sending…, before the real request completes.');
  drive(`await page.eval(() => window.failComment()); await nap(200);`);
  assert.match(page(`() => document.querySelector('${feedback}').textContent`), /Not sent · Connection interrupted.*Retry/);
  assert.equal(page(`() => document.querySelector('[data-part="${PART}"] > .gd-cbox textarea').value`), TEXT);
  capture('comment-not-sent', 'Not sent gives the connection error and Retry, keeping all the words.');
  click(`${feedback} button`);
  assert.equal(page(`() => document.querySelector('${feedback}').textContent`), 'Sending…');
  drive(`await page.eval(() => window.releaseComment()); await wait('.gd-cmt'); await nap(200);`);
  assert.match(page(`() => document.querySelector('${feedback}').textContent`), /^Sent · [0-9]{2}:[0-9]{2}$/);
  assert.equal(page(`() => document.querySelector('[data-part="${PART}"] > .gd-cbox textarea').value`), '');
  assert.ok(page(`() => document.querySelector('.gd-top .thread')?.textContent.includes(${JSON.stringify(TEXT)})`), 'The report Activity updates immediately');
  capture('comment-receipt', 'Sent gives the time, clears the box, and the comment is already in the report Activity.');
  const raw = readFileSync(join(dir, 'board.annotations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(raw.length, 1); assert.deepEqual([raw[0].key, raw[0].part, raw[0].verdict, raw[0].text], [KEY, PART, 'disagree', TEXT]);
  assert.match(page(`() => document.querySelector('[data-part="${PART}"] > .gd-thread').innerText`), /Sent\s+[0-9]{2}:[0-9]{2}/);
  assert.equal(page(`() => document.querySelector('[data-part="${PART}"] > .gd-foot .disagree').getAttribute('aria-pressed')`), 'true');
  show(`[data-part="${PART}"]`);
  capture('comment-sent', 'A sent comment shows under its part with Sent to the agent, and Disagree shows as chosen.', { page_shows: page(`() => document.querySelector('[data-part="${PART}"] > .gd-thread').innerText.replace(/\\s+/g, ' ')`), disagree_pressed: true, saved_line: raw[0] });

  }
  if (process.env.SEND_FEEDBACK_ONLY) {
    // Every composer uses the same pending/receipt/retry path; transport faults never reach the real server.
    const cases = [
      ['card-comment', '#evidence/update-1', '.other.comment textarea', '.other.comment button[aria-label^="Send without answering"]', 'card:update-1', '/api/messages'],
      ['change-note', '#designs/chat-journeys', '.dz-ctl textarea', '.dz-change', 'design:chat-journeys', '/api/answers'],
      ['answer-note', '#decide/send-answer', '.note-box', '.decide-bar .answer', 'card:send-answer', '/api/answers']
    ];
    for (const [name, hash, field, button, id, path] of cases) {
      browser('open', `${base}${hash}`);
      drive(`await wait('${field}'); await page.eval(() => { document.querySelectorAll('details.other.comment, details.more-menu').forEach(e => e.open = true); document.querySelector('.pick-option')?.click(); const t = document.querySelector('${field}'); t.value = 'Umer needs the settings checked'; t.dispatchEvent(new Event('input', { bubbles: true })); t.scrollIntoView({ block: 'center' }); const real = window.realCommentFetch ??= window.fetch; window.fetch = (url, options) => url === '${path}' ? new Promise((ok, no) => { window.releaseComment = () => ok(real(url, options)); window.failComment = () => no(new Error('Connection interrupted')); }) : real(url, options); });`);
      if (process.env.SEND_FEEDBACK_BEFORE) { capture(name, name + ': before sending, the note is typed.'); continue; }
      const line = `[data-send-feedback="${id}"]`;
      assert.equal(page(`() => { document.querySelector('${button}').click(); return document.querySelector('${line}').textContent; }`), 'Sending…', name);
      drive('await page.eval(() => window.failComment()); await nap(200);');
      assert.match(page(`() => document.querySelector('${line}').textContent`), /Not sent.*Retry/, name);
      assert.equal(page(`() => document.querySelector('${field}').value`), 'Umer needs the settings checked', name);
      click(`${line} button`);
      assert.equal(page(`() => document.querySelector('${line}').textContent`), 'Sending…', name);
      drive(`await page.eval(() => window.releaseComment()); await nap(800);`);
      if (name === 'answer-note') { browser('open', `${base}#decide/send-answer`); drive(`await wait('${line}');`); }
      drive(`for (let i = 0; i < 100; i++) { if (await page.eval(() => document.querySelector('${line}')?.textContent.startsWith('Sent ·'))) break; await nap(100); }`);
      assert.match(page(`() => document.querySelector('${line}')?.textContent`), /^Sent · [0-9]{2}:[0-9]{2}$/, name);
      if (name !== 'answer-note') assert.equal(page(`() => document.querySelector('${field}').value`), '', name + ' clears the box');
      assert.ok(page(`() => document.querySelector('.thread')?.textContent.includes('Umer needs the settings checked')`), name + ' Activity');
      capture(name, name + ': Sending immediately, failure retains the note with Retry, success reaches Activity.');
    }
    if (width === 390 && !process.env.SEND_FEEDBACK_BEFORE) {
      const list = join(records, `comment-send.${theme}.frames.txt`);
      writeFileSync(list, ['comment-typing', 'comment-sending', 'comment-not-sent', 'comment-receipt'].map(n => `file '${join(out, `${n}.${theme}.${width}w.png`)}'\nduration 1\n`).join(''));
      run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'scale=390:-2', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', join(out, `comment-send.${theme}.mp4`)]);
    }
    writeFileSync(join(out, `send-regression.${theme}.${width}w.json`), JSON.stringify({ report: 'Sending in same frame; failure preserves text; Retry saves exactly once; clears box; Activity updates', composers: cases.map(c => c[0]), result: process.env.SEND_FEEDBACK_BEFORE ? 'BEFORE' : 'PASS' }, null, 2));
  }
  if (!process.env.SEND_FEEDBACK_ONLY) {
  // The author agent takes it with wait --filer, then replies; the page follows.
  const event = JSON.parse(cli('wait', board, '--filer', FILER, '--events', '--timeout', '20').trim().split('\n')[0]);
  assert.deepEqual([event.event, event.key, event.part, event.verdict, event.text], ['comment', KEY, PART, 'disagree', TEXT]);
  writeFileSync(join(records, `wait-event.${theme}.${width}w.json`), JSON.stringify(event, null, 1));
  drive("await wait('.gd-cmt .ui-trail li.on:nth-child(3)');");
  assert.match(page(`() => document.querySelector('[data-part="${PART}"] > .gd-thread .ui-trail').innerText`), /Read\s+\d\d:\d\d/);
  capture('comment-read', 'After the agent takes it, the track under the comment reads Sent, Delivered and Read, each with its time.');
  const REPLY = 'Yes. With 30 seconds it still hung; with the input closed it ended in 0.8 s.';
  cli('deeper', board, '--filer', FILER, '--id', event.id, '--text', REPLY);
  drive("await wait('.gd-cmt.agent');");
  assert.match(page(`() => document.querySelector('[data-part="${PART}"] > .gd-thread').innerText`), new RegExp(REPLY.slice(0, 20)));
  show(`[data-part="${PART}"]`);
  capture('comment-reply', "The agent's reply appears under the comment.");

  // Agree is one tap, saved at once, and an item has the same row (its Agree and Disagree are icons).
  click(`[data-part="${PART}"] .rowbtn`);
  const item = page(MEASURE(`[data-part="${PART}"] .gd-rows li:first-child .gd-foot button`));
  assert.ok(item.length >= 4 && item.every((c) => c.hit44), JSON.stringify(item));
  click(`[data-part="${PART}"] .gd-rows li:first-child .gd-foot .agree`);
  drive(`await wait('[data-part="${PART}"] .gd-rows li:first-child .agree[aria-pressed="true"]');`);
  const agreed = readFileSync(join(dir, 'board.annotations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.part === ITEM);
  assert.deepEqual(agreed.map((l) => l.verdict), ['agree']);
  drive(`await page.eval(() => document.querySelector('[data-part="${PART}"] .gd-rows li:first-child').scrollIntoView({ block: 'center' })); await nap(300);`);
  capture('item-agree', 'An item has the same row with Agree and Disagree as icons; a tapped Agree stays chosen and is saved.', { controls: item, agree_pressed: true, saved: agreed[0] });
  if (theme === 'light' && width === 390) {
    // A sampled-frame recording through the same browser: scroll down the report, tap Agree, open Ask, tap Disagree, type and send. One frame per beat, held a moment.
    const rec = join(records, 'recording'); mkdirSync(rec, { recursive: true });
    let n = 0; const frame = () => browser('screenshot', join(rec, `${String(++n).padStart(3, '0')}.png`));
    browser('open', `${base}#reports/${REC}`); ready();
    for (let i = 0; i < 6; i++) { frame(); drive(`await page.eval(() => document.querySelector('.gd-scroll').scrollBy(0, 420)); await nap(350);`); }
    show('[data-part="this"]'); drive(`await page.eval(() => document.querySelector('.gd-scroll').scrollBy(0, 480)); await nap(300);`); frame();
    click('[data-part="this"] > .gd-foot .agree'); drive(`await wait('[data-part="this"] > .gd-foot .agree[aria-pressed="true"]');`); frame();
    show('[data-part="found"]'); drive(`await page.eval(() => document.querySelector('.gd-scroll').scrollBy(0, 500)); await nap(300);`); frame();
    drive(`await page.eval(() => { document.querySelector('[data-part="found"] > .gd-foot').scrollIntoView({ block: 'end' }); document.querySelector('.gd-scroll').scrollBy(0, 40); }); await nap(300);`);
    click('[data-part="found"] > .gd-foot .gd-more'); frame();
    click('[data-part="found"] > .gd-foot .gd-more'); click('[data-part="found"] > .gd-foot .disagree'); frame();
    drive(`await page.eval(() => { const t = document.querySelector('[data-part="found"] > .gd-cbox textarea'); t.value = 'Did it also hang with 30 seconds?'; t.dispatchEvent(new Event('input', { bubbles: true })); }); await nap(200);`); frame();
    click('[data-part="found"] > .gd-cbox .gd-send'); drive("await wait('[data-part=\"found\"] > .gd-thread .gd-cmt');"); frame(); frame();
    const list = join(rec, 'frames.txt');
    writeFileSync(list, readdirSync(rec).filter((f) => /^\d+\.png$/.test(f)).sort().map((f) => `file '${join(rec, f)}'\nduration 0.9\n`).join(''));
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'scale=390:-2', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', join(out, 'scroll-and-tap.mp4')]);
  }
  }
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board holding one guided report, filed by agent-41.',
    steps: [`The report is opened at ${width} px wide, ${theme}, and a part is scrolled into view.`, ...(width === 390 ? ['The page is scrolled so body text passes under the sticky step header: the header is opaque and no text reads through it.'] : []), 'The part ends with one row: Agree, Disagree, Comment, Details and Ask, each a 44 px tap target.', 'The person taps Ask: the Ask menu lists Ask a question, Go deeper, Simplify this, Show an example and Why?.',
      'The person taps Disagree: the comment box opens asking What is off?, with Cancel and Send.', 'The person types a comment and taps Send: it sits under the part with Sent to the agent.', 'The author agent takes it with wait --filer: the line reads Agent read it.', 'The agent replies with deeper: the reply shows under the comment.', 'The person opens an item and taps Agree: it stays chosen and is saved.'],
    result: 'Each part ends with Agree, Disagree, Comment, Details and Ask, every control a 44 px tap target; the Ask menu lists the five asks; Disagree asks What is off?; a sent comment shows Sent to the agent, then Agent read it and the reply; an item has the same row and Agree is saved at once; the sticky step header is opaque.' }, null, 2) + '\n');
  }
} finally {
  try { browser('stop'); } catch {}
  // Stop asynchronously so Node can reap the foreground server while stop checks that it exited.
  await new Promise((ok, no) => { const stop = spawn(process.execPath, [cliJs, 'stop', board], { env, stdio: 'ignore' }); stop.once('exit', c => c === 0 ? ok() : no(new Error('Isolated board did not stop'))); });
  rmSync(dir, { recursive: true, force: true }); // its own mkdtemp board and nothing else
}
