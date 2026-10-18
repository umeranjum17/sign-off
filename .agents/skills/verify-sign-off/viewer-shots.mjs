// Captures the full-screen design viewer over a 17-screen design at 390 and 1280, light and dark: screen 1 (a picture) and
// screen 4 (an .html view), each with its "n of 17" position. Drives its own headless Chromium over DevTools, like test/design.test.mjs.
// Usage (repo root, after `npm run build`): node .agents/skills/verify-sign-off/viewer-shots.mjs <evidence folder>
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const repo = resolve('.'), out = resolve(process.argv[2] ?? assert.fail('usage: viewer-shots.mjs <evidence folder>'));
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-viewer-')), board = join(dir, 'board.json'), design = join(dir, 'design');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_STATE_HOME: join(dir, 'state'), XDG_CACHE_HOME: join(dir, 'cache'), TMPDIR: dir };
const procs = [];
const cleanup = () => { for (const p of procs) p.kill(); rmSync(dir, { recursive: true, force: true }); };
process.on('exit', cleanup);

// The design: 17 screens, screens 3 to 6 with an .html view in every slot.
mkdirSync(design);
for (const f of readdirSync(join(repo, 'fixtures/contract/design.v1/design'))) copyFileSync(join(repo, 'fixtures/contract/design.v1/design', f), join(design, f));
copyFileSync(join(repo, 'docs/media/phone-light.webp'), join(design, 'light.webp'));
copyFileSync(join(repo, 'docs/media/phone-dark.webp'), join(design, 'dark.webp'));
const titles = ['Welcome', 'Create account', 'Verify email', 'Add a name', 'Pick a plan', 'Payment', 'Invite the team', 'Set a password', 'Two-step check', 'Notifications', 'Import contacts', 'Choose a theme', 'Privacy', 'Connect a device', 'First message', 'Empty inbox', 'Done'];
const screens = titles.map((title, i) => {
  const html = i >= 2 && i <= 5, light = html ? 'design/welcome.html' : 'design/light.webp', dark = html ? 'design/welcome.html' : 'design/dark.webp';
  return { id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, views: { phone_light: light, phone_dark: dark, computer_light: html ? light : 'design/light.webp', computer_dark: html ? dark : 'design/dark.webp' } };
});
const message = { contract: 1, kind: 'design', schema: 1, key: 'viewer-journeys', title: 'Onboarding journey', filer: 'verify', about: 'Step through every onboarding screen.', group: 'Chat app',
  filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), status: 'in_review', preview: 'design/light.webp', journeys: [{ id: 'onboarding', title: 'Onboarding', screens }] };
writeFileSync(join(dir, 'design-message.json'), JSON.stringify(message));
const cli = (...args) => spawnSync(process.execPath, ['dist/cli.js', ...args], { env, encoding: 'utf8' });
assert.equal(cli('post', board, '--kind', 'design', '--from', join(dir, 'design-message.json')).status, 0);

// The board server, on its own port; its ready line gives the URL.
const serve = spawn(process.execPath, ['dist/cli.js', 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
procs.push(serve);
const base = await new Promise((ok) => serve.stdout.on('data', (b) => { const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(b); if (m) ok(m[0]); }));
const url = `${base}#designs/viewer-journeys`;

// Headless Chromium with its own profile, driven over its DevTools socket.
const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].flatMap((b) => env.PATH.split(':').map((d) => join(d, b))).find(existsSync);
assert.ok(chrome, 'no Chromium on the PATH');
const profile = join(dir, 'profile');
const browser = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { env: { ...env, TMPDIR: dir }, stdio: 'ignore' });
procs.push(browser);
const active = join(profile, 'DevToolsActivePort');
for (let i = 0; i < 600 && !(existsSync(active) && readFileSync(active, 'utf8').includes('\n')); i++) await new Promise((r) => setTimeout(r, 100));
const port = readFileSync(active, 'utf8').split('\n')[0];
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok) => { ws.onopen = ok; });
const replies = new Map(); let seq = 0;
ws.onmessage = (m) => { const msg = JSON.parse(m.data); replies.get(msg.id)?.(msg.result); };
const call = (method, params = {}) => new Promise((ok, no) => { const id = ++seq; replies.set(id, (r) => ok(r)); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
const until = async (check) => { for (let i = 0; i < 600; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 100)); } assert.fail('the page did not reach the expected state'); };
const settle = () => evaluate('new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))');
const shot = async (file) => { await settle(); const { data } = await call('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, file), Buffer.from(data, 'base64')); };

await call('Page.enable'); await call('Runtime.enable');
for (const theme of ['light', 'dark']) for (const width of [390, 1280]) {
  const phone = width === 390;
  await call('Emulation.setDeviceMetricsOverride', { width, height: phone ? 844 : 800, deviceScaleFactor: phone ? 2 : 1, mobile: phone });
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  await call('Page.navigate', { url: 'about:blank' });
  await call('Page.navigate', { url });
  await until(() => evaluate('!!document.querySelector("[aria-haspopup=dialog]")'));
  await evaluate('document.querySelector("[aria-haspopup=dialog]").click()');
  await until(() => evaluate('!!document.querySelector(".design-viewer[open]")'));
  await shot(`viewer-screen-1.${theme}.${width}w.png`);
  const first = await evaluate('document.querySelector(".design-viewer header").textContent.trim()');
  for (let i = 0; i < 3; i++) await evaluate('document.querySelector("[aria-label=\\"Next screen\\"]").click()');
  await until(() => evaluate('document.querySelector(".design-viewer header").textContent.includes("4 of 17")'));
  await shot(`viewer-screen-4.${theme}.${width}w.png`);
  const overflow = await evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth');
  console.log(`${theme} ${width}w: "${first}" then 4 of 17; page scrolls sideways: ${overflow}`);
  await evaluate('document.querySelector("[aria-label=\\"Close viewer\\"]").click()');
}
ws.close(); browser.kill(); serve.kill();
