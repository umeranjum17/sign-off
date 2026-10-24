// A design asked as one plain question (design 2), on a real card: the owner's "Reports at its end" frames, at 390x844 and 1280x800 (2x), light and dark,
// in a headless Chromium of its own over the DevTools protocol with exact device metrics.
// First the card as it was first written is posted through the real CLI in three steps and each refusal saved (refusals.txt): its title is no question,
// its about names a pull request, and its Today and New (built) frames look the same. Then the card as the new rules have it is posted: the question,
// the New (built) and Target design frames with the changed area outlined and named, Yes approving New (built).
// Each cell gets a board of its own (own HOME and XDG_*): `ask` (the card opened from Designs), `answer` (a note typed beside Yes) and `approved` (Yes tapped:
// the board's answers file holds approve with the note, never a change). Each capture is measured in the browser: the frames' labels, pictures and captions
// on shared lines, each outlined area inside its picture, the ring and check on the frame Yes approves, the note and Yes and Change in view, no cut text,
// no words over words, no letter tile, no raw ids or file names, no control under 44px on a phone, no page scroll on a desk, no console error.
// Usage: node .agents/skills/done-done-verify-sign-off/design-ask-shots.mjs <output> <frames folder: today, built and target .light/.dark.webp>
// DESIGN_ASK_SIDE=before SIGN_OFF_REPO=<built base checkout> posts the same card as design 1 (one screen showing the owner's three-column picture) and saves its states unasserted.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), frames = resolve(process.argv[3] ?? process.env.DESIGN_ASK_FRAMES ?? '');
assert.ok(['today', 'built', 'target'].every((r) => existsSync(join(frames, `${r}.light.webp`)) && existsSync(join(frames, `${r}.dark.webp`))), 'the frames folder holds today, built and target in light and dark');
const side = process.env.DESIGN_ASK_SIDE ?? 'after', after = side === 'after', repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const KEY = 'phone-reports-end', QUESTION = 'Approve this new phone end-of-list for Reports?', NOTE = 'Looks good, keep the More line.';
const ORIGINAL = { title: 'Built: Designs one tap away on a phone, with thumbnails and no letter tiles',
  about: 'Built (PR 265, stacked on 256): on a phone Decide holds Asks | Designs with counts. Scrolled to its end every list clears the dock; at rest the page fades under it.' };
const ABOUT = 'At the end of Reports on a phone the list stops above the dock, with one More line. Today looks the same as the new build, so only the build and the target are shown.';
const view = (role) => ({ phone_light: `design/${role}.light.webp`, phone_dark: `design/${role}.dark.webp` });
const frame = (role, area, caption) => ({ role, views: view(role), area, caption });
const MORE = { x: 0.04, y: 0.775, w: 0.92, h: 0.08 };
const card = (extra) => ({ contract: 1, kind: 'design', schema: 2, key: KEY, filer: 'design-agent', group: 'sign-off', filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), status: 'in_review',
  preview: 'design/built.light.webp', title: QUESTION, about: ABOUT, accepts: 'built', journeys: [{ id: 'phone', title: 'On a phone', screens: [{ id: 'reports-end', title: 'Reports, scrolled to its end',
    frames: [frame('built', MORE, 'One More line, clear of the dock'), frame('target', { x: 0.04, y: 0.79, w: 0.92, h: 0.065 }, 'The target ends at the last row, with no More line')] }] }], ...extra });

