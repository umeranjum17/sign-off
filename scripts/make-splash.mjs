// Draws the iPad launch images (web/splash-<width>x<height>-<light|dark>.png, the size in points, both ways up) that Safari shows while an added board opens:
// the page's own ground with the app icon in the middle. src/cli.ts finds the files by their names and links each with its device's media query.
// Each is then cut to 96 colours with ImageMagick, which takes a launch image from about 28 KB to 12 KB.
// Usage: node scripts/make-splash.mjs   (needs chromium and magick on the PATH)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const web = new URL('../web/', import.meta.url).pathname, icon = readFileSync(join(web, 'icon-512.png')).toString('base64');
const ground = { light: '#E8E4E0', dark: '#131210' }, pads = [[768, 1024], [810, 1080], [820, 1180], [834, 1194], [1024, 1366]];
const dir = mkdtempSync(join(tmpdir(), 'so-splash-')), prof = join(dir, 'p');
const chrome = spawn('chromium', ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMPDIR: dir } });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
try {
  while (!existsSync(join(prof, 'DevToolsActivePort'))) await sleep(100);
  await sleep(300);
  const target = await (await fetch(`http://127.0.0.1:${readFileSync(join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0]}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok) => (ws.onopen = ok));
  const pending = new Map();
  let id = 0;
  ws.onmessage = (m) => { const x = JSON.parse(m.data); pending.get(x.id)?.(x.result); };
  const cdp = (method, params = {}) => new Promise((ok) => { pending.set(++id, ok); ws.send(JSON.stringify({ id, method, params })); });
  for (const [w, h] of pads.flatMap(([w, h]) => [[w, h], [h, w]])) for (const theme of ['light', 'dark']) {
    const px = [w * 2, h * 2], size = Math.round(Math.min(...px) * 0.2);
    await cdp('Emulation.setDeviceMetricsOverride', { width: px[0], height: px[1], deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url: `data:text/html,${encodeURIComponent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:${ground[theme]}"><img src="data:image/png;base64,${icon}" width="${size}" height="${size}">`)}` });
    await sleep(400);
    const file = join(web, `splash-${w}x${h}-${theme}.png`);
    writeFileSync(file, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    spawnSync('magick', [file, '-colors', '96', '-define', 'png:compression-level=9', `PNG8:${file}`], { stdio: 'inherit' });
  }
} finally { chrome.kill(); rmSync(dir, { recursive: true, force: true }); }
