// An ask on a guided report answers the tap, and a report's diagram reads on a phone: on an isolated board with this checkout's built CLI
// (nothing here touches ~/.sign-off, Firstmate or a real board), at 390 px in the theme given.
// Usage: node .agents/skills/done-done-verify-sign-off/ask-feedback-shots.mjs <output> light|dark
// Saves ask-pressed, ask-sent, ask-again, ask-replied and diagram (each .<theme>.390w.png with a .txt of what the page said and measured),
// and diagram-picked.<theme>.390w.png: the board's own light-or-dark pick set against the system's, and the diagram following the pick.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? process.env.DONE_DONE_THEME ?? 'light', width = 390;
assert.ok(['light', 'dark'].includes(theme));
mkdirSync(out, { recursive: true });
const repo = resolve(import.meta.dirname, '../../..'), cliJs = join(repo, 'dist/cli.js');
// A short folder: Chrome's socket path must stay under 108 characters.
const dir = mkdtempSync('/tmp/so-askfb-'), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
for (const k of Object.keys(env)) if (/^(FM_|FIRSTMATE|SIGN_OFF_)/.test(k)) delete env[k];
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const cli = (...args) => run(process.execPath, [cliJs, ...args], { env });
// The found section's last item shows its own row in the card (the section's own row is not drawn under it), so its Ask is the one tapped.
const FILER = 'agent-41', KEY = 'ask-report', DKEY = 'flow-report', ITEM = '[data-part="found"] > .gd-rows > li:last-child', foot = `${ITEM} .gd-foot`, ans = `${ITEM} .gd-ans`;
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const m = { ...JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v4/valid-full.json'))), key: KEY, filed: now, filer: FILER };
writeFileSync(join(dir, 'report.json'), JSON.stringify(m));
cli('post', board, '--kind', 'report', '--from', join(dir, 'report.json'));
// A design report whose first picture is a flow diagram: an inline SVG page, light and dark, from diagram-sample/.
mkdirSync(join(dir, 'diagrams'));
copyFileSync(join(import.meta.dirname, 'diagram-sample/flow.html'), join(dir, 'diagrams/flow.html'));
const dm = { ...m, key: DKEY, title: 'An ask now answers the tap', about: 'Each ask shows Sent to the agent at once, then Agent replied.',
  visual: { ...m.visual, heading: 'How an ask reaches the agent', diagram: [{ label: 'Flow', src: 'diagrams/flow.html' }] } };
writeFileSync(join(dir, 'flow.json'), JSON.stringify(dm));
cli('post', board, '--kind', 'report', '--from', join(dir, 'flow.json'));
const server = spawn(process.execPath, [cliJs, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-askfb-${theme}-${process.pid}`, CHROME_DEVTOOLS_AXI_PORT: String(port) };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const nap = (ms) => new Promise(r=>setTimeout(r,ms));\nconst wait = async (f) => { for (let i=0;i<100;i++) { if (await page.eval(f)) return; await nap(100); } throw new Error("Not ready: " + f); };\n' + script }).trim().split('\n').pop();
const page = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn})));`));
const asks = () => readFileSync(join(dir, 'board.deeper.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.op === 'ask');
// What the ask under the part says, whether all of it is on screen, and the Ask control's state and fill.
const HEAD = `() => { const b = document.querySelector('${ans} .gask'), r = b?.getBoundingClientRect(), more = document.querySelector('${foot} .gd-more');
  return { head: b?.querySelector('.hd').textContent ?? null, on_screen: !!b && r.top >= 0 && r.bottom <= innerHeight, asks_shown: document.querySelectorAll('${ans} .gask').length,
    ask_busy: more.getAttribute('aria-busy') === 'true', ask_fill: getComputedStyle(more).backgroundColor, ask_text: getComputedStyle(more).color }; }`;
const capture = (name, claim, extra = {}) => {
  const stem = `${name}.${theme}.${width}w`;
  browser('screenshot', join(out, `${stem}.png`));
  const dom = page(`() => { const w = document.documentElement.clientWidth; return { overflow: document.documentElement.scrollWidth > w, overflowing: [...document.querySelectorAll('#reader *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > w + 1).slice(0, 10).map(e => e.tagName.toLowerCase() + '.' + e.className) }; }`);
  assert.equal(dom.overflow, false); assert.deepEqual(dom.overflowing, []);
  const errors = browser('console', '--type', 'error');
  if (!/no console messages found/.test(errors)) assert.fail(errors);
  writeFileSync(join(out, `${stem}.txt`), `${width}px ${theme}: ${claim}\n${Object.entries(extra).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n`);
};
try {
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const x = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (x) ok(x[0]); }); server.once('exit', (c) => no(new Error(`Server exited ${c}`))); });
  browser('open', base); browser('emulate', '--viewport', '390x844x2,mobile,touch', '--color-scheme', theme);
  browser('open', `${base}#reports/${KEY}`);
  drive(`await wait(() => !!document.querySelector('${foot} .gd-more')); await page.eval(() => { document.querySelector('.gd-scroll').style.scrollBehavior = 'auto'; document.querySelector('${foot}').scrollIntoView({ block: 'end' }); document.querySelector('.gd-scroll').scrollBy(0, 40); }); await nap(300);`);
  // Pressed: the board's answer is held back a moment (as a slow phone network would), so the capture shows the Ask control as the tap leaves it.
  drive(`await page.eval(() => { const real = fetch; window.release = null; window.fetch = (url, o) => url === '/api/engagement' ? new Promise((ok) => { window.release = () => ok(real(url, o)); }) : real(url, o); });
    await page.eval(() => { document.querySelector('${foot} .gd-more').click(); document.querySelector('${foot} .gd-menu button.deep').click(); }); await nap(150);`);
  const pressed = page(HEAD);
  assert.equal(pressed.ask_busy, true); assert.equal(pressed.head, null);
  capture('ask-pressed', 'Right after the tap on Go deeper, before the board answers, the Ask control is pressed: filled in ink.', pressed);
  drive(`await page.eval(() => window.release()); await wait(() => document.querySelector('${ans} .gask .hd')?.textContent.startsWith('Sent to the agent')); await nap(700);`);
  const sent = page(HEAD);
  assert.match(sent.head, /^Sent to the agent \d\d:\d\d$/); assert.equal(sent.on_screen, true); assert.equal(sent.ask_busy, false); assert.equal(asks().length, 1);
  capture('ask-sent', 'Once the board has it, the ask shows on screen under the part as Sent to the agent with the time.', { ...sent, asks_saved: asks().length });
  drive(`await page.eval(() => { window.fetch = window.fetch; document.querySelector('${foot} .gd-more').click(); document.querySelector('${foot} .gd-menu button.deep').click(); }); await nap(250);`);
  drive('await page.eval(() => new Promise((ok) => setTimeout(ok, 0)));');
  const again = page(HEAD);
  assert.match(again.head, /^Already sent \d\d:\d\d$/); assert.equal(again.asks_shown, 1); assert.equal(asks().length, 1);
  capture('ask-again', 'The same tap again sends nothing: the ask already sent says Already sent with its time, and no second ask is saved.', { ...again, asks_saved: asks().length });
  const reply = 'The code now comes with the password, so the second screen is gone.';
  cli('deeper', board, '--filer', FILER, '--id', asks()[0].id, '--text', reply);
  drive(`await wait(() => /^Agent replied/.test(document.querySelector('${ans} .gask .hd')?.textContent ?? '')); await page.eval(() => document.querySelector('${ans} .gask').scrollIntoView({ block: 'center' })); await nap(400);`);
  const replied = page(HEAD);
  assert.match(replied.head, /^Agent replied \d\d:\d\d/);
  capture('ask-replied', "When the agent's answer lands, the ask reads Agent replied with the time, and the answer is in place under it.", { ...replied, answer: reply });

  // The design report: its first picture is the flow diagram, drawn at the phone's width in the board's theme.
  browser('open', `${base}#reports/${DKEY}`);
  drive(`await wait(() => !!document.querySelector('.gd-dgbox iframe')); await page.eval(() => { document.querySelector('.gd-scroll').style.scrollBehavior = 'auto'; document.querySelector('.gd-dg').scrollIntoView({ block: 'start' }); document.querySelector('.gd-scroll').scrollBy(0, -96); }); await nap(1500);`);
  const DG = `() => { const f = document.querySelector('.gd-dgbox iframe'), r = f.getBoundingClientRect(), doc = f.contentDocument; return { frame: [Math.round(r.width), Math.round(r.height)], src: f.getAttribute('src'), framed_by_board: !doc }; }`;
  const fig = page(DG);
  capture('diagram', 'A design report opens with its flow diagram as the picture: the inline drawing fills the card at the phone width, its words readable, in this theme.', fig);
  // The board's own light-or-dark pick, set against the system's: the board and the drawing both follow the pick.
  const other = theme === 'light' ? 'dark' : 'light';
  drive(`await page.eval(() => { localStorage.setItem('so-theme', '${other}'); location.reload(); }); await nap(800); await wait(() => !!document.querySelector('.gd-dgbox iframe'));
    await page.eval(() => { document.querySelector('.gd-scroll').style.scrollBehavior = 'auto'; document.querySelector('.gd-dg').scrollIntoView({ block: 'start' }); document.querySelector('.gd-scroll').scrollBy(0, -96); }); await nap(1500);`);
  const picked = page(DG);
  assert.match(picked.src, new RegExp(`theme=${other}`));
  capture('diagram-picked', `With the system in ${theme} and the board's own pick set to ${other}, the board and the diagram are both drawn ${other}.`, { system: theme, board_pick: other, ...picked });
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board holding a guided report and a design report with a flow diagram, both filed by agent-41.',
    steps: [`The report is opened on a phone (390 px), ${theme}, and a part's Ask menu is opened.`, 'The person taps Go deeper while the board is slow to answer: the Ask control turns ink at once.', 'The board saves the ask: Sent to the agent with the time shows under the part, on screen.',
      'The person taps Go deeper again: nothing more is saved, and the ask says Already sent with its time.', 'The agent answers with deeper: the ask reads Agent replied with the time, the answer under it.',
      'The design report is opened: its flow diagram fills the column; with the board set to the other theme, the diagram follows.'],
    result: 'On a phone, an ask on a report presses at once, shows Sent to the agent with the time, says Already sent on a repeat, and shows Agent replied when the answer lands; a report\'s inline-SVG diagram fills the phone column in the board\'s own theme.' }, null, 2) + '\n');
} finally {
  try { browser('stop'); } catch {}
  server.kill();
  rmSync(dir, { recursive: true, force: true }); // its own mkdtemp board and nothing else
}