// What the browser measures in the card (SCOPE: the reader on a phone, the desk's grid): the question, each frame's label, picture, outlined area and caption, the note and buttons,
// cut text, words over words, letter tiles, raw ids, small controls on a phone, a desk's page scroll and sideways overflow.
const MEASURE = `(async () => {
  await document.fonts.ready;
  const scope = document.querySelector(SCOPE), box = (e) => e.getBoundingClientRect(), r2 = (n) => Math.round(n * 100) / 100, fail = [], desk = innerWidth >= 1024;
  const vis = (e) => { const r = box(e), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const question = (scope.querySelector('h1, h2.dz-t')?.textContent ?? '').trim();
  const figs = [...scope.querySelectorAll('.dzf')].map((f) => { const pic = box(f.querySelector('.dzf-pic')), a = f.querySelector('.dzf-area'), ab = a && box(a), l = box(f.querySelector('.dzf-l'));
    if (ab && (ab.left < pic.left - 0.5 || ab.right > pic.right + 0.5 || ab.top < pic.top - 0.5 || ab.bottom > pic.bottom + 0.5)) fail.push('area outside its picture: ' + f.textContent.trim().slice(0, 20));
    return { label: f.querySelector('.dzf-l').textContent.trim(), yes: f.hasAttribute('data-yes'), ring: getComputedStyle(f.querySelector('.dzf-pic')).boxShadow, check: !!f.querySelector('.dzf-l .glyph'),
      pic: r2(pic.width) + 'x' + r2(pic.height) + '@' + r2(pic.left) + ',' + r2(pic.top), labelTop: r2(l.top), picTop: r2(pic.top), picW: r2(pic.width),
      area: ab ? r2(ab.left - pic.left) + ',' + r2(ab.top - pic.top) + ' ' + r2(ab.width) + 'x' + r2(ab.height) : 'none', caption: f.querySelector('figcaption')?.textContent.trim() ?? '',
      loaded: [...f.querySelectorAll('img')].every((i) => i.complete && i.naturalWidth > 0) }; });
  if (figs.length && (new Set(figs.map((f) => f.labelTop)).size > 1 || new Set(figs.map((f) => f.picTop)).size > 1 || new Set(figs.map((f) => f.picW)).size > 1)) fail.push('frames off their shared lines ' + JSON.stringify(figs.map((f) => [f.labelTop, f.picTop, f.picW])));
  if (figs.some((f) => !f.loaded)) fail.push('a frame picture did not load');
  if (figs.length && figs.filter((f) => f.yes).length !== 1) fail.push('frames marked for Yes: ' + figs.filter((f) => f.yes).length);
  if (figs.some((f) => f.yes && !f.check)) fail.push('the frame Yes approves has no check');
  const note = scope.querySelector('textarea'), nb = note && box(note), buttons = [...scope.querySelectorAll('.foot > button, .dz-info > .foot > button')].filter(vis).map((b) => b.textContent.trim() + ' ' + r2(box(b).height) + 'px');
  // Cut text and words drawn over words (frames and pictures left out: a picture's own words are the picture).
  const leafy = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
  const cut = [...scope.querySelectorAll('h1, h2, h3, p, span, a, button, blockquote, label, figcaption, cite')].filter(vis).filter(leafy)
    .filter((e) => (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible') || (e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).overflowY !== 'visible' && !['auto', 'scroll'].includes(getComputedStyle(e).overflowY)))
    .map((e) => e.tagName.toLowerCase() + '.' + (e.classList[0] ?? '') + ' "' + e.textContent.trim().slice(0, 40) + '"');
  if (cut.length) fail.push('cut text: ' + cut.join(' | '));
  const leaves = [...scope.querySelectorAll('*')].filter(vis).filter(leafy).map((e) => { const r = document.createRange(); r.selectNodeContents(e); let b = r.getBoundingClientRect(); b = { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    for (let a = e.parentElement; a; a = a.parentElement) if (getComputedStyle(a).overflow !== 'visible') { const c = box(a); b = { left: Math.max(b.left, c.left), right: Math.min(b.right, c.right), top: Math.max(b.top, c.top), bottom: Math.min(b.bottom, c.bottom) }; }
    return { e, b }; }).filter((x) => x.b.right - x.b.left > 0 && x.b.bottom - x.b.top > 0);
  const over = [];
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) { const a = leaves[i], b = leaves[j]; if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    if (Math.min(a.b.right, b.b.right) - Math.max(a.b.left, b.b.left) > 2 && Math.min(a.b.bottom, b.b.bottom) - Math.max(a.b.top, b.b.top) > 2) over.push(a.e.textContent.trim().slice(0, 20) + ' / ' + b.e.textContent.trim().slice(0, 20)); }
  if (over.length) fail.push('words over words: ' + over.slice(0, 5).join(' | '));
  const monos = [...document.querySelectorAll('.mono')].filter(vis).length;
  if (monos) fail.push('letter tiles: ' + monos);
  const words = scope.innerText, bad = words.match(/\\bPRs?\\b|#\\d+\\b|\\b[Ss]lices?\\b|\\b[A-Z][a-z]+\\d{3,}\\b|[\\w.-]+\\.(?:png|webp|html|json|md)\\b|\\b[a-z0-9]+(?:-[a-z0-9]+){3,}\\b/g) ?? [];
  if (bad.length) fail.push('raw words: ' + bad.join(', '));
  const under = !desk ? [...scope.querySelectorAll('button, a[href], summary, input, select, textarea')].filter(vis).filter((e) => { const r = box(e); return r.top < innerHeight && r.bottom > 0 && !e.closest('.dzf') && (r.height < 43.5 || r.width < 43.5); })
    .map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24) + ' ' + Math.round(box(e).width) + 'x' + Math.round(box(e).height)) : [];
  if (desk && document.documentElement.scrollHeight > innerHeight + 1) fail.push('the page scrolls: ' + document.documentElement.scrollHeight);
  const w = document.documentElement.clientWidth, overflowing = [...document.querySelectorAll('body *')].filter((e) => vis(e) && box(e).right > w + 1 && !e.closest('.dzf-row')).slice(0, 10).map((e) => e.tagName.toLowerCase() + '.' + (e.classList[0] ?? ''));
  if (overflowing.length) fail.push('wider than the page: ' + overflowing.join(', '));
  return { viewport: innerWidth + 'x' + innerHeight, question, frames: figs, note: note ? (note.value ? 'typed "' + note.value + '"' : 'empty "' + note.placeholder + '"') + ' ' + r2(nb.width) + 'x' + r2(nb.height) + '@' + r2(nb.top) : 'none',
    yesLine: scope.querySelector('.dz-yes')?.textContent ?? '', buttons, under, fail, words: words.replace(/\\s+/g, ' ').trim().slice(0, 900),
    dom: { url: location.href, overflow: document.documentElement.scrollWidth > w, overflowing } };
})()`;

