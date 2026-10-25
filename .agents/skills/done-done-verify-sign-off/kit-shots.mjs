// The report kit in a guided report: every block (callout, beats, video, table, compare, evidence, and the gallery beside them) authored as data, posted with the real CLI and read in a real browser, one isolated board per cell.
// Usage: node .agents/skills/done-done-verify-sign-off/kit-shots.mjs <output> [light|dark] [360|390|445|1280|1440]
// It posts the report, then checks what a reader sees: one gutter and no card inside a card, the stepper's Back and Next and their labels for a screen reader, a film's poster that becomes the player on a tap,
// a table that stacks on a phone, and on a desk a video and gallery that run wider than the reading column. SIGN_OFF_REPO names another built checkout to run.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { recordsDir } from './records.mjs';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const theme = process.argv[3] ?? process.env.DONE_DONE_THEME ?? 'light', width = +(process.argv[4] ?? process.env.DONE_DONE_WIDTH ?? 390);
assert.ok(['light', 'dark'].includes(theme) && [360, 390, 445, 1280, 1440].includes(width));
const phone = width < 700, height = phone ? 844 : width === 1440 ? 900 : 800, repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const records = recordsDir(out);
mkdirSync(records, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-kit-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
};
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-kit-${theme}-${width}-${process.pid}-${Date.now()}` };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const wait = async (s) => { for (let i=0;i<100;i++) { if (await page.eval(`!!document.querySelector(${JSON.stringify(s)})`)) return; await new Promise(r=>setTimeout(r,100)); } throw new Error("Not ready: " + s); };\n' + script });
const ask = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn.toString()})));`));
// The report as an author makes it: the template's shape, a section's blocks named as data, every file next to the board file.
mkdirSync(join(dir, 'kit'), { recursive: true });
const shot = new URL('../../../fixtures/evidence/product-board.png', import.meta.url);
for (const f of ['one', 'two', 'three', 'poster']) copyFileSync(shot, join(dir, 'kit', `${f}.png`));
writeFileSync(join(dir, 'kit', 'film.mp4'), Buffer.alloc(2000, 1));
writeFileSync(join(dir, 'kit', 'report.md'), '# The original report\n');
const report = JSON.parse(readFileSync(new URL('../../../fixtures/contract/report.v5/valid-full.json', import.meta.url), 'utf8'));
const beat = (n, time, title, text) => ({ image: `kit/${n}.png`, time, title, text });
const blocks = [
  { type: 'video', src: 'kit/film.mp4', poster: 'kit/poster.png', length: '0:10', caption: 'The promo, made from real screens and rendered in 27 seconds.' },
  { type: 'callout', tone: 'warn', title: 'Not measured', text: 'How much of the plan\'s usage window this took.' },
  { type: 'beats', beats: [beat('one', '0:00', 'The pain, in a bright studio', 'Floating products, soft window light.'), beat('two', '0:04', 'Real life, blurred', 'A frosted card lists the chores.'), beat('three', '0:11', 'The phone turns in', 'A 3D phone with real screens.')] },
  { type: 'table', columns: ['Measured, 10 s film', 'App promo', 'Cinematic'], rows: [['AI calls', '3', '1'], ['AI time', '4.7 min', '4.2 min'], ['Render', '27 s', '39 s']] },
  { type: 'compare', before: { image: 'kit/one.png', caption: 'A line wrapped badly' }, after: { image: 'kit/two.png', caption: 'Clean after two fix rounds' } },
  { type: 'evidence', rows: [{ image: 'kit/one.png', title: 'Line wrapped, notch hid a heading', note: 'Version 1', status: 'fixed' }, { image: 'kit/two.png', title: 'Words on the floating cards', note: 'Version 2', status: 'progress' }, { title: 'Sound is still missing', note: 'Version 3', status: 'waiting' }] },
];
const flow = process.env.KIT_FLOW === '1';
const documents = process.env.KIT_DOCUMENTS === '1' || flow;
if (documents) blocks.push(
  { type: 'image', src: 'kit/one.png', full: 'kit/two.png', caption: 'The original reference screen', alt: 'The board with example questions' },
  { type: 'file', src: 'kit/report.md', caption: 'Read the full report' },
  { type: 'table', columns: ['Repo', 'Score', 'R1–R10', 'Top 3 gaps', 'First screen'], rows: [
    [{ text: 'sign-off', rowspan: 2 }, '7', { text: 'The original cells, with their span', colspan: 2 }, 'Desktop', 'Phone', 'Light'],
    ['6', '1–10', 'The original ragged row'],
  ] },
);
const sample = { ...report, key: 'sample-kit', title: 'TakeOne can already render launch films like these', about: 'A sample report with every block of the kit, drawn by the board.', filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  sections: report.sections.map((s, n) => n ? s : documents ? { ...s, heading: 'Original reference, file and table', body: 'The source image, its document and its original table.', blocks: blocks.slice(-3) } : { ...s, blocks, gallery: [{ label: 'App promo', model: 'Sonnet 5.5', ran: '2026-10-24T20:12:00Z', frames: [{ device: 'phone', src: 'kit/one.png', caption: 'Today on a phone' }, { device: 'desktop', src: 'kit/two.png', caption: 'The promo on a desk' }] }] }) };
if (flow) {
  sample.schema = 4; sample.layout = 'document'; sample.purpose = 'other';
  for (const field of ['understood', 'visual', 'next']) delete sample[field];
  sample.sections = [{ id: 'original', stage: 'found', heading: '', body: '', blocks: [
    { type: 'text', level: 2, text: 'The original words, in order' },
    { type: 'text', text: 'Read [the original document](kit/report.md), with no added summary or next step.' },
    ...blocks.slice(-3),
    { type: 'beats', beats: [{ title: 'First original step', text: 'An original step without a picture.' }, { title: 'Second original step' }] },
  ] }];
}
const post = (m) => spawnSync(process.execPath, [join(repo, 'dist/cli.js'), 'post', board, '--kind', 'report', '--from', '-'], { encoding: 'utf8', env, cwd: dir, input: JSON.stringify(m) });
// Colour, CSS and an unknown block are refused with the field named.
for (const [what, patch, error] of [['css', { colour: 'blue' }, /blocks\[1\]\.colour is not a field there/], ['type', { type: 'banner' }, /blocks\[1\]\.type \\"banner\\" is not one of callout, beats/]]) {
  const bad = structuredClone(sample); Object.assign(bad.sections[0].blocks[1], patch);
  const refused = post(bad);
  assert.equal(refused.status, 2, `${what}: ${refused.stdout}`); assert.match(refused.stdout, error);
  writeFileSync(join(records, `refused-${what}.txt`), refused.stdout);
}
const posted = post(sample); assert.equal(posted.status, 0, posted.stdout);
const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (code) => no(new Error(`serve exited ${code}`))); });
  browser('open', `${base}#reports/${sample.key}`);
  browser('emulate', '--viewport', phone ? `${width}x${height}x2,mobile,touch` : `${width}x${height}x1`, '--color-scheme', theme);
  drive(`await wait("${documents ? '.kt-image' : '.kt-beats'}"); await new Promise(r => setTimeout(r, 1500));`);
  const measure = () => { const w = document.documentElement.clientWidth; return { url: location.href, overflow: document.documentElement.scrollWidth > w, overflowing: [...document.querySelectorAll('body *')].filter((e) => !e.closest('.gl-strip, .gd-scroll, .kt-scroll') && e.getBoundingClientRect().right > w + 1).slice(0, 5).map((e) => e.className) }; };
  const capture = (name, claim) => {
    const stem = `${name}.${theme}.${width}w`;
    browser('screenshot', join(out, `${stem}.png`));
    const dom = ask(measure);
    assert.equal(dom.overflow, false); assert.deepEqual(dom.overflowing, []);
    assert.match(browser('console', '--type', 'error'), /no console messages found/);
    dom.console_errors = [];
    const network = browser('network', '--limit', '100');
    dom.failed_requests = [...network.matchAll(/reqid=\d+ \w+ (\S+) \[(\d+|failed)\]/g)].flatMap(([, url, status]) => status === 'failed' || +status >= 400 ? [{ url, status: +status || 0 }] : []);
    assert.deepEqual(dom.failed_requests, []);
    writeFileSync(join(records, `${stem}.dom.json`), JSON.stringify(dom));
    writeFileSync(join(records, `${stem}.claim.txt`), `${width}px ${theme}: ${claim}\n`);
  };
  const toTop = (sel) => drive(`await page.eval(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.style.scrollMarginTop = "120px"; e.scrollIntoView({ block: "start" }); }); await new Promise(r => setTimeout(r, 1000));`);
  // The shape: content in one gutter, only the callout a card, and nothing in a card that is a card.
  const shape = ask(() => {
    const sec = document.querySelector('.kt-beats, .kt-image').closest('.gd-sec'), vw = document.documentElement.clientWidth, r = (e) => e.getBoundingClientRect(), main = r(document.querySelector('.gd-main'));
    const card = (e) => { const c = getComputedStyle(e); return c.boxShadow !== 'none' && parseFloat(c.borderTopLeftRadius) >= 16; };
    const nested = [...document.querySelectorAll('.kt, .kt *')].filter((e) => card(e) && e.parentElement.closest('.kt-callout, .gl-opt') && !e.classList.contains('tile'));
    return { gutterLeft: Math.round(r(sec).left), gutterRight: Math.round(vw - r(sec).right), main: Math.round(main.width), nested: nested.map((e) => e.className),
      uppercase: [...document.querySelectorAll('.kt, .kt *, .gd-sec h2, .gd-stage, .gd-uq dt')].filter((e) => getComputedStyle(e).textTransform === 'uppercase').map((e) => e.className) };
  });
  assert.deepEqual(shape.nested, [], 'no card inside a card'); assert.deepEqual(shape.uppercase, [], 'no uppercase label');
  if (phone) { assert.ok(shape.gutterLeft <= 17 && shape.gutterRight <= 17, `one 16 px gutter, got ${shape.gutterLeft} and ${shape.gutterRight}`); }
  writeFileSync(join(records, `shape.${theme}.${width}w.json`), JSON.stringify(shape));
  if (documents) {
    toTop('.kt-image');
    const documentState = ask(() => {
      const img = document.querySelector('.kt-image img'), table = document.querySelector('.kt-wide'), box = table.parentElement;
      return { caption: document.querySelector('.kt-image figcaption').textContent, loaded: img.complete && img.naturalWidth > 0,
        ratio: img.clientWidth / img.clientHeight, naturalRatio: img.naturalWidth / img.naturalHeight,
        link: document.querySelector('.kt-file').textContent, href: document.querySelector('.kt-file').href,
        cells: [...table.querySelectorAll('tbody tr')].map((r) => r.children.length), colspan: table.querySelector('[colspan="2"]')?.colSpan,
        rowspan: table.querySelector('[rowspan="2"]')?.rowSpan, head: getComputedStyle(table.querySelector('thead')).display,
        scroll: getComputedStyle(box).overflowX, wide: box.scrollWidth > box.clientWidth, scrollContainers: [...document.querySelectorAll('body *')].filter((e) => e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)).length };
    });
    const fullImage = ask(() => document.querySelector('.kt-image a').href);
    const fullResponse = await fetch(fullImage); assert.equal(fullResponse.status, 200);
    assert.deepEqual(Buffer.from(await fullResponse.arrayBuffer()), readFileSync(join(dir, 'kit/two.png')));
    assert.ok(documentState.loaded); assert.ok(Math.abs(documentState.ratio - documentState.naturalRatio) < 0.02, 'the whole image, no crop');
    assert.deepEqual(documentState.cells, [6, 3]); assert.equal(documentState.colspan, 2); assert.equal(documentState.rowspan, 2);
    assert.equal(documentState.head, 'table-header-group'); assert.equal(documentState.scroll, 'auto');
    if (phone) assert.ok(documentState.wide, 'the table scrolls inside its block');
    const download = await fetch(documentState.href);
    assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition'), /attachment/);
    assert.equal(await download.text(), '# The original report\n');
    documentState.href = 'pinned local file (download verified)';
    writeFileSync(join(records, `documents.${theme}.${width}w.json`), JSON.stringify(documentState));
    if (!phone) toTop('.kt-file');
    if (flow) {
      assert.equal(ask(() => !!document.querySelector('.gd-uq')), false);
      assert.equal(ask(() => document.querySelector('.kb-stage').classList.contains('no-image')), true);
      drive('await page.eval(() => document.querySelector(".kb-btn.go").click());');
      assert.equal(ask(() => document.querySelector('.kb-words h3').textContent), 'Second original step');
      assert.deepEqual(ask(() => [...document.querySelectorAll('.gd-sec > h2')].map((e) => e.textContent)), ['The original words, in order']);
    }
    capture(flow ? 'flow' : 'documents', phone ? 'A neutral reference image with its caption and a pinned file link, above an original ragged table that scrolls inside its block.' : 'The reference caption and pinned file link, above the original ragged table with spans.');
    if (phone) {
      drive('await page.eval(() => { const e = document.querySelector(".kt-scroll"); e.scrollLeft = e.scrollWidth; });');
      assert.ok(ask(() => document.querySelector('.kt-scroll').scrollLeft) > 0);
    }
  } else {
  // The film: a poster with one play control; a tap hands over to the native player.
  toTop('.kt-video');
  const film = ask(() => { const f = document.querySelector('.kt-video .frame'), w = f.getBoundingClientRect().width, col = document.querySelector('.gd-main').getBoundingClientRect().width;
    return { poster: !!f.querySelector('img'), play: f.querySelector('.play')?.getAttribute('aria-label'), width: Math.round(w), column: Math.round(col), ratio: +(w / f.getBoundingClientRect().height).toFixed(2) }; });
  assert.ok(film.poster && /^Play the film/.test(film.play)); assert.equal(film.ratio, 1.78);
  if (!phone) assert.ok(film.width >= film.column, 'on a desk the film is at least the column wide');
  capture('video', 'The film: its poster at the column\'s full width, one round play control, its length, the caption under it; a callout set apart under it.');
  drive('await page.eval(() => document.querySelector(".kt-video .play").click()); await wait(".kt-video video"); await new Promise(r => setTimeout(r, 400));');
  assert.equal(ask(() => ({ controls: document.querySelector('.kt-video video').controls })).controls, true);
  // The stepper: segments labelled for a screen reader, Back off at the first beat and visibly a button otherwise, Next moving on and wrapping to Start again.
  toTop('.kt-beats');
  const beats = () => ask(() => { const q = (s) => document.querySelector(s), b = q('.kb-btn:not(.go)'), n = q('.kb-btn.go'), segs = q('.kb-segs');
    return { label: segs.getAttribute('aria-label'), current: segs.querySelector('[aria-current=step]')?.getAttribute('aria-label'), count: q('.kb-words .count').textContent, title: q('.kb-words h3').textContent, back: b.disabled, backBorder: getComputedStyle(b).borderTopWidth, next: n.textContent,
      segHeight: Math.round(segs.querySelector('button').getBoundingClientRect().height), btn: Math.round(n.getBoundingClientRect().height) }; });
  const first = await beats();
  assert.equal(first.label, 'Beat 1 of 3'); assert.equal(first.current, 'Beat 1 of 3: The pain, in a bright studio'); assert.equal(first.back, true); assert.ok(first.segHeight <= 8, `segments are thin, not ${first.segHeight}`); assert.ok(first.btn >= 44);
  assert.notEqual(first.backBorder, '0px', 'Back has an edge, so it reads as a button on the light page');
  capture('beats', 'The stepper with no card: a segment for each beat, the beat\'s picture, its time and title, its words, Back (edged, off at the first beat) and Next in ink.');
  drive('await page.eval(() => document.querySelector(".kb-btn.go").click()); await new Promise(r => setTimeout(r, 500));');
  const second = await beats();
  assert.equal(second.label, 'Beat 2 of 3'); assert.equal(second.back, false); assert.match(second.title, /Real life, blurred/);
  drive('await page.eval(() => { const n = document.querySelector(".kb-btn.go"); n.click(); }); await new Promise(r => setTimeout(r, 300));');
  const last = await beats(); assert.equal(last.next, 'Start again'); assert.equal(last.count, 'Beat 3 of 3');
  capture('beats-last', 'The last beat: 3 of 3, the segments all filled, Back on, Next now Start again.');
  // The table: columns on a desk, each row stacked on a phone.
  toTop('.kt-table');
  const table = ask(() => { const t = document.querySelector('.kt-table'), head = getComputedStyle(t.querySelector('thead')).display; return { head, border: getComputedStyle(t).borderTopWidth, rows: t.querySelectorAll('tbody tr').length, cells: [...t.querySelectorAll('tbody tr:first-child td')].map((c) => c.textContent) }; });
  assert.equal(table.rows, 3); assert.deepEqual(table.cells, ['AI calls', '3', '1']); assert.equal(table.head, phone ? 'none' : 'table-header-group');
  capture('table', phone ? 'The table: each row stacked, the row name over each column\'s label and value.' : 'The table: the columns across with a hairline under the head and between rows, no frame.');
  toTop('.kt-compare');
  capture('compare', 'Before and after: two frames side by side, each named under it.');
  toTop('.kt-evid');
  const evid = ask(() => ({ rows: document.querySelectorAll('.kt-evid li').length, status: [...document.querySelectorAll('.kt-status')].map((s) => s.textContent), thumb: Math.round(document.querySelector('.kt-evid img').getBoundingClientRect().width) }));
  assert.deepEqual(evid.status, ['Fixed', 'In progress', 'Waiting on you']); assert.equal(evid.thumb, 48);
  capture('evidence', 'Evidence rows: a 48 px thumbnail, what it shows, and a status word with its dot (Fixed, In progress, Waiting on you), flat rows with hairlines.');
  }
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
  writeFileSync(join(out, 'steps.json'), JSON.stringify(documents ? {
    target: { version: `${pkg} at ${head}` }, start: 'A sample report posted through the CLI, with an original reference image, local document and ragged table.',
    steps: ['Open the reference image and its original caption.', 'Download the pinned local document and compare its bytes.', 'Read the original table cells, spans and ragged rows; on a phone scroll horizontally inside the table.'],
    result: 'A neutral image with its caption, the pinned file link and unchanged table content, in the board style, with no page overflow.',
  } : {
    target: { version: `${pkg} at ${head}` },
    start: 'A clean board holding one report whose first section carries a film, a callout, a stepper, a table, a before and after, evidence rows and a gallery, all named as data.',
    steps: ['The person opens the report: the film shows as a poster at the column\'s full width with one play control.', 'They scroll to the stepper and tap Next: the beat, its time and its label move on, and the last beat offers Start again.',
      'They read the table, the before and after and the evidence rows: flat on the page, no card inside a card.'],
    result: 'Every block is drawn by the board in one gutter, in its own type and colours, light and dark, with no all-caps label and no blue.',
  }));
} finally {
  browser('stop');
  await new Promise((ok, no) => {
    const stop = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'stop', board], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; stop.stdout.on('data', (b) => { log += b; }); stop.stderr.on('data', (b) => { log += b; });
    stop.once('error', no); stop.once('exit', (code) => code === 0 ? ok() : no(new Error(log)));
  });
  rmSync(dir, { recursive: true, force: true });
  console.log('Isolated board stopped and scratch removed.');
}
