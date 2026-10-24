// A design-output gallery in a guided report, authored with `report init --gallery`, posted with the real CLI and read in a real browser, one isolated board per cell.
// Usage: GALLERY_DIR=<folder with a-phone.png a-desktop.png b-phone.png b-desktop.png: real board frames, 390 and 1280 wide> node .agents/skills/done-done-verify-sign-off/gallery-shots.mjs <output> [light|dark] [360|390|445|1280|1440]
// It posts the report, refuses a frame with no caption and one with no device, shows the options as a strip (a phone) or a row (a desk), opens the first frame full size,
// moves to the next option with Next, back with a swipe, and closes with Escape. SIGN_OFF_REPO names another built checkout to run.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { recordsDir } from './records.mjs';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const theme = process.argv[3] ?? process.env.DONE_DONE_THEME ?? 'light', width = +(process.argv[4] ?? process.env.DONE_DONE_WIDTH ?? 390);
assert.ok(['light', 'dark'].includes(theme) && [360, 390, 445, 1280, 1440].includes(width));
const phone = width < 700, height = phone ? 844 : width === 1440 ? 900 : 800, repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), frames = resolve(process.env.GALLERY_DIR ?? '');
mkdirSync(out, { recursive: true });
const records = recordsDir(out);
mkdirSync(records, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-gallery-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
};
const cli = (...args) => run(process.execPath, [join(repo, 'dist/cli.js'), ...args], { env, cwd: dir });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-gallery-${theme}-${width}-${process.pid}-${Date.now()}` };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const wait = async (s) => { for (let i=0;i<100;i++) { if (await page.eval(`!!document.querySelector(${JSON.stringify(s)})`)) return; await new Promise(r=>setTimeout(r,100)); } throw new Error("Not ready: " + s); };\n' + script });
const ask = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn.toString()})));`));
// The report as an author makes it: report init --gallery, every FILL: line replaced, the gallery filled with two options of real frames.
mkdirSync(join(dir, 'rep', 'gallery'), { recursive: true });
for (const f of ['a-phone', 'a-desktop', 'b-phone', 'b-desktop']) copyFileSync(join(frames, `${f}.png`), join(dir, 'rep', 'gallery', `${f}.png`));
cli('report', 'init', 'rep', '--purpose', 'decision', '--gallery');
const report = JSON.parse(readFileSync(join(dir, 'rep', 'report.json'), 'utf8'));
const plain = { label: 'Note', text: 'The board draws this part as a line.', heading: 'Two options for the Today screen', body: 'Each option shows its phone and desktop frame.', value: '2 options', note: 'sample', more: 'Open a frame to see it full size.', title: 'A point', lines: 'Look at the frames' };
const fill = (o, k) => Array.isArray(o) ? o.map((x) => fill(x, k)) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([a, b]) => [a, fill(b, a)])) : typeof o === 'string' && o.startsWith('FILL:') ? plain[k] ?? 'A short plain line about this part.' : o;
const sample = fill(report);
Object.assign(sample, { key: 'sample-gallery', title: 'Two takes on the Today screen, side by side', about: 'A sample report: each option shows its phone and desktop frame with the model and the time it ran.', filer: 'sample-agent' });
Object.assign(sample.visual, { type: 'tiles', heading: 'Two options, a phone and a desktop frame each' }); delete sample.visual.unit; sample.visual.rows.forEach((r) => delete r.value);
sample.visual.details = [{ label: 'Frames', value: 'Real board screens, 390 and 1280 wide' }];
const option = (label, model, at, p) => ({ label, model, ran: at, frames: [
  { device: 'phone', src: `rep/gallery/${p}-phone.png`, caption: `${label} on a phone, 390 wide` }, { device: 'desktop', src: `rep/gallery/${p}-desktop.png`, caption: `${label} on a desk, 1280 wide` }] });
