import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export type Option = { value: string; label: string; outcome?: string };
/** An option's mock file, and an optional http(s) link to open that option live (drawn under the mock, outside its sandboxed frame). */
export type MockRef = { value: string; path: string; link?: string };
export type MediaRef = { path: string; sha256: string; bytes: number };
/** A file attached to an evidence update for download: stored as evidence/<number>/attach-<n>.<ext>, offered under `name`. */
export type AttachRef = MediaRef & { name: string };
export type Chapter = { at: number; title: string };
export type Step = { title: string; marks?: string[]; text?: string };
/** A plan's section to approve or change, and a decision it asks: one question, options that each say where they lead, and the pick it recommends. */
export type PlanSection = { id: string; heading: string; body: string } & Partial<GuideSection>;
/** A guided page's section (plan 2, report 3): a stage, a lead, expandable items and the numbers behind a Details tap. */
export type GuideSection = { stage: 'found' | 'recommend'; items: { title: string; text: string; more?: string; tone?: string }[]; details: { label: string; value: string }[] };
export type GuideVisual = { type: 'bars' | 'steps' | 'tiles'; heading: string; text?: string; unit?: string; rows: { label: string; text?: string; note?: string; tone?: string; value?: number; before?: number }[]; details?: { label: string; value: string }[] };
export type PlanDecision = { key: string; question: string; why: string; options: (Option & { outcome: string })[]; recommend: string; reason?: string; after?: string; quiet?: string };
export type DesignNote = { journey?: string; screen?: string; verdict?: 'approve' | 'change'; note?: string };
export type DesignJourney = { id: string; title: string; screens: { id: string; title: string; views: Record<string, string> }[] };
/** One section in a plan's send-back: approved, or changed with a note on what to change. */
export type PlanNote = { section: string; verdict: 'approve' | 'change'; note?: string };
export type EvidenceLink = { run_id: string; commit: string; outcome: string; repro: string; proof: string; evidence: string };
export type Decision = {
  key: string; title: string; about?: string; detail?: string; options: Option[];
  recommend_value?: string; default_if_silent?: string; close: string;
  /** An ask's question standard: why it is asked, why one option is recommended, when the silent default happens (ISO UTC),
   * and the other cards on the board this ask replaces, which its answer closes too. */
  why?: string; recommend_reason?: string; silent_by?: string; merges?: string[]; /** The evidence update on the board this ask rests on: Decide shows its capture and result at the top. */ proof?: string; evidence?: EvidenceLink; run?: { run_id: string; commit: string };
  finding?: { cause: string; incidents: number; days: number; evidence_ids: string[]; change_kind: string; proposal: string };
  kind?: string;
  type: string; tradeoff?: string; mocks?: MockRef[]; number?: number; media?: MediaRef[]; attachments?: AttachRef[]; link?: string; view?: string; preview?: string; chapters?: Chapter[]; reply?: boolean;
  /** Who posted it: an agent session or caller id, so that caller's `wait --filer` gets the answer. */
  filer?: string;
  /** The board area it shows in while it waits for no answer, in place of the one its type gives it. */
  area?: string;
  /** How it works, step by step: each step's title and the marks for what matters there. */
  steps?: Step[];
  /** Reports: the section it is grouped under and what it decided. `filed` (ISO date-time) is when any item was filed. */
  group?: string; filed?: string; decided?: string;
  /** Reports: what it explains with (an icon), the length of its narrated video, and who asked for it. */
  form?: string; video?: string; asked_by?: string;
  /** Sign-ins: what the sign-in unlocks, who waits on it, and when its link stops working (ISO date-time). */
  unlocks?: string; waits?: string; expires?: string;
  /** A sign-in's start command, an argv run with no shell on the board's host when Open is tapped: the first https link it prints is the live sign-in link. */
  start?: string[];
  /** Plans: the sections to approve or change and the decisions to answer, all sent back as one answer. */
  sections?: PlanSection[]; decisions?: PlanDecision[]; project?: string;
  /** A guided plan or report (plan 2, report 3): the board draws it as one page from these fields, with no page of the agent's own. */
  guided?: boolean; understood?: { label: string; text: string }[]; visual?: GuideVisual; next?: { heading: string; lines: string[] };
  /** Designs: project, date, review status, preview and screen views. */
  status?: 'draft' | 'in_review' | 'approved'; journeys?: DesignJourney[]; recommend?: string;
};
export type Answer = { key: string; answer: string; label: string; close: string; at: string; note?: string; comments?: Sent[]; merged_by?: string;
  /** A plan's send-back: every section's verdict, and the option picked for each decision key. */
  notes?: PlanNote[] | DesignNote[]; decisions?: Record<string, string>; pick?: string };
