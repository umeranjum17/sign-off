// Evidence's inline previews on a throwaway board of eight proofs from three projects (real product screens from docs/media, project icons pinned with
// sign-off-axi project --icon), served with no evidence root as the fleet's board is. Captured in a headless Chromium of its own over the DevTools protocol,
// with exact device metrics and an iPhone's 34px home bar: the list at 390x844 in light and dark (each row's first capture and done-done's word), one row
// opened in place (a tap on the row), Previews turned on (a tap on the pill), and the list on a 1280x800 desk. Each frame is measured in the browser: no
// sideways overflow, the rows' height, how many pictures were asked for.
// Usage: node .agents/skills/done-done-verify-sign-off/evidence-previews-shots.mjs <output>
// Writes list.light.390w.png, list.dark.390w.png, open.light.390w.png, previews.light.390w.png, list.light.1280w.png, facts.json and steps.json.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), repo = resolve('.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-evpv-')), board = join(dir, 'board.json'), prof = mkdtempSync(join(tmpdir(), 'so-evpv-chrome-'));
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'done-done' };
const sh = (args) => { const r = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120000, env }); assert.equal(r.status, 0, args.join(' ') + '\n' + r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].find(existsSync);
assert.ok(chromium, 'a Chromium is installed');

// Eight proofs: [key, project, title, what done-done said, still captures, priority].
const SAID = { held: 'done-done checked the proof and it holds up: ', no: 'done-done could not confirm the proof: ', none: '' };
const media = (n) => `docs/media/${n}.webp`;
const PROOFS = [
  ['p1', 'crewhouse', "Chief's profile in the installed app shows the blue portrait card and Routines with Add a routine", 'held', ['phone-today', 'phone-today-dark'], null],
  ['p2', 'takeone', 'A reader on a phone-width screen in light mode sees the README opening with Vision, Who it is for and The problem', 'held', ['phone-report', 'phone-report-dark'], 'P1'],
  ['p3', 'firstmate-addons', 'Secondmate notes and merge-card posts refuse Lavish content and point to the sign-off board', 'none', [], null],
  ['p4', 'sign-off', 'On Decide, an ask opens with no answer picked: its answers are carried from the board, not guessed', 'held', ['phone-decide', 'phone-decide-dark', 'phone-plan'], null],
  ['p5', 'crewhouse', 'The Evidence list shows each proof with its first capture and done-done\'s word', 'no', ['phone-evidence'], null],
  ['p6', 'takeone', 'The Reports list shows how much of each report is read', 'held', ['phone-reports', 'phone-reports-dark'], null],
  ['p7', 'sign-off', 'A sign-in card shows its link and the time left on a phone', 'held', ['phone-signin'], 'P2'],
  ['p8', 'sign-off', 'Today lists what waits on you and the proofs filed today on a desk', 'held', ['desk-today'], null],
];
const COLOURS = { crewhouse: '#2f5de0', takeone: '#c2410c', 'firstmate-addons': '#0f766e', 'sign-off': '#111827' };
mkdirSync(join(dir, 'icons'));
for (const [name, fill] of Object.entries(COLOURS)) {
  writeFileSync(join(dir, 'icons', `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${fill}"/><path d="M20 34l9 9 16-20" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
  sh(['project', board, '--name', name, '--icon', `icons/${name}.svg`]);
}
const now = Date.now(), filed = new Map();
PROOFS.forEach(([key, project, title, said, shots, priority], i) => {
  const files = shots.map((s, n) => { const f = join(dir, `${key}-${n + 1}.webp`); copyFileSync(join(repo, media(s)), f); return `${key}-${n + 1}.webp`; });
  writeFileSync(join(dir, `${key}.json`), JSON.stringify({ contract: 1, kind: 'evidence', schema: 1, filer: 'done-done', key, title, about: `${SAID[said]}The screen as it is on a phone.`, ...(files.length && { media: files }),
    run: { run_id: `20261023T000000Z-${key.slice(1).padStart(8, '0')}`, commit: '0'.repeat(40), outcome: title, repro: 'repro: n/a: no bug', proof: `done-done-verify-${project}: sealed receipt`, evidence: 'receipt.json' },
    ...(priority && { priority }) }));
  sh(['post', board, '--kind', 'evidence', '--from', join(dir, `${key}.json`)]);
  filed.set(key, new Date(now - i * 4 * 60000).toISOString().replace(/\.\d+Z$/, 'Z'));
});
const doc = JSON.parse(readFileSync(board, 'utf8'));
for (const d of doc.items) if (filed.has(d.key)) d.filed = filed.get(d.key);
doc.answers_only = true;
writeFileSync(board, JSON.stringify(doc, null, 2));

const MEASURE = `(async () => {
  await document.fonts.ready;
  const box = (e) => e.getBoundingClientRect(), cards = [...document.querySelectorAll('main .ev-card')];
  const pics = performance.getEntriesByType('resource').filter((r) => r.name.includes('/api/media')).length;
  const open = document.querySelector('main .ev-open');
  return { viewport: innerWidth + 'x' + innerHeight, rows: cards.length, rowHeights: cards.slice(0, 4).map((e) => Math.round(box(e).height)), tiles: document.querySelectorAll('main .ev-th img[src]').length,
    projectIcons: document.querySelectorAll('main .ev-card .ui-icon img').length, rich: document.querySelectorAll('main .ev-card.rich').length, previewsOn: document.querySelector('.ev-pv')?.getAttribute('aria-pressed'),
    open: open ? { captures: open.querySelectorAll('.ev-strip a').length, dots: open.querySelectorAll('.ev-dots-n i').length, openProof: !!open.querySelector('.ev-go') } : null, pictures: pics, overflow: document.documentElement.scrollWidth > innerWidth };
})()`;

const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let ws, log = '';
server.stdout.on('data', (b) => (log += b)); server.stderr.on('data', (b) => (log += b));
const errors = [], facts = {};
try {
  let url; for (let i = 0; i < 100 && !url; i++) { await wait(100); url = /http:\/\/127\.0\.0\.1:\d+\//.exec(log)?.[0]; }
  assert.ok(url, `the board served: ${log}`);
  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium answered');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception'); };
  const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  const shot = async (name) => writeFileSync(join(out, name), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const go = async (address, ms = 1500) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: address }); await wait(ms); };
  const js = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, `${expression.slice(0, 80)}: ${r.exceptionDetails?.exception?.description}`); await wait(500); return r.result.value; };
  const phone = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, desk = { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false };
  const setup = async (m, theme) => {
    await cdp('Emulation.setDeviceMetricsOverride', m);
    await cdp('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: m.mobile ? 34 : 0 } });
    await cdp('Emulation.setTouchEmulationEnabled', m.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await go(`${url}#evidence`); await js('localStorage.clear()'); await go(`${url}#evidence`);
  };
  const record = async (name, m) => { await shot(name); const f = await js(MEASURE); facts[name] = f; assert.equal(f.overflow, false, `${name}: no sideways overflow`); assert.deepEqual(errors, [], `${name}: no console error`); return f; };
  for (const theme of ['light', 'dark']) {
    await setup(phone, theme);
    const f = await record(`list.${theme}.390w.png`);
    assert.equal(f.rows, 6); assert.ok(f.tiles >= 4 && f.tiles <= 6, `tiles: ${f.tiles}`); assert.equal(f.projectIcons, 6); assert.ok(f.rowHeights.every((h) => h === 68), `rows ${f.rowHeights}`);
    if (theme === 'light') {
      // A tap on the second row opens it in place: its captures in a strip, a dot each, and Open proof.
      await js(`document.querySelector('main .ev-list > li:nth-child(2) .ev-card').click()`);
      await js(`(() => { const o = document.querySelector('main .ev-open'); scrollTo(0, Math.max(0, o.closest('li').getBoundingClientRect().top + scrollY - 120)); })()`);
      const o = await record('open.light.390w.png'); assert.deepEqual(o.open, { captures: 2, dots: 2, openProof: true });
      // Previews: a tap on the pill makes every row large; the pick is kept in this browser.
      await js(`document.querySelector('main .ev-open').closest('li').querySelector('.ev-card').click()`);
      await js(`scrollTo(0, 0)`);
      await js(`document.querySelector('.ev-pv').click()`);
      await js(`scrollTo(0, document.querySelector('.ev-sec').getBoundingClientRect().top + scrollY - 16)`);
      const p = await record('previews.light.390w.png'); assert.equal(p.previewsOn, 'true'); assert.equal(p.rich, 6);
      assert.equal(await js(`localStorage.getItem('so-ev-view')`), 'rich');
    }
  }
  await setup(desk, 'light');
  const d = await record('list.light.1280w.png'); assert.equal(d.rows, 6); assert.equal(d.tiles >= 4, true);
  writeFileSync(join(out, 'facts.json'), JSON.stringify(facts, null, 2) + '\n');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A new board of eight proofs from four projects (real product screens, project icons pinned with sign-off-axi project --icon) with done-done verdicts, served by sign-off-axi serve with no evidence root',
    steps: ['Open Evidence at 390x844 (2x), with an iPhone home bar, in light and in dark', 'Tap the second proof: it opens in its row with its two captures in a strip and Open proof',
      'Tap it again to close, tap Previews in the section head', 'Open Evidence at 1280x800 in light'],
    result: 'Light, on a phone 390 px wide: each Evidence row shows its project icon, its title, done-done\'s word with project and time, and its first capture as a small picture at its end (dark the same); one row opened in place shows its title in full, two captures in a strip with a dot each and Open proof; with Previews on every row shows its first capture large beside its title; on a 1280 px desk the same rows with their small pictures sit beside the open proof.' }, null, 2) + '\n');
  console.log(JSON.stringify(facts));
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { sh(['stop', board]); } catch {}
  try { server.kill(); } catch {}
  await wait(300);
  rmSync(prof, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
}
