// Public CLI -> persisted ticket -> real board, driven with chrome-devtools-axi.
// Usage: node ticket-fields-shots.mjs <evidence folder> [before|after]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2]), side = process.argv[3] ?? 'after';
mkdirSync(out, { recursive: true });
const dir = mkdtempSync('/tmp/signoff-ticket-fields-'), board = join(dir, 'board.json');
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir, XDG_STATE_HOME: dir, XDG_CACHE_HOME: dir };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `ticket-fields-${process.pid}` };
const cli = (...a) => execFileSync(process.execPath, ['dist/cli.js', ...a], { env, encoding: 'utf8' });
const browser = (...a) => execFileSync('chrome-devtools-axi', a, { env: browserEnv, encoding: 'utf8', timeout: 60000 });
try {
  const seed = execFileSync('bash', ['.agents/skills/done-done-verify-sign-off/seed-board.sh', dir], { env, encoding: 'utf8' });
  const base = seed.match(/http:\/\/127\.0\.0\.1:\d+\//g).at(-1);
  cli('ticket', board, '--id', 'release', '--title', 'Ship the owner board sync', '--project', 'Sign-off', '--priority', 'P1', '--progress', '40', '--asked', 'yes');
  if (side === 'after') cli('ticket', board, '--id', 'release', '--release', '0.6.1', '--state', 'in progress', '--pr', 'https://github.com/umeranjum17/sign-off/pull/1,https://github.com/umeranjum17/sign-off/pull/2');
  for (const [id, title, args] of [['queue', 'Sync queued work', ['--state', 'queued']], ['hold', 'Review the sync with Umer', ['--state', 'on hold', '--hold-reason', 'waiting on the review call']], ['done', 'Read fleet backlogs', ['--state', 'done']]]) {
    cli('ticket', board, '--id', id, '--title', title, '--asked', 'yes', ...(side === 'after' ? args : []));
  }
  writeFileSync(join(out, 'cli.json'), cli('ticket', board, '--json'));
  writeFileSync(join(out, 'records.jsonl'), readFileSync(join(dir, 'board.tickets.jsonl')));
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
    browser('open', `${base}#ticket/release`);
    browser('resize', String(width), width === 390 ? '844' : '800');
    browser('eval', `() => { localStorage.setItem('so-theme', '${theme}'); location.reload(); }`);
    browser('wait', 'Ship the owner board sync');
    const facts = browser('eval', `() => { const pane = document.querySelector('.tk-sheet, .tk-pane'); return { release: pane.querySelector('.tk-release')?.textContent, prs: [...pane.querySelectorAll('.tk-in a[target]')].map(a => a.href), overflow: document.documentElement.scrollWidth > innerWidth, text: pane.innerText }; }`);
    writeFileSync(join(out, `ticket.${theme}.${width}.txt`), facts);
    const measured = JSON.parse(JSON.parse(facts.split('\n')[0].slice('result: '.length)));
    assert.equal(measured.overflow, false, 'no sideways overflow');
    writeFileSync(join(out, `ticket.${theme}.${width}.dom.json`), JSON.stringify(measured, null, 2));
    if (side === 'after') { assert.ok(facts.includes('0.6.1')); assert.ok(facts.includes('https://github.com/umeranjum17/sign-off/pull/2')); }
    browser('screenshot', join(out, `ticket.${theme}.${width}.png`));
    writeFileSync(join(out, `console.${theme}.${width}.txt`), browser('console', '--type', 'error'));
  }
} finally {
  try { browser('stop'); } finally { try { cli('stop', board); } finally { rmSync(dir, { recursive: true, force: true }); } }
}
