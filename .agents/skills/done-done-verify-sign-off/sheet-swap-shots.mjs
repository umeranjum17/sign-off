// Open-sheet swap proof through chrome-devtools-axi. Usage: node sheet-swap-shots.mjs <out>
// At 390 in both themes: open an ask, tap Next, Next, Previous; after each tap the sheet is the same element, did not run its open animation again and is at its top.
// At 1280 one frame of the desk pane after Next.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const out = resolve(process.argv[2]), dir = mkdtempSync(join(tmpdir(), 'so-swap-'));
mkdirSync(out, { recursive: true });
const env = { ...process.env, PATH: '/usr/bin:' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-swap-${process.pid}` };
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const read = (js) => JSON.parse(JSON.parse(JSON.parse(browser('eval', js).match(/result: (".*")/)[1])));
const settle = (ms = 500) => browser('eval', `async () => { await new Promise(r => setTimeout(r, ${ms})); return 1; }`);
const records = [];
try {
  const base = run('bash', ['.agents/skills/done-done-verify-sign-off/seed-board.sh', dir], { env }).trim().split('\n').at(-1);
  for (const id of ['T-1', 'T-2']) run(process.execPath, [resolve('dist/cli.js'), 'ticket', join(dir, 'board.json'), '--id', id, '--title', id === 'T-1' ? 'Ship the settings page' : 'Prepare release notes', '--asked', 'yes', '--progress', '40'], { env });
  // Four plain asks side by side (newest first), so Next and Previous stay inside one kind of sheet.
  for (const n of [1, 2, 3, 4]) run(process.execPath, [resolve('dist/cli.js'), 'post', join(dir, 'board.json'), '--ask-ref', 'message-demo', '--key', `swap-${n}`, '--title', `Swap question ${n}: ship the change?`, '--about', 'Umer can answer this one from the sheet.', '--why', 'It keeps the proof honest.', '--outcome', 'yes=It ships.', '--outcome', 'no=It waits.', '--recommend', 'yes', '--recommend-reason', 'It is ready.', '--default', 'yes'], { env });
  for (const [width, theme] of [[390, 'light'], [390, 'dark'], [1280, 'light']]) {
    browser('open', base);
    browser('emulate', '--viewport', `${width}x${width >= 1024 ? 800 : 844}x2${width < 1024 ? ',mobile,touch' : ''}`, '--color-scheme', theme);
    browser('open', base + '#waiting'); settle();
    if (width < 1024) {
      browser('eval', '() => { document.querySelector("#item-swap-3").click(); return 1; }'); settle(700);
      browser('eval', `() => { const o = document.querySelector('.ask-over'); window.__sheet = { o, s: document.querySelector('.ask-sheet'), opens: 0 };
        document.querySelector('#board').addEventListener('animationstart', (e) => { if (e.animationName === 'sheet-up') window.__sheet.opens++; }, true); return 1; }`);
      browser('screenshot', join(out, `swap.${theme}.${width}w.0-start.png`));
      for (const [i, button] of ['last-child', 'last-child', 'first-child'].entries()) {
        browser('eval', `() => { document.querySelector('.ask-sheet').scrollTop = 80; return 1; }`);
        const before = read('() => JSON.stringify(location.hash)');
        browser('eval', `() => { document.querySelector('.detail-sequence button:${button}').click(); return 1; }`);
        settle(500);
        const after = read(`() => JSON.stringify({ title: location.hash, sheets: document.querySelectorAll('.ask-sheet').length, same: document.querySelector('.ask-over') === window.__sheet.o && document.querySelector('.ask-sheet') === window.__sheet.s, opens: window.__sheet.opens, top: document.querySelector('.ask-sheet').scrollTop, position: document.querySelector('.detail-sequence .position').textContent })`);
        assert.notEqual(after.title, before); assert.equal(after.same, true); assert.equal(after.opens, 0); assert.equal(after.top, 0);
        // Previous returns to a question already shown, so a pick on it makes its frame differ from the earlier one.
        if (button === 'first-child') browser('eval', '() => { document.querySelectorAll(".ask-sheet .pick-option")[1].click(); return 1; }'), settle(300);
        browser('screenshot', join(out, `swap.${theme}.${width}w.${i + 1}-${button === 'last-child' ? 'next' : 'previous'}.png`));
        records.push({ theme, width, tap: button === 'last-child' ? 'next' : 'previous', ...after });
      }
      if (theme === 'light') {
        // A ticket's sheet and a report's page also swap in place (Evidence uses the same reader as Reports).
        for (const [area, selector, root] of [['tickets', '.tk-row', '.tk-over'], ['reports', '.rp-page a.dl-face', '#reader']]) {
          browser('open', base); browser('open', base + '#' + area); settle(1200);
          browser('eval', `() => { document.querySelector(${JSON.stringify(selector)}).click(); return 1; }`); settle(700);
          browser('eval', `() => { window.__root = document.querySelector(${JSON.stringify(root)}); document.querySelector('.detail-sequence button:last-child').click(); return 1; }`); settle(500);
          const kept = read(`() => JSON.stringify({ same: document.querySelector(${JSON.stringify(root)}) === window.__root, position: document.querySelector('.detail-sequence .position')?.textContent })`);
          assert.equal(kept.same, true, area); records.push({ theme, width, area, ...kept });
        }
      }
    } else {
      browser('eval', '() => { document.querySelector("#item-swap-3").click(); return 1; }'); settle();
      browser('eval', '() => { document.querySelector(".detail-sequence button:last-child").click(); return 1; }'); settle();
      browser('screenshot', join(out, `swap.${theme}.${width}w.next.png`));
      records.push({ theme, width, tap: 'next', position: read('() => JSON.stringify(document.querySelector(".detail-sequence .position").textContent)') });
    }
    browser('stop');
  }
  writeFileSync(join(out, 'swap-checks.json'), JSON.stringify(records, null, 2));
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version }, start: 'An open ask on Decide', result: 'The phone sheet stayed up while the title and the position in the header changed with Next and Previous, and on a desk the pane showed the next ask', captures: records, steps: ['On a phone the open ask stays up as a sheet over Decide; tap Next, Next, Previous in light and dark, a frame after each tap', 'Next and Previous swap in the next or earlier ask: the title and the position in the header change, the sheet is the same element and is at its top', 'On a desk tap Next once: the pane shows the next ask, with its position in the header'] }, null, 2));
} finally {
  try { browser('stop'); } catch {}
  run(process.execPath, [resolve('dist/cli.js'), 'stop', join(dir, 'board.json')], { env });
  rmSync(dir, { recursive: true, force: true });
}