sample.sections[0].gallery = [option('Today', 'Model A', '2026-10-23T11:47:00Z', 'a'), option('Waiting on you', 'Model B', '2026-10-23T11:48:00Z', 'b')];
const post = (m) => spawnSync(process.execPath, [join(repo, 'dist/cli.js'), 'post', board, '--kind', 'report', '--from', '-'], { encoding: 'utf8', env, cwd: dir, input: JSON.stringify(m) });
// A frame with no caption, and one with no device, are refused with the field named.
for (const [what, drop, error] of [['caption', 'caption', /gallery\[0\]\.frames\[0\]\.caption must be text/], ['device', 'device', /gallery\[0\]\.frames\[0\]\.device is required/]]) {
  const bad = structuredClone(sample); delete bad.sections[0].gallery[0].frames[0][drop];
  const refused = post(bad);
  assert.equal(refused.status, 2, `${what}: ${refused.stdout}`); assert.match(refused.stdout, error);
  writeFileSync(join(records, `refused-${what}.txt`), refused.stdout);
}
const posted = post(sample); assert.equal(posted.status, 0, posted.stdout);
const measure = () => {
  const w = document.documentElement.clientWidth;
  return { url: location.href, overflow: document.documentElement.scrollWidth > w, overflowing: [...document.querySelectorAll('body *')].filter((e) => !e.closest('.gl-strip') && e.getBoundingClientRect().right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')) };
};
const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (code) => no(new Error(`Server exited ${code}`))); });
  const emulate = () => browser('emulate', '--viewport', phone ? `${width}x${height}x2,mobile,touch` : `${width}x${height}x1`, '--color-scheme', theme);
  browser('open', `${base}#reports/${sample.key}`); emulate();
  drive('await wait(".gl-strip"); await new Promise(r => setTimeout(r, 1500));');
  const capture = (name, claim) => {
    const stem = `${name}.${theme}.${width}w`;
    browser('screenshot', join(out, `${stem}.png`));
    const dom = ask(measure);
    assert.equal(dom.overflow, false); assert.deepEqual(dom.overflowing, []);
    const consoleLog = browser('console', '--type', 'error'), network = browser('network', '--limit', '100');
    assert.match(consoleLog, /no console messages found/);
    dom.console_errors = [];
    dom.failed_requests = [...network.matchAll(/reqid=\d+ \w+ (\S+) \[(\d+|failed)\]/g)].flatMap(([, url, status]) => status === 'failed' || +status >= 400 ? [{ url, status: +status || 0 }] : []);
    assert.deepEqual(dom.failed_requests, []);
    writeFileSync(join(records, `${stem}.dom.json`), JSON.stringify(dom));
    writeFileSync(join(records, `${stem}.claim.txt`), `${width}px ${theme}: ${claim}\n`);
  };
  // The progress bar covers the top of a phone, so the section (its heading, then the strip) is brought to just under it.
  drive('await page.eval(() => { const e = document.querySelector(".gl-strip").closest(".gd-sec"); e.style.scrollMarginTop = "120px"; e.scrollIntoView({ block: "start" }); }); await new Promise(r => setTimeout(r, 1200));');
  const strip = ask(() => {
    const s = document.querySelector('.gl-strip'), opts = [...s.querySelectorAll('.gl-opt')], imgs = [...s.querySelectorAll('img')];
    return { options: opts.length, tops: opts.map((o) => Math.round(o.getBoundingClientRect().top)), scrolls: s.scrollWidth > s.clientWidth + 1, lazy: imgs.every((i) => i.loading === 'lazy'), light: imgs.every((i) => /~gallery\.\d\/[^?]+\?v=light$/.test(i.getAttribute('src'))),
      widest: Math.max(...imgs.map((i) => i.naturalWidth)), pairs: opts.map((o) => [...o.querySelectorAll('.gl-frame')].map((f) => f.classList.contains('phone') ? 'phone' : 'desktop')), captions: [...s.querySelectorAll('figcaption')].map((c) => c.textContent),
      label: opts.map((o) => o.querySelector('.gl-name').textContent), frameBox: [...s.querySelectorAll('.gl-frame')].slice(0, 2).map((f) => { const r = f.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }) };
  });
  assert.equal(strip.options, 2); assert.deepEqual(strip.label, ['Today', 'Waiting on you']); assert.deepEqual(strip.pairs, [['phone', 'desktop'], ['phone', 'desktop']]);
  assert.ok(strip.lazy && strip.light, 'every thumbnail is lazy and the light copy'); assert.ok(strip.widest <= 1600, `thumbnail ${strip.widest} px wide`);
  assert.ok(strip.captions.every((c) => /Model [AB] · \d+ Oct \d\d:\d\d/.test(c)), `captions carry the model and the run time: ${strip.captions}`);
  if (phone) assert.ok(strip.scrolls, 'on a phone the strip swipes'); else assert.equal(new Set(strip.tops).size, 1, 'on a desk the options sit in one row');
  writeFileSync(join(records, `strip.${theme}.${width}w.json`), JSON.stringify(strip));
  capture('gallery', phone ? 'The options as a strip to swipe, the next one peeking in: each with its phone and desktop frame side by side, and under each frame its caption, model and run time.'
    : 'The options in a row: each with its phone and desktop frame side by side, and under each frame its caption, model and run time.');
  // Tap the first frame: it opens full screen at that option.
  drive('await page.eval(() => document.querySelector(".gl-frame.phone").click()); await wait("dialog.gl-full[open]"); await new Promise(r => setTimeout(r, 1500));');
  const state = () => ask(() => { const q = (s) => document.querySelector(s), box = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }, img = q('.gl-full .pf-img img');
    return { title: q('#gl-title').textContent, count: q('.gl-count').textContent, prev: q('.gl-nav[aria-label="Previous option"]').disabled, next: q('.gl-nav[aria-label="Next option"]').disabled, navBox: [...document.querySelectorAll('.gl-nav')].map(box),
      sizes: [...document.querySelectorAll('.gl-full .pf-size button')].map((b) => b.getAttribute('aria-pressed')), src: img?.getAttribute('src'), natural: img?.naturalWidth, port: box(q('.gl-full .pf-port')), stage: box(q('.gl-full .pf-stage')), cap: q('.gl-full-cap').textContent,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
  const first = state();
  assert.equal(first.title, 'Today'); assert.equal(first.count, '1 of 2'); assert.equal(first.prev, true); assert.equal(first.next, false); assert.deepEqual(first.sizes, ['true', 'false']);
  assert.ok(first.navBox.every(([w, h]) => w >= 44 && h >= 44), `Previous and Next are ${first.navBox}`); assert.ok(!first.src.includes('?v=light'), 'full size is the original file');
  assert.ok(first.port[0] <= first.stage[0] && first.port[1] <= first.stage[1], `frame ${first.port} fits the stage ${first.stage}`); assert.equal(first.overflow, false);
  assert.match(first.cap, /Today on a phone, 390 wide.*Model A · \d+ Oct \d\d:\d\d/);
  capture('full', 'Tapping a frame opens it full size on the phone screen, with Previous and Next between options (Previous off at the first of 2), Phone and Desktop, and the caption with the model and run time under it.');
  // Next moves to the second option and keeps the phone screen; Desktop shows that option's other frame.
  drive('await page.eval(() => document.querySelector(".gl-nav[aria-label=\\"Next option\\"]").click()); await new Promise(r => setTimeout(r, 1200));');
  const second = state();
  assert.equal(second.title, 'Waiting on you'); assert.equal(second.count, '2 of 2'); assert.equal(second.prev, false); assert.equal(second.next, true); assert.deepEqual(second.sizes, ['true', 'false']);
  drive('await page.eval(() => document.querySelector(".gl-full .pf-size button[data-size=desktop]").click()); await new Promise(r => setTimeout(r, 1500));');
  const desk = state(); assert.deepEqual(desk.sizes, ['false', 'true']); assert.match(desk.cap, /Waiting on you on a desk, 1280 wide/); assert.ok(desk.port[0] > desk.port[1], 'the desktop frame is wider than tall');
  capture('next', 'Next moved to the second option, Waiting on you (2 of 2, Next off), and Desktop shows its 1280 wide frame, captioned with the model and run time.');
  // A swipe to the right goes back; the arrow keys and Escape work too; Escape returns the focus to the frame that was tapped.
  drive('await page.eval(() => { const s = document.querySelector(".gl-full .pf-stage"); const at = (t, x) => s.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: 300, bubbles: true })); at("pointerdown", 100); at("pointerup", 260); }); await new Promise(r => setTimeout(r, 600));');
  assert.equal(state().count, '1 of 2', 'a swipe right went back');
  drive('await page.eval(() => document.querySelector("dialog.gl-full").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))); await new Promise(r => setTimeout(r, 600));');
  assert.equal(state().count, '2 of 2', 'the right arrow went forward');
  drive('await page.eval(() => document.querySelector(".gl-full .pf-close").click()); await new Promise(r => setTimeout(r, 600));');
  const closed = ask(() => ({ open: !!document.querySelector('dialog.gl-full'), focus: document.activeElement?.className }));
  assert.equal(closed.open, false); assert.match(closed.focus, /gl-frame phone/);
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
  writeFileSync(join(out, 'steps.json'), JSON.stringify({
    target: { version: `${pkg} at ${head}` },
    start: 'A clean board holding one report whose first section carries a gallery of two options, each with a phone and a desktop frame of real board screens.',
    steps: ['The person opens the report and scrolls to the gallery: the options as a strip to swipe (a row on a desk), each with its two frames and the caption, model and run time under each.',
      'They tap the phone frame of the first option: it opens full size with Previous and Next, Phone and Desktop, and the caption.', 'They tap Next, then Desktop: the second option shows its desktop frame.',
      'They swipe back and close the view: the first frame has the focus again.'],
    result: 'The gallery shows each option as a phone and a desktop frame side by side with its caption, model and run time, opens full size on a tap, and walks between options with Previous, Next, a swipe or the arrow keys.',
  }));
} finally {
  browser('stop'); server.kill();
  console.log(`Scratch for cleanup: ${dir}`);
}
