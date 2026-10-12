import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export type Option = { value: string; label: string };
export type MockRef = { value: string; path: string };
export type MediaRef = { path: string; sha256: string; bytes: number };
export type Chapter = { at: number; title: string };
export type EvidenceLink = { run_id: string; commit: string; outcome: string; repro: string; proof: string; evidence: string };
export type Decision = {
  key: string; title: string; about?: string; detail?: string; options: Option[];
  recommend_value?: string; default_if_silent?: string; close: string; evidence?: EvidenceLink;
  type: string; tradeoff?: string; mocks?: MockRef[]; number?: number; media?: MediaRef[]; link?: string; view?: string; chapters?: Chapter[];
};
export type Answer = { key: string; answer: string; label: string; close: string; at: string; note?: string };
export type Round = { key: string; note: string; at: string };

/** A problem with the decisions file; the CLI exits 2 and the server answers 422/409 with this message. */
export class InputError extends Error {}

const YES_NO: Option[] = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
const VERDICTS: Option[] = [{ value: 'pass', label: 'Pass' }, { value: 'fail', label: 'Fail' }, { value: 'needs-work', label: 'Needs work' }];
export const MEDIA_MAX = 12;
/** Item types whose files post copies into evidence/<number>/: how many, and which kinds. An explainer is one narrated video. */
const STORED: Record<string, [number, string, RegExp]> = {
  evidence: [MEDIA_MAX, 'files', /\.(png|jpe?g|webp|mp4|webm)$/i],
  explainer: [1, '.mp4 or .webm video', /\.(mp4|webm)$/i],
};
export const CHAPTERS_MAX = 12;
const isText = (v: unknown) => typeof v === 'string';
const isKey = (v: unknown) => isText(v) && /^[A-Za-z0-9._-]{1,128}$/.test(v as string);
const ONE_OF: Record<string, unknown[]> = { close: ['done', 'release'] };
export const NOTE_MAX = 500;
const TRADEOFF_MAX = 1000;
const VIEWS: Record<string, [string, RegExp]> = { diagram: ['.svg, .png, .jpg, .jpeg or .webp', /\.(svg|png|jpe?g|webp)$/i], interactive: ['.html', /\.html$/i] };

/** A board's raw items: schema 2 `items`, or a 0.1.0 schema 1 `decisions` list, whose entries read as decision items. `extra` keeps any other top-level fields. */
export function readItems(path: string): { schema: 1 | 2; items: any[]; extra: Record<string, unknown> } {
  let doc: any;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e: any) {
    throw new InputError(e.code ? `cannot read ${resolve(path)}: ${e.code}` : `${basename(path)}: invalid JSON: ${e.message}`);
  }
  const extra = { ...doc };
  delete extra.schema;
  delete extra.items;
  delete extra.decisions;
  if (doc?.schema === 2 && Array.isArray(doc.items)) return { schema: 2, items: doc.items, extra };
  if (doc?.schema === 1 && Array.isArray(doc.decisions)) return { schema: 1, items: doc.decisions, extra };
  throw new InputError(`${basename(path)}: needs "schema": 2 with an "items" list, or a 0.1.0 board with "schema": 1 and a "decisions" list`);
}

