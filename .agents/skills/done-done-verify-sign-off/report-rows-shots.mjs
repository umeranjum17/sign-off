// Report row and shared project tile journey, driven only through chrome-devtools-axi.
// REPORT_ROWS_SIDE=before SIGN_OFF_REPO=<base build> records the same frames without asserting the new contract.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const before = process.env.REPORT_ROWS_SIDE === 'before', dest = before ? join(out, 'before') : out;
mkdirSync(dest, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-report-rows-'));
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `report-rows-${process.pid}`, CHROME_DEVTOOLS_AXI_USER_DATA_DIR: join(dir, 'chrome') };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const so = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args], { env });
const axi = (...args) => sh('chrome-devtools-axi', args, { env: browserEnv });
const run = (script) => sh('chrome-devtools-axi', ['run'], { env: browserEnv, input: script });
const board = join(dir, 'board.json'), fx = (name) => JSON.parse(readFileSync(join(repo, 'fixtures/contract', name), 'utf8'));
const post = (kind, m, ...args) => { const path = join(dir, `${m.key}.json`); writeFileSync(path, JSON.stringify(m)); so('post', board, '--kind', kind, '--from', path, ...args); };
let server;
try {
  writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
  cpSync(join(repo, 'docs/logo.svg'), join(dir, 'project.svg'));
  cpSync(join(repo, 'fixtures/contract/design.v1/design'), join(dir, 'design'), { recursive: true });
  so('project', board, '--name', 'sign-off', '--icon', 'project.svg');
  so('ticket', board, '--id', 'T-29', '--title', 'Make report rows useful', '--project', 'sign-off', '--progress', '40');
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  post('report', { ...fx('report.v5/valid-full.json'), key: 'research', title: 'Which notification service fits a small team?', group: 'sign-off', ticket: 'T-29', filed: now });
  post('report', { ...fx('report.v4/valid-minimal.json'), key: 'retro', title: 'Why messages were sent twice: a retro', group: 'sign-off', filed: now });
  post('report', { ...fx('report.v4/valid-minimal.json'), key: 'read', title: 'Where the weekly digest stands', group: 'sign-off', ticket: 'T-29', filed: now });
  post('plan', { ...fx('plan.v3/valid-full.json'), key: 'plan', project: 'sign-off' }, '--ticket', 'T-29');
  post('design', { ...fx('design.v1/valid-basic.json'), group: 'sign-off', filed: now }, '--ticket', 'T-29');
  so('post', board, '--ask-ref', 'message-report-rows', '--key', 'ask', '--title', 'Ship the clearer report rows?', '--filer', 'sign-off', '--ticket', 'T-29', '--why', 'Umer wants to see the project and ticket.', '--outcome', 'yes=The rows ship.', '--outcome', 'no=The rows wait.', '--recommend', 'yes', '--recommend-reason', 'The links are visible.', '--default', 'no');
  cpSync(join(repo, 'docs/media/phone-light.webp'), join(dir, 'capture.webp'));
  so('post', board, '--type', 'evidence', '--title', 'The report fits a phone', '--about', 'Umer can read its kind and linked ticket.', '--media', join(dir, 'capture.webp'), '--ticket', 'T-29', '--link', 'https://github.com/umeranjum17/sign-off/pull/1');
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127.0.0.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', () => no(Error('server exited'))); });
  const mark = async (data) => { const r = await fetch(url + 'api/reads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }); assert.ok(r.ok); };
  await mark({ keys: ['read'], read: true });
  await mark({ key: 'research', part: 'question' });
  axi('open', url + '#reports');
  const measures = [];
  for (const width of [360, 390, 445, 1280, 1440]) for (const theme of ['light', 'dark']) {
    axi('emulate', '--viewport', `${width}x${width < 1024 ? 844 : 800}x1${width < 1024 ? ',mobile,touch' : ''}`);
    for (const area of ['reports', 'waiting', 'designs', 'evidence']) {
      run(`await page.open(${JSON.stringify(url + '#' + area)}); await page.eval(() => { localStorage.setItem('so-theme', '${theme}'); location.reload(); });`);
      sh('sleep', ['0.5']); axi('snapshot');
      const result = JSON.parse(run(`console.log(JSON.stringify(await page.eval(async () => {
        await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
        const rows = [...document.querySelectorAll('main .ui-row')], report = location.hash === '#reports';
        const data = rows.map(r => ({ title: r.querySelector('.t')?.textContent, kind: r.querySelector('.rkc')?.textContent, ticket: r.querySelector('.rp-ticket')?.textContent,
          icon: r.querySelector('.ui-icon img')?.getAttribute('src'), loaded: !!r.querySelector('.ui-icon img')?.naturalWidth, mono: !!r.querySelector('.mono'),
          progress: r.querySelector('.rp-progress')?.getAttribute('aria-valuenow') ?? null, progressGap: r.querySelector('.rp-progress') && r.querySelector('.rp-meta') ? r.querySelector('.rp-progress').getBoundingClientRect().top - r.querySelector('.rp-meta').getBoundingClientRect().bottom : null, oldBar: !!r.querySelector('.l2 .ui-bar, .l2 .rp-strip') }));
        const w = document.documentElement.clientWidth;
        return { url: location.href, width: innerWidth, rows: data, designCards: document.querySelectorAll('.dz-card').length, overflow: document.documentElement.scrollWidth > w,
          overflowing: [...document.querySelectorAll('main .ui-row *')].filter(e => e.getBoundingClientRect().right > w + 1).map(e => e.className),
          squashed_text: (() => { const ctx = document.createElement('canvas').getContext('2d'); const out = []; for (const e of document.querySelectorAll('body *')) { const nodes = [...e.childNodes].filter((n) => n.nodeType === 3 && n.data.trim()); const text = nodes.map((n) => n.data).join(' ').replace(/\\s+/g, ' ').trim(); const s = getComputedStyle(e); const w = e.offsetWidth; const h = e.offsetHeight; if (!(e instanceof HTMLElement) || !text || !e.getClientRects().length || ((w <= 1 || h <= 1) && s.overflow !== 'visible') || s.visibility !== 'visible') continue; ctx.font = s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily; const chars = w / (ctx.measureText('abcdefghijklmnopqrstuvwxyz').width / 26); const words = text.split(' ').length; const tops = new Set(); for (const n of nodes) { const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width) tops.add(Math.round(b.top)); } if ((chars < 8 && ctx.measureText(text).width > w + 1) || tops.size > words) out.push({ element: e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.classList[0] ? '.' + e.classList[0] : ''), text: text.slice(0, 40), chars: Math.round(chars * 10) / 10, lines: tops.size, words }); } return out; })() };
      })));`).trim());
      const name = `${area === 'waiting' ? 'decide' : area}.${theme}.${width}w`;
      axi('screenshot', join(dest, name + '.png'));
      result.console = axi('console', '--type', 'error'); const network = axi('network');
      result.console_errors = result.console.includes('<no console messages found>') ? [] : [result.console];
      result.failed_requests = network.split('\n').filter(l => /\[(?:[45]\d\d|failed)\]/i.test(l));
      writeFileSync(join(dest, name + '.dom.json'), JSON.stringify(result, null, 2)); measures.push(result);
      if (!before) {
        assert.deepEqual(result.console_errors, []); assert.deepEqual(result.failed_requests, []); assert.equal(result.overflow, false); assert.deepEqual(result.overflowing, []); assert.deepEqual(result.squashed_text.filter(x => /rp-ticket|rkc|ui-icon/.test(x.element)), []);
        assert.ok(result.rows.length || (area === 'designs' && width >= 1024 && result.designCards > 0)); assert.ok(result.rows.every(r => r.loaded && !r.mono), name + ': real project icons');
        if (area === 'reports') {
          assert.ok(result.rows.every(r => r.kind && r.ticket && !r.oldBar));
          assert.ok(result.rows.every(r => r.progressGap === null || r.progressGap >= 6), name + ': six pixels below metadata');
          assert.match(result.rows.find(r => r.title.includes('retro')).kind, /kind guessed/);
          assert.equal(result.rows.find(r => r.title.includes('weekly')).progress, null);
          assert.ok(result.rows.some(r => r.progress !== null));
        }
      }
    }
  }
  writeFileSync(join(dest, 'steps.json'), JSON.stringify({ commit: process.env.REPORT_ROWS_COMMIT ?? sh('git', ['rev-parse', 'HEAD'], { cwd: repo }).trim(), before, steps: 'Post reports, plan, ask, design and proof via CLI; pin project icon; link ticket; mark one report read and one part read; open four lists at 360, 390, 445, 1280 and 1440 in light and dark with chrome-devtools-axi.', result: `${measures.length} frames and DOM records; ${before ? 'baseline recorded' : 'shared icons, kind guessed, ticket metadata, unread-only progress and no overflow passed'}` }, null, 2));
  console.log(`${dest}: ${measures.length} frames recorded`);
} finally {
  try { axi('stop'); } catch {}
  if (server) { const exit = new Promise(ok => server.once('exit', ok)); try { so('stop', board); } catch {} await exit; }
  rmSync(dir, { recursive: true, force: true });
}
