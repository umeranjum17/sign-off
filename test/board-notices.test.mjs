// The licence and notice review of the whiteboard canvas: the build's own review, driven as the build drives it.
// The canvas ships inside sign-off-axi, so the review is the gate: every bundled package is listed with the text of the
// licence it names, every NOTICE file ships, and a package that names a licence outside the allowed list, names none, or
// carries no licence text anywhere stops the build.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const { canvas } = await import(new URL('../scripts/build-board.mjs', import.meta.url).href);
const { review, allows, packagesOf } = await import(new URL('../scripts/board-licences.mjs', import.meta.url).href);

const scratch = mkdtempSync(join(tmpdir(), 'sign-off-notices-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
/** A package folder as the review reads one: its package.json and the licence or notice files it carries. */
const pkg = (name, { license, files = {} }) => {
  const dir = join(scratch, name.replace('/', '__'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...(license !== undefined && { license }) }));
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
  return { name, version: '1.0.0', dir, license: license ?? '', licenses: Object.keys(files).filter((f) => /^licen[cs]e/i.test(f)), notices: Object.keys(files).filter((f) => /^notice/i.test(f)) };
};
const MIT = 'MIT License\n\nCopyright (c) 2026 A Person\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n';

test('the canvas the package ships passes the review, with every package and the drawing font listed', { timeout: 300000 }, async () => {
  const built = await canvas({ write: false });
  assert.deepEqual(built.problems, [], 'the real bundle passes the review');
  assert.ok(built.packages.length > 50, `every bundled package is listed: ${built.packages.length}`);
  assert.equal(built.copyright.startsWith('Copyright'), true, `the font file records its copyright: ${built.copyright}`);
  for (const p of built.packages) assert.match(built.text, new RegExp(`- [^\\n]*: [^\\n]*${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@${p.version.replace(/\./g, '\\.')}`), `${p.name}@${p.version} is listed with its licence`);
  assert.match(built.text, /SIL OPEN FONT LICENSE\n\nVersion 1\.1/, 'the drawing font ships with its licence text, as the licence is written');
  assert.match(built.text, /## The drawing font/, 'the font has its own section of the notices');
  // A NOTICE file a package carries is copied into the notices as it is.
  const dir = join(scratch, 'with-notice');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'noticed', version: '1.0.0', license: 'MIT' }));
  writeFileSync(join(dir, 'LICENSE'), MIT);
  writeFileSync(join(dir, 'NOTICE'), 'This product includes software developed by A Person.\n');
  const noticed = review([{ name: 'noticed', version: '1.0.0', dir, license: 'MIT', licenses: ['LICENSE'], notices: ['NOTICE'] }], root, [{ family: 'Excalifont', file: 'fonts/Excalifont/', copyright: 'Copyright (c) 2024 Excalidraw' }]);
  assert.deepEqual(noticed.problems, []);
  assert.match(noticed.text, /NOTICE file of noticed@1\.0\.0 \(NOTICE\), as it ships:\n\nThis product includes software developed by A Person\./);
});

test('a licence that may not ship here is refused, and so is a package with no licence text', () => {
  const font = [{ family: 'Excalifont', file: 'fonts/Excalifont/', copyright: 'Copyright (c) 2024 Excalidraw' }];
  const gpl = review([pkg('a', { license: 'GPL-3.0', files: { LICENSE: 'GNU GENERAL PUBLIC LICENSE' } })], root, font);
  assert.match(gpl.problems.join('\n'), /a@1\.0\.0 is GPL-3\.0, which is not on the allowed list/);
  const silent = review([pkg('b', {})], root, font);
  assert.match(silent.problems.join('\n'), /b@1\.0\.0 names no licence/);
  const empty = review([pkg('c', { license: 'MIT' })], root, font);
  assert.match(empty.problems.join('\n'), /c@1\.0\.0 carries no licence text/);
  // An expression is read as the question "may this ship?": an OR needs one branch that may, an AND needs all of them.
  assert.equal(allows('MIT OR GPL-3.0'), true);
  assert.equal(allows('MIT AND GPL-3.0'), false);
  assert.equal(allows('(MIT OR Apache-2.0) AND 0BSD'), true);
});

test('the bundle is read from the build: every input file belongs to a package the review names', async () => {
  const built = await canvas({ write: false });
  const names = new Set(built.packages.map((p) => p.name));
  assert.ok(names.has('@excalidraw/excalidraw'), 'the canvas itself is a reviewed package');
  assert.equal(packagesOf({ inputs: { 'src/cli.ts': {} } }, root).length, 0, "sign-off's own files belong to no package");
});
