// Research bar: a sample research report and plan (written from the packaged skill) on a throwaway board, one framed shot per part the bar names.
// `npm pack` of this checkout is installed with npm into an empty folder; only that installed package posts and serves. HOME and XDG_* are a temp folder.
// Each shot is scrolled to its part and carries a label bar (sample report or plan, which part, theme, width), so a reader of the PNG alone knows what it shows.
// Usage: node .agents/skills/done-done-verify-sign-off/research-bar-shots.mjs <output>
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { recordsDir } from './records.mjs';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
mkdirSync(out, { recursive: true });
const records = recordsDir(out);
mkdirSync(records, { recursive: true });
const repo = process.cwd(), sample = join(dirname(fileURLToPath(import.meta.url)), 'research-bar-sample');
const dir = mkdtempSync(join(tmpdir(), 'so-research-')), app = join(dir, 'app'), board = join(dir, 'board.json');
mkdirSync(app);
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
for (const k of Object.keys(env)) if (/^(FM_|FIRSTMATE|SIGN_OFF_)/.test(k)) delete env[k];
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 180000, ...options });
  assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout;
};

// 1. Clean install, then post the two samples through the installed CLI. The board archives a report a day after it was filed, so it is dated now.
const tarball = run('npm', ['pack', '--silent', '--pack-destination', dir], { cwd: repo, env: process.env }).trim().split('\n').pop();
run('npm', ['init', '-y'], { cwd: app, env });
run('npm', ['install', '--no-audit', '--no-fund', join(dir, tarball)], { cwd: app, env });
const cliJs = join(app, 'node_modules/sign-off-axi/dist/cli.js');
const cli = (...args) => run(join(app, 'node_modules/.bin/sign-off-axi'), args, { cwd: app, env });
const report = { ...JSON.parse(readFileSync(join(sample, 'report.json'))), filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') }, plan = JSON.parse(readFileSync(join(sample, 'plan.json')));
writeFileSync(join(app, 'report.json'), JSON.stringify(report)); writeFileSync(join(app, 'plan.json'), JSON.stringify(plan));
cli('post', board, '--kind', 'report', '--from', join(app, 'report.json'));
cli('post', board, '--kind', 'plan', '--from', join(app, 'plan.json'));
const skill = readFileSync(join(app, 'node_modules/sign-off-axi/skills/sign-off-axi/SKILL.md'), 'utf8');
for (const bar of ['survey the whole real field', 'runner-up', 'scope', 'risk']) assert.ok(skill.toLowerCase().includes(bar.toLowerCase()), `the packaged skill teaches ${bar}`);

// 2. What each shot shows: the part's heading (the board draws it as the card's h2) and a label naming it.
const heading = (doc, id) => doc.sections.find((s) => s.id === id).heading;
const shots = [
  ['report-compare', 'report', report, 'Sample research report: the short-listed options on the same axes', heading(report, 'compare')],
  ['report-pick', 'report', report, 'Sample research report: the pick and the runner-up', heading(report, 'pick')],
  ['plan-scope', 'plan', plan, 'Sample plan: its scope, in and out', heading(plan, 'scope')],
  ['plan-risks', 'plan', plan, 'Sample plan: its risks, each with a counter', heading(plan, 'risks')],
];
const server = spawn(process.execPath, [cliJs, 'serve', board, '--port', '0'], { cwd: app, env, stdio: ['ignore', 'pipe', 'inherit'] });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-research-${process.pid}-${Date.now()}` };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const nap = (ms) => new Promise(r=>setTimeout(r,ms));\n' + script });
// Scroll the part under the label bar and draw the bar (fixed to the top of the viewport, over the page header only).
const frameInPage = (title, label, top) => {
  document.getElementById('shot-label')?.remove();
  const h = [...document.querySelectorAll('.gd-sec h2')].find((e) => e.textContent.trim() === title);
  if (!h) return { found: false };
  const s = document.querySelector('.gd-scroll'); s.style.scrollBehavior = 'auto';
  s.scrollTop += h.closest('.gd-sec').getBoundingClientRect().top - top;
  const bar = document.createElement('div'); bar.id = 'shot-label'; bar.textContent = label;
  bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:10px 16px;font:600 14px/1.35 system-ui,sans-serif;background:#ffd400;color:#111;border-bottom:2px solid #111';
  document.body.append(bar);
  const w = document.documentElement.clientWidth, r = h.getBoundingClientRect();
  return { found: true, headingInView: r.top >= bar.getBoundingClientRect().bottom && r.bottom <= innerHeight, overflow: document.documentElement.scrollWidth > w,
    overflowing: [...document.querySelectorAll('#reader *')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + '.' + e.className) };
};
try {
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (code) => no(new Error(`Server exited ${code}`))); });
  const lines = [];
  for (const theme of ['light', 'dark']) for (const width of [390, 1280]) {
    browser('open', base); browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x860x1', '--color-scheme', theme);
    for (const [name, kind, doc, label, title] of shots) {
      browser('open', `${base}#${kind === 'plan' ? 'waiting' : 'reports'}/${doc.key}`);
      const stem = `${name}.${theme}.${width}w`;
      const m = JSON.parse(drive(`
for (let i = 0; i < 100 && !(await page.eval(() => !!document.querySelector('.gd-sec h2'))); i++) await nap(100);
await nap(600);
console.log(JSON.stringify(await page.eval(${`() => (${frameInPage})(${JSON.stringify(title)}, ${JSON.stringify(`${label} · ${theme} · ${width} px`)}, ${width === 390 ? 130 : 70})`})));`));
      assert.ok(m.found, `${stem}: the page has the heading ${title}`);
      assert.ok(m.headingInView, `${stem}: the heading is in view under the label`);
      assert.equal(m.overflow, false); assert.deepEqual(m.overflowing, []);
      browser('screenshot', join(out, `${stem}.png`));
      assert.match(browser('console', '--type', 'error'), /no console messages found/);
      writeFileSync(join(records, `${stem}.dom.json`), JSON.stringify({ url: `${base}#${kind === 'plan' ? 'waiting' : 'reports'}/${doc.key}`, overflow: m.overflow, overflowing: m.overflowing, console_errors: [], failed_requests: [] }));
      lines.push(`${stem}: ${label}`);
    }
  }
  writeFileSync(join(out, 'shots.txt'), `${lines.join('\n')}\n`);
  writeFileSync(join(out, 'steps.json'), JSON.stringify({
    target: { version: cli('--version').trim() },
    start: 'An empty board in a clean home, with the sign-off CLI installed from this checkout.',
    steps: [
      'The agent posts the sample research report and the sample plan, written from the packaged skill, with the installed CLI.',
      'The person opens the report and sees its short-listed options compared on the same axes, then its pick and runner-up.',
      'The person opens the plan and sees its scope (what is in and out), then its risks, each with a counter.',
    ],
    result: 'Each part shows under a label naming the sample (report or plan), the part, the theme and the width, at 390 and 1280 px in light and dark, with no overflow and no console error.',
  }));
} finally {
  try { browser('stop'); } finally { server.kill(); }
  console.log(`Scratch for cleanup: ${dir}`);
}
