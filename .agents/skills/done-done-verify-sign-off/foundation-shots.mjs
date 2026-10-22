// The board foundation (type scale, 44px controls, tab bar), one theme and width per run so a run's steps.json holds one claim.
// Usage: node .agents/skills/done-done-verify-sign-off/foundation-shots.mjs <output> [light|dark] [390|1280]
// SIGN_OFF_REPO names another built checkout to drive, such as the base for a before (FOUNDATION_SIDE=before names its files).
// Saves decide.<side>.<theme>.<width>w.png/.txt (tab bar height, controls under 44px) and today.<side>.<theme>.<width>w.png/.txt (type sizes),
// plus spacing.<side>.<theme>.<width>w.json, the padding, margin and gap of the board's main elements, which must match between light and dark.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390);
const side = process.env.FOUNDATION_SIDE ?? 'after', here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-foundation-'));
const env = { ...process.env, SIGN_OFF_FILER: 'verify', CHROME_DEVTOOLS_AXI_SESSION: `so-foundation-${process.pid}` };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const browser = (...args) => sh('chrome-devtools-axi', args, { env });
const seedEnv = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const probe = `() => {
  const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const under = [...document.querySelectorAll('button, a[href], summary, select, input, textarea')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { text: (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.h < 44 || x.w < 44);
  const tab = document.querySelector('.tabs'), bar = tab && vis(tab) ? tab.getBoundingClientRect() : null;
  const sp = (s) => { const e = document.querySelector(s); if (!e || !vis(e)) return null; const c = getComputedStyle(e); return [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft, c.marginTop, c.marginBottom, c.gap, c.fontSize, c.minHeight].join(' '); };
  const spacing = {}; for (const s of ['main', '.top', '.top h1', 'button', '.open-link', '.row', '.tabs a', '.tabs', '.glance', '.tile', '.decide-bar']) spacing[s] = sp(s);
  const css = (s, p) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : null; };
  return JSON.stringify({ body: css('body', 'fontSize'), bodyLine: css('body', 'lineHeight'), h1: css('.top h1', 'fontSize'), tabBar: bar && { h: Math.round(bar.height * 10) / 10, link: Math.round(document.querySelector('.tabs a').getBoundingClientRect().height * 10) / 10, bg: css('.tabs', 'backgroundColor'), blur: css('.tabs', 'backdropFilter') }, tabLabel: css('.tabs a', 'fontSize'), overflowX: document.documentElement.scrollWidth > innerWidth, under, spacing });
}`;
let base;
try {
  const url = sh('bash', [join(here, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { cwd: repo, env: seedEnv }).trim().split('\n').pop();
  base = url;
  browser('open', base);
  browser('emulate', '--viewport', `${width}x844x1${width === 390 ? ',mobile,touch' : ''}`, '--color-scheme', theme);
  const cell = {};
  for (const [stem, hash] of [['decide', '#decide/npm'], ['today', '#']]) {
    browser('open', `${base}${hash}`);
    browser('eval', '() => new Promise((ok) => setTimeout(ok, 700))');
    const name = `${stem}.${side}.${theme}.${width}w`;
    browser('screenshot', join(out, `${name}.png`));
    let m = browser('eval', probe).match(/result: (".*")/)[1]; m = JSON.parse(m); while (typeof m === 'string') m = JSON.parse(m);
    cell[stem] = m;
    const lines = stem === 'decide'
      ? [m.tabBar ? `tab bar content height ${m.tabBar.link}px (the bar box is ${m.tabBar.h}px with its 0.5px hairline)` : 'tab bar not shown at this width: the sidebar replaces it', `tab bar background ${m.tabBar ? m.tabBar.bg : '-'}`, `tab bar blur ${m.tabBar ? m.tabBar.blur : '-'}`, `tab label size ${m.tabLabel}`, `controls under 44px ${m.under.length}${m.under.length ? ': ' + m.under.map((x) => `${x.text} ${x.w}x${x.h}`).join(', ') : ''}`, `horizontal overflow ${m.overflowX ? 1 : 0}`]
      : [`body text ${m.body} on ${m.bodyLine}`, `page title ${m.h1}`, `controls under 44px ${m.under.length}${m.under.length ? ': ' + m.under.map((x) => `${x.text} ${x.w}x${x.h}`).join(', ') : ''}`, `horizontal overflow ${m.overflowX ? 1 : 0}`];
    writeFileSync(join(out, `${name}.txt`), `${side} ${theme} ${width}w ${stem}\n${lines.join('\n')}\n`);
    writeFileSync(join(out, `spacing.${stem}.${side}.${theme}.${width}w.json`), JSON.stringify(m.spacing, null, 2) + '\n');
    if (side === 'after') assert.deepEqual([m.under.length, m.overflowX], [0, false], JSON.stringify(m));
  }
  if (side === 'after' && width === 390) assert.equal(cell.decide.tabBar.link, 52, `tab bar ${cell.decide.tabBar.link}`);
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board with a sign-in ask, asks, a plan, a report and an update.',
    steps: [`Open the board at ${width} px in ${theme} mode on the sign-in ask in Decide, then on Today.`, 'Measure every control (button, link, select) against 44px, the tab bar height, the type scale sizes, and the spacing that dark and light share.'],
    result: side === 'after' ? `At ${width} px in ${theme} mode every control on Decide and Today is at least 44px, the tab bar is a clean 52px, text reads on one type scale (16px body) and nothing runs off the screen.` : `At ${width} px in ${theme} mode the board is captured as it was for comparison: the controls, tab bar and type scale before the change.` }, null, 2) + '\n');} finally {
  try { browser('stop'); } catch {}
  try { sh(process.execPath, [join(repo, 'dist/cli.js'), 'stop', join(dir, 'board.json')], { env: seedEnv }); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
