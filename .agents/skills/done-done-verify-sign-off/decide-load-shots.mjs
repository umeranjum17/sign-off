// Verify the large Decide list with chrome-devtools-axi. BASE must be a task-owned loopback board.
// node decide-load-shots.mjs BASE OUT before|after
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const [base, folder, side] = process.argv.slice(2), out = resolve(folder);
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || !['before', 'after'].includes(side)) throw new Error('Supply an isolated loopback board and before|after');
mkdirSync(out, { recursive: true });
mkdirSync(join(out, 'tmp'), { recursive: true });
const env = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `signoff-decide-load-${side}`, TMPDIR: join(out, 'tmp') };
const log = [];
const ax = (...args) => { const s = execFileSync('chrome-devtools-axi', args, { env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }); log.push({ args, output: s }); return s; };
try {
  ax('start');
  ax('open', `${base}#waiting`);
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
    ax('emulate', '--viewport', `${width}x${width === 390 ? 844 : 800}x1`, '--color-scheme', theme);
    ax('eval', `() => { localStorage.setItem('so-theme', '${theme}'); location.reload(); }`);
    ax('eval', `async () => { await document.fonts.ready; await new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok))); return document.querySelector('.decide-list') !== null; }`);
    const tag = `${side}-${width}-${theme}`;
    ax('eval', `() => ({rows:document.querySelectorAll('.decide-list .dl-row').length,dom:document.querySelectorAll('*').length,total:document.querySelector('.decide-list .ui-hero .big')?.textContent,more:!!document.getElementById('decide-more-now')})`);
    ax('screenshot', join(out, `${tag}-list.png`));
    if (width === 390 && side === 'after') {
      ax('eval', `() => document.getElementById('decide-more-now').scrollIntoView({block:'center'})`);
      ax('screenshot', join(out, `${tag}-more.png`));
      ax('eval', `() => { document.getElementById('decide-more-now').click(); return {rows:document.querySelectorAll('.decide-list .dl-row').length,focus:document.activeElement.id}; }`);
      ax('screenshot', join(out, `${tag}-loaded.png`));
    }
  }
} finally { ax('stop'); writeFileSync(join(out, `${side}-drive.json`), JSON.stringify(log, null, 2)); }
if (side === 'after') {
  execFileSync(process.execPath, [fileURLToPath(new URL('./decide-record.mjs', import.meta.url)), base, 'light', join(out, 'show-more.mp4'), 'load'], { cwd: out, env: { ...process.env, TMPDIR: 'tmp' }, stdio: 'inherit' });
}
writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: 'sign-off checkout' }, start: 'Task-owned 500-card/3000-ticket board', steps: ['Open Decide in light and dark at phone and desk widths', ...(side === 'after' ? ['Scroll to Show more', 'Load the next batch', 'Open and close a newly loaded ask'] : [])], result: `${side} large-list frames and row counts; no installability claim` }, null, 2));
