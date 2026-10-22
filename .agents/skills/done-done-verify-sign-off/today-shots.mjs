// Today on the board (glance, three tiles, section heads, rows, report card, leash) at one theme and width per run, so a run's steps.json holds one claim.
// Usage: node .agents/skills/done-done-verify-sign-off/today-shots.mjs <output> [light|dark] [390|1280]
// SIGN_OFF_REPO names another built checkout to drive, such as the base for a before (TODAY_SIDE=before names its files).
// Saves today.<side>.<theme>.<width>w.png/.txt (sizes, gaps, controls under 44px, Proven today against Evidence) and spacing.today.<side>.<theme>.<width>w.json;
// the .txt also says whether the spacing is identical in the other theme. A light 390 after run adds today-scroll.mp4: scroll the page, swipe Proven today, tap a tile.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390);
const side = process.env.TODAY_SIDE ?? 'after', here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-today-'));
const env = { ...process.env, SIGN_OFF_FILER: 'verify', CHROME_DEVTOOLS_AXI_SESSION: `so-today-${process.pid}` };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const browser = (...args) => sh('chrome-devtools-axi', args, { env });
const seedEnv = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
// A tall window holds the whole page in one capture, so the fixed tab bar and sidebar stay where a person sees them.
const height = 1900;
const settle = () => browser('eval', '() => new Promise((ok) => setTimeout(ok, 700))');
const result = (text) => { let m = JSON.parse(text.match(/result: (".*")/)[1]); while (typeof m === 'string') m = JSON.parse(m); return m; };
const probe = `() => {
  const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const under = [...document.querySelectorAll('button, a[href], summary, select, input, textarea')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { text: (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.h < 44 || x.w < 44);
  const sp = (s) => { const e = document.querySelector(s); if (!e || !vis(e)) return null; const c = getComputedStyle(e); return [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft, c.marginTop, c.marginBottom, c.gap, c.fontSize, c.lineHeight, c.minHeight, c.borderRadius].join(' '); };
  const spacing = {}; for (const s of ['main', '.top', '.top h1', '.glance', '.glance .seen', '.tiles', '.tile', '.tile .n', '.tile .name', '.areas .sec-head', '.areas h2', '.areas .ask-group > li', '.areas .ask-card', '.areas .ask-card .title', '.areas .ask-card .icon', '.ev-scroll-row', '.rp-card', '.rp-body', '.rp-eyebrow', '.rp-title', '.rp-about', '.leash', '.seg button', '.leash-line']) spacing[s] = sp(s);
  const css = (s, p) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : null; };
  const top = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top + scrollY) : null; };
  const heads = [...document.querySelectorAll('.areas .sec-head')].map((h) => ({ name: h.querySelector('h2').textContent, top: Math.round(h.getBoundingClientRect().top + scrollY), above: Math.round(h.getBoundingClientRect().top - (h.parentElement.previousElementSibling ?? document.querySelector('.tiles')).getBoundingClientRect().bottom), h2: getComputedStyle(h.querySelector('h2')).fontSize }));
  const tiles = [...document.querySelectorAll('.tile')].map((t) => ({ name: t.querySelector('.name').textContent.trim(), n: +t.querySelector('.n').textContent, h: Math.round(t.getBoundingClientRect().height), nSize: getComputedStyle(t.querySelector('.n')).fontSize, nameSize: getComputedStyle(t.querySelector('.name')).fontSize }));
  return JSON.stringify({ glance: css('.glance', 'fontSize'), tiles, heads, provenCards: document.querySelectorAll('.i-evidence .ev-card').length, rpTitle: css('.rp-title', 'fontSize'), rpAbout: css('.rp-about', 'fontSize'), radius: css('.tile', 'borderRadius'), overflowX: document.documentElement.scrollWidth > innerWidth, under, spacing });
}`;
const frames = join(dir, 'frames');
let recorder;
try {
  const url = sh('bash', [join(here, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { cwd: repo, env: seedEnv }).trim().split('\n').pop();
  const so = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args], { env: seedEnv });
  // A second passed update, so Proven today counts two and Evidence must list the same two.
  writeFileSync(join(dir, 'ev2.json'), readFileSync(join(dir, 'evidence-run.json'), 'utf8').replace('The sign-in screen fits a phone', 'Settings page fits a phone'));
  so('post', join(dir, 'board.json'), '--kind', 'evidence', '--from', join(dir, 'ev2.json'));
  browser('open', url);
  browser('emulate', '--viewport', `${width}x${height}x1${width === 390 ? ',mobile,touch' : ''}`, '--color-scheme', theme);
  browser('open', url);
  settle();
  const name = `today.${side}.${theme}.${width}w`;
  browser('screenshot', join(out, `${name}.png`));
  const m = result(browser('eval', probe));
  // The same page in the other theme: the spacing must be the same numbers.
  const other = theme === 'light' ? 'dark' : 'light';
  browser('emulate', '--viewport', `${width}x${height}x1${width === 390 ? ',mobile,touch' : ''}`, '--color-scheme', other);
  browser('open', url); settle();
  const o = result(browser('eval', probe));
  const same = JSON.stringify(m.spacing) === JSON.stringify(o.spacing);
  browser('emulate', '--viewport', `${width}x${height}x1${width === 390 ? ',mobile,touch' : ''}`, '--color-scheme', theme);
  browser('open', `${url}#evidence`); settle();
  const evidenceCards = result(browser('eval', `() => JSON.stringify(document.querySelectorAll('.ev-card').length)`));
  const proven = m.tiles.find((t) => t.name === 'Proven today').n;
  const lines = [`glance text ${m.glance}`, `tiles ${m.tiles.map((t) => `${t.name} ${t.n} (count ${t.nSize}, label ${t.nameSize}, ${t.h}px tall)`).join('; ')}`, `tile corner radius ${m.radius}`,
    `section heads ${m.heads.map((h) => `${h.name} ${h.h2} with ${h.above}px above`).join('; ')}`, `report card title ${m.rpTitle}, about ${m.rpAbout}`,
    `Proven today tile ${proven}, cards in the Proven today row ${m.provenCards}, cards on Evidence ${evidenceCards}`,
    `spacing in ${theme} equals spacing in ${other}: ${same ? 'yes' : 'no'} (${Object.keys(m.spacing).length} elements)`,
    `controls under 44px ${m.under.length}${m.under.length ? ': ' + m.under.map((x) => `${x.text} ${x.w}x${x.h}`).join(', ') : ''}`, `horizontal overflow ${m.overflowX ? 1 : 0}`];
  writeFileSync(join(out, `${name}.txt`), `${side} ${theme} ${width}w today\n${lines.join('\n')}\n`);
  writeFileSync(join(out, `spacing.today.${side}.${theme}.${width}w.json`), JSON.stringify(m.spacing, null, 2) + '\n');
  if (side === 'after') assert.deepEqual([m.under.length, m.overflowX, same, proven === evidenceCards, proven], [0, false, true, true, 2], JSON.stringify(m));
  if (side === 'after' && theme === 'light' && width === 390) {
    // A sampled-frame recording through the same isolated browser: scroll Today down and back, swipe Proven today, tap the Need you tile.
    mkdirSync(frames, { recursive: true });
    browser('emulate', '--viewport', '390x844x1,mobile,touch', '--color-scheme', theme);
    browser('open', url); settle();
    const snap = (n) => browser('screenshot', join(frames, `${String(n).padStart(3, '0')}.png`));
    let n = 0;
    snap(n++);
    for (const y of [240, 560, 900, 1240, 1600, 900, 0]) { browser('eval', `() => { scrollTo(0, ${y}); return 1; }`); snap(n++); snap(n++); }
    browser('eval', `() => { document.querySelector('.ev-scroll-row').scrollIntoView({ block: 'center' }); document.querySelector('.ev-scroll-row').scrollTo({ left: 260, behavior: 'instant' }); return 1; }`); snap(n++); snap(n++);
    browser('eval', `() => { scrollTo(0, 0); document.querySelector('.tile').click(); return 1; }`); settle(); snap(n++); snap(n++);
    const list = readdirSync(frames).sort();
    writeFileSync(join(frames, 'frames.txt'), list.map((f) => `file '${join(frames, f)}'\nduration 0.6\n`).join(''));
    sh('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', join(frames, 'frames.txt'), '-vf', 'scale=390:-2', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', join(out, 'today-scroll.mp4')]);
  }
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board with a sign-in ask, asks, a plan, a report and two passed updates.',
    steps: [`Open Today at ${width} px in ${theme} mode.`, 'Measure the glance, the three tiles, the section heads, the report card and every control against 44px.', 'Open Evidence and count its cards against the Proven today tile.', `Read the same spacing numbers in ${other} mode.`],
    result: side === 'after' ? `At ${width} px in ${theme} mode Today uses the type scale (tile counts ${m.tiles[0].nSize}, section heads ${m.heads[0]?.h2}), every control is at least 44px, Proven today shows ${proven} and Evidence lists ${evidenceCards}, and the spacing is the same in ${other} mode.` : `At ${width} px in ${theme} mode Today is captured as it was for comparison.` }, null, 2) + '\n');
} finally {
  try { browser('stop'); } catch {}
  try { sh(process.execPath, [join(repo, 'dist/cli.js'), 'stop', join(dir, 'board.json')], { env: seedEnv }); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
