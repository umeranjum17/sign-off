// The Evidence screen slice, one theme and width per run so a run's steps.json holds one claim.
// Usage: node .agents/skills/done-done-verify-sign-off/evidence-shots.mjs <output> [light|dark] [390|1280]
// SIGN_OFF_REPO names another built checkout to drive; EVIDENCE_SIDE=before names its files (before/after of a change).
// Saves evidence.<side>.<theme>.<width>w.png and evidence.<side>.<theme>.<width>w.txt: the project label, card spacing, where Select and Clear all sit and every control under 44px.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390);
const side = process.env.EVIDENCE_SIDE ?? 'after', here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-evidence-'));
const env = { ...process.env, SIGN_OFF_FILER: 'verify', CHROME_DEVTOOLS_AXI_SESSION: `so-evidence-${process.pid}` };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const browser = (...args) => sh('chrome-devtools-axi', args, { env });
const seedEnv = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const probe = `() => {
  const q = (s) => document.querySelector(s), box = (e) => { const b = e.getBoundingClientRect(); return { top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const vis = (e) => { const b = e.getBoundingClientRect(), c = getComputedStyle(e); return b.width > 0 && b.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const cs = (s, p) => { const e = q(s); return e && getComputedStyle(e)[p]; };
  const under = [...document.querySelectorAll('button, a[href], summary, select, input, textarea')].filter(vis).map((e) => ({ text: (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24), ...box(e) })).filter((x) => x.h < 44);
  const bulk = [...document.querySelectorAll('.top > .bulk button')].map((b) => ({ text: b.textContent, ...box(b) })), h1 = box(q('#board h1')), g = q('.ev-group h2');
  return JSON.stringify({ label: g && { text: g.textContent, size: getComputedStyle(g).fontSize, weight: getComputedStyle(g).fontWeight, transform: getComputedStyle(g).textTransform },
    bulk, h1Top: h1.top, bulkAboveTitle: bulk.length > 0 && bulk.every((b) => b.top + b.h <= h1.top + 4),
    spacing: { cardGap: cs('.ev-group .ev-card', 'rowGap'), cardsGap: cs('.ev-grid', 'rowGap'), groupTop: cs('.ev-group', 'marginTop'), mediaRadius: cs('.ev-group .ev-media', 'borderRadius'), thumb: q('.ev-group .ev-media') && box(q('.ev-group .ev-media')), waiting: /Waiting on you/i.test(q('#board').innerText), cards: document.querySelectorAll('.ev-grid > *').length },
    tabs: [...document.querySelectorAll('.tabs a')].map((a) => a.textContent.trim().replace(/\\d+$/, '')), under, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth });
}`;
const parse = (s) => { let m = JSON.parse(s.match(/result: (".*")/)[1]); while (typeof m === 'string' && /^["{\[]/.test(m)) m = JSON.parse(m); return m; };
let base;
try {
  base = sh('bash', [join(here, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { cwd: repo, env: seedEnv }).trim().split('\n').pop();
  browser('open', base);
  browser('emulate', '--viewport', `${width}x844x1${width === 390 ? ',mobile,touch' : ''}`, '--color-scheme', theme);
  browser('open', `${base}#evidence`); browser('eval', '() => new Promise((ok) => setTimeout(ok, 800))');
  const name = `evidence.${side}.${theme}.${width}w`;
  browser('screenshot', join(out, `${name}.png`));
  const m = parse(browser('eval', probe));
  writeFileSync(join(out, `${name}.txt`), [`${side} ${theme} ${width}w Evidence`, `project label ${m.label?.text} ${m.label?.size} weight ${m.label?.weight} ${m.label?.transform}`,
    `Select and Clear all ${m.bulk.map((b) => `${b.text} button ${b.w}px wide, ${b.h}px tall, top edge ${b.top}px from the page top`).join('; ')}; the large title's top edge is ${m.h1Top}px from the page top, so the buttons sit above the title: ${m.bulkAboveTitle ? 'yes' : 'no'}`,
    `card gap ${m.spacing.cardGap}, between cards ${m.spacing.cardsGap}, group top ${m.spacing.groupTop}, preview ${m.spacing.thumb.w}x${m.spacing.thumb.h} (3:4), preview corner ${m.spacing.mediaRadius}, cards ${m.spacing.cards}`, `the words Waiting on you appear on the screen: ${m.spacing.waiting ? 'yes' : 'no'}`,
    `tab bar ${m.tabs.join(' | ')}`, `controls under 44px ${m.under.length}${m.under.length ? ': ' + m.under.map((x) => `${x.text} ${x.w}x${x.h}`).join(', ') : ''}`, `horizontal overflow ${m.overflowX ? 1 : 0}`].join('\n') + '\n');
  if (side === 'after') assert.deepEqual([m.under.length, m.overflowX, m.bulkAboveTitle, m.label?.size, m.spacing.thumb.w, m.spacing.thumb.h, m.spacing.waiting], [0, false, true, '12px', 72, 96, false], JSON.stringify(m));
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board with a sign-in ask, asks, a plan, a report and a passed update.',
    steps: [`Open the board at ${width} px in ${theme} mode on the Evidence tab.`, 'Read the project label, the preview size, the spacing and where Select and Clear all sit, and measure every control against 44px.'],
    result: side === 'after' ? `At ${width} px ${width === 390 ? 'on a phone ' : ''}in ${theme} mode Evidence shows Select and Clear all at the top right above the large Evidence title, each 44px tall, then a small uppercase project label over the update's row, which starts with a 3:4 preview of the capture 72px wide and 96px tall, with no 'Waiting on you' text, with no control under 44px and no sideways overflow.` : `At ${width} px in ${theme} mode Evidence is captured as it was for comparison, with Select and Clear all in a row under the title and a large project heading.` }, null, 2) + '\n');
} finally {
  try { browser('stop'); } catch {}
  try { sh(process.execPath, [join(repo, 'dist/cli.js'), 'stop', join(dir, 'board.json')], { env: seedEnv }); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
