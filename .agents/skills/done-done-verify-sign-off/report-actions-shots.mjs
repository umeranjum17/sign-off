// The Actions block a report ends on, at 390 and 1280 in light and dark: the three controls with their result lines and one recommended,
// Refine's typed or spoken note, the owner's version 2 with the diff of what changed, Reject's reason chips and line, and the closed record
// with its Reopen. Both replays run for real through the board's own endpoint and CLI, and their transcripts are written as text.
// Usage: node .agents/skills/done-done-verify-sign-off/report-actions-shots.mjs <output> [light|dark] [390|1280]   (no theme or width: all four cells)
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT ?? '.');
const cells = [['light', 390], ['dark', 390], ['light', 1280], ['dark', 1280]]
  .filter(([t, w]) => (!process.argv[3] || process.argv[3] === t) && (!process.argv[4] || +process.argv[4] === w));
assert.ok(cells.length, 'theme is light or dark; width is 390 or 1280');
mkdirSync(out, { recursive: true });
const repo = resolve(import.meta.dirname, '../../..'), cliJs = join(repo, 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'so-actions-dec-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
for (const k of Object.keys(env)) if (/^(FM_|FIRSTMATE|SIGN_OFF_)/.test(k)) delete env[k];
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 180000, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const cli = (...args) => run(process.execPath, [cliJs, ...args], { env });
const KEY = 'paint-budget', FILER = 'agent-41';
const message = (patch = {}) => ({ ...JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v5/valid-minimal.json'), 'utf8')), key: KEY, filed: '2026-10-31T09:00:00Z', filer: FILER, ...patch });
const messageFile = (name, patch = {}) => { const file = join(dir, name); writeFileSync(file, JSON.stringify(message(patch))); return file; };
const lines = (file) => { try { return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

const stop = async (proc) => { try { proc.kill(); } catch {} await new Promise((ok) => (proc.exitCode !== null ? ok() : proc.once('exit', ok))); };
const serveBoard = async (file) => {
  const proc = spawn(process.execPath, [cliJs, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (b) => { log += b; });
  proc.stderr.on('data', (b) => { log += b; });
  const base = await new Promise((ok, no) => {
    proc.stdout.on('data', () => { const x = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (x) ok(x[0]); });
    proc.once('exit', (c) => no(new Error(`Server exited ${c}: ${log}`)));
  });
  return { proc, base };
};
const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-dec-${process.pid}`, CHROME_DEVTOOLS_AXI_PORT: String(port),
  // The bridge's own npx bootstrap is slow on a loaded host: give it a minute and a half rather than fail the proof.
  CHROME_DEVTOOLS_AXI_BRIDGE_TIMEOUT_MS: '90000' };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const nap = (ms) => new Promise(r=>setTimeout(r,ms));\nconst wait = async (s) => { for (let i=0;i<120;i++) { if (await page.eval(`!!document.querySelector(${JSON.stringify(s)})`)) return; await nap(100); } throw new Error("Not ready: " + s); };\n' + script });
const evalIn = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn})));`).trim().split('\n').pop());
const click = (sel) => drive(`await page.eval(() => document.querySelector(${JSON.stringify(sel)}).click()); await nap(500);`);
const post = async (base, body) => { const r = await fetch(`${base}api/report-action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const transcript = [];
const note = (line) => { transcript.push(line); console.log(line); };
const MEASURE = (sel) => `() => [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect();
  return { name: (e.getAttribute('aria-label') || e.textContent).trim().replace(/\\s+/g, ' ').slice(0, 46), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), bottom: Math.round(r.bottom) }; })`;
const shot = (name, claim, theme, width) => {
  const stem = `${name}.${theme}.${width}w`;
  browser('screenshot', join(out, `${stem}.png`));
  const dom = evalIn(`() => { const w = document.documentElement.clientWidth; return { overflow: document.documentElement.scrollWidth > w, wide: [...document.querySelectorAll('#reader *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > w + 1).map(e => e.tagName.toLowerCase() + '.' + e.className).slice(0, 6) }; }`);
  assert.equal(dom.overflow, false); assert.deepEqual(dom.wide, []);
  writeFileSync(join(out, `${stem}.txt`), `${width}px ${theme}: ${claim}\n`);
};
const open = async (base, theme, width) => {
  browser('open', base); browser('emulate', '--viewport', width < 900 ? `${width}x844x2,mobile,touch` : `1280x860x1`, '--color-scheme', theme);
  browser('open', `${base}#reports/${KEY}`);
  drive("await wait('.rda'); await page.eval(() => { const s = document.querySelector('.gd-scroll'); if (s) s.style.scrollBehavior = 'auto'; });");
};
try {
  // Every cell starts from its own throwaway board holding one report, so each frame is the same report in a real state.
  const v2 = messageFile('v2.json', { version: 2, changes: [{ kind: 'added', text: 'The rollback step you asked for' }, { kind: 'rewritten', text: 'Cut the cost estimate to one server', was: 'Cost estimate for two servers' }, { kind: 'removed', text: 'The second-region test' }] });
  for (const [theme, width] of cells) {
    const cellBoard = join(dir, `board-${theme}-${width}.json`), cellActions = `${cellBoard.replace(/\.json$/, '')}.report-actions.jsonl`, cellLearnings = `${cellBoard.replace(/\.json$/, '')}.report-learnings.jsonl`, cellTickets = `${cellBoard.replace(/\.json$/, '')}.tickets.jsonl`;
    cli('post', cellBoard, '--kind', 'report', '--from', messageFile(`v1-${theme}-${width}.json`), '--filer', FILER);
    const { proc, base } = await serveBoard(cellBoard);
    try {
    await open(base, theme, width);
    // The block is at the foot of the report: the frame shows it, not the top of the page.
    drive("await page.eval(() => { const b = document.querySelector('.rda'), s = document.querySelector('.gd-scroll'); if (s) s.scrollTop += b.getBoundingClientRect().top - s.getBoundingClientRect().top - 40; else b.scrollIntoView({ block: 'center' }); }); await nap(600);");
    const rest = evalIn(`() => { const b = document.querySelector('.rda'), acts = [...b.querySelectorAll('.rda-a')]; return { heading: b.querySelector('h2').textContent, acts: acts.map(a => ({ label: a.querySelector('.lab').firstChild.textContent.trim(), rec: a.querySelector('.rec')?.textContent ?? '', res: a.querySelector('.res').textContent.trim(), h: Math.round(a.getBoundingClientRect().height) })), nothing: b.querySelector('.rda-none').textContent }; }`);
    assert.equal(rest.heading, 'Your decision');
    assert.deepEqual(rest.acts.map((a) => a.label), ['Approve', 'Refine', 'Reject']);
    assert.deepEqual(rest.acts.map((a) => a.rec), ['Recommended', '', ''], 'only the recommended one says so');
    assert.ok(rest.acts.every((a) => /Ada opens the first PR by Fri 6 Nov|Ada posts version 2 here|Ada keeps your reason as a rule/.test(a.res)), JSON.stringify(rest));
    assert.ok(rest.acts.every((a) => a.h >= 48), JSON.stringify(rest.acts));
    assert.match(rest.nothing, /Do nothing and it stays open, unread/);
    shot('rest', `The report's foot: three controls from its own actions - Approve (recommended) "Starts the build. Ada opens the first PR by Fri 6 Nov.", Refine "Sends it back with a note. Ada posts version 2 here.", Reject "Closes it, starts nothing. Ada keeps your reason as a rule." - and the do-nothing line. The controls measure ${rest.acts.map((a) => a.h).join('/')} px tall.`, theme, width);
    if (width < 900) {
      // Past Next step the three become one bar at the foot of the screen, 48 px a target.
      drive("await page.eval(() => { const s = document.querySelector('.gd-scroll'), n = document.querySelector('[data-stage=\"next\"]'); s.scrollTop += n.getBoundingClientRect().top - (innerHeight - 140); }); await nap(800);");
      const stick = evalIn(MEASURE('.rda-stick button'));
      assert.equal(stick.length, 3, JSON.stringify(stick));
      assert.equal(evalIn("() => getComputedStyle(document.querySelector('.rda-stick')).display"), 'grid', 'the bar is on screen, not merely in the page');
      assert.ok(stick.every((b) => b.h >= 48 && b.w > 60), JSON.stringify(stick));
      shot('bar', 'Past Next step the three actions become one bar at the foot of the screen, 48 px each, and it gives way to the real block when the person reaches it.', theme, width);
      drive("await page.eval(() => { document.querySelector('.gd-scroll').scrollTop = 1e6; }); await nap(500);");
    }
    // Refine: a note typed, then the microphone tapped (its listening state on screen).
    click('.rda-a.refine');
    drive("await wait('.rda-note');");
    drive(`await page.eval(() => { const t = document.querySelector('.rda-note'); t.value = 'Add the rollback step, and cut the cost to one server'; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.rda-mic').click(); }); await nap(500);`);
    const refine = evalIn(`() => { const b = document.querySelector('.rda'); const m = b.querySelector('.rda-mic'); return { heading: b.querySelector('h2').textContent, sub: b.querySelector('.rda-sub').textContent, mic: m.textContent, note: b.querySelector('.rda-note').value, go: b.querySelector('.rda-go').textContent, heard: b.querySelector('.rda-heard')?.textContent ?? '' }; }`);
    assert.equal(refine.heading, 'Refine'); assert.match(refine.sub, /Ada redoes it and posts version 2 here/);
    assert.match(refine.go, /Send back to Ada/); assert.match(refine.mic, /Speak the note|Listening/);
    shot('refine', `Refine open: "What should change? One line is enough.", the note "${refine.note}", and the microphone (${refine.mic}); "Send back to Ada" and Cancel.`, theme, width);
    // The tap that sends it: one line in the board's own record, no build.
    click('.rda .rda-go');
    drive("await wait('.rda .rda-closed');");
    const sent = evalIn(`() => document.querySelector('.rda').textContent.replace(/\\s+/g, ' ').trim()`);
    assert.match(sent, /Sent to Ada/);
    assert.equal(lines(cellActions).at(-1).action, 'refine');
    assert.equal(lines(cellActions).at(-1).result, 'version', 'Refine asks for a version, it starts no build');
    assert.equal(lines(cellTickets).length, 0, 'Refine starts no build');
    note(`[${theme} ${width}] refine replay: sent back -> "${sent}"; board.report-actions.jsonl action=refine result=version; board.tickets.jsonl absent`);
    // The owner redoes it: the same key, one version on, with the lines that changed.
    const posted = cli('post', cellBoard, '--kind', 'report', '--from', v2, '--filer', FILER);
    assert.match(posted, /version 2 posted/, posted);
    await open(base, theme, width);
    const ver = evalIn(`() => { const v = document.querySelector('.rda-ver'); return { meta: v?.querySelector('.rda-vmeta')?.textContent, lines: [...(v?.querySelectorAll('.rda-d') ?? [])].map(l => l.textContent.replace(/\\s+/g, ' ').trim()), head: document.querySelector('.rda h2')?.textContent }; }`);
    assert.match(ver.meta, /^Version 2 · /); assert.equal(ver.lines.length, 3, JSON.stringify(ver));
    assert.match(ver.lines[1], /was Cost estimate for two servers/);
    assert.equal(ver.head, 'Your decision', 'version 2 asks again, on the same report');
    drive("await page.eval(() => { const v = document.querySelector('.rda-ver'); const s = document.querySelector('.gd-scroll'); if (v && s) s.scrollTop += v.getBoundingClientRect().top - s.getBoundingClientRect().top - 8; }); await nap(500);");
    shot('version2', `Version 2 on the same report: "${ver.meta}", then What changed - ${ver.lines.join(' | ')} - and the same three actions for it.`, theme, width);
    note(`[${theme} ${width}] version 2: ${ver.meta}; ${ver.lines.join(' | ')}`);
    // Reject: the chips, one picked, and the line for the owner.
    click('.rda-a.reject');
    drive("await wait('.rda-chip');");
    drive(`await page.eval(() => { [...document.querySelectorAll('.rda-chip')][1].click(); const l = document.querySelector('.rda-line'); l.value = 'We do not need a second server for this'; l.dispatchEvent(new Event('input', { bubbles: true })); }); await nap(300);`);
    const rej = evalIn(`() => { const b = document.querySelector('.rda'); return { heading: b.querySelector('h2').textContent, chips: [...b.querySelectorAll('.rda-chip')].map(c => [c.textContent, c.getAttribute('aria-checked')]), close: b.querySelector('.rda-go').textContent, h: Math.round(b.querySelector('.rda-go').getBoundingClientRect().height) }; }`);
    assert.equal(rej.heading, 'Reject'); assert.deepEqual(rej.chips.map(([c]) => c), ['Wrong direction', 'Too expensive', 'Not now', 'Already handled']);
    assert.equal(rej.chips[1][1], 'true'); assert.match(rej.close, /Reject and close/); assert.ok(rej.h >= 44);
    shot('reject', 'Reject open: the four reason chips with "Too expensive" picked, "One line for Ada" holding "We do not need a second server for this", and Reject and close.', theme, width);
    click('.rda .rda-go');
    drive("await wait('.rda .rda-closed');");
    const closed = evalIn(`() => { const b = document.querySelector('.rda'); return { text: b.textContent.replace(/\\s+/g, ' ').trim(), reopen: !!b.querySelector('.rda-text'), acts: b.querySelectorAll('.rda-a').length }; }`);
    assert.match(closed.text, /Closed by you · .* · Too expensive/);
    assert.match(closed.text, /Ada's rule now: We do not need a second server for this\./);
    assert.equal(closed.reopen, true, 'the closed report shows a Reopen link'); assert.equal(closed.acts, 0, 'the three actions are gone once it is closed');
    const closedLine = lines(cellActions).at(-1), learning = lines(cellLearnings).at(-1);
    assert.equal(closedLine.action, 'reject'); assert.equal(closedLine.result, 'closed');
    assert.equal(learning.rule, 'We do not need a second server for this.');
    assert.equal(lines(cellTickets).length, 0, 'Reject never starts a build');
    note(`[${theme} ${width}] reject replay: closed -> "${closed.text}"; board.report-actions.jsonl action=reject result=closed reason=${closedLine.reason}; board.report-learnings.jsonl owner=${learning.owner} rule="${learning.rule}"; board.tickets.jsonl absent`);
    shot('closed', `Closed: ${closed.text}`, theme, width);
    // Reopen through the board's own endpoint: the report comes back to its three actions.
    const reopened = await post(base, { key: KEY, action: 'reopen' });
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
    assert.equal(reopened.body.report_actions[KEY].action, 'reopen');
    const reread = await (await fetch(`${base}api/state`)).json();
    assert.equal(reread.report_actions[KEY].action, 'reopen', 'Reopen puts the report back on its actions');
    note(`[${theme} ${width}] reopen replay: key ${KEY} action reopen result open; the three actions come back`);
    // And the one tap that starts the work: Approve mints the queued ticket the fleet reads, and the block says who has it and when.
    await open(base, theme, width);
    click('.rda-a.approve');
    drive("await wait('.rda-closed');");
    const started = evalIn(`() => document.querySelector('.rda').textContent.replace(/\\s+/g, ' ').trim()`);
    assert.match(started, /Build started/); assert.match(started, /Approved by you/);
    assert.match(started, /The first pull request lands by Fri 6 Nov\. Its ticket is on Tickets\./);
    const minted = lines(cellTickets);
    assert.equal(minted.length, 1, 'one approval, one ticket');
    assert.equal(minted[0].id, `build-${KEY}`); assert.equal(minted[0].state, 'queued'); assert.equal(minted[0].stage, 'queued');
    const approved = lines(cellActions).at(-1);
    assert.equal(approved.action, 'approve'); assert.equal(approved.result, 'build'); assert.equal(approved.ticket, `build-${KEY}`);
    note(`[${theme} ${width}] approve replay: "${started}"; board.tickets.jsonl id=${minted[0].id} state=queued stage=queued; board.report-actions.jsonl action=approve result=build ticket=${approved.ticket}`);
    shot('approved', `Approved: "${started}" — the queued ticket build-${KEY} is on the board and no action is left but the result line.`, theme, width);
    } finally { await stop(proc); }
  }
  writeFileSync(join(out, 'replays.log'), `${transcript.join('\n')}\n`);
  writeFileSync(join(out, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board holding one guided status report that declares its Actions block (role addons lead, owner Ada, first pull request 2026-11-06, recommended approve).',
    steps: [
      'The report is opened at 390 and at 1280, light and dark: its foot holds Approve (Recommended), Refine and Reject, each with its plain result line, and the line on doing nothing.',
      'On a phone, past Next step, the three become one bar at the foot of the screen, 48 px each.',
      'Refine is tapped, a note is typed and the microphone is tapped: the note field, the listening state and Send back to Ada.',
      'Send back to Ada records the refine in board.report-actions.jsonl with result version and starts no build.',
      'The owner posts version 2 on the same key with three changed lines: the board shows "Version 2 · Ada · ...", What changed with + ~ (was ...) and a struck-through removed line, and the same three actions.',
      'Reject is tapped, "Too expensive" is picked and a line is typed: Reject and close.',
      'The report closes: Closed by you with the reason, the line and "No build started. Ada\'s rule now: ...", and a Reopen link; no ticket is minted.',
      'Reopen is sent through POST /api/report-action and the three actions come back.'
    ],
    result: 'A report ends on its own declared actions: Refine sends it back and version 2 lands on the same key with the diff, Reject closes it and records the owner\'s rule as a learning, Reopen brings it back, and both replays are in the run\'s log.'
  }, null, 2) + '\n');
} finally {
  try { browser('stop'); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