/** Writes the board as schema 2 through a temp file and a rename, keeping its other top-level fields. A schema 1 board is first kept once as <board>.schema-1.bak. Callers hold the board lock. */
export function writeItems(path: string, items: object[]): void {
  const tmp = `${path}.${process.pid}.tmp`, old = existsSync(path) ? readItems(path) : undefined;
  if (old?.schema === 1) {
    const bak = `${path}.schema-1.bak`, bakTmp = `${bak}.${process.pid}.tmp`;
    writeFileSync(bakTmp, readFileSync(path), { mode: 0o600 });
    if (existsSync(bak)) rmSync(bakTmp, { force: true });
    else renameSync(bakTmp, bak);
  }
  writeFileSync(tmp, `${JSON.stringify({ ...old?.extra, schema: 2, items }, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

export function loadDecisions(path: string): Decision[] {
  const name = basename(path), { schema, items } = readItems(path), list = schema === 1 ? 'decisions' : 'items';
  const seen = new Map<string, number>();
  return items.map((d: any, i: number): Decision => {
    const bad = (field: string, rule: string) => new InputError(`${name}: ${list}[${i}] (key ${JSON.stringify(d?.key)}): ${field} ${rule}`);
    if (!isKey(d?.key)) throw bad('key', 'must be 1-128 of A-Z a-z 0-9 . _ -');
    if (seen.has(d.key)) throw bad('key', `repeats ${list}[${seen.get(d.key)}]`);
    seen.set(d.key, i);
    if (!isText(d.title) || !d.title.trim()) throw bad('title', 'must be non-empty text');
    for (const f of ['about', 'detail']) if (d[f] !== undefined && !isText(d[f])) throw bad(f, 'must be text');
    if (d.evidence !== undefined && (!d.evidence || !/^[A-Za-z0-9._-]{1,128}$/.test(d.evidence.run_id ?? '')
      || !/^[a-f0-9]{40}$/.test(d.evidence.commit ?? '')
      || ['outcome', 'repro', 'proof', 'evidence'].some((f) => !isText(d.evidence[f]) || !d.evidence[f].trim() || d.evidence[f].length > 1000))) {
      throw bad('evidence', 'must name a done-done run, full commit, and four Checks lines');
    }
    // Any lowercase type word loads; the page shows a plain card for a type it has no renderer for.
    if (d.type !== undefined && !(isText(d.type) && /^[a-z][a-z0-9-]{0,31}$/.test(d.type))) throw bad('type', 'must be a lowercase word such as decision or design');
    for (const [f, allowed] of Object.entries(ONE_OF)) if (d[f] !== undefined && !allowed.includes(d[f])) throw bad(f, `must be ${allowed.join(' or ')}`);
    const stored = Object.hasOwn(STORED, d.type ?? '') ? STORED[d.type] : undefined;
    if (stored) {
      const [max, kinds, ext] = stored;
      if (!Array.isArray(d.media) || !d.media.length || d.media.length > max || !d.media.every((m: any) => isText(m?.path)
        && /^evidence\/\d+\/\w[\w-]*\.\w+$/.test(m.path) && ext.test(m.path) && /^[a-f0-9]{64}$/.test(m.sha256 ?? '') && Number.isInteger(m.bytes) && m.bytes >= 0)) {
        throw bad('media', `must list ${max > 1 ? `1 to ${max}` : 'one'} ${kinds} under evidence/<number>/, each with its sha256 and bytes`);
      }
    }
    if (d.type === 'explainer' && d.chapters !== undefined && (!Array.isArray(d.chapters) || !d.chapters.length || d.chapters.length > CHAPTERS_MAX
      || !d.chapters.every((c: any, n: number) => Number.isInteger(c?.at) && c.at >= 0 && (!n || c.at > d.chapters[n - 1].at) && isText(c.title) && c.title.trim() && c.title.length <= 120))) {
      throw bad('chapters', `must list 1 to ${CHAPTERS_MAX} items, each a start in whole seconds after the one before and a title of 120 characters or fewer`);
    }
    if (d.type === 'evidence') {
      if (!Number.isInteger(d.number) || d.number < 1) throw bad('number', 'must be a whole number from 1');
      if (d.link !== undefined && !(isText(d.link) && /^(https?:\/\/\S{1,500}|[a-f0-9]{7,40})$/.test(d.link))) throw bad('link', 'must be an http(s) link or a commit hash');
    }
    // A ladder rung: a diagram image, or an interactive page the board frames in a sandbox.
    const views = Object.hasOwn(VIEWS, d.type ?? '') ? VIEWS[d.type] : undefined;
    if (views && !(isText(d.view) && d.view.length <= 256 && /^[^?#]+$/.test(d.view) && views[1].test(d.view))) throw bad('view', `must be a board-relative ${views[0]} file`);
    const options = d.options ?? (d.type === 'evidence' ? VERDICTS : YES_NO);
    if (!Array.isArray(options) || options.length < 2 || options.length > 6
      || !options.every((o) => isKey(o?.value) && isText(o.label) && o.label.trim())) {
      throw bad('options', 'must be 2 to 6 items, each a value of 1-128 of A-Z a-z 0-9 . _ - and a label');
    }
    const values = options.map((o: Option) => o.value);
    if (new Set(values).size < values.length) throw bad('options', 'values must be unique');
    for (const f of ['recommend_value', 'default_if_silent']) if (d[f] !== undefined && !values.includes(d[f])) throw bad(f, `must be one of ${values.join(', ')}`);
    if (d.tradeoff !== undefined && (!isText(d.tradeoff) || !d.tradeoff.trim() || d.tradeoff.length > TRADEOFF_MAX)) throw bad('tradeoff', `must be text of ${TRADEOFF_MAX} characters or fewer`);
    if (d.mocks !== undefined) {
      if (!Array.isArray(d.mocks) || !d.mocks.length || d.mocks.length > 6
        || !d.mocks.every((m: any) => isKey(m?.value) && isText(m?.path) && m.path.trim() && m.path.length <= 256 && /^[^?#]+(\.html\?variant=[A-Za-z0-9._-]{1,64})?$/i.test(m.path))) {
        throw bad('mocks', 'must list up to 6 items, each an option value and a board-relative mock path (an .html page may end in ?variant=<name>)');
      }
      const targets = d.mocks.map((m: MockRef) => m.value);
      if (new Set(targets).size < targets.length) throw bad('mocks', 'option values must be unique');
      for (const m of d.mocks) if (!values.includes(m.value)) throw bad('mocks', `value ${m.value} is not one of ${values.join(', ')}`);
    }
    return {
      key: d.key, title: d.title, about: d.about, detail: d.detail, options: options.map((o: Option) => ({ value: o.value, label: o.label })),
      recommend_value: d.recommend_value, default_if_silent: d.default_if_silent, close: d.close ?? 'done', evidence: d.evidence,
      type: d.type ?? 'decision', tradeoff: d.tradeoff, mocks: d.mocks?.map((m: MockRef) => ({ value: m.value, path: m.path })),
      ...(views && { view: d.view }),
      ...(stored && { media: d.media.map(({ path, sha256, bytes }: MediaRef) => ({ path, sha256, bytes })) }),
      ...(d.type === 'evidence' && { number: d.number, link: d.link }),
      ...(d.type === 'explainer' && d.chapters && { chapters: d.chapters.map(({ at, title }: Chapter) => ({ at, title })) }),
    };
  });
}

export const answersPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.answers.jsonl';
export const roundsPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.rounds.jsonl';
const readRaw = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
/** Latest answer per key. A torn line (a crash mid-write) is skipped and reported through warn. */
export function readAnswers(decisionsPath: string, warn: (msg: string) => void = () => {}): Record<string, Answer> {
  const latest = new Map<string, Answer>();
  readRaw(answersPath(decisionsPath)).split('\n').forEach((line, n) => {
    try {
      const a = line && JSON.parse(line);
      if (a) latest.set(a.key, a);
    } catch {
      warn(`skipped unreadable line ${n + 1} in ${answersPath(decisionsPath)}`);
    }
  });
  return Object.fromEntries(latest);
}

/** Appends one answer line unless it equals the current answer and note. Starts a new line after a torn fragment. */
export function appendAnswer(decisionsPath: string, d: Decision, option: Option, note = ''): void {
  const current = readAnswers(decisionsPath)[d.key];
  if (current?.answer === option.value && (current.note ?? '') === note) return;
  const raw = readRaw(answersPath(decisionsPath));
  const a: Answer = { key: d.key, answer: option.value, label: option.label, close: d.close, at: new Date().toISOString().slice(0, 19) + 'Z', ...(note && { note }) };
  appendFileSync(answersPath(decisionsPath), (raw && !raw.endsWith('\n') ? '\n' : '') + JSON.stringify(a) + '\n', { mode: 0o600 });
}

/** Another-round asks per key, oldest first. A torn line is skipped and reported through warn. */
export function readRounds(decisionsPath: string, warn: (msg: string) => void = () => {}): Round[] {
  const rounds: Round[] = [];
  readRaw(roundsPath(decisionsPath)).split('\n').forEach((line, n) => {
    try {
      const r = line && JSON.parse(line);
      if (r && typeof r.key === 'string' && typeof r.note === 'string' && typeof r.at === 'string') rounds.push(r);
      else if (r) warn(`skipped unreadable line ${n + 1} in ${roundsPath(decisionsPath)}`);
    } catch {
      warn(`skipped unreadable line ${n + 1} in ${roundsPath(decisionsPath)}`);
    }
  });
  return rounds;
}

/** Asks the agent for another round on a question, carrying the person's note. */
export function appendRound(decisionsPath: string, key: string, note: string): void {
  const raw = readRaw(roundsPath(decisionsPath));
  const r: Round = { key, note, at: new Date().toISOString().slice(0, 19) + 'Z' };
  appendFileSync(roundsPath(decisionsPath), (raw && !raw.endsWith('\n') ? '\n' : '') + JSON.stringify(r) + '\n', { mode: 0o600 });
}
