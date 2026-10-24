// Report kinds on a fresh board: seven guided reports, one of each kind (six posted as report 5 with their purpose, and an older report 4 whose kind the
// board guesses), at 390x844 and 1280x800 (2x), light and dark, in a headless Chromium of its own over the DevTools protocol, measured in the browser.
// Usage: node .agents/skills/done-done-verify-sign-off/report-kinds-shots.mjs <output> [<approved mock's shots folder>]   (KINDS_WIDTHS="390" keeps one width)
// Saves <state>.<theme>.<width>w.png with its .dom.json and .measure.json, and kinds.<theme>.<width>w.txt; with the mock's shots folder (the design pass's
// mock-shots/), each state is also saved beside the approved mock's frame as vs-mock/<state>.<theme>.<width>w.pair.png. Asserts each state.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), mock = (process.argv[3] ?? process.env.KINDS_MOCK) && resolve(process.argv[3] ?? process.env.KINDS_MOCK);
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(join(out, 'vs-mock'), { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-kinds-'));
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, env, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const board = join(dir, 'board.json'), so = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args]);

// What the browser reads: each row's kind chip, bar or strip and percent; the filter sheet's rows; the pill; a report's head, purpose line, strip and next part;
// a desk's head, strip and next part; and the checks every capture gets (overflow, words cut short, controls under 44px on a phone, console errors).
const MEASURE = `(async () => {
  await document.fonts.ready;
  // Rows rise in and sheets slide up; a busy host can still be running that motion after the fixed wait, so measure once it has settled.
  await Promise.all(document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => a.finished.catch(() => {})));
  const w = document.documentElement.clientWidth, phone = innerWidth < 1024, box = (e) => e.getBoundingClientRect(), vis = (e) => { const r = box(e), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const r2 = (n) => Math.round(n * 100) / 100, fail = [], txt = (e) => e?.textContent.replace(/\\s+/g, ' ').trim() ?? '';
  const rows = [...document.querySelectorAll('.rp-list .ui-row')].filter(vis).map((e) => { const chip = e.querySelector('.l2 .rkc'), strip = e.querySelector('.l2 .rp-strip'), bar = e.querySelector('.l2 .ui-bar'), pct = e.querySelector('.pct');
    const c = chip && box(chip), next = (strip ?? bar) && box(strip ?? bar);
    return { title: txt(e.querySelector('.t')), kind: chip?.dataset.kind ?? '', chip: txt(chip), chipH: c ? r2(c.height) : 0, gap: c && next ? r2(next.left - c.right) : null, strip: strip ? [...strip.children].map((i) => (i.classList.contains('on') ? 1 : 0)).join('') : '', pct: txt(pct), p: txt(e.querySelector('.ui-pc')) }; });
  rows.forEach((x, i) => { if (!x.kind || x.chipH !== 20 || x.gap !== 8) fail.push('row ' + i + ' ' + JSON.stringify(x)); });
  const pick = [...document.querySelectorAll('#sheet[open] .rp-pick .ui-pr')].map((b) => ({ kind: b.dataset.kind, name: txt(b.querySelector('.kn')), n: txt(b.querySelector('.n')), on: b.getAttribute('aria-pressed') === 'true' }));
  const fb = document.querySelector('.rp-fb'), pill = document.querySelector('.rp-pill');
  const rd = document.querySelector('#reader:not([hidden])'), sheet = rd?.querySelector('.rp-sheet-body'), deskRead = document.querySelector('.split-detail');
  const head = sheet ? { chip: txt(sheet.querySelector('.rp-what .rkc')), when: txt(sheet.querySelector('.rp-what .rp-when')), title: txt(sheet.querySelector('h1')), for: txt(sheet.querySelector('.rp-for')),
    strip: [...sheet.querySelectorAll('.rp-strip-row .rp-strip > i')].map((i) => (i.classList.contains('on') ? 1 : 0)).join(''), next: txt(sheet.querySelector('.rp-next')), parts: sheet.querySelectorAll('.rp-part').length, sources: [...sheet.querySelectorAll('.rp-src')].map((b) => txt(b)).join('|'), read: txt([...sheet.querySelectorAll('.ui-dl')].find((e) => /^Read /.test(e.textContent))) }
    : deskRead && !phone ? { chip: txt(deskRead.querySelector('.rp-bar .rkc')), title: txt(deskRead.querySelector('h1')), for: txt(deskRead.querySelector('.rp-for')), read: txt(deskRead.querySelector('.rp-parts-h')),
      strip: [...deskRead.querySelectorAll('.rp-strip-row .rp-strip > i')].map((i) => (i.classList.contains('on') ? 1 : 0)).join(''), next: txt(deskRead.querySelector('.rp-next')),
      parts: [...deskRead.querySelectorAll('.rp-part .k')].map((k) => txt(k)).join(','), sources: [...deskRead.querySelectorAll('.rp-src')].map((b) => txt(b)).join('|') } : null;
  // Words cut short: a chip, the purpose line, a part's name on the desk's strip (its full name stays in the parts list) is allowed to end in an ellipsis only there.
  const cut = [...document.querySelectorAll('.rkc, .rp-for, .rp-pick .kn, .rp-pill span[dir], .rp-next, #reader.rp-sheet h1, .gd-tag, .gd-src')].filter(vis).filter((e) => { const rg = document.createRange(); rg.selectNodeContents(e); const t = rg.getBoundingClientRect(), b = box(e);
    return t.right > b.right + 1 || t.bottom > b.bottom + 1 || e.scrollWidth > e.clientWidth + 1; }).map((e) => e.className + ': ' + txt(e).slice(0, 40));
  if (cut.length) fail.push('cut short: ' + cut.join('; '));
  const hit = (e) => { const r = box(e), a = getComputedStyle(e, '::after'), o = (v) => Math.max(0, -parseFloat(v) || 0), wide = a.content !== 'none' && a.position === 'absolute'; return { top: r.top, bottom: r.bottom, height: r.height + (wide ? o(a.top) + o(a.bottom) : 0), width: r.width + (wide ? o(a.left) + o(a.right) : 0) }; };
  // A sheet's own controls; on the guided page opened at its sources, that part's.
  const scope = document.querySelector('#sheet[open]') ?? sheet ?? (rd && document.getElementById('gd-sources')) ?? document;
  const under = phone ? [...scope.querySelectorAll('button, a[href], summary')].filter(vis).filter((e) => !e.closest('.dl-hover, .rp-scrim, .tabs')).filter((e) => { const r = hit(e); return r.top < innerHeight && r.bottom > 0 && (r.height < 43.5 || r.width < 43.5); })
    .map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24) + ' ' + Math.round(box(e).width) + 'x' + Math.round(box(e).height)) : [];
  if (under.length) fail.push('under 44px: ' + under.join(', '));
  const overflowing = [...document.querySelectorAll('body *')].filter((e) => box(e).right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList[0] ? '.' + e.classList[0] : ''));
  if (overflowing.length) fail.push('overflow: ' + overflowing.join(', '));
  // The guided page opened at a research report's sources: each source's tag and its link out.
  const gdSources = document.getElementById('gd-sources'), sources = gdSources ? { tags: [...gdSources.querySelectorAll('.gd-tag')].map(txt), links: [...gdSources.querySelectorAll('.gd-src')].map((a) => txt(a) + ' ' + a.target) } : null;
  return { viewport: innerWidth + 'x' + innerHeight, rows, sources, pick, filter: fb ? { label: fb.getAttribute('aria-label'), count: txt(fb.querySelector('b')) } : null, pill: txt(pill), head, under, fail,
    dom: { url: location.href, overflow: document.documentElement.scrollWidth > w, overflowing } };
})()`;

