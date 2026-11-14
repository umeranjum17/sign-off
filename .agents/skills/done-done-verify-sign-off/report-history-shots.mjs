// Sanitized reported history through the real CLI and board; original caller inputs were unavailable.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
const out = resolve(process.argv[2]), dir = mkdtempSync(join(tmpdir(), 'so-history-'));
mkdirSync(out, { recursive: true });
const env = { ...process.env, PATH: '/usr/bin:' + process.env.PATH, HOME: dir, SIGN_OFF_HOME: dir,
  XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
for (const name of ['SIGN_OFF_FILER', 'CLAUDE_CODE_SESSION_ID']) delete env[name];
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-history-${process.pid}`, CHROME_DEVTOOLS_AXI_BRIDGE_TIMEOUT_MS: '90000' };
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const cli = (...args) => run(process.execPath, [resolve('dist/cli.js'), ...args], { env });
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const read = (fn) => JSON.parse(run('chrome-devtools-axi', ['run'], { env: browserEnv, input: `console.log(JSON.stringify(await page.eval(${fn})));` }).trim().split('\n').at(-1));
const settle = () => read('async () => { await new Promise(r => setTimeout(r, 700)); await document.fonts.ready; return true; }');
const fixture = JSON.parse(readFileSync('fixtures/report-history.json')), baseReport = JSON.parse(readFileSync('fixtures/contract/report.v5/valid-minimal.json'));
const records = []; let board;
const focusVersion = () => { read('() => { const s=document.querySelector(".gd-scroll"), v=document.querySelector(".rda-ver"), p=document.querySelector(".gd-progress"), h=document.querySelector("#reader > header"); s.scrollTop += v.getBoundingClientRect().top - (p.getClientRects().length ? p.getBoundingClientRect().bottom : h.getBoundingClientRect().bottom) - 16; return true; }'); settle(); };
const file = (name, data) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(data)); return p; };
const shot = (name) => {
  const consoleLog = browser('console', '--type', 'error');
  writeFileSync(join(out, name + '.console.txt'), consoleLog);
  const check = read(`() => { const w = document.documentElement.clientWidth, visible = [...document.querySelectorAll('#reader *')].filter(e => e.getClientRects().length); return { url: location.href, overflow: document.documentElement.scrollWidth > w, overflowing: visible.filter(e => e.getBoundingClientRect().right > w + 1).map(e => e.tagName), console_errors: [], failed_requests: performance.getEntriesByType('resource').filter(r => r.responseStatus >= 400).map(r => ({url:r.name,status:r.responseStatus})), squashed_text: (() => { const ctx = document.createElement('canvas').getContext('2d'), out = []; for (const e of document.querySelectorAll('body *')) { const nodes = [...e.childNodes].filter(n => n.nodeType === 3 && n.data.trim()), text = nodes.map(n => n.data).join(' ').replace(/\\s+/g, ' ').trim(), s = getComputedStyle(e), w = e.offsetWidth, h = e.offsetHeight; if (!(e instanceof HTMLElement) || !text || !e.getClientRects().length || ((w <= 1 || h <= 1) && s.overflow !== 'visible') || s.visibility !== 'visible') continue; ctx.font = s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily; const chars = w / (ctx.measureText('abcdefghijklmnopqrstuvwxyz').width / 26), words = text.split(' ').length, tops = new Set(); for (const n of nodes) { const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width) tops.add(Math.round(b.top)); } if ((chars < 8 && ctx.measureText(text).width > w + 1) || tops.size > words) out.push({ element: e.tagName.toLowerCase(), report_version: !!e.closest('.rda-ver'), text: text.slice(0, 40), chars, lines: tops.size, words }); } return out; })(), scroll_containers: visible.filter(e => e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)).length, version: document.querySelector('.rda-vmeta')?.textContent, options: [...document.querySelector('[aria-label="Report version"]').options].map(o => o.text), history: [...document.querySelectorAll('.rda-ver summary')].map(e => e.textContent) }; }`);
  check.console_errors = /No console messages|messages\[0\]|messages: \[\]/i.test(consoleLog) ? [] : [consoleLog];
  assert.deepEqual(check.squashed_text.filter(e => e.report_version), []); assert.deepEqual(check.failed_requests, []);
  assert.ok(read('() => [...document.querySelectorAll(".rda-ver select, .rda-ver summary")].every(e => e.getBoundingClientRect().height >= 44)'));
  assert.equal(check.overflow, false); assert.deepEqual(check.overflowing, []); assert.deepEqual(check.console_errors, []);
  browser('screenshot', join(out, name + '.png')); writeFileSync(join(out, name + '.dom.json'), JSON.stringify(check, null, 2)); records.push(check);
};
try {
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
    board = join(dir, `board-${width}-${theme}.json`);
    const drafts = fixture.drafts.map(({ version, title, rows }) => ({ ...baseReport, key: fixture.key, title, filer: 'Umer', filed: '2020-01-01T02:00:00Z', actions: { ...baseReport.actions, owner: 'Umer' },
      about: `The review has ${rows} rows.`, ...(version > 1 && { version, changes: [{ kind: 'added', text: `The review now has ${rows} rows` }] }) }));
    const post = (m) => cli('raise', board, '--from', file('feed.json', { schema: 2, items: [m] }));
    post(drafts[0]); cli('dismiss', fixture.key, board, '--reason', 'replaced');
    await new Promise(r => setTimeout(r, 10100)); // The real discard survives the ten-second Undo window.
    post(drafts[1]); post(drafts[1]);
    const base = /url: "([^\"]+)"/.exec(cli('open', board, '--port', '0'))[1];
    browser('open', base); browser('emulate', '--viewport', `${width}x${width === 390 ? 844 : 800}x1${width === 390 ? ',mobile,touch' : ''}`, '--color-scheme', theme);
    browser('open', `${base}#reports/${fixture.key}`); settle();
    assert.match(read('() => document.querySelector(".rda-vmeta")?.textContent'), /^Version 3/);
    assert.ok(read('() => document.querySelector("#reader").textContent.includes("Version 1 discarded")'));
    shot(`report-before-v3.${theme}.${width}w`);
    const companion = { ...baseReport, key: fixture.companion, filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
    post(companion);
    cli('post', board, '--from', file('replace.json', { schema: 2, items: [drafts[2], companion] }), '--replace');
    cli('post', board, '--kind', 'report', '--from', file('retry.json', drafts[2]));
    browser('open', 'about:blank');
    browser('open', `${base}#reports/${fixture.key}`); settle();
    const live = await (await fetch(`${base}api/decisions?view=card&key=${fixture.key}`)).json();
    assert.equal(live.card.key, fixture.key); assert.ok(!live.dismissed.includes(fixture.key)); assert.equal(live.card.version, 5);
    assert.deepEqual(read('() => [...document.querySelector(".rda-ver select").options].map(o => +o.value)'), [5, 3, 1]);
    focusVersion();
    shot(`report-current-v5.${theme}.${width}w`);
    const motion = width === 390 && theme === 'light';
    if (motion) browser('perf-start', '--no-reload', '--no-auto-stop');
    read('() => { const s=document.querySelector(".rda-ver select"); s.value="3"; s.dispatchEvent(new Event("change")); return true; }'); settle();
    assert.match(read('() => document.querySelector("#reader h1").textContent'), /with checks/);
    assert.equal(read('() => document.querySelectorAll(".rda, .ra-bar").length'), 0, 'a historical document has no decision or comment actions');
    focusVersion();
    shot(`report-earlier-v3.${theme}.${width}w`);
    read('() => { const s=document.querySelector(".rda-ver select"); s.value="1"; s.dispatchEvent(new Event("change")); return true; }'); settle();
    assert.equal(read('() => document.querySelectorAll(".rda-diff li").length'), 0, 'the first version inherits no later change notes');
    if (motion) { focusVersion(); shot('report-original-v1.light.390w'); }
    read('() => { const s=document.querySelector(".rda-ver select"); s.value="5"; s.dispatchEvent(new Event("change")); return true; }'); settle();
    assert.match(read('() => document.querySelector(".rda-vmeta").textContent'), /^Version 5/);
    if (motion) {
      const trace = join(dir, 'motion.json.gz'); browser('perf-stop', '--file', trace);
      const frames = JSON.parse(gunzipSync(readFileSync(trace))).traceEvents.filter(e => e.name === 'Screenshot'); assert.ok(frames.length > 1);
      frames.forEach((e, i) => writeFileSync(join(dir, `motion-${i}.jpg`), Buffer.from(e.args.snapshot, 'base64')));
      writeFileSync(join(dir, 'motion.ffconcat'), frames.map((e, i) => `file 'motion-${i}.jpg'\nduration ${Math.max(.03, ((frames[i+1]?.ts ?? e.ts+500000)-e.ts)/1e6)}\n`).join(''));
      run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'motion.ffconcat'), '-vf', 'fps=30,scale=390:844:force_original_aspect_ratio=decrease,pad=390:844:(ow-iw)/2:(oh-ih)/2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, 'report-version-switch.mp4')]);
    }
    console.log(`${width} ${theme}: one live v5 card; v3 readable; newest-first picker; retry accepted`);
    browser('stop'); cli('stop', board); board = undefined;
  }
  writeFileSync(join(out, 'report-history.json'), JSON.stringify(records, null, 2));
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync('package.json')).version }, start: 'Sanitized reported v1/v3 discard and unposted v5 with 57 rows; original caller unavailable', steps: ['Open Designs at 1440 dark in the same configured journey', 'Raise v1, discard through the CLI and let Undo expire', 'Raise v3 twice; its single card is live and its earlier discard is version-labelled', 'Post the companion rescan, replace the feed with v5 and retry through contract post', 'Read v5, read the retained v3 and return to v5 at 390 and 1280, light and dark'], result: 'One live report advances to v5, offers versions newest first with change notes, and preserves readable earlier documents' }, null, 2));
} finally {
  try { browser('stop'); } catch {}
  if (board) cli('stop', board);
  rmSync(dir, { recursive: true, force: true });
}
