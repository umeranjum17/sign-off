// CLI-authored sync facts, read through the state API and the real Tickets UI.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2]);
mkdirSync(out, { recursive: true });
const dir = mkdtempSync('/tmp/so-stage-'), board = join(dir, 'board.json');
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir, XDG_STATE_HOME: dir, XDG_CACHE_HOME: dir };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `stage-${process.pid}` };
const cli = (...a) => execFileSync(process.execPath, ['dist/cli.js', ...a], { env, encoding: 'utf8' });
const browser = (...a) => execFileSync('chrome-devtools-axi', a, { env: browserEnv, encoding: 'utf8', timeout: 60000 });
const evaluate = (code) => JSON.parse(JSON.parse(browser('eval', code).split('\n')[0].slice('result: '.length)));
const now = Math.floor(Date.now() / 1000), stages = ['queued', 'building', 'review', 'merging', 'done'];
const titles = ['Sync queued work', 'Build the owner board', 'Review the ticket sync', 'Merge the approved sync', 'Finish the release notes'];
try {
  const seed = execFileSync('bash', ['.agents/skills/done-done-verify-sign-off/seed-board.sh', dir], { env, encoding: 'utf8' });
  const base = seed.match(/http:\/\/127\.0\.0\.1:\d+\//g).at(-1);
  for (const [i, stage] of stages.entries()) cli('ticket', board, '--id', stage, '--title', titles[i], '--progress', '17', '--state', 'in progress', '--stage', stage,
    ...(stage === 'building' ? [] : ['--last-event-at', String(now - (stage === 'review' ? 3600 : stage === 'merging' ? 49 * 3600 : 7 * 3600))]));
  const state = await (await fetch(`${base}api/state`)).json();
  assert.equal(state.tickets.find(t => t.id === 'queued').last_event_at, now - 7 * 3600);
  assert.deepEqual(state.tickets.map(t => t.stage), stages);
  writeFileSync(join(out, 'state.json'), JSON.stringify(state.tickets, null, 2));
  writeFileSync(join(out, 'cli.json'), cli('ticket', board, '--json'));
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
    browser('open', `${base}#tickets`);
    browser('resize', String(width), width === 390 ? '844' : '800');
    browser('eval', `() => { localStorage.setItem('so-theme', '${theme}'); location.reload(); }`);
    browser('wait', 'Tickets');
    browser('eval', `() => { for (const b of document.querySelectorAll('main section .see')) if (b.textContent.includes('See all')) b.click(); }`);
    browser('wait', titles[0]);
    const facts = evaluate(`() => ({ stages: [...document.querySelectorAll('.tk-row .tk-stage')].map(e => e.textContent), stuck: [...document.querySelectorAll('.tk-row .tk-stuck')].map(e => e.textContent), overflow: document.documentElement.scrollWidth > innerWidth, monograms: document.querySelectorAll('.mono').length, scroll_containers: [...document.querySelectorAll('body *')].filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight).length })`);
    assert.deepEqual([...facts.stages].sort(), [...stages].sort());
    assert.deepEqual(facts.stuck.sort(), ['stuck 2d', 'stuck 7h']);
    assert.equal(facts.overflow, false); assert.equal(facts.monograms, 0);
    writeFileSync(join(out, `tickets.${theme}.${width}.dom.json`), JSON.stringify(facts, null, 2));
    browser('screenshot', join(out, `tickets.${theme}.${width}.png`));
    for (const stage of stages) {
      browser('open', `${base}#ticket/${stage}`); browser('wait', titles[stages.indexOf(stage)]);
      const page = evaluate(`() => { const p = document.querySelector('.tk-sheet, .tk-pane'); return { stage: p.querySelector('.tk-stage')?.textContent, stuck: p.querySelector('.tk-stuck')?.textContent ?? '', overflow: document.documentElement.scrollWidth > innerWidth }; }`);
      assert.equal(page.stage, stage); assert.equal(page.stuck, stage === 'queued' ? 'stuck 7h' : stage === 'merging' ? 'stuck 2d' : ''); assert.equal(page.overflow, false);
    }
    const errors = browser('console', '--type', 'error');
    writeFileSync(join(out, `console.${theme}.${width}.txt`), errors);
  }
  cli('ticket', board, '--id', 'epic', '--title', 'Ship the owner sync', '--stage', 'done', '--progress', '90');
  cli('ticket', board, '--id', 'queued', '--parent', 'epic');
  const epic = JSON.parse(cli('ticket', board, '--id', 'epic', '--json')).ticket;
  assert.equal(epic.progress, 17); assert.equal(epic.stage, 'done');
  browser('open', `${base}#ticket/epic`); browser('wait', 'Ship the owner sync');
  assert.equal(evaluate(`() => document.querySelector('.tk-pane .ui-props, .tk-sheet .ui-props').querySelectorAll('.tk-stage, .tk-stuck').length`), 0);
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: '0.6.8' }, start: 'An isolated board for Umer', steps: ['Publish all five stages with the CLI at 17 percent', 'Read ticket JSON and /api/state', 'Open Tickets at 390 and 1280 in light and dark', 'Open every ticket and check stage, seven-hour and two-day warnings, done and no-event suppression', 'Open an epic and check average progress without stage roll-up'], result: 'Tickets show published stage words and calm stuck warnings at 390 and 1280 in light and dark' }, null, 2));
} finally {
  try { browser('stop'); } finally { try { cli('stop', board); } finally { rmSync(dir, { recursive: true, force: true }); } }
}
