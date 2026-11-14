// The rest of the board on the header rule (journey `layout-rest`): the Evidence proof sheet, the ticket sheet with its Linked tile, the report pane, the design pane and the Designs
// and Today design tiles at 360, 390, 445, 1280 and 1440, light and dark, captured at 2x over the DevTools protocol with exact device metrics, with test/support/layout-lint.mjs run on each.
// Saves `<side>.<screen>.<width>.<theme>.png` at the output folder's top level and `lint-rest.json`; this build is `after` and must have no fault. SIGN_OFF_REPO=<built base checkout> also records `before`.
// Usage: node .agents/skills/done-done-verify-sign-off/layout-rest-shots.mjs <output>
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { lint } from '../../../test/support/layout-lint.mjs';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync), found = {};
const heads = '.sh-head, .ui-shd, .rp-shd, .ev-shd, .tk-shd, .dz-oh, .split-bar, .reader-head';
mkdirSync(out, { recursive: true });
for (const [side, repo] of [['before', process.env.SIGN_OFF_REPO], ['after', '.']].filter(([, r]) => r).map(([s, r]) => [s, resolve(r)])) {
  const dir = mkdtempSync('/tmp/so-lrest-'), board = join(dir, 'board.json');
  const env = { ...process.env, TMPDIR: dir, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache') };
  const so = (...a) => { const r = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...a], { env, cwd: dir, encoding: 'utf8' }); assert.equal(r.status, 0, `the ${side} ${a[0]}: ${r.stdout}${r.stderr}`); return r; };
  const seeded = spawnSync('bash', [join(repo, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { cwd: repo, env: { ...env, SEED_SERVE_SECONDS: '5' }, encoding: 'utf8' });
  assert.equal(seeded.status, 0, `the ${side} board seeded: ${seeded.stderr}`);
  so('stop', board);
  // A ticket with a sub-task and a linked ask, so the sheet shows its key chip and its Linked tile.
  const b = JSON.parse(readFileSync(board, 'utf8'));
  for (const d of b.items) if (d.key === 'ship') Object.assign(d, { ticket: 'T-7', priority: 'P1' });
  writeFileSync(board, JSON.stringify(b, null, 2));
  const key = (f) => b.items.find(f)?.key;
  // head: what the lint reads as the header on a phone (sheet) and on a desk (pane).
  const routes = [['proof', `#evidence/${key((d) => d.type === 'evidence')}`], ['report', `#reports/${key((d) => d.type === 'report')}`], ['designs', '#designs'], ['design', '#designs/look'], ['today', '']];
  const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  const prof = join(dir, 'chrome'), chrome = spawn(chromium, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${prof}`, '--remote-debugging-port=0', 'about:blank'], { env, stdio: 'ignore' });
  try {
    let log = ''; server.stdout.on('data', (d) => (log += d));
    let url, port; for (let i = 0; i < 200 && !(url && port); i++) { await wait(100); url = /http:\/\/127\.0\.0\.1:\d+\//.exec(log)?.[0]; port = existsSync(join(prof, 'DevToolsActivePort')) && readFileSync(join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0]; }
    assert.ok(url && port, `the ${side} board and Chromium started: ${log}`);
    const ws = new WebSocket((await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
    let seq = 0; const replies = new Map();
    ws.onmessage = (m) => { const x = JSON.parse(m.data); replies.get(x.id)?.(x.result); replies.delete(x.id); };
    const send = (method, params = {}) => new Promise((ok) => { const id = ++seq; replies.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
    for (const theme of ['light', 'dark']) for (const width of [360, 390, 445, 1280, 1440]) for (const [name, hash] of routes) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: width >= 1024 ? 800 : 844, deviceScaleFactor: 2, mobile: width < 1024 });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      await send('Page.navigate', { url: 'about:blank' }); await wait(100);
      await send('Page.navigate', { url: url + hash }); await wait(1400);
      await evaluate('document.fonts.ready.then(() => 1)');
      const file = `${side}.${name}.${width}.${theme}.png`;
      found[file] = (await evaluate(lint('body', heads))) ?? ['lint did not run'];
      writeFileSync(join(out, file), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    ws.close();
  } finally { chrome.kill(); server.kill(); await wait(300); rmSync(dir, { recursive: true, force: true }); }
}
writeFileSync(join(out, 'lint-rest.json'), JSON.stringify(found, null, 1) + '\n');
// The step record keeps an earlier journey's steps in the same run (the designs capture the merge gate asks for).
const prior = existsSync(join(out, 'steps.json')) ? JSON.parse(readFileSync(join(out, 'steps.json'), 'utf8')) : null, clean = Object.entries(found).filter(([n]) => n.startsWith('after.')).every(([, f]) => !f.length);
writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version },
  start: [prior?.start, 'A seeded board with an ask, a proof, a report, a design and a ticket that links the ask, served by sign-off-axi serve'].filter(Boolean).join(' Then: '),
  steps: [...(prior?.steps ?? []), 'The person opens a proof, a ticket, a report and a design, and the Designs list and Today, at 360, 390, 445, 1280 and 1440 in light then dark',
    'The layout lint reads each header: the icon and its label a token apart on one line, every control 44px, nothing clipped or past the edge'],
  result: [prior?.result, clean ? 'The proof, ticket, report and design headers pass the layout lint at every width and theme' : 'The layout lint found faults'].filter(Boolean).join(' ') }, null, 1) + '\n');
for (const [n, f] of Object.entries(found)) if (n.startsWith('after.')) assert.deepEqual(f, [], `${n}: the layout lint found faults`);
console.log(`layout-rest: ${Object.keys(found).length} frames, after side clean`);
