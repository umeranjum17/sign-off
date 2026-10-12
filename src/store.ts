import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export type Option = { value: string; label: string };
export type MockRef = { value: string; path: string };
export type EvidenceLink = { run_id: string; commit: string; outcome: string; repro: string; proof: string; evidence: string };
export type Decision = {
  key: string; title: string; about?: string; detail?: string; options: Option[];
  recommend_value?: string; default_if_silent?: string; close: string; evidence?: EvidenceLink;
  type: string; tradeoff?: string; mocks?: MockRef[];
};
export type Answer = { key: string; answer: string; label: string; close: string; at: string; note?: string };
export type Round = { key: string; note: string; at: string };

/** A problem with the decisions file; the CLI exits 2 and the server answers 422/409 with this message. */
export class InputError extends Error {}

const YES_NO: Option[] = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
const isText = (v: unknown) => typeof v === 'string';
const isKey = (v: unknown) => isText(v) && /^[A-Za-z0-9._-]{1,128}$/.test(v as string);
const ONE_OF: Record<string, unknown[]> = { type: ['decision', 'design'], close: ['done', 'release'] };
export const NOTE_MAX = 500;
const TRADEOFF_MAX = 1000;

export function loadDecisions(path: string): Decision[] {
  const name = basename(path);
  let doc: any;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e: any) {
    throw new InputError(e.code ? `cannot read ${resolve(path)}: ${e.code}` : `${name}: invalid JSON: ${e.message}`);
  }
  if (doc?.schema !== 1 || !Array.isArray(doc.decisions)) throw new InputError(`${name}: needs "schema": 1 and a "decisions" list`);
  const seen = new Map<string, number>();
  return doc.decisions.map((d: any, i: number): Decision => {
    const bad = (field: string, rule: string) => new InputError(`${name}: decisions[${i}] (key ${JSON.stringify(d?.key)}): ${field} ${rule}`);
    if (!isKey(d?.key)) throw bad('key', 'must be 1-128 of A-Z a-z 0-9 . _ -');
    if (seen.has(d.key)) throw bad('key', `repeats decisions[${seen.get(d.key)}]`);
    seen.set(d.key, i);
    if (!isText(d.title) || !d.title.trim()) throw bad('title', 'must be non-empty text');
    for (const f of ['about', 'detail']) if (d[f] !== undefined && !isText(d[f])) throw bad(f, 'must be text');
    if (d.evidence !== undefined && (!d.evidence || !/^[A-Za-z0-9._-]{1,128}$/.test(d.evidence.run_id ?? '')
      || !/^[a-f0-9]{40}$/.test(d.evidence.commit ?? '')
      || ['outcome', 'repro', 'proof', 'evidence'].some((f) => !isText(d.evidence[f]) || !d.evidence[f].trim() || d.evidence[f].length > 1000))) {
      throw bad('evidence', 'must name a done-done run, full commit, and four Checks lines');
    }
    for (const [f, allowed] of Object.entries(ONE_OF)) if (d[f] !== undefined && !allowed.includes(d[f])) throw bad(f, `must be ${allowed.join(' or ')}`);
    const options = d.options ?? YES_NO;
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
        || !d.mocks.every((m: any) => isKey(m?.value) && isText(m?.path) && m.path.trim() && m.path.length <= 256)) {
        throw bad('mocks', 'must list up to 6 items, each an option value and a board-relative mock path');
      }
      const targets = d.mocks.map((m: MockRef) => m.value);
      if (new Set(targets).size < targets.length) throw bad('mocks', 'option values must be unique');
      for (const m of d.mocks) if (!values.includes(m.value)) throw bad('mocks', `value ${m.value} is not one of ${values.join(', ')}`);
    }
    return {
      key: d.key, title: d.title, about: d.about, detail: d.detail, options: options.map((o: Option) => ({ value: o.value, label: o.label })),
      recommend_value: d.recommend_value, default_if_silent: d.default_if_silent, close: d.close ?? 'done', evidence: d.evidence,
      type: d.type ?? 'decision', tradeoff: d.tradeoff, mocks: d.mocks?.map((m: MockRef) => ({ value: m.value, path: m.path })),
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
