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

/** The package a bundled file belongs to, from its path inside node_modules; null for sign-off's own files. */
export function packageOf(path) {
  const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(path);
  return m ? m[1] : null;
}

/** Every bundled package with its version, licence id and the licence and notice files it carries. */
export function packagesOf(metafile, root) {
  const names = [...new Set(Object.keys(metafile.inputs).map(packageOf).filter(Boolean))].sort();
  return names.map((name) => {
    const dir = join(root, 'node_modules', name), pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
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
  const problems = [], licenceTexts = new Map(), sections = [];
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
      if (!licenceTexts.has(where)) licenceTexts.set(where, text);
      const names = byLicence.get(where) ?? [];
      names.push(`${p.name}@${p.version}`);
      byLicence.set(where, names);
    }
    for (const f of p.notices) sections.push(`NOTICE file of ${p.name}@${p.version} (${f}), as it ships:\n\n${readFileSync(join(p.dir, f), 'utf8').trim()}\n`);
  }
  const lines = ['Licences and notices of the whiteboard canvas (Excalidraw) that ships inside sign-off-axi.', '',
    'Every package the canvas bundle holds is listed here, with the text of the licence it names. A licence id outside the build\'s',
    'allowed list fails the build, and so does a package with no licence text anywhere. Each NOTICE file ships as it is.', '',
    '## Packages, by licence and source', ''];
  for (const [where, names] of [...byLicence].sort()) lines.push(`- ${where}: ${names.sort().join(', ')}`);
  lines.push('');
  for (const [where, text] of [...licenceTexts].sort()) lines.push(`## ${where}`, '', text.trim(), '');
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
