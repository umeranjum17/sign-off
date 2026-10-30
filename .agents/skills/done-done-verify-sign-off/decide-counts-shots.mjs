// Decide's counts: a design pick is no ask, so Asks leaves it out and Designs counts it once. A throwaway board holds one design pick of two layouts and three ordinary asks.
// Frames at 390 (phone) and 1280 (desk), light and dark: Decide (the Asks count over its list, or the sidebar's Decide badge beside it) and Designs (the Designs count over its list).
// Each frame is checked in the page: the number on the count equals the rows drawn under it, and the pick is in the Designs list and not the Asks list.
// Usage: node decide-counts-shots.mjs <output>
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-counts-'));
if (process.env.JG_HOME) {
  const r = spawnSync(join(process.env.JG_HOME, 'bin/jg-scratch.sh'), ['register', 'decide-asks-count-leaves-out-design-picks', dir], { stdio: 'inherit' });
  assert.equal(r.status, 0, 'register disposable board');
}
const portPicker = createServer();
await new Promise((ok) => portPicker.listen(0, '127.0.0.1', ok));
const browserPort = portPicker.address().port;
await new Promise((ok) => portPicker.close(ok));
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `decide-counts-${process.pid}`, CHROME_DEVTOOLS_AXI_PORT: String(browserPort) };
const browser = (...args) => {
  const r = spawnSync('chrome-devtools-axi', args, { env: browserEnv, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
};
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.c'), XDG_DATA_HOME: join(dir, '.d'), XDG_STATE_HOME: join(dir, '.s'), XDG_CACHE_HOME: join(dir, '.k') };
const live = (name) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><body style="margin:0;font:16px system-ui;background:#f4f2ef"><header style="padding:16px;font-weight:600">${name}</header><button style="margin:16px;padding:12px">Open a thread</button>`;
const OPTIONS = [['a', 'A: List and open thread'], ['b', 'B: One feed, replies inline']], ASKS = [['ship', 'Ship the settings page on Friday?'], ['digest', 'Keep the weekly digest?'], ['cache', 'Fix the shared cache lock?']];
const board = join(dir, 'board.json'), at = (m) => new Date(Date.now() - m * 60000).toISOString();
mkdirSync(join(dir, 'mocks/inbox-pick'), { recursive: true });
for (const [v, label] of OPTIONS) writeFileSync(join(dir, `mocks/inbox-pick/preview-${v}.html`), live(label));
writeFileSync(board, JSON.stringify({ schema: 2, items: [
  ...ASKS.map(([key, title], i) => ({ filed: at(30 + i), key, title, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], recommend_value: 'yes' })),
  { filed: at(5), key: 'inbox-pick', title: 'Which layout should the Inbox use?', about: 'Two ways to hold your chats.', options: OPTIONS.map(([value, label]) => ({ value, label })), recommend_value: 'a', type: 'design',
    tradeoff: 'A shows each message\'s progress in its row; B reads top to bottom.', mocks: OPTIONS.map(([value]) => ({ value, path: `mocks/inbox-pick/preview-${value}.html` })), filer: 'sign-off' }] }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let server;
try {
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127.0.0.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', () => no(Error('server exited'))); });
  browser('open', url);
  const evalIn = (expression) => {
    const r = spawnSync('chrome-devtools-axi', ['run'], { env: browserEnv, encoding: 'utf8', timeout: 120000,
      input: `console.log(JSON.stringify(await page.eval(${JSON.stringify(expression)})));` });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout);
  };
  const HEIGHT = { 390: 844, 1280: 800 }, records = [];
  const READ = `(() => { const num = (e) => Number(e?.textContent.replace(/\\D/g, '')), phone = innerWidth < 1024, seg = [...document.querySelectorAll('.dl-seg button')],
    side = (h) => num(document.querySelector('#nav a[href="#' + h + '"] .n')), rows = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length);
    return { phone, hash: location.hash, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollContainerCount: [...document.querySelectorAll('body *')].filter((e) => e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)).length,
      designStates: rows('#board [id^="item-"] .meta').map((e) => e.textContent),
      asksCount: phone ? num(seg[0]?.querySelector('small')) : side('waiting'), designsCount: phone ? num(seg[1]?.querySelector('small')) : side('designs'),
      askRows: rows('.decide-list .dl-row:not(.g-done)').map((e) => e.dataset.key), designRows: rows('#board [id^="item-"]').map((e) => e.id.slice(5)) }; })()`;
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) for (const [name, hash] of [['decide', '#waiting'], ['designs', '#designs']]) {
    const phone = width < 1024;
    browser('emulate', '--viewport', `${width}x${HEIGHT[width]}x2${phone ? ',mobile,touch' : ''}`, '--color-scheme', theme);
    browser('open', `${url}${hash}`); await wait(500);
    browser('eval', `() => { localStorage.setItem('so-theme', '${theme}'); location.reload(); return true; }`); await wait(700);
    const r = evalIn(READ), file = `${name}.${width}.${theme}.png`;
    browser('screenshot', join(out, file));
    records.push({ file, ...r });
    const where = `${name} ${width} ${theme}`;
    assert.equal(r.overflowX, false, `${where}: no sideways overflow`);
    assert.equal(r.asksCount, ASKS.length, `${where}: Asks counts the three asks, not the design pick`);
    assert.equal(r.designsCount, 1, `${where}: Designs counts the pick`);
    if (name === 'decide') {
      assert.deepEqual([...r.askRows].sort(), ASKS.map(([k]) => k).sort(), `${where}: the Asks list holds the three asks and no pick`);
      assert.equal(r.askRows.length, r.asksCount, `${where}: Asks count equals its rows`);
    } else {
      assert.ok(r.designStates.some((s) => s.includes('Waiting on you')), `${where}: the waiting pick still counts as a design`);
      assert.deepEqual(r.designRows, ['inbox-pick'], `${where}: the Designs list holds the pick once`);
      assert.equal(r.designRows.length, r.designsCount, `${where}: Designs count equals its rows`);
    }
  }
  writeFileSync(join(out, 'counts.json'), JSON.stringify(records, null, 2));
  writeFileSync(join(out, 'steps.counts.json'), JSON.stringify({ commit: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    target: { version: spawnSync(process.execPath, [join(repo, 'dist/cli.js'), '--version'], { encoding: 'utf8' }).stdout.trim() },
    start: 'A throwaway board holding three ordinary asks and one design pick of two Inbox layouts.',
    steps: ['Open Decide and read the Asks count over its list', 'Open Designs and read the Designs count over its list', 'Capture at 390 and 1280 wide, light and dark'],
    result: 'Asks counts 3 over 3 asks with no pick among them; Designs counts 1 over the one pick' }, null, 2));
  writeFileSync(join(out, 'steps.json'), readFileSync(join(out, 'steps.counts.json')));
} finally {
  try { browser('stop'); } finally { server?.kill(); }
  await wait(400); rmSync(dir, { recursive: true, force: true });
}

// The merge requirement also needs the approved Designs capture in this same run.
const designs = spawnSync(process.execPath, [join(repo, '.agents/skills/done-done-verify-sign-off/designs-shots.mjs'), out, 'dark', '1440'], { stdio: 'inherit' });
assert.equal(designs.status, 0, 'approved Designs journey');
renameSync(join(out, 'designs.after.dark.1440w.png'), join(out, 'designs.1440.dark.png'));
renameSync(join(out, 'designs.after.dark.1440w.dom.json'), join(out, 'designs.1440.dark.dom.json'));
const countsSteps = JSON.parse(readFileSync(join(out, 'steps.counts.json'), 'utf8'));
const designsSteps = JSON.parse(readFileSync(join(out, 'steps.json'), 'utf8'));
writeFileSync(join(out, 'steps.json'), JSON.stringify({ ...countsSteps,
  steps: [...countsSteps.steps, ...designsSteps.steps], result: countsSteps.result + '. ' + designsSteps.result }, null, 2));