export type Round = { key: string; note: string; at: string; comments?: Sent[] };
/** A comment on a mock element as it went to the agent with an answer or a round. */
export type Sent = Pick<Annotation, 'id' | 'mock' | 'hash' | 'ref' | 'tag' | 'words' | 'text'>;

/** A problem with the decisions file; the CLI exits 2 and the server answers 422/409 with this message. */
export class InputError extends Error {}

/** Why a file could not be read, in plain words, for the refusal every reader quotes: a missing file is not a failure, it is a refusal
 * that names what is wrong and how to fix it. The reader's path is prefixed by the caller, the error code is never the whole reason. */
export function unreadable(code?: string): string {
  return code === 'ENOENT' || code === 'ENOTDIR' ? 'is not there'
    : code === 'EISDIR' ? 'is a folder, not a file'
    : code === 'EACCES' || code === 'EPERM' ? 'cannot be read (permission denied)'
    : `cannot be read (${code ?? 'unknown error'})`;
}

const YES_NO: Option[] = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
/** The answer `signin done` saves: the sign-in is done and its card leaves the open list. */
export const SIGNED_IN: Option = { value: 'done', label: 'Signed in' };
/** The answer a `reply: true` item saves for a short text reply; the text is its note. */
export const REPLY: Option = { value: 'text', label: 'Reply' };
const VERDICTS: Option[] = [{ value: 'pass', label: 'Pass' }, { value: 'fail', label: 'Fail' }, { value: 'needs-work', label: 'Needs work' }];
export const MEDIA_MAX = 12;
export const ATTACH_MAX = 5;
export const ATTACH_DEFAULT_MB = 1024;
/** A download name: letters, digits and . _ ( ) + - or a space, never a path. */
export const ATTACH_NAME = /^[\w.()+ -]{1,120}$/;
/** Item types whose files post copies into evidence/<number>/: how many, and which kinds. An explainer is one narrated video. */
const STORED: Record<string, [number, string, RegExp]> = {
  evidence: [MEDIA_MAX, 'files', /\.(png|jpe?g|webp|mp4|webm)$/i],
  explainer: [1, '.mp4 or .webm video', /\.(mp4|webm)$/i],
};
export const CHAPTERS_MAX = 12;
const isText = (v: unknown) => typeof v === 'string';
/** An http(s) link of up to 500 characters with no spaces: an item's `link` (besides a commit hash) and a design option's. */
const HTTP_LINK = /^https?:\/\/\S{1,500}$/u;
export const isKey = (v: unknown) => isText(v) && /^[A-Za-z0-9._-]{1,128}$/.test(v as string);
const ONE_OF: Record<string, unknown[]> = { close: ['done', 'release'], area: ['waiting', 'evidence', 'reports', 'answered'] };
/** What a step uses or can stop on: an AI model, a store, a gate, a hard fail. */
/** What a report explains with: the board draws one line icon per form. */
export const REPORT_FORMS = ['diagram', 'chart', 'before-after'];
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
    throw new InputError(e.code ? `${resolve(path)} ${unreadable(e.code)}` : `${basename(path)}: invalid JSON: ${e.message}`);
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
    for (const f of ['about', 'detail', 'why', 'recommend_reason', 'silent_by']) if (d[f] !== undefined && !isText(d[f])) throw bad(f, 'must be text');
    if (d.merges !== undefined && !(Array.isArray(d.merges) && d.merges.every(isKey))) throw bad('merges', 'must list keys of 1-128 of A-Z a-z 0-9 . _ -');
    if (d.proof !== undefined && !isKey(d.proof)) throw bad('proof', 'must be a key of 1-128 of A-Z a-z 0-9 . _ -');
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
    if (d.attachments !== undefined && (d.type !== 'evidence' || !Array.isArray(d.attachments) || !d.attachments.length || d.attachments.length > ATTACH_MAX
      || !d.attachments.every((a: any) => isText(a?.path) && /^evidence\/\d+\/attach-\d+\.[a-z0-9]{1,10}$/.test(a.path) && isText(a.name) && ATTACH_NAME.test(a.name)
        && /^[a-f0-9]{64}$/.test(a.sha256 ?? '') && Number.isInteger(a.bytes) && a.bytes >= 0))) {
      throw bad('attachments', `must list 1 to ${ATTACH_MAX} files on an evidence update, each under evidence/<number>/ with its name, sha256 and bytes`);
    }
    if (stored && !(d.type === 'evidence' && d.media === undefined && (d.evidence || d.attachments))) {
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
    if (d.form !== undefined && !REPORT_FORMS.includes(d.form)) throw bad('form', `must be one of ${REPORT_FORMS.join(', ')}`);
    if (d.video !== undefined && !(isText(d.video) && d.video.trim() && [...d.video].length <= 10)) throw bad('video', 'must be text of 10 characters or fewer');
    if (d.asked_by !== undefined && !(isText(d.asked_by) && d.asked_by.trim() && [...d.asked_by].length <= 40)) throw bad('asked_by', 'must be text of 40 characters or fewer');
    if (d.decided !== undefined && !(isText(d.decided) && d.decided.trim() && [...d.decided].length <= 200)) throw bad('decided', 'must be text of 200 characters or fewer');
    if (d.type === 'evidence' && !(Number.isInteger(d.number) && d.number >= 1)) throw bad('number', 'must be a whole number from 1');
    const signin = d.type === 'signin';
    if (d.link !== undefined && !(isText(d.link) && (HTTP_LINK.test(d.link) || /^[a-f0-9]{7,40}$/u.test(d.link))) && !signin) throw bad('link', 'must be an http(s) link or a commit hash');
    // A sign-in is a link to open, what it unlocks and who waits; its answer is the `signin done` its poster saves, so the user gets no buttons.
    if (signin) {
      // A start command makes a new link at each tap, so it needs no fixed link and never expires.
      const start = d.start !== undefined;
      if (start && !(Array.isArray(d.start) && d.start.length >= 1 && d.start.length <= 64 && d.start.every((a: any) => isText(a) && a.length <= 4096 && !a.includes('\0')) && d.start[0].trim())) {
        throw bad('start', 'must be a command and its arguments as a list of 1 to 64 texts, such as ["npm", "login", "--auth-type=web"]');
      }
      if (start && d.expires !== undefined) throw bad('expires', 'must be left out with start: each tap makes a new link');
      let url: URL | undefined;
      try { url = new URL(d.link); } catch {}
      if ((!start || d.link !== undefined) && (!(isText(d.link) && /^https?:\/\/\S{1,2000}$/u.test(d.link)) || !url || url.username || url.password)) {
        throw bad('link', `must be an http(s) sign-in link of 2000 characters or fewer, with no user name or password in it${start ? '' : ' (or give a start command)'}`);
      }
      for (const f of ['unlocks', 'waits']) if (!(isText(d[f]) && d[f].trim() && [...d[f]].length <= 120)) throw bad(f, 'must be text of 120 characters or fewer');
      if (d.expires !== undefined && !(isText(d.expires) && /^\d{4}-\d{2}-\d{2}T/.test(d.expires) && !Number.isNaN(Date.parse(d.expires)))) throw bad('expires', 'must be an ISO 8601 date-time such as 2026-10-13T07:19:00Z');
      for (const f of ['options', 'reply', 'recommend_value', 'default_if_silent']) if (d[f] !== undefined) throw bad(f, 'must be left out: a sign-in closes with signin done, not with an answer');
    }
    // A ladder rung: a diagram image, or an interactive page the board frames in a sandbox.
    // A report is a page and its picture; one stored before reports had pages still loads, as a note with neither.
    const report = d.kind === 'report', plan = d.kind === 'plan', design = d.kind === 'design', guided = (report && d.schema === 3) || (plan && d.schema === 2);
    if (d.type === 'plan' && !plan) throw bad('type', 'plan needs "kind": "plan": post it with sign-off-axi post --kind plan');
    const views = guided ? undefined : report ? (d.view !== undefined || d.preview !== undefined ? VIEWS.interactive : undefined) : plan ? VIEWS.interactive : Object.hasOwn(VIEWS, d.type ?? '') ? VIEWS[d.type] : undefined;
    const viewOk = (v: any, [, ends]: [string, RegExp]) => isText(v) && v.length <= 256 && /^[^?#]+$/.test(v) && ends.test(v);
    if (views && !viewOk(d.view, views)) throw bad('view', `must be a board-relative ${views[0]} file`);
    if (report && views && !viewOk(d.preview, VIEWS.diagram)) throw bad('preview', `must be a board-relative ${VIEWS.diagram[0]} file`);
    // A report (contract kind report) takes no answer: it has no options, on any board.
    if (report) for (const f of ['options', 'reply', 'area', 'type']) if (d[f] !== undefined) throw bad(f, `must be left out: a report takes no answer${f === 'options' ? '' : ' and shows only under Reports'}`);
    // A plan takes its answer from its sections and decisions, sent back at once, so it has no options of its own.
    const options = d.options ?? (report || signin || plan || design ? [] : d.type === 'evidence' ? VERDICTS : YES_NO);
    // An empty list is an item to look at only, unless it takes a reply: only a board another program feeds, a report or a sign-in shows those.
    if (!Array.isArray(options) || options.length === 1 || (!options.length && !fed && !report && !signin && !plan && !design) || options.length > 6
      || !options.every((o) => isKey(o?.value) && isText(o.label) && o.label.trim() && (o.outcome === undefined || isText(o.outcome)))) {
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
      if (!d.mocks.every((m: any) => m.link === undefined || (isText(m.link) && HTTP_LINK.test(m.link)))) throw bad('mocks', 'a link must be an http(s) link with no spaces');
      const targets = d.mocks.map((m: MockRef) => m.value);
      if (new Set(targets).size < targets.length) throw bad('mocks', 'option values must be unique');
      for (const m of d.mocks) if (!values.includes(m.value)) throw bad('mocks', `value ${m.value} is not one of ${values.join(', ')}`);
    }
    return {
      key: d.key, title: d.title, about: d.about, detail: d.detail, options: options.map((o: Option) => ({ value: o.value, label: o.label, ...(o.outcome && { outcome: o.outcome }) })),
      ...(d.why && { why: d.why }), ...(d.recommend_reason && { recommend_reason: d.recommend_reason }), ...(d.silent_by && { silent_by: d.silent_by }), ...(d.merges && { merges: [...d.merges] }), ...(d.proof && { proof: d.proof }),
      recommend_value: d.recommend_value, default_if_silent: d.default_if_silent, close: d.close ?? 'done', evidence: d.evidence,
      type: plan ? 'plan' : d.type ?? 'decision', tradeoff: d.tradeoff, link: d.link, mocks: d.mocks?.map((m: MockRef) => ({ value: m.value, path: m.path, ...(m.link !== undefined && { link: m.link }) })),
      ...(views && { view: d.view }), ...(report && views && { preview: d.preview }), ...(d.reply && { reply: true }), ...(d.filer && { filer: d.filer }), ...(d.area && { area: d.area }),
      ...(signin && { unlocks: d.unlocks, waits: d.waits, ...(d.expires && { expires: d.expires }), ...(d.start && { start: [...d.start] }) }),
      ...(d.group && { group: d.group }), ...(d.filed && { filed: d.filed }), ...(d.decided && { decided: d.decided }),
      ...(d.form && { form: d.form }), ...(d.video && { video: d.video }), ...(d.asked_by && { asked_by: d.asked_by }),
      ...(d.steps && { steps: d.steps.map(({ title, marks, text }: Step) => ({ title, ...(text && { text }), ...(marks?.length && { marks }) })) }),
      ...(stored && d.media && { media: d.media.map(({ path, sha256, bytes }: MediaRef) => ({ path, sha256, bytes })) }),
      ...(d.attachments && { attachments: d.attachments.map(({ path, name, sha256, bytes }: AttachRef) => ({ path, name, sha256, bytes })) }),
      ...(d.type === 'evidence' && { number: d.number }),
      // A gate's run is part of its question: the same key with another run is a different question.
      ...(d.kind === 'gate' && d.run && { run: { run_id: d.run.run_id, commit: d.run.commit } }),
      // So is a finding's proposal, with the counts and records behind it.
      ...(d.kind === 'finding' && { finding: { cause: d.cause, incidents: d.incidents, days: d.days, evidence_ids: d.evidence_ids, change_kind: d.change_kind, proposal: d.proposal } }),
      ...(plan && { sections: d.sections, decisions: d.decisions, ...(d.project && { project: d.project }) }),
      ...(guided && { guided: true, understood: d.understood, visual: d.visual, next: d.next, ...(report && { sections: d.sections }) }),
      ...(design && { kind: 'design', type: 'design', group: d.group, filed: d.filed, status: d.status, preview: d.preview, journeys: d.journeys, ...(d.options && { options: d.options, recommend_value: d.recommend }) }),
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
/** Appends one answer line unless it equals the current answer and note, and returns the saved answer. Starts a new line after a torn fragment.
 * One decision is one card: the answer also goes, as its own line, to each card on the board this ask merges, under that card's close mode. */
export function appendAnswer(decisionsPath: string, d: Decision, option: Option, note = '', comments: Sent[] = []): Answer | undefined {
  const answer = saveAnswer(decisionsPath, d, option, note, comments);
  const on = loadDecisions(decisionsPath), answers = readAnswers(decisionsPath);
  // An open ask on the same decision leaves Decide with this one: it takes the answer too (an answered or dismissed one is left alone).
  const hidden = new Set(readDismissed(decisionsPath, answers, readRounds(decisionsPath)));
  const twins = on.filter((x) => x.key !== d.key && !answers[x.key] && !hidden.has(x.key) && sameDecision(d, x)).map((x) => x.key);
  for (const key of new Set([...(d.merges ?? []), ...twins, ...on.filter((x) => answers[x.key]?.merged_by === d.key).map((x) => x.key)])) {
    const merged = on.find((x) => x.key === key), own = answers[key];
    if (!merged) continue;
    const fanned = own?.merged_by === d.key;
    if (option === CLEARED) {
      if (fanned) saveAnswer(decisionsPath, merged, CLEARED, '');
      continue;
    }
    if (own || (option !== REPLY && !merged.options.some((o) => o.value === option.value))) continue;
    const same = option === REPLY ? option : merged.options.find((o) => o.value === option.value)!;
    saveAnswer(decisionsPath, merged, same, `Answered with ${d.key}${note ? `: ${note}` : ''}`, [], d.key);
  }
  return answer;
}
/** Two asks put one decision: plain asks that offer the same answers and whose titles share at least 80% of their words. */
export function sameDecision(a: Decision, b: Decision): boolean {
  const plain = (d: Decision) => d.type === 'decision' && (!d.kind || d.kind === 'ask') && !!d.options?.length;
  const values = (d: Decision) => d.options.map((o) => o.value).sort().join();
  if (!plain(a) || !plain(b) || values(a) !== values(b)) return false;
  const x = new Set(a.title.toLowerCase().match(/[a-z0-9]+/g)), y = new Set(b.title.toLowerCase().match(/[a-z0-9]+/g)), both = [...x].filter((w) => y.has(w)).length;
  return both / (x.size + y.size - both) >= 0.8;
}
function saveAnswer(decisionsPath: string, d: Decision, option: Option, note: string, comments: Sent[] = [], by?: string): Answer | undefined {
  const current = readAnswers(decisionsPath)[d.key];
  if (option === CLEARED ? !current : current?.answer === option.value && (current.note ?? '') === note && !comments.length) return;
  const answer: Answer = { key: d.key, answer: option.value, label: option.label, close: d.close, at: now(), ...(note && { note }), ...(comments.length && { comments }), ...(by && { merged_by: by }) };
  appendLine(answersPath(decisionsPath), answer);
  return answer;
}

/** A design answer that holds only screen notes while the design has no design-wide verdict: it still waits for one. */
export const SCREENS_ONLY = 'screens';
/** True while an answer leaves the item waiting: none yet, or only screen notes. */
export const awaitsVerdict = (type: string | undefined, a?: { answer?: string }) => !a || (type === 'design' && a.answer === SCREENS_ONLY);
const DESIGN_LABEL: Record<string, string> = { approve: 'Approved', change: 'Changes requested', [SCREENS_ONLY]: 'Screens reviewed' };

/** Saves a design answer with screen-specific notes and an optional listed direction pick. A screen save omits the verdict: the design keeps its saved verdict, a change on a screen of an approved design sets it to change, and with none yet it waits as screens-only. */
export function appendDesignAnswer(decisionsPath: string, d: Decision, verdict: unknown, notes: unknown, pick?: unknown, requested?: unknown): Answer | undefined {
  const bad = (rule: string) => new InputError(`key ${d.key}: ${rule}`);
  if (verdict !== undefined && verdict !== 'approve' && verdict !== 'change') throw bad('verdict must be approve or change, or omitted to save a screen');
  if (!Array.isArray(notes) || (verdict === 'change' && !notes.length)) throw bad('notes must be a list, with at least one note on change');
  if (verdict === undefined && !notes.some(n => n?.journey !== undefined)) throw bad('a screen save names its screen');
  if (requested === true && (verdict !== undefined || !notes.some(n => n?.journey !== undefined && (n.verdict ?? 'change') === 'change'))) throw bad('a requested change is a screen save with a change note on a screen');
  const screens = new Set((d.journeys ?? []).flatMap(j => j.screens.map(s => `${j.id}/${s.id}`)));
  for (const n of notes) {
    const hasJourney = n?.journey !== undefined, hasScreen = n?.screen !== undefined;
    if (!n || hasJourney !== hasScreen || (hasJourney && !screens.has(`${n.journey}/${n.screen}`)) ||
      (n.verdict !== undefined && !['approve', 'change'].includes(n.verdict)) ||
      (n.note !== undefined && (!isText(n.note) || [...n.note].length > NOTE_MAX)) || ((n.verdict ?? 'change') === 'change' && !n.note?.trim())) {
      throw bad('each note needs both a known journey and screen, or neither for a design-level note; verdict must be approve or change, with text required on change (500 characters or fewer)');
    }
  }
  if (new Set(notes.map(n => n.journey === undefined ? '' : `${n.journey}/${n.screen}`)).size !== notes.length) throw bad('notes must name each screen once, or contain one design-level note');
  const options = d.options ?? [];
  if (pick !== undefined ? !options.some(o => o.value === pick) : verdict !== undefined && options.length > 0) throw bad('pick must be one listed option, and a design verdict needs one when options were offered');
  const current = readAnswers(decisionsPath)[d.key];
  const decided = current?.answer === 'approve' || current?.answer === 'change' ? current.answer : undefined;
  const kept = (verdict ?? (decided === 'approve' && requested === true ? 'change' : decided ?? SCREENS_ONLY)) as string;
  const keptPick = (pick ?? (options.some(o => o.value === current?.pick) ? current?.pick : undefined)) as string | undefined;
  const answer: Answer = { key: d.key, answer: kept, label: DESIGN_LABEL[kept], close: d.close ?? 'done', at: now(), notes, ...(keptPick !== undefined && { pick: keptPick }) };
  if (current?.answer === answer.answer && JSON.stringify([current.notes, current.pick]) === JSON.stringify([answer.notes, answer.pick])) return;
  appendLine(answersPath(decisionsPath), answer);
  return answer;
}

/** Saves a plan's one send-back as its answer: each section approved or changed (a change says what to change, an approval may carry a comment),
 * one answer per decision (a listed option value, or the person's own words when none fits), and an optional whole-plan comment.
 * An identical send-back again saves nothing. */
export function appendSendBack(decisionsPath: string, d: Decision, notes: unknown, picks: unknown = {}, comment: unknown = ''): Answer | undefined {
  const bad = (rule: string) => new InputError(`key ${d.key}: ${rule}`), ids = d.sections!.map((s) => s.id), keys = d.decisions!.map((q) => q.key);
  // A guided plan asks for no verdict on every section: "understood" and any section the person marked are listed, once each.
  const named = d.guided ? ['understood', ...ids] : ids;
  if (!Array.isArray(notes) || (d.guided ? notes.length > named.length : notes.length !== ids.length) || !(d.guided ? notes.every((n) => named.includes(n?.section)) : ids.every((id) => notes.filter((n) => n?.section === id).length === 1))
    || new Set(notes.map((n) => n?.section)).size !== notes.length) throw bad(`notes must list ${d.guided ? 'only' : 'each'} section${d.guided ? '' : ' once'}: ${named.join(', ')}`);
  for (const { section, verdict, note } of notes) {
    if (verdict !== 'approve' && verdict !== 'change') throw bad(`section ${section} must be approve or change`);
    if (note !== undefined && (!isText(note) || [...note.trim()].length > NOTE_MAX)) throw bad(`section ${section} note must be text of ${NOTE_MAX} characters or fewer`);
    if (verdict === 'change' && !note?.trim()) throw bad(`section ${section} needs a note on what to change`);
  }
  const p = picks as Record<string, unknown>;
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length !== keys.length || !d.decisions!.every((q) =>
    isText(p[q.key]) && (p[q.key] as string).trim() && [...(p[q.key] as string).trim()].length <= NOTE_MAX)) {
    throw bad(`decisions must answer each of: ${keys.join(', ') || 'none'}, with an option or your own words of ${NOTE_MAX} characters or fewer`);
  }
  if (comment !== '' && comment !== undefined && (!isText(comment) || [...(comment as string).trim()].length > NOTE_MAX)) throw bad(`comment must be text of ${NOTE_MAX} characters or fewer`);
  const note = typeof comment === 'string' ? comment.trim() : '';
  const answer: Answer = { key: d.key, answer: 'sent', label: 'Sent back', close: d.close, at: now(), ...(note && { note }),
    notes: named.flatMap((id) => notes.filter((n) => n.section === id)).map(({ section, verdict, note }) => ({ section, verdict, ...(note?.trim() && { note: note.trim() }) })), decisions: Object.fromEntries(keys.map((k) => [k, (p[k] as string).trim()])) };
  const current = readAnswers(decisionsPath)[d.key];
  if (current?.answer === answer.answer && JSON.stringify([current.note ?? '', current.notes, current.decisions]) === JSON.stringify([answer.note ?? '', answer.notes, answer.decisions])) return;
  appendLine(answersPath(decisionsPath), answer);
  return answer;
}

/** Answers the filer took with `wait --filer`, one line each: the board marks that answer "seen by agent". */
export const seenPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.seen.jsonl';
const taken = (a: Pick<Answer, 'key' | 'answer' | 'at' | 'note'>) => JSON.stringify([a.key, a.answer, a.at, a.note ?? '']);
/** Is this answer, as saved now, one the filer already took? A changed answer is new again. */
export function seenBy(decisionsPath: string): (a: Answer) => boolean {
  const at = seenAt(decisionsPath);
  return (a) => at(a) !== undefined;
}
/** When the filer took this answer, as saved now: the "agent read your answers" time of a read receipt. */
export function seenAt(decisionsPath: string): (a: Answer) => string | undefined {
  const seen = new Map(readRaw(seenPath(decisionsPath)).split('\n').flatMap((line) => {
    try { const s = line && JSON.parse(line); return s?.key ? [[taken(s), s.seen] as const] : []; } catch { return []; }
  }));
  return (a) => (seen.has(taken(a)) ? seen.get(taken(a)) ?? '' : undefined);
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
/** True while an item asks the user something: evidence is never an ask, and an item with no options, reply, sign-in, plan or design is only read. */
export const asks = (d: Decision) => d.type !== 'evidence' && !reading(d) && (d.options.length > 0 || !!d.reply || ['signin', 'plan', 'design'].includes(d.type));
/** A guided plan with no decisions is for reading: it shows under Reports, still openable with Go ahead and Go deeper, and never waits in Decide (web/index.html area() says the same). */
export const reading = (d: Decision) => d.type === 'plan' && !!d.guided && !d.decisions?.length;
/** A sign-in whose fixed link has expired has nothing left to open: it is not waiting, here or on the board's page (web/index.html lapsed() says the same). A start command makes a new link per tap and never lapses. */
export const lapsed = (d: Decision) => d.type === 'signin' && !d.start && !!d.expires && Date.parse(d.expires) <= Date.now();
/** Evidence and reports (nothing to answer) archive on their own this long after they were filed: dismissed, never deleted. */
export const ARCHIVE_MS = 24 * 3_600_000;
/** Keys hidden now: the last line for each dismissed it, and no answer or round came after it. A torn line is skipped and reported through warn.
 * `items`, when given, adds the archive: evidence and reports filed over a day ago that no log line ever named. Restore writes a line, so a restored item stays. */
export function readDismissed(decisionsPath: string, answers: Record<string, Answer>, rounds: Round[], warn: (msg: string) => void = () => {}, items: Decision[] = []): string[] {
  const hidden = new Map<string, string>(), named = new Set<string>();
  readRaw(dismissedPath(decisionsPath)).split('\n').forEach((line, n) => {
    try {
      const x = line && JSON.parse(line);
      if (x?.dismissed === true && typeof x.key === 'string' && typeof x.at === 'string') hidden.set(x.key, x.at);
      else if (x) hidden.delete(x.key);
      if (x) named.add(x.key);
    } catch {
      warn(`skipped unreadable line ${n + 1} in ${dismissedPath(decisionsPath)}`);
    }
  });
  const archived = items.filter((d) => !asks(d) && !named.has(d.key) && Date.now() - Date.parse(d.filed ?? '') > ARCHIVE_MS).map((d) => d.key);
  return [...[...hidden].filter(([key, at]) => !(answers[key]?.at > at) && !rounds.some((r) => r.key === key && r.at > at)).map(([key]) => key), ...archived];
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

/** The parts of a guided page that can be read and asked about, with the name the agent hears: this, understood, each section and item, each decision, next. Undefined for a part it has not got. */
export function guidePart(d: Decision, part: string): string | undefined {
  if (!d.guided) return undefined;
  if (part === 'this') return d.visual?.heading;
  if (part === 'understood') return 'What I understood';
  if (part === 'next') return d.next?.heading;
  const dec = /^d:(.+)$/.exec(part)?.[1];
  if (dec) return d.decisions?.find((q) => q.key === dec)?.question;
  const [id, i] = part.split(':'), sec = d.sections?.find((x) => x.id === id);
  if (!sec) return undefined;
  return i === undefined ? sec.heading : /^\d+$/.test(i) ? sec.items?.[+i]?.title : undefined;
}
/** Read receipts: the first time the person had a part of a guided page on screen, one line per key and part. */
export const readsPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.reads.jsonl';
export function readReads(decisionsPath: string): Record<string, string> {
  const first: Record<string, string> = {};
  readRaw(readsPath(decisionsPath)).split('\n').forEach((line) => {
    try { const r = line && JSON.parse(line); if (r && typeof r.key === 'string' && typeof r.part === 'string' && typeof r.at === 'string') first[`${r.key}/${r.part}`] ??= r.at; } catch {}
  });
  return first;
}
export const appendRead = (decisionsPath: string, key: string, part: string) => {
  if (readReads(decisionsPath)[`${key}/${part}`] === undefined) appendLine(readsPath(decisionsPath), { key, part, by: 'captain', at: now() });
};

/** Go deeper: the person asks the agent about one part of a guided page; the agent answers in pieces that the board streams into that spot.
 * One line each: an ask (id, key, part, what it is about, an optional question), the agent reading it, a piece of the answer (`more` while it goes on), and its end. */
export type Deeper = { id: string; key: string; part: string; about: string; q?: string; at: string; read?: string; text: string; answered?: string; done?: boolean };
export const deeperPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.deeper.jsonl';
export function readDeeper(decisionsPath: string): Deeper[] {
  const all = new Map<string, Deeper>();
  readRaw(deeperPath(decisionsPath)).split('\n').forEach((line) => {
    try {
      const x = line && JSON.parse(line), d = x && all.get(x.id);
      if (x?.op === 'ask' && typeof x.id === 'string') all.set(x.id, { id: x.id, key: x.key, part: x.part, about: x.about, ...(x.q && { q: x.q }), at: x.at, text: '' });
      else if (d && x.op === 'read') d.read ??= x.at;
      else if (d && x.op === 'say') { d.text += (d.text ? '\n\n' : '') + x.text; d.answered = x.at; d.read ??= x.at; if (!x.more) d.done = true; }
    } catch {}
  });
  return [...all.values()];
}
export const askDeeper = (decisionsPath: string, key: string, part: string, about: string, q?: string): Deeper => {
  const id = randomBytes(6).toString('hex'), at = now();
  appendLine(deeperPath(decisionsPath), { op: 'ask', id, key, part, about, ...(q && { q }), at });
  return { id, key, part, about, ...(q && { q }), at, text: '' };
};
export const markDeeperRead = (decisionsPath: string, ids: string[]) => { for (const id of ids) appendLine(deeperPath(decisionsPath), { op: 'read', id, at: now() }); };
export const answerDeeper = (decisionsPath: string, id: string, text: string, more: boolean) => appendLine(deeperPath(decisionsPath), { op: 'say', id, text, ...(more && { more: true }), at: now() });

const now = () => new Date().toISOString().slice(0, 19) + 'Z';
/** Appends one JSON line, starting a new line after a torn fragment. */
function appendLine(file: string, entry: object) {
  const raw = readRaw(file);
  appendFileSync(file, (raw && !raw.endsWith('\n') ? '\n' : '') + JSON.stringify(entry) + '\n', { mode: 0o600 });
}
