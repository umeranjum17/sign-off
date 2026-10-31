// The slop lint, run by `npm test`: a filler phrase, an emoji, an internal id shown to a person, a wall of text, a painted block that shows nothing
// or text under 4.5:1 against what is behind it fails the build. Two passes, one rule set: the copy pass reads the string literals of the files that
// hold words a person reads and names the file and line; the screen pass seeds a board and reads it in a real browser at 390 and 1280, light and
// dark, naming page, theme, width and element, and the stylesheet line behind a colour. No rule is judged by eye from a token pair.
// Usage: node scripts/slop-lint.mjs [--copy|--screen] [--seed [out]]   (--seed: one bad page, and the rules it breaks)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// A real word list: the phrases that turn a reply into slop. Matched as whole words, case and punctuation insensitive.
export const FILLER = [
  'absolutely right', 'great question', 'i hope this helps', 'hope this helps', 'let me know if', 'feel free to',
  'happy to help', 'i apologize', 'sorry for the confusion', 'you are all set', 'youre all set', 'sure thing', 'of course not',
  'as an ai', 'as a language model', 'in order to', 'it is worth noting', 'it\u2019s worth noting', 'needless to say', 'goes without saying',
  'first and foremost', 'at the end of the day', 'when it comes to', 'at a high level', 'let us dive', 'lets dive', 'buckle up',
  'just checking in', 'circle back', 'touch base', 'low-hanging fruit', 'quick win', 'move the needle', 'best practices', 'in summary',
  'to sum up', 'in conclusion', 'tl;dr', 'long story short', 'that said', 'having said that', 'delve into', 'leverage the', 'seamless',
  'robust solution', 'elevate your', 'unlock the power', 'game-changer', 'game changer', 'revolutionary', 'cutting-edge', 'state of the art',
  'effortless', 'supercharge', 'harness the power', 'empower your', 'holistic', 'synergy', 'navigate the complexities', 'foster collaboration',
  'fast-paced world', 'rest assured', 'with that in mind', 'here is a summary', 'heres a summary', 'i have updated', 'i have gone ahead',
  'i went ahead and', 'do not hesitate', 'dont hesitate', 'quick note', 'friendly reminder', 'i am sorry', 'im sorry',
];

// An emoji is a character the platform draws as a picture (Emoji_Presentation), so ✕ and ✓ as type glyphs are not caught by this.
export const EMOJI = /\p{Emoji_Presentation}/gu;

// An id a person never asked for, on a screen they read: a commit or tree hash, a uuid, a ticket key, a branch, or a raw task slug. Read on the
// rendered page rather than in the source, because an id reaches a person by being drawn from data, and a hyphenated doc example never does.
export const INTERNAL_IDS = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\b(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{16,}\b/i,
  /\bt_[0-9a-z]{5,}\b/,
  /\b(?:fm|feat|fix|chore|spike|task)\/[a-z0-9][a-z0-9.-]{4,}/,
  /\b[a-z0-9]+(?:-[a-z0-9]+){4,}-[a-z0-9]{3,4}\b/,
];

// The length budgets: one rendered block of words, and one sentence inside it.
export const WALL_BLOCK = 500, WALL_SENTENCE = 220;

// The files that hold the words a person reads: the board's own UI with its empty and error states, and the strings the CLI and the server send a person.
export const COPY_FILES = ['web/index.html', 'web/app.js', 'web/app-more.js', ...readdirSync(join(dirname(new URL(import.meta.url).pathname), '../src')).filter((f) => f.endsWith('.ts')).sort().map((f) => `src/${f}`)];

const norm = (s) => s.replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();

/** Every string a person can read in a JS/TS file, with the line it starts on. Comments are not copy. */
export function literals(src) {
  const out = []; let line = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '\n') { line++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; line++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i++; continue; }
    if (c !== '"' && c !== "'" && c !== '`') continue;
    const at = line; let body = ''; i++;
    while (i < src.length && src[i] !== c) { if (src[i] === '\n') line++; body += src[i] === '\\' ? (src[++i] ?? '') : src[i]; i++; }
    out.push({ line: at, text: body });
  }
  return out;
}

