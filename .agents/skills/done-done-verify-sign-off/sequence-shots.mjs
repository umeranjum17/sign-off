// Real-board sequence proof through chrome-devtools-axi. Usage: node sequence-shots.mjs <out> [before]
// Four cells, all five detail kinds, list order, history/reload and keyboard; trace filmstrip records navigation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const out = resolve(process.argv[2]), before = process.argv[3] === 'before', dir = mkdtempSync(join(tmpdir(), 'so-sequence-'));
mkdirSync(out, { recursive: true });
const env = { ...process.env, PATH: '/usr/bin:' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-sequence-${process.pid}` };
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const read = (js) => JSON.parse(JSON.parse(JSON.parse(browser('eval', js).match(/result: (".*")/)[1])));
const cli = (...args) => run(process.execPath, [resolve('dist/cli.js'), ...args], { env });
const settle = () => browser('eval', 'async () => { await new Promise(r => setTimeout(r, 500)); await document.fonts.ready; return 1; }');
const records = [];
try {
  const base = run('bash', ['.agents/skills/done-done-verify-sign-off/seed-board.sh', dir], { env }).trim().split('\n').at(-1);
  for (const id of ['T-1', 'T-2']) cli('ticket', join(dir, 'board.json'), '--id', id, '--title', id === 'T-1' ? 'Ship the settings page' : 'Prepare release notes', '--asked', 'yes', '--progress', '40');
  browser('open', base);
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
    const cell = `${theme}.${width}w`;
    browser('emulate', '--viewport', `${width}x844x2${width === 390 ? ',mobile,touch' : ''}`, '--color-scheme', theme);
    browser('open', base + '#waiting'); settle();
    browser('eval', '() => { document.querySelector("#item-ship").click(); return 1; }'); settle();
    const check = read(`() => { const n = document.querySelector('.detail-sequence'), b = n?.getBoundingClientRect(); return JSON.stringify({ position: n?.querySelector('[role=status]')?.textContent ?? null, overflow: document.documentElement.scrollWidth > innerWidth, headerFits: !b || b.left >= 0 && b.right <= innerWidth, routes: history.state?.detailSequence?.routes }); }`);
    assert.equal(check.overflow, false); assert.equal(check.headerFits, true);
    if (!before) {
      assert.ok(check.routes.length > 1); assert.ok(check.position.startsWith('2 of '));
      browser('press', 'j'); settle();
      assert.equal(read('() => JSON.stringify(location.hash)'), check.routes[2]);
      browser('press', 'k'); settle();
      assert.equal(read('() => JSON.stringify(location.hash)'), check.routes[1]);
      browser('eval', '() => { location.reload(); return 1; }'); settle();
      assert.equal(read('() => JSON.stringify(document.querySelector(".detail-sequence [role=status]").textContent)'), check.position);
    }
    browser('screenshot', join(out, `sequence.${cell}.png`));
    writeFileSync(join(out, `sequence.${cell}.dom.json`), JSON.stringify(check, null, 2));
    records.push({ cell, ask: check.position });
    if (!before && width === 390 && theme === 'light') {
      browser('perf-start', '--no-reload', '--no-auto-stop');
      browser('press', 'j'); settle(); browser('press', 'k'); settle();
      browser('perf-stop', '--file', join(out, 'sequence-motion.json.gz'));
    }
    for (const [area, selector] of [['evidence', '.ev-list a[href]'], ['reports', '.rp-page a.dl-face'], ['designs', '.dz-list a[href], .dz-strip a[href]'], ['tickets', '.tk-row']]) {
      browser('open', base + '#' + area); settle();
      browser('eval', `() => { document.querySelector(${JSON.stringify(selector)}).click(); return 1; }`); settle();
      const position = read('() => JSON.stringify(document.querySelector(".detail-sequence [role=status]")?.textContent ?? null)');
      if (!before) assert.ok(position, area + ' header');
      browser('screenshot', join(out, `${area}.${cell}.png`));
      records.push({ cell, area, position });
    }
  }
  writeFileSync(join(out, 'sequence-checks.json'), JSON.stringify(records, null, 2));
} finally {
  browser('stop');
  cli('stop', join(dir, 'board.json'));
  rmSync(dir, { recursive: true, force: true });
}
