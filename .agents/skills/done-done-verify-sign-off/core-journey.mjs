// The core journey of sign-off, on the real product: the agent files a card, the person answers it in the board, and the agent reads the answer.
// Only the installed npm package acts: the CLI files the card, serves the board and takes the answer, and a real browser answers
// the card the way a person does. A clean temp home holds the board, so the user's own board is never read or written.
// With --upgrade the release path a user takes comes first: the previous published version is installed, this build is installed
// over it in place, and the same journey runs on the upgraded CLI.
// Usage: node .agents/skills/done-done-verify-sign-off/core-journey.mjs <output> [--upgrade]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { recordsDir } from './records.mjs';

const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const upgrade = process.argv.includes('--upgrade');
mkdirSync(out, { recursive: true });
// Look records repeat between captures by design, so they stay out of the evidence folder.
const records = recordsDir(out);
mkdirSync(records, { recursive: true });
const repo = process.cwd();
// The version of this checkout that the journey drives.
const current = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
const dir = mkdtempSync(join(tmpdir(), 'so-core-')), app = join(dir, 'app'), board = join(dir, 'board.json');
mkdirSync(app);
// A clean home: nothing of the user's own board, config or cache is read or written.
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
// No fleet: nothing of Firstmate reaches the installed package.
for (const k of Object.keys(env)) if (/^(FM_|FIRSTMATE|SIGN_OFF_)/.test(k)) delete env[k];
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 300000, ...options });
  assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`);
  return r.stdout;
};
const cliBin = join(app, 'node_modules', '.bin', 'sign-off-axi');
const cli = (...args) => run(cliBin, args, { cwd: app, env });

// done-done's own look measurement, from the install that runs this journey.
const dd = dirname(realpathSync(spawnSync('which', ['done-done'], { encoding: 'utf8' }).stdout.trim()));
const { LOOK, SQUASHED_TEXT, lookIssues } = await import(pathToFileURL(join(dd, 'dom.js')));

const log = [];
const note = (text) => { log.push(text); console.log(text); };

let server, browserSession;
try {
  // 1. The package under test: this checkout, packed and installed the way a user installs it.
  const tarball = run('npm', ['pack', '--silent', '--pack-destination', dir], { cwd: repo, env: process.env }).trim().split('\n').pop();
  run('npm', ['init', '-y'], { cwd: app, env });
  const installed = join(app, 'node_modules', 'sign-off-axi');
  let before = '';
  if (upgrade) {
    // The release path: the previous published version first, then this build over it, in place.
    const published = JSON.parse(run('npm', ['view', 'sign-off-axi', 'versions', '--json'], { cwd: app, env }));
    const order = (a, b) => a.split('.').map(Number).reduce((x, n, i) => x || n - (b.split('.')[i] ?? 0), 0);
    const previous = published.filter((v) => order(v, current) < 0).at(-1);
    assert.ok(previous, `no published sign-off-axi version older than ${current}`);
    run('npm', ['install', '--no-audit', '--no-fund', `sign-off-axi@${previous}`], { cwd: app, env });
    before = cli('--version').trim();
    assert.equal(before, previous, `the installed package is ${previous}`);
    run('npm', ['install', '--no-audit', '--no-fund', join(dir, tarball)], { cwd: app, env });
    const after = cli('--version').trim();
    assert.equal(after, current, `the upgraded package is ${after}, not ${current}`);
    assert.notEqual(before, after);
    note(`upgrade: sign-off-axi ${before} installed, then ${after} installed over it in place`);
  } else {
    run('npm', ['install', '--no-audit', '--no-fund', join(dir, tarball)], { cwd: app, env });
  }
  assert.ok(readFileSync(join(installed, 'package.json'), 'utf8').includes(`"version": "${current}"`), 'the installed package is this checkout');
  note(`installed: sign-off-axi ${cli('--version').trim()} (${upgrade ? 'upgraded in place' : 'from this checkout'})`);

  // 2. File the card: the agent posts the plan the person then answers.
  // A config.yaml beside the board names the user, so the board shows a person and not a blank.
  writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
  const planFile = join(installed, 'fixtures/contract/plan.v3/valid-full.json');
  assert.ok(existsSync(planFile), 'the installed package ships the plan it posts');
  const plan = JSON.parse(readFileSync(planFile, 'utf8'));
  const filed = cli('post', board, '--kind', 'plan', '--from', planFile);
  note('filed:\n' + filed.trim());
  const decision = plan.decisions[0];
  const other = decision.options.find((o) => o.value !== decision.recommend);
  assert.ok(other, 'the plan offers a second choice');

  // 3. The real board server, on a free port, from the installed CLI.
  server = spawn(process.execPath, [join(installed, 'dist', 'cli.js'), 'serve', board, '--port', '0'], { cwd: app, env, stdio: ['ignore', 'pipe', 'inherit'] });
  const base = await new Promise((ok, no) => {
    let said = '';
    server.stdout.on('data', (b) => { said += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(said); if (m) ok(m[0]); });
    server.once('exit', (code) => no(new Error(`The board server exited ${code}`)));
  });
  note(`serving: ${base}`);

  // 4. Answer the card in the board, the way a person does.
  browserSession = `so-core-${process.pid}-${Date.now()}`;
  const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: browserSession };
  const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
  const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input:
    `const wait = async (s, ms = 100) => { for (let i = 0; i < ms; i++) { if (await page.eval(\`!!document.querySelector(\${JSON.stringify(s)})\`)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error("Not ready: " + s); };\n`
    + `const nap = (ms) => new Promise(r => setTimeout(r, ms));\n${script}` });
  const evalIn = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn})));`).trim().split('\n').pop());
  const capture = (name, claim) => {
    browser('screenshot', join(out, `${name}.png`));
    const look = evalIn(`async () => ({ url: location.href, ...(${LOOK})(), squashed_text: (${SQUASHED_TEXT})() })`);
    writeFileSync(join(records, `${name}.dom.json`), JSON.stringify(look));
    const issues = lookIssues(look);
    assert.deepEqual(issues, [], `${name}: ${issues.join('; ')}`);
    writeFileSync(join(records, `${name}.claim.txt`), `${claim}\n`);
  };
  // The guide page, scrolled to one part the way a person scrolls to it.
  const show = (part) => drive(`await page.eval(() => { const s = document.querySelector('.gd-scroll'); s.style.scrollBehavior = 'auto'; document.querySelector('[data-part="${part}"]').scrollIntoView({ block: 'start' }); }); await nap(600);`);
  browser('open', `${base}#waiting/${plan.key}`);
  browser('emulate', '--viewport', '390x844x2,mobile,touch', '--color-scheme', 'light');
  drive('await wait(".gd-sec"); await nap(600);');
  capture('filed', `The plan the agent filed, open on the board for the person to read: what it is, what it understood and what it found.`);
  // The person picks the other option and sends the plan on.
  show(`d:${decision.key}`);
  drive(`await page.eval(() => { const b = document.querySelector('[data-part="d:${decision.key}"] .gd-opt:not(:has(.gd-pick))'); if (!b) throw new Error('the other option is missing'); b.click(); });`);
  drive('await nap(400);');
  // The part's whole card above the bar, so nothing a person reads hides under it.
  drive(`await page.eval(() => { const s = document.querySelector('.gd-scroll'), part = document.querySelector('[data-part="d:${decision.key}"]'), bar = document.querySelector('.gd-bar'); const floor = bar?.getBoundingClientRect().top ?? s.getBoundingClientRect().bottom; s.scrollTop += Math.max(0, part.getBoundingClientRect().bottom - floor + 16); }); await nap(400);`);
  capture('picked', `The person picked ${other.label} in the plan's decision, the option the agent did not recommend.`);
  drive(`await page.eval(() => { const b = document.querySelector('.gd-bar .gd-btn'); if (!b) throw new Error('the send button is missing'); b.click(); });`);
  drive('await wait(".gd-sent, .gd-bar .gd-btn[disabled]", 60); await nap(800);');
  show('next');
  const sentText = evalIn(`async () => document.querySelector('.gd-sent')?.innerText ?? ''`);
  assert.match(sentText, /Sent\. I am on it\./, `the board shows the plan as sent:\n${sentText}`);
  note(`answered in the board: ${sentText.replace(/\n+/g, ' | ')}`);
  capture('sent', 'The plan on the board after the person sent it: Sent. I am on it, and the board says the agent has not read it yet.');

  // 5. The agent reads the answer: its own wait takes it, and the board shows the read receipt.
  const read = cli('wait', board, '--filer', plan.filer, '--json', '--timeout', '0');
  const answers = JSON.parse(read);
  assert.equal(answers[plan.key]?.decisions?.[decision.key], other.value, `the agent read the answer:\n${read}`);
  note(`the agent read the answer:\n${read.trim()}`);
  const listed = cli('list', board, '--full');
  note(`the board lists:\n${listed.trim()}`);
  // The guide page redraws itself once the agent has taken the answer.
  const cap = await evalIn(`async () => { for (let i = 0; i < 200; i++) { const c = document.querySelector('.gd-cap'); const t = c?.innerText ?? ''; if (/Agent read your answers/.test(t)) return t; await new Promise((r) => setTimeout(r, 100)); } return document.querySelector('.gd-cap')?.innerText ?? ''; }`);
  assert.match(cap, /Agent read your answers/, `the board shows the agent read the answers:\n${cap}`);
  note(`the board shows: ${cap}`);
  capture('agent-read', 'The plan on the board after the agent read the answer: Agent read your answers, with the time.');
  browser('stop');
  browserSession = null;

  // 6. The record: the commands, what they printed, and the steps a user takes.
  writeFileSync(join(out, 'core-journey.txt'), [
    `target: sign-off-axi ${current} (installed from this checkout${upgrade ? ', upgraded in place over the previous published version' : ''})`,
    `board: a clean board in a clean temp home, served on ${base}`,
    `card: the plan ${plan.key} the agent filed, answered in the board with ${other.label}`,
    '', ...log, '',
    'steps.json: the step record of the same journey.',
  ].join('\n') + '\n');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({
    target: { version: current },
    start: 'A clean board with no cards, in a clean home, with the sign-off CLI installed from this checkout.',
    steps: [
      'The agent files a card with the installed CLI: a plan with one question to decide.',
      'The board serves that card on its own port and the person opens it.',
      'The person answers the card in the board: they pick an option and send the plan on, and the board shows it as sent.',
      'The agent reads the answer with the installed CLI, and the board shows Agent read your answers with the time.',
    ],
    result: 'The card the agent filed shows the answer the person gave and that the agent read it.',
  }, null, 2) + '\n');
  note(`core journey: filed, answered in the board and read by the agent (${plan.key})`);
} finally {
  if (browserSession) { try { run('chrome-devtools-axi', ['stop'], { env: { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: browserSession } }); } catch {} }
  if (server) { try { spawnSync(cliBin, ['stop', board], { cwd: app, env, encoding: 'utf8', timeout: 30000 }); } catch {} server.kill(); }
  rmSync(dir, { recursive: true, force: true });
}
