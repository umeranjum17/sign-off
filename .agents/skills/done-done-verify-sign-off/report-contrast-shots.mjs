// The report contrast check: a report's own page, replayed as the reader meets it, must read in the board's theme and in the system's.
// It posts the voice report (fixtures/reports/voice/page.json, the page that exposed white words on white boxes, kept as data so these exact bytes are replayed), then for dark and light at 390 and
// 1280 opens it in the board's reader and on its own, and fails when the page draws in another scheme than the board's, when any text is under a 4.5:1
// contrast ratio against what is behind it, or when a block the page paints shows nothing. The failure names the report, the theme, the width and the
// element. Usage: node .agents/skills/done-done-verify-sign-off/report-contrast-shots.mjs <output> [theme[,theme]] [width[,width]]
// SIGN_OFF_REPO names another built checkout to run (a base, for the before).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { recordsDir } from './records.mjs';

const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const themes = (process.argv[3] ?? process.env.CONTRAST_THEME ?? 'dark,light').split(',');
const widths = (process.argv[4] ?? process.env.CONTRAST_WIDTH ?? '390,1280').split(',').map(Number);
assert.ok(themes.every((t) => ['light', 'dark'].includes(t)), 'themes are light or dark');
assert.ok(widths.every((w) => [390, 1280].includes(w)), 'widths are 390 or 1280');
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const records = recordsDir(out);
mkdirSync(records, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-contrast-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
const cli = (...args) => spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', env, cwd: dir, timeout: 60000 });
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-contrast-${process.pid}-${Date.now()}` };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const wait = async (s) => { for (let i=0;i<200;i++) { if (await page.eval(`!!document.querySelector(${JSON.stringify(s)})`)) return; await new Promise(r=>setTimeout(r,100)); } throw new Error("Not ready: " + s); };\n' + script });
const ask = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn.toString()})));`));

