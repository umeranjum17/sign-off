// Evidence concern cards on a throwaway board of three cards: Fixed with a before and after, In progress with a before and after, and an In progress card whose
// frame is pending (fixture screens from docs/media; no real concern). Captured in a headless Chromium of its own over the DevTools protocol, with exact device
// metrics and an iPhone's 34px home bar: the list at 390x844 in light and dark, one card opened at 390 in light (Status line and a caption under each frame),
// and the list with the first card open beside it on a 1280x800 desk. Each frame is measured in the browser: no sideways overflow, the rows' status words.
// Usage: node .agents/skills/done-done-verify-sign-off/concern-cards-shots.mjs <output>
// Writes list.light.390w.png, list.dark.390w.png, card.light.390w.png, list.light.1280w.png and steps.json.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), repo = resolve('.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-concern-')), board = join(dir, 'board.json'), prof = mkdtempSync(join(tmpdir(), 'so-concern-chrome-'));
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'done-done' };
const sh = (args) => { const r = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120000, env }); assert.equal(r.status, 0, args.join(' ') + '\n' + r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].find(existsSync);
assert.ok(chromium, 'a Chromium is installed');

const media = (n) => `docs/media/${n}.webp`;
// [key, title, status, about, [[file, caption]...], minutes ago]
const CARDS = [
  ['concern-pending', 'The leash is not real yet: a choice that says it acts for you must really do it', 'In progress', 'Frame pending: no frame has been captured yet. Nothing of this is built.', [], 8],
  ['concern-progress', 'Too many buttons on a report: now one action bar and one Activity panel', 'In progress', 'Before: every part carried its own buttons. After: one bar acts on the part in view.', [['phone-reports', 'Before, phone'], ['phone-reports-dark', 'After, phone']], 4],
  ['concern-fixed', 'Evidence rows were plain: now each shows its first capture', 'Fixed', 'Before: a row was only a title. After: a row ends with its first capture.', [['phone-evidence', 'Before, phone'], ['phone-evidence-dark', 'After, phone']], 0],
];
const now = Date.now(), filed = new Map();
for (const [key, title, status, about, shots, ago] of CARDS) {
  const files = shots.map(([s], n) => { const f = join(dir, `${key}-${n + 1}.webp`); copyFileSync(join(repo, media(s)), f); return `${key}-${n + 1}.webp`; });
  writeFileSync(join(dir, `${key}.json`), JSON.stringify({ contract: 1, kind: 'evidence', schema: 1, filer: 'done-done', key, title, about, status, link: 'https://github.com/umeranjum17/sign-off/pull/269',
    ...(files.length && { media: files, captions: shots.map(([, c]) => c) }) }));
  sh(['post', board, '--kind', 'evidence', '--from', join(dir, `${key}.json`)]);
  filed.set(key, new Date(now - ago * 60000).toISOString().replace(/\.\d+Z$/, 'Z'));
}
const doc = JSON.parse(readFileSync(board, 'utf8'));
for (const d of doc.items) if (filed.has(d.key)) d.filed = filed.get(d.key);
doc.answers_only = true;
writeFileSync(board, JSON.stringify(doc, null, 2));

const MEASURE = `(async () => {
  await document.fonts.ready;
  const rows = [...document.querySelectorAll('main .ev-card')], text = (e) => e?.textContent?.trim() ?? '';
  return { viewport: innerWidth + 'x' + innerHeight, rows: rows.length, rowStatus: rows.map((r) => (text(r).match(/(Fixed|In progress|Waiting on you)/) ?? [])[1] ?? ''),
    statusLine: [...document.querySelectorAll('.ev-props .ui-pr')].map(text).find((t) => t.startsWith('Status')) ?? '', captions: [...document.querySelectorAll('.ev-hero figcaption')].map(text),
    pending: text(document.querySelector('.ev-hero.none')), overflow: document.documentElement.scrollWidth > innerWidth };
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
  const record = async (name) => { await shot(name); const f = await js(MEASURE); facts[name] = f; assert.equal(f.overflow, false, `${name}: no sideways overflow`); assert.deepEqual(errors, [], `${name}: no console error`); return f; };
  for (const theme of ['light', 'dark']) {
    await setup(phone, theme);
    const f = await record(`list.${theme}.390w.png`);
    assert.equal(f.rows, 3); assert.deepEqual(f.rowStatus, ['Fixed', 'In progress', 'In progress']);
    if (theme === 'light') {
      await go(`${url}#evidence/concern-fixed`);
      await js(`document.querySelector('.ev-props').scrollIntoView({ block: 'center' })`);
      const c = await record('card.light.390w.png');
      assert.match(c.statusLine, /Fixed/); assert.deepEqual(c.captions, ['Before, phone', 'After, phone']);
    }
  }
  await setup(desk, 'light');
  const d = await record('list.light.1280w.png'); assert.equal(d.rows, 3); assert.match(d.statusLine, /Fixed/); assert.deepEqual(d.captions, ['Before, phone', 'After, phone']);
  await go(`${url}#evidence/concern-pending`);
  const p = await js(MEASURE); facts.pending = p; assert.match(p.pending, /Frame pending/);
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A new board of three concern cards (fixture screens, no real concern): Fixed with before and after, In progress with before and after, and In progress with its frame pending, served by sign-off-axi serve',
    steps: ['Open Evidence at 390x844 (2x), with an iPhone home bar, in light and in dark', 'Open the Fixed card at 390 in light', 'Open Evidence at 1280x800 in light'],
    result: 'Light and dark, on a phone 390 px wide: each Evidence row leads its second line with its status (Fixed, In progress); the Fixed card opened shows a Status line, its pull request, and Before, phone and After, phone under its two frames; on a desk 1280 px wide the same list sits beside the open card; a card with no frame reads Frame pending.' }, null, 2) + '\n');
  console.log(JSON.stringify(facts));
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { sh(['stop', board]); } catch {}
  try { server.kill(); } catch {}
  await wait(300);
  rmSync(prof, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
}
