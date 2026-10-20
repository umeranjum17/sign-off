// Clean install -> author -> guided plan and report in a real browser: nothing here touches this checkout's board, Firstmate or ~/.sign-off.
// `npm pack` of this checkout is installed with npm into an empty folder; only that installed package posts, serves and answers.
// Real read receipts (POST /api/reads) and real Go deeper (POST /api/deeper answered by deeper-agent.mjs through the installed CLI).
// With MINIMAX_API_KEY in the environment the Go deeper answer is a model's; without it a labelled stand-in answers.
// Usage: node .agents/skills/verify-sign-off/guide-shots.mjs <output> [light|dark] [390|1280]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { recordsDir } from './records.mjs';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const theme = process.argv[3] ?? process.env.DONE_DONE_THEME ?? 'light', width = +(process.argv[4] ?? process.env.DONE_DONE_WIDTH ?? 390);
assert.ok(['light', 'dark'].includes(theme) && [390, 1280].includes(width));
mkdirSync(out, { recursive: true });
const records = recordsDir(out);
mkdirSync(records, { recursive: true });
console.log(`Diagnostics: ${records}`);
const repo = process.cwd(), responder = join(dirname(fileURLToPath(import.meta.url)), 'deeper-agent.mjs');
const dir = mkdtempSync(join(tmpdir(), 'so-guide-')), app = join(dir, 'app'), board = join(dir, 'board.json');
mkdirSync(app);
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
// No fleet: nothing of Firstmate reaches the installed package.
for (const k of Object.keys(env)) if (/^(FM_|FIRSTMATE|SIGN_OFF_)/.test(k)) delete env[k];
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 180000, ...options });
  assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout;
};
const tryRun = (bin, args, options = {}) => spawnSync(bin, args, { encoding: 'utf8', timeout: 60000, ...options });

// 1. Pack this checkout and install it the way a user does, in an empty folder.
const tarball = run('npm', ['pack', '--silent', '--pack-destination', dir], { cwd: repo, env: process.env }).trim().split('\n').pop();
run('npm', ['init', '-y'], { cwd: app, env });
run('npm', ['install', '--no-audit', '--no-fund', join(dir, tarball)], { cwd: app, env });
const pkg = join(app, 'node_modules/sign-off-axi'), cliJs = join(pkg, 'dist/cli.js');
assert.ok(existsSync(cliJs), 'the installed package has its CLI');
const cli = (...args) => run(join(app, 'node_modules/.bin/sign-off-axi'), args, { cwd: app, env });
writeFileSync(join(records, 'install.txt'), `${tarball}\n${cli('--version')}`);

// 2. The skill and the installed CLI agree: every command the skill teaches for plans and reports exists in the package.
const skill = readFileSync(join(repo, 'skills/sign-off-axi/SKILL.md'), 'utf8');
for (const cmd of ['report init', 'deeper', 'wait --filer']) assert.ok(skill.includes(cmd), `the skill teaches ${cmd}`);
assert.match(cli('--help'), /deeper/);
assert.match(cli('deeper', '--help'), /Go deeper/);

// 3. Author with report init: the scaffolds are for filling, and posting one unfilled is refused.
const draft = join(app, 'drafts');
for (const [flag, kind] of [[[], 'report'], [['--plan'], 'plan']]) {
  const folder = join(draft, kind);
  cli('report', 'init', folder, ...flag);
  const file = join(folder, `${kind}.json`);
  assert.ok(existsSync(file), `report init ${flag.join(' ')} wrote ${kind}.json`);
  const refused = tryRun(join(app, 'node_modules/.bin/sign-off-axi'), ['post', board, '--kind', kind, '--from', file], { cwd: app, env });
  assert.notEqual(refused.status, 0); assert.match(refused.stdout + refused.stderr, /FILL/);
}
// The authored result: the package's own fully filled examples, posted through the installed CLI.
const planFile = join(pkg, 'fixtures/contract/plan.v2/valid-full.json'), reportFile = join(pkg, 'fixtures/contract/report.v3/valid-full.json');
const plan = JSON.parse(readFileSync(planFile)), report = JSON.parse(readFileSync(reportFile));
cli('post', board, '--kind', 'plan', '--from', planFile);
cli('post', board, '--kind', 'report', '--from', reportFile);
assert.match(cli('list', board, '--full'), new RegExp(plan.key));

