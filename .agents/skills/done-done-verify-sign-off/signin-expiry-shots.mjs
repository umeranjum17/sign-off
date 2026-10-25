// A sign-in card's expiry, driven as the person meets it: the poster's end time in the person's own clock, the time left counting down while the link has
// under an hour, the plain Expired card once it passes (Open off, what it unlocks and where still readable beside the copy button), the mark that it was
// opened ("Opened — waiting for approval", never done), and the one action that asks the poster for a fresh link, which the poster reads as a comment.
// A throwaway board in a temp folder with its own HOME, three sign-in cards posted with `post --type signin --expires` (90m, 20m, 3s), served by `serve --port 0`,
// then each state opened in its own headless Chromium at exact device metrics (390x844 at 2x unless another width is given), in the theme asked.
// Every capture is measured in the browser (signin-expiry.<state>.<theme>.<width>w.json): the sheet's right edge and what is past it, the fact rows, the bar's
// buttons and the disabled Open, the list rows, and the countdown read twice so a frozen clock fails. The reissue request is checked in the board's own
// messages file, which is what `poll` and `wait` hand to the poster.
// It exits 1 on any failed measure. Usage: node .agents/skills/done-done-verify-sign-off/signin-expiry-shots.mjs <output> [light|dark] [390|1280]
// SIGN_OFF_CLI points the board at another build's CLI (a base checkout) for the before captures.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024, height = phone ? 844 : 860;
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), cliPath = resolve(process.env.SIGN_OFF_CLI ?? join(repo, 'dist/cli.js'));
mkdirSync(out, { recursive: true });
// The board and its CLI live in a temp folder with their own HOME and XDG_*, so no board on this host is read or written.
const dir = mkdtempSync(join(tmpdir(), 'so-signin-expiry-')), board = join(dir, 'board.json'), made = [dir];
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'),
  XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache') };
