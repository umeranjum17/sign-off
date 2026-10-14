import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export type Option = { value: string; label: string };
export type MockRef = { value: string; path: string };
export type MediaRef = { path: string; sha256: string; bytes: number };
export type Chapter = { at: number; title: string };
export type Step = { title: string; marks?: string[] };
export type EvidenceLink = { run_id: string; commit: string; outcome: string; repro: string; proof: string; evidence: string };
export type Decision = {
  key: string; title: string; about?: string; detail?: string; options: Option[];
  recommend_value?: string; default_if_silent?: string; close: string; evidence?: EvidenceLink; run?: { run_id: string; commit: string };
  finding?: { cause: string; incidents: number; days: number; evidence_ids: string[]; change_kind: string; proposal: string };
  type: string; tradeoff?: string; mocks?: MockRef[]; number?: number; media?: MediaRef[]; link?: string; view?: string; chapters?: Chapter[]; reply?: boolean;
  /** Who posted it: an agent session or caller id, so that caller's `wait --filer` gets the answer. */
  filer?: string;
  /** The board area it shows in while it waits for no answer, in place of the one its type gives it. */
  area?: string;
  /** How it works, step by step: each step's title and the marks for what matters there. */
  steps?: Step[];
  /** Reports: the section it is grouped under and what it decided. `filed` (ISO date-time) is when any item was filed. */
  group?: string; filed?: string; decided?: string;
};
export type Answer = { key: string; answer: string; label: string; close: string; at: string; note?: string; comments?: Sent[] };
export type Round = { key: string; note: string; at: string; comments?: Sent[] };
/** A comment on a mock element as it went to the agent with an answer or a round. */
export type Sent = Pick<Annotation, 'id' | 'mock' | 'hash' | 'ref' | 'tag' | 'words' | 'text'>;

/** A problem with the decisions file; the CLI exits 2 and the server answers 422/409 with this message. */
export class InputError extends Error {}

const YES_NO: Option[] = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
/** The answer a `reply: true` item saves for a short text reply; the text is its note. */
export const REPLY: Option = { value: 'text', label: 'Reply' };
const VERDICTS: Option[] = [{ value: 'pass', label: 'Pass' }, { value: 'fail', label: 'Fail' }, { value: 'needs-work', label: 'Needs work' }];
export const MEDIA_MAX = 12;
/** Item types whose files post copies into evidence/<number>/: how many, and which kinds. An explainer is one narrated video. */
const STORED: Record<string, [number, string, RegExp]> = {
  evidence: [MEDIA_MAX, 'files', /\.(png|jpe?g|webp|mp4|webm)$/i],
  explainer: [1, '.mp4 or .webm video', /\.(mp4|webm)$/i],
};
export const CHAPTERS_MAX = 12;
const isText = (v: unknown) => typeof v === 'string';
export const isKey = (v: unknown) => isText(v) && /^[A-Za-z0-9._-]{1,128}$/.test(v as string);
const ONE_OF: Record<string, unknown[]> = { close: ['done', 'release'], area: ['waiting', 'evidence', 'reports', 'answered'] };
/** What a step uses or can stop on: an AI model, a store, a gate, a hard fail. */
const MARKS = ['ai', 'store', 'gate', 'fail'];
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

