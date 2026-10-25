import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { documentRevision } from '../dist/store.js';
const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const fixtures = new URL('../fixtures/contract/', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

// The part of a rendered architecture page the post-time check reads: a drawing with a viewBox and sized text.
const page = (width, sizes, extra = '') => `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>
<svg viewBox="0 0 ${width} 300" role="img">${sizes.map((s, i) => `<text x="10" y="${20 + i * 20}" font-size="${s}">Step ${i + 1}</text>`).join('')}${extra}</svg></body></html>`;

test('a diagram on a plan: post reads its page, the board serves it in the frame, and a wide, small or branded page is refused', async () => {
  const dir = join(scratch, 'diagram'), board = join(dir, 'board.json'), env = { ...process.env, HOME: join(scratch, 'home') };
  mkdirSync(join(dir, 'diagrams'), { recursive: true });
  const run = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env, cwd: dir });
  const plan = JSON.parse(readFileSync(join(fixtures, 'plan.v2', 'valid-full.json')));
  const view = (src) => [{ label: 'Today', src }];
  const post = (m) => spawnSync('node', [cli, 'post', board, '--kind', 'plan', '--from', '-'], { encoding: 'utf8', env, cwd: dir, input: JSON.stringify(m) });
  const withDiagram = (src) => ({ ...plan, visual: { ...plan.visual, diagram: view(src) } });
  writeFileSync(join(dir, 'diagrams', 'ok.html'), page(320, [11, 11]));
  writeFileSync(join(dir, 'diagrams', 'wide.html'), page(796, [11, 11]));
  writeFileSync(join(dir, 'diagrams', 'small.html'), page(360, [11, 9]));
  writeFileSync(join(dir, 'diagrams', 'legend.html'), page(320, [11, 10]));
  writeFileSync(join(dir, 'diagrams', 'brand.html'), page(320, [11], '<g data-brand-mark="vue"></g>'));
  writeFileSync(join(dir, 'diagrams', 'flat.html'), '<!doctype html><p>No drawing</p>');
  mkdirSync(join(scratch, 'outside'));
  writeFileSync(join(scratch, 'outside', 'o.html'), page(320, [11]));
  symlinkSync(join(scratch, 'outside', 'o.html'), join(dir, 'diagrams', 'link.html'));
  for (const [src, error] of [['diagrams/wide.html', /text of 5\.2 px at 390 \(11 in a 796 wide drawing\), under 12/], ['diagrams/small.html', /text of 9\.4 px at 390 \(9 in a 360 wide drawing\)/],
    ['diagrams/legend.html', /text of 11\.7 px at 390 \(10 in a 320 wide drawing\)/], ['diagrams/brand.html', /uses brand marks/], ['diagrams/flat.html', /no <svg> drawing with a viewBox/], ['diagrams/gone.html', /diagrams\/gone\.html\\" is not there/],
    ['diagrams/link.html', /leads outside the board file's folder/], ['../x.html', /visual\.diagram\[0\]\.src/], ['diagrams/ok.png', /visual\.diagram\[0\]\.src/]]) {
    const refused = post(withDiagram(src));
    assert.equal(refused.status, 2, `${src}: ${refused.stdout}`);
    assert.match(refused.stdout, error);
  }
  assert.match(post({ ...plan, visual: { ...plan.visual, diagram: [] } }).stdout, /visual\.diagram must list 1 to 3/);
  // The same plan with a diagram on the picture, a section and an item posts, and the views are counted in that order.
  const sec = plan.sections[0], item = { ...sec.items[0], diagram: view('diagrams/ok.html') };
  const full = { ...withDiagram('diagrams/ok.html'), sections: [{ ...sec, diagram: view('diagrams/ok.html'), items: [item, ...sec.items.slice(1)] }, ...plan.sections.slice(1)] };
  const posted = post(full);
  assert.equal(posted.status, 0, posted.stdout);
  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], { cwd: tmpdir(), env });
  try {
    const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    for (const n of [0, 1, 2]) {
      const res = await fetch(new URL(`/mock/local/${plan.key}~diagram.${n}/ok.html`, url));
      assert.equal(res.status, 200, `diagram.${n}`);
      assert.match(res.headers.get('content-security-policy'), /sandbox allow-scripts/);
      assert.match(await res.text(), /<svg viewBox="0 0 320 300"/);
    }
    assert.equal((await fetch(new URL(`/mock/local/${plan.key}~diagram.3/ok.html`, url))).status, 404);
  } finally { proc.kill(); }
});

