// The Decide tab polish (filters on one line, plan card, sign-in Open, answer bar), one part, theme and width per run so a run's steps.json holds one claim.
// Usage: node .agents/skills/done-done-verify-sign-off/decide-shots.mjs <output> <filters|plan|signin|answer> [light|dark] [390|1280]
// SIGN_OFF_REPO names another built checkout to drive, such as the base for a before (DECIDE_SIDE=before names its files).
// Saves <part>.<side>.<theme>.<width>w.png and .txt (the part's numbers: control sizes, one-line check, controls under 44px) and spacing.<part>.<side>.<theme>.<width>w.json,
// the padding, margin, gap and height of the part's elements, which must match between light and dark.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), part = process.argv[3] ?? 'filters', theme = process.argv[4] ?? 'light', width = +(process.argv[5] ?? 390);
const side = process.env.DECIDE_SIDE ?? 'after', here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
assert.ok(['filters', 'plan', 'signin', 'answer'].includes(part), `part ${part}`);
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-decide-'));
const env = { ...process.env, SIGN_OFF_FILER: 'verify', CHROME_DEVTOOLS_AXI_SESSION: `so-decide-${process.pid}` };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const browser = (...args) => sh('chrome-devtools-axi', args, { env });
const seedEnv = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
// What each part measures: the page it lives on, the part's box, and the controls inside it.
const PARTS = {
  filters: { page: '#waiting', box: '.filters', controls: '.filters button, .filters select' },
  plan: { page: '#waiting', box: '.plan-hero', controls: '.plan-hero a, .plan-hero button' },
  signin: { page: '#decide/npm', box: '.signin', controls: '.signin .open-link' },
  answer: { page: '#waiting', box: '.decide-bar', controls: '.decide-bar button, .decide-bar a' },
};
const { box, controls } = PARTS[part];
const probe = `() => {
  const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const round = (n) => Math.round(n * 10) / 10;
  const under = [...document.querySelectorAll('button, a[href], summary, select, input, textarea')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { text: (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.h < 44 || x.w < 44);
  const root = document.querySelector(${JSON.stringify(box)});
  if (root) root.scrollIntoView({ block: 'center' });
  // A control may draw a smaller pill than its tap box: the pill is the control's own ::before when it has one.
  const ctl = [...document.querySelectorAll(${JSON.stringify(controls)})].filter(vis).map((e) => { const r = e.getBoundingClientRect(), b = getComputedStyle(e, '::before'), pill = b.content !== 'none' && b.position === 'absolute' ? parseFloat(b.height) : null;
    return { text: (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 28), top: round(r.top), w: round(r.width), h: round(r.height), pill: pill && round(pill), font: getComputedStyle(e).fontSize }; });
  const sp = (e) => { const c = getComputedStyle(e), r = e.getBoundingClientRect(); return [e.tagName.toLowerCase() + (e.classList[0] ? '.' + e.classList[0] : ''), c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft, c.marginTop, c.marginBottom, c.gap, c.fontSize, round(r.height)].join(' '); };
  const spacing = root ? [root, ...root.querySelectorAll('*')].filter(vis).filter((e) => e.matches('button, a, select, label, h2, p, div, span.eyebrow')).slice(0, 24).map(sp) : [];
  const chips = [...document.querySelectorAll('.chips button')].filter(vis).map((e) => Math.round(e.getBoundingClientRect().top)), sort = document.querySelector('.sort select');
  const rects = root ? root.getBoundingClientRect() : null, ch = document.querySelector('.chips');
  return JSON.stringify({ found: !!root, box: rects && { top: round(rects.top), h: round(rects.height), w: round(rects.width) }, ctl, under, spacing, overflowX: document.documentElement.scrollWidth > innerWidth,
    oneLine: chips.length ? new Set(chips).size === 1 && (!sort || Math.abs(sort.getBoundingClientRect().top - chips[0]) < 12) : null, chipRow: ch && { scrolls: ch.scrollWidth > ch.clientWidth, scrollW: ch.scrollWidth, clientW: ch.clientWidth },
    pageFilters: document.querySelectorAll('.decide-lists .filters').length, decideBar: !!document.querySelector('.decide-bar') });
}`;
let m;
try {
  const url = sh('bash', [join(here, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { cwd: repo, env: seedEnv }).trim().split('\n').pop();
  browser('open', url);
  browser('emulate', '--viewport', `${width}x844x1${width === 390 ? ',mobile,touch' : ''}`, '--color-scheme', theme);
  const wait = () => browser('eval', '() => new Promise((ok) => setTimeout(ok, 700))');
  let page = PARTS[part].page;
  if (part === 'answer') {
    // The yes or no ask: found by its title, so the page does not depend on a generated key.
    browser('open', `${url}#waiting`); wait();
    const href = browser('eval', `() => [...document.querySelectorAll('.ask-card')].find((a) => /weekly digest/i.test(a.textContent))?.getAttribute('href')`).match(/result: (".*")/)[1];
    let h = JSON.parse(href); while (typeof h === 'string' && /^"/.test(h)) h = JSON.parse(h);
    assert.match(h, /^#decide\//, h);
    page = h;
  }
  browser('open', `${url}${page}`); wait();
  m = JSON.parse(browser('eval', probe).match(/result: (".*")/)[1]); while (typeof m === 'string') m = JSON.parse(m);
  browser('eval', '() => new Promise((ok) => setTimeout(ok, 300))');
  const name = `${part}.${side}.${theme}.${width}w`;
  browser('screenshot', join(out, `${name}.png`));
  assert.ok(m.found, `${part}: ${box} not on the page`);
  const row = (c) => `${c.text} ${c.w}x${c.h}px${c.pill ? ` (drawn ${c.pill}px)` : ''} at ${c.font}`;
  const lines = [`${part} on ${page} (${box})`, `part box ${m.box.w}x${m.box.h}px`, `controls ${m.ctl.length}: ${m.ctl.map(row).join('; ')}`,
    ...(part === 'filters' ? [`chips and sort on one line ${m.oneLine}`, `chip row scrolls sideways ${m.chipRow?.scrolls} (${m.chipRow?.scrollW}px of ${m.chipRow?.clientW}px)`] : []),
    ...(part === 'answer' ? [`filters repeated under the ask ${m.pageFilters}`] : []),
    `controls under 44px on the page ${m.under.length}${m.under.length ? ': ' + m.under.map((x) => `${x.text} ${x.w}x${x.h}`).join(', ') : ''}`, `horizontal overflow ${m.overflowX ? 1 : 0}`];
  writeFileSync(join(out, `${name}.txt`), `${side} ${theme} ${width}w ${part}\n${lines.join('\n')}\n`);
  writeFileSync(join(out, `spacing.${part}.${side}.${theme}.${width}w.json`), JSON.stringify(m.spacing, null, 2) + '\n');
  if (side === 'after') assert.deepEqual([m.under.length, m.overflowX], [0, false], JSON.stringify(m.under));
  const claim = {
    filters: width === 390 ? 'the type chips sit on one scrolling line with the sort beside them, and every chip and the sort are at least 44px tall' : 'the type chips and the sort sit on one line, every control at least 44px tall',
    plan: 'the plan card holds its title, two lines of its summary, its meta and an Open plan button, every control at least 44px tall',
    signin: 'the sign-in card shows one Open button, at least 44px tall',
    answer: 'the Answer bar holds Answer, Later and Skip at least 44px tall, with no filter row repeated under the ask',
  }[part];
  const how = { filters: 'the Waiting tab', plan: 'the Waiting tab, scrolled to the plan card', signin: 'the sign-in ask in Decide', answer: 'the yes or no ask in Decide, scrolled to its answer bar' }[part];
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board with a sign-in ask, asks, a plan, a report and an update.',
    steps: [`Open the board at ${width} px in ${theme} mode on ${how}.`, 'Measure the part: each control against 44px, and whether the filter chips and the sort share one line.'],
    result: side === 'after' ? `At ${width} px in ${theme} mode on ${how}, ${claim}.` : `At ${width} px in ${theme} mode ${how} is captured as it was for comparison.` }, null, 2) + '\n');
} finally {
  try { browser('stop'); } catch {}
  try { sh(process.execPath, [join(repo, 'dist/cli.js'), 'stop', join(dir, 'board.json')], { env: seedEnv }); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
