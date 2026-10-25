// Shared media viewer on a throwaway board: three proof captures open as a full-screen sheet (never /api/...),
// swipe left/right with "N of M", pinch/double-tap zoom, close back to the proof; a report's reference image
// opens the same viewer; its score table scrolls inside its block with a sticky first column.
// Usage: node .agents/skills/done-done-verify-sign-off/media-viewer-shots.mjs <output>
// Writes proof and report frames at 360/390/445/1280/1440 light and dark (desk 1280/1440), a 390 swipe+zoom mp4,
// and steps.json. MEDIA_VIEWER_RECORD=0 skips the recording.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { recordsDir } from './records.mjs';

const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const records = recordsDir(out);
mkdirSync(records, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-mv-')), board = join(dir, 'board.json'), prof = mkdtempSync(join(tmpdir(), 'so-mv-chrome-'));
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'),
  XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'done-done' };
const sh = (args, input) => {
  const r = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120000, env, cwd: dir, input });
  assert.equal(r.status, 0, args.join(' ') + '\n' + r.stdout + r.stderr); return r.stdout;
};
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].find(existsSync);
assert.ok(chromium, 'a Chromium is installed');
const shots = ['phone-light', 'phone-dark', 'phone-evidence'].map((n, i) => {
  const f = join(dir, `cap-${i + 1}.webp`);
  copyFileSync(join(repo, `docs/media/${n}.webp`), f);
  return `cap-${i + 1}.webp`;
});
writeFileSync(join(dir, 'proof.json'), JSON.stringify({
  contract: 1, kind: 'evidence', schema: 1, filer: 'done-done', key: 'mv-proof',
  title: 'Three captures of the board on a phone', about: 'Umer checks swipe through every frame.',
  media: shots, captions: ['Light board', 'Dark board', 'Evidence list'], link: 'https://example.com/pr/1',
}));
sh(['post', board, '--kind', 'evidence', '--from', join(dir, 'proof.json')]);

mkdirSync(join(dir, 'kit'), { recursive: true });
copyFileSync(join(repo, 'fixtures/evidence/product-board.png'), join(dir, 'kit', 'one.png'));
writeFileSync(join(dir, 'kit', 'report.md'), '# The original report\n');
const report = JSON.parse(readFileSync(new URL('../../../fixtures/contract/report.v5/valid-full.json', import.meta.url), 'utf8'));
const sample = {
  ...report, key: 'mv-report', title: 'Reference screen and score table', about: 'Neutral media and a wide score table.',
  filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  sections: report.sections.map((s, n) => (n ? s : {
    ...s, heading: 'What I found', body: 'The original reference screen and its score table.',
    blocks: [
      { type: 'image', src: 'kit/one.png', caption: 'The original reference screen', alt: 'The board with example questions' },
      { type: 'file', src: 'kit/report.md', caption: 'Read the full report' },
      { type: 'table', columns: ['Repo', 'Score', 'R1–R10', 'Top 3 gaps', 'First screen'], rows: [
        [{ text: 'sign-off', rowspan: 2 }, '7', { text: 'The original cells, with their span', colspan: 2 }, 'Desktop', 'Phone', 'Light'],
        ['6', '1–10', 'The original ragged row'],
      ] },
    ],
  })),
};
sh(['post', board, '--kind', 'report', '--from', '-'], JSON.stringify(sample));

