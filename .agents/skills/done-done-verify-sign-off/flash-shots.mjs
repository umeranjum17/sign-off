// Does the board flash? One width per run, on a seeded board, a real headless Chromium driven over the DevTools protocol:
// the first load (the first read held a moment, as a phone's network holds it), a poll that brings a new ask, and answering a card.
// It watches the main region every frame and fails on what a person would call a flash:
//   - a blank main region: no region at all, or a region with no words on it once the board has drawn;
//   - a replaced main region: the region's own children, or a row that was on screen before and after, are not the same elements
//     (a rebuild re-decodes every picture, reloads every report frame and replays every entry animation: that is the flash);
//   - no loader: nothing on screen says the board is reading (the hairline at the top edge) while a read is in flight.
// It saves a still of each state, a recording of the whole run, and the frame-by-frame measurements beside them.
// Usage, from the repo root after `npm run build`: node .agents/skills/done-done-verify-sign-off/flash-shots.mjs <out folder> [light|dark] [390|1280] [--repo <checkout>]
// `--repo` points the seed and the server at another checkout (a built base) for a before: the same drive, the same checks, on that board's files.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const [outArg, theme = 'light', widthArg = '390', ...flags] = process.argv.slice(2);
if (!outArg) throw new Error('usage: flash-shots.mjs <out folder> [light|dark] [390|1280] [--repo <checkout>]');
const repo = resolve(flags.includes('--repo') ? flags[flags.indexOf('--repo') + 1] : join(import.meta.dirname, '../../..'));
const out = resolve(outArg), width = Number(widthArg), desk = width >= 1280, [W, H] = desk ? [1280, 800] : [390, 844];
const tag = (name) => `${name}.${width}w`;
mkdirSync(out, { recursive: true });
const cli = join(repo, 'dist/cli.js');
if (!existsSync(cli)) throw new Error(`${cli} is missing: run npm run build in ${repo} first`);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const board = mkdtempSync(join(tmpdir(), 'flash-board-'));
const scratch = mkdtempSync(join(tmpdir(), 'flash-chrome-'));
const env = { ...process.env, HOME: board, XDG_CONFIG_HOME: join(board, '.config'), XDG_DATA_HOME: join(board, '.local/share'), XDG_STATE_HOME: join(board, '.local/state'), XDG_CACHE_HOME: join(board, '.cache'), SIGN_OFF_FILER: 'verify' };
const served = (() => {
  // The repo's own seeding: one real posted item of each kind, one answered, served on its own port with its own HOME.
  const run = spawnSync('bash', [join(repo, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), board], { cwd: repo, encoding: 'utf8',
    // The seed sets HOME to its own folder; a version-manager shim in front of `node` reads that HOME and refuses, so this run's own node goes first.
    env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}` } });
  const url = /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(`${run.stdout ?? ''}`)?.[1];
  if (!url) throw new Error(`seed-board.sh printed no board URL: ${run.stderr || run.stdout}`);
  return url;
})();
// The board is a fixture of this run: it is stopped by its own CLI, never by a shell kill, and this folder goes with the browser's.
const stop = () => spawnSync(process.execPath, [cli, 'stop', join(board, 'board.json')], { env, encoding: 'utf8' });
const chrome = spawn(process.env.CHROME_PATH ?? '/usr/bin/chromium', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(scratch, 'profile')}`, `--window-size=${W},${H}`,
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMPDIR: scratch } });
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); };
try {
  const active = join(scratch, 'profile', 'DevToolsActivePort');
  for (let i = 0; i < 300 && !(existsSync(active) && readFileSync(active, 'utf8').includes('\n')); i++) await wait(100);
  const port = readFileSync(active, 'utf8').split('\n')[0];
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0;
  const replies = new Map(), frames = [];
  const send = (method, params = {}) => new Promise((ok) => { replies.set(++id, ok); ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (replies.has(msg.id)) { replies.get(msg.id)(msg.result); replies.delete(msg.id); }
    if (msg.method === 'Page.screencastFrame') {
      const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
      writeFileSync(join(scratch, name), Buffer.from(msg.params.data, 'base64'));
      frames.push({ name, t: msg.params.metadata.timestamp });
      send('Page.screencastFrameAck', { sessionId: msg.params.sessionId });
    }
    // The first read of the board is held a moment, as a phone's network holds it, so the loader and the skeleton are on screen long enough to be seen.

  };
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: desk ? 1 : 2, mobile: !desk });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  // The page's worker answers a read from its own copy, which a slow read never gets to see on a phone either: this run reads the board itself.
  await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  // A phone's network, so a read takes long enough to be seen: the skeleton and the loader are on screen while the first page comes, and the loader
  // shows for real on each poll.
  await send('Network.emulateNetworkConditions', { offline: false, latency: 260, downloadThroughput: 1_200_000, uploadThroughput: 500_000 });
  await send('Page.enable');
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value;
  const inPage = (body) => evaluate(`(async () => { const s = (ms) => new Promise((z) => setTimeout(z, ms)); ${body} })()`);
  const until = async (expression, ms = 15000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await evaluate(expression)) return true;
    return false;
  };
  // What the main region looked like on every frame: its children (by identity, so a rebuild shows as all-new children), the rows on it (each by its
  // key and identity), its words, its height, and whether the loader was up.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const log = window.__flash = { frames: [], polls: 0 };
    const seen = new WeakMap(); let n = 0; const nodeId = (x) => { if (!seen.has(x)) seen.set(x, ++n); return seen.get(x); };
    // A row is named by its key, its element, the list it sits in (by identity) and its own identity: an answered card moving to the answered list is
    // the person's own act and a different row to them, while a row that stayed in the same list and came back as a new element is the list rebuilt.
    // A row is named by its key (a card's key, or the address a desk row opens), its element, the list it sits in (by identity) and its own identity.
    const rows = (b) => [...b.querySelectorAll('[data-key]')].map((r) => r.dataset.key + '=' + r.localName + ':' + nodeId(r)).join(',');
    const sample = () => {
      const b = document.getElementById('board');
      if (b) log.frames.push({ t: Math.round(performance.now()), kids: b.children.length, ids: [...b.children].map((c) => c.localName + '.' + (c.className || '')).join('|'),
        kidIds: [...b.children].map(nodeId).join(','), rows: rows(b), text: (b.innerText || '').trim().length,
        h: Math.round(b.getBoundingClientRect().height), net: document.getElementById('net')?.hidden === false, skel: !!b.querySelector('.skel') });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    // The board's own poll: the check runs the very function the 20-second timer runs, not a stand-in for it.
    const si = window.setInterval;
    window.setInterval = (fn, ms) => { if (ms >= 10000) window.__poll = fn; return si(fn, ms); };
  })()` });
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `${tag(name)}.png`), Buffer.from(r.data, 'base64')); };
  await send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
  await send('Page.navigate', { url: `${served}${desk ? '#waiting' : ''}` });

  // A phase is what a person does: the frames it ran through, and the main region before and after it.
  const mark = async () => { const at = await evaluate('window.__flash.frames.length'); return at; };
  const since = async (from) => JSON.parse(await evaluate(`JSON.stringify(window.__flash.frames.slice(${from}))`));
  const now = async () => JSON.parse(await evaluate(`JSON.stringify(window.__flash.frames.at(-1) ?? null)`));
  const report = [];
  const phase = async (name, run) => {
    const from = await mark(), before = await now();
    const result = await run();
    const frameList = await since(from), after = await now();
    const worst = frameList.filter((f) => f.kids === 0);
    const blankAfterDraw = frameList.filter((f) => f.text === 0 && frameList.slice(0, frameList.indexOf(f)).some((x) => x.text > 0));
    check(!worst.length, `${name}: the main region was empty on ${worst.length} frame(s)`);
    check(!blankAfterDraw.length, `${name}: the main region had no words on ${blankAfterDraw.length} frame(s) after the board had drawn`);
    // A row that was on screen before the phase and after it is the same element still: the list is not torn down under the person's thumb. The card the
    // person just acted on is the one row allowed to change (it becomes an answered row, or leaves the list), so a phase may name the keys it acted on.
    const pairs = (list) => new Map((list ?? '').split(',').filter(Boolean).map((r) => [r.split('=')[0], r.split('=')[1]]));
    const rowsBefore = pairs(before?.rows), rowsAfter = pairs(after?.rows);
    // A row on screen before the phase and after it is the same element still: the list is not torn down under the person's thumb. The card the person
    // just acted on is the one row allowed to change (it becomes an answered row), and a phase names it in acted.
    const acted = result?.acted ?? [];
    const keptRows = [...rowsBefore.keys()].filter((k) => rowsAfter.has(k) && !acted.includes(k));
    const rebuilt = keptRows.filter((k) => rowsBefore.get(k) !== rowsAfter.get(k));
    check(!rebuilt.length, `${name}: ${rebuilt.length} of ${keptRows.length} rows on screen were rebuilt: ${rebuilt.join(', ')}`);
    if (rowsBefore.size) check(keptRows.length > 0, `${name}: nothing on screen stayed put under the check`);
    // How many times the region's own children changed identity: the board painting over itself is the flash.
    const shapes = []; for (const f of frameList) if (shapes.at(-1) !== f.kidIds) shapes.push(f.kidIds);
    const rebuilds = Math.max(0, shapes.length - 1);

    // The loader: up on some frame while the read was in flight, and down once what it read was on screen.
    if (result?.loading) check(frameList.some((f) => f.net), `${name}: no loader showed while the board was reading`);
    if (result?.loading) check(!after?.net, `${name}: the loader was still up after the read landed`);
    report.push({ phase: name, frames: frameList.length, rebuilds, regionShapes: shapes.length, keptRows: keptRows.length, rebuiltRows: keptRows.filter((k) => rowsBefore.get(k) !== rowsAfter.get(k)).length,
      loader: frameList.some((f) => f.net), skeleton: frameList.some((f) => f.skel), text: [Math.min(...frameList.map((f) => f.text)), after?.text], height: [before?.h, after?.h],
      rebuiltRows: keptRows.filter((k) => rowsBefore.get(k) !== rowsAfter.get(k)).length, ...result });
    console.log(`${name}: ${frameList.length} frames, ${rebuilds} redraws of the main region, ${keptRows.length} rows kept, loader ${frameList.some((f) => f.net) ? 'up' : 'never seen'}`);
    if (process.env.FLASH_DEBUG) console.log(`  before ${before?.rows}\n  after  ${after?.rows}`);
    return result;
  };

  // 1. The first load on Today, its read held: a loader and the skeleton while it comes, the board drawn once it has.
  await phase('first-load', async () => {
    // The skeleton and the loader, while the first page is still on its way.
    check(await until('!!document.querySelector("#board .skel") && document.getElementById("net")?.hidden === false', 20000), 'first-load: the skeleton and the loader never showed together');
    await shot('loading');
    const ok = await until('!!document.querySelector("#board .ui-row, #board .t-up") && !document.querySelector("#board .skel")', 20000);
    check(ok, 'first-load: the board never drew');
    const frames = JSON.parse(await evaluate('JSON.stringify(window.__flash.frames)'));
    check(frames.some((f) => f.skel), 'first-load: no skeleton showed while the first read was in flight');
    check(frames.some((f) => f.net), 'first-load: no loader showed while the first read was in flight');
    // The drawn board, painted: the still of it is taken a frame after the last part lands, never of the frame before.
    await wait(300);
    await shot('first-load');
    return { rows: await evaluate('document.querySelectorAll("#board [data-key]").length') };
  });

  // The person moves to Decide for the two updates below: a screen change is the person's own move, not a flash.
  await evaluate('location.hash = "#waiting"');
  check(await until('document.querySelectorAll("#board .dl-row, #board .split-list a[data-row]").length > 0'), 'the Decide list never drew');

  // 2. A poll: an agent asks a new question while the person is on the board, and the board's own poll reads it.
  const polled = await phase('refresh', async () => {
    const key = `flash-poll-${Date.now()}`;
    const asked = spawnSync(process.execPath, [cli, 'raise', join(board, 'board.json'), '--key', key, '--ask-ref', 'verify-flash', '--title', 'Does the board stay put on a poll?',
      '--why', 'A poll that rebuilds the list flashes.', '--outcome', 'yes=It stays put.', '--outcome', 'no=It jumps.', '--recommend', 'yes', '--recommend-reason', 'It is the point.', '--default', 'no'], { env, encoding: 'utf8' });
    check(asked.status === 0, `refresh: the new ask was not filed: ${asked.stdout || asked.stderr}`);
    check(await until('typeof window.__poll === "function"', 15000), 'refresh: the board never armed its own poll');
    const running = await evaluate('(window.__poll(), !document.getElementById("net")?.hidden)');
    check(running === true, 'refresh: no loader showed while the board was reading');
    check(await evaluate('document.getElementById("net")?.hidden === false'), 'refresh: the loader left before the read landed');
    await shot('refresh-loading');
    await until('document.getElementById("net")?.hidden === true', 15000);
    const ok = await until(`!!document.querySelector('#board .dl-row[data-key="${key}"]')`, 15000);
    check(ok, 'refresh: the new ask never reached the board');
    await shot('refresh');
    return { loading: true, newAsk: ok, key };
  });

  // 3. Answering a card: the ask opens, an answer is picked and sent, and the board shows it gone.
  await phase('answer', async () => {
    const open = await inPage(`const r = document.querySelector('#board [data-key="${polled.key}"] a.dl-face, #board [data-key="${polled.key}"] a, #board a[href$="/${polled.key}"]');
      if (!r) return 'missing'; r.click(); await s(700); return 'ok';`);
    check(open === 'ok', 'answer: no card opened');
    const picked = await inPage(`const ps = [...document.querySelectorAll('#board .ask-sheet .pick-option, #board .split-detail .pick-option, #board .pick-option')];
      if (!ps.length) return 'missing'; ps[0].click(); await s(500);
      const a = document.querySelector('#board .decide-bar .answer');
      return JSON.stringify({ before: typeof ps[0].onclick, pressed: ps[0].getAttribute('aria-pressed'), n: ps.length, bar: document.querySelectorAll('#board .decide-bar').length,
        live: ps[0].isConnected, text: a?.textContent, disabled: a?.disabled, pressedNow: [...document.querySelectorAll('#board .pick-option')].map((x) => x.getAttribute('aria-pressed')) });`);
    check(JSON.parse(picked).pressed === 'true', `answer: no answer could be picked (${picked})`);
    const sent = await inPage(`const b = document.querySelector('#board .decide-bar .answer');
      if (!b) return 'no-answer-button'; if (b.disabled) return 'disabled'; b.click(); await s(2200); return 'ok';`);
    check(sent === 'ok', `answer: the answer was not sent (${sent} at ${await evaluate('location.hash')})`);
    await shot('answer');
    // The card just answered is the one row allowed to change: it becomes an answered row, or leaves the list for the answered one.
    return { acted: [polled.key] };
  });

  await send('Page.stopScreencast');
  await wait(300);
  ws.close();
  const list = frames.map((f, i) => `file '${f.name}'\nduration ${((frames[i + 1]?.t ?? f.t + 1) - f.t).toFixed(4)}`);
  writeFileSync(join(scratch, 'list.txt'), `${list.join('\n')}\nfile '${frames.at(-1).name}'\n`);
  const mp4 = join(out, `${tag('board-flash')}.mp4`);
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(scratch, 'list.txt'), '-vf', `fps=30,format=yuv420p,scale=${desk ? '1280:800' : '780:1688'}`, '-c:v', 'libx264', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  if (r.status !== 0) failures.push('the recording could not be encoded');
  writeFileSync(join(out, `${tag('board-flash')}.json`), `${JSON.stringify({ url: served, repo, width, theme, phases: report }, null, 2)}\n`);
  writeFileSync(join(out, `${tag('board-flash')}.txt`), [`board: ${served}`, `repo: ${repo}`, `width: ${width}, theme: ${theme}`,
    ...report.map((p) => `${p.phase}: ${p.frames} frames, region shapes ${p.regionShapes}, rows kept ${p.keptRows}, rebuilt ${p.rebuiltRows}, loader ${p.loader ? 'up' : 'never'}, skeleton ${p.skeleton ? 'yes' : 'no'}, words ${p.text.join(' to ')}, height ${p.height.join(' to ')}`),
    '', failures.length ? `FAILED:\n- ${failures.join('\n- ')}` : 'PASSED: no blank frame, no rebuilt main region, a loader while reading.'].join('\n'));
  console.log(failures.length ? `FAILED\n- ${failures.join('\n- ')}` : 'PASSED: no blank frame, no rebuilt main region, a loader while reading.');
  if (failures.length) process.exitCode = 1;
} finally {
  chrome.kill();
  stop();
  await wait(500);
  rmSync(scratch, { recursive: true, force: true });
  rmSync(board, { recursive: true, force: true });
}
