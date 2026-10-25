// Real-board sequence proof through chrome-devtools-axi. Usage: node sequence-shots.mjs <out> [before]
// Five widths in both themes, all detail kinds, list order, history/reload and keyboard; trace filmstrip records navigation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
const sealed = resolve(process.argv[2]), out = resolve(process.env.SEQUENCE_REVIEW_ROOT ?? sealed), before = process.argv[3] === 'before', dir = mkdtempSync(join(tmpdir(), 'so-sequence-'));
mkdirSync(out, { recursive: true });
const env = { ...process.env, PATH: '/usr/bin:' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-sequence-${process.pid}` };
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const read = (js) => JSON.parse(JSON.parse(JSON.parse(browser('eval', js).match(/result: (".*")/)[1])));
const cli = (...args) => run(process.execPath, [resolve('dist/cli.js'), ...args], { env });
const settle = () => browser('eval', 'async () => { await new Promise(r => setTimeout(r, 500)); await document.fonts.ready; return 1; }');
const records = [], reportsOnly = process.env.SEQUENCE_ONLY === 'reports'; // the report sheet alone, so a judge sees only the frames a report claim names
try {
  const base = run('bash', ['.agents/skills/done-done-verify-sign-off/seed-board.sh', dir], { env }).trim().split('\n').at(-1);
  copyFileSync('docs/logo.svg', join(dir, 'project.svg')); cli('project', join(dir, 'board.json'), '--name', 'sign-off', '--icon', 'project.svg');
  for (const id of ['T-1', 'T-2']) cli('ticket', join(dir, 'board.json'), '--id', id, '--title', id === 'T-1' ? 'Ship the settings page' : 'Prepare release notes', '--asked', 'yes', '--progress', '40');
  const design = JSON.parse(readFileSync(join(dir, 'design-message.json'), 'utf8'));
  writeFileSync(join(dir, 'second-design.json'), JSON.stringify({ ...design, key: 'settings-review', title: 'Approve the settings review?' }));
  cli('post', join(dir, 'board.json'), '--kind', 'design', '--from', join(dir, 'second-design.json'));
  cli('post', join(dir, 'board.json'), '--type', 'report', '--key', 'release-notes', '--title', 'Release notes', '--about', 'Umer can review the next report.', '--purpose', 'other', '--project', 'sign-off', '--view', 'page/index.html', '--preview', 'page/preview.svg');
  for (const width of (process.env.SEQUENCE_WIDTHS ?? (reportsOnly ? '360,390,445,1280' : '360,390,445,1280,1440')).split(',').map(Number)) for (const theme of ['light', 'dark']) {
    const cell = `${theme}.${width}w`, height = width >= 1440 ? 900 : width >= 1024 ? 800 : 844;
    const capture = (area, drive) => { for (let attempt = 1; attempt <= 2; attempt++) {
      try { browserEnv.CHROME_DEVTOOLS_AXI_SESSION = `so-sequence-${process.pid}-${width}-${theme}-${records.length}-${attempt}`;
        browserEnv.CHROME_DEVTOOLS_AXI_PORT = run(process.execPath, ['--input-type=module', '-e', "import {createServer} from 'node:net'; const s=createServer(); s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()});"]);
        browser('open', base);
        browser('emulate', '--viewport', `${width}x${height}x2${width < 1024 ? ',mobile,touch' : ''}`, '--color-scheme', theme);
        drive(); return;
      } catch (error) { if (!/BROWSER_ERROR|BRIDGE_NOT_READY/.test(String(error))) throw error; if (attempt === 2) { records.push({ cell, area, missing: String(error) }); console.error(cell, area, String(error)); } }
      finally { browser('stop'); }
    } };
    if (!reportsOnly) capture('sequence', () => {
    browser('open', base + '#waiting'); settle();
    browser('eval', 'async () => { for (let i = 0; i < 40 && !document.querySelector("#item-ship"); i++) await new Promise(r => setTimeout(r, 250)); document.querySelector("#item-ship").click(); return 1; }'); settle();
    const check = read(`() => { const n = document.querySelector('.detail-sequence'), b = n?.getBoundingClientRect(), label = document.querySelector('.ask-sheet .sh-lab'), header = label?.closest('.sh-head'), title = document.querySelector('.ask-sheet #ask-title'); return JSON.stringify({ width: innerWidth, theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', position: n?.querySelector('.position')?.textContent ?? null, overflow: document.documentElement.scrollWidth > innerWidth, headerFits: !b || b.left >= 0 && b.right <= innerWidth, metadataFits: !label || label.scrollWidth <= label.clientWidth + 1, titleClear: !header || header.getBoundingClientRect().bottom <= title.getBoundingClientRect().top, routes: history.state?.detailSequence?.routes }); }`);
    assert.equal(check.overflow, false); assert.equal(check.headerFits, true); assert.equal(check.metadataFits, true); assert.equal(check.titleClear, true);
    if (!before) {
      assert.ok(check.routes.length > 1); assert.ok(check.position.startsWith('2 of '));
      browser('press', 'j'); settle();
      assert.equal(read('() => JSON.stringify(location.hash)'), check.routes[2]);
      browser('press', 'k'); settle();
      assert.equal(read('() => JSON.stringify(location.hash)'), check.routes[1]);
      browser('eval', '() => { location.reload(); return 1; }'); settle();
      assert.equal(read('() => JSON.stringify(document.querySelector(".detail-sequence .position").textContent)'), check.position);
    }
    browser('screenshot', join(out, `sequence.${cell}.png`));
    writeFileSync(join(out, `sequence.${cell}.dom.json`), JSON.stringify(check, null, 2));
    records.push({ cell, ask: check.position });
    if (!before && width === 390 && theme === 'light') {
      browser('perf-start', '--no-reload', '--no-auto-stop');
      browser('press', 'j'); settle(); browser('press', 'k'); settle();
      browser('perf-stop', '--file', join(out, 'sequence-motion.json.gz'));
      const frames = JSON.parse(gunzipSync(readFileSync(join(out, 'sequence-motion.json.gz')))).traceEvents.filter(e => e.name === 'Screenshot');
      assert.ok(frames.length > 1, 'the recording has real browser frames');
      frames.forEach((e, i) => writeFileSync(join(dir, `motion-${i}.jpg`), Buffer.from(e.args.snapshot, 'base64')));
      writeFileSync(join(dir, 'motion.ffconcat'), frames.map((e, i) => `file 'motion-${i}.jpg'\nduration ${Math.max(.03, ((frames[i + 1]?.ts ?? e.ts + 500000) - e.ts) / 1e6)}\n`).join(''));
      run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'motion.ffconcat'), '-vf', 'fps=30,scale=390:844:force_original_aspect_ratio=decrease,pad=390:844:(ow-iw)/2:(oh-ih)/2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, 'sequence-motion.mp4')]);
    }
    });
    for (const [area, selector] of [['reports', '.rp-page a.dl-face'], ['designs', '.dz-list a[href], .dz-strip a[href]'], ['tickets', '.tk-row']].filter(([area]) => !reportsOnly || area === 'reports')) {
      capture(area, () => {
      browser('open', base + '#' + area); settle();
      browser('eval', `async () => { for (let i = 0; i < 40 && !document.querySelector(${JSON.stringify(selector)}); i++) await new Promise(r => setTimeout(r, 250)); document.querySelector(${JSON.stringify(selector)}).click(); return 1; }`); settle();
      const position = read('() => JSON.stringify(document.querySelector(".detail-sequence .position")?.textContent ?? null)');
      if (!before) assert.ok(position, area + ' header');
      const titleBelowPager = area === 'reports' && width < 1024 ? read('() => JSON.stringify(document.querySelector(".rp-sheet-body .detail-sequence").getBoundingClientRect().bottom <= document.querySelector(".rp-sheet-body h1").getBoundingClientRect().top)') : undefined;
      if (!before && titleBelowPager !== undefined) assert.equal(titleBelowPager, true, 'on a phone the report sheet title sits below its previous and next buttons');
      browser('screenshot', join(out, `${area}.${cell}.png`));
      if (!before) {
        const routes = read('() => JSON.stringify(history.state.detailSequence.routes)');
        assert.ok(routes.length >= 2, area + ' has a sequence');
        browser('press', 'j'); settle();
        assert.equal(read('() => JSON.stringify(location.hash)'), routes[1], area + ' next');
        browser('press', 'k'); settle();
        assert.equal(read('() => JSON.stringify(location.hash)'), routes[0], area + ' previous');
      }
      records.push({ cell, area, position, ...(titleBelowPager !== undefined && { 'report sheet title sits below its previous and next buttons': titleBelowPager }) });
      });
    }
  }
  writeFileSync(join(out, 'sequence-checks.json'), JSON.stringify(records, null, 2));
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version }, start: 'The originating filtered list', steps: before ? ['Open each detail kind and the Evidence list in both themes at five widths', 'Read the existing headers before detail navigation'] : ['Browse an open ask with previous/next arrows and a position at 360, 390, 445, 1280 and 1440 in light and dark', 'Use J/K to move in the originating list order across asks, proofs, reports, designs and tickets, keeping each sequence', 'Reload and confirm the same sequence and position', 'Read header position and disabled end arrows', 'Read the report head: it holds its pager, and on a phone the title sits below the previous and next buttons, not under them'], result: before ? 'Baseline detail headers and list rows captured before navigation changes' : 'All detail kinds retain their list sequence with visible header navigation', captures: records }, null, 2));
  if (out !== sealed) { mkdirSync(sealed, { recursive: true }); for (const r of records.filter(r => r.ask)) for (const ext of ['png', 'dom.json']) copyFileSync(join(out, `sequence.${r.cell}.${ext}`), join(sealed, `sequence.${r.cell}.${ext}`)); for (const name of ['sequence-motion.mp4', 'steps.json']) copyFileSync(join(out, name), join(sealed, name)); }
} finally {
  browser('stop');
  cli('stop', join(dir, 'board.json'));
  rmSync(dir, { recursive: true, force: true });
}
