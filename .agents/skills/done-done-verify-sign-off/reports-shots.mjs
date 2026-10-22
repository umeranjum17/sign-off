// Reports on a fresh board with five reports (before and after with a video, a chart, a diagram, plain, and a guided one), at 390 (2x, touch) and 1280, light and dark.
// Usage: node .agents/skills/done-done-verify-sign-off/reports-shots.mjs <output>   (REPORTS_WIDTHS="390" keeps one width)
// SIGN_OFF_REPO names another built checkout to drive, such as the base for a before; the feel states (swipes, More, read dots) are captured only where the board draws them.
// Saves <state>.<theme>.<width>w.png and reports.<theme>.<width>w.txt (dots, counts, the last row against the tab bar, controls under 44px, sideways overflow, console errors).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-reports-'));
const env = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-reports-${process.pid}` };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const browser = (...args) => sh('chrome-devtools-axi', args, { env });
const seedEnv = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const result = (text) => { let m = JSON.parse(text.match(/result: (".*")/)[1]); while (typeof m === 'string') try { m = JSON.parse(m); } catch { break; } return m; };
const wait = (ms) => browser('eval', `() => new Promise((ok) => setTimeout(ok, ${ms}))`);
const ev = (fn) => result(browser('eval', fn));
// A finger on a row: pointer events through the page's own handlers, moved sideways in eight steps, released or held.
const drag = (key, dx, release) => ev(`() => new Promise(async (ok) => { const f = document.querySelector('.dl-row[data-key="${key}"] .dl-face'); if (!f) return ok('none'); const r = f.getBoundingClientRect(), y = r.top + r.height / 2, x0 = r.left + 60;
  const o = (x) => ({ bubbles: true, pointerId: 7, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y }); f.dispatchEvent(new PointerEvent('pointerdown', o(x0)));
  for (let i = 1; i <= 8; i++) { await new Promise((w) => setTimeout(w, 16)); f.dispatchEvent(new PointerEvent('pointermove', o(x0 + ${dx} * i / 8))); } if (${release}) f.dispatchEvent(new PointerEvent('pointerup', o(x0 + ${dx}))); ok('ok'); })`);
const probe = `() => {
  const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const under = [...document.querySelectorAll('#board button, #board a[href], #board summary, .tabs a, nav.side a')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { text: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.h < 44);
  const rows = [...document.querySelectorAll('#board li.report')], last = rows.at(-1), tabs = document.querySelector('.tabs');
  scrollTo(0, document.documentElement.scrollHeight);
  const gap = last && tabs && getComputedStyle(tabs).display !== 'none' ? Math.round(tabs.getBoundingClientRect().top - last.getBoundingClientRect().bottom) : null;
  scrollTo(0, 0);
  const tab = [...document.querySelectorAll('.tabs a')].find((a) => a.getAttribute('href') === '#reports' && getComputedStyle(a.parentElement).display !== 'none') ?? document.querySelector('nav.side a[href="#reports"]');
  return JSON.stringify({ rows: rows.length, dots: document.querySelectorAll('#board .report .new').length, lede: document.querySelector('.top .lede')?.textContent ?? '', tab: tab?.querySelector('.bd, .n')?.textContent ?? '', tabLabel: tab?.getAttribute('aria-label') ?? '',
    heads: [...document.querySelectorAll('#board .dl-head, #board .sec-h h2')].map((h) => h.textContent), lastRowAboveTabBar: gap, under, overflowX: document.documentElement.scrollWidth > innerWidth });
}`;
const errors = () => browser('console', '--type', 'error');
try {
  const url = sh('bash', [join(here, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { cwd: repo, env: seedEnv }).trim().split('\n').pop();
  const so = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args], { env: seedEnv });
  // Four more reports beside the seeded one (before and after, with a video): two filed now, one 23 hours ago, and a guided report.
  const base = JSON.parse(readFileSync(join(dir, 'report-now.json'), 'utf8')), ago = (h) => new Date(Date.now() - h * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z');
  const more = [
    { key: 'settings-speed', title: 'Where the settings page spends its first second', about: 'It is ready in 0.8 seconds. Most of that is the script, which can load after the page shows.', form: 'chart', group: 'Settings', asked_by: 'Release agent', filed: ago(0.5) },
    { key: 'release-train', title: 'Why the release train has three stages', about: 'Build, check and publish each have one owner, so a failed check stops the train before anything ships.', form: 'diagram', group: 'Release', filed: ago(23) },
    { key: 'next-question', title: 'How sign-off picks the next question', about: 'The soonest deadline comes first, then anything that blocks other work, then the rest by age.', filed: ago(22) },
  ];
  for (const m of more) {
    const msg = { ...base, ...m }; delete msg.video; delete msg.decided; if (!m.form) delete msg.form; if (!m.group) delete msg.group; if (!m.asked_by) delete msg.asked_by;
    writeFileSync(join(dir, `${m.key}.json`), JSON.stringify(msg)); so('post', join(dir, 'board.json'), '--kind', 'report', '--from', join(dir, `${m.key}.json`));
  }
  const guided = JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v4/valid-full.json'), 'utf8')); guided.filed = ago(1);
  writeFileSync(join(dir, 'guided.json'), JSON.stringify(guided)); so('post', join(dir, 'board.json'), '--kind', 'report', '--from', join(dir, 'guided.json'));
  const report = { theme: {}, lines: [] };
  // Each cell starts from the same read state: the three filed today not read, the two from yesterday read.
  const reset = () => { for (const [keys, read] of [[[base.key, guided.key, more[0].key], false], [[more[1].key, more[2].key], true]]) spawnSync('curl', ['-sf', `${url}api/reads`, '-H', 'content-type: application/json', '-d', JSON.stringify({ keys, read })]); };
  browser('open', url);
  for (const w of (process.env.REPORTS_WIDTHS ?? '390 1280').split(' ').map(Number)) for (const theme of ['light', 'dark']) {
    const vp = w === 390 ? '390x844x2,mobile,touch' : '1280x800x1', name = (s) => join(out, `${s}.${theme}.${w}w.png`), shot = (s) => browser('screenshot', name(s));
    browser('emulate', '--viewport', vp, '--color-scheme', theme);
    // A reload reads the board again; read marks from the last cell are cleared first so every cell starts the same.
    const go = (hash) => { browser('open', `${url}${hash}`); ev('() => { location.reload(); return 1 }'); wait(1100); };
    reset();
    go('#reports'); shot('reports');
    const m = ev(probe);
    ev('() => { scrollTo(0, document.documentElement.scrollHeight); return 1 }'); wait(300); shot('reports-end');
    const feel = ev('() => !!document.querySelector(".dl-row[data-key] .dl-face")');
    go(`#reports/${base.key}`); shot('report-page');
    let read = null;
    if (feel) {
      // Opening a report marks it read: back on the list its dot is gone and the counts drop by one.
      go('#reports'); read = ev(probe); shot('reports-read');
      ev(`() => { const r = document.querySelector('.dl-row[data-key="settings-speed"] .dl-face'); r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: 200, clientY: r.getBoundingClientRect().top + 20 })); return 1 }`);
      wait(200); shot('reports-press');
      ev(`() => { document.querySelector('.dl-row[data-key="settings-speed"] .dl-face').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })); return 1 }`);
      for (const [side, dx] of [['right', 150], ['left', -150]]) { go('#reports'); drag('settings-speed', dx, false); wait(300); shot(`reports-swipe-${side}`); }
      go('#reports'); ev('() => { document.querySelector(".top .dl-more > summary").click(); return 1 }'); wait(400); shot('reports-menu');
      // A full left swipe archives the row with Undo; Undo puts it back.
      go('#reports'); drag('settings-speed', -320, true); wait(900); shot('reports-archived');
      const archived = ev('() => !document.querySelector(".dl-row[data-key=\\"settings-speed\\"]:not(.leaving)") && !document.getElementById("toast").hidden');
      ev('() => { document.getElementById("undo").click(); return 1 }'); wait(1200);
      const back = ev('() => !!document.querySelector(".dl-row[data-key=\\"settings-speed\\"]")');
      // A full right swipe on an unread row marks it read; its dot goes.
      go('#reports'); drag('settings-speed', 320, true); wait(900);
      const swipedRead = ev('() => !document.querySelector(".dl-row[data-key=\\"settings-speed\\"] .new")');
      report.lines.push(`${theme} ${w}w: archive by swipe left ${archived ? 'yes' : 'no'}, Undo brings it back ${back ? 'yes' : 'no'}, swipe right marks read ${swipedRead ? 'yes' : 'no'}`);
      assert.ok(archived && back && swipedRead, `${theme} ${w}w swipes`);
    }
    const errs = errors();
    writeFileSync(join(out, `reports.${theme}.${w}w.txt`), [`${theme} ${w}w Reports`, `rows ${m.rows}, unread dots ${m.dots}, lede "${m.lede}", Reports tab count "${m.tab}" (${m.tabLabel})`, `section heads ${m.heads.join(', ')}`,
      `last row above the tab bar by ${m.lastRowAboveTabBar ?? 'n/a (no tab bar)'} px`, read ? `after opening a report: dots ${read.dots}, lede "${read.lede}", tab "${read.tab}"` : 'read state: not drawn',
      `controls under 44px ${m.under.length}${m.under.length ? ': ' + m.under.map((x) => `${x.text} ${x.w}x${x.h}`).join(', ') : ''}`, `sideways overflow ${m.overflowX ? 'yes' : 'no'}`, `console errors: ${!/no console messages found/i.test(errs) ? errs.trim().split('\n').slice(0, 5).join(' | ') : 'none'}`, ...report.lines.splice(0)].join('\n') + '\n');
    if (feel) assert.deepEqual([m.dots, read.dots, m.overflowX, m.lastRowAboveTabBar === null || m.lastRowAboveTabBar >= 16], [3, 2, false, true], JSON.stringify({ m, read }));
  }
  // REPORTS_RECORD=1 also records the motion at 390, light and dark, on the same board (reports.<theme>.390w.mp4), each from the same read state.
  if (process.env.REPORTS_RECORD) for (const theme of ['light', 'dark']) {
    reset();
    sh(process.execPath, [join(here, '.agents/skills/done-done-verify-sign-off/decide-record.mjs'), url, theme, join(out, `reports.${theme}.390w.mp4`), 'reports'], { timeout: 180000 });
  }
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board with five reports: three filed today and not read, two from yesterday.',
    steps: ['Open Reports at 390 and 1280 in light and dark.', 'Scroll to the end of the list.', 'Open a report, then go back to the list.', 'Press a row, swipe it right and left, open More.', 'Swipe a row left to archive it, then tap Undo.', 'Swipe a row right to mark it read.'],
    result: 'Reports lists Today and Earlier with a picture per form and a blue dot on each report not read; opening one reads it and its dot and count go; a swipe left archives with Undo and a swipe right reads; the last row clears the tab bar.' }, null, 2) + '\n');
} finally {
  try { browser('stop'); } catch {}
  try { sh(process.execPath, [join(repo, 'dist/cli.js'), 'stop', join(dir, 'board.json')], { env: seedEnv }); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
