// Clean install -> post a research report and a plan -> the comparison table, item line breaks and item button padding in a real browser.
// `npm pack` of this checkout is installed into an empty folder with a throwaway HOME and XDG_*; only that installed package posts and serves.
// Usage: node .agents/skills/done-done-verify-sign-off/table-shots.mjs <report.json> <plan.json> [output, default $DONE_DONE_EVIDENCE_ROOT]
// The report needs a section whose items all carry the same "Axis: value" lines in `more` (the table); the plan needs an item whose
// `more` is several lines that are not a table, and an item with no `more` (its buttons). TABLE_SECTION, LINES_ITEM and BARE_ITEM name them.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const [reportFile, planFile, out] = [...process.argv.slice(2, 4), process.argv[4] ?? process.env.DONE_DONE_EVIDENCE_ROOT].map((p) => p && resolve(p));
assert.ok(out && reportFile && planFile, 'usage: table-shots.mjs <report.json> <plan.json> [output]');
const tableSection = process.env.TABLE_SECTION ?? 'compare', linesItem = process.env.LINES_ITEM ?? 'research:0', bareItem = process.env.BARE_ITEM ?? 'risks:1';
mkdirSync(out, { recursive: true });
const repo = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'so-table-')), app = join(dir, 'app'), board = join(dir, 'board.json');
mkdirSync(app);
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
for (const k of Object.keys(env)) if (/^(FM_|FIRSTMATE|SIGN_OFF_)/.test(k)) delete env[k];
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 180000, ...options });
  assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout;
};
const tarball = run('npm', ['pack', '--silent', '--pack-destination', dir], { cwd: repo, env: process.env }).trim().split('\n').pop();
run('npm', ['init', '-y'], { cwd: app, env });
run('npm', ['install', '--no-audit', '--no-fund', join(dir, tarball)], { cwd: app, env });
const cliJs = join(app, 'node_modules/sign-off-axi/dist/cli.js');
const cli = (...args) => run(join(app, 'node_modules/.bin/sign-off-axi'), args, { cwd: app, env });
const log = [`$ npm pack; npm install ${tarball} (empty folder, throwaway HOME)`, `version: ${cli('--version').trim()}`];
// The board archives a report a day after it was filed, so the copy posted here is dated now.
const report = JSON.parse(readFileSync(reportFile, 'utf8')), plan = JSON.parse(readFileSync(planFile, 'utf8'));
writeFileSync(join(app, 'report.json'), JSON.stringify({ ...report, filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') }));
writeFileSync(join(app, 'plan.json'), JSON.stringify(plan));
for (const kind of ['report', 'plan']) log.push(`$ sign-off-axi post --kind ${kind} --from ${kind}.json`, cli('post', board, '--kind', kind, '--from', join(app, `${kind}.json`)).trim());
const server = spawn(process.execPath, [cliJs, 'serve', board, '--port', '0'], { cwd: app, env, stdio: ['ignore', 'pipe', 'inherit'] });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-table-${process.pid}` };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const nap = (ms) => new Promise(r=>setTimeout(r,ms));\n' + script });
const page = (fn, ...args) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(() => (${fn.toString()})(...${JSON.stringify(args)}))));`));
// What each capture must show, measured in the page itself.
function measure(section, item) {
  const w = document.documentElement.clientWidth, sec = document.getElementById(section), box = sec.getBoundingClientRect();
  const res = { overflow: document.documentElement.scrollWidth > w, outside: [...sec.querySelectorAll('*')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > box.right + 1).length };
  const t = sec.querySelector('.gd-ct');
  if (t) Object.assign(res, { layout: getComputedStyle(t).display, options: [...t.tHead.rows[0].cells].slice(1).map((c) => c.textContent), axes: [...t.tBodies[0].rows].map((r) => r.cells[0].textContent) });
  if (item != null) {
    const li = sec.querySelectorAll('.gd-rows > li')[item], lb = li.getBoundingClientRect(), p = li.querySelector('.body p');
    if (p) {
      const r = document.createRange(), tops = new Set(), walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let n; (n = walk.nextNode());) if (n.data.trim()) { r.selectNodeContents(n); for (const b of r.getClientRects()) tops.add(Math.round(b.top)); }
      Object.assign(res, { lines: p.innerText.split('\n').length, tops: tops.size });
    }
    const ctl = [...li.querySelectorAll('.body button, .body input')];
    Object.assign(res, { controls: ctl.length, gap: Math.round(Math.min(...ctl.map((b) => Math.min(b.getBoundingClientRect().left - lb.left, lb.right - b.getBoundingClientRect().right)))) });
  }
  return res;
}
const checks = [];
try {
  const base = await new Promise((ok, no) => { let s = ''; server.stdout.on('data', (b) => { s += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(s); if (m) ok(m[0]); }); server.once('exit', (code) => no(new Error(`Server exited ${code}`))); });
  browser('open', base);
  for (const theme of ['light', 'dark']) for (const width of [390, 1280]) {
    browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x860x1', '--color-scheme', theme);
    const shot = (name, url, part, open, item) => {
      drive(`await page.open(${JSON.stringify(url)}); for (let i=0;i<100 && !await page.eval(() => !!document.querySelector('[data-part="${part}"]'));i++) await nap(100);
        await page.eval(() => { const b = document.querySelector('${open ? `[data-part="${part}"] .gd-rows > li:nth-child(${item + 1}) .rowbtn` : 'none'}'); if (b) b.click();
          const s = document.querySelector('.gd-scroll'); s.style.scrollBehavior = 'auto'; document.querySelector('[data-part="${part}"]').scrollIntoView({ block: 'start' }); }); await nap(1500);`);
      const stem = `${name}.${theme}.${width}w`, got = page(measure, `gd-${part}`, item);
      browser('screenshot', join(out, `${stem}.png`));
      assert.equal(got.overflow, false, `${stem} ${JSON.stringify(got)}`); assert.equal(got.outside, 0, `${stem} ${JSON.stringify(got)}`);
      assert.match(browser('console', '--type', 'error'), /no console messages found/, stem);
      checks.push(`${stem}: ${JSON.stringify(got)}`);
      return got;
    };
    const t = shot('report-compare', `${base}#reports/${report.key}`, tableSection);
    const items = report.sections.find((s) => s.id === tableSection).items;
    assert.deepEqual([t.layout, t.options, t.axes.length], [width === 1280 ? 'table' : 'block', items.map((i) => i.title), items[0].more.split('\n').length + 1], JSON.stringify(t));
    const [ls, li] = linesItem.split(':'), [bs, bi] = bareItem.split(':');
    const l = shot('plan-lines', `${base}#waiting/${plan.key}`, ls, true, +li);
    assert.ok(l.lines === plan.sections.find((s) => s.id === ls).items[+li].more.split('\n').length && l.tops >= l.lines, JSON.stringify(l));
    const b = shot('plan-risks', `${base}#waiting/${plan.key}`, bs, false, +bi);
    assert.ok(b.controls >= 6 && b.gap >= 8, `buttons of an item with no detail sit inside its padding: ${JSON.stringify(b)}`);
  }
} finally {
  try { browser('stop'); } finally {
    // Stopped without blocking, so this process can reap the server as it exits.
    const stop = spawn(process.execPath, [cliJs, 'stop', board], { cwd: app, env, stdio: 'inherit' });
    const [code] = await Promise.all([new Promise((r) => stop.once('exit', r)), server.exitCode === null && new Promise((r) => server.once('exit', r))]);
    assert.equal(code, 0, 'sign-off-axi stop');
  }
  writeFileSync(join(out, 'post.txt'), log.join('\n') + '\n');
  writeFileSync(join(out, 'layout-checks.txt'), checks.join('\n') + '\n');
  const version = log[1].replace('version: ', '');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version }, start: 'An empty folder with a throwaway home, the sign-off-axi package packed from this checkout and installed there, and a new board.',
    steps: [`The installed sign-off-axi posts the research report "${report.title}" and the plan "${plan.title}".`,
      'The board is served and opened at 390 and 1280 px wide, in light and dark.',
      `On the report, the section "${report.sections.find((s) => s.id === tableSection).heading}" is shown: every option on the same points.`,
      `On the plan, the item "${plan.sections.find((s) => s.id === linesItem.split(':')[0]).items[+linesItem.split(':')[1]].title}" is opened, and the section "${plan.sections.find((s) => s.id === bareItem.split(':')[0]).heading}" is shown with its item that has no detail.`],
    result: 'At 1280 the report shows a comparison table with the options across and the points down; at 390 each point lists every option under it. The opened plan item shows one line per point. The buttons of the item with no detail sit inside its own padding. Nothing runs off the screen in either theme.' }, null, 2) + '\n');
  rmSync(dir, { recursive: true, force: true });
}
