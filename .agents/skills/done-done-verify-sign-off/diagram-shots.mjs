// A plan whose sections carry Archify diagrams, posted with the real CLI and read in a real browser, one isolated board per cell.
// Usage: DIAGRAM_DIR=<folder of rendered pages: slices.html, today.html, after.html> node .agents/skills/done-done-verify-sign-off/diagram-shots.mjs <output> [light|dark] [390|1280]
// DIAGRAM_BEFORE=1 posts the same plan with no diagram fields (the list alone); SIGN_OFF_REPO names another built checkout to run, such as the base for a before.
// DIAGRAM_BASE=1 with SIGN_OFF_REPO drives a base checkout that has diagrams but not the Full size way back, so it takes the captures and skips the checks of the way back.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { recordsDir } from './records.mjs';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const theme = process.argv[3] ?? process.env.DONE_DONE_THEME ?? 'light', width = +(process.argv[4] ?? process.env.DONE_DONE_WIDTH ?? 390);
assert.ok(['light', 'dark'].includes(theme) && [390, 1280].includes(width));
const before = !!process.env.DIAGRAM_BEFORE, legacy = !!process.env.DIAGRAM_BASE, repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), pages = resolve(process.env.DIAGRAM_DIR ?? '');
mkdirSync(out, { recursive: true });
const records = recordsDir(out);
mkdirSync(records, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-diagram-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
};
const cli = (...args) => run(process.execPath, [join(repo, 'dist/cli.js'), ...args], { env });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-diagram-${theme}-${width}-${process.pid}-${Date.now()}` };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const wait = async (s) => { for (let i=0;i<100;i++) { if (await page.eval(`!!document.querySelector(${JSON.stringify(s)})`)) return; await new Promise(r=>setTimeout(r,100)); } throw new Error("Not ready: " + s); };\n' + script });
const ask = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn.toString()})));`));
const plan = JSON.parse(readFileSync('fixtures/contract/plan.v2/valid-full.json'));
plan.filer = 'planning-agent'; plan.decisions = plan.decisions.slice(0, 1);
const [found, rec] = plan.sections;
Object.assign(found, { heading: 'Seven slices, delivery first', body: 'Each slice waits for the one before it, so the order is the build order.' });
Object.assign(found.items[0], { title: 'The route needs insider knowledge', text: 'Only a hand-fed agent can answer a tap today.', more: 'An adapter between the board and the author agent removes that step.' });
plan.sections = [found, { ...rec, items: rec.items.slice(0, 1) }];
if (!before) {
  mkdirSync(join(dir, 'diagrams'));
  for (const f of ['slices', 'today', 'after']) copyFileSync(join(pages, `${f}.html`), join(dir, 'diagrams', `${f}.html`));
  found.diagram = [{ label: 'Order', src: 'diagrams/slices.html' }];
  found.items[0].diagram = [{ label: 'Today', src: 'diagrams/today.html' }, { label: 'With an adapter', src: 'diagrams/after.html' }];
}
writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
cli('post', board, '--kind', 'plan', '--from', join(dir, 'plan.json'));
const measure = () => {
  const w = document.documentElement.clientWidth;
  return { url: location.href, overflow: document.documentElement.scrollWidth > w, overflowing: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')) };
};
const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (code) => no(new Error(`Server exited ${code}`))); });
  const emulate = (w, h) => browser('emulate', '--viewport', w === 390 ? `${w}x${h}x2,mobile,touch` : `${w}x${h}x1`, '--color-scheme', theme);
  browser('open', `${base}#waiting/${plan.key}`); emulate(width, width === 390 ? 844 : 800);
  drive('await wait(".gd-sec"); await page.eval(() => scrollTo(0, 0));');
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
  // The progress bar covers the top 110 px of a phone, so a target is brought to just under it.
  const under = (find) => drive(`await page.eval(() => { const e = (${find})(); e.style.scrollMarginTop = '120px'; e.scrollIntoView({ block: 'start' }); }); await new Promise(r => setTimeout(r, 1500));`);
  const center = (sel) => under(`() => document.querySelector(${JSON.stringify(sel)})`);
  const heading = () => [...document.querySelectorAll('.gd-sec h2')].find((h) => h.textContent.includes('Seven slices'));
  capture('plan', before ? 'The plan top: the answer and its picture.' : 'The plan top, with no diagram yet in view.');
  if (before) { under(heading.toString()); capture('section', 'The first section as a list of items, with no picture of their order.'); }
  else {
    under(heading.toString());
    capture('section', 'The section heading, with the picture of the order of the slices starting under it.');
    center('.gd-dg');
    const shown = ask(() => { const f = document.querySelector('.gd-dg iframe'), b = f.getBoundingClientRect(), show = document.querySelector('.gd-show'); return { sandbox: f.sandbox.value, src: f.src, w: Math.round(b.width), h: Math.round(b.height), show: getComputedStyle(show).display !== 'none', full: document.querySelector('.gd-dg a.gd-lnk').href }; });
    assert.equal(shown.sandbox, 'allow-scripts'); assert.match(shown.src, new RegExp(`~diagram\\.0/slices\\.html\\?theme=${theme}&embed=1`));
    assert.equal(shown.show, width > 700, `Show me is ${shown.show ? 'shown' : 'hidden'} at ${width}`);
    assert.equal(shown.full.includes('embed=1'), width < 700, 'Full size is the drawing alone on a phone');
    capture('diagram', 'The order of the slices as a two-column picture, with Full size under it.');
    // The item's two views are tabs: open the item and switch to the second.
    drive('await page.eval(() => document.querySelector(".gd-rows .rowbtn").click()); await wait(".gd-rows .body:not([hidden]) .gd-dg");');
    center('.gd-rows .body .gd-dg'); capture('item', 'The opened item shows its Today picture with the other view one tap away.');
    drive('await page.eval(() => document.querySelectorAll(".gd-rows .body .gd-seg button")[1].click());'); drive('await new Promise(r => setTimeout(r, 1200));');
    assert.deepEqual(ask(() => [...document.querySelectorAll('.gd-rows .body .gd-seg button')].map((b) => b.getAttribute('aria-pressed'))), ['false', 'true']);
    capture('tab', 'The second tab, With an adapter, shows in the same frame.');
    if (width > 700) {
      center('.gd-dg'); drive('await page.eval(() => document.querySelector(".gd-show").click()); await new Promise(r => setTimeout(r, 1500));');
      capture('open', 'Show me opens the interactive viewer in place, and the frame grows.');
      drive('await page.eval(() => document.querySelector(".gd-show").click());'); drive('await new Promise(r => setTimeout(r, 1200));');
      const back = ask(() => Math.round(document.querySelector('.gd-dgbox iframe').getBoundingClientRect().height));
      assert.ok(Math.abs(back - shown.h) <= 8, `back to the picture is ${back} px, it was ${shown.h}`);
    }
    // Full size: the page itself at the phone's width, every text measured as the reader sees it.
    const full = new URL(shown.full);
    browser('open', full.href); emulate(width, width === 390 ? 844 : 800);
    drive('await wait("svg text"); await new Promise(r => setTimeout(r, 1000));');
    const sizes = ask(() => [...document.querySelectorAll('svg[viewBox] text')].filter((t) => t.getBoundingClientRect().width).map((t) => t.getScreenCTM().a * parseFloat(t.getAttribute('font-size') || getComputedStyle(t).fontSize)));
    writeFileSync(join(records, `fullsize.${theme}.${width}w.txt`), `${sizes.length} texts, smallest ${Math.min(...sizes).toFixed(1)} px at ${width}\n`);
    if (width === 390) assert.ok(Math.min(...sizes) >= 12, `smallest text ${Math.min(...sizes)} px`);
    // Sized to the drawing at 390 (nothing but the way back and the drawing, so no empty area below it), and a visible way back to the plan.
    const page = ask(() => { const b = document.querySelector('.so-back'), s = document.querySelector('svg[viewBox]').getBoundingClientRect(), r = b?.getBoundingClientRect(); return { back: b ? b.textContent : null, backHref: b ? b.href : null, backH: r ? Math.round(r.height) : 0, backTop: r ? Math.round(r.top) : 0, svgBottom: Math.round(s.bottom + scrollY), page: Math.round(document.body.getBoundingClientRect().bottom + scrollY), viewport: innerHeight }; });
    writeFileSync(join(records, `fullsize.${theme}.${width}w.page.json`), JSON.stringify(page));
    if (!before && !legacy) {
      assert.equal(page.back, '\u2190 Back to the plan'); assert.ok(page.backH >= 44 && page.backTop >= 0, `the way back is ${page.backH} px tall at ${page.backTop}`);
      if (width === 390) assert.ok(page.page - page.svgBottom <= 24, `${page.page - page.svgBottom} px of page below the drawing`);
    }
    capture('fullsize', 'Full size opens the diagram page itself at the board theme.' + (before || legacy ? ' It has no way back and, on a phone, a grey area below the drawing.' : ' It has a Back to the plan link and, on a phone, ends at the drawing.'));
    if (!before && !legacy) {
      // The way back is a real link: it returns this tab to the plan.
      drive('await page.eval(() => document.querySelector(".so-back").click()); await wait(".gd-sec");');
      assert.equal(ask(() => location.hash), `#waiting/${plan.key}`);
      // The pin: the posted file is served, the same page changed after posting is refused, and the posted file is served again.
      const file = join(dir, 'diagrams', 'slices.html'), posted = readFileSync(file);
      assert.equal((await fetch(full)).status, 200);
      writeFileSync(file, Buffer.concat([posted, Buffer.from('<!-- changed after posting -->')]));
      const refused = await fetch(full);
      writeFileSync(file, posted);
      const reason = (await refused.json()).error;
      assert.equal(refused.status, 404); assert.match(reason, /changed since it was posted/);
      assert.equal((await fetch(full)).status, 200);
      writeFileSync(join(records, `pin.${theme}.${width}w.txt`), `posted file served 200; the same page with one comment added answered ${refused.status} "${reason}"; restored, served 200\n`);
    }
  }
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version, ours = !before && !legacy;
  writeFileSync(join(out, 'steps.json'), JSON.stringify({
    target: { version: `${pkg} at ${head}` },
    start: 'A clean board holding one plan whose section lists two items.' + (before ? '' : ' The section carries an order diagram and one item carries two views, all drawn by the archify skill.'),
    steps: before ? ['The person opens the plan and scrolls to its found section.']
      : ['The person opens the plan and scrolls to the found section: its order diagram sits under the heading.', 'They open the first item and switch its diagram from Today to With an adapter.',
        width > 700 ? 'They tap Show me to open the interactive viewer in place and tap Back to the picture.' : 'Show me is hidden on a phone; they open Full size, the drawing alone at the screen width.',
        ours ? `On the Full size page the page height fits the diagram (nothing but the drawing and a Back to the plan link, ${width === 390 ? 'no grey area below the drawing' : 'the interactive viewer'}), they tap Back to the plan and land on the plan.`
          : 'On the Full size page they see the drawing' + (legacy ? ' with a grey area below it on a phone and no way back to the plan.' : '.'),
        ...(ours ? ['The diagram file is changed after posting: the board refuses it with "Diagram file changed since it was posted", and serves it again once restored.'] : [])],
    result: before ? 'The section is a list of items with no picture of their order.'
      : ours ? 'The order is a two-column picture, the item switches between two views, the Full size page fits the diagram with a Back to the plan link that returns to the plan, the smallest drawn text at 390 is at least 12 px, and a diagram file changed after posting is refused.'
        : 'The order is a two-column picture and the item switches between two views; the Full size page has a grey area below the drawing on a phone and no way back to the plan.',
  }));
} finally {
  browser('stop'); server.kill();
  console.log(`Scratch for cleanup: ${dir}`);
}