/** The same words in an HTML file: the text between tags, and the labels a screen reader reads out. */
export function htmlCopy(src) {
  const out = [];
  const lineAt = (i) => src.slice(0, i).split('\n').length;
  for (const m of src.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*>/gi)) for (const a of m[0].matchAll(/\b(aria-label|placeholder|title|alt)="([^"]*)"/g)) if (a[2].trim()) out.push({ line: lineAt(m.index), text: a[2] });
  for (const m of src.matchAll(/>([^<>]+)</g)) if (m[1].trim() && !/^\s*(?:\.|#|@|\{|\}|<)/.test(m[1])) out.push({ line: lineAt(m.index), text: m[1] });
  return out;
}

/** The words a reply or a label must not carry: filler, and emoji. */
export function copyRules(text) {
  const low = norm(text).toLowerCase();
  return [
    ...FILLER.filter((phrase) => new RegExp(`(?:^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z])`).test(low)).map((words) => ({ rule: 'filler', words })),
    ...[...norm(text).matchAll(EMOJI)].map((m) => ({ rule: 'emoji', words: m[0] })),
  ];
}

/** The ids a screen must not show: drawn from data, so read where they are drawn. */
export function idRules(text) {
  return INTERNAL_IDS.flatMap((re) => { const m = norm(text).match(re); return m ? [{ rule: 'internal-id', words: m[0] }] : []; });
}

/** The copy pass: every readable string in the copy files, rule by rule, as file:line. */
export function lintCopy(repo = '.') {
  const out = [];
  for (const file of COPY_FILES) {
    const path = join(repo, file);
    if (!existsSync(path)) continue;
    const src = readFileSync(path, 'utf8');
    for (const bit of file.endsWith('.html') ? htmlCopy(src) : literals(src)) for (const f of copyRules(bit.text)) out.push({ ...f, file, line: bit.line });
  }
  return out;
}

/** The stylesheet line behind a colour: the last rule whose selector names one of the element's classes, in the order the page loads them. */
export function cssLine(repo, classes) {
  for (const file of ['web/tokens.css', 'web/ui.css', 'web/app.css']) {
    const path = join(repo, file);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, 'utf8').split('\n');
    let hit = null;
    for (let i = 0; i < lines.length && !hit; i++) {
      if (!/^\s*[^@].*\{?\s*$/.test(lines[i])) continue;
      if (!classes.some((c) => lines[i].includes(`.${c}`))) continue;
      for (let j = i; j < Math.min(i + 24, lines.length) && !/^\s*\}/.test(lines[j]); j++) if (/^\s*color:/.test(lines[j])) hit = { file, line: j + 1 };
    }
    if (hit) return hit;
  }
  return null;
}

