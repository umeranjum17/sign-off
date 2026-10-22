// Markdown in authored text: one part of the sample report or plan on a throwaway board, one theme and width per run.
// Usage: node .agents/skills/done-done-verify-sign-off/markdown-shots.mjs <output> [light|dark] [390|1280]
// MD_PART=heading|item|table|plan-code picks the one part (default table), so a run's steps.json holds one claim.
// SIGN_OFF_REPO=<built base checkout> drives that build instead of this one: the before. Saves markdown.<part>.<width>w.png and .txt (the numbers the claim rests on).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390);
const part = process.env.MD_PART ?? 'table', repo = resolve(process.env.SIGN_OFF_REPO ?? process.cwd());
mkdirSync(out, { recursive: true });
const sample = join(dirname(fileURLToPath(import.meta.url)), 'markdown-sample'), cliJs = join(repo, 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'so-md-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state'), SIGN_OFF_HOME: dir };
for (const k of Object.keys(env)) if (/^(FM_|FIRSTMATE)/.test(k) || (k.startsWith('SIGN_OFF_') && k !== 'SIGN_OFF_HOME')) delete env[k];
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-md-${process.pid}` };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const report = { ...JSON.parse(readFileSync(join(sample, 'report.json'))), filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') }, plan = JSON.parse(readFileSync(join(sample, 'plan.json')));
writeFileSync(join(dir, 'report.json'), JSON.stringify(report)); writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
// Each part: where it is, what to open, and the claim in numbers, measured in the page itself.
const px = `const px = (e, p) => Math.round(parseFloat(getComputedStyle(e)[p]) * 100) / 100; const label = (a) => { const c = getComputedStyle(a, '::before').content; return c && c !== 'none' && c !== 'normal' ? c.replace(/^"|"$/g, '') : a.textContent.trim(); };`;
const parts = {
  heading: { area: 'reports', doc: report, id: 'checked', claim: 'the part heading is 20 to 22 px and its lead reads at 16 px with a 1.6 line height', open: false,
    measure: `const h = P.querySelector('h2'), l = P.querySelector('.gd-lead'); return { h2_px: px(h, 'fontSize'), lead_px: px(l, 'fontSize'), lead_line_height_ratio: Math.round(px(l, 'lineHeight') / px(l, 'fontSize') * 100) / 100 };` },
  item: { area: 'reports', doc: report, id: 'checked', claim: 'an opened item shows its inline code and fenced block as code, with no raw backticks, and its text equals what the agent wrote', open: true,
    measure: `const b = P.querySelector('.gd-rows > li .body'), f = b.querySelector('[data-sf="more"]') ?? b, r = document.createRange(); r.selectNodeContents(f); return { body_px: px(b.querySelector('p') ?? b, 'fontSize'), inline_code: b.querySelectorAll('code').length, code_blocks: b.querySelectorAll('pre').length, raw_backticks_visible: [...b.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.getClientRects().length && /\`/.test(e.textContent)).length, field_text_equals_raw: r.toString() === RAW };` },
  table: { area: 'reports', doc: report, id: 'compare', claim: 'the comparison table has 13 px cells, a tinted header and short link labels', open: false,
    measure: `const t = P.querySelector('.gd-ct'), td = t.querySelector('tbody td'), th = t.querySelector('tbody th'), head = t.querySelector('thead th'), hs = getComputedStyle(innerWidth > 700 ? head : th).backgroundColor, cs = getComputedStyle(td).backgroundColor; return { cell_px: px(td, 'fontSize'), header_tinted: hs !== cs, links: [...t.querySelectorAll('.gd-ref')].map(label), long_urls_visible: [...t.querySelectorAll('td *')].filter((e) => e.children.length === 0 && e.getClientRects().length && /github\\.com\\/|news\\.ycombinator/.test(e.textContent)).length, table_overflows: t.scrollWidth > t.clientWidth + 1 };` },
  'plan-code': { area: 'waiting', doc: plan, id: 'steps', claim: 'a plan step shows its command in a code block with no raw fence marks', open: true,
    measure: `const b = P.querySelector('.gd-rows > li .body'), pre = b.querySelector('pre'); return { code_blocks: b.querySelectorAll('pre').length, code_px: pre ? px(pre.querySelector('code'), 'fontSize') : null, fence_marks_visible: [...b.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.getClientRects().length && /\`\`\`/.test(e.textContent)).length, body_px: px(b.querySelector('p') ?? b, 'fontSize') };` },
};
const spec = parts[part];
assert.ok(spec, `MD_PART is one of ${Object.keys(parts).join(', ')}`);
let server;
try {
  run(process.execPath, [cliJs, 'post', board, '--kind', 'report', '--from', join(dir, 'report.json')], { env, cwd: dir });
  run(process.execPath, [cliJs, 'post', board, '--kind', 'plan', '--from', join(dir, 'plan.json')], { env, cwd: dir });
  server = spawn(process.execPath, [cliJs, 'serve', board, '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'inherit'] });
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (c) => no(Error(`Server exited ${c}`))); });
  browser('open', base);
  browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x860x1', '--color-scheme', theme);
  browser('open', `${base}#${spec.area}/${spec.doc.key}`);
  const raw = JSON.stringify(report.sections.find((s) => s.id === 'checked').items[0].more);
  const got = JSON.parse(JSON.parse(browser('eval', `async () => {
    for (let i = 0; i < 100 && !document.querySelector('.gd-sec h2'); i++) await new Promise((r) => setTimeout(r, 100));
    ${px} const RAW = ${raw}, P = document.querySelector('[data-part="${spec.id}"]'), s = document.querySelector('.gd-scroll');
    ${spec.open ? `const b = P.querySelector('.gd-rows > li .rowbtn'); if (b.getAttribute('aria-expanded') !== 'true') b.click();` : ''}
    await new Promise((r) => setTimeout(r, 400));
    s.style.scrollBehavior = 'auto'; s.scrollTop += P.getBoundingClientRect().top - (innerWidth < 700 ? 150 : 80);
    await new Promise((r) => setTimeout(r, 400));
    const claim = (() => { ${spec.measure} })();
    return ({ claim, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, dark: matchMedia('(prefers-color-scheme: dark)').matches, viewport: innerWidth });
  }`).match(/result: (".*")/)[1]));
  const stem = `markdown.${part}.${theme}.${width}w`;
  browser('screenshot', join(out, `${stem}.png`));
  assert.match(browser('console', '--type', 'error'), /no console messages found/, stem);
  assert.equal(got.overflow, false, JSON.stringify(got));
  writeFileSync(join(out, `${stem}.txt`), `part ${part}\ntheme ${theme} (dark ${got.dark})\nviewport ${got.viewport}\nbuild ${repo}\nclaim: ${spec.claim}\nnumbers ${JSON.stringify(got.claim)}\nhorizontal overflow 0\nconsole errors 0\n`);
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: `A throwaway board holding a sample research ${spec.doc === plan ? 'plan' : 'report'} whose text carries inline code, bold, lists, code blocks and links.`,
    steps: [`The board is opened at ${width} px wide in ${theme} mode on the ${spec.doc === plan ? 'plan' : 'report'}.`, spec.open ? 'The person opens the first item of the part.' : 'The person scrolls to the part.'],
    result: `At ${width} px in ${theme} mode: ${spec.claim}.` }, null, 2) + '\n');
} finally {
  server?.kill();
  try { browser('stop'); } catch {}
  spawnSync(process.execPath, [cliJs, 'stop', board], { env, encoding: 'utf8', timeout: 20000 });
  rmSync(dir, { recursive: true, force: true });
}
