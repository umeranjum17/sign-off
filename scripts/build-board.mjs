// Builds the whiteboard canvas the board page draws with, and completes the licence and notice review that ships beside it.
// npm run build:board  ->  web/board/ (the bundle, the drawing font, NOTICES.txt). It exits 1 when the review finds a package
// with no licence text or a licence that may not ship here; a package that fails is replaced or cut before anything ships.
import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { packagesOf, review } from './board-licences.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'web/board');
/** The one drawing font: every label on a board is set in it, and its subset files are what Excalidraw asks for by name. */
const FONT = { family: 'Excalifont', from: 'node_modules/@excalidraw/excalidraw/dist/prod/fonts/Excalifont' };
const OPTIONS = {
  entryPoints: [join(root, 'scripts/board/entry.js')], bundle: true, splitting: true, format: 'esm', minify: true, outdir: out,
  entryNames: 'board', chunkNames: 'chunks/[name]-[hash]', assetNames: 'fonts/[name]-[hash]', legalComments: 'none', metafile: true, logLevel: 'warning',
  conditions: ['production'], define: { 'process.env.NODE_ENV': '"production"', 'process.env.IS_PREACT': '"false"' },
  loader: { '.woff2': 'file', '.ttf': 'file', '.woff': 'file' },
};

/** The copyright line a WOFF2 font records in its own name table: the table data inside the Brotli stream, read as UTF-16 text. */
export function fontCopyright(file) {
  const bytes = readFileSync(file);
  let at = 48;
  for (let n = bytes.readUInt16BE(12), i = 0; i < n; i++) {
    const flags = bytes[at++], size = () => { let v = 0; for (let c, k = 0; k < 5; k++) { c = bytes[at++]; v = (v << 7) | (c & 127); if (!(c & 128)) return v; } throw new Error('unreadable WOFF2 directory'); };
    if ((flags & 63) === 63) at += 4;
    size();
    if ((flags & 63) === 10 || (flags & 63) === 11) size();
  }
  // The name table's strings are UTF-16: read the copyright record's printable characters and stop where its record ends.
  const text = brotliDecompressSync(bytes.subarray(at)).toString('latin1'), start = text.indexOf('C\x00o\x00p\x00y\x00r\x00i\x00g\x00h\x00t\x00');
  let out = '';
  for (let k = start; start >= 0 && k + 1 < text.length; k += 2) {
    const code = text.charCodeAt(k) | (text.charCodeAt(k + 1) << 8);
    if (code < 32 || code > 126) break;
    out += String.fromCharCode(code);
  }
  return out.trim();
}

const bytesIn = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? bytesIn(join(dir, e.name)) : readFileSync(join(dir, e.name)).length), 0);

/** Build and review the canvas. `write: false` runs the same build and review in memory, which is how the test drives the gate. */
export async function canvas({ write = true } = {}) {
  const fontDir = join(root, FONT.from), fonts = readdirSync(fontDir).filter((f) => f.endsWith('.woff2')).sort();
  if (!fonts.length) throw new Error(`no ${FONT.family} font file in ${FONT.from}`);
  const copyright = fontCopyright(join(fontDir, fonts[0]));
  if (write) rmSync(out, { recursive: true, force: true });
  const built = await esbuild.build({ ...OPTIONS, write });
  const packages = packagesOf(built.metafile, root);
  const verdict = review(packages, root, [{ family: FONT.family, file: `fonts/${FONT.family}/ (${fonts.length} subset files)`, copyright }]);
  const result = { packages, fonts, copyright, metafile: built.metafile, ...verdict };
  if (!write || verdict.problems.length) return { ...result, bytes: 0 };
  mkdirSync(join(out, 'fonts', FONT.family), { recursive: true });
  for (const f of fonts) writeFileSync(join(out, 'fonts', FONT.family, f), readFileSync(join(fontDir, f)));
  writeFileSync(join(out, 'NOTICES.txt'), verdict.text);
  return { ...result, bytes: bytesIn(out) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const got = await canvas();
  if (got.problems.length) {
    console.error(`The licence and notice review FAILED, so nothing ships:\n  ${got.problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`board canvas: ${got.packages.length} packages and the ${FONT.family} font reviewed; ${(got.bytes / 1e6).toFixed(2)} MB in ${relative(root, out)}, notices in web/board/NOTICES.txt`);
}