// What the browser reads on one page: the words that do not read, the painted boxes that show nothing, the walls, and the ids that leaked.
const MEASURE = `() => {
  const IDS = ${JSON.stringify(INTERNAL_IDS.map((re) => [re.source, re.flags]))}.map(([src, flags]) => new RegExp(src, flags));
  const rgb = (c) => { const m = /^rgba?\\(([^)]+)\\)$/.exec(c); if (!m) return null; const p = m[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number);
    return p.length >= 3 ? { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } : null; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;width:0;height:0;background-color:Canvas;color:CanvasText';
  document.body.append(probe);
  const pageGround = rgb(getComputedStyle(probe).backgroundColor);
  probe.remove();
  const ground = (el) => { const stack = [];
    for (let e = el; e; e = e.parentElement) { const bg = rgb(getComputedStyle(e).backgroundColor); if (bg && bg.a > 0.001) stack.push(bg); }
    let c = pageGround; for (const bg of stack.reverse()) c = over(bg, c); return c; };
  const shown = (el) => { const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0 && el.getClientRects().length > 0 && !el.closest('[hidden], dialog:not([open])'); };
  const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3 && n.data.trim()).map((n) => n.data).join(' ');
  const name = (el) => el.localName + (el.id ? '#' + el.id : el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
  const fails = [];
  let tightest = null, widest = 0, text = 0, pictures = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el)) continue;
    const words = own(el).replace(/\\s+/g, ' ').trim();
    if (!words) continue;
    text++;
    for (let e = el; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).backgroundImage !== 'none') { pictures++; break; }
    const bg = ground(el), r = ratio(over(rgb(getComputedStyle(el).color), bg), bg);
    if (!tightest || r < tightest.ratio) tightest = { element: name(el), ratio: +r.toFixed(2) };
    if (r < 4.5) fails.push({ rule: 'low-contrast', element: name(el), classes: [...el.classList], ratio: r.toFixed(2), words: words.slice(0, 50) });
    const sentences = words.split(/(?<=[.!?])\\s+/), longest = Math.max(...sentences.map((x) => x.length));
    widest = Math.max(widest, words.length);
    if (words.length > ${WALL_BLOCK} || longest > ${WALL_SENTENCE}) fails.push({ rule: 'wall', element: name(el), chars: words.length, longest, words: words.slice(0, 50) });
    for (const re of IDS) { const m = words.match(re); if (m) fails.push({ rule: 'internal-id', element: name(el), words: m[0] }); }
  }
  // A painted box that promises content and shows nothing: a card, a chip, a control. A full-screen scrim is a backdrop, not a promise.
  for (const el of document.querySelectorAll('body a, body button, body summary, body [role], body li, body .ui-card, body .chip')) {
    if (!shown(el) || el.textContent.trim()) continue;
    const s = getComputedStyle(el), bg = rgb(s.backgroundColor), b = el.getBoundingClientRect();
    const painted = (bg && bg.a > 0.05) || (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none');
    if (!painted || b.width < 24 || b.height < 16 || b.width * b.height > innerWidth * innerHeight * 0.5) continue;
    if (el.matches('img,svg,video,canvas,picture,[aria-label],[aria-labelledby]') || el.querySelector('img,svg,video,canvas,picture')) continue;
    fails.push({ rule: 'blank-block', element: name(el), classes: [...el.classList], box: Math.round(b.width) + 'x' + Math.round(b.height) });
  }
  return { fails, tightest, widest, text, pictures };
}`;

const run = (bin, args, options = {}) => spawnSync(bin, args, { encoding: 'utf8', timeout: 180000, ...options });

