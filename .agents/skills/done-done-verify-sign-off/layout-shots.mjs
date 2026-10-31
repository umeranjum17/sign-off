// Decide's ask header on one grid (journey `layout`): the ask as a sheet at 360, 390 and 445 and in the desk pane at 1280 and 1440, light and dark, captured at 2x
// over the DevTools protocol with exact device metrics, with test/support/layout-lint.mjs run on each frame. Saves `<side>.decide.<width>.<theme>.png` at the
// output folder's top level and `lint.json`; this build is `after` and must have no fault. SIGN_OFF_REPO=<built base checkout> also records the base as `before`.
// Usage: node .agents/skills/done-done-verify-sign-off/layout-shots.mjs <output>
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { lint } from '../../../test/support/layout-lint.mjs';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync), found = {};
mkdirSync(out, { recursive: true });
for (const [side, repo] of [['before', process.env.SIGN_OFF_REPO], ['after', '.']].filter(([, r]) => r).map(([s, r]) => [s, resolve(r)])) {
  const dir = mkdtempSync('/tmp/so-layout-'), board = join(dir, 'board.json');
  const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), TMPDIR: dir };
  const so = (...a) => execFileSync(process.execPath, [join(repo, 'dist/cli.js'), ...a], { env, cwd: dir, encoding: 'utf8' });
  // Three asks from an agent with no project, so the header carries the kind icon the captain's frame showed; the first is P1, filed now.
  const ask = (key, title, extra = ['--outcome', 'yes=It goes ahead.', '--outcome', 'no=It waits.', '--recommend', 'yes', '--default', 'yes']) =>
    so('raise', board, '--ask-ref', 'message-layout', '--key', key, '--title', title, '--why', 'The release waits on this answer.', '--recommend-reason', 'It is the safe choice.', ...extra);
  ask('ship', 'When should the new settings page ship?', ['--option', 'fri=Friday', '--option', 'next=Next week', '--outcome', 'fri=It ships Friday.', '--outcome', 'next=It ships next week.', '--recommend', 'fri', '--default', 'next', '--priority', 'P1']);
  ask('digest', 'Keep the weekly digest?');
  ask('quiet', 'Turn on the quiet hours for alerts?');
  const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  const prof = join(dir, 'chrome'), chrome = spawn(chromium, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${prof}`, '--remote-debugging-port=0', 'about:blank'], { env, stdio: 'ignore' });
  try {
    let log = ''; server.stdout.on('data', (b) => (log += b));
    let url, port; for (let i = 0; i < 200 && !(url && port); i++) { await wait(100); url = /http:\/\/127\.0\.0\.1:\d+\//.exec(log)?.[0]; port = existsSync(join(prof, 'DevToolsActivePort')) && readFileSync(join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0]; }
    assert.ok(url && port, `the ${side} board and Chromium started: ${log}`);
    const ws = new WebSocket((await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
    let seq = 0; const replies = new Map();
    ws.onmessage = (m) => { const x = JSON.parse(m.data); replies.get(x.id)?.(x.result); replies.delete(x.id); };
    const send = (method, params = {}) => new Promise((ok) => { const id = ++seq; replies.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
    for (const theme of ['light', 'dark']) for (const width of [360, 390, 445, 1280, 1440]) {
      const desk = width >= 1024, head = desk ? '.split-detail .split-bar' : '.ask-sheet .sh-head', name = `${side}.decide.${width}.${theme}.png`;
      await send('Emulation.setDeviceMetricsOverride', { width, height: desk ? 800 : 844, deviceScaleFactor: 2, mobile: !desk });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      await send('Page.navigate', { url: 'about:blank' }); await wait(150);
      await send('Page.navigate', { url: `${url}#decide/ship` });
      for (let i = 0; i < 100 && !(await evaluate(`document.fonts.ready.then(() => !!document.querySelector('${head} .detail-sequence'))`)); i++) await wait(100);
      found[name] = await evaluate(lint(desk ? '.split-detail' : '.ask-sheet', head));
      writeFileSync(join(out, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    ws.close();
  } finally { chrome.kill(); server.kill(); await wait(300); rmSync(dir, { recursive: true, force: true }); }
}
writeFileSync(join(out, 'lint.json'), JSON.stringify(found, null, 1) + '\n');
// The step record keeps an earlier journey's steps in the same run (the designs capture the merge gate asks for).
const prior = existsSync(join(out, 'steps.json')) ? JSON.parse(readFileSync(join(out, 'steps.json'), 'utf8')) : null, clean = Object.entries(found).filter(([n]) => n.startsWith('after.')).every(([, f]) => !f.length);
writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
  start: [prior?.start, 'A new board with three asks from an agent with no project (the first P1), served by sign-off-axi serve'].filter(Boolean).join(' Then: '),
  steps: [...(prior?.steps ?? []), 'The person opens the first ask from Decide: a sheet over the list at 360, 390 and 445, the pane beside the list at 1280 and 1440, in light then dark',
    'The layout lint reads each header: the icon and its label 8px apart on one line, every part on its row\'s centre line, every control 44px, nothing clipped or past the edge'],
  result: [prior?.result, clean ? 'Decide\'s ask header passes the layout lint at every width and theme' : 'The layout lint found faults'].filter(Boolean).join(' ') }, null, 1) + '\n');
for (const [n, f] of Object.entries(found)) if (n.startsWith('after.')) assert.deepEqual(f, [], `${n}: the layout lint found faults`);
console.log(`layout: ${Object.keys(found).length} frames, after side clean`);