test('a diagram is pinned like media: the board serves only the file that was posted, the revision covers its content, and Full size has its way back', async () => {
  const dir = join(scratch, 'pin'), env = { ...process.env, HOME: join(scratch, 'home') };
  mkdirSync(join(dir, 'diagrams'), { recursive: true });
  const plan = JSON.parse(readFileSync(join(fixtures, 'plan.v3', 'valid-full.json')));
  const board = (name) => join(dir, `${name}.json`);
  const post = (name, src) => spawnSync('node', [cli, 'post', board(name), '--kind', 'plan', '--from', '-'], { encoding: 'utf8', env, cwd: dir, input: JSON.stringify({ ...plan, visual: { ...plan.visual, diagram: [{ label: 'Today', src }] } }) });
  const serve = async (name) => {
    const proc = spawn('node', [cli, 'serve', board(name), '--port', '0'], { cwd: tmpdir(), env });
    const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    return { proc, url, view: (query = '') => fetch(new URL(`/mock/local/${plan.key}~diagram.0/${basename(src)}${query}`, url)), revision: async () => ((await (await fetch(new URL('/api/decisions', url))).json()).decisions).find((d) => d.key === plan.key).engagement.revision };
  };
  const src = 'diagrams/a.html', first = page(320, [12, 12]);
  writeFileSync(join(dir, src), first);
  assert.equal(post('a', src).status, 0);
  // The stored view carries the file's sha256 and byte size.
  const view = JSON.parse(readFileSync(board('a'), 'utf8')).items[0].visual.diagram[0];
  assert.deepEqual([view.sha256, view.bytes], [createHash('sha256').update(first).digest('hex'), Buffer.byteLength(first)]);
  const a = await serve('a');
  try {
    assert.equal((await a.view()).status, 200);
    const revision = await a.revision();
    // Changed after posting, to a different size or to the same size: refused either way, and served again once it is the posted file.
    writeFileSync(join(dir, src), page(320, [12, 12, 12]));
    assert.equal((await a.view()).status, 404);
    writeFileSync(join(dir, src), first.replace('Step 1', 'Step X'));
    assert.equal(Buffer.byteLength(first.replace('Step 1', 'Step X')), view.bytes);
    const refused = await a.view();
    assert.equal(refused.status, 404);
    assert.match((await refused.json()).error, /changed since it was posted/);
    writeFileSync(join(dir, src), first);
    assert.equal((await a.view()).status, 200);
    // The revision covers the file: the stored plan hashes to another revision when only its diagram file's content changed, and to the same one when it did not.
    const stored = JSON.parse(readFileSync(board('a'), 'utf8')).items[0], pinned = (hash) => ({ ...stored, visual: { ...stored.visual, diagram: [{ ...view, sha256: hash }] } });
    assert.equal(documentRevision(stored), revision);
    assert.equal(documentRevision(pinned(view.sha256)), revision);
    assert.notEqual(documentRevision(pinned(createHash('sha256').update(first.replace('Step 1', 'Step X')).digest('hex'))), revision);
    // Posting the plan over a file with other content pins that content instead.
    writeFileSync(join(dir, src), first.replace('Step 1', 'Step X'));
    assert.equal(post('b', src).status, 0);
    writeFileSync(join(dir, src), first);
    assert.notEqual(JSON.parse(readFileSync(board('b'), 'utf8')).items[0].visual.diagram[0].sha256, view.sha256);
    // A pin that does not match the file is not taken from the message: post pins what is there.
    const forged = spawnSync('node', [cli, 'post', board('d'), '--kind', 'plan', '--from', '-'], { encoding: 'utf8', env, cwd: dir, input: JSON.stringify({ ...plan, visual: { ...plan.visual, diagram: [{ label: 'Today', src, sha256: '0'.repeat(64), bytes: 1 }] } }) });
    assert.equal(forged.status, 0, forged.stdout);
    assert.deepEqual(JSON.parse(readFileSync(board('d'), 'utf8')).items[0].visual.diagram[0], view);
    // Full size is the page by itself: a way back to the plan, and on a phone's drawing-alone page the page sized to the drawing.
    for (const query of ['?theme=dark', '?theme=dark&embed=1']) {
      const html = await (await a.view(query)).text();
      assert.match(html, new RegExp(`<script data-back="/#waiting/${plan.key}" data-label="Back to the plan">`));
      assert.match(html, /if \(parent !== window\) return;/);
    }
  } finally { a.proc.kill(); }
  const bad = spawnSync('node', [cli, 'post', board('f'), '--kind', 'plan', '--from', '-'], { encoding: 'utf8', env, cwd: dir, input: JSON.stringify({ ...plan, visual: { ...plan.visual, diagram: [{ label: 'Today', src, sha256: 'xyz' }] } }) });
  assert.equal(bad.status, 2);
  assert.match(bad.stdout, /visual\.diagram\[0\]\.sha256/);
});

