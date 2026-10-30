// The README's pictures: the real board for Umer on a board of its own, at 390x844 (phone, 2x) and 1280x800 (desk, 1x), light and dark, in a headless Chromium of its own over the DevTools
// protocol. Today, Decide (asks, Taken without you, the Leash chip), a report in the reader with its action bar, Evidence with Previews on, the Tickets epic tree, Designs (phone) and
// Today's More with its Install app row (phone). Every project has its own icon, so no list shows a letter tile; the run fails on a letter tile, overflow, a console error, a failed request or a token in a frame.
// Usage: node .agents/skills/done-done-verify-sign-off/readme-shots.mjs <output>   (after npm run build)
// Saves <shot>.<theme>.<width>w.png with its .dom.json, and steps.json.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-rm-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache') };
delete env.SIGN_OFF_FILER; delete env.CLAUDE_CODE_SESSION_ID;
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, env, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const so = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args]);
const at = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19) + 'Z';
const icon = (name, a, b, glyph) => writeFileSync(join(dir, name + '.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${a}"/>${glyph.replace('B', b)}</svg>`);

const prof = mkdtempSync(join(tmpdir(), 'so-rm-chrome-'));
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let ws, server;
const errors = [], failed = [], frames = [];
try {
  // Projects with their own icons, tickets as an epic tree, and real raised asks, designs, proof and a report.
  writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\nleash: act\n');
  cpSync(join(repo, 'docs/logo.svg'), join(dir, 'sign-off.svg'));
  icon('beacon', '#0f766e', '#fff', '<circle cx="32" cy="32" r="8" fill="B"/><circle cx="32" cy="32" r="17" fill="none" stroke="B" stroke-width="4" opacity=".7"/><circle cx="32" cy="32" r="26" fill="none" stroke="B" stroke-width="3" opacity=".4"/>');
  icon('harbor', '#b45309', '#fff', '<path d="M32 12v34M20 24h24M14 40c4 10 12 12 18 12s14-2 18-12" fill="none" stroke="B" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="14" r="4" fill="B"/>');
  for (const [n, f] of [['sign-off', 'sign-off.svg'], ['Beacon', 'beacon.svg'], ['Harbor', 'harbor.svg']]) so('project', board, '--name', n, '--icon', f);
  const tk = (id, title, project, extra = []) => so('ticket', board, '--id', id, '--title', title, '--project', project, ...extra);
  tk('E-1', 'Settings page, start to finish', 'sign-off', ['--asked', 'yes', '--priority', 'P1', '--release', '0.6.5']);
  tk('T-41', 'Ship the new settings page', 'sign-off', ['--parent', 'E-1', '--progress', '70', '--pr', 'https://github.com/umeranjum17/sign-off/pull/241', '--state', 'in progress']);
  tk('T-42', 'Settings on a phone', 'sign-off', ['--parent', 'T-41', '--progress', '100', '--state', 'done', '--pr', 'https://github.com/umeranjum17/sign-off/pull/239']);
  tk('T-43', 'Theme in one tap', 'sign-off', ['--parent', 'T-41', '--progress', '40']);
  tk('T-44', 'Export settings as a file', 'sign-off', ['--parent', 'E-1', '--progress', '0', '--state', 'queued']);
  tk('T-12', 'Push service for the beta', 'Beacon', ['--progress', '30', '--priority', 'P2', '--hold', 'yes', '--hold-reason', 'waiting on the beta push', '--state', 'on hold']);
  tk('T-7', 'Tide table on the harbor screen', 'Harbor', ['--asked', 'yes', '--progress', '60']);
  const raise = (key, filer, ticket, title, why, outcomes, extra = []) => so('raise', board, '--ask-ref', 'readme-demo', '--filer', filer, '--ticket', ticket, '--key', key, '--title', title, '--why', why,
    ...outcomes.flatMap((o) => ['--outcome', o]), ...extra);
  raise('release-day', 'release-agent', 'T-41', 'Which day should the release ship?', 'Two fixes are still in review: A, B or C.', ['a=It ships now, without the 2 fixes.', 'b=It ships with both fixes.', 'c=It waits for the redesign too.'],
    ['--option', 'a=A: Today', '--option', 'b=B: Friday', '--option', 'c=C: Next week', '--priority', 'P2', '--recommend', 'b', '--recommend-reason', 'Both fixes land by Thursday.', '--default', 'b']);
  writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\nleash: matters\n');
  raise('ship-settings', 'release-agent', 'T-41', 'When should the new settings page ship?', 'No new bug reports for three weeks; the release train leaves at four.', ['friday=The page ships Friday with the release.', 'next-week=The page waits for next week\'s release.'],
    ['--option', 'friday=Friday', '--option', 'next-week=Next week', '--priority', 'P1', '--recommend', 'friday', '--recommend-reason', 'Three quiet weeks support shipping.', '--default', 'next-week', '--silent-by', at(3 * 3600_000)]);
  raise('use-ntfy', 'beacon-agent', 'T-12', 'Use ntfy for the beta pushes?', 'The beta starts on 1 Nov and needs a push for new answers.', ['yes=Pushes go through ntfy.', 'no=Pushes wait for another service.'],
    ['--priority', 'P2', '--recommend', 'yes', '--recommend-reason', 'It is free and under 2 seconds.', '--default', 'yes']);
  raise('hosting-pro', 'harbor-agent', 'T-7', 'Move the hosting to the Pro plan?', 'The free plan sleeps after an hour, so links open slowly in the morning.', ['yes=Hosting moves to Pro at 20 dollars a month.', 'no=It stays on the free plan.'],
    ['--recommend', 'yes', '--recommend-reason', 'Morning links open in under a second.', '--default', 'no', '--silent-by', at(-60_000)]);
  raise('weekly-digest', 'digest-agent', 'T-7', 'Keep sending the weekly digest?', 'Open rate held steady at about a third for two months.', ['yes=It keeps going out each Monday.', 'no=It stops after this week.'],
    ['--recommend', 'yes', '--recommend-reason', 'Readers still open it.', '--default', 'yes', '--silent-by', at(-30_000)]);
  // Captures of the real product, a done-done run for two of them, and a design with frames.
  const media = join(dir, 'media'); mkdirSync(media);
  for (const n of ['phone-today', 'phone-decide', 'phone-evidence', 'phone-reports', 'phone-plan']) copyFileSync(join(repo, 'docs/media', n + '.webp'), join(media, n + '.webp'));
  mkdirSync(join(dir, '.done-done/runs'), { recursive: true });
  const proof = (n, title, about, run, outcome, files, pr) => {
    const sha = (f) => sh(process.execPath, ['-e', 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex"))', f]);
    const commit = '0000000000000000000000000000000000000000';
    writeFileSync(join(dir, '.done-done/runs', run + '.json'), JSON.stringify({ schema: 1, run_id: run, commit, tree: 'a'.repeat(40), dirty: false, exit: 0,
      files: files.map((f) => ({ path: 'media/' + f, sha256: sha(join(dir, 'media', f)), bytes: readFileSync(join(dir, 'media', f)).length })) }));
    writeFileSync(join(dir, n + '.json'), JSON.stringify({ contract: 1, kind: 'evidence', schema: 1, title, filer: 'verify', about, media: files.map((f) => 'media/' + f), link: pr,
      run: { run_id: run, commit, outcome, repro: 'repro: n/a: no bug', proof: 'done-done-verify-sign-off: npm test, phone, 390, passed', evidence: files.join(', ') } }));
    so('post', board, '--kind', 'evidence', '--from', join(dir, n + '.json'), '--ticket', 'T-41');
  };
  proof('ev1', 'Settings fit a phone without sideways scroll', 'Umer opens Settings on a 390 px phone and sees every row.', '20261020T090000Z-a1b2c3d4', 'Umer sees every Settings row without scrolling sideways.', ['phone-today.webp', 'phone-decide.webp'], 'https://github.com/umeranjum17/sign-off/pull/239');
  proof('ev2', 'The theme changes in one tap', 'Umer taps the moon and the board turns dark at once.', '20261021T090000Z-b2c3d4e5', 'Umer taps once and the whole board turns dark.', ['phone-evidence.webp', 'phone-reports.webp', 'phone-plan.webp'], 'https://github.com/umeranjum17/sign-off/pull/241');
  so('post', board, '--type', 'evidence', '--title', 'The export button on a phone', '--about', 'Umer sees the Export button above the fold.', '--media', join(media, 'phone-plan.webp'), '--ticket', 'T-41');
  // A design asked as one question: today's Decide against the one with the Leash chip, both real captures of the product.
  mkdirSync(join(dir, 'design'));
  copyFileSync(join(repo, 'docs/media/phone-decide.webp'), join(dir, 'design/today.webp')); copyFileSync(join(repo, 'docs/media/phone-leash-decide.webp'), join(dir, 'design/built.webp'));
  const area = { x: 0.5, y: 0.17, w: 0.45, h: 0.07 };
  writeFileSync(join(dir, 'design.json'), JSON.stringify({ contract: 1, kind: 'design', schema: 2, key: 'decide-leash', title: 'Approve Decide with the Leash chip?', filer: 'design-agent', about: 'Decide now shows how much agents may do without asking, and what the leash already answered.',
    group: 'sign-off', filed: at(-3600_000), status: 'in_review', preview: 'design/built.webp', accepts: 'built', journeys: [{ id: 'phone', title: 'On a phone', screens: [{ id: 'decide', title: 'Decide, with the asks that wait', frames: [
      { role: 'today', views: { phone_light: 'design/today.webp' }, area, caption: 'Today nothing says what agents may do alone' },
      { role: 'built', views: { phone_light: 'design/built.webp' }, area, caption: 'The Leash chip names the setting and opens it' }] }] }] }));
  so('post', board, '--kind', 'design', '--from', join(dir, 'design.json'));
  const report = JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v5/valid-full.json'), 'utf8'));
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ ...report, filed: at(-3600_000), ticket: 'T-12' })); so('post', board, '--kind', 'report', '--from', join(dir, 'report.json'));
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0', '--evidence-root', dir], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127.0.0.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', () => no(Error('server exited'))); });
  // The default is taken at its silent_by, and the agents pick up what the leash answered.
  assert.match(so('wait', board, '--filer', 'digest-agent', '--timeout', '20'), /weekly-digest,yes,\S+,default/);

  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium opened its DevTools port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
    if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push(x.params.args.map((a) => a.value ?? a.description).join(' '));
    if (x.method === 'Network.responseReceived' && x.params.response.status >= 400) failed.push({ url: x.params.response.url, status: x.params.response.status }); };
  const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  await cdp('Runtime.enable'); await cdp('Network.enable'); await cdp('Page.enable');
  const until = async (expression, why) => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await wait(200); } assert.fail(why); };
  const CHECK = `(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    const w = document.documentElement.clientWidth;
    return { width: w, overflow: document.documentElement.scrollWidth > w, overflowing: [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > w + 1).slice(0, 8).map((e) => e.tagName.toLowerCase() + '.' + (e.classList[0] ?? '')),
      letterTiles: [...document.querySelectorAll('.ui-icon, .dz-shot, .t-up .meta')].filter((e) => e.querySelector('.mono') || (!e.querySelector('img,svg') && /^[A-Z]{2}$/.test(e.textContent.trim()))).map((e) => e.textContent),
      token: /token=|[?&]t=[\\w-]{16,}|Bearer /i.test(document.body.innerText + location.href), text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 600) }; })()`;
  const shoot = async (shot, theme, width, setup) => {
    const phone = width < 1024;
    await cdp('Emulation.setDeviceMetricsOverride', phone ? { width, height: 844, deviceScaleFactor: 2, mobile: true } : { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await evaluate(`localStorage.setItem('so-theme', '${theme}')`);
    await cdp('Page.navigate', { url: base + setup.hash }); await wait(300); await cdp('Page.reload'); await wait(1500);
    if (setup.js) { await evaluate(setup.js); await wait(900); }
    const m = await evaluate(CHECK), name = `${shot}.${theme}.${width}w`;
    writeFileSync(join(out, name + '.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    writeFileSync(join(out, name + '.dom.json'), JSON.stringify({ ...m, console_errors: [...errors], failed_requests: [...failed] }, null, 2) + '\n');
    assert.ok(!m.overflow && !m.overflowing.length && !m.letterTiles.length && !m.token && !errors.length && !failed.length, `${name}: ${JSON.stringify({ m, errors, failed })}`);
    frames.push(name);
  };
  const openMore = `new Promise((ok) => setTimeout(async () => { document.querySelector('.t-more-line').click(); await new Promise((r) => setTimeout(r, 600)); document.querySelector('dialog.t-sheet[open] #install-app')?.scrollIntoView({ block: 'center' }); ok(); }, 800))`;
  const previews = `document.querySelector('.ev-pv').getAttribute('aria-pressed') === 'true' || document.querySelector('.ev-pv').click()`;
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: base }); await until('navigator.serviceWorker.ready.then(() => !!navigator.serviceWorker.controller)', 'the service worker took over the page');
  const states = [['today', { hash: '#' }, true], ['decide', { hash: '#waiting' }, true], ['reader', { hash: '#reports/push-service' }, true], ['evidence', { hash: '#evidence', js: previews }, true], ['tickets', { hash: '#ticket/T-41' }, true],
    ['designs', { hash: '#designs' }, false], ['install', { hash: '#', js: openMore }, false]];
  for (const theme of ['light', 'dark']) for (const [shot, setup, desk] of states) {
    await shoot(shot, theme, 390, setup);
    if (desk) await shoot(shot, theme, 1280, setup);
  }
  const movie = join(out, 'answer-light.mp4');
  sh(process.execPath, [join(repo, '.agents/skills/done-done-verify-sign-off/decide-record.mjs'), base, 'light', movie, 'today', 'readme']);
  const answer = so('answers', board, '--key', 'ship-settings');
  writeFileSync(join(out, 'answer.txt'), answer);
  assert.match(answer, /ship-settings,friday/, 'the recorded answer was saved');
  sh('ffmpeg', ['-loglevel', 'error', '-y', '-ss', '2', '-i', movie, '-vf', 'fps=8,scale=390:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=bayer', '-loop', '0', join(out, 'answer-light.gif')]);
  assert.ok(readFileSync(join(out, 'answer-light.gif')).length < 1500000, 'README loop under 1.5 MB');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ commit: sh('git', ['rev-parse', 'HEAD'], { cwd: repo }).trim(), target: { version: so('--version').trim() },
    start: 'An isolated board for Umer: three projects with their own icons, an epic with tickets and tasks, asks (one taken by default, one picked by the agent), a design, a report and proof with done-done runs.',
    steps: ['Open each README screen at 390 (phone, 2x) and 1280 (desk), light and dark, in a headless Chromium: Today, Decide, a report in the reader, Evidence with Previews on, a ticket of the epic E-1 in Tickets, Designs and Today\'s More with Install app.',
      'Open the release ask from Today and answer it in light; read the saved Friday answer with the CLI and encode each real recording as a GIF under 1.5 MB.',
      'Check every frame: no sideways overflow, no letter tile in a list, no token in the text or address, no console error, no failed request.'],
    result: `${frames.length} frames saved and checked: ${frames.join(', ')}` }, null, 2) + '\n');
  console.log(`${out}: ${frames.length} frames`);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  if (server) { const exit = new Promise((ok) => server.once('exit', ok)); try { so('stop', board); } catch {} await exit; }
  await wait(300);
  rmSync(dir, { recursive: true, force: true }); rmSync(prof, { recursive: true, force: true });
}
