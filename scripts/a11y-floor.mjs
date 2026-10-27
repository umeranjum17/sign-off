// Lighthouse accessibility floor on the real board: five routes x phone/desk x light/dark, on an isolated seeded board; never reads the owner's board.
// LIGHTHOUSE_CLI=/absolute/path/to/lighthouse/cli/index.js node scripts/a11y-floor.mjs OUT [route-theme-filter]   (RICH=1 adds a priority-and-progress fixture; COMMIT names the build when the folder is not a git checkout)
// Exits 1 when any screen's accessibility score is under the 95 floor; the slice target is 98.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? ''), only = process.argv[3], lighthouse = process.env.LIGHTHOUSE_CLI;
if (!process.argv[2]) throw new Error('Supply an evidence folder');
if (!lighthouse || !existsSync(lighthouse)) throw new Error('Set LIGHTHOUSE_CLI to a locally installed Lighthouse CLI');
if (existsSync(join(out, 'board'))) throw new Error('Use a new evidence folder to preserve previous measurements');
const boardDir = join(out, 'board'), board = join(boardDir, 'board.json');
mkdirSync(boardDir, { recursive: true }); mkdirSync(join(out, 'tmp'), { recursive: true });
const env = { ...process.env, PATH: `/usr/bin:${dirname(process.execPath)}:${process.env.PATH}` };
const isolated = { ...env, HOME: boardDir, XDG_CONFIG_HOME: join(boardDir, '.config'), XDG_DATA_HOME: join(boardDir, '.local/share'), XDG_STATE_HOME: join(boardDir, '.local/state'), XDG_CACHE_HOME: join(boardDir, '.cache') };
const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { cwd: repo, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (r.error || r.status !== 0) throw new Error(`${cmd}: ${r.error?.message ?? r.stderr ?? r.stdout} (exit ${r.status})`);
  return r.stdout;
};
const routes = [['today', ''], ['decide', '#waiting'], ['evidence', '#evidence'], ['reports', '#reports'], ['tickets', '#tickets']];
const summary = { commit: process.env.COMMIT ?? run('git', ['rev-parse', 'HEAD']).trim(), screens: {} };
try {
  const base = run('/bin/bash', ['.agents/skills/done-done-verify-sign-off/seed-board.sh', boardDir]).match(/http:\/\/127\.0\.0\.1:\d+\//g)?.at(-1);
  if (!base) throw new Error('Seed did not print a loopback URL');
  if (process.env.RICH) {
    const b = JSON.parse(readFileSync(board)), samples = [b.items[0], b.items[5], b.items[8], b.items[4]], projects = ['Beacon', 'Harbour', 'Atlas', 'Cedar'], now = Date.now();
    b.items = Array.from({ length: 60 }, (_, i) => ({ ...samples[i % 4], key: `perf-${i}`, title: `${samples[i % 4].title} · ${i + 1}`, filed: new Date(now - i * 1000).toISOString(), ticket: `T-${i + 1}`, project: projects[i % 4], priority: `P${i % 4}` }));
    writeFileSync(board, JSON.stringify(b));
    writeFileSync(board.replace('.json', '.tickets.jsonl'), Array.from({ length: 80 }, (_, i) => JSON.stringify({ id: `T-${i + 1}`, title: `Deliver Umer’s project milestone ${i + 1}`, progress: (i % 11) * 10, asked: i % 3 !== 0, project: projects[i % 4], priority: `P${i % 4}`, at: new Date(now).toISOString(), ...(i % 10 ? { parent: `T-${Math.floor(i / 10) * 10 + 1}` } : {}) })).join('\n') + '\n');
    await fetch(`${base}api/decisions`);
  }
  for (const [name, hash] of routes) for (const form of ['mobile', 'desktop']) for (const scheme of ['light', 'dark']) {
    const id = `${name}-${form}-${scheme}`;
    if (only && !id.includes(only)) continue;
    // Headless Chromium reads blink's preferredColorScheme as 0 = dark, 1 = light.
    const args = [lighthouse, `${base}${hash}`, `--chrome-flags=--headless --no-sandbox --blink-settings=preferredColorScheme=${scheme === 'dark' ? 0 : 1}`, '--only-categories=performance,accessibility,best-practices', '--output=json', `--output-path=${id}.json`, '--quiet', ...(form === 'desktop' ? ['--preset=desktop'] : [])];
    // A cold headless start sometimes paints nothing (NO_FCP); a second go is a fresh browser.
    for (let t = 1; ; t++) try { run(process.execPath, args, { cwd: out, env: { ...env, TMPDIR: 'tmp', CHROME_PATH: process.env.CHROME_PATH ?? '/usr/bin/chromium' } }); break; } catch (e) { if (t === 3) throw e; }
    const r = JSON.parse(readFileSync(join(out, `${id}.json`)));
    const failed = r.categories.accessibility.auditRefs.map((x) => r.audits[x.id]).filter((a) => a.score === 0).map((a) => ({ id: a.id, nodes: (a.details?.items ?? []).map((i) => i.node?.selector) }));
    summary.screens[id] = { P: Math.round(r.categories.performance.score * 100), A: Math.round(r.categories.accessibility.score * 100), BP: Math.round(r.categories['best-practices'].score * 100), failed, lighthouseVersion: r.lighthouseVersion };
    console.log(id, JSON.stringify({ ...summary.screens[id], failed: failed.map((f) => `${f.id}(${f.nodes.length})`) }));
  }
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  if (Object.values(summary.screens).some((s) => s.A < 95)) process.exitCode = 1;
} finally {
  // The CLI owns its server lifecycle; never kill a PID found by name.
  if (existsSync(board)) run(process.execPath, ['dist/cli.js', 'stop', board], { env: isolated });
}