test('a gallery on a report: post pins each frame, the board serves it (and a light copy of an image), and a frame with no caption or device, a missing file or a changed one is refused', async () => {
  const dir = join(scratch, 'gallery'), board = join(dir, 'board.json'), env = { ...process.env, HOME: join(scratch, 'home') };
  mkdirSync(join(dir, 'gallery'), { recursive: true });
  const shot = readFileSync(new URL('../fixtures/evidence/product-board.png', import.meta.url));
  writeFileSync(join(dir, 'gallery', 'a-phone.png'), shot);
  writeFileSync(join(dir, 'gallery', 'a-desk.html'), '<!doctype html><title>desk</title><p>A desk page</p>');
  const report = JSON.parse(readFileSync(join(fixtures, 'report.v5', 'valid-full.json')));
  const frame = (device, src, caption = 'A frame') => ({ device, src, ...(caption && { caption }) });
  const withGallery = (frames, extra = {}) => ({ ...report, sections: report.sections.map((s, n) => n ? s : { ...s, gallery: [{ label: 'Option A', model: 'Sonnet 5.5', ran: '2026-10-24T09:30:00Z', frames, ...extra }] }) });
  const post = (m) => spawnSync('node', [cli, 'post', board, '--kind', 'report', '--from', '-'], { encoding: 'utf8', env, cwd: dir, input: JSON.stringify(m) });
  for (const [m, error] of [
    [withGallery([frame('phone', 'gallery/a-phone.png', null)]), /gallery\[0\]\.frames\[0\]\.caption must be text/],
    [withGallery([{ src: 'gallery/a-phone.png', caption: 'A frame' }]), /frames\[0\]\.device is required/],
    [withGallery([frame('tablet', 'gallery/a-phone.png')]), /frames\[0\]\.device \\"tablet\\" is not one of phone, desktop/],
    [withGallery([frame('phone', 'gallery/a-phone.png'), frame('phone', 'gallery/a-phone.png')]), /frames\[1\]\.device repeats phone/],
    [withGallery([frame('phone', 'gallery/gone.png')]), /gallery\/gone\.png\\" is not there/],
    [withGallery([frame('phone', '../x.png')]), /frames\[0\]\.src/], [withGallery([frame('phone', 'gallery/a-phone.gif')]), /frames\[0\]\.src/],
    [withGallery([frame('phone', 'gallery/a-phone.png')], { model: undefined }), /gallery\[0\]\.model must be text/], [withGallery([frame('phone', 'gallery/a-phone.png')], { ran: 'yesterday' }), /gallery\[0\]\.ran/],
  ]) {
    const refused = post(m);
    assert.equal(refused.status, 2, refused.stdout);
    assert.match(refused.stdout, error);
  }
  const posted = post(withGallery([frame('phone', 'gallery/a-phone.png'), frame('desktop', 'gallery/a-desk.html')]));
  assert.equal(posted.status, 0, posted.stdout);
  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], { cwd: tmpdir(), env });
  try {
    const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    const whole = await fetch(new URL(`/mock/local/${report.key}~gallery.0/a-phone.png`, url));
    assert.equal(whole.status, 200); assert.equal(whole.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await whole.arrayBuffer()), shot);
    const light = await fetch(new URL(`/mock/local/${report.key}~gallery.0/a-phone.png?v=light`, url));
    assert.equal(light.status, 200); assert.ok(Number(light.headers.get('content-length')) <= shot.length);
    const page = await fetch(new URL(`/mock/local/${report.key}~gallery.1/a-desk.html`, url));
    assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /sandbox allow-scripts/);
    assert.equal((await fetch(new URL(`/mock/local/${report.key}~gallery.2/a-phone.png`, url))).status, 404);
    // The pin: a frame changed after posting is refused, not shown.
    writeFileSync(join(dir, 'gallery', 'a-phone.png'), Buffer.concat([shot, Buffer.from([0])]));
    assert.equal((await fetch(new URL(`/mock/local/${report.key}~gallery.0/a-phone.png`, url))).status, 404);
  } finally { proc.kill(); }
  // report init --gallery writes a gallery of FILL: lines that post refuses until they are filled.
  const init = spawnSync('node', [cli, 'report', 'init', 'rep', '--purpose', 'research', '--gallery'], { encoding: 'utf8', env, cwd: dir });
  assert.equal(init.status, 0, init.stdout);
  const made = JSON.parse(readFileSync(join(dir, 'rep', 'report.json'), 'utf8'));
  assert.deepEqual(made.sections[0].gallery[0].frames.map((f) => f.device), ['phone', 'desktop']);
  assert.match(post(made).stdout, /FILL:/);
});

