// Profile the real board with synthetic data; never read the owner's board.
// LIGHTHOUSE_CLI=/absolute/path/to/lighthouse/cli/index.js node scripts/profile-board.mjs OUT
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT ?? '');
const lighthouse = process.env.LIGHTHOUSE_CLI;
if (!process.argv[2] && !process.env.DONE_DONE_EVIDENCE_ROOT) throw new Error('Supply an evidence folder');
if (!lighthouse || !existsSync(lighthouse)) throw new Error('Set LIGHTHOUSE_CLI to a locally installed Lighthouse CLI');
if (existsSync(join(out, 'board'))) throw new Error('Use a new evidence folder to preserve previous measurements');
const boardDir = join(out, 'board'), tmp = join(out, 'tmp'), board = join(boardDir, 'board.json');
mkdirSync(boardDir, { recursive: true });
mkdirSync(tmp, { recursive: true });
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, TMPDIR: tmp };
const isolated = { ...env, HOME: boardDir, XDG_CONFIG_HOME: join(boardDir, '.config'), XDG_DATA_HOME: join(boardDir, '.local/share'), XDG_STATE_HOME: join(boardDir, '.local/state'), XDG_CACHE_HOME: join(boardDir, '.cache') };
const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { cwd: repo, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (r.error || r.status !== 0) throw new Error(`${cmd}: ${r.error?.message ?? r.stderr ?? r.stdout} (exit ${r.status})`);
  return r.stdout;
};
const version = JSON.parse(readFileSync(join(repo, 'package.json'))).version;
const commit = run('git', ['rev-parse', 'HEAD']).trim();
try {
  const seed = run('/bin/bash', ['.agents/skills/done-done-verify-sign-off/seed-board.sh', boardDir]);
  writeFileSync(join(out, 'seed.log'), seed);
  const base = seed.match(/http:\/\/127\.0\.0\.1:\d+\//g)?.at(-1);
  if (!base) throw new Error('Seed did not print a loopback URL');
  const b = JSON.parse(readFileSync(board));
  const samples = [b.items[0], b.items[5], b.items[8], b.items[4]];
  const projects = ['Beacon', 'Harbour', 'Atlas', 'Cedar'];
  const now = Date.now();
  b.items = Array.from({ length: 500 }, (_, i) => ({ ...samples[i % 4], key: `perf-${i}`, title: `${samples[i % 4].title} · ${i + 1}`, filed: new Date(now - i * 1000).toISOString(), ticket: `T-${i + 1}`, project: projects[i % 4], priority: `P${i % 4}` }));
  writeFileSync(board, JSON.stringify(b));
  const tickets = Array.from({ length: 3000 }, (_, i) => ({ id: `T-${i + 1}`, title: `Deliver Umer’s project milestone ${i + 1}`, progress: (i % 11) * 10, asked: i % 3 !== 0, project: projects[i % 4], priority: `P${i % 4}`, at: new Date(now).toISOString(), ...(i % 10 ? { parent: `T-${Math.floor(i / 10) * 10 + 1}` } : {}) }));
  writeFileSync(board.replace('.json', '.tickets.jsonl'), tickets.map((t) => JSON.stringify(t)).join('\n') + '\n');
  const response = await fetch(`${base}api/decisions`, { headers: { 'accept-encoding': 'identity' } });
  if (!response.ok) throw new Error(`Board API: HTTP ${response.status}`);
  const state = await response.json();
  if (state.decisions.length !== 500 || state.tickets.length !== 3000) throw new Error('Fixture counts differ from the profiling contract');
  const summary = { commit, version, fixture: { cards: 500, tickets: 3000, roots: 300, note: 'Synthetic repeated CLI-authored cards; shared media; not a copy of the live board.' }, payloadBytes: Buffer.byteLength(JSON.stringify(state)), fields: Object.fromEntries(Object.entries(state).map(([k, v]) => [k, Buffer.byteLength(JSON.stringify(v))])), screens: {} };
  for (const [name, hash] of [['today', ''], ['decide', '#waiting'], ['evidence', '#evidence'], ['reports', '#reports'], ['tickets', '#tickets']]) {
    // Relative TMPDIR avoids Chrome's Unix socket path limit while staying under OUT/tmp.
    run(process.execPath, [resolve(lighthouse), `${base}${hash}`, '--chrome-flags=--headless --no-sandbox', '--only-categories=performance,accessibility,best-practices', '--output=json', '--output=html', `--output-path=${name}-mobile`, '--quiet'], { cwd: out, env: { ...env, TMPDIR: 'tmp', CHROME_PATH: process.env.CHROME_PATH ?? '/usr/bin/chromium' } });
    const r = JSON.parse(readFileSync(join(out, `${name}-mobile.report.json`)));
    if (r.runtimeError || !r.categories.performance) throw new Error(`Incomplete Lighthouse report: ${name}`);
    const metrics = Object.fromEntries(['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index', 'total-byte-weight', 'mainthread-work-breakdown', 'bootup-time'].map((k) => [k, r.audits[k].numericValue]));
    summary.screens[name] = { scores: Object.fromEntries(Object.entries(r.categories).map(([k, v]) => [k, Math.round(v.score * 100)])), metrics, lighthouseVersion: r.lighthouseVersion, settings: r.configSettings, warnings: r.runWarnings, failedAudits: Object.values(r.audits).filter((a) => a.score === 0).map((a) => a.id) };
    const shot = r.audits['final-screenshot'].details.data.split(',')[1];
    writeFileSync(join(out, `${name}-lighthouse.jpg`), Buffer.from(shot, 'base64'));
    console.log(`${name}: ${JSON.stringify(summary.screens[name].scores)}`);
  }
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version, commit }, start: 'Isolated board, 500 synthetic cards and 3000 tickets', steps: ['Open Today', 'Open Decide', 'Open Evidence', 'Open Reports', 'Open Tickets', 'Audit each cold navigation with Lighthouse mobile simulated Slow 4G and 4x CPU'], result: 'Five HTML/JSON reports, final screen frames and payload measurements; no PWA installation or offline claim' }, null, 2));
} finally {
  // The CLI owns its server lifecycle; never kill a PID found by name.
  if (existsSync(board)) run(process.execPath, ['dist/cli.js', 'stop', board], { env: isolated });
}
