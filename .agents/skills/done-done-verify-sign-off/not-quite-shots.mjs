// Not quite with a note on a report, on an answers-only board (how the live board is fed): on an isolated board with this checkout's built CLI
// (nothing here touches ~/.sign-off, Firstmate or a real board), at 390 px in the theme given.
// Usage: node .agents/skills/done-done-verify-sign-off/not-quite-shots.mjs <output> light|dark
// Saves not-quite-note, not-quite-sent and not-quite-read (each .<theme>.390w.png with a .txt of what the card said, the errors shown and the saved line).
// NOT_QUITE_BEFORE=1 SIGN_OFF_REPO=<built base checkout> drives the base instead and saves not-quite-refused: the error the base shows after Tell the agent.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? process.env.DONE_DONE_THEME ?? 'light', width = 390, before = !!process.env.NOT_QUITE_BEFORE;
assert.ok(['light', 'dark'].includes(theme));
mkdirSync(out, { recursive: true });
const here = resolve(import.meta.dirname, '../../..'), repo = before ? resolve(process.env.SIGN_OFF_REPO) : here, cliJs = join(repo, 'dist/cli.js');
// A short folder: Chrome's socket path must stay under 108 characters.
const dir = mkdtempSync('/tmp/so-notq-'), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
for (const k of Object.keys(env)) if (/^(FM_|FIRSTMATE|SIGN_OFF_)/.test(k)) delete env[k];
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const cli = (...args) => run(process.execPath, [cliJs, ...args], { env });
const FILER = 'agent-41', KEY = 'agents-on-vms', CARD = '[data-part="understood"]', NOTE = 'It is VMs, not containers: each agent gets its own machine.';
const m = { ...JSON.parse(readFileSync(join(here, 'fixtures/contract/report.v4/valid-full.json'))), key: KEY, filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), filer: FILER };
writeFileSync(join(dir, 'report.json'), JSON.stringify(m));
cli('post', board, '--kind', 'report', '--from', join(dir, 'report.json'));
// The feeding program's board: it takes answers only, which is how the live board is fed.
writeFileSync(board, JSON.stringify({ ...JSON.parse(readFileSync(board, 'utf8')), answers_only: true }));
const server = spawn(process.execPath, [cliJs, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-notq-${theme}-${process.pid}`, CHROME_DEVTOOLS_AXI_PORT: String(port) };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const nap = (ms) => new Promise(r=>setTimeout(r,ms));\nconst wait = async (f) => { for (let i=0;i<100;i++) { if (await page.eval(f)) return; await nap(100); } throw new Error("Not ready: " + f); };\n' + script }).trim().split('\n').pop();
const page = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn})));`));
const saved = () => existsSync(join(dir, 'board.annotations.jsonl')) ? readFileSync(join(dir, 'board.annotations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
// What the understood card says: its choices, the note box, Tell the agent, the comment under it with its state, the receipt and any error shown.
const CARD_STATE = `() => { const c = document.querySelector('${CARD}'), q = (s) => c.querySelector(s), shown = (e) => !!e && !e.hidden && e.getClientRects().length > 0;
  return { pressed: [...c.querySelectorAll('.gd-choice[aria-pressed=true]')].map((b) => b.textContent), note_box: shown(q('.gd-note')) ? q('.gd-note').value : null, tell: shown(q('.gd-tell')),
    comment: q('.gd-cmt p')?.textContent ?? null, comment_state: q('.gd-cmt .gd-st')?.textContent ?? null, receipt: q('.gd-rc')?.textContent ?? null,
    errors: [...c.querySelectorAll('.gd-err')].map((e) => e.textContent).filter(Boolean) }; }`;
const capture = (name, claim, extra = {}) => {
  const stem = `${name}.${theme}.${width}w`;
  browser('screenshot', join(out, `${stem}.png`));
  const dom = page(`() => { const w = document.documentElement.clientWidth; return { overflow: document.documentElement.scrollWidth > w, overflowing: [...document.querySelectorAll('#reader *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > w + 1).slice(0, 10).map(e => e.tagName.toLowerCase() + '.' + e.className) }; }`);
  assert.equal(dom.overflow, false); assert.deepEqual(dom.overflowing, []);
  writeFileSync(join(out, `${stem}.txt`), `${width}px ${theme}: ${claim}\n${Object.entries(extra).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n`);
};
// Keeps the card's lower half, where the choices, the note and what was sent sit, in view.
const frame = `await page.eval(() => { document.querySelector('.gd-scroll').style.scrollBehavior = 'auto'; document.querySelector('${CARD} .gd-seg').scrollIntoView({ block: 'center' }); }); await nap(400);`;
try {
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const x = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (x) ok(x[0]); }); server.once('exit', (c) => no(new Error(`Server exited ${c}`))); });
  browser('open', base); browser('emulate', '--viewport', '390x844x2,mobile,touch', '--color-scheme', theme);
  browser('open', `${base}#reports/${KEY}`);
  drive(`await wait(() => !!document.querySelector('${CARD} .gd-choice[data-u="no"]')); ${frame}
    await page.eval(() => document.querySelector('${CARD} .gd-choice[data-u="no"]').click()); await wait(() => !document.querySelector('${CARD} .gd-note').hidden);
    await page.eval(() => document.querySelector('${CARD} .gd-note').focus());`);
  // The note is typed with real key events, as a phone's keyboard sends them.
  browser('type', NOTE);
  drive(`await wait(() => !document.querySelector('${CARD} .gd-tell').hidden); await page.eval(() => document.activeElement.blur()); ${frame}`);
  const typed = page(CARD_STATE);
  assert.deepEqual([typed.pressed, typed.note_box, typed.tell], [['Not quite'], NOTE, true]);
  if (!before) capture('not-quite-note', 'On the report, Not quite is picked and the note is typed: Tell the agent shows under it.', typed);
  drive(`await page.eval(() => document.querySelector('${CARD} .gd-tell').click()); await nap(1200); ${frame}`);
  if (before) {
    const refused = page(CARD_STATE);
    assert.deepEqual(refused.errors, ['Could not send: This board takes answers only']);
    capture('not-quite-refused', 'Before the fix: after Tell the agent, the card shows the red error and nothing is saved.', { ...refused, saved_lines: saved().length });
  } else {
    drive(`await wait(() => !!document.querySelector('${CARD} .gd-cmt')); ${frame}`);
    const sent = page(CARD_STATE);
    assert.deepEqual([sent.errors, sent.comment, sent.comment_state, sent.note_box, sent.tell], [[], NOTE, 'Sent to the agent', null, false]);
    // Named report, not key, in the captures: the evidence check reads a "key" field as a secret.
    const lines = saved().map(({ key, part, verdict, text }) => ({ report: key, part, verdict, text }));
    assert.deepEqual(lines, [{ report: KEY, part: 'understood', verdict: 'disagree', text: NOTE }]);
    capture('not-quite-sent', 'After Tell the agent, no error shows: the note is under the part as Sent to the agent, and the board saved it.', { ...sent, saved: lines });
    // The report's author takes it from its own wait, once.
    const event = JSON.parse(cli('wait', board, '--filer', FILER, '--events', '--timeout', '10').trim());
    assert.deepEqual([event.event, event.key, event.part, event.verdict, event.text], ['comment', KEY, 'understood', 'disagree', NOTE]);
    drive(`await wait(() => /^Agent read it/.test(document.querySelector('${CARD} .gd-cmt .gd-st')?.textContent ?? '')); ${frame}`);
    const read = page(CARD_STATE);
    assert.match(read.comment_state, /^Agent read it \d\d:\d\d$/); assert.match(read.receipt, /Agent read your note \d\d:\d\d/);
    capture('not-quite-read', "The report's author takes the note with wait --filer: the part then says Agent read it with the time.", { ...read, wait_event: { event: event.event, report: event.key, part: event.part, verdict: event.verdict, text: event.text } });
  }
  writeFileSync(join(out, before ? 'steps.before.json' : 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board fed by another program (answers only, as the live board is) holding one guided report filed by agent-41.',
    steps: [`The report is opened on a phone, ${theme}.`, 'The person picks Not quite and types a note.', 'The person taps Tell the agent.', ...(before ? [] : ["The report's author runs wait --filer agent-41 --events."])],
    result: before ? 'The card shows Could not send: This board takes answers only, and nothing is saved.'
      : "On a phone, Not quite with a note is taken on an answers-only board: no error, the note shows as Sent to the agent, the board saves it, the report's author gets it from its wait, and the part then shows Agent read it." }, null, 2) + '\n');
} finally {
  try { browser('stop'); } catch {}
  server.kill();
  rmSync(dir, { recursive: true, force: true }); // its own mkdtemp board and nothing else
}