const prof = mkdtempSync(join(tmpdir(), 'so-kinds-chrome-'));
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let server, ws;
process.on('exit', () => { try { chrome.kill(); } catch {} try { server?.kill(); } catch {} });
const errors = [], failed = [], problems = [], lines = [];
try {
  // Seven guided reports filed in the last hours, one of each kind, as the approved mock lists them: six report 5s, each with every part of its kind (a research report's
  // sources with links and a user report, its options and findings with their confidence; a plan's design with its diagram, its slices sized and tested); the incident is an
  // older report 4 with no purpose, so its kind is the board's guess.
  const base = JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v5/valid-full.json'), 'utf8')), old = JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v4/valid-full.json'), 'utf8'));
  const { REPORT_PARTS } = await import(join(repo, 'dist/store.js')), ago = (h) => new Date(Date.now() - h * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z');
  mkdirSync(join(dir, 'diagrams'), { recursive: true });
  writeFileSync(join(dir, 'diagrams', 'flow.html'), readFileSync(join(repo, '.agents/skills/done-done-verify-sign-off/diagram-sample/flow.html')));
  const NEEDS = {
    sources: [{ title: 'ntfy docs: self-hosting', text: 'One binary, no account needed.', link: 'https://docs.ntfy.sh/install/', source: 'primary' }, { title: 'Pushover pricing', text: 'A one-time licence per platform.', link: 'https://pushover.net/pricing', source: 'primary' },
      { title: 'ntfy issue: iOS delivery', text: 'Users report delays on iOS without the relay.', link: 'https://github.com/binwiederhier/ntfy/issues/1', source: 'user' }],
    options: [{ title: 'ntfy', text: 'Free, self-hosted.', more: 'Cost: free.\nSetup: one hour.' }, { title: 'Pushover', text: 'Paid once, hosted.', more: 'Cost: $5 per platform.\nSetup: ten minutes.' }],
    findings: [{ title: 'Delivery under 2 seconds', text: 'Timed on one Android phone.', confidence: 'high' }],
    slices: [{ title: 'Move the page', text: 'Settings open from the profile.', size: 'S, half a day' }], tests: [{ title: 'Move the page', text: 'A browser test opens it from the profile.' }],
  };
  const sections = (purpose) => REPORT_PARTS[purpose].map(([part, heading]) => ({ id: part, part, stage: 'found', heading, body: `${heading}, in a line or two.`,
    ...(purpose !== 'decision' && NEEDS[part] && { items: NEEDS[part] }), ...(purpose === 'plan' && part === 'design' && { diagram: [{ label: 'Flow', src: 'diagrams/flow.html' }] }) }));
  const reports = [
    { key: 'kinds-plan', purpose: 'plan', group: 'Settings', priority: 'P1', title: 'Move settings into the profile page in four slices', about: 'Settings leave the menu and open from the profile. Four slices, each shipped and proven on its own.', found: 'Four slices over six days; the old link stays for a week', read: ['goal', 'current', 'design'] },
    { key: 'kinds-research', purpose: 'research', group: 'Beacon', title: 'Which push service fits a team of two', about: 'Five services compared on cost, delivery on a phone and setup time. Two fit; one is free up to our size.', found: 'ntfy fits: free, self-hosted, under 2 seconds', read: ['question', 'scope', 'method', 'sources'] },
    { key: 'kinds-incident', group: 'Chat app', priority: 'P0', title: 'Why messages were sent twice on Tuesday: a retro', about: 'A retry ran after a slow answer had already arrived. One change stops it.', found: 'A retry ran after the answer had arrived' },
    { key: 'kinds-decision', purpose: 'decision', group: 'Sign-in', title: 'Keep the code step after the password', about: 'Two ways compared; the code step stays, with the reasons and what it costs.', found: 'The code step stays: it stops a stolen password alone', opened: true },
    { key: 'kinds-audit', purpose: 'audit', group: 'Settings', title: 'Every screen checked against the contrast rules', about: 'Twelve screens checked; two fall short in dark, with the fix for each.', found: 'Two of twelve screens fall short in dark' },
    { key: 'kinds-status', purpose: 'status', group: 'Release', title: 'Where the 0.6 release stands', about: 'Four of five parts are done; the last waits on one review.', found: 'Four of five parts are done', opened: true },
    { key: 'kinds-other', purpose: 'other', title: 'How the release train works', about: 'Build, check and publish each have one owner.', found: 'Each stage has one owner' },
  ];
  reports.forEach((r, i) => {
    const m = r.purpose ? { ...base, purpose: r.purpose, sections: r.purpose === 'other' ? base.sections.map(({ part, ...x }) => ({ ...x, items: x.items?.map(({ link, source, confidence, ...it }) => it) })) : sections(r.purpose) } : { ...old };
    // Each report's picture heads with its own finding, which its sheet shows as What it found.
    Object.assign(m, { key: r.key, title: r.title, about: r.about, filed: ago(0.2 + i * 0.4), visual: { ...m.visual, heading: r.found } });
    for (const f of ['ticket', 'asked_by', 'group', 'priority']) delete m[f];
    if (r.group) m.group = r.group;
    if (r.priority) m.priority = r.priority;
    writeFileSync(join(dir, `${r.key}.json`), JSON.stringify(m)); so('post', board, '--kind', 'report', '--from', join(dir, `${r.key}.json`));
  });
  // Post holds a report 5 to its kind's parts: a plan whose sections name no part, and a research report with no user report, are each refused with one fix line, and nothing is written.
  const refusals = [['a plan with none of its parts', { ...base, key: 'kinds-bad-plan', purpose: 'plan', sections: base.sections.map(({ part, ...x }) => x) }],
    ['a research report with no user report', { ...base, key: 'kinds-bad-research', sections: base.sections.map((x) => (x.part === 'sources' ? { ...x, items: x.items.map((it) => ({ ...it, source: 'primary' })) } : x)) }]].map(([what, m]) => {
    writeFileSync(join(dir, `${m.key}.json`), JSON.stringify(m));
    const r = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), 'post', board, '--kind', 'report', '--from', join(dir, `${m.key}.json`)], { encoding: 'utf8', env });
    assert.equal(r.status, 2, r.stdout); assert.ok(!readFileSync(board, 'utf8').includes(m.key), `${what} is not written`);
    return `$ sign-off-axi post --kind report --from ${m.key}.json   (${what})\nexit ${r.status}\n${r.stdout.replaceAll(dir, '<board folder>')}`;
  });
  assert.match(refusals[0], /sections has no \\?"goal\\?" part/); assert.match(refusals[1], /must hold at least one user report/);
  writeFileSync(join(out, 'kinds-refusal.txt'), refusals.join('\n'));
  // A config.yaml beside the board names the user, as seed-board.sh does, so the sidebar's foot reads Umer.
  writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  const url = await new Promise((ok, no) => { let s = ''; server.stdout.on('data', (b) => { s += b; const m = /url: "?(http\S+?\/)"?\s/.exec(s); if (m) ok(m[1]); }); setTimeout(() => no(new Error(`no board url: ${s}`)), 20000); });
  const post = (path, body) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => assert.ok(r.ok, path));
  // Each cell starts from the same read state: the decision and the status read, the rest new; the plan with three of its nine parts read, the research with four.
  const reset = async () => { await post('api/reads', { keys: reports.filter((r) => r.opened).map((r) => r.key), read: true }); await post('api/reads', { keys: reports.filter((r) => !r.opened).map((r) => r.key), read: false });
    for (const r of reports) for (const part of r.read ?? []) await post('api/reads', { key: r.key, part }); };

  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium opened its DevTools port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
    if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push(x.params.args.map((a) => a.value ?? a.description).join(' '));
    if (x.method === 'Network.responseReceived' && x.params.response.status >= 400) failed.push({ url: x.params.response.url, status: x.params.response.status });
    if (x.method === 'Network.loadingFailed' && !x.params.canceled) failed.push({ url: x.params.requestId, status: 0 }); };
  const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.origin === ${JSON.stringify(new URL(url).origin)}) localStorage.setItem('sign-off-reports-by', 'new'), localStorage.removeItem('so-theme')` });
  const ev = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, `${expression.slice(0, 80)}: ${r.exceptionDetails?.exception?.description}`); return r.result.value; };
  const shot = async (file) => writeFileSync(file, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const go = async (address, ms = 1300) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: address }); await wait(ms); };
  const tap = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}).click(), new Promise((ok) => setTimeout(ok, 700)))`);
  // The approved mock's frame on the left, the board's on the right, at one height.
  const MOCK = { 'kinds-list': 'list', 'kinds-filter': 'filter', 'kinds-filtered': 'filtered', 'kinds-plan': 'plan', 'kinds-research': 'research', 'kinds-desk-plan': 'plan', 'kinds-desk-research': 'research' };
  const font = ['/usr/share/fonts/inter/Inter-SemiBold.ttf', join(process.env.HOME ?? '', '.local/share/fonts/v1/Inter-SemiBold.ttf'), '/usr/share/fonts/noto/NotoSans-Bold.ttf'].find(existsSync);
  const label = (text) => ['-gravity', 'north', '-background', '#E8E4E0', '-splice', '0x80', ...(font ? ['-font', font] : []), '-pointsize', '34', '-fill', '#121210', '-annotate', '+0+22', text];
  const pair = (s, cell) => {
    const left = mock && join(mock, `${MOCK[s]}.${cell}.png`);
    if (!left || !existsSync(left)) return;
    sh('magick', ['(', left, '-resize', 'x1600', ...label('Approved mock'), ')', '(', join(out, `${s}.${cell}.png`), '-resize', 'x1600', ...label('Board, this build'), ')',
      '-background', '#E8E4E0', '-gravity', 'center', '+append', '-bordercolor', '#E8E4E0', '-border', '32', join(out, 'vs-mock', `${s}.${cell}.pair.png`)]);
  };
  for (const wd of (process.env.KINDS_WIDTHS ?? '390 1280').split(' ').map(Number)) for (const theme of ['light', 'dark']) {
    const metrics = wd === 390 ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false };
    await cdp('Emulation.setDeviceMetricsOverride', metrics);
    await cdp('Emulation.setTouchEmulationEnabled', metrics.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    const cell = `${theme}.${wd}w`, txt = [`${theme} ${wd}w Report kinds`];
    const state = async (s, setup) => {
      errors.length = 0; failed.length = 0;
      await go(`${url}#reports`);
      if (setup) { await setup(); await wait(500); }
      await shot(join(out, `${s}.${cell}.png`));
      const m = await ev(MEASURE);
      writeFileSync(join(out, `${s}.${cell}.dom.json`), JSON.stringify({ ...m.dom, console_errors: [...errors], failed_requests: [...failed] }, null, 2) + '\n');
      delete m.dom;
      writeFileSync(join(out, `${s}.${cell}.measure.json`), JSON.stringify(m, null, 2) + '\n');
      if ([m.fail, errors, failed].some((x) => x.length)) problems.push(`${s}.${cell}: ${JSON.stringify({ fail: m.fail, errors, failed })}`);
      txt.push(`${s}: ${m.fail.length ? 'FAIL ' + m.fail.join('; ') : 'clean'}`);
      pair(s, cell);
      return m;
    };
    await reset();
    const list = await state('kinds-list');
    txt.push(`rows: ${list.rows.map((r) => `${r.title} [${r.chip}${r.p ? ', ' + r.p : ''}] ${r.strip ? 'strip ' + r.strip : 'bar'} ${r.pct}`).join(' | ')}`, `filter button: "${list.filter?.label}"`);
    const kinds = list.rows.map((r) => r.kind);
    assert.deepEqual(kinds.slice(0, 6), ['plan', 'research', 'incident', 'decision', 'audit', 'status'], 'each row names its kind, the incident by the board\'s guess');
    assert.equal(list.rows[0].strip, '111000000', 'a plan\'s bar is its nine parts, three read'); assert.equal(list.rows[0].pct, '33%');
    assert.ok(list.rows.slice(1).every((r) => !r.strip), 'every other kind keeps the bar');
    if (metrics.mobile) {
      const sheet = await state('kinds-filter', () => tap('.rp-fb'));
      txt.push(`filter sheet: ${sheet.pick.map((p) => `${p.name.split(' What')[0]} ${p.n}${p.on ? ' (on)' : ''}`).join(' | ')}`);
      assert.deepEqual(sheet.pick.map((p) => [p.kind, p.n]), [['all', '7'], ['research', '1'], ['plan', '1'], ['decision', '1'], ['audit', '1'], ['incident', '1'], ['status', '1'], ['other', '1']]);
      const only = await state('kinds-filtered', async () => { await tap('.rp-fb'); await tap('#sheet .rp-pick [data-kind="research"]'); });
      txt.push(`filtered: pill "${only.pill}", button "${only.filter.label}" (${only.filter.count}), rows ${only.rows.map((r) => r.title).join(' | ')}`);
      assert.deepEqual([only.rows.map((r) => r.kind), only.pill.replace(/(?<=\D)(?=\d)/, ' '), only.filter.count], [['research'], 'Research and discovery 1 of 7', '1']);
      for (const [s, key, chip, read, next] of [['kinds-plan', 'kinds-plan', 'Implementation plan', 'Read 3 of 9 parts', 'Next: Slices'], ['kinds-research', 'kinds-research', 'Research and discovery', 'Read 4 of 9 parts', 'Next: Options compared'],
        ['kinds-old', 'kinds-incident', 'Incident and retro', '', '']]) {
        const m = await state(s, () => tap(`#item-${key}`));
        txt.push(`${s} sheet: [${m.head.chip}] ${m.head.when} / "${m.head.title}" / for "${m.head.for}" / ${m.head.read} ${m.head.strip} "${m.head.next}" / sources ${m.head.sources || 'none'}`);
        if (key === 'kinds-research') assert.equal(m.head.sources, 'Linked sources3|What users report1');
        assert.equal(m.head.chip, chip); assert.ok(m.head.for.length > 10, 'a line on what it is for');
        if (read) assert.deepEqual([m.head.read, m.head.next, m.head.strip.length], [read, next, 9]);
      }
      // Tapping What users report opens the guided page at its sources: each with its tag, and a link out that opens in a new tab.
      const src = await state('kinds-sources', async () => { await tap('#item-kinds-research'); await tap('#reader .rp-src:last-child'); await ev(`(document.getElementById('gd-sources')?.scrollIntoView({ block: 'start' }), new Promise((ok) => setTimeout(ok, 400)))`); });
      txt.push(`kinds-sources: tags ${src.sources?.tags.join(', ')}; links ${src.sources?.links.join(', ')}`);
      assert.deepEqual(src.sources, { tags: ['Primary source', 'Primary source', 'User report'], links: ['Open on docs.ntfy.sh _blank', 'Open on pushover.net _blank', 'Open on github.com _blank'] });
    } else {
      for (const [s, key, chip, strip, next, parts, sources] of [['kinds-desk-plan', 'kinds-plan', 'Implementation plan', '111000000', 'Next: Slices', 'Goal and non-goals,How it works today,Design,Slices,Tests and proof,Risks and rollback,Rollout,Time,Your calls', ''],
        ['kinds-desk-research', 'kinds-research', 'Research and discovery', '111100000', 'Next: Options compared', 'The question and why it matters,Scope,Method,Sources,Options compared,Findings,What we did not check,Recommendation,Open questions', 'Linked sources3|What users report1']]) {
        const m = await state(s, () => tap(`.split-list #item-${key}`));
        txt.push(`${s}: [${m.head.chip}] "${m.head.title}" / for "${m.head.for}" / ${m.head.read} ${m.head.strip} "${m.head.next}" / parts ${m.head.parts} / sources ${m.head.sources || 'none'}`);
        assert.deepEqual([m.head.chip, m.head.strip, m.head.next, m.head.parts, m.head.sources], [chip, strip, next, parts, sources]);
      }
    }
    writeFileSync(join(out, `kinds.${cell}.txt`), txt.join('\n') + '\n');
    lines.push(...txt);
  }
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board with seven guided reports filed in the last hours, one of each kind: six posted as report 5 with their purpose and every part of their kind (the research report with three linked sources, one of them a user report, its options and findings; the plan with its nine parts from Goal and non-goals to Your calls), and an older report 4 with none (a retro, so the board guesses Incident). The decision and the status read; the plan with three of its nine parts read and the research with four.',
    steps: ['Post a plan whose sections name none of its parts, and a research report with no user report, through the CLI (kinds-refusal.txt).', 'Open Reports on a phone at 390x844 (2x) in light and dark and read every row.', 'Tap the filter button, then pick Research and discovery.',
      'Tap the plan, the research and the older report in the list, each opening its sheet.', 'On the research sheet tap What users report: the guided page opens at its sources.', 'At 1280: pick the plan, then the research, in the list.'],
    result: 'Post refuses the plan with none of its parts (sections has no "goal" part) and the research report with no user report, each with its fix line, and writes neither. On a phone every report row leads with its kind (Plan, Research, Incident, Decision, Audit, Status, Report); the plan\'s bar is its nine parts with three filled; the filter sheet lists Every kind (7) and each kind with what it is for and its count; picking Research lists the one research report under its pill (1 of 7). The plan\'s sheet heads Implementation plan, says how the work gets built, and lists its nine parts from Goal and non-goals to Your calls under Read 3 of 9 parts and Next: Slices. The research sheet heads Research and discovery and counts its sources: 3 linked sources, 1 of them what users report; tapping it opens the guided page at its sources, each tagged Primary source or User report with a link out (Open on docs.ntfy.sh, pushover.net, github.com) in a new tab. The older report reads Incident and retro by the board\'s guess. On a desk the bar names the kind; beside the report, its Sources (research), then the strip, the next part and its kind\'s parts listed with a check on each one read.' }, null, 2) + '\n');
  console.log(lines.join('\n'));
  assert.deepEqual(problems, [], 'every capture measures clean');
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { sh(process.execPath, [join(repo, 'dist/cli.js'), 'stop', board]); } catch {}
  try { server?.kill(); } catch {}
  await wait(300);
  rmSync(prof, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}