// The report as the captain met it: the agent's page, filed from the board file's folder.
const key = 'juggernaut-voice-options-report', title = 'The Juggernaut voice can come from three switchable style packs, plain by default';
mkdirSync(join(dir, 'voice'), { recursive: true });
writeFileSync(join(dir, 'voice', 'index.html'), JSON.parse(readFileSync(new URL('../../../fixtures/reports/voice/page.json', import.meta.url), 'utf8')).html);
writeFileSync(join(dir, 'voice', 'preview.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" rx="16" fill="#E8E4E0"/><rect x="24" y="60" width="272" height="24" rx="8" fill="#121210"/><rect x="24" y="100" width="200" height="16" rx="8" fill="#5C5C59"/><rect x="24" y="128" width="232" height="16" rx="8" fill="#5C5C59"/></svg>');
const posted = cli('post', board, '--type', 'report', '--purpose', 'research', '--project', 'main', '--key', key, '--title', title,
  '--about', 'Findings from the voice report: the ranks and phrases already exist, and the smallest no-regret slice is a plain extraction.',
  '--view', 'voice/index.html', '--preview', 'voice/preview.svg');
assert.equal(posted.status, 0, posted.stdout + posted.stderr);

/** What a reader's eye meets in the page: its scheme, every text under 4.5:1 against what is behind it, and every painted block that shows nothing. */
function measure() {
  const rgb = (c) => {
    const m = /^rgba?\(([^)]+)\)$/.exec(c);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return p.length >= 3 ? { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } : null;
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const html = 'http://www.w3.org/1999/xhtml';
  // The page's own ground and ink, as Canvas and CanvasText resolve in the scheme it is drawing in.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;width:0;height:0;background-color:Canvas;color:CanvasText';
  document.body.append(probe);
  const pageGround = rgb(getComputedStyle(probe).backgroundColor), pageInk = rgb(getComputedStyle(probe).color);
  probe.remove();
  const ground = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) { const bg = rgb(getComputedStyle(e).backgroundColor); if (bg && bg.a > 0.001) stack.push(bg); }
    let c = pageGround;
    for (const bg of stack.reverse()) c = over(bg, c);
    return c;
  };
  const shown = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0 && el.getClientRects().length > 0; };
  const name = (el) => el.localName + (el.id ? `#${el.id}` : el.classList.length ? `.${[...el.classList].join('.')}` : '');
  const words = (el) => el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
  const fails = [], reads = new Set();
  let checked = 0, lowest = null;
  for (const el of document.querySelectorAll('body *')) {
    if (el.namespaceURI !== html || !shown(el) || el.closest(':disabled, [aria-disabled="true"]')) continue;
    // Only the element that paints a word itself: a box is judged by the words in it, not by its children's again.
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim())) continue;
    const bg = ground(el), r = ratio(over(rgb(getComputedStyle(el).color), bg), bg);
    checked++;
    if (!lowest || r < lowest.ratio) lowest = { element: name(el), ratio: r };
    if (r >= 4.5) { reads.add(el); continue; }
    fails.push({ element: name(el), ratio: r.toFixed(2), words: words(el) });
  }
  // A painted box or tab with nothing in it at all: a word inside one is judged above, as text that does not read.
  const empties = [];
  for (const el of document.querySelectorAll('body a, body button, body summary, body [role]')) {
    if (el.namespaceURI !== html || !shown(el) || words(el)) continue;
    const s = getComputedStyle(el), bg = rgb(s.backgroundColor);
    if (!((bg && bg.a > 0.05) || (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none'))) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 24 || box.height < 16) continue;
    if (el.matches('img,svg,video,canvas,picture') || el.querySelector('img,svg,video,canvas,picture')) continue;
    empties.push({ element: name(el), words: '(no words)', box: `${Math.round(box.width)}x${Math.round(box.height)}` });
  }
  const show = (c) => ({ color: `rgb(${[c.r, c.g, c.b].map(Math.round).join(' ')})`, luminance: Math.round(lum(c) * 1000) / 1000 });
  return { url: location.href, ground: show(pageGround), ink: show(pageInk), checked, lowest: lowest && { element: lowest.element, ratio: lowest.ratio.toFixed(2) }, fails, empties };
}

const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const summary = { report: { key, title }, cells: {}, checked: 'dark and light, 390 and 1280, 4.5:1, no block that shows nothing' }, broken = [];
try {
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (c) => no(new Error(`serve exited ${c}`))); });
  browser('open', base);
  let pageAt = '';
  for (const theme of themes) for (const width of widths) {
    const phone = width < 700, height = phone ? 844 : 800, id = `${theme}.${width}w`;
    // In the board's reader, as the captain reads it: the frame the board draws, its page told the board's light or dark.
    const view = phone ? `${width}x${height}x2,mobile,touch` : `${width}x${height}x1`;
    browser('emulate', '--viewport', view, '--color-scheme', theme);
    browser('open', `${base}#reports/${key}`);
    drive("await wait('#reader .read iframe, .split-detail .read iframe'); await new Promise(r=>setTimeout(r,1500));");
    browser('screenshot', join(out, `reader.${id}.png`), '--full-page');
    const frame = await ask(() => { const f = document.querySelector('#reader .read iframe') ?? document.querySelector('.split-detail .read iframe'); return f ? { src: f.getAttribute('src'), width: Math.round(f.getBoundingClientRect().width) } : {}; });
    if (!pageAt && frame.src) pageAt = frame.src;
    // The very page the reader's frame holds, at the same width and theme: the board's own address for it.
    browser('open', new URL(frame.src, base).href + (frame.src.includes('?') ? '&' : '?') + `theme=${theme}`);
    drive('await new Promise(r=>setTimeout(r,800));');
    browser('screenshot', join(out, `page.${id}.png`), '--full-page');
    // Read again while the page is settling: the frame's own script fills its boxes on load, and the board's pass follows it.
    let m = ask(measure);
    for (let i = 0; i < 5 && (m.fails.length || m.empties.length); i++) { drive('await new Promise(r=>setTimeout(r,400));'); m = ask(measure); }
    summary.cells[id] = { ground: m.ground.color, ink: m.ink.color, frame, checked: m.checked, lowest: m.lowest, fails: m.fails, empties: m.empties };
    writeFileSync(join(records, `contrast.${id}.json`), JSON.stringify({ ...m, frame }, null, 2) + '\n');
    // The board's own ground is dark in dark and light in light; a page that draws on another one is not following the board.
    const draws = theme === 'dark' ? m.ground.luminance < 0.2 : m.ground.luminance > 0.5;
    const problems = [
      ...(draws ? [] : [`the page draws on ${m.ground.color} of its own, not the board's ${theme} ground`]),
      ...(new RegExp(`[?&]theme=${theme}(&|$)`).test(frame.src ?? '') ? [] : [`the board hands its reader a frame with no theme (${frame.src ?? 'none'})`]),
      ...m.fails.map((f) => `unreadable: ${f.element} reads ${f.ratio}:1 — "${f.words}"`),
      ...m.empties.map((e) => `shows nothing: ${e.element} (${e.box}) holds "${e.words}"`),
    ];
    const lines = [`${title} — ${theme}, ${width}px`,
      `page ground ${m.ground.color} on ink ${m.ink.color}; reader frame ${frame.src ?? '(none)'} at ${frame.width ?? '?'}px`,
      `${m.checked} words read against what is behind them, the lowest ${m.lowest?.ratio ?? '?'}:1 at ${m.lowest?.element ?? '?'}; ${m.fails.length} unreadable, ${m.empties.length} painted with nothing`,
      ...problems.map((p) => `  ${p}`)];
    writeFileSync(join(records, `contrast.${id}.txt`), lines.join('\n') + '\n');
    if (problems.length) broken.push(...lines);
    summary.cells[id].problems = problems.length;
    console.log(`${id}: ground ${m.ground.color}, ${m.fails.length} unreadable, ${m.empties.length} empty`);
  }
  // The control: the same page as anyone else gets it, with no theme from the board, which is the defect the captain met — the check must still catch it.
  browser('emulate', '--viewport', '390x844x2,mobile,touch', '--color-scheme', 'dark');
  browser('open', new URL(String(pageAt).replace(/[?#].*$/, ''), base).href);
  drive('await new Promise(r=>setTimeout(r,800));');
  const control = ask(measure);
  const controlLines = [`${title} — control: the page opened with no theme from the board, dark, 390px (${control.url})`,
    `${control.checked} words read, the lowest ${control.lowest?.ratio ?? '?'}:1 at ${control.lowest?.element ?? '?'}; ${control.fails.length} unreadable, ${control.empties.length} painted with nothing`,
    ...control.fails.map((f) => `  unreadable: ${f.element} reads ${f.ratio}:1 — "${f.words}"`)];
  writeFileSync(join(records, 'contrast-control.txt'), controlLines.join('\n') + '\n');
  assert.ok(control.fails.length > 0, `${controlLines.join('\n')}\nthe check read no failure on a page handed no theme, so it cannot catch the defect it exists for`);
  summary.control = { fails: control.fails.length, lowest: control.lowest };
  // Every cell is measured before it fails, so one run names each theme and width that is wrong.
  assert.equal(broken.length, 0, `${title}: ${summary.cells ? Object.values(summary.cells).reduce((n, c) => n + c.problems, 0) : 0} problems in ${themes.length * widths.length} reads\n${broken.join('\n')}`);
  writeFileSync(join(out, 'contrast.json'), JSON.stringify(summary, null, 2) + '\n');
  writeFileSync(join(out, 'contrast.txt'), [...themes.flatMap((t) => widths.map((w) => readFileSync(join(records, `contrast.${t}.${w}w.txt`), 'utf8'))),
    readFileSync(join(records, 'contrast-control.txt'), 'utf8')].join('\n'));
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
  writeFileSync(join(out, 'steps.json'), JSON.stringify({
    target: { version: `${pkg} at ${head}` },
    start: 'An isolated board carrying the voice report the captain read, filed from the page as its agent wrote it.',
    steps: ['The board opens the report in its reader in dark at 390 and 1280, and the frame it hands the page carries the board\'s theme.',
      'The page is read on its own at the same width and theme: its scheme, every word\'s ratio against what is behind it, and every painted block.',
      'The same two reads in light: the page follows the board, no word is under 4.5:1, and no box, tab or card shows nothing.'],
    result: 'A report page draws in the board\'s theme, and every block of it reads in both themes at 390 and 1280.',
  }));
  writeFileSync(join(records, 'claim.txt'), `The voice report in the board's reader and on its own, dark and light at 390 and 1280: the page follows the board's theme, every word reads at 4.5:1 or more against what is behind it, and no painted block shows nothing.\n`);
} finally {
  browser('stop'); server.kill();
  console.log(`Scratch for cleanup: ${dir}`);
}