test('the report kit: a section\'s blocks are checked, post pins their files after the gallery frames, the board serves them (a film by range), and a repeated summary is warned about', async () => {
  const dir = join(scratch, 'kit'), board = join(dir, 'board.json'), env = { ...process.env, HOME: join(scratch, 'home') };
  mkdirSync(join(dir, 'kit'), { recursive: true });
  const shot = readFileSync(new URL('../fixtures/evidence/product-board.png', import.meta.url)), film = Buffer.alloc(3000, 7);
  for (const f of ['a.png', 'b.png', 'poster.png', 'g.png', 'neutral.png']) writeFileSync(join(dir, 'kit', f), shot);
  writeFileSync(join(dir, 'kit', 'film.mp4'), film);
  writeFileSync(join(dir, 'kit', 'report.md'), '# The same report');
  writeFileSync(join(scratch, 'kit-outside.html'), 'Outside');
  symlinkSync(join(scratch, 'kit-outside.html'), join(dir, 'kit', 'escape.html'));
  const report = JSON.parse(readFileSync(join(fixtures, 'report.v5', 'valid-full.json')));
  const blocks = [
    { type: 'callout', tone: 'warn', title: 'Not measured', text: 'How much of the plan\'s window this took.' },
    { type: 'beats', beats: [{ image: 'kit/a.png', time: '0:00', title: 'The pain', text: 'One line.' }, { image: 'kit/b.png', title: 'The fix', text: 'Another line.' }] },
    { type: 'video', src: 'kit/film.mp4', poster: 'kit/poster.png', length: '0:10', caption: 'The film.' },
    { type: 'table', columns: ['Measured', 'A', 'B', 'C', 'D', 'E', 'F'], rows: [[{ text: 'Calls', rowspan: 2 }, { text: '3', colspan: 2 }, '1'], ['4', '5', '6', '7', '8', '9']] },
    { type: 'compare', before: { image: 'kit/a.png', caption: 'As filed' }, after: { image: 'kit/b.png', caption: 'In the kit' } },
    { type: 'evidence', rows: [{ image: 'kit/a.png', title: 'Line wrapped', note: 'Version 1', status: 'fixed' }, { title: 'Sound missing', status: 'waiting' }] },
    { type: 'image', src: 'kit/neutral.png', caption: 'The original reference', alt: 'A board screen' },
    { type: 'file', src: 'kit/report.md', caption: 'The full report' },
  ];
  const gallery = [{ label: 'Option A', model: 'Sonnet 5.5', ran: '2026-10-24T09:30:00Z', frames: [{ device: 'phone', src: 'kit/g.png', caption: 'A frame' }] }];
  const withBlocks = (b, extra = {}, about) => ({ ...report, ...(about && { about }), sections: report.sections.map((s, n) => n ? s : { ...s, blocks: b, ...extra }) });
  const post = (m) => spawnSync('node', [cli, 'post', board, '--kind', 'report', '--from', '-'], { encoding: 'utf8', env, cwd: dir, input: JSON.stringify(m) });
  const swap = (n, o) => blocks.map((b, i) => (i === n ? { ...b, ...o } : b));
  for (const [m, error] of [
    [withBlocks([{ type: 'gallery' }]), /blocks\[0\]\.type \\"gallery\\" is not one of callout, beats/],
    [withBlocks(swap(0, { tone: 'loud' })), /blocks\[0\]\.tone \\"loud\\" is not one of note, warn, ask/],
    [withBlocks(swap(0, { colour: 'blue' })), /blocks\[0\]\.colour is not a field there/],
    [withBlocks(swap(1, { beats: [blocks[1].beats[0]] })), /blocks\[1\]\.beats must list 2 to 12/],
    [withBlocks(swap(2, { src: 'kit/film.mov' })), /blocks\[2\]\.src .* must be a relative a \.mp4 or \.webm path/],
    [withBlocks(swap(3, { rows: [[{ text: 'Calls', colspan: 21 }]] })), /colspan must be an integer from 1 to 20/],
    [withBlocks(swap(3, { rows: [[{ text: 'Calls', rowspan: 2 }]] })), /rowspan must be an integer from 1 to 1/],
    [withBlocks(swap(6, { src: '../outside.png' })), /must be a relative/],
    [withBlocks(swap(7, { src: 'kit/escape.html' })), /leads outside/],
    [withBlocks(swap(4, { after: undefined })), /blocks\[4\]\.after is required/],
    [withBlocks(swap(5, { rows: [{ title: 'No status' }] })), /blocks\[5\]\.rows\[0\]\.status is required/],
    [withBlocks(swap(1, { beats: [{ image: 'kit/gone.png', title: 'x', text: 'y' }, blocks[1].beats[1]] })), /kit\/gone\.png\\" is not there/],
  ]) {
    const refused = post(m);
    assert.equal(refused.status, 2, refused.stdout);
    assert.match(refused.stdout, error);
  }
  const posted = post(withBlocks(blocks, { gallery }, 'A different summary that shares nothing with the opening of the section below it.'));
  assert.equal(posted.status, 0, posted.stdout);
  assert.doesNotMatch(posted.stderr, /says again/);
  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], { cwd: tmpdir(), env });
  try {
    const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    // The gallery's one frame is gallery.0; the section's files follow it in the order the blocks name them: a, b, poster, film.
    const get = (n, name, init) => fetch(new URL(`/mock/local/${report.key}~gallery.${n}/${name}`, url), init);
    assert.deepEqual(Buffer.from(await (await get(0, 'g.png')).arrayBuffer()), shot);
    for (const [n, name] of [[1, 'a.png'], [2, 'b.png'], [3, 'poster.png']]) assert.deepEqual(Buffer.from(await (await get(n, name)).arrayBuffer()), shot, name);
    const range = await get(4, 'film.mp4', { headers: { range: 'bytes=0-9' } });
    assert.equal(range.status, 206); assert.equal(range.headers.get('content-type'), 'video/mp4'); assert.equal((await range.arrayBuffer()).byteLength, 10);
    assert.deepEqual(Buffer.from(await (await get(5, 'neutral.png')).arrayBuffer()), shot);
    const download = await get(6, 'report.md');
    assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition'), /attachment/);
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff'); assert.equal(await download.text(), '# The same report');
    assert.equal((await get(6, 'neutral.png')).status, 404);
    writeFileSync(join(dir, 'kit', 'report.md'), '# Changed');
    assert.equal((await get(6, 'report.md')).status, 404);
    assert.equal((await get(7, 'a.png')).status, 404);
    writeFileSync(join(dir, 'kit', 'a.png'), Buffer.concat([shot, Buffer.from([0])]));
    assert.equal((await get(1, 'a.png')).status, 404);
  } finally { proc.kill(); }
  // A first paragraph that repeats the summary is warned about, never refused.
  const echo = post({ ...withBlocks(blocks), key: 'echo', about: 'The app needs a push for new answers before the beta on 1 Nov.', sections: report.sections.map((s) => ({ ...s })) });
  assert.equal(echo.status, 0, echo.stdout);
  assert.match(echo.stderr, /warning: .*sections\[0\]\.body says again what "about" already says/);
});