// 4. Serve from the install and drive the browser.
const server = spawn(process.execPath, [cliJs, 'serve', board, '--port', '0'], { cwd: app, env, stdio: ['ignore', 'pipe', 'inherit'] });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-guide-${theme}-${width}-${process.pid}-${Date.now()}` };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const wait = async (s, ms = 100) => { for (let i=0;i<ms;i++) { if (await page.eval(`!!document.querySelector(${JSON.stringify(s)})`)) return; await new Promise(r=>setTimeout(r,100)); } throw new Error("Not ready: " + s); };\nconst nap = (ms) => new Promise(r=>setTimeout(r,ms));\n' + script });
const measure = () => {
  const w = document.documentElement.clientWidth;
  return { url: location.href, text: document.body.innerText.replace(/\s+/g, ' ').trim(), overflow: document.documentElement.scrollWidth > w,
    overflowing: [...document.querySelectorAll('#reader *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > w + 1).slice(0, 10).map(e => e.tagName.toLowerCase() + '.' + e.className),
    rawIds: /\bundefined\b|\[object|\bNaN\b/.test(document.body.innerText) };
};
const probe = () => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${measure.toString()})));`));
const responders = [];
const answerDeeper = (docFile) => {
  const child = spawn(process.execPath, [responder, board, plan.filer, docFile, '1'], { cwd: app, env: { ...env, SIGN_OFF_CLI: cliJs }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (b) => (log += b)); child.stderr.on('data', (b) => (log += b));
  const done = new Promise((ok) => child.once('close', (code) => ok({ code, log })));
  responders.push(child); return done;
};
try {
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (code) => no(new Error(`Server exited ${code}`))); });
  const state = async () => (await fetch(`${base}api/decisions`)).json();
  browser('open', base); browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x860x1', '--color-scheme', theme);
  const capture = (name, claim) => {
    const stem = `${name}.${theme}.${width}w`;
    browser('screenshot', join(out, `${stem}.png`));
    const dom = probe();
    assert.equal(dom.overflow, false); assert.deepEqual(dom.overflowing, []); assert.equal(dom.rawIds, false);
    assert.match(browser('console', '--type', 'error'), /no console messages found/);
    const network = browser('network', '--limit', '100');
    const failed = [...network.matchAll(/reqid=\d+ \w+ (\S+) \[(\d+|failed)\]/g)].flatMap(([, url, status]) => status === 'failed' || +status >= 400 ? [{ url, status: +status || 0 }] : []);
    assert.deepEqual(failed, []);
    writeFileSync(join(records, `${stem}.dom.json`), JSON.stringify(dom));
    writeFileSync(join(records, `${stem}.claim.txt`), `${width}px ${theme}: ${claim}\n`);
  };
  const show = (part, extra = '') => drive(`await page.eval(() => { const s = document.querySelector('.gd-scroll'); s.style.scrollBehavior = 'auto'; document.querySelector('[data-part="${part}"]').scrollIntoView({ block: 'start' }); ${extra} }); await nap(2400);`);
  const click = (sel) => drive(`await page.eval(() => document.querySelector(${JSON.stringify(sel)}).click());`);

  // The plan: it opens as one guided page, a part read for a moment is a real receipt on the board.
  browser('open', `${base}#waiting/${plan.key}`);
  drive('await wait(".gd-sec"); await nap(600);');
  capture('plan-top', 'The guided plan opens at the top: what this is, the answer, and what the agent understood, with a Go ahead control.');
  show('found');
  const receipts = await state();
  assert.ok(receipts.reads?.[`${plan.key}/found`], 'the board saved a real read receipt for the part that was on screen');
  assert.match(drive('console.log(JSON.stringify(await page.eval(() => document.querySelector(\'[data-part="found"]\').innerText)));'), /Read by you/);
  capture('plan-read', 'The found part shows Read by you with the time, and Agent wrote this with the time.');
  click('[data-part="found"] > .gd-acts .gd-lnk:not(.deep)');
  capture('plan-details', 'The numbers are behind the Details tap and are open: sample size and drop-off.');

  // Go deeper: the person taps, the agent (the installed CLI behind a responder) answers, and the answer streams into that spot.
  const planDeeper = answerDeeper(planFile);
  click('[data-part="found"] > .gd-acts .gd-lnk.deep');
  drive(`await wait('[data-part="found"] > .gd-ans .gask', 50);`);
  assert.match(cli('deeper', board, '--filer', plan.filer, '--all', '--json'), /"part":"found"/);
  drive(`await wait('[data-part="found"] > .gd-ans .gask:not(.live)', 900);`);
  const deeperLog = await planDeeper; assert.equal(deeperLog.code, 0, deeperLog.log);
  writeFileSync(join(records, 'plan-deeper.responder.txt'), deeperLog.log);
  writeFileSync(join(records, 'plan-deeper.json'), cli('deeper', board, '--all', '--json'));
  show('found', `document.querySelector('[data-part="found"] > .gd-ans').scrollIntoView({ block: 'start' }); s.scrollTop -= ${width === 390 ? 250 : 90};`);
  capture('plan-deeper', 'Go deeper on the found part shows the agent\'s answer in place, with Agent answered and the time, and a follow-up box.');

  // The decision: one per screen, my pick marked; changing it and Go ahead sends the structured answer.
  show('d:rollout');
  capture('plan-decision', 'The decision shows both options with My pick on the recommended one and If you stay quiet.');
  const other = plan.decisions[0].options.find((o) => o.value !== plan.decisions[0].recommend);
  click(`[data-part="d:rollout"] .gd-opt:not(:has(.gd-pick))`);
  drive('await page.eval(() => document.querySelector(".gd-bar .gd-btn, .gd-rail .gd-btn").click()); await wait(".gd-sent, .gd-bar .gd-btn[disabled]", 50); await nap(800);');
  const answer = JSON.parse(cli('answers', board, '--json'))[plan.key];
  assert.equal(answer.decisions[plan.decisions[0].key], other.value);
  capture('plan-sent', 'After Go ahead the plan shows Sent and the agent is on it; the chosen option is not My pick.');
  assert.match(cli('wait', board, '--filer', plan.filer, '--json', '--timeout', '0'), new RegExp(other.value));
  // The agent's wait took the answer: the receipt now says when the agent read it.
  browser('open', `${base}#waiting/${plan.key}`);
  drive('await wait(".gd-sec"); await nap(600);');
  show('d:rollout');
  assert.match(drive('console.log(JSON.stringify(await page.eval(() => document.querySelector(\'[data-part="d:rollout"]\').innerText)));'), /Agent read your answers/);
  capture('plan-agent-read', 'The decision shows your sent pick with Read by you and Agent read your answers, each with a time.');

  // The report: the same guide, with Go deeper on a part and a read receipt.
  browser('open', `${base}#reports/${report.key}`);
  drive('await wait(".gd-sec"); await nap(600);');
  capture('report-top', 'The guided report opens at the top: what this is, the answer, what the agent understood and the picture.');
  const reportDeeper = answerDeeper(reportFile);
  show('limits');
  assert.ok((await state()).reads?.[`${report.key}/limits`], 'the report part on screen has a real read receipt');
  click('[data-part="limits"] > .gd-acts .gd-lnk.deep');
  drive(`await wait('[data-part="limits"] > .gd-ans .gask:not(.live)', 900);`);
  const reportLog = await reportDeeper; assert.equal(reportLog.code, 0, reportLog.log);
  writeFileSync(join(records, 'report-deeper.responder.txt'), reportLog.log);
  show('limits', `document.querySelector('[data-part="limits"] > .gd-ans').scrollIntoView({ block: 'start' }); s.scrollTop -= ${width === 390 ? 250 : 90};`);
  capture('report-deeper', 'Go deeper on the report part shows the agent\'s answer in place with Agent answered and the time, beside Read by you.');
} finally {
  browser('stop'); server.kill();
  for (const c of responders) c.kill();
  console.log(`Scratch for cleanup: ${dir}`);
}
