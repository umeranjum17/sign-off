// Clean install -> author -> guided plan and report in a real browser: nothing here touches this checkout's board, Firstmate or ~/.sign-off.
// `npm pack` of this checkout is installed with npm into an empty folder; only that installed package posts, serves and answers.
// Real read receipts (POST /api/reads) and real Go deeper (POST /api/deeper answered by deeper-agent.mjs through the installed CLI).
// With MINIMAX_API_KEY in the environment the Go deeper answer is a model's; without it a labelled stand-in answers.
// Usage: node .agents/skills/done-done-verify-sign-off/guide-shots.mjs <output> [light|dark] [390|1280]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { get } from 'node:http';
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
const skill = readFileSync(join(pkg, 'skills/sign-off-axi/SKILL.md'), 'utf8');
for (const cmd of ['report init', 'deeper', 'wait --filer', 'owner <board> --ack <id>']) assert.ok(skill.includes(cmd), `the packaged skill teaches ${cmd}`);
const deeperHelp = cli('deeper', '--help'), ownerHelp = cli('owner', '--help');
for (const label of ['Ask a question', 'Go deeper', 'Simplify this', 'Show an example', 'Why?']) {
  assert.ok(skill.includes(label), `the packaged skill teaches ${label}`);
  assert.ok(deeperHelp.includes(label), `installed help teaches ${label}`);
}
assert.ok(skill.includes('deeper <board> --filer <id> --id <id> --text'), 'active reply example carries its required filer');
for (const flag of ['--filer', '--host', '--session', '--cwd', '--model', '--dispatch', '--ack']) assert.ok(ownerHelp.includes(flag), `installed owner help supports ${flag}`);
writeFileSync(join(records, 'package-agreement.txt'), 'PASS: packaged skill and installed CLI agree on all presets, owner registration/acknowledgement and active replies.\n');

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
const before = process.env.GUIDE_BEFORE === '1', presets = process.env.GUIDE_PRESETS === '1';
const simplify = process.env.GUIDE_SIMPLIFY === '1' || presets || before;
const planFile = join(pkg, `fixtures/contract/plan.v${simplify ? 3 : 2}/valid-full.json`), reportFile = join(pkg, `fixtures/contract/report.v${simplify ? 4 : 3}/valid-full.json`);
const plan = JSON.parse(readFileSync(planFile)), report = JSON.parse(readFileSync(reportFile));
// The board archives a report a day after it was filed, so the fixture is dated now.
writeFileSync(reportFile, JSON.stringify({ ...report, filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') }));
let ownerSession;
if (simplify && !before) {
  writeFileSync(board, '{"schema":2,"items":[]}\n');
  const session = ownerSession = randomUUID();
  const authored = JSON.parse(run('claude', ['--session-id', session, '-p', `You own two synthetic examples for Umer. Read ${planFile} and ${reportFile}, reword their about fields in plain words while preserving keys, sections, decisions, numbers and schemas. Post both through node ${cliJs} post ${board} --kind <kind> --from <file>. Register your actual Claude UUID ${session} through node ${cliJs} owner ${board} --filer ${plan.filer} --host claude --session ${session} --cwd ${app} --model claude-haiku-5-5. Do not start a listener or dispatcher. Remember the ordinary example fact that Umer chose green apples only in this conversation, not the documents. Include it if later asked to simplify. Then stop.`, '--model', 'claude-haiku-5-5', '--output-format', 'json', '--tools', 'Bash,Read,Write,Edit', '--allowedTools', 'Bash,Read,Write,Edit'], { cwd: app, env: process.env }));
  assert.equal(authored.session_id, session); assert.equal(authored.is_error, false);
  writeFileSync(join(records, `owner-authored.${theme}.${width}w.json`), JSON.stringify(authored));
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
  // Blocking browser/model children can outlive an undici keep-alive socket. Each probe owns a fresh socket.
  const state = () => new Promise((ok, no) => {
    const req = get(`${base}api/decisions`, { agent: false }, res => {
      let body = ''; res.on('data', b => { body += b; }); res.on('error', no);
      res.on('end', () => { try { assert.equal(res.statusCode, 200); ok(JSON.parse(body)); } catch (e) { no(e); } });
    });
    req.on('error', no); req.setTimeout(10000, () => req.destroy(new Error('Private board readiness probe timed out')));
  });
  assert.ok((await state()).decisions.length, 'private board is ready before browser interaction');
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

  if (before) {
    for (const [kind, item] of [['plan', plan], ['report', report]]) {
      browser('open', `${base}#${kind === 'plan' ? 'waiting' : 'reports'}/${item.key}`);
      drive('await wait(".gd-sec");'); show('next');
      capture(`${kind}-presets`, 'The original section actions before adding the other presets and first-ask composer.');
    }
  } else {
  if (!presets) {
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
  }
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
    writeFileSync(join(records, `${kind}-owner-delivery.${theme}.${width}w.json`), JSON.stringify(delivered)); assert.equal(delivered.status, 0, delivered.stderr);
    const handoff = JSON.parse(delivered.stderr.split('\n').find(line => line.startsWith('{"host":'))), resumed = JSON.parse(handoff.output);
    assert.equal(handoff.resume, ownerSession); assert.equal(resumed.session_id, ownerSession); assert.equal(resumed.is_error, false);
    const current = await state(), answer = current.deeper.find(a => a.id === ask.id);
    assert.equal(current.delivery[ask.id].state, 'owner-read'); assert.ok(answer.read);
    assert.equal(answer.filer, plan.filer); assert.equal(answer.done, true); assert.ok(answer.text.trim()); assert.equal(answer.seen, undefined);
    browser('open', url); drive('await wait(".gd-sec");'); browser('open', url); drive('await wait(".gd-sec");');
    assert.equal((await state()).deeper.find(a => a.id === ask.id).seen, undefined, 'reload must not clear unseen answers');
    drive('await wait(\'[data-part="next"] .gask:not(.live)\'); await page.eval(() => { const s = document.querySelector(".gd-scroll"), p = document.querySelector(\'[data-part="next"] > .gd-ans\'), bar = document.querySelector(".gd-bar"); s.style.scrollBehavior = "auto"; p.scrollIntoView({block:"center"}); const floor = bar?.getClientRects().length ? bar.getBoundingClientRect().top : s.getBoundingClientRect().bottom; s.scrollTop += Math.max(0, p.getBoundingClientRect().bottom - floor + 16); });');
    capture(`${kind}-simplify-new`, 'The owning agent filled the answer in place; the fresh answer is marked New.');
    drive('await nap(2400);');
    assert.equal((await state()).deeper.find(a => a.id === ask.id).seen, answer.answerRevision);
    assert.equal(readFileSync(board, 'utf8'), original, 'Simplify does not alter authored text or plan decisions');
    writeFileSync(join(records, `${kind}-simplify.${theme}.${width}w.json`), JSON.stringify({ request: ask, answer, ownerSession, resumedSession: resumed.session_id, conversationFactIncluded: /green apples/i.test(answer.text), unreadAfterReload: true, documentUnchanged: true }));
    if (presets) {
      const custom = 'Which number matters most to Umer here?';
      const followup = 'Explain that number without jargon.';
      const question = 'What would change your recommendation?';
      // Every rendered part, including expanded items and decisions, has the same controls.
      const controls = JSON.parse(drive(`console.log(JSON.stringify(await page.eval(() => [...document.querySelectorAll('.gd-acts')].map(e => [...e.querySelectorAll('button')].map(b => b.textContent)))));`));
      for (const labels of controls) for (const label of ['Ask a question', 'Go deeper', 'Simplify this', 'Show an example', 'Why?']) assert.ok(labels.includes(label));
      // Every free-text box shows its whole placeholder: measured with the box's own font against the room inside it, leaving a fifth spare because a phone's font is wider than this browser's (the old text fit here by 4px and clipped on the phone).
      show('next');
      const boxes = JSON.parse(drive(`console.log(JSON.stringify(await page.eval(() => [...document.querySelectorAll('.gd-fu input')].filter(i => i.clientWidth).map(i => { const cs = getComputedStyle(i), c = document.createElement('canvas').getContext('2d'); c.font = cs.font; return { placeholder: i.placeholder, text: c.measureText(i.placeholder).width, room: i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) }; }))));`));
      writeFileSync(join(records, `${kind}-freetext-boxes.${theme}.${width}w.json`), JSON.stringify(boxes));
      capture(`${kind}-freetext`, 'The free-text box shows its whole placeholder, not cut off.');
      assert.ok(boxes.length, 'free-text boxes are rendered');
      for (const b of boxes) assert.ok(b.text <= b.room * 0.8, `placeholder "${b.placeholder}" is ${Math.round(b.text)}px wide in ${Math.round(b.room)}px: it can clip on a phone`);
      const sendText = (part, text, isQuestion = false) => drive(`await page.eval(() => { const p = document.querySelector('[data-part="${part}"]'); ${isQuestion ? "p.querySelector(':scope > .gd-acts .question').click();" : ''} const input = p.querySelector(':scope > .gd-fu input'); ${isQuestion ? 'if (document.activeElement !== input) throw Error("Composer did not focus");' : ''} input.value = ${JSON.stringify(text)}; p.querySelector(':scope > .gd-fu').requestSubmit(); }); await nap(600);`);
      sendText('this', custom);
      for (const action of ['deeper', 'example', 'why']) click(`[data-part="next"] > .gd-acts .${action === 'deeper' ? 'deep' : action}`);
      sendText('next', question, true);
      // Two rapid taps on the same part are two asks, not a per-part lock.
      drive(`await page.eval(() => { const b = document.querySelector('[data-part="next"] > .gd-acts .why'); b.click(); b.click(); }); await nap(600);`);
      const pending = (await state()).deeper.filter(a => a.key === item.key && !a.done);
      assert.equal(pending.length, 7); assert.equal(new Set(pending.map(a => a.id)).size, 7);
      assert.deepEqual(pending.map(a => a.action).sort(), ['custom', 'deeper', 'example', 'question', 'why', 'why', 'why']);
      for (const a of pending) { assert.equal(a.part, a.action === 'custom' ? 'this' : 'next'); assert.equal(a.q, a.action === 'custom' ? custom : a.action === 'question' ? question : undefined); }
      const retry = pending.find(a => a.action === 'why');
      const body = Object.fromEntries(['version', 'id', 'key', 'kind', 'schema', 'filer', 'revision', 'part', 'action'].map(k => [k, retry[k]]));
      drive(`console.log(await page.eval(async () => { const r = await fetch('/api/engagement', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(${JSON.stringify(body)})}); if (!r.ok) throw Error(await r.text()); return r.status; }));`);
      assert.equal((await state()).deeper.filter(a => a.key === item.key && !a.done).length, 7, 'exact submission retry is idempotent');
      show('next'); capture(`${kind}-presets`, 'All section presets and free-text Send are available, with distinct pending asks under this section.');
      const deliver = async (requests, label) => {
        browser('open', base);
        const result = tryRun(process.execPath, [cliJs, 'owner', board, '--dispatch', '--filer', plan.filer, '--verbose'], { cwd: app, env: process.env, timeout: 900000 });
        writeFileSync(join(records, `${kind}-${label}-native.json`), JSON.stringify(result)); assert.equal(result.status, 0, result.stderr);
        const native = result.stderr.split('\n').filter(l => l.startsWith('{"host":')).map(l => JSON.parse(l));
        assert.equal(native.length, requests.length);
        for (const h of native) { const r = JSON.parse(h.output); assert.equal(h.resume, ownerSession); assert.equal(r.session_id, ownerSession); assert.equal(r.is_error, false); assert.equal(h.code, 0); }
        const s = await state();
        for (const request of requests) { const a = s.deeper.find(a => a.id === request.id); assert.equal(s.delivery[a.id].state, 'owner-read'); assert.ok(a.read); assert.equal(a.done, true); assert.ok(a.text.trim()); assert.equal(a.action, request.action); assert.equal(a.part, request.part); assert.equal(a.q, request.q); }
        writeFileSync(join(records, `${kind}-${label}-events.json`), JSON.stringify({ requests, answers: s.deeper.filter(a => requests.some(r => r.id === a.id)), ownerSession, nativeSessions: native.map(h => JSON.parse(h.output).session_id) }));
      };
      await deliver(pending, 'presets');
      browser('open', url); drive('await wait(".gd-sec");');
      sendText('this', followup);
      const follow = (await state()).deeper.find(a => a.key === item.key && a.q === followup);
      assert.equal(follow.action, 'custom'); assert.equal(follow.part, 'this');
      await deliver([follow], 'followup');
      assert.equal(readFileSync(board, 'utf8'), original, 'all presets preserve authored content and decisions');
      browser('open', url); drive('await wait(".gd-sec");'); show('next');
      if (kind === 'plan') {
        click('[data-part="understood"] [data-u="no"]');
        drive(`await page.eval(() => { const n = document.querySelector('.gd-note'); n.value = 'Also include the tablet flow.'; n.dispatchEvent(new Event('input')); document.querySelector('.gd-bar .gd-btn, .gd-rail .gd-btn').click(); }); await nap(800);`);
        const sent = JSON.parse(cli('answers', board, '--json'))[item.key];
        assert.deepEqual(sent.notes, [{section:'understood', verdict:'change', note:'Also include the tablet flow.'}]);
        writeFileSync(join(records, 'plan-send-back.json'), JSON.stringify(sent));
      }
    }
  }
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
