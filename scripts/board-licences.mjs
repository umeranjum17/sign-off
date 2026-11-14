// The licence and notice review of every package and font the board's canvas bundles, and the notices file it writes.
// A package's own licence file is the text that ships; a package that carries none is named here with the text taken from
// its repository, and the review refuses anything else. A licence id outside ALLOWED, or a package with no text, fails the build.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The licences sign-off may ship inside its own MIT package. Anything else fails the build, and the package is replaced or cut. */
export const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'CC0-1.0', 'Unlicense', 'Zlib', 'MPL-2.0', 'OFL-1.1']);
/** A licence file of a bundled package: its name, and the file where one exists. */
const LICENCE_FILE = /^(licen[cs]e|copying|unlicen[cs]e)([-._](mit|md|txt|apache-2\.0))?$/i;
const NOTICE_FILE = /^notice(\.(md|txt))?$/i;

/**
 * A package that carries no licence file: the text taken from the package's repository, and where from.
 * The text is the licence the package's own field names; only the file is absent.
 */
const SUPPLEMENT = {
  // The package names no licence id, but ships the text of one: the id its own file holds.
  khroma: { license: 'MIT' },
  '@excalidraw/excalidraw': { text: 'excalidraw.txt', from: 'github.com/excalidraw/excalidraw/blob/v0.18.1/LICENSE' },
  'react-remove-scroll-bar': { text: 'react-remove-scroll-bar.txt', from: 'github.com/theKashey/react-remove-scroll-bar/blob/master/LICENSE' },
  // Both name MIT in their package.json and publish no licence file in the package or the repository; the text is the licence they name, with the holder their own author field.
  fastdom: { text: 'fastdom.txt', from: 'github.com/wilsonpage/fastdom (no licence file; text of the licence the package names, holder from its author field)' },
  strictdom: { text: 'strictdom.txt', from: 'github.com/wilsonpage/strictdom (no licence file; text of the licence the package names, holder from its author field)' },
};
const FOR = (name) => SUPPLEMENT[name] ?? (name.startsWith('@radix-ui/') ? { text: 'radix-ui.txt', from: 'github.com/radix-ui/primitives/blob/main/LICENSE' } : undefined);

/** An SPDX licence expression read as the question "may this ship?": an OR needs one branch that may, an AND needs all of them. */
export function allows(expression) {
  const expr = expression.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const ors = expr.split(' OR ');
  if (ors.length > 1) return ors.some(allows);
  return expr.split(' AND ').every((id) => ALLOWED.has(id.replace(/\+$/, '')));
}

/**
 * The package a bundled file belongs to: its folder under the root and its name, taken from the LAST node_modules/ of the path,
 * so a copy nested inside another package (its own version, its own licence) is charged to itself and not to the package that holds it.
 * Null for sign-off's own files.
 */
export function packageOf(path) {
  const m = /^(.*(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(path);
  return m ? { dir: m[1], name: m[2] } : null;
}

/** Every bundled package, one per folder, with its version, licence id and the licence and notice files it carries. */
export function packagesOf(metafile, root) {
  const found = new Map();
  for (const path of Object.keys(metafile.inputs)) {
    const p = packageOf(path);
    if (p) found.set(p.dir, p.name);
  }
  return [...found].sort(([a, x], [b, y]) => x.localeCompare(y) || a.localeCompare(b)).map(([rel, name]) => {
    const dir = join(root, rel), pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const files = readdirSync(dir).filter((f) => (LICENCE_FILE.test(f) || NOTICE_FILE.test(f)) && statSync(join(dir, f)).isFile());
    return {
      name, version: pkg.version, dir,
      license: pkg.license ?? pkg.licenses?.[0]?.type ?? SUPPLEMENT[name]?.license ?? '',
      licenses: files.filter((f) => LICENCE_FILE.test(f)),
      notices: files.filter((f) => NOTICE_FILE.test(f)),
    };
  });
}

/** The review: what ships, what is wrong with it, and the notices text that carries every licence and notice file. */
export function review(packages, root, fonts) {
  const problems = [], sections = [];
  // Per licence and source, each distinct text and the packages it is the text of: the holder is part of the text, so a package whose
  // file names another holder keeps its own text and is never covered by another package's.
  const byLicence = new Map();
  for (const p of packages) {
    const id = p.license.trim();
    // The id the package names is the rule; a package that names none is refused rather than read for its wording.
    if (!id) problems.push(`${p.name}@${p.version} names no licence`);
    else if (!allows(id)) problems.push(`${p.name}@${p.version} is ${id}, which is not on the allowed list`);
    let text = p.licenses.length ? p.licenses.map((f) => readFileSync(join(p.dir, f), 'utf8')).join('\n') : '';
    let from = p.licenses.length ? `the package's own ${p.licenses.join(', ')}` : '';
    if (!text) {
      const supplement = FOR(p.name);
      if (supplement) { text = readFileSync(join(root, 'scripts/board/licences', supplement.text), 'utf8'); from = supplement.from; }
      else problems.push(`${p.name}@${p.version} carries no licence text, and neither the package nor its repository is recorded here`);
    }
    if (text) {
      const where = `${id}${from ? ` (${from})` : ''}`;
      const texts = byLicence.get(where) ?? new Map(), key = text.replace(/\s+/g, ' ').trim(), entry = texts.get(key) ?? { text: text.trim(), names: [] };
      // Two folders holding the same name and version are one package to name.
      if (!entry.names.includes(`${p.name}@${p.version}`)) entry.names.push(`${p.name}@${p.version}`);
      byLicence.set(where, texts.set(key, entry));
    }
    for (const f of p.notices) sections.push(`NOTICE file of ${p.name}@${p.version} (${f}), as it ships:\n\n${readFileSync(join(p.dir, f), 'utf8').trim()}\n`);
  }
  const lines = ['Licences and notices of the whiteboard canvas (Excalidraw) that ships inside sign-off-axi.', '',
    'Every package the canvas bundle holds is listed here, with the text of the licence it names. A licence id outside the build\'s',
    'allowed list fails the build, and so does a package with no licence text anywhere. Each NOTICE file ships as it is.', '',
    '## Packages, by licence and source', ''];
  const groups = [...byLicence].sort(([a], [b]) => a.localeCompare(b))
    .map(([where, texts]) => [where, [...texts.values()].map((e) => ({ text: e.text, names: e.names.sort() })).sort((a, b) => a.names[0].localeCompare(b.names[0]))]);
  for (const [where, entries] of groups) lines.push(`- ${where}: ${[...new Set(entries.flatMap((e) => e.names))].sort().join(', ')}`);
  lines.push('');
  for (const [where, entries] of groups) {
    lines.push(`## ${where}`, '');
    for (const { text, names } of entries) lines.push(`The text, as shipped by ${names.join(', ')}:`, '', text, '');
  }
  lines.push('## The drawing font', '');
  for (const f of fonts) {
    lines.push(`${f.family}, drawn by every label on a board, ships with sign-off-axi as the file ${f.file}, from @excalidraw/excalidraw ${packages.find((p) => p.name === '@excalidraw/excalidraw')?.version ?? ''}.`,
      'It is under the SIL Open Font License 1.1, as its maker states (plus.excalidraw.com/excalifont) and as the font file records:',
      `its own name table reads "${f.copyright}". The licence it names follows in full.`, '',
      readFileSync(join(root, 'scripts/board/licences', 'OFL-1.1.txt'), 'utf8').trim(), '');
  }
  for (const s of sections) lines.push(s);
  if (!fonts.length) problems.push('no drawing font was found to ship');
  return { problems, text: `${lines.join('\n').trim()}\n` };
}