delete env.SIGN_OFF_FILER;
const run = (...args) => spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', timeout: 120000, env });
const cli = (...args) => { const r = run(...args); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
// Three sign-ins: one good for the afternoon, one with under an hour left, and one whose link passes while the capture runs.
writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
const signin = (key, service, link, expires) => cli('post', board, '--type', 'signin', '--key', key, '--service', service, '--link', link, '--unlocks', `Publish the ${service} release`, '--waits', 'Release agent', '--expires', expires);
signin('npm-login', 'npm', 'https://login.byokit-publisher.example.com/oauth/authorize?client_id=sign-off-axi&code_challenge=Zx9Qm2Lp7Rt4Wv1Ny6Kc3Hb8Jd5Fg0Sa2De4Ui7Ol9Pq', '90m');
signin('gh-login', 'GitHub', 'https://github.com/login/device?code=one-time-1', '20m');
signin('aws-login', 'AWS', 'https://signin.aws-prod-amazon.example.com/console?code=one-time-3', '3s');

const server = spawn(process.execPath, [cliPath, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let base = '';
server.stdout.on('data', (b) => { base ||= /url: "?(http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(b))?.[1] ?? ''; });
for (let i = 0; i < 100 && !base; i++) await wait(100);
assert.ok(base, 'the board did not start');

// The browser: its own headless Chromium over the DevTools protocol, its profile in a temp folder.
const prof = mkdtempSync(join(tmpdir(), 'so-signin-expiry-cdp-'));
made.push(prof);
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => {
  try { chrome.kill(); server.kill(); } catch {}
  for (const folder of made) try { rmSync(folder, { recursive: true, force: true }); } catch {}
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1));
let port;
for (let i = 0; i < 300 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
assert.ok(port, 'Chromium did not open its DevTools port');
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
let id = 0; const pending = new Map(), errors = [];
ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
  if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
  if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push(x.params.args.map((a) => a.value ?? a.description).join(' ')); };
const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const waitFor = async (expression) => { for (let i = 0; i < 200; i++) { if (await evaluate(expression).catch(() => false)) return; await wait(100); } assert.fail(`the page did not reach: ${expression}`); };
const shot = async (state) => writeFileSync(join(out, `signin-expiry.${state}.${theme}.${width}w.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: base.replace(/\/$/, '') });
await cdp('Emulation.setDeviceMetricsOverride', phone ? { width, height, deviceScaleFactor: 2, mobile: true } : { width, height, deviceScaleFactor: 2, mobile: false });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 1 });
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
// The link opens in its own tab on a tap; the capture keeps the page and makes the mark, as the person's tap does.
await cdp('Page.navigate', { url: 'about:blank' }); await wait(100);
await cdp('Page.navigate', { url: `${base}#waiting` });
await waitFor('!!document.getElementById("item-npm-login")');
await wait(500);
await evaluate('document.addEventListener("click", (e) => e.target.closest?.(".open-link") && e.preventDefault(), true)');

/** One state as the person sees it: the rows, and the sheet with its facts, bar and hint. */
const MEASURE = `(() => {
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }; };
  const rows = [...document.querySelectorAll('.decide-list .dl-row')].map((r) => ({ key: r.getAttribute('data-key'), text: r.textContent.replace(/\\s+/g, ' ').trim() }));
  const sheet = document.querySelector('.ask-sheet') ?? document.querySelector('.split-detail .decide');
  const s = sheet && box(sheet);
  const facts = sheet ? [...sheet.querySelectorAll('.fact')].map((f) => ({ label: f.querySelector('.fl')?.textContent ?? '', value: f.querySelector('b')?.textContent ?? '',
    copy: f.querySelector('.cp') ? { ...box(f.querySelector('.cp')), name: f.querySelector('.cp').getAttribute('aria-label') } : null })) : [];
  const open = sheet?.querySelector('.decide-bar .open-link');
  return { url: location.href, viewport: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth, rows, sheet: s, facts,
    pastSheetRight: sheet ? [...sheet.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > s.right + 1)
      .map((e) => e.tagName.toLowerCase() + '.' + (e.className?.baseVal ?? e.className ?? '') + ' at ' + Math.round(e.getBoundingClientRect().right)) : [],
    bar: sheet ? [...sheet.querySelectorAll('.decide-bar > *')].map((e) => e.tagName + ':' + e.textContent.trim()) : [],
    hint: sheet?.querySelector('.decide-bar .hint')?.textContent ?? '',
    open: open ? { tag: open.tagName, disabled: !!open.disabled, href: open.getAttribute('href') } : null,
    title: sheet?.querySelector('#ask-title')?.textContent ?? '' }; })()`;
const fail = [], wrote = {};
const cell = async (state, sheetKey) => {
  const m = await evaluate(MEASURE);
  await shot(state);
  writeFileSync(join(out, `signin-expiry.${state}.${theme}.${width}w.json`), JSON.stringify(m, null, 2) + '\n');
  wrote[state] = m;
  if (m.pageScrollWidth > m.viewport) fail.push(`${state}: the page scrolls sideways: ${m.pageScrollWidth} > ${m.viewport}`);
  if (m.pastSheetRight.length) fail.push(`${state}: past the sheet's right edge: ${m.pastSheetRight.join(', ')}`);
  if (sheetKey && m.title !== `Sign in to ${sheetKey.service}`) fail.push(`${state}: the sheet shows ${m.title}`);
  console.log(`${state}.${theme}.${width}w`, m.rows.map((r) => `${r.key}: ${r.text}`).join(' | '));
  return m;
};
const openSheet = async (key) => { await evaluate(`location.hash = "#waiting"`); await waitFor(`!!document.getElementById("item-${key}")`); await evaluate(`document.getElementById("item-${key}").click()`); await waitFor(`location.hash === "#decide/${key}" && !!document.querySelector(".ask-sheet .signin-ask")`); await wait(500); };
const fact = (m, label) => m.facts.find((f) => f.label === label)?.value ?? '';

// The list as it waits: the end time on each row, in the person's own clock.
const listed = await cell('list');
for (const key of ['npm-login', 'gh-login']) if (!listed.rows.some((r) => r.key === key)) fail.push(`list: ${key} is missing from what waits`);

// Good for the afternoon: the clock it ends at, and no countdown until the last hour.
await openSheet('npm-login');
const valid = await cell('valid', { service: 'npm' });
if (!/^\d\d:\d\d$/.test(fact(valid, 'Expires'))) fail.push(`valid: Expires reads ${JSON.stringify(fact(valid, 'Expires'))}, not the end time alone`);
if (!/until \d\d:\d\d$/.test(valid.rows.find((r) => r.key === 'npm-login')?.text ?? '')) fail.push('valid: the row has no plain end time');

// Under an hour left: the same end time and the time left, counting down as the page sits there.
await openSheet('gh-login');
const near = await cell('near', { service: 'GitHub' });
if (!/^\d\d:\d\d · \d{1,2}:\d\d left$/.test(fact(near, 'Expires'))) fail.push(`near: Expires reads ${JSON.stringify(fact(near, 'Expires'))}`);
if (!/until \d\d:\d\d · \d{1,2}:\d\d left$/.test(near.rows.find((r) => r.key === 'gh-login')?.text ?? '')) fail.push('near: the row does not say until when, and the time left');
let ticked = false;
for (let i = 0; i < 30 && !ticked; i++) { await wait(400); ticked = fact(await evaluate(MEASURE), 'Expires') !== fact(near, 'Expires'); }
if (!ticked) fail.push('near: the countdown never moved');

// Opened: it waits for approval, on the sheet and on its row, and it is not done.
await evaluate('document.querySelector(".ask-sheet .open-link").click()');
await waitFor('/Opened/.test(document.querySelector(".ask-sheet .decide-bar .hint")?.textContent ?? "")');
const opened = await cell('opened', { service: 'GitHub' });
if (!/^Opened — waiting for approval\./.test(opened.hint)) fail.push(`opened: the hint reads ${JSON.stringify(opened.hint)}`);
if (!opened.rows.some((r) => r.key === 'gh-login' && /Opened — waiting for approval/.test(r.text))) fail.push('opened: the row does not say it was opened');

// One action asks the poster for a fresh link, and the poster reads it as a comment with poll or wait.
await evaluate('[...document.querySelectorAll(".ask-sheet .decide-bar button")].find((b) => b.textContent === "Ask for a new link").click()');
await waitFor('[...document.querySelectorAll(".ask-sheet .decide-bar button")].some((b) => b.textContent === "Asked for a new link")');
const asked = await cell('asked', { service: 'GitHub' });
const messages = () => { const f = join(dir, 'board.messages.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const reissue = messages().find((m) => m.kind === 'comment' && m.key === 'gh-login');
if (!reissue || !/^Reissue the GitHub sign-in link: the one on the card expires at \d\d:\d\d\.$/.test(reissue.text)) fail.push(`asked: the poster was not asked: ${JSON.stringify(reissue)}`);

// Past its time: the card stays, plainly expired, Open off, what it unlocks and where still readable beside the copy button.
await evaluate('location.hash = "#waiting"');
for (let i = 0; i < 100 && !/Expired/.test(await evaluate('document.getElementById("item-aws-login")?.textContent ?? ""')); i++) await wait(200);
await openSheet('aws-login');
const gone = await cell('expired', { service: 'AWS' });
if (!gone.open || gone.open.tag !== 'BUTTON' || !gone.open.disabled) fail.push(`expired: Open is ${JSON.stringify(gone.open)}`);
if (fact(gone, 'Expires') !== 'Expired') fail.push(`expired: Expires reads ${JSON.stringify(fact(gone, 'Expires'))}`);
if (!fact(gone, 'Unlocks') || !fact(gone, 'Where')) fail.push('expired: what it unlocks or where it signs in went missing');
assert.equal(await evaluate(`(() => { const b = document.querySelector('.ask-sheet .facts .cp'); return !!b && Math.round(b.getBoundingClientRect().width); })()`), 44, 'expired: the copy button is gone or is not a 44px target');
if (gone.hint && !/Link expired/.test(gone.hint)) fail.push(`expired: the hint reads ${JSON.stringify(gone.hint)}`);
// A second ask works while the first is on its way, and a link that still works can be replaced before it dies.
await openSheet('npm-login');
await evaluate('[...document.querySelectorAll(".ask-sheet .decide-bar button")].find((b) => /^Ask for a new link$/.test(b.textContent)).click()');
await waitFor('[...document.querySelectorAll(".ask-sheet .decide-bar button")].some((b) => b.textContent === "Asked for a new link")');
if (!messages().some((m) => m.kind === 'comment' && m.key === 'npm-login' && /^Reissue the npm sign-in link: the one on the card expires at \d\d:\d\d\.$/.test(m.text))) fail.push('valid: a link that still works cannot be reissued');
// The poster closes it, and only then does the card leave: opened never means done.
cli('signin', 'done', board, '--key', 'gh-login');
await evaluate('location.hash = "#waiting"');
await waitFor('!document.getElementById("item-gh-login")');
if (errors.length) fail.push('console: ' + errors.join('; '));
writeFileSync(join(out, `signin-expiry.summary.${theme}.${width}w.json`), JSON.stringify({ theme, width, states: Object.keys(wrote), reissue, fail }, null, 2) + '\n');
console.log(`${theme} ${width}w`, fail.length ? `FAIL ${fail.join('; ')}` : 'ok');

ws.close(); chrome.kill(); server.kill(); await wait(300);
run('stop', board);
if (fail.length) { console.error(JSON.stringify({ fail }, null, 2)); process.exit(1); }