/** Writes the board as schema 2 through a temp file and a rename, keeping its other top-level fields unless `extra` replaces them. A schema 1 board is first kept once as <board>.schema-1.bak. Callers hold the board lock. */
export function writeItems(path: string, items: object[], extra?: Record<string, unknown>): void {
  const tmp = `${path}.${process.pid}.tmp`, old = existsSync(path) ? readItems(path) : undefined;
  if (old?.schema === 1) {
    const bak = `${path}.schema-1.bak`, bakTmp = `${bak}.${process.pid}.tmp`;
    writeFileSync(bakTmp, readFileSync(path), { mode: 0o600 });
    if (existsSync(bak)) rmSync(bakTmp, { force: true });
    else renameSync(bakTmp, bak);
  }
  writeFileSync(tmp, `${JSON.stringify({ ...(extra ?? old?.extra), schema: 2, items }, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

/** `board`: the top-level fields of the board the items are posted to, which decide in place of the file's own. */
export function loadDecisions(path: string, board?: Record<string, unknown>): Decision[] {
  const name = basename(path), { schema, items, extra: own } = readItems(path), list = schema === 1 ? 'decisions' : 'items', extra = board ?? own;
  const fed = extra.readonly === true || extra.answers_only === true;
  const seen = new Map<string, number>();
  return items.map((d: any, i: number): Decision => {
    if (d?.type === 'vault') throw new InputError('Vault is not enabled in this build.');
    const bad = (field: string, rule: string) => new InputError(`${name}: ${list}[${i}] (key ${JSON.stringify(d?.key)}): ${field} ${rule}`);
    if (!isKey(d?.key)) throw bad('key', 'must be 1-128 of A-Z a-z 0-9 . _ -');
    if (seen.has(d.key)) throw bad('key', `repeats ${list}[${seen.get(d.key)}]`);
    seen.set(d.key, i);
    if (!isText(d.title) || !d.title.trim()) throw bad('title', 'must be non-empty text');
    for (const f of ['about', 'detail']) if (d[f] !== undefined && !isText(d[f])) throw bad(f, 'must be text');
    if (d.evidence !== undefined && (!d.evidence || !/^[A-Za-z0-9._-]{1,128}$/.test(d.evidence.run_id ?? '')
      || !/^[a-f0-9]{40}$/.test(d.evidence.commit ?? '')
      || ['outcome', 'repro', 'proof', 'evidence'].some((f) => !isText(d.evidence[f]) || !d.evidence[f].trim() || [...d.evidence[f]].length > 1000))) {
      throw bad('evidence', 'must name a done-done run, full commit, and four Checks lines');
    }
    // Any lowercase type word loads; the page shows a plain card for a type it has no renderer for.
    if (d.type !== undefined && !(isText(d.type) && /^[a-z][a-z0-9-]{0,31}$/.test(d.type))) throw bad('type', 'must be a lowercase word such as decision or design');
    for (const [f, allowed] of Object.entries(ONE_OF)) if (d[f] !== undefined && !allowed.includes(d[f])) throw bad(f, `must be ${allowed.join(' or ')}`);
    const stored = Object.hasOwn(STORED, d.type ?? '') ? STORED[d.type] : undefined;
    // An evidence update that links a done-done run may have no files of its own (contract evidence with run only).
    if (stored && !(d.type === 'evidence' && d.media === undefined && d.evidence)) {
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
    if (d.steps !== undefined && (!Array.isArray(d.steps) || d.steps.length < 2 || d.steps.length > 12
      || !d.steps.every((t: any) => isText(t?.title) && t.title.trim() && t.title.length <= 80 && (t.marks === undefined
        || (Array.isArray(t.marks) && t.marks.every((m: any) => MARKS.includes(m)) && new Set(t.marks).size === t.marks.length))))) {
      throw bad('steps', `must list 2 to 12 steps, each a title of 80 characters or fewer and marks from ${MARKS.join(', ')}`);
    }
    if (d.group !== undefined && !(isText(d.group) && d.group.trim() && [...d.group].length <= 40)) throw bad('group', 'must be text of 40 characters or fewer');
    if (d.filed !== undefined && !(isText(d.filed) && /^\d{4}-\d{2}-\d{2}T/.test(d.filed) && !Number.isNaN(Date.parse(d.filed)))) throw bad('filed', 'must be an ISO 8601 date-time such as 2026-10-13T07:19:00Z');
    if (d.decided !== undefined && !(isText(d.decided) && d.decided.trim() && [...d.decided].length <= 200)) throw bad('decided', 'must be text of 200 characters or fewer');
    if (d.type === 'evidence' && !(Number.isInteger(d.number) && d.number >= 1)) throw bad('number', 'must be a whole number from 1');
    if (d.link !== undefined && !(isText(d.link) && /^(https?:\/\/\S{1,500}|[a-f0-9]{7,40})$/u.test(d.link))) throw bad('link', 'must be an http(s) link or a commit hash');
    // A ladder rung: a diagram image, or an interactive page the board frames in a sandbox.
    const views = Object.hasOwn(VIEWS, d.type ?? '') ? VIEWS[d.type] : undefined;
    if (views && !(isText(d.view) && d.view.length <= 256 && /^[^?#]+$/.test(d.view) && views[1].test(d.view))) throw bad('view', `must be a board-relative ${views[0]} file`);
    // A report (contract kind report) takes no answer: it has no options, on any board.
    const report = d.kind === 'report';
    if (report) for (const f of ['options', 'reply', 'area', 'type']) if (d[f] !== undefined) throw bad(f, `must be left out: a report takes no answer${f === 'options' ? '' : ' and shows only under Reports'}`);
    const options = d.options ?? (report ? [] : d.type === 'evidence' ? VERDICTS : YES_NO);
    // An empty list is an item to look at only, unless it takes a reply: only a board another program feeds, or a report, shows those.
    if (!Array.isArray(options) || options.length === 1 || (!options.length && !fed && !report) || options.length > 6
      || !options.every((o) => isKey(o?.value) && isText(o.label) && o.label.trim())) {
      throw bad('options', 'must be 2 to 6 items (or empty on a readonly or answers_only board), each a value of 1-128 of A-Z a-z 0-9 . _ - and a label');
    }
    const values = options.map((o: Option) => o.value);
    if (new Set(values).size < values.length) throw bad('options', 'values must be unique');
    if (d.reply !== undefined && typeof d.reply !== 'boolean') throw bad('reply', 'must be true or false');
    if (d.reply && values.includes(REPLY.value)) throw bad('options', `value ${REPLY.value} is the answer a reply saves`);
    if (d.filer !== undefined && !isKey(d.filer)) throw bad('filer', 'must be 1-128 of A-Z a-z 0-9 . _ -');
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
      type: d.type ?? 'decision', tradeoff: d.tradeoff, link: d.link, mocks: d.mocks?.map((m: MockRef) => ({ value: m.value, path: m.path })),
      ...(views && { view: d.view }), ...(d.reply && { reply: true }), ...(d.filer && { filer: d.filer }), ...(d.area && { area: d.area }),
      ...(d.group && { group: d.group }), ...(d.filed && { filed: d.filed }), ...(d.decided && { decided: d.decided }),
      ...(d.steps && { steps: d.steps.map(({ title, marks }: Step) => ({ title, ...(marks?.length && { marks }) })) }),
      ...(stored && d.media && { media: d.media.map(({ path, sha256, bytes }: MediaRef) => ({ path, sha256, bytes })) }),
      ...(d.type === 'evidence' && { number: d.number }),
      // A gate's run is part of its question: the same key with another run is a different question.
      ...(d.kind === 'gate' && d.run && { run: { run_id: d.run.run_id, commit: d.run.commit } }),
      // So is a finding's proposal, with the counts and records behind it.
      ...(d.kind === 'finding' && { finding: { cause: d.cause, incidents: d.incidents, days: d.days, evidence_ids: d.evidence_ids, change_kind: d.change_kind, proposal: d.proposal } }),
      ...(d.type === 'explainer' && d.chapters && { chapters: d.chapters.map(({ at, title }: Chapter) => ({ at, title })) }),
    };
  });
}

export const answersPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.answers.jsonl';
export const roundsPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.rounds.jsonl';
const readRaw = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
/** Latest answer per key; a line with an empty answer (an Undo with nothing to go back to) leaves the key unanswered. A torn line (a crash mid-write) is skipped and reported through warn. */
export function readAnswers(decisionsPath: string, warn: (msg: string) => void = () => {}): Record<string, Answer> {
  const latest = new Map<string, Answer>(), sent = new Map<string, Sent[]>();
  readRaw(answersPath(decisionsPath)).split('\n').forEach((line, n) => {
    try {
      const a = line && JSON.parse(line);
      if (a?.answer === '') latest.delete(a.key);
      else if (a) {
        latest.set(a.key, a);
        if (a.comments) sent.set(a.key, [...(sent.get(a.key) ?? []), ...a.comments]);
      }
    } catch {
      warn(`skipped unreadable line ${n + 1} in ${answersPath(decisionsPath)}`);
    }
  });
  return Object.fromEntries([...latest].map(([key, a]) => [key, sent.has(key) ? { ...a, comments: sent.get(key) } : a]));
}

/** The option an Undo saves when the item had no answer before: an empty answer, so the item waits again. */
export const CLEARED: Option = { value: '', label: '' };
/** Appends one answer line unless it equals the current answer and note, and returns the saved answer. Starts a new line after a torn fragment. */
export function appendAnswer(decisionsPath: string, d: Decision, option: Option, note = '', comments: Sent[] = []): Answer | undefined {
  const current = readAnswers(decisionsPath)[d.key];
  if (option === CLEARED ? !current : current?.answer === option.value && (current.note ?? '') === note && !comments.length) return;
  const answer: Answer = { key: d.key, answer: option.value, label: option.label, close: d.close, at: now(), ...(note && { note }), ...(comments.length && { comments }) };
  appendLine(answersPath(decisionsPath), answer);
  return answer;
}

/** Answers the filer took with `wait --filer`, one line each: the board marks that answer "seen by agent". */
export const seenPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.seen.jsonl';
const taken = (a: Pick<Answer, 'key' | 'answer' | 'at' | 'note'>) => JSON.stringify([a.key, a.answer, a.at, a.note ?? '']);
/** Is this answer, as saved now, one the filer already took? A changed answer is new again. */
export function seenBy(decisionsPath: string): (a: Answer) => boolean {
  const seen = new Set(readRaw(seenPath(decisionsPath)).split('\n').flatMap((line) => {
    try { const s = line && JSON.parse(line); return s?.key ? [taken(s)] : []; } catch { return []; }
  }));
  return (a) => seen.has(taken(a));
}
export const markSeen = (decisionsPath: string, answers: Answer[]) => {
  for (const { key, answer, at, note } of answers) appendLine(seenPath(decisionsPath), { key, answer, at, ...(note && { note }), seen: now() });
};

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

/** Asks the agent for another round on a question, carrying the person's note and the comments on its mocks. */
export function appendRound(decisionsPath: string, key: string, note: string, comments: Sent[] = []): void {
  appendLine(roundsPath(decisionsPath), { key, note, at: now(), ...(comments.length && { comments }) } satisfies Round);
}
/** Ids of the comments that went with an answer or a round: sent, so locked. */
export const sentIds = (decisionsPath: string) => new Set([answersPath, roundsPath].flatMap((path) => readRaw(path(decisionsPath)).split('\n').flatMap((line) => {
  try { const c = line && JSON.parse(line)?.comments; return Array.isArray(c) ? c.map((x) => x?.id) : []; } catch { return []; }
})));

/** Items hidden from the board, one line per key and change; the agent is not told, and an ask it waits on keeps waiting. */
export const dismissedPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.dismissed.jsonl';
export function appendDismissed(decisionsPath: string, keys: string[], dismissed: boolean): void {
  const at = now();
  for (const key of keys) appendLine(dismissedPath(decisionsPath), { key, dismissed, at });
}
/** Keys hidden now: the last line for each dismissed it, and no answer or round came after it. A torn line is skipped and reported through warn. */
export function readDismissed(decisionsPath: string, answers: Record<string, Answer>, rounds: Round[], warn: (msg: string) => void = () => {}): string[] {
  const hidden = new Map<string, string>();
  readRaw(dismissedPath(decisionsPath)).split('\n').forEach((line, n) => {
    try {
      const x = line && JSON.parse(line);
      if (x?.dismissed === true && typeof x.key === 'string' && typeof x.at === 'string') hidden.set(x.key, x.at);
      else if (x) hidden.delete(x.key);
    } catch {
      warn(`skipped unreadable line ${n + 1} in ${dismissedPath(decisionsPath)}`);
    }
  });
  return [...hidden].filter(([key, at]) => !(answers[key]?.at > at) && !rounds.some((r) => r.key === key && r.at > at)).map(([key]) => key);
}

/** A comment on one item or a prompt queued for the agent; delivered is when poll handed it over. */
export type Message = { id: string; kind: 'comment' | 'prompt'; key?: string; text: string; at: string; delivered?: string };
export const messagesPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.messages.jsonl';
/** Every message, oldest first; a `{"delivered":[ids]}` line marks them handed over. A torn line is skipped and reported through warn. */
export function readMessages(decisionsPath: string, warn: (msg: string) => void = () => {}): Message[] {
  const all = new Map<string, Message>();
  readRaw(messagesPath(decisionsPath)).split('\n').forEach((line, n) => {
    try {
      const m = line && JSON.parse(line);
      if (Array.isArray(m?.delivered)) for (const id of m.delivered) { if (all.has(id)) all.get(id)!.delivered = m.at; }
      else if (m && typeof m.id === 'string' && typeof m.text === 'string') all.set(m.id, m);
      else if (m) warn(`skipped unreadable line ${n + 1} in ${messagesPath(decisionsPath)}`);
    } catch {
      warn(`skipped unreadable line ${n + 1} in ${messagesPath(decisionsPath)}`);
    }
  });
  return [...all.values()];
}
export const appendMessage = (decisionsPath: string, kind: Message['kind'], text: string, key?: string) =>
  appendLine(messagesPath(decisionsPath), { id: randomBytes(6).toString('hex'), kind, ...(key && { key }), text, at: now() } satisfies Message);
export const markDelivered = (decisionsPath: string, ids: string[]) => appendLine(messagesPath(decisionsPath), { delivered: ids, at: now() });

/** A comment on one element of a design mock: `hash` is the mock file it was made on, `ref`, `tag` and `words` name the element. Once an answer or round carries it, it is locked. */
export type Annotation = { id: string; key: string; mock: string; hash: string; ref: string; tag: string; words: string; text: string; at: string };
export const annotationsPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.annotations.jsonl';
/** Live comments, oldest first: an edit is a later line with the same id, and a `{"id", "deleted": true}` line removes one. A torn line is skipped and reported through warn. */
export function readAnnotations(decisionsPath: string, warn: (msg: string) => void = () => {}): Annotation[] {
  const all = new Map<string, Annotation>();
  readRaw(annotationsPath(decisionsPath)).split('\n').forEach((line, n) => {
    try {
      const a = line && JSON.parse(line);
      if (a?.deleted === true) all.delete(a.id);
      else if (a && ['id', 'key', 'mock', 'hash', 'ref', 'tag', 'words', 'text'].every((k) => typeof a[k] === 'string')) all.set(a.id, a);
      else if (a) warn(`skipped unreadable line ${n + 1} in ${annotationsPath(decisionsPath)}`);
    } catch {
      warn(`skipped unreadable line ${n + 1} in ${annotationsPath(decisionsPath)}`);
    }
  });
  return [...all.values()];
}
/** Saves a comment (a new id unless it edits one) or, with only an id, deletes it. */
export const appendAnnotation = (decisionsPath: string, a: Omit<Annotation, 'id' | 'at'> & { id?: string } | { id: string; deleted: true }) =>
  appendLine(annotationsPath(decisionsPath), { ...a, id: a.id ?? randomBytes(6).toString('hex'), at: now() });

const now = () => new Date().toISOString().slice(0, 19) + 'Z';
/** Appends one JSON line, starting a new line after a torn fragment. */
function appendLine(file: string, entry: object) {
  const raw = readRaw(file);
  appendFileSync(file, (raw && !raw.endsWith('\n') ? '\n' : '') + JSON.stringify(entry) + '\n', { mode: 0o600 });
}
