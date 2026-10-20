// Clean install -> author -> guided plan and report in a real browser: nothing here touches this checkout's board, Firstmate or ~/.sign-off.
// `npm pack` of this checkout is installed with npm into an empty folder; only that installed package posts, serves and answers.
// Real read receipts (POST /api/reads) and real Go deeper (POST /api/deeper answered by deeper-agent.mjs through the installed CLI).
// With MINIMAX_API_KEY in the environment the Go deeper answer is a model's; without it a labelled stand-in answers.
// Usage: node .agents/skills/verify-sign-off/guide-shots.mjs <output> [light|dark] [390|1280]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
const simplify = process.env.GUIDE_SIMPLIFY === '1';
const planFile = join(pkg, `fixtures/contract/plan.v${simplify ? 3 : 2}/valid-full.json`), reportFile = join(pkg, `fixtures/contract/report.v${simplify ? 4 : 3}/valid-full.json`);
const plan = JSON.parse(readFileSync(planFile)), report = JSON.parse(readFileSync(reportFile));
// The board archives a report a day after it was filed, so the fixture is dated now.
writeFileSync(reportFile, JSON.stringify({ ...report, filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') }));
if (simplify) {
  writeFileSync(board, '{"schema":2,"items":[]}\n');
  const session = randomUUID();
  const authored = JSON.parse(run('claude', ['--session-id', session, '-p', `You own two synthetic examples for Umer. Read ${planFile} and ${reportFile}, reword their about fields in plain words while preserving keys, sections, decisions, numbers and schemas. Post both through node ${cliJs} post ${board} --kind <kind> --from <file>. Register your actual Claude UUID ${session} through node ${cliJs} owner ${board} --filer ${plan.filer} --host claude --session ${session} --cwd ${app} --model claude-haiku-5-5. Do not start a listener or dispatcher. Remember the ordinary example fact that Umer chose green apples only in this conversation, not the documents. Include it if later asked to simplify. Then stop.`, '--model', 'claude-haiku-5-5', '--output-format', 'json', '--tools', 'Bash,Read,Write,Edit', '--allowedTools', 'Bash,Read,Write,Edit'], { cwd: app, env: process.env }));
  assert.equal(authored.session_id, session); assert.equal(authored.is_error, false);
  writeFileSync(join(records, 'owner-authored.json'), JSON.stringify(authored));
} else {
  cli('post', board, '--kind', 'plan', '--from', planFile);
  cli('post', board, '--kind', 'report', '--from', reportFile);
}
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
let recorder;
const recording = join(records, 'sampled-recording');
if (simplify && theme === 'light' && width === 390) mkdirSync(recording, { recursive: true });
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
  if (simplify && theme === 'light' && width === 390) {
    // A timestamped sampled-frame recording through the same isolated browser CLI, not a synthetic animation.
    recorder = spawn(process.execPath, ['--input-type=module', '-e', `import {spawnSync} from 'node:child_process'; import {existsSync} from 'node:fs'; const end=Date.now()+180000; while(Date.now()<end && !existsSync(${JSON.stringify(join(recording, 'stop'))})) { spawnSync('chrome-devtools-axi',['screenshot',${JSON.stringify(recording)}+'/'+Date.now()+'.png'],{stdio:'ignore',timeout:30000}); await new Promise(r=>setTimeout(r,500)); }`], { env: browserEnv, stdio: 'ignore' });
  }
  if (simplify) for (const [kind, item] of [['plan', plan], ['report', report]]) {
    const url = `${base}#${kind === 'plan' ? 'waiting' : 'reports'}/${item.key}`;
    browser('open', url); drive('await wait(".gd-sec");'); show('next');
    capture(`${kind}-simplify-before`, 'The section offers Simplify this beside Go deeper.');
    const original = readFileSync(board, 'utf8');
    click('[data-part="next"] > .gd-acts .simplify');
    drive('await wait(\'[data-part="next"] > .gd-ans .gask.live\');');
    capture(`${kind}-simplify-pending`, 'The Simplify request is pending in its own section.');
    const ask = (await state()).deeper.find(a => a.key === item.key && a.action === 'simplify');
    assert.equal(ask.version, 1); assert.equal(ask.filer, plan.filer);
    browser('open', base);
    const delivered = tryRun(process.execPath, [cliJs, 'owner', board, '--dispatch', '--filer', plan.filer, '--verbose'], { cwd: app, env: process.env });
    writeFileSync(join(records, `${kind}-owner-delivery.json`), JSON.stringify(delivered)); assert.equal(delivered.status, 0, delivered.stderr);
    const answer = (await state()).deeper.find(a => a.id === ask.id);
    assert.equal(answer.done, true); assert.match(answer.text, /green apples/i); assert.equal(answer.seen, undefined);
    browser('open', url); drive('await wait(".gd-sec");'); browser('open', url); drive('await wait(".gd-sec");');
    assert.equal((await state()).deeper.find(a => a.id === ask.id).seen, undefined, 'reload must not clear unseen answers');
    drive('await page.eval(() => { document.querySelector(".gd-scroll").style.scrollBehavior = "auto"; document.querySelector(\'[data-part="next"] > .gd-ans\').scrollIntoView({block:"center"}); });');
    capture(`${kind}-simplify-new`, 'The owning agent filled the answer in place; the fresh answer is marked New.');
    drive('await nap(2400);');
    assert.equal((await state()).deeper.find(a => a.id === ask.id).seen, answer.answerRevision);
    assert.equal(readFileSync(board, 'utf8'), original, 'Simplify does not alter authored text or plan decisions');
    writeFileSync(join(records, `${kind}-simplify.json`), JSON.stringify({ request: ask, answer, unreadAfterReload: true, documentUnchanged: true }));
  }
} finally {
  if (recorder) {
    writeFileSync(join(recording, 'stop'), 'stop');
    if (recorder.exitCode === null) await new Promise(ok => recorder.once('close', ok));
    const frames = readdirSync(recording).filter(f => /^\d+\.png$/.test(f)).sort();
    if (frames.length > 1) {
      const list = join(recording, 'frames.txt');
      writeFileSync(list, frames.map((f, n) => `file '${join(recording, f)}'\nduration ${n + 1 < frames.length ? (+frames[n + 1].split('.')[0] - +f.split('.')[0]) / 1000 : 1}\n`).join(''));
      run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'scale=390:-2', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', join(out, 'simplify-sampled.mp4')]);
    }
  }
  browser('stop'); server.kill();
  for (const c of responders) c.kill();
  console.log(`Scratch for cleanup: ${dir}`);
}
