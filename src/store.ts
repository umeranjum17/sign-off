import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

export type Option = { value: string; label: string };
export type EvidenceLink = { run_id: string; commit: string; outcome: string; repro: string; proof: string; evidence: string };
export type Decision = {
  key: string; title: string; about?: string; detail?: string; options: Option[];
  recommend_value?: string; default_if_silent?: string; close: string; evidence?: EvidenceLink;
};
export type Answer = { key: string; answer: string; label: string; close: string; at: string };

/** A problem with the decisions file; the CLI exits 2 and the server answers 422/409 with this message. */
export class InputError extends Error {}

const YES_NO: Option[] = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
const isText = (v: unknown) => typeof v === 'string';
const ONE_OF: Record<string, unknown[]> = { type: ['decision'], close: ['done', 'release'], recommend_value: ['yes', 'no'], default_if_silent: ['yes', 'no'] };

export function loadDecisions(path: string): Decision[] {
  const name = basename(path);
  let doc: any;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e: any) {
    throw new InputError(e.code ? `cannot read ${name}: ${e.code}` : `${name}: invalid JSON: ${e.message}`);
  }
  if (doc?.schema !== 1 || !Array.isArray(doc.decisions)) throw new InputError(`${name}: needs "schema": 1 and a "decisions" list`);
  const seen = new Map<string, number>();
  return doc.decisions.map((d: any, i: number): Decision => {
    const bad = (field: string, rule: string) => new InputError(`${name}: decisions[${i}] (key ${JSON.stringify(d?.key)}): ${field} ${rule}`);
    if (!isText(d?.key) || !/^[A-Za-z0-9._-]{1,128}$/.test(d.key)) throw bad('key', 'must be 1-128 of A-Z a-z 0-9 . _ -');
    if (seen.has(d.key)) throw bad('key', `repeats decisions[${seen.get(d.key)}]`);
    seen.set(d.key, i);
    if (!isText(d.title) || !d.title.trim()) throw bad('title', 'must be non-empty text');
    for (const f of ['about', 'detail']) if (d[f] !== undefined && !isText(d[f])) throw bad(f, 'must be text');
    if (d.evidence !== undefined && (!d.evidence || !/^[A-Za-z0-9._-]{1,128}$/.test(d.evidence.run_id ?? '')
      || !/^[a-f0-9]{40}$/.test(d.evidence.commit ?? '')
      || ['outcome', 'repro', 'proof', 'evidence'].some((f) => !isText(d.evidence[f]) || d.evidence[f].length > 1000))) {
      throw bad('evidence', 'must name a done-done run, full commit, and four Checks lines');
    }
    for (const [f, allowed] of Object.entries(ONE_OF)) if (d[f] !== undefined && !allowed.includes(d[f])) throw bad(f, `must be ${allowed.join(' or ')}`);
    const options = d.options ?? YES_NO;
    if (!Array.isArray(options) || options.map((o) => o?.value).sort().join() !== 'no,yes'
      || !options.every((o) => isText(o.label) && o.label.trim())) throw bad('options', 'must be exactly yes and no, each with a label');
    return {
      key: d.key, title: d.title, about: d.about, detail: d.detail, options: options.map((o: Option) => ({ value: o.value, label: o.label })),
      recommend_value: d.recommend_value, default_if_silent: d.default_if_silent, close: d.close ?? 'done', evidence: d.evidence,
    };
  });
}

export const answersPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.answers.jsonl';
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

/** Appends one answer line unless it equals the current answer. Starts a new line after a torn fragment. */
export function appendAnswer(decisionsPath: string, d: Decision, option: Option): void {
  if (readAnswers(decisionsPath)[d.key]?.answer === option.value) return;
  const raw = readRaw(answersPath(decisionsPath));
  const a: Answer = { key: d.key, answer: option.value, label: option.label, close: d.close, at: new Date().toISOString().slice(0, 19) + 'Z' };
  appendFileSync(answersPath(decisionsPath), (raw && !raw.endsWith('\n') ? '\n' : '') + JSON.stringify(a) + '\n', { mode: 0o600 });
}
