// Today on the board against the approved feel prototype, at one theme and width per run, so a run's steps.json holds one claim.
// The board is seeded by feel-board.sh with the prototype's own Today (a sign-in, three asks with a pick, a six-screen review, five updates, two new reports)
// and captured at the mock's size (390x844 or 1280x800, both 2x): the head with its date and ring, Up next, the tiles, Latest proof, New report and the tab bar or sidebar.
// Usage: node .agents/skills/done-done-verify-sign-off/today-shots.mjs <output> [light|dark] [390|1280]
// SIGN_OFF_REPO names another built checkout to drive, such as the base for a before (TODAY_SIDE=before names its files).
// TODAY_MOCK names the folder of the approved mock's shots (data/signoff-feel-v2/shots): each capture with a mock of the same state is then also saved
// side by side, the mock on the left and the board on the right, as vs-mock/<state>.<side>.<theme>.<width>w.png.
// Saves today.<side>.<theme>.<width>w.png/.txt (what each part says, the tab bar's place, controls under 44px, the Proof tile against Evidence, the thumbnails' fill,
// the closed Ask the agent, whether the spacing is identical in the other theme), today-end.* (the foot), at 390 today-scrolled.* (the small title in its bar),
// and spacing.today.<side>.<theme>.<width>w.json. A light 390 after run also records today-flow.light.390w.mp4 with decide-record.mjs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390);
const side = process.env.TODAY_SIDE ?? 'after', here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), mocks = process.env.TODAY_MOCK && resolve(process.env.TODAY_MOCK);
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-today-'));
const env = { ...process.env, SIGN_OFF_FILER: 'verify', CHROME_DEVTOOLS_AXI_SESSION: `so-today-${process.pid}` };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 180000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const browser = (...args) => sh('chrome-devtools-axi', args, { env });
const seedEnv = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
// The approved mock's sizes: an iPhone-sized phone and a laptop's window, both at 2x.
const height = width === 390 ? 844 : 800, viewport = (t) => browser('emulate', '--viewport', `${width}x${height}x2${width === 390 ? ',mobile,touch' : ''}`, '--color-scheme', t);
const settle = (ms = 800) => browser('eval', `() => new Promise((ok) => setTimeout(ok, ${ms}))`);
const result = (text) => { let m = JSON.parse(text.match(/result: (".*")/)[1]); while (typeof m === 'string') m = JSON.parse(m); return m; };
const probe = `() => {
  const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)], text = (s) => q(s)?.textContent.trim() ?? null;
  const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const box = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)]; };
  const under = qa('button, a[href], summary, select, input, textarea').filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { text: (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.h < 44 || x.w < 44);
  const sp = (s) => { const e = q(s); if (!e || !vis(e)) return null; const c = getComputedStyle(e); return [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft, c.marginTop, c.marginBottom, c.gap, c.fontSize, c.lineHeight, c.minHeight, c.borderRadius].join(' '); };
  const spacing = {}; for (const s of ['main', '.today-top', '.today-top h1', '.today-top .sub', '.ring', '.up-next', '.up-next h2', '.up-next .go', '.up-next .soft', '.tiles', '.tile', '.tile .n', '.tile .name', '.t-sec .sec-head', '.t-sec h2', '.t-list', '.lrow', '.mini', '.rp-card', '.tabs', '.tabs a', '.side a', '.leash', '.seg button']) spacing[s] = sp(s);
  // How much of each proof row's frame its capture paints, from its natural size and object-fit; a row with no capture shows its result's mark.
  const fill = (f) => { const i = f.querySelector('img'); if (!i?.naturalWidth) return 0; const c = getComputedStyle(i), a = f.getBoundingClientRect(), k = (c.objectFit === 'cover' ? Math.max : Math.min)(a.width / i.naturalWidth, a.height / i.naturalHeight);
    return Math.round(100 * Math.min(i.naturalWidth * k, a.width) * Math.min(i.naturalHeight * k, a.height) / (a.width * a.height)); };
  const tabs = q('.tabs'), bar = tabs && vis(tabs) ? tabs.getBoundingClientRect() : null, on = q('.tabs a[aria-current]'), pill = q('.tabs .hl');
  // A badge's count and which of red, green and blue its fill is strongest in, read from a painted pixel so any colour syntax compares.
  const hue = (c) => { const x = document.createElement('canvas').getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 1, 1); const p = [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); return ['red', 'green', 'blue'][p.indexOf(Math.max(...p))]; };
  const badge = (href) => { const b = [...qa('.tabs a[href="' + href + '"] .bd'), ...qa('.side a[href="' + href + '"] .n')].find(vis); return b ? b.textContent + ' ' + hue(getComputedStyle(b).backgroundColor) : 'none'; };
  const ask = q('details.ask:not([open])');
  return JSON.stringify({ date: text('.today-top .date-kicker'), title: text('.today-top h1'), ring: text('.ring b'), sub: text('.today-top .sub'),
    upNext: { line: text('.up-next .lk'), title: text('.up-next h2'), main: qa('.up-next .acts .go').map((e) => e.textContent.replace('↵', '').trim()), second: qa('.up-next .acts .soft').map((e) => e.textContent.trim()), box: q('.up-next') && box(q('.up-next')) },
    tiles: qa('.tile').map((t) => ({ name: t.querySelector('.name')?.firstChild.textContent, n: +t.querySelector('.n')?.textContent, line: t.querySelector('.name small')?.textContent ?? '', box: box(t) })),
    proof: qa('.t-proof .lrow').map((a) => ({ title: a.querySelector('b').textContent, line: a.querySelector('.lt > span').textContent, frame: a.querySelector('.mini') ? fill(a.querySelector('.mini')) : 'mark' })),
    proofHead: text('.t-proof h2'), report: q('.t-report .rp-card') && { head: text('.t-report h2'), eyebrow: text('.rp-card .ey'), title: text('.rp-card .h'), meta: text('.rp-card .m') },
    bar: bar && { left: Math.round(bar.left), right: Math.round(innerWidth - bar.right), bottom: Math.round(innerHeight - bar.bottom), height: Math.round(bar.height), on: on?.getAttribute('href'), pillOn: !!pill && !!on && Math.round(pill.getBoundingClientRect().left) === Math.round(on.getBoundingClientRect().left) },
    sidebar: !bar && qa('.side a').filter(vis).map((a) => a.textContent.trim()), badges: { decide: badge('#waiting'), reports: badge('#reports') },
    askClosed: ask ? Math.round(ask.getBoundingClientRect().height) : null, overflowX: document.documentElement.scrollWidth > innerWidth, under, spacing });
}`;
// The approved mock of each state, by the prototype's names.
const mockOf = (state, t) => mocks && join(mocks, width === 390 ? `${state}.${t}.390w.png` : `desk-${state}.${t}.1280w.png`);
// The mock on the left and the board on the right, at the same size, each under its name.
function sideBySide(state, t) {
  const mock = mockOf(state, t), board = join(out, `${state}.${side}.${t}.${width}w.png`);
  if (!mock || !existsSync(mock)) return null;
  mkdirSync(join(out, 'vs-mock'), { recursive: true });
  const file = join(out, 'vs-mock', `${state}.${side}.${t}.${width}w.png`), font = '/usr/share/fonts/liberation/LiberationSans-Bold.ttf', size = width === 390 ? 40 : 56;
  const label = (words) => `pad=iw+48:ih+${size * 3}:24:${size * 2}:color=0x8E8E93,drawtext=fontfile=${font}:text='${words}':fontsize=${size}:fontcolor=white:x=24:y=${Math.round(size / 2)}`;
  sh('ffmpeg', ['-y', '-v', 'error', '-i', mock, '-i', board, '-filter_complex', `[0]${label('Approved mock')}[a];[1]${label('Board')}[b];[a][b]hstack`, '-frames:v', '1', file]);
  return file;
}
let url;
try {
  url = sh('bash', [join(here, '.agents/skills/done-done-verify-sign-off/feel-board.sh'), dir], { cwd: repo, env: seedEnv }).trim().split('\n').pop();
  // The size and theme take hold on a page that is open, and the board is read again under them.
  browser('open', url);
  viewport(theme);
  browser('open', url);
  browser('eval', '() => { location.reload(); return 1; }');
  settle(1200);
  const name = `today.${side}.${theme}.${width}w`, pair = [];
  browser('screenshot', join(out, `${name}.png`));
  pair.push(sideBySide('today', theme));
  const m = result(browser('eval', probe));
  // On a phone, scrolled until the second row of tiles sits where the mock's does: the small title shows in its bar.
  let scrolled = null;
  if (width === 390) {
    // A page with no Sign in tile (the base) scrolls as far as the mock does.
    browser('eval', `() => { const t = document.querySelector('.tile.g-signin'); scrollTo(0, t ? t.getBoundingClientRect().top + scrollY - 115 : 337); return 1; }`);
    settle(500);
    scrolled = result(browser('eval', `() => { const b = document.querySelector('.cbar'); return JSON.stringify(b ? [getComputedStyle(b).opacity, b.textContent] : ['none', '']); }`));
    browser('screenshot', join(out, `today-scrolled.${side}.${theme}.${width}w.png`));
    pair.push(sideBySide('today-scrolled', theme));
  }
  // The foot: the tools the mock has no place for (search, the Leash, Ask the agent) sit under what it draws.
  browser('eval', '() => { scrollTo(0, document.documentElement.scrollHeight); return 1; }');
  settle(500);
  browser('screenshot', join(out, `today-end.${side}.${theme}.${width}w.png`));
  const endClear = result(browser('eval', `() => JSON.stringify(!document.querySelector('.tabs') || getComputedStyle(document.querySelector('.tabs')).display === 'none' || document.querySelector('#board').lastElementChild.getBoundingClientRect().bottom <= document.querySelector('.tabs').getBoundingClientRect().top)`));
  // The same page in the other theme: the spacing must be the same numbers.
  const other = theme === 'light' ? 'dark' : 'light';
  viewport(other);
  browser('open', url); settle();
  const o = result(browser('eval', probe));
  const same = JSON.stringify(m.spacing) === JSON.stringify(o.spacing);
  viewport(theme);
  // Evidence lists every update but a failed run; the Proof tile counts those and the failed runs, as its line says.
  browser('open', `${url}#evidence`); browser('eval', '() => { location.reload(); return 1; }'); settle(1200);
  const [evidenceCards, failed] = result(browser('eval', `() => fetch('api/decisions').then((r) => r.json()).then((s) => JSON.stringify([document.querySelectorAll('.ev-card').length, s.decisions.filter((d) => d.evidenceCard?.result === 'RUN FAIL').length]))`));
  browser('open', `${url}#waiting`); browser('eval', '() => { location.reload(); return 1; }'); settle(1200);
  const decideRows = result(browser('eval', `() => JSON.stringify(document.querySelectorAll('.dl-row').length)`));
  const proofTile = m.tiles.find((t) => t.name === 'Proof')?.n;
  const rows = m.tiles.length === 4 ? new Set(m.tiles.map((t) => t.box[1])).size : 0;
  const lines = [`date ${m.date}; title ${m.title}; ring ${m.ring}; ${m.sub}`,
    `Up next: ${m.upNext.line} / ${m.upNext.title} / main ${JSON.stringify(m.upNext.main)} / second ${JSON.stringify(m.upNext.second)}`,
    `tiles in ${rows} row(s): ${m.tiles.map((t) => `${t.name} ${t.n} "${t.line}" ${t.box[2]}x${t.box[3]}`).join('; ')}`,
    `${m.proofHead}: ${m.proof.map((p) => `${p.title} (${p.line}, capture paints ${p.frame === 'mark' ? 'none: result mark' : `${p.frame}% of its frame`})`).join('; ')}`,
    `${m.report?.head}: ${m.report?.eyebrow} / ${m.report?.title} / ${m.report?.meta}`,
    m.bar ? `tab bar ${m.bar.height}px tall, ${m.bar.left}px and ${m.bar.right}px from the sides, ${m.bar.bottom}px over the bottom; on ${m.bar.on || '#'}; pill on it ${m.bar.pillOn}` : `sidebar ${m.sidebar.join(' | ')}`,
    `badges: Decide ${m.badges.decide}; Reports ${m.badges.reports}; Decide lists ${decideRows}`,
    `Proof tile ${proofTile}: Evidence lists ${evidenceCards}, failed runs ${failed}`,
    scrolled ? `scrolled: small title "${scrolled[1]}" at opacity ${scrolled[0]}` : '', `the last thing on Today clears the tab bar: ${endClear}`,
    `spacing in ${theme} equals spacing in ${other}: ${same ? 'yes' : 'no'} (${Object.keys(m.spacing).length} elements)`, `Ask the agent closed: ${m.askClosed}px tall`,
    `controls under 44px ${m.under.length}${m.under.length ? ': ' + m.under.map((x) => `${x.text} ${x.w}x${x.h}`).join(', ') : ''}`, `horizontal overflow ${m.overflowX ? 1 : 0}`,
    ...pair.filter(Boolean).map((f) => `side by side: vs-mock/${f.split('/vs-mock/')[1]}`)].filter(Boolean);
  writeFileSync(join(out, `${name}.txt`), `${side} ${theme} ${width}w today\n${lines.join('\n')}\n`);
  writeFileSync(join(out, `spacing.today.${side}.${theme}.${width}w.json`), JSON.stringify(m.spacing, null, 2) + '\n');
  if (side === 'after') {
    // The prototype's Today, word for word where the board has the same data.
    assert.match(m.date, /^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+$/);
    assert.deepEqual([m.title, m.ring, m.sub], ['Today', '0/5', '5 waiting on you · 0 cleared']);
    assert.deepEqual([/^Up next · Sign in\d{1,2}:\d\d left$/.test(m.upNext.line), m.upNext.title, m.upNext.main, m.upNext.second], [true, 'Sign in to npm', ['Open sign-in'], ['Details']]);
    assert.deepEqual(m.tiles.map((t) => `${t.name} ${t.n} ${t.line}`), ['Answer 3 Each has a pick', 'Review 1 6 screens to check', 'Sign in 1 12 min left', 'Proof 5 1 failed, 4 fine']);
    assert.equal(rows, width === 390 ? 2 : 1);
    assert.deepEqual(m.proof.map((p) => [p.title, p.frame]), [['Settings page loads in a second', 100], ['Dark mode keeps every label readable', 100], ['Sign-in screen fits a phone', 100]]);
    assert.deepEqual([m.report?.head, m.report?.eyebrow, m.report?.title], ['New report', 'Before and after · Video 0:28', 'How the new sign-in works']);
    assert.deepEqual([m.badges.decide, m.badges.reports], ['5 red', '2 blue']);
    if (m.bar) assert.deepEqual(m.bar, { left: 16, right: 16, bottom: 12, height: 62, on: '#', pillOn: true });
    else assert.deepEqual(m.sidebar.map((s) => s.replace(/\d+$/, '')), ['Today', 'Decide', 'Evidence', 'Reports']);
    assert.deepEqual([decideRows, proofTile, evidenceCards + failed], [5, 5, 5]);
    if (scrolled) assert.deepEqual(scrolled, ['1', 'Today']);
    assert.deepEqual([endClear, m.under.length, m.overflowX, same, m.askClosed <= 48], [true, 0, false, true, true], JSON.stringify(m));
  }
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: "A throwaway board seeded by feel-board.sh with the approved prototype's Today: a sign-in with 12 minutes left, three asks with a pick, a six-screen review, five updates (one a failed run) and two new reports.",
    steps: [`Open Today at ${width}x${height} in ${theme} mode, the approved mock's size.`, 'Read the date, the ring, Up next, the four tiles, Latest proof, New report and the badges; measure the tab bar or sidebar, every control against 44px and the proof thumbnails.',
      ...(width === 390 ? ['Scroll until the second row of tiles is where the mock has it, and read the small title bar.'] : []), 'Scroll to the end.', 'Open Evidence and Decide and count their rows against the Proof tile and the Decide badge.', `Read the same spacing numbers in ${other} mode.`],
    result: side === 'after' ? `At ${width} px in ${theme} mode Today shows what the approved mock shows for the same board: ${m.date} over Today and the ${m.ring} ring, Up next "${m.upNext.title}" with one main action ${m.upNext.main[0]} beside ${m.upNext.second[0]}, the tiles Answer, Review, Sign in and Proof ${width === 390 ? 'two by two' : 'across'} with their counts, Latest proof as ${m.proof.length} rows each with its capture, and New report; ${m.bar ? 'the tab bar floats 12 px over the bottom with its pill on Today' : 'the sidebar marks Today'}, Decide carries a red 5 and Reports a blue 2, and the spacing is the same in ${other} mode.` : `At ${width} px in ${theme} mode Today is captured as it was for comparison.` }, null, 2) + '\n');
} finally {
  try { browser('stop'); } catch {}
  // The flow, recorded once (light, phone) in its own browser after the one above has stopped.
  try { if (url && side === 'after' && theme === 'light' && width === 390 && process.env.TODAY_RECORD !== '0') sh(process.execPath, [join(here, '.agents/skills/done-done-verify-sign-off/decide-record.mjs'), url, theme, join(out, 'today-flow.light.390w.mp4'), 'today'], { stdio: 'inherit' }); }
  finally {
    try { sh(process.execPath, [join(repo, 'dist/cli.js'), 'stop', join(dir, 'board.json')], { env: seedEnv }); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}