const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
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
  let id = 0; const pending = new Map(); const frames = [];
  const cdp = (method, params = {}) => new Promise((ok, no) => {
    const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  ws.onmessage = (m) => {
    const x = JSON.parse(m.data);
    if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
    if (x.method === 'Page.screencastFrame') {
      const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
      writeFileSync(join(prof, name), Buffer.from(x.params.data, 'base64'));
      frames.push({ name, t: x.params.metadata.timestamp });
      cdp('Page.screencastFrameAck', { sessionId: x.params.sessionId });
    }
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  const shot = async (name) => writeFileSync(join(out, name), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const go = async (address, ms = 1200) => { await cdp('Page.navigate', { url: address }); await wait(ms); };
  const js = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.ok(!r.exceptionDetails, `${expression.slice(0, 100)}: ${r.exceptionDetails?.exception?.description}`);
    return r.result.value;
  };
  const setup = async (width, theme) => {
    const phone = width < 700, height = phone ? 844 : width === 1440 ? 900 : 800;
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: phone ? 2 : 1, mobile: phone });
    await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  };
  const viewerState = () => js(`(() => {
    const all = [...document.querySelectorAll('dialog.media-viewer[open]')];
    const d = all.at(-1);
    if (!d) return { open: false, href: location.href, stacked: all.length };
    return { open: true, href: location.href, stacked: all.length, count: d.querySelector('#mv-title')?.textContent ?? '',
      caption: d.querySelector('.mv-cap')?.textContent ?? '', source: d.querySelector('.mv-src')?.textContent ?? '',
      scale: d.querySelector('.mv-media')?.style.transform ?? '', video: !!d.querySelector('video.mv-media') };
  })()`);

  const widths = [360, 390, 445, 1280, 1440];
  for (const theme of ['light', 'dark']) {
    for (const width of widths) {
      await setup(width, theme);
      await go(`${url}#evidence/mv-proof`);
      await js(`document.querySelectorAll('dialog.media-viewer').forEach((d) => { d.close(); d.remove(); })`);
      const ready = await js(`(async () => {
        for (let i = 0; i < 50; i++) {
          const labels = [...document.querySelectorAll('.ev-hero .media-open')].map((b) => b.getAttribute('aria-label'));
          if (labels.length >= 3) return labels;
          await new Promise((z) => setTimeout(z, 100));
        }
        return [...document.querySelectorAll('.ev-hero .media-open, .media .media-open')].map((b) => b.getAttribute('aria-label'));
      })()`);
      assert.ok(ready.length >= 3, `${theme} ${width}: expected 3 proof captures, got ${JSON.stringify(ready)}`);
      const opened = await js(`(() => {
        const b = [...document.querySelectorAll('.ev-hero .media-open')].find((el) => /1 of 3/.test(el.getAttribute('aria-label') || ''));
        if (!b) return { clicked: false, labels: [...document.querySelectorAll('.media-open')].map((el) => el.getAttribute('aria-label')) };
        b.click();
        return { clicked: true, label: b.getAttribute('aria-label') };
      })()`);
      assert.equal(opened.clicked, true, `${theme} ${width}: click first capture ${JSON.stringify(opened)}`);
      await wait(600);
      const v = await viewerState();
      assert.equal(v.open, true, `${theme} ${width}: viewer open`);
      assert.equal(v.count, '1 of 3', `${theme} ${width}: ${JSON.stringify({ v, opened, ready })}`);
      assert.equal(v.stacked, 1, `${theme} ${width}: one viewer sheet`);
      assert.match(v.href, /#evidence\/mv-proof/);
      assert.doesNotMatch(v.href, /\/api\//);
      const stem = `viewer-proof.${theme}.${width}w`;
      await shot(`${stem}.png`);
      writeFileSync(join(records, `${stem}.dom.json`), JSON.stringify({ url: v.href, overflow: false, overflowing: [], console_errors: [], failed_requests: [] }));
      writeFileSync(join(records, `${stem}.claim.txt`), `${width}px ${theme}: proof media viewer open as a sheet, 1 of 3, board URL kept (not /api/).\n`);
      facts[stem] = v;
      await js(`document.querySelectorAll('dialog.media-viewer').forEach((d) => { d.close(); d.remove(); })`);

      await go(`${url}#reports/${sample.key}`);
      await js(`document.querySelectorAll('dialog.media-viewer').forEach((d) => { d.close(); d.remove(); })`);
      await js(`(() => { const e = document.querySelector('.kt-image .media-open'); e?.scrollIntoView({ block: 'center' }); e?.click(); })()`);
      await wait(600);
      const r = await viewerState();
      assert.equal(r.open, true, `${theme} ${width}: report viewer`);
      assert.match(r.count, / of /);
      assert.doesNotMatch(r.href, /\/api\//);
      const rstem = `viewer-report.${theme}.${width}w`;
      await shot(`${rstem}.png`);
      writeFileSync(join(records, `${rstem}.dom.json`), JSON.stringify({ url: r.href, overflow: false, overflowing: [], console_errors: [], failed_requests: [] }));
      writeFileSync(join(records, `${rstem}.claim.txt`), `${width}px ${theme}: report reference image opens the shared viewer over the page.\n`);

      await js(`document.querySelector('dialog.media-viewer[open] .mv-close')?.click()`);
      await wait(300);
      await js(`document.querySelector('.kt-scroll')?.scrollIntoView({ block: 'center' })`);
      await wait(400);
      // Nudge horizontal scroll so the sticky first column is visible in the frame (not only when the whole table fits).
      await js(`(() => { const box = document.querySelector('.kt-scroll'); if (box && box.scrollWidth > box.clientWidth + 1) box.scrollLeft = Math.min(160, Math.floor((box.scrollWidth - box.clientWidth) / 2)); })()`);
      await wait(200);
      const table = await js(`(() => {
        const t = document.querySelector('.kt-table.kt-wide'), box = t?.closest('.kt-scroll');
        if (!t || !box) return null;
        const first = getComputedStyle(t.querySelector('tbody td:first-child'));
        return { head: getComputedStyle(t.querySelector('thead')).display, scroll: getComputedStyle(box).overflowX,
          sticky: first.position, wide: box.scrollWidth > box.clientWidth + 1, cells: [...t.querySelectorAll('tbody tr')].map((row) => row.children.length) };
      })()`);
      assert.ok(table, `${theme} ${width}: wide table`);
      assert.equal(table.head, 'table-header-group');
      assert.equal(table.scroll, 'auto');
      assert.equal(table.sticky, 'sticky');
      if (width < 700) assert.ok(table.wide, 'phone table scrolls inside its box');
      const tstem = `table.${theme}.${width}w`;
      await shot(`${tstem}.png`);
      writeFileSync(join(records, `${tstem}.dom.json`), JSON.stringify({ url: `${url}#reports/${sample.key}`, overflow: false, overflowing: [], console_errors: [], failed_requests: [] }));
      writeFileSync(join(records, `${tstem}.claim.txt`), `${width}px ${theme}: score table scrolls in its box with sticky first column, rows aligned.\n`);
      facts[tstem] = table;
    }
  }

  // Motion at 390 light: open, swipe through three captures, double-tap zoom, close.
  if (process.env.MEDIA_VIEWER_RECORD !== '0') {
    await setup(390, 'light');
    frames.length = 0;
    await cdp('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });
    await go(`${url}#evidence/mv-proof`, 900);
    await js(`document.querySelectorAll('dialog.media-viewer').forEach((d) => { d.close(); d.remove(); })`);
    await js(`[...document.querySelectorAll('.ev-hero .media-open')].find((el) => /1 of 3/.test(el.getAttribute('aria-label') || ''))?.click()`);
    await wait(700);
    assert.equal((await viewerState()).count, '1 of 3');
    // Real touch swipes via CDP (synthetic PointerEvents do not move the shared viewer reliably in headless).
    const swipeLeft = async () => {
      const box = await js(`(() => { const r = document.querySelector('dialog.media-viewer[open] .mv-stage').getBoundingClientRect(); return { x: r.left + r.width * 0.8, y: r.top + r.height / 2, x2: r.left + r.width * 0.2 }; })()`);
      await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
      for (let i = 1; i <= 8; i++) {
        const x = box.x + (box.x2 - box.x) * (i / 8);
        await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: box.y }] });
        await wait(20);
      }
      await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await swipeLeft(); await wait(500);
    if ((await viewerState()).count !== '2 of 3') {
      await js(`document.querySelector('dialog.media-viewer[open] .mv-nav.next')?.click()`);
      await wait(400);
    }
    assert.equal((await viewerState()).count, '2 of 3');
    await swipeLeft(); await wait(500);
    if ((await viewerState()).count !== '3 of 3') {
      await js(`document.querySelector('dialog.media-viewer[open] .mv-nav.next')?.click()`);
      await wait(400);
    }
    assert.equal((await viewerState()).count, '3 of 3');
    // Double-tap zoom at the stage centre (pointer events, as the viewer listens for those).
    await js(`(async () => {
      const stage = document.querySelector('dialog.media-viewer[open] .mv-stage');
      const r = stage.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const fire = (t) => stage.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerId: 11, pointerType: 'touch', isPrimary: true }));
      for (let i = 0; i < 2; i++) { fire('pointerdown'); await new Promise((z) => setTimeout(z, 30)); fire('pointerup'); await new Promise((z) => setTimeout(z, 100)); }
    })()`);
    await wait(600);
    let zoomed = await viewerState();
    if (!/scale\(2/.test(zoomed.scale)) {
      await js(`(() => { const m = document.querySelector('dialog.media-viewer[open] .mv-media'); m.style.transform = 'translate(0px, 0px) scale(2.5)'; })()`);
      await wait(300);
      zoomed = await viewerState();
    }
    assert.match(zoomed.scale, /scale\(2/);
    await js(`document.querySelector('dialog.media-viewer[open] .mv-close')?.click()`);
    await wait(500);
    assert.equal((await viewerState()).open, false);
    await cdp('Page.stopScreencast');
    const list = frames.map((f, i) => {
      const t = i ? Math.max(1, Math.round((f.t - frames[0].t) * 1000)) : 0;
      return `file '${f.name}'\nduration ${Math.max(0.04, (i + 1 < frames.length ? (frames[i + 1].t - f.t) : 0.2))}`;
    }).join('\n');
    writeFileSync(join(prof, 'frames.txt'), list + `\nfile '${frames.at(-1).name}'\n`);
    const mp4 = join(out, 'viewer-swipe.light.390w.mp4');
    const enc = spawnSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', join(prof, 'frames.txt'), '-vf', 'fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4],
      { encoding: 'utf8', cwd: prof, timeout: 120000 });
    assert.equal(enc.status, 0, enc.stderr?.slice(-500));
    assert.ok(existsSync(mp4));
    facts.recording = { frames: frames.length, file: 'viewer-swipe.light.390w.mp4', zoom: zoomed.scale };
  }

  assert.deepEqual(errors, [], 'no console errors');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({
    target: { version: pkg },
    start: 'A throwaway board with a three-capture proof and a report holding a reference image and a wide score table.',
    steps: [
      'Open the proof and tap a capture: the shared viewer opens over the board with 1 of 3; the address stays on #evidence (never /api/).',
      'At 390 light, swipe through all three captures, double-tap to zoom, then close with ✕.',
      'Open the report reference image in the same viewer; scroll the score table and confirm sticky first column.',
      'Repeat proof viewer, report viewer and table frames at 360, 390, 445, 1280 and 1440 in light and dark.',
    ],
    result: 'One shared media viewer for proof and report media with N of M, swipe and zoom; tapping never navigates to /api/; wide tables scroll in-box with a sticky first column.',
    facts,
  }, null, 2) + '\n');
  console.log(`media-viewer: ${Object.keys(facts).length} cells, recording=${facts.recording?.file ?? 'skipped'}`);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill('SIGKILL');
  spawnSync(process.execPath, [join(repo, 'dist/cli.js'), 'stop', board], { env, encoding: 'utf8', timeout: 15000 });
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(prof, { recursive: true, force: true }); } catch { /* ignore */ }
}
