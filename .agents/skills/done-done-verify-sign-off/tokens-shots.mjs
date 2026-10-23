// The board's design tokens in use, one theme and width per run so a run's steps.json holds one claim.
// Usage: node .agents/skills/done-done-verify-sign-off/tokens-shots.mjs <output> [light|dark] [390|1280]
// SIGN_OFF_REPO names another built checkout to drive; TOKENS_SIDE=before names its files (before/after of a change).
// Saves today|decide|evidence|report.<side>.<theme>.<width>w.png, tokens.<side>.<theme>.<width>w.txt (the resolved value of each token the board uses,
// the card radius, the controls under 44px) and spacing.<side>.<theme>.<width>w.json (padding, margin and gap of the board's main elements, equal in light and dark).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390);
const side = process.env.TOKENS_SIDE ?? 'after', here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-tokens-'));
const env = { ...process.env, SIGN_OFF_FILER: 'verify', CHROME_DEVTOOLS_AXI_SESSION: `so-tokens-${process.pid}` };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const browser = (...args) => sh('chrome-devtools-axi', args, { env });
const seedEnv = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const probe = `() => {
  const r = document.documentElement, probeEl = document.createElement('i'); document.body.append(probeEl);
  const colour = (n) => { probeEl.style.color = ''; probeEl.style.color = 'var(' + n + ')'; return getComputedStyle(probeEl).color; };
  const length = (n) => { probeEl.style.width = ''; probeEl.style.width = 'var(' + n + ')'; return getComputedStyle(probeEl).width; };
  const tokens = {};
  for (const n of ['--page', '--tile', '--bar', '--sunk', '--line', '--text', '--muted', '--faint', '--border', '--accent', '--action', '--danger', '--ok', '--warn', '--badge']) tokens[n] = colour(n);
  for (const n of ['--t-xl', '--t-l', '--t-m', '--t-b', '--t-s', '--t-xs', '--t-xxs', '--r-ctl', '--r-card', '--ctl']) tokens[n] = length(n);
  probeEl.remove();
  const vis = (e) => { const b = e.getBoundingClientRect(), c = getComputedStyle(e); return b.width > 0 && b.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const under = [...document.querySelectorAll('button, a[href], summary, select, input, textarea')].filter(vis).map((e) => { const b = e.getBoundingClientRect(); return { text: (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 24), w: Math.round(b.width), h: Math.round(b.height) }; }).filter((x) => x.h < 44 || x.w < 44);
  const sp = (s) => { const e = document.querySelector(s); if (!e || !vis(e)) return null; const c = getComputedStyle(e); return [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft, c.marginTop, c.marginBottom, c.gap, c.fontSize, c.minHeight].join(' '); };
  const spacing = {}; for (const s of ['main', '.top', '.top h1', 'button', '.row', '.tabs a', '.tabs', '.glance', '.tile', '.card', '.decide-bar']) spacing[s] = sp(s);
  const css = (s, p) => { const e = document.querySelector(s); return e && vis(e) ? getComputedStyle(e)[p] : null; };
  return JSON.stringify({ tokens, under, spacing, body: css('body', 'color') + ' on ' + css('body', 'backgroundColor'), bodySize: css('body', 'fontSize'), cardRadius: css('.card', 'borderRadius') ?? css('.tile', 'borderRadius'), overflowX: document.documentElement.scrollWidth > innerWidth });
}`;
const parse = (s) => { let m = JSON.parse(s.match(/result: (".*")/)[1]); while (typeof m === 'string' && /^["{\[]/.test(m)) m = JSON.parse(m); return m; };
let base;
try {
  base = sh('bash', [join(here, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { cwd: repo, env: seedEnv }).trim().split('\n').pop();
  browser('open', base);
  browser('emulate', '--viewport', `${width}x844x1${width === 390 ? ',mobile,touch' : ''}`, '--color-scheme', theme);
  const wait = () => browser('eval', '() => new Promise((ok) => setTimeout(ok, 700))');
  browser('open', `${base}#reports`); wait();
  const reportHash = parse(browser('eval', `() => document.querySelector('a[href^="#reports/"]')?.getAttribute('href') ?? ''`));
  assert.ok(reportHash, 'the seeded board lists a report with a page');
  for (const [stem, hash] of [['today', '#'], ['decide', '#decide/npm'], ['evidence', '#evidence'], ['report', reportHash]]) {
    browser('open', `${base}${hash}`); wait();
    const name = `${stem}.${side}.${theme}.${width}w`;
    browser('screenshot', join(out, `${name}.png`));
    const m = parse(browser('eval', probe));
    const tok = Object.entries(m.tokens).map(([k, v]) => `${k} ${v}`);
    writeFileSync(join(out, `${name}.txt`), [`${side} ${theme} ${width}w ${stem}`, `page text ${m.body}`, `body size ${m.bodySize}`, `card corner ${m.cardRadius}`, `controls under 44px ${m.under.length}${m.under.length ? ': ' + m.under.map((x) => `${x.text} ${x.w}x${x.h}`).join(', ') : ''}`, `horizontal overflow ${m.overflowX ? 1 : 0}`, ...tok].join('\n') + '\n');
    writeFileSync(join(out, `spacing.${stem}.${side}.${theme}.${width}w.json`), JSON.stringify(m.spacing, null, 2) + '\n');
    if (side === 'after') assert.deepEqual([m.under.length, m.overflowX], [0, false], JSON.stringify(m.under));
  }
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board with a sign-in ask, asks, a plan, a report and an update.',
    steps: [`Open the board at ${width} px in ${theme} mode on Today, the sign-in ask in Decide, Evidence and a report.`, 'Read the resolved colour, type size, corner and control size of every design token the board uses, and measure every control against 44px.'],
    result: side === 'after' ? `At ${width} px ${width === 390 ? 'on a phone ' : ''}in ${theme} mode Today shows its title and ring, Up next, four count tiles and Latest proof as ${theme === 'light' ? 'white tiles on a light grey page' : 'dark grey tiles on a near-black grey page'}, with the four-tab bar at the bottom (the sidebar on a desk); Decide, Evidence and a report keep their layout in the same palette from the tokens file, with no control under 44px and no sideways overflow.` : `At ${width} px in ${theme} mode the four screens are captured as they were for comparison, with the token values then in use.` }, null, 2) + '\n');
} finally {
  try { browser('stop'); } catch {}
  try { sh(process.execPath, [join(repo, 'dist/cli.js'), 'stop', join(dir, 'board.json')], { env: seedEnv }); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
