// The Evidence feed: a proof filed after the board was read whole reaches Evidence on the next poll, and the feed-stall alarm trips on a stale
// pair of timestamps (both times and the 30-minute limit in its message) while staying quiet on the board it just drove.
// Usage: node .../evidence-feed-journey.mjs <output>
//        EVIDENCE_FEED_URL=<served board> [EVIDENCE_FEED_TOKEN_FILE=<file>] measures a board already serving (the real board): the alarm alone.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), repo = resolve(import.meta.dirname, '../../..');
mkdirSync(out, { recursive: true });
// The alarm: a feed is stale when the board's newest proof is this far ahead of the newest proof the page shows. Its failure text names both
// times and the limit, so a silent feed cannot hide behind a page that answers.
const LIMIT_MS = 30 * 60 * 1000;
const alarm = (boardNewest, feedNewest) => {
  const lag = Date.parse(boardNewest) - Date.parse(feedNewest);
  const minutes = Number.isFinite(lag) ? Math.round(lag / 60_000) : 'no';
  return { ok: Number.isFinite(lag) && lag < LIMIT_MS,
    message: `Evidence feed stale: the board's newest proof is ${boardNewest || 'none'} and the newest proof on the Evidence page is ${feedNewest || 'none'}`
      + ` (${minutes} minutes apart, and 30 minutes is the limit): a proof landed on the board and never reached the page.` };
};
/** The board's proofs as the page reads them: never a failed or unfinished run, never a dismissed card. */
const proofs = (d, gone) => d.type === 'evidence' && !gone.has(d.key) && !['RUN FAIL', 'INCONCLUSIVE'].includes(d.evidenceCard?.result);
const newestOf = (list) => list.reduce((at, d) => (Date.parse(d.filed) > Date.parse(at || 0) ? d.filed : at), '');
const work = mkdtempSync(join(tmpdir(), 'sign-off-evidence-feed-'));
const env = { ...process.env, HOME: work, XDG_CONFIG_HOME: `${work}/.config`, XDG_DATA_HOME: `${work}/.local/share`, XDG_STATE_HOME: `${work}/.local/state`, XDG_CACHE_HOME: `${work}/.cache`, SIGN_OFF_FILER: 'verify' };
const board = join(work, 'board.json');
// SIGN_OFF_CLI drives another build of the board (an installed pack) with the same journey; the repo's dist is the default.
const cli = process.env.SIGN_OFF_CLI || join(repo, 'dist/cli.js');
const so = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 120000, env });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-feed-${process.pid}` };
const browser = (...args) => { const r = spawnSync('chrome-devtools-axi', args, { encoding: 'utf8', env: browserEnv }); assert.equal(r.status, 0, `${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const evalIn = (fn) => JSON.parse(spawnSync('chrome-devtools-axi', ['run'], { encoding: 'utf8', env: browserEnv, input: `console.log(JSON.stringify(await page.eval(${fn})));` }).stdout.trim().split('\n').pop());
/** An access link answers with a redirect the browser follows, and it reports no page selected after it: the tab it made is selected here,
 *  retried until the browser reports a selected tab, because that read can arrive before the tab exists. */
const openLink = (url) => {
  const axi = (args) => spawnSync('chrome-devtools-axi', args, { encoding: 'utf8', env: browserEnv }).stdout;
  spawnSync('chrome-devtools-axi', ['open', url], { encoding: 'utf8', env: browserEnv });
  for (let i = 0; i < 20; i++) {
    const pages = axi(['pages']);
    if (/^\s+\d+,\S*?,true$/m.test(pages)) return;
    const last = [...pages.matchAll(/^\s+(\d+),/gm)].pop();
    if (last) spawnSync('chrome-devtools-axi', ['selectpage', last[1]], { encoding: 'utf8', env: browserEnv });
  }
};
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
/** What the page shows on Evidence and what the board holds, read from the page the person is on. */
const read = () => evalIn(`async () => {
  const items = await (await fetch('/api/decisions?view=items&offset=0&limit=200')).json();
  const rows = [...document.querySelectorAll('#board [data-row]')].map((r) => (r.id || '').replace(/^item-/, ''));
  return { hash: location.hash, rows, decisions: items.decisions ?? [], dismissed: items.dismissed ?? [], error: (document.getElementById('banner')?.hidden === false && document.getElementById('banner').textContent) || '' };
}`);
/** The two timestamps of the alarm, from one read of the page and the board behind it. */
const timestamps = (r) => {
  const gone = new Set(r.dismissed), held = r.decisions.filter((d) => proofs(d, gone)), shown = new Set(r.rows);
  return { boardNewest: newestOf(held), feedNewest: newestOf(held.filter((d) => shown.has(d.key))), held: held.length, shown: held.filter((d) => shown.has(d.key)).length };
};
const live = process.env.EVIDENCE_FEED_URL;
let server;
try {
  if (live) {
    // A board already serving: the alarm alone, on whatever its Evidence page shows (the real board, where it must stay quiet).
    const token = process.env.EVIDENCE_FEED_TOKEN_FILE ? readFileSync(process.env.EVIDENCE_FEED_TOKEN_FILE, 'utf8').trim() : '';
    if (token) openLink(`${live}?token=${encodeURIComponent(token)}`); else browser('open', live);
    browser('open', `${live}#evidence`);
    await sleep(6000);
    const r = await read();
    assert.equal(r.error, '', `the board answers: ${r.error}`);
    const t = timestamps(r), verdict = alarm(t.boardNewest, t.feedNewest);
    writeFileSync(join(out, 'alarm-quiet.txt'), `run ${process.env.DONE_DONE_RUN_ID}\nWHAT THIS SHOWS: the feed-stall alarm on the board that is serving ${new URL(live).host}, read in a real browser at 390.\n`
      + `board newest proof: ${t.boardNewest}\nfeed newest proof: ${t.feedNewest}\nproofs held ${t.held}, shown on Evidence ${t.shown}\n`
      + `verdict: ${verdict.ok ? 'quiet' : 'STALE'}\n${verdict.ok ? '' : `${verdict.message}\n`}`);
    assert.ok(verdict.ok, verdict.message);
    console.log(`evidence feed alarm quiet on ${new URL(live).host}: ${t.feedNewest} (board ${t.boardNewest})`);
  } else {
    assert.equal(so('init', work).status, 0);
    const ask = so('post', board, '--type', 'decision', '--key', 'ship-the-feed', '--ask-ref', 'message-feed', '--title', 'Ship the feed fix?',
      '--why', 'Umer needs an answer before the release.', '--option', 'yes=Yes', '--option', 'no=No', '--outcome', 'yes=The work goes on with yes.',
      '--outcome', 'no=The work goes on with no.', '--recommend', 'yes', '--recommend-reason', 'It is the safe choice.', '--default', 'yes');
    assert.equal(ask.status, 0, ask.stdout + ask.stderr);
    const proof = (title, about) => {
      const posted = so('post', board, '--type', 'evidence', '--title', title, '--about', about, '--media', join(repo, 'fixtures/evidence/product-board.png'));
      assert.equal(posted.status, 0, posted.stdout + posted.stderr);
      return posted.stdout;
    };
    proof('The first proof, filed before the board was read whole', 'A real capture of the board.');
    server = spawn(process.execPath, [cli, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    const link = await new Promise((ok) => server.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    browser('open', link);
    browser('emulate', '--viewport', '390x844x2,mobile,touch');
    // An answer reads the whole board into the page: the client then holds the board as it was when that request was written.
    await sleep(1500);
    const answered = evalIn(`async () => { for (let i = 0; i < 100; i++) { const b = [...document.querySelectorAll('button')].find((b) => /^Answer Yes/.test(b.getAttribute('aria-label') || b.textContent)); if (b) { b.click(); return 'answered'; } await new Promise((r) => setTimeout(r, 100)); } return 'no answer button'; }`);
    assert.equal(answered, 'answered', 'the ask answers in the board');
    await sleep(2000);
    browser('open', `${link}#evidence`);
    await sleep(1500);
    const before = await read();
    assert.equal(before.rows.length, 1, `Evidence lists the proof filed before the answer: ${JSON.stringify(before.rows)}`);
    // A proof lands after that whole-board read: the poll after next must bring it, and it is the newest row.
    proof('A proof filed after the board was read whole', 'A real capture of the board, filed while the page held an older copy of it.');
    let after = before, waited = 0;
    // Two polls of 20 seconds, and the read that follows each one.
    for (; waited <= 55_000 && after.rows[0] !== 'update-2'; waited += 500) { await sleep(500); after = await read(); }
    writeFileSync(join(out, 'feed-updates.txt'), `run ${process.env.DONE_DONE_RUN_ID}\nWHAT THIS SHOWS: a proof filed after the board was read whole (the answer to ship-the-feed) reaches Evidence`
      + ` on the next poll, as the newest row, with no reload: the page was left open on Evidence for ${Math.round(waited / 1000)} s.\n`
      + `before the proof: ${JSON.stringify(before.rows)}\nafter: ${JSON.stringify(after.rows)}\npage: ${after.hash}\n`);
    assert.equal(after.rows[0], 'update-2', `the proof filed after the whole-board read is Evidence's newest row: ${JSON.stringify(after.rows)}`);
    // The alarm, quiet on the board it just drove, and tripping on the incident's own stale pair.
    const t = timestamps(after), quiet = alarm(t.boardNewest, t.feedNewest);
    writeFileSync(join(out, 'alarm-quiet.txt'), `run ${process.env.DONE_DONE_RUN_ID}\nWHAT THIS SHOWS: the feed-stall alarm stays quiet on the board this journey drove, read in a real browser at 390.\n`
      + `board newest proof: ${t.boardNewest}\nfeed newest proof: ${t.feedNewest}\nverdict: ${quiet.ok ? 'quiet' : 'STALE'}\n${quiet.ok ? '' : `${quiet.message}\n`}`);
    assert.ok(quiet.ok, quiet.message);
    // The fixture is the incident itself: at 08:57Z on 30 Oct the captain's phone showed nothing newer than 07:27Z while the board already
    // held the merge proof filed 08:44:19Z, and that pair is what the alarm is given here.
    const stale = { board: '2026-10-30T08:44:19.237Z', feed: '2026-10-30T07:27:00.000Z' };
    writeFileSync(join(out, 'stale-feed.json'), `${JSON.stringify(stale, null, 2)}\n`);
    const tripped = alarm(stale.board, stale.feed);
    writeFileSync(join(out, 'alarm-trip.txt'), `run ${process.env.DONE_DONE_RUN_ID}\nWHAT THIS SHOWS: the feed-stall alarm on stale-feed.json, the pair the captain's phone showed (newest proof on the board 08:44:19Z,`
      + ` newest proof on the Evidence page 07:27:00Z). The check fails, and its message carries both timestamps and the limit.\n`
      + `board newest proof: ${stale.board}\nfeed newest proof: ${stale.feed}\nverdict: ${tripped.ok ? 'quiet' : 'STALE'}\n${tripped.message}\n`);
    assert.equal(tripped.ok, false, 'the alarm trips on a feed 77 minutes behind the board');
    assert.match(tripped.message, /30 minutes is the limit/);
    assert.match(tripped.message, /2026-10-30T08:44:19\.237Z/);
    assert.match(tripped.message, /2026-10-30T07:27:00\.000Z/);
    assert.match(tripped.message, /Evidence feed stale:/);
    console.log(`evidence feed journey ok: ${after.rows[0]} landed on Evidence after the whole-board read, alarm quiet at ${t.feedNewest}, tripped at ${stale.feed}`);
  }
} finally {
  server?.kill();
  spawnSync('chrome-devtools-axi', ['stop'], { env: browserEnv });
  rmSync(work, { recursive: true, force: true });
}