/** A board of its own in a new folder, the card's frames and the Sign-off project's icon beside it; returns the folder, the board and its CLI. */
const seed = () => {
  const dir = mkdtempSync(join(tmpdir(), 'so-ask-')), board = join(dir, 'board.json');
  const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
    XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
  const cli = (...args) => spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120000, env });
  mkdirSync(join(dir, 'design'));
  writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
  for (const r of ['today', 'built', 'target']) for (const t of ['light', 'dark']) copyFileSync(join(frames, `${r}.${t}.webp`), join(dir, 'design', `${r}.${t}.webp`));
  if (existsSync(join(frames, 'composite.light.webp'))) copyFileSync(join(frames, 'composite.light.webp'), join(dir, 'design', 'composite.light.webp'));
  copyFileSync(join(repo, 'web/icon-192.png'), join(dir, 'sign-off.png'));
  const pin = cli('project', board, '--name', 'sign-off', '--icon', 'sign-off.png');
  const post = (msg, name = 'card') => { writeFileSync(join(dir, `${name}.json`), JSON.stringify(msg, null, 2)); return cli('post', board, '--kind', 'design', '--from', join(dir, `${name}.json`)); };
  return { dir, board, env, cli, post, pin };
};

const prof = mkdtempSync(join(tmpdir(), 'so-ask-chrome-'));
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let ws;
const errors = [], failed = [], report = [], problems = [], shots = [], boards = [];
try {
  // The card as first written, refused one rule at a time, and the card as the rules have it, posted.
  if (after) {
    const s = seed(), lines = [];
    boards.push(s);
    const tried = (what, msg, name) => { const r = s.post(msg, name); lines.push(`$ sign-off-axi post board.json --kind design --from ${name}.json   # ${what}`, (r.stdout + r.stderr).trim(), `exit ${r.status}`, ''); return r; };
    const three = { journeys: [{ id: 'phone', title: 'On a phone', screens: [{ id: 'reports-end', title: 'Reports, scrolled to its end', frames: [frame('today', MORE, 'One More line, clear of the dock'),
      frame('built', MORE, 'One More line, clear of the dock'), frame('target', { x: 0.04, y: 0.79, w: 0.92, h: 0.065 }, 'The target ends at the last row, with no More line')] }] }] };
    assert.equal(tried('the title the owner saw', card({ ...ORIGINAL, ...three }), 'first-title').status, 2);
    assert.equal(tried('the question, with the about the owner saw', card({ about: ORIGINAL.about, ...three }), 'first-about').status, 2);
    assert.equal(tried('the question and a plain about, with the three frames the owner saw', card(three), 'first-frames').status, 2);
    const ok = tried('the card as the new rules have it', card({}), 'card');
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const text = lines.join('\n');
    for (const want of ['must be one question', 'about has', 'look the same']) assert.ok(text.includes(want), `refusals name: ${want}`);
    writeFileSync(join(out, 'refusals.txt'), text + '\n');
  }
  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium opened its DevTools port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
    if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push(x.params.args.map((a) => a.value ?? a.description).join(' '));
    if (x.method === 'Network.responseReceived' && x.params.response.status >= 400) failed.push({ url: x.params.response.url, status: x.params.response.status }); };
  const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  const js = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, `${expression.slice(0, 80)}: ${r.exceptionDetails?.exception?.description}`); return r.result.value; };
  const until = async (expression, what) => { for (let i = 0; i < 80; i++) { if (await js(expression)) return; await wait(100); } assert.fail(`timed out: ${what}`); };
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  const go = async (address, ms = 1200) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: address }); await wait(ms); };
  const facts = {};
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
    const phone = width < 1024, metrics = { width, height: phone ? 844 : 800, deviceScaleFactor: 2, mobile: phone }, name = (state) => `${state}.${side}.${theme}.${width}w`;
    await cdp('Emulation.setDeviceMetricsOverride', metrics);
    await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    // A real tap or click on an element's centre, as a finger or mouse sends it.
    const tap = async (sel) => { const [x, y] = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
      if (phone) { await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
      else for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
    const s = seed(); boards.push(s);
    const posted = after ? s.post(card({})) : s.post({ contract: 1, kind: 'design', schema: 1, key: KEY, filer: 'design-agent', group: 'sign-off', filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), status: 'in_review',
      preview: 'design/composite.light.webp', ...ORIGINAL, journeys: [{ id: 'phone', title: 'On a phone: now, built, the approved look', screens: [{ id: 'reports-end-390', title: 'Reports at its end: More clears the dock; the page fades under it (390)', views: { phone_light: 'design/composite.light.webp' } }] }] });
    assert.equal(posted.status, 0, posted.stdout + posted.stderr);
    const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', s.board, '--port', '0'], { env: s.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; server.stdout.on('data', (b) => (log += b)); server.stderr.on('data', (b) => (log += b));
    let base; for (let i = 0; i < 100 && !base; i++) { await wait(100); base = /http:\/\/127\.0\.0\.1:\d+\//.exec(log)?.[0]; }
    assert.ok(base, `the board answers: ${log}`);
    const scope = phone ? '#reader' : '.dz-grid';
    const capture = async (state) => {
      await wait(400);
      await js(`document.activeElement?.blur?.()`);
      writeFileSync(join(out, `${name(state)}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64')); shots.push(`${name(state)}.png`);
      const m = await js(MEASURE.replace('SCOPE', JSON.stringify(scope)));
      writeFileSync(join(out, `${name(state)}.dom.json`), JSON.stringify({ ...m.dom, console_errors: [...errors], failed_requests: [...failed] }, null, 2) + '\n');
      delete m.dom;
      writeFileSync(join(out, `${name(state)}.measure.json`), JSON.stringify(m, null, 2) + '\n');
      report.push(`${name(state)}: question "${m.question}"; frames ${m.frames.map((f) => `${f.label}${f.yes ? ' (Yes, ringed)' : ''} ${f.pic} area ${f.area} "${f.caption}"`).join(' | ')}; note ${m.note}; yes line "${m.yesLine}"; buttons ${m.buttons.join(', ')}; under 44px ${m.under.length}; failures ${m.fail.length}${m.fail.length ? ': ' + m.fail.join('; ') : ''}`);
      if (after && [m.fail, m.under, errors, failed].some((x) => x.length)) problems.push(`${name(state)}: ${JSON.stringify({ fail: m.fail, under: m.under, errors, failed })}`);
      errors.length = 0; failed.length = 0;
      return m;
    };
    // Designs, then the card: on a phone its row opens the review over the list; on a desk it is the open design.
    await go(`${base}#designs`);
    await until(`!!document.querySelector('#item-${KEY}, .dz-card')`, 'the card listed');
    if (phone) await tap(`#item-${KEY} .ui-row`);
    await until(`!!document.querySelector('${scope} ${after ? '.dzf-row' : '.design-review-preview'}') && [...document.querySelectorAll('${scope} ${after ? '.dzf img' : '.design-review-preview'}')].every((i) => i.complete && i.naturalWidth)`, 'the card drawn');
    facts[`${theme}.${width}`] = { listed: await js(`document.querySelector('main').innerText.replace(/\\s+/g, ' ').trim().slice(0, 400)`) };
    await capture('ask');
    // A note typed beside Yes, then Yes: the answer is approve with the note, as the owner's praise should have been saved.
    await tap(`${scope} textarea`);
    await cdp('Input.insertText', { text: NOTE });
    if (phone) await js(`(document.querySelector('#reader .dz-yes') ?? document.querySelector('#reader .foot')).scrollIntoView({ block: 'end' })`);
    await capture('answer');
    await tap(`${scope} .dz-ink`);
    await until(`!!document.querySelector('${scope} .dz-said') && document.querySelector('${scope} .ui-props')?.textContent.includes('Approved')`, 'the answer saved');
    const answers = readFileSync(join(s.dir, 'board.answers.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((a) => a.key === KEY);
    facts[`${theme}.${width}`].answer = answers.at(-1);
    if (after) { assert.equal(answers.at(-1).answer, 'approve'); assert.equal(answers.at(-1).notes?.[0]?.note, NOTE); assert.equal(answers.at(-1).notes[0].verdict, 'approve'); }
    if (phone) await js(`document.querySelector('#reader .dz-said').scrollIntoView({ block: 'center' })`);
    await capture('approved');
    s.cli('stop', s.board);
    server.kill();
  }
  writeFileSync(join(out, `design-ask.${side}.facts.json`), JSON.stringify(facts, null, 2) + '\n');
  writeFileSync(join(out, `measure.design-ask.${side}.txt`), report.join('\n') + '\n');
  if (after) writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board per cell (own HOME and XDG_*), the sign-off project given its own icon, and the frames of the owner\'s design card "Reports at its end" (390), cropped from its three-column picture into Today, New (built) and Target design.',
    steps: ['Post the card as first written through sign-off-axi post --kind design, one rule at a time: the title the owner saw, then its about, then its three frames; each is refused with exit 2 and its reason (refusals.txt).',
      `Post the card as the new rules have it: the question "${QUESTION}", a plain about, the New (built) and Target design frames with the changed area and a caption each, Yes approving New (built).`,
      'At 390x844 and 1280x800 (2x), light and dark, in a headless Chromium of its own: open Designs and the card (a tap on its row on a phone), and measure the frames, the note and the buttons in the browser.',
      `Type "${NOTE}" in the note beside Yes, then tap Yes: the board's answers file holds approve with that note, and the card reads Approved with what was said.`],
    result: `On a phone and at 1280 px, in light and dark, the design card asks "${QUESTION}" in one line over the two frames side by side, "New (built)" with a check and an ink ring and "Target design", `
      + 'each with the end of the list outlined and the rest of the picture dimmed, and a one-line caption under it; under them the note "A note: optional with Yes, needed for Change" sits right above Yes in ink beside Change, '
      + 'with the line "Yes approves “New (built)”, the frame with the check"; a typed note goes with Yes and the card then reads Approved with that note under What you said.' }, null, 2) + '\n');
  console.log(report.join('\n'));
  if (after) assert.deepEqual(problems, [], 'every capture measures clean');
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  for (const s of boards) { try { s.cli('stop', s.board); } catch {} }
  await wait(300);
  rmSync(prof, { recursive: true, force: true });
  for (const s of boards) rmSync(s.dir, { recursive: true, force: true });
}