test('document layout preserves authored text, inline local links and block order without a guided intro', async () => {
  const dir = join(scratch, 'document'), board = join(dir, 'board.json'), env = { ...process.env, HOME: join(scratch, 'home') };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'original.md'), '# Original words');
  writeFileSync(join(dir, 'frame.png'), readFileSync(new URL('../fixtures/evidence/product-board.png', import.meta.url)));
  const base = JSON.parse(readFileSync(join(fixtures, 'report.v5', 'valid-full.json')));
  const report = { ...base, key: 'original-document', schema: 4, layout: 'document', purpose: 'other', sections: [
    { id: 'original', stage: 'found', heading: '', body: '', blocks: [{ type: 'text', level: 2, text: 'The answer' }, { type: 'text', text: 'The [full report](original.md), unchanged.' }, { type: 'image', src: 'frame.png', full: 'frame.png' }] },
  ] };
  for (const field of ['understood', 'visual', 'next']) delete report[field];
  const post = (m) => spawnSync('node', [cli, 'post', board, '--kind', 'report', '--from', '-'], { encoding: 'utf8', env, cwd: dir, input: JSON.stringify(m) });
  assert.equal(post(report).status, 0);
  const stored = JSON.parse(readFileSync(board)).items[0];
  assert.equal(stored.sections[0].blocks[1].text, 'The [full report](original.md), unchanged.');
  assert.equal(stored.sections[0].pins[0].src, 'original.md');
  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], { cwd: tmpdir(), env });
  try {
    const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    const state = await (await fetch(new URL('/api/decisions', url))).json(), d = state.decisions.find((d) => d.key === report.key);
    assert.equal(d.layout, 'document'); assert.equal(d.visual, undefined); assert.equal(d.next, undefined);
    const link = new URL(`/mock/local/${report.key}~gallery.0/original.md?download=1`, url);
    const downloaded = await fetch(link); assert.match(downloaded.headers.get('content-disposition'), /attachment/);
    assert.equal(await downloaded.text(), '# Original words');
    assert.equal((await fetch(new URL(`/mock/local/${report.key}~gallery.0/original.md`, url))).status, 404);
  } finally { proc.kill(); }
  const bad = { ...report, key: 'bad-document', sections: [{ ...report.sections[0], blocks: [{ type: 'text', text: '[No](../outside.md)' }] }] };
  assert.match(post(bad).stdout, /must be a relative file path/);
});
