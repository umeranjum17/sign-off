// Real CLI post -> browser review -> CLI answers, in one isolated board per matrix cell.
// Usage: node .agents/skills/verify-sign-off/plan-shots.mjs <output> [light|dark] [390|1280]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const theme = process.argv[3] ?? process.env.DONE_DONE_THEME ?? 'light', width = +(process.argv[4] ?? process.env.DONE_DONE_WIDTH ?? 390);
assert.ok(['light', 'dark'].includes(theme) && [390, 1280].includes(width));
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-plan-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
};
const cli = (...args) => run(process.execPath, ['dist/cli.js', ...args], { env });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-plan-${theme}-${width}-${process.pid}` };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const wait = async (s) => { for (let i=0;i<100;i++) { if (await page.eval(`!!document.querySelector(${JSON.stringify(s)})`)) return; await new Promise(r=>setTimeout(r,100)); } throw new Error("Not ready: " + s); };\n' + script });
const measure = () => {
  const w = document.documentElement.clientWidth, squashed_text = [], ctx = document.createElement('canvas').getContext('2d');
  for (const e of document.querySelectorAll('body *')) {
    const nodes = [...e.childNodes].filter(n => n.nodeType === 3 && n.data.trim()), text = nodes.map(n => n.data).join(' ').replace(/\s+/g, ' ').trim(), s = getComputedStyle(e), width = e.offsetWidth, h = e.offsetHeight;
    if (!(e instanceof HTMLElement) || !text || !e.getClientRects().length || ((width <= 1 || h <= 1) && s.overflow !== 'visible') || s.visibility !== 'visible') continue;
    ctx.font = s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily;
    const chars = width / (ctx.measureText('abcdefghijklmnopqrstuvwxyz').width / 26), words = text.split(' ').length, tops = new Set();
    for (const n of nodes) { const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width) tops.add(Math.round(b.top)); }
    if ((chars < 8 && ctx.measureText(text).width > width + 1) || tops.size > words) squashed_text.push({ element: e.tagName.toLowerCase(), text: text.slice(0, 40), chars: Math.round(chars * 10) / 10, lines: tops.size, words });
  }
  return { url: location.href, overflow: document.documentElement.scrollWidth > w, overflowing: [...document.querySelectorAll('body *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > w + 1).slice(0, 10).map(e => e.tagName.toLowerCase()), squashed_text };
};
const probe = () => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${measure.toString()})));`));
const plan = JSON.parse(readFileSync('fixtures/contract/plan.v1/valid-full.json'));
plan.sections = plan.sections.slice(0, 2); plan.decisions = plan.decisions.slice(0, 1); plan.filer = 'planning-agent';
mkdirSync(join(dir, 'page'));
// The page owns its explanation and diagram; the board owns its answer controls.
writeFileSync(join(dir, 'page/index.html'), readFileSync('fixtures/contract/plan.v1/page/index.html', 'utf8').replace(/<h1>.*?<\/h1>\s*<p>.*?<\/p>/s, ''));
writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
cli('post', board, '--kind', 'plan', '--from', join(dir, 'plan.json'));
const server = spawn(process.execPath, ['dist/cli.js', 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (code) => no(new Error(`Server exited ${code}`))); });
  browser('open', base); browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x800x1', '--color-scheme', theme);
  const capture = (name, claim) => {
    if (process.env.PLAN_REVIEW_STAGE && process.env.PLAN_REVIEW_STAGE !== name) return;
    const stem = `${name}.${theme}.${width}w`;
    browser('screenshot', join(out, `${stem}.png`));
    const dom = probe();
    assert.equal(dom.overflow, false); assert.deepEqual(dom.overflowing, []);
    const consoleLog = browser('console', '--type', 'error'), network = browser('network', '--limit', '100');
    writeFileSync(join(out, `${stem}.network.txt`), network);
    assert.match(consoleLog, /no console messages found/);
    dom.console_errors = [];
    dom.failed_requests = [...network.matchAll(/reqid=\d+ \w+ (\S+) \[(\d+|failed)\]/g)].flatMap(([, url, status]) => status === 'failed' || +status >= 400 ? [{ url, status: +status || 0 }] : []);
    assert.deepEqual(dom.failed_requests, []);
    writeFileSync(join(out, `${stem}.dom.json`), JSON.stringify(dom));
    writeFileSync(join(out, `${stem}.claim.txt`), `${width}px ${theme}: ${claim}\n`);
  };
  drive('await wait(".plan .open-link"); await page.eval(() => scrollTo(0, 0));');
  capture('home', 'Summary shows the plan card with a document icon and Open plan.');
  const openRef = /uid=(\S+) link "Open plan,/.exec(browser('snapshot'))[1];
  browser('click', `@${openRef}`); drive('await wait(".plan-section");');
  assert.equal(JSON.parse(drive('console.log(JSON.stringify(await page.eval(() => getComputedStyle(document.querySelector("#reader h1")).outlineStyle)));')), 'none');
  capture('plan', 'Plan page is open with no title focus box, direction page and Send back disabled.');
  // The iframe is sandboxed: inspect its real served page separately at its exact frame size.
  const frame = JSON.parse(drive('console.log(JSON.stringify(await page.eval(() => { const f=document.querySelector("#reader iframe"),r=f.getBoundingClientRect(); return {url:f.src,width:Math.round(r.width),height:Math.round(r.height),back:location.href}; })));'));
  browser('open', frame.url); browser('emulate', '--viewport', `${frame.width}x${frame.height}x1`, '--color-scheme', theme);
  writeFileSync(join(out, 'direction.dom.json'), JSON.stringify(probe()));
  browser('open', frame.back); browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x800x1', '--color-scheme', theme);
  drive('await wait(".plan-section");');
  if (process.env.PLAN_REVIEW_TRACE) browser('perf-start', '--no-reload', '--no-auto-stop', '--file', join(out, 'interaction.trace.json.gz'));
  drive('await page.eval(() => document.querySelector(".plan-section").scrollIntoView()); await page.eval(() => document.querySelector(".plan-verdicts .approve").click());');
  capture('approved', 'The first section is marked Approved with a selected Approve button.');
  drive('await page.eval(() => { document.querySelectorAll(".plan-section")[1].scrollIntoView(); document.querySelector(".plan-section:nth-of-type(2) .change").click(); });');
  const noteRef = /uid=(\S+) textbox/.exec(browser('snapshot'))[1];
  browser('fill', `@${noteRef}`, 'Keep the desktop layout too.');
  capture('note', 'The second section is marked Change with the note Keep the desktop layout too.');
  drive('await page.eval(() => document.querySelector(".plan-decision").scrollIntoView()); await page.eval(() => document.querySelector(".plan-decision .choices button").click());');
  capture('decision', 'A decision is picked, Recommended and its outcome are visible, and Send back is enabled.');
  drive(`await page.eval(() => document.querySelector('.plan-explain').scrollIntoView()); await page.eval(() => document.querySelector('[aria-label="Next step"]').click());`);
  capture('explain', 'The step explainer shows step 2 and Previous and Next controls.');
  drive('await page.eval(() => document.querySelector(".plan-send .open-link").click()); await wait(".plan-sent");');
  capture('sent', 'Sent back confirms the answers were saved for the agent.');
  if (process.env.PLAN_REVIEW_TRACE) {
    writeFileSync(join(out, 'interaction-trace.txt'), browser('perf-stop', '--file', join(out, 'interaction.trace.json.gz')));
    assert.ok(existsSync(join(out, 'interaction.trace.json.gz')));
  }
  const answers = cli('answers', board, '--json'), answer = JSON.parse(answers)[plan.key];
  assert.deepEqual(answer.notes, [{ section: plan.sections[0].id, verdict: 'approve' }, { section: plan.sections[1].id, verdict: 'change', note: 'Keep the desktop layout too.' }]);
  assert.equal(answer.decisions[plan.decisions[0].key], plan.decisions[0].options[0].value);
  const waited = cli('wait', board, '--filer', plan.filer, '--json', '--timeout', '0');
  if (!process.env.PLAN_REVIEW_STAGE || process.env.PLAN_REVIEW_STAGE === 'sent') {
    writeFileSync(join(out, 'answers.json'), answers); writeFileSync(join(out, 'wait.json'), waited);
  }
  drive('await page.eval(() => document.querySelector(".plan-sent a").click()); await wait(".i-answered .compact");');
  capture('answered', 'The plan is in Answered with Sent back and no longer waits.');
  if (!process.env.PLAN_REVIEW_STAGE || process.env.PLAN_REVIEW_STAGE === 'answered') writeFileSync(join(out, 'list.txt'), cli('list', board));
} finally {
  browser('stop'); server.kill();
  console.log(`Scratch for cleanup: ${dir}`);
}