/** A browser of this run's own (chrome-devtools-axi, one session name), which reads one page back with MEASURE. */
function browserTool(name) {
  const session = { env: { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-slop-${name}-${process.pid}-${Date.now()}` } };
  if (run('chrome-devtools-axi', ['-v'], session).status !== 0) throw new Error('the screen pass reads the board in a real browser: put chrome-devtools-axi on PATH (npm i -g chrome-devtools-axi)');
  const ax = (args, input) => { const r = run('chrome-devtools-axi', args, { ...session, input }); if (r.status !== 0) throw new Error(`chrome-devtools-axi ${args[0]}: ${r.stderr || r.stdout}`); return r.stdout; };
  return {
    // A browser that has just started sometimes has no page yet: it takes the address once it does.
    open: (url) => { for (let i = 0; i < 60; i++) { if (run('chrome-devtools-axi', ['open', url], session).status === 0) return; spawnSync('sleep', ['0.3']); } throw new Error(`chrome-devtools-axi open ${url}: the browser took no page`); },
    emulate: (viewport, theme) => { for (let i = 0; i < 60; i++) { if (run('chrome-devtools-axi', ['emulate', '--viewport', viewport, '--color-scheme', theme], session).status === 0) return; spawnSync('sleep', ['0.3']); } throw new Error('chrome-devtools-axi emulate: the browser took no page'); },
    // Wait for the screen the page draws for itself, then read it once it has settled.
    settle: (ready) => ax(['run'], `const wait = async (s) => { for (let i = 0; i < 200; i++) { if (await page.eval('() => !!document.querySelector(' + JSON.stringify(s) + ')')) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('Not ready: ' + s); };\nawait wait(${JSON.stringify(ready)}); await new Promise((r) => setTimeout(r, 900));`),
    shot: (path, full) => ax(['screenshot', path, ...(full ? ['--full-page'] : [])]),
    write: (body) => ax(['run'], `await page.eval(${JSON.stringify(`() => {${body}}`)});`),
    measure: () => JSON.parse(ax(['run'], `console.log(JSON.stringify(await page.eval(${JSON.stringify(MEASURE)})));`).trim().split('\n').pop()),
    stop: () => { run('chrome-devtools-axi', ['stop'], session); },
  };
}

/** The screen pass: a seeded throwaway board in a real browser, every page measured against the rendered pixels. */
export async function lintScreen({ repo = resolve('.') } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'so-slop-board-'));
  const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_STATE_HOME: join(dir, 'state'), XDG_CACHE_HOME: join(dir, 'cache'), SIGN_OFF_FILER: 'verify' };
  // A board with a card of each kind on it, posted the way an agent posts one: nothing here is drawn by the lint.
  const seeded = run('bash', [join(repo, '.agents/skills/done-done-verify-sign-off/feel-board.sh'), dir], { env, cwd: repo });
  if (seeded.status !== 0) throw new Error(`the lint's board did not seed: ${seeded.stdout}${seeded.stderr}`);
  const base = /http:\/\/127\.0\.0\.1:\d+\//.exec(seeded.stdout);
  if (!base) throw new Error(`the lint's board printed no URL: ${seeded.stdout}`);
  const pages = (process.env.SLOP_LINT_PAGES ?? 'today,decide,inbox,reports').split(','), widths = (process.env.SLOP_LINT_WIDTHS ?? '390,1280').split(',').map(Number);
  const fails = [], seen = { cells: [], tightest: null, widest: 0, text: 0 };
  const browser = browserTool('board');
  try {
    browser.open(base[0]);
    for (const width of widths) for (const theme of ['light', 'dark']) {
      browser.emulate(width < 700 ? `${width}x844x2,mobile,touch` : `${width}x800x1`, theme);
      for (const page of pages) {
        browser.open(`${base[0]}#${page}`);
        browser.settle('.main, main');
        const got = browser.measure();
        seen.cells.push(`${page}.${theme}.${width}w`);
        seen.text += got.text;
        seen.pictures = (seen.pictures ?? 0) + got.pictures;
        seen.widest = Math.max(seen.widest, got.widest);
        if (got.tightest && (!seen.tightest || got.tightest.ratio < seen.tightest.ratio)) seen.tightest = { ...got.tightest, cell: `${page}.${theme}.${width}w` };
        for (const f of got.fails) fails.push({ ...f, page, theme, width, ...(f.rule === 'low-contrast' ? { decl: cssLine(repo, f.classes) } : {}) });
      }
    }
  } finally {
    browser.stop();
    run(process.execPath, [join(repo, 'dist/cli.js'), 'stop', join(dir, 'board.json')], { env });
  }
  return { fails, seen };
}

const locator = (f) => f.file ? `${f.file}:${f.line}` : `${f.page}:${f.theme} ${f.width}w ${f.element}${f.decl ? ` (${f.decl.file}:${f.decl.line})` : ''}`;
const line = (f) => `slop ${f.rule} ${locator(f)}${f.ratio ? ` ${f.ratio}:1` : ''}${f.box ? ` ${f.box}` : ''}${f.chars ? ` ${f.chars}/${f.longest} chars` : ''} — ${f.words ?? '(no words)'}`;

/** The self-check this lint leaves behind: one bad page, every rule fired, in the same format a real failure prints in. */
async function seed(out) {
  const bad = `<title>Seed</title>
<h1 style="font:600 20px system-ui">A page with slop on it</h1>
<p>You are absolutely right, great question! \u{1F680}</p>
<p>${'A single sentence that runs on far past any budget a person can read on a phone screen, '.repeat(4)}and it keeps going.</p>
<p>Fixed in commit 4f2a9c1d3b7e5a6089bc, ticket t_b4x9zq, fm/slop-lint-fails-the-build-on-filler-walls-of-te-b4</p>
<div style="background:#101010"><span style="color:#3a3a3a">Grey on near-black, which is what a token pair hides</span></div>
<div class="chip" style="width:120px;height:32px;background:#e8e8e8;border-radius:8px"></div>`;
  const found = [];
  for (const text of ['You are absolutely right, great question! \u{1F680}', 'ticket t_b4x9zq', 'fm/slop-lint-fails-the-build-on-filler-walls-of-te-b4'])
    found.push(...copyRules(text).map((f) => ({ ...f, file: 'seed/page.html', line: 2 })), ...idRules(text).map((f) => ({ ...f, file: 'seed/page.html', line: 2 })));
  const browser = browserTool('seed');
  try {
    const page = `data:text/html,${encodeURIComponent(`<!doctype html><meta charset="utf-8">${bad}`)}`;
    browser.open(page); // the browser has no page to emulate until it has opened one
    browser.emulate('390x844x2,mobile,touch', 'light');
    browser.open(page);
    found.push(...browser.measure().fails.map((f) => ({ ...f, file: 'seed/page.html', line: 4, ...(f.rule === 'low-contrast' ? { decl: { file: 'seed/page.html', line: 5 } } : {}) })));
  } finally { browser.stop(); }
  const blind = ['filler', 'emoji', 'internal-id', 'wall', 'blank-block', 'low-contrast'].filter((rule) => !found.some((f) => f.rule === rule));
  const verdict = blind.length ? `slop lint seed: BLIND to ${blind.join(', ')}` : `slop lint seed: ${found.length} failures, every rule fired`;
  // SLOP_LINT_GREEN is the same command's verdict on the board this repo ships, so one frame carries both halves: fails here, passes there.
  const green = process.env.SLOP_LINT_GREEN ? `\n${process.env.SLOP_LINT_GREEN}` : '';
  for (const f of found) console.log(line(f));
  console.log(verdict);
  if (out) {
    // The frame the self-check leaves: the seeded page and, above it, the same command's verdict on that page and on the board this repo ships,
    // so one picture carries both halves of the claim a reader has to check.
    mkdirSync(out, { recursive: true });
    const frame = browserTool('seed-frame');
    try {
      const page = `data:text/html,${encodeURIComponent(`<!doctype html><meta charset="utf-8">${bad}`)}`;
      frame.open(page);
      frame.emulate('900x1200x1', 'light');
      frame.open(page);
      const text = ['slop lint — one command, two pages', '',
        'THE SEEDED PAGE BELOW (a filler phrase and its emoji, a raw task slug and a commit id, a wall, a painted chip showing nothing, grey on near-black):',
        ...found.map(line), verdict, `exit 1 — a build that ran this would not ship`, '',
        'THE BOARD THIS REPO SHIPS:', green.trim() || '(not given)', 'exit 0 — the build is green'].join('\n');
      frame.write(`const v = document.createElement('pre'); v.style.cssText = 'all:initial;display:block;white-space:pre-wrap;font:11px/1.35 ui-monospace,monospace;background:#121210;color:#f4f2ef;padding:12px';
        v.textContent = ${JSON.stringify(text)}; document.body.prepend(v);`);
      frame.shot(join(out, 'slop-seed.png'), true);
    } finally { frame.stop(); }
  }
  process.exit(blind.length ? 2 : found.length ? 1 : 2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = new Set(process.argv.slice(2));
  if (args.has('--seed')) await seed(process.argv[3] ?? process.env.SLOP_LINT_OUT);
  else {
    const screen = args.has('--copy') ? { fails: [], seen: null } : await lintScreen();
    const problems = [...(args.has('--screen') ? [] : lintCopy('.')), ...screen.fails];
    for (const f of problems) console.log(line(f));
    const seen = screen.seen;
    console.log(problems.length
      ? `slop lint: ${problems.length} failure${problems.length === 1 ? '' : 's'}`
      : seen
        ? `slop lint: clean — ${seen.cells.length} rendered screens, ${seen.text} blocks of copy, tightest ${seen.tightest.ratio}:1 ${seen.tightest.element} at ${seen.tightest.cell}, longest block ${seen.widest} chars${seen.pictures ? `, ${seen.pictures} over a gradient or picture (measured against its background-color)` : ''}`
        : `slop lint: clean — ${COPY_FILES.length} copy files (the screen pass did not run)`);
    process.exit(problems.length ? 1 : 0);
  }
}
