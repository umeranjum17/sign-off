import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export type Option = { value: string; label: string; outcome?: string };
/** An option's mock file, and an optional http(s) link to open that option live (drawn under the mock, outside its sandboxed frame). */
export type MockRef = { value: string; path: string; link?: string };
export type MediaRef = { path: string; sha256: string; bytes: number; light?: CopyRef; thumb?: CopyRef; tile?: CopyRef };
/** A smaller copy of a still that post made beside it (evidence/<number>/<n>-light.jpg, -thumb.png or -tile.jpg): the board shows it in place of the original. */
export type CopyRef = { path: string; sha256: string; bytes: number; width: number; height: number };
/** A file attached to an evidence update for download: stored as evidence/<number>/attach-<n>.<ext>, offered under `name`. */
export type AttachRef = { path: string; sha256: string; bytes: number; name: string };
export type Chapter = { at: number; title: string };
export type Step = { title: string; marks?: string[]; text?: string };
/** A plan's section to approve or change, and a decision it asks: one question, options that each say where they lead, and the pick it recommends. */
export type PlanSection = { id: string; heading: string; body: string } & Partial<GuideSection>;
/** A guided page's section (plan 2, report 3): a stage, a lead, expandable items and the numbers behind a Details tap. */
export type GuideSection = { stage: 'found' | 'recommend'; items: { title: string; text: string; more?: string; tone?: string }[]; details: { label: string; value: string }[] };
export type GuideVisual = { type: 'bars' | 'steps' | 'tiles'; heading: string; text?: string; unit?: string; rows: { label: string; text?: string; note?: string; tone?: string; value?: number; before?: number }[]; details?: { label: string; value: string }[] };
export type PlanDecision = { key: string; question: string; why: string; options: (Option & { outcome: string })[]; recommend: string; reason?: string; after?: string; quiet?: string };
export type DesignNote = { journey?: string; screen?: string; verdict?: 'approve' | 'change'; note?: string };
/** A design 2 frame: one role's views of a screen, with the changed area as fractions of the picture and its one-line caption. */
export type DesignFrame = { role: string; views: Record<string, string>; area?: { x: number; y: number; w: number; h: number }; caption?: string };
/** A design's screens: one view each on design 1, side-by-side frames on design 2. */
export type DesignJourney = { id: string; title: string; screens: { id: string; title: string; views?: Record<string, string>; frames?: DesignFrame[] }[] };
/** Every file a design screen shows: its views, or each frame's. */
export const screenViews = (s: DesignJourney['screens'][number]): string[] => [...Object.values(s.views ?? {}), ...(s.frames ?? []).flatMap((f) => Object.values(f.views))];
/** One section in a plan's send-back: approved, or changed with a note on what to change. */
export type PlanNote = { section: string; verdict: 'approve' | 'change'; note?: string };
export type EvidenceLink = { run_id: string; commit: string; outcome: string; repro: string; proof: string; evidence: string };
export type Decision = {
  key: string; title: string; about?: string; detail?: string; ask_ref?: string; options: Option[];
  recommend_value?: string; default_if_silent?: string; close: string;
  /** An ask's question standard: why it is asked, why one option is recommended, when the silent default happens (ISO UTC),
   * and the other cards on the board this ask replaces, which its answer closes too. */
  why?: string; recommend_reason?: string; silent_by?: string; merges?: string[]; /** The evidence update on the board this ask rests on: Decide shows its capture and result at the top. */ proof?: string; /** The report on the board this ask is about: a desk shows it beside the ask. */ report?: string; evidence?: EvidenceLink; run?: { run_id: string; commit: string };
  finding?: { cause: string; incidents: number; days: number; evidence_ids: string[]; change_kind: string; proposal: string };
  kind?: string;
  type: string; tradeoff?: string; mocks?: MockRef[]; number?: number; media?: MediaRef[]; attachments?: AttachRef[]; link?: string; view?: string; preview?: string; chapters?: Chapter[]; reply?: boolean;
  /** Who posted it: an agent session or caller id, so that caller's `wait --filer` gets the answer. */
  filer?: string;
  /** The ticket this card belongs to, by id: a loose reference the board shows as a Ticket row while that ticket is on the board. */
  ticket?: string;
  /** How urgent the card is, P0 (most) to P3 (least): the board shows it as a chip and can sort by it. A card without one shows no chip. */
  priority?: string;
  /** The board area it shows in while it waits for no answer, in place of the one its type gives it. */
  area?: string;
  /** Why only the person may answer this ask, one of GUARDS: no leash ever takes its default or its agent's pick (see guardOf). */
  guard?: string;
  /** How it works, step by step: each step's title and the marks for what matters there. */
  steps?: Step[];
  /** Reports: the section it is grouped under and what it decided. `filed` (ISO date-time) is when any item was filed. */
  group?: string; filed?: string; decided?: string;
  /** Reports: what it explains with (an icon), the length of its narrated video, and who asked for it. */
  form?: string; video?: string; asked_by?: string;
  /** A guided report 5: what it is for, one of REPORT_PURPOSES. An older report has none, and the board guesses one. */
  purpose?: string;
  /** Sign-ins: what the sign-in unlocks, who waits on it, and when its link stops working (ISO date-time). */
  unlocks?: string; waits?: string; expires?: string;
  /** A sign-in's start command, an argv run with no shell on the board's host when Open is tapped: the first https link it prints is the live sign-in link. */
  start?: string[];
  /** Plans: the sections to approve or change and the decisions to answer, all sent back as one answer. */
  sections?: PlanSection[]; decisions?: PlanDecision[]; project?: string;
  /** A guided plan or report (plan 2, report 3): the board draws it as one page from these fields, with no page of the agent's own. */
  engagement?: { kind: string; schema: number; filer: string; revision: string }; guided?: boolean; understood?: { label: string; text: string }[]; visual?: GuideVisual; next?: { heading: string; lines: string[] };
  /** Designs: project, date, review status, preview and screen views. An evidence update's `status` is one of EVIDENCE_STATUSES and its `captions` name each capture, in order. */
  status?: 'draft' | 'in_review' | 'approved' | 'Fixed' | 'In progress' | 'Waiting on you'; captions?: string[]; journeys?: DesignJourney[]; recommend?: string;
  /** Design 2: the frame role Yes approves, and the reviewer's note shown as Main reviewed. */
  accepts?: string; reviewed?: string;
};
export type Answer = { key: string; answer: string; label: string; close: string; at: string; note?: string; comments?: Sent[]; merged_by?: string;
  /** A plan's send-back: every section's verdict, and the option picked for each decision key. */
  notes?: PlanNote[] | DesignNote[]; decisions?: Record<string, string>; pick?: string;
  /** A changed answer: the one it replaces, or after an Undo back to no answer the one the filer took, which the agent may already have acted on. */
  replaces?: Given;
  /** A design answer: the round of the design it was given on (see sameRound). */
  round?: string;
  /** An answer the person did not give, from the leash: the ask's default taken by the board at its silent_by, or its agent's recommended pick taken at once; and why. */
  taken?: Took['taken']; reason?: string };
/** How the leash answered for the person, and why. */
export type Took = { taken: 'default' | 'agent'; reason: string };
/** An earlier answer as a change names it. */
export type Given = Pick<Answer, 'answer' | 'label' | 'at' | 'note' | 'taken'>;
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
/** Where a concern stands, as an evidence update says it in plain words. */
export const EVIDENCE_STATUSES = ['Fixed', 'In progress', 'Waiting on you'];
/** A capture's caption, such as "Before, phone": 40 characters or fewer. */
export const CAPTION_MAX = 40;
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
/** A card's priority, most urgent first. */
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
/** What an ask does that only the person may allow: it deletes or overwrites, can't be undone, spends money, touches a password or key, or changes who can get in. */
export const GUARDS = ['destructive', 'irreversible', 'money', 'credential', 'security'];
const ONE_OF: Record<string, unknown[]> = { close: ['done', 'release'], area: ['waiting', 'evidence', 'reports', 'answered'], priority: PRIORITIES, guard: GUARDS };
/** What a step uses or can stop on: an AI model, a store, a gate, a hard fail. */
/** What a report explains with: the board draws one line icon per form. */
export const REPORT_FORMS = ['diagram', 'chart', 'before-after'];
/** What a report is for, its kind: the board shows each with its own icon and chip, and filters by it. `other` is the fallback. */
export const REPORT_PURPOSES = ['research', 'plan', 'decision', 'audit', 'incident', 'status', 'other'];
/** The parts each kind of report 5 must have, in order, each one section naming it as its `part`: the workflow strong teams use for that kind of document
 *  (research: a discovery brief; plan: a design doc or RFC; decision: an ADR; audit: a finding's criteria, condition, cause and effect; incident: a blameless postmortem; status: done, doing, held up, next). */
export const REPORT_PARTS: Record<string, [string, string][]> = {
  research: [['question', 'The question and why it matters'], ['scope', 'Scope'], ['method', 'Method'], ['sources', 'Sources'], ['options', 'Options compared'], ['findings', 'Findings'], ['not-checked', 'What we did not check'], ['recommendation', 'Recommendation'], ['open-questions', 'Open questions']],
  plan: [['goal', 'Goal and non-goals'], ['current', 'How it works today'], ['design', 'Design'], ['slices', 'Slices'], ['tests', 'Tests and proof'], ['risks', 'Risks and rollback'], ['rollout', 'Rollout'], ['estimate', 'Time'], ['owner-calls', 'Your calls']],
  decision: [['context', 'Context'], ['options', 'Options'], ['recommendation', 'Recommendation'], ['consequences', 'What follows']],
  audit: [['scope', 'Scope'], ['standard', 'Standard'], ['findings', 'Findings'], ['fixes', 'Fixes']],
  incident: [['impact', 'Impact'], ['timeline', 'Timeline'], ['root-cause', 'Root cause'], ['actions', 'What changes']],
  status: [['done', 'Done'], ['in-progress', 'In progress'], ['blocked', 'Held up'], ['up-next', 'Next']],
  other: [],
};
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
    if (d.report !== undefined && !isKey(d.report)) throw bad('report', 'must be a key of 1-128 of A-Z a-z 0-9 . _ -');
    if (d.ticket !== undefined && !isKey(d.ticket)) throw bad('ticket', 'must be a ticket id of 1-128 of A-Z a-z 0-9 . _ -');
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
    if (stored && !(d.type === 'evidence' && d.media === undefined && (d.evidence || d.attachments || d.status))) {
      const [max, kinds, ext] = stored;
      if (!Array.isArray(d.media) || !d.media.length || d.media.length > max || !d.media.every((m: any) => isText(m?.path)
        && /^evidence\/\d+\/\w[\w-]*\.\w+$/.test(m.path) && ext.test(m.path) && /^[a-f0-9]{64}$/.test(m.sha256 ?? '') && Number.isInteger(m.bytes) && m.bytes >= 0)) {
        throw bad('media', `must list ${max > 1 ? `1 to ${max}` : 'one'} ${kinds} under evidence/<number>/, each with its sha256 and bytes`);
      }
      const copy = (c: any, m: any, size: string) => c === undefined || (isText(c?.path) && c.path.startsWith(m.path.replace(/[^/]+$/, '')) && new RegExp(`^evidence/\\d+/\\d+-${size}\\.(jpg|png)$`).test(c.path)
        && /^[a-f0-9]{64}$/.test(c.sha256 ?? '') && [c.bytes, c.width, c.height].every((n) => Number.isInteger(n) && n > 0));
      if (!d.media.every((m: any) => copy(m.light, m, 'light') && copy(m.thumb, m, 'thumb') && copy(m.tile, m, 'tile'))) {
        throw bad('media', 'light, thumb and tile copies must sit beside their file as <n>-light, <n>-thumb or <n>-tile .jpg or .png, each with its sha256, bytes, width and height');
      }
    }
    if (d.type === 'evidence' && d.status !== undefined && !EVIDENCE_STATUSES.includes(d.status)) throw bad('status', `must be one of ${EVIDENCE_STATUSES.join(', ')}`);
    if (d.captions !== undefined && (d.type !== 'evidence' || !Array.isArray(d.media) || !Array.isArray(d.captions) || d.captions.length !== d.media.length
      || !d.captions.every((c: any) => isText(c) && c.trim() && [...c].length <= CAPTION_MAX))) {
      throw bad('captions', `must list one caption of ${CAPTION_MAX} characters or fewer for each capture of an evidence update`);
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
    if (d.purpose !== undefined && !REPORT_PURPOSES.includes(d.purpose)) throw bad('purpose', `must be one of ${REPORT_PURPOSES.join(', ')}`);
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
    const report = d.kind === 'report', plan = d.kind === 'plan', design = d.kind === 'design', guided = (report && [3, 4, 5].includes(d.schema)) || (plan && [2, 3].includes(d.schema));
    const engagement = (report && [4, 5].includes(d.schema)) || (plan && d.schema === 3);
    if (engagement && !isKey(d.filer)) throw bad('filer', 'is required for engagement');
    if (d.type === 'plan' && !plan) throw bad('type', 'plan needs "kind": "plan": post it with sign-off-axi post --kind plan');
    const views = guided ? undefined : report ? (d.view !== undefined || d.preview !== undefined ? VIEWS.interactive : undefined) : plan ? VIEWS.interactive : Object.hasOwn(VIEWS, d.type ?? '') ? VIEWS[d.type] : undefined;
    const viewOk = (v: any, [, ends]: [string, RegExp]) => isText(v) && v.length <= 256 && /^[^?#]+$/.test(v) && ends.test(v);
    if (views && !viewOk(d.view, views)) throw bad('view', `must be a board-relative ${views[0]} file`);
    if (report && views && !viewOk(d.preview, VIEWS.diagram)) throw bad('preview', `must be a board-relative ${VIEWS.diagram[0]} file`);
    // A report (contract kind report) takes no answer: it has no options, on any board.
    if (report) for (const f of ['options', 'reply', 'area', 'type']) if (d[f] !== undefined) throw bad(f, `must be left out: a report takes no answer${f === 'options' ? '' : ' and shows only under Reports'}`);
    // A design review is Main's to pass first: only `promote` puts one in Decide, never a field its poster sets.
    if (design && d.area !== undefined) throw bad('area', 'must be left out: a design shows under Designs, and Main moves it to Decide with sign-off-axi promote');
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
      ...(d.ask_ref !== undefined && { ask_ref: d.ask_ref }), ...(d.why && { why: d.why }), ...(d.recommend_reason && { recommend_reason: d.recommend_reason }), ...(d.silent_by && { silent_by: d.silent_by }), ...(d.merges && { merges: [...d.merges] }), ...(d.proof && { proof: d.proof }), ...(d.report && { report: d.report }),
      recommend_value: d.recommend_value, default_if_silent: d.default_if_silent, close: d.close ?? 'done', evidence: d.evidence,
      type: plan ? 'plan' : d.type ?? 'decision', tradeoff: d.tradeoff, link: d.link, mocks: d.mocks?.map((m: MockRef) => ({ value: m.value, path: m.path, ...(m.link !== undefined && { link: m.link }) })),
      ...(views && { view: d.view }), ...(report && views && { preview: d.preview }), ...(d.reply && { reply: true }), ...(d.filer && { filer: d.filer }), ...(d.ticket && { ticket: d.ticket }), ...(d.priority && { priority: d.priority }), ...(d.guard && { guard: d.guard }), ...(d.area && { area: d.area }),
      ...(signin && { unlocks: d.unlocks, waits: d.waits, ...(d.expires && { expires: d.expires }), ...(d.start && { start: [...d.start] }) }),
      ...(d.group && { group: d.group }), ...(d.filed && { filed: d.filed }), ...(d.decided && { decided: d.decided }),
      ...(d.form && { form: d.form }), ...(d.video && { video: d.video }), ...(d.asked_by && { asked_by: d.asked_by }), ...(d.purpose && { purpose: d.purpose }),
      ...(d.steps && { steps: d.steps.map(({ title, marks, text }: Step) => ({ title, ...(text && { text }), ...(marks?.length && { marks }) })) }),
      ...(stored && d.media && { media: d.media.map(({ path, sha256, bytes, light, thumb, tile }: MediaRef) => ({ path, sha256, bytes, ...(light && { light: copyRef(light) }), ...(thumb && { thumb: copyRef(thumb) }), ...(tile && { tile: copyRef(tile) }) })) }),
      ...(d.attachments && { attachments: d.attachments.map(({ path, name, sha256, bytes }: AttachRef) => ({ path, name, sha256, bytes })) }),
      ...(d.type === 'evidence' && { number: d.number, ...(d.status && { status: d.status }), ...(d.captions && { captions: d.captions }) }),
      // A gate's run is part of its question: the same key with another run is a different question.
      // A report keeps its kind, so an ask can name it (--report) and the board can find it.
      ...(report && { kind: 'report' }),
      ...(d.kind === 'gate' && d.run && { run: { run_id: d.run.run_id, commit: d.run.commit } }),
      // So is a finding's proposal, with the counts and records behind it.
      ...(d.kind === 'finding' && { finding: { cause: d.cause, incidents: d.incidents, days: d.days, evidence_ids: d.evidence_ids, change_kind: d.change_kind, proposal: d.proposal } }),
      ...(plan && { sections: d.sections, decisions: d.decisions, ...(d.project && { project: d.project }) }),
      ...(engagement && { engagement: { kind: d.kind, schema: d.schema, filer: d.filer, revision: documentRevision(d) } }),
      ...(guided && { guided: true, understood: d.understood, visual: d.visual, next: d.next, ...(report && { sections: d.sections }) }),
      ...(design && { kind: 'design', type: 'design', group: d.group, filed: d.filed, status: d.status, preview: d.preview, journeys: d.journeys, ...(d.accepts && { accepts: d.accepts }), ...(d.reviewed && { reviewed: d.reviewed }), ...(d.options && { options: d.options, recommend_value: d.recommend }) }),
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

/** Every answer line as saved, oldest first; a torn line is left out (readAnswers reports it). */
export const answerLines = (decisionsPath: string): Answer[] => readRaw(answersPath(decisionsPath)).split('\n').flatMap((line) => { try { const a = line && JSON.parse(line); return a?.key ? [a] : []; } catch { return []; } });

/** The answer the filer last took for a key with `wait --filer`, as it was saved: after an Undo it is what the agent may still act on. */
function lastTaken(decisionsPath: string, key: string): Answer | undefined {
  const lines = (path: string) => readRaw(path).split('\n').flatMap((line) => { try { const a = line && JSON.parse(line); return a?.key === key ? [a] : []; } catch { return []; } });
  const last = lines(seenPath(decisionsPath)).at(-1);
  return last && lines(answersPath(decisionsPath)).findLast((a) => taken(a) === taken(last));
}
/** The option an Undo saves when the item had no answer before: an empty answer, so the item waits again. */
export const CLEARED: Option = { value: '', label: '' };
/** Appends one answer line unless it equals the current answer and note, and returns the saved answer. Starts a new line after a torn fragment.
 * One decision is one card: the answer also goes, as its own line, to each card on the board this ask merges, under that card's close mode. */
export function appendAnswer(decisionsPath: string, d: Decision, option: Option, note = '', comments: Sent[] = [], took?: Took): Answer | undefined {
  const answer = saveAnswer(decisionsPath, d, option, note, comments, undefined, took);
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
const copyRef = ({ path, sha256, bytes, width, height }: CopyRef): CopyRef => ({ path, sha256, bytes, width, height });
/** Two asks put one decision: plain asks that offer the same answers and whose titles share at least 80% of their words. */
export function sameDecision(a: Decision, b: Decision): boolean {
  const plain = (d: Decision) => d.type === 'decision' && (!d.kind || d.kind === 'ask') && !!d.options?.length;
  const values = (d: Decision) => d.options.map((o) => o.value).sort().join();
  if (!plain(a) || !plain(b) || values(a) !== values(b)) return false;
  const x = new Set(a.title.toLowerCase().match(/[a-z0-9]+/g)), y = new Set(b.title.toLowerCase().match(/[a-z0-9]+/g)), both = [...x].filter((w) => y.has(w)).length;
  return both / (x.size + y.size - both) >= 0.8;
}
function saveAnswer(decisionsPath: string, d: Decision, option: Option, note: string, comments: Sent[] = [], by?: string, took?: Took): Answer | undefined {
  const current = readAnswers(decisionsPath)[d.key];
  // The person giving the answer the leash took makes it theirs: a new line.
  if (option === CLEARED ? !current : current?.answer === option.value && (current.note ?? '') === note && !comments.length && current.taken === took?.taken) return;
  const was = option === CLEARED ? undefined : current ?? lastTaken(decisionsPath, d.key);
  const answer: Answer = { key: d.key, answer: option.value, label: option.label, close: d.close, at: now(), ...(note && { note }), ...(comments.length && { comments }), ...(by && { merged_by: by }), ...took,
    ...(was && { replaces: { answer: was.answer, label: was.label, at: was.at, ...(was.note && { note: was.note }), ...(was.taken && { taken: was.taken }) } }) };
  appendLine(answersPath(decisionsPath), answer);
  return answer;
}

/** A design answer that holds only screen notes while the design has no design-wide verdict: it still waits for one. */
export const SCREENS_ONLY = 'screens';
/** True while an answer leaves the item waiting: none yet, or only screen notes. */
export const awaitsVerdict = (type: string | undefined, a?: { answer?: string }) => !a || (type === 'design' && a.answer === SCREENS_ONLY);
const DESIGN_LABEL: Record<string, string> = { approve: 'Approved', change: 'Changes requested', [SCREENS_ONLY]: 'Screens reviewed' };

/** Is a design answer one given on the design's current round? A design posted again under its key is a new round when its files or fields changed:
 * the answer names the round it was given on, and an older answer that names none was given on this round only when it came after the design was filed
 * (in whole seconds: an answer's time has no milliseconds, a post's may). */
const second = (at: string) => Math.floor(Date.parse(at) / 1000);
export const sameRound = (a: Answer, d: Decision, round: string) => (a.round ? a.round === round : !d.filed || second(a.at) >= second(d.filed));

/** Saves a design answer with screen-specific notes and an optional listed direction pick. A screen save omits the verdict: the design keeps its saved verdict, a requested change on a screen sets it to change, and any other screen save with none yet waits as screens-only.
 * An answer from an earlier round is history: its verdict and pick do not carry into this round's. */
export function appendDesignAnswer(decisionsPath: string, d: Decision, round: string, verdict: unknown, notes: unknown, pick?: unknown, requested?: unknown): Answer | undefined {
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
  const saved = readAnswers(decisionsPath)[d.key], current = saved && sameRound(saved, d, round) ? saved : undefined;
  const decided = current?.answer === 'approve' || current?.answer === 'change' ? current.answer : undefined;
  const kept = (verdict ?? (requested === true ? 'change' : decided ?? SCREENS_ONLY)) as string;
  const keptPick = (pick ?? (options.some(o => o.value === current?.pick) ? current?.pick : undefined)) as string | undefined;
  const answer: Answer = { key: d.key, answer: kept, label: DESIGN_LABEL[kept], close: d.close ?? 'done', at: now(), notes, ...(keptPick !== undefined && { pick: keptPick }), round };
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

/** Items hidden from the board, one line per key and change. A plain dismiss tells the agent nothing, and an ask it waits on keeps waiting;
 *  a discard carries the person's reason, and its agent is told through the feedback trail (readTrail, the wait command). */
export const dismissedPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.dismissed.jsonl';
export const DISCARD_REASONS = { 'not-relevant': 'Not relevant', replaced: 'Replaced by newer', 'done-elsewhere': 'Done elsewhere' } as const;
export type DiscardReason = keyof typeof DISCARD_REASONS;
/** Undo takes a discard back this long after it: until then its agent is not told, so an undone discard never reaches it. */
export const UNDO_MS = 10_000;
export function appendDismissed(decisionsPath: string, keys: string[], dismissed: boolean, reason?: DiscardReason): void {
  const at = now();
  for (const key of keys) appendLine(dismissedPath(decisionsPath), { key, dismissed, at, ...(dismissed && reason && { reason }) });
}
/** Each discard the person made, oldest first, and whether it is still the last word on its card (no restore or dismiss since).
 *  A discard that a restore took back inside the Undo window never left the board and is left out. */
export function readDiscards(decisionsPath: string): { key: string; reason: DiscardReason; at: string; last: boolean }[] {
  const lines = readRaw(dismissedPath(decisionsPath)).split('\n').flatMap((line) => { try { const x = line && JSON.parse(line); return x && typeof x.key === 'string' && typeof x.at === 'string' ? [x] : []; } catch { return []; } });
  return lines.flatMap((x, i) => {
    const after = lines.slice(i + 1).filter((y) => y.key === x.key);
    return x.dismissed === true && Object.hasOwn(DISCARD_REASONS, x.reason) && !after.some((y) => y.dismissed === false && Date.parse(y.at) - Date.parse(x.at) < UNDO_MS)
      ? [{ key: x.key, reason: x.reason, at: x.at, last: !after.length }] : [];
  });
}
/** Design reviews Main has put to the user, one line per key and change. A design a lead posts is reviewed under Designs and is no ask of the user's
 *  until the promote command names it here; no post, feed or board request writes this log. */
export const promotedPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.promoted.jsonl';
export function appendPromoted(decisionsPath: string, key: string, promoted: boolean): void {
  appendLine(promotedPath(decisionsPath), { key, promoted, at: now() });
}
/** Keys promoted now: the last line for each promoted it. A torn line is skipped and reported through warn. */
export function readPromoted(decisionsPath: string, warn: (msg: string) => void = () => {}): string[] {
  const promoted = new Set<string>();
  readRaw(promotedPath(decisionsPath)).split('\n').forEach((line, n) => {
    try {
      const x = line && JSON.parse(line);
      if (x?.promoted === true && typeof x.key === 'string') promoted.add(x.key);
      else if (x) promoted.delete(x.key);
    } catch {
      warn(`skipped unreadable line ${n + 1} in ${promotedPath(decisionsPath)}`);
    }
  });
  return [...promoted];
}
/** A ticket: a standalone record of work, its percent done and the ticket it sits under, and optionally its priority, its project, whether it is on hold and whether the board's owner asked for it.
 * Cards name one by id; nothing else reads or needs it. */
export type Ticket = { id: string; title: string; progress: number; parent?: string; priority?: string; project?: string; hold?: boolean; asked?: boolean; release?: string; state?: 'queued' | 'in progress' | 'on hold' | 'done'; prs?: string[]; at: string };
/** Tickets, one line per write (`ticket <id> --title`), the latest line per id wins. A board without the file has no tickets, and every card works as before. */
export const ticketsPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.tickets.jsonl';
/** The ticket rules, shared by the writer and the reader: a line that breaks one is skipped, never shown half-valid. */
export const ticketFault = (t: any) => (!isKey(t?.id) ? 'id must be 1-128 of A-Z a-z 0-9 . _ -'
  : !isText(t.title) || !t.title.trim() || [...t.title].length > 160 ? 'title must be text of 160 characters or fewer'
  : !(Number.isInteger(t.progress) && t.progress >= 0 && t.progress <= 100) ? 'progress must be a whole number from 0 to 100'
  : t.parent !== undefined && (!isKey(t.parent) || t.parent === t.id) ? 'parent must be the id of another ticket'
  : t.priority !== undefined && !PRIORITIES.includes(t.priority) ? `priority must be one of ${PRIORITIES.join(', ')}`
  : t.project !== undefined && projectFault({ name: t.project }) ? 'project must be a project name, text of 40 characters or fewer'
  : t.release !== undefined && (!isText(t.release) || !t.release.trim() || [...t.release].length > 40) ? 'release must be text of 40 characters or fewer'
  : t.state !== undefined && !['queued', 'in progress', 'on hold', 'done'].includes(t.state) ? 'state must be queued, in progress, on hold or done'
  : t.prs !== undefined && (!Array.isArray(t.prs) || !t.prs.every((u: any) => { try { return typeof u === 'string' && /^https?:\/\//.test(u) && !!new URL(u).hostname; } catch { return false; } })) ? 'prs must be an array of full HTTP or HTTPS URLs'
  : t.hold !== undefined && typeof t.hold !== 'boolean' ? 'hold must be true or false'
  : t.asked !== undefined && typeof t.asked !== 'boolean' ? 'asked must be true or false' : '');
const TICKET_FIELDS = ['parent', 'priority', 'project', 'hold', 'asked', 'release', 'state', 'prs'] as const;
/** A ticket's fields in the file's order, leaving out each optional one it does not carry. */
const ticketLine = (t: any): Ticket => ({ id: t.id, title: t.title, progress: t.progress, ...Object.fromEntries(TICKET_FIELDS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]])), at: t.at });
export function appendTicket(decisionsPath: string, t: Omit<Ticket, 'at'>): Ticket {
  const line = ticketLine({ ...t, at: now() });
  appendLine(ticketsPath(decisionsPath), line);
  return line;
}
/** Every ticket as its latest line says, in the order each was first written. A torn or broken line is skipped and reported through warn. */
export function readTickets(decisionsPath: string, warn: (msg: string) => void = () => {}): Ticket[] {
  const latest = new Map<string, Ticket>();
  readRaw(ticketsPath(decisionsPath)).split('\n').forEach((line, n) => {
    let t;
    try { t = line && JSON.parse(line); } catch {}
    if (line && (!t || ticketFault(t))) return warn(`skipped unreadable line ${n + 1} in ${ticketsPath(decisionsPath)}`);
    if (t) latest.set(t.id, ticketLine(t));
  });
  return [...latest.values()];
}
/** The progress roll-up: a ticket with tickets under it on the board is as far along as they are on average (each of them rolled up the same way), and one with none keeps its own.
 * A loop of parents stops where it would come back round. */
export function rollUp(tickets: Ticket[]): Ticket[] {
  const under = new Map<string, Ticket[]>();
  for (const t of tickets) if (t.parent) under.set(t.parent, [...(under.get(t.parent) ?? []), t]);
  const done = (t: Ticket, path: Set<string>): number => {
    const kids = (under.get(t.id) ?? []).filter((k) => !path.has(k.id));
    return kids.length ? Math.round(kids.reduce((n, k) => n + done(k, new Set([...path, k.id])), 0) / kids.length) : t.progress;
  };
  return tickets.map((t) => ({ ...t, progress: done(t, new Set([t.id])) }));
}
/** A project's own icon: a picture in the board's folder, pinned by its hash so the board serves only the file that was set. */
export type IconRef = { path: string; sha256: string; bytes: number };
/** A project as the board draws it: its name and, optionally, its icon. A project with no icon shows a project outline. */
export type Project = { name: string; icon?: IconRef; at: string };
/** Projects, one line per write (`project --name`), the latest line per name wins, names matched without regard to case. A board without the file has none. */
export const projectsPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.projects.jsonl';
/** What an icon may be: a small picture of one of these types. */
export const ICON_BYTES = 500_000;
export const ICON_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const iconExt = (path: string) => /\.[A-Za-z]+$/.exec(path)?.[0].toLowerCase() ?? '';
/** An icon path: relative to the board file's folder, with no .., ?, # or \, ending in an icon type. */
export const iconPathFault = (p: unknown) => (!isText(p) || !(p as string).trim() || (p as string).length > 256 || /^([\\/]|[A-Za-z]:)/.test(p as string) || (p as string).split('/').includes('..') || /[?#\\\0-\x1f]/.test(p as string)
  ? 'must be a path from the board file\'s folder with no .., ?, # or \\, in 256 characters or fewer'
  : !Object.hasOwn(ICON_TYPES, iconExt(p as string)) ? `must end in ${Object.keys(ICON_TYPES).join(', ')}` : '');
/** The project rules, shared by the writer and the reader: a line that breaks one is skipped, never shown half-valid. */
export const projectFault = (p: any) => (!isText(p?.name) || !p.name.trim() || /[\0-\x1f\x7f-\x9f]/.test(p.name) || [...p.name].length > 40 ? 'name must be text of 40 characters or fewer'
  : p.icon === undefined ? ''
  : iconPathFault(p.icon?.path) ? `icon ${iconPathFault(p.icon?.path)}`
  : !/^[a-f0-9]{64}$/.test(p.icon.sha256 ?? '') || !(Number.isInteger(p.icon.bytes) && p.icon.bytes > 0 && p.icon.bytes <= ICON_BYTES) ? `icon must carry its sha256 and bytes, ${ICON_BYTES} or fewer` : '');
/** The magic bytes of each icon type, so a file named .png that is not one is refused: an SVG is text with an <svg> element and no script. */
export function iconContentFault(path: string, bytes: Buffer): string {
  const ext = iconExt(path);
  if (ext === '.png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? '' : 'is not a PNG picture';
  if (ext === '.jpg' || ext === '.jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? '' : 'is not a JPEG picture';
  if (ext === '.webp') return bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP' ? '' : 'is not a WebP picture';
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return 'is not an SVG picture'; }
  if (!/<svg[\s>]/i.test(text)) return 'is not an SVG picture';
  return /<script\b|<foreignObject\b|\son[a-z]+\s*=/i.test(text) ? 'holds a script, and an icon is only a picture' : '';
}
export function appendProject(decisionsPath: string, { name, icon }: Omit<Project, 'at'>): Project {
  const p = { name, ...(icon && { icon }), at: now() };
  appendLine(projectsPath(decisionsPath), p);
  return p;
}
/** Every project as its latest line says, in the order each was first written. A torn or broken line is skipped and reported through warn. */
export function readProjects(decisionsPath: string, warn: (msg: string) => void = () => {}): Project[] {
  const latest = new Map<string, Project>();
  readRaw(projectsPath(decisionsPath)).split('\n').forEach((line, n) => {
    let p;
    try { p = line && JSON.parse(line); } catch {}
    if (line && (!p || projectFault(p))) return warn(`skipped unreadable line ${n + 1} in ${projectsPath(decisionsPath)}`);
    if (p) latest.set(p.name.toLowerCase(), { name: p.name, ...(p.icon && { icon: { path: p.icon.path, sha256: p.icon.sha256, bytes: p.icon.bytes } }), at: p.at });
  });
  return [...latest.values()];
}
/** True while an item asks the user something: evidence is never an ask, and an item with no options, reply, sign-in, plan or design is only read. */
export const asks = (d: Decision) => d.type !== 'evidence' && !reading(d) && (d.options.length > 0 || !!d.reply || ['signin', 'plan', 'design'].includes(d.type));
/** A guided plan with no decisions is for reading: it shows under Reports, still openable with Go ahead and Go deeper, and never waits in Decide (web/index.html area() says the same). */
export const reading = (d: Decision) => d.type === 'plan' && !!d.guided && !d.decisions?.length;
/** A sign-in whose fixed link has expired has nothing left to open: it is not waiting, here or on the board's page (web/index.html lapsed() says the same). A start command makes a new link per tap and never lapses. */
export const lapsed = (d: Decision) => d.type === 'signin' && !d.start && !!d.expires && Date.parse(d.expires) <= Date.now();
/** What an ask's words say it does that only the person may allow, read from its title, what it says and its answers: the first of these that matches. */
const GUARD_WORDS: [string, RegExp][] = [
  ['money', /\b(pay|pays|paid|payments?|purchases?|buy|buys|billing|invoices?|charges?|subscriptions?|subscribe|refunds?|pricing|dollars?|euros?|usd|eur|credit cards?|spend(s|ing)? money|pro plan|paid plan)\b|[$€£]\s?\d/i],
  ['credential', /\b(passwords?|passphrases?|credentials?|secrets?|(api|ssh|private|signing|deploy) keys?|(api|access|auth|npm|github) tokens?|2fa|mfa|one-time codes?)\b/i],
  ['security', /\b(security|permissions?|access|admins?|firewall|sudo|public(ly)?|expose[sd]?|auth(entication|orization)?|roles?|allowlist|encryption)\b/i],
  ['destructive', /\b(delete[sd]?|deleting|remove[sd]?|removing|drop(s|ped)?|wipe[sd]?|erase[sd]?|purge[sd]?|destroy(s|ed)?|overwrite[sd]?|truncate[sd]?|force[- ]push(es|ed)?|uninstall(s|ed)?)\b/i],
  ['irreversible', /\b(irreversible|permanent(ly)?|can'?t be undone|cannot be undone|no undo|for good|publish(es|ed)?)\b/i],
];
/** Why only the person may answer an ask, one of GUARDS: the guard it was raised with (--guard), else what its words say it does. */
export const guardOf = (d: Decision) => d.guard ?? GUARD_WORDS.find(([, words]) => words.test([d.title, d.about, d.detail, d.why, ...d.options.flatMap((o) => [o.label, o.outcome])].filter(Boolean).join('\n')))?.[0];
/** A plain ask, yes/no or pick-one: the only kind the leash may answer. A design, plan, sign-in, gate or finding always waits for the person. */
export const plainAsk = (d: Decision) => d.type === 'decision' && (!d.kind || d.kind === 'ask') && !d.run && !d.finding && d.options.length > 0;
/** Reports (nothing to answer) archive on their own this long after they were filed: dismissed, never deleted. Evidence is kept for good: only a dismiss line hides a proof. */
export const ARCHIVE_MS = 24 * 3_600_000;
/** Keys hidden now: the last line for each dismissed it, and no answer or round came after it. A torn line is skipped and reported through warn.
 * `items`, when given, adds the archive: reports filed over a day ago that no log line ever named. Restore writes a line, so a restored item stays. */
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
  const archived = items.filter((d) => d.type !== 'evidence' && !asks(d) && !named.has(d.key) && Date.now() - Date.parse(d.filed ?? '') > ARCHIVE_MS).map((d) => d.key);
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
      else if (a && a.part === undefined && a.op === undefined) warn(`skipped unreadable line ${n + 1} in ${annotationsPath(decisionsPath)}`);
    } catch {
      warn(`skipped unreadable line ${n + 1} in ${annotationsPath(decisionsPath)}`);
    }
  });
  return [...all.values()];
}
/** A comment on one part of a guided page, in the same file as mock comments: a line with a `part`, then the agent reading it (`op: read`) and its reply (`op: reply`). */
export type PartComment = { id: string; key: string; part: string; about: string; verdict?: 'agree' | 'disagree'; text?: string; at: string; read?: string; reply?: string; replied?: string };
export function readPartComments(decisionsPath: string): PartComment[] {
  const all = new Map<string, PartComment>();
  readRaw(annotationsPath(decisionsPath)).split('\n').forEach((line) => {
    try {
      const x = line && JSON.parse(line), c = x && all.get(x.id);
      if (typeof x?.part === 'string' && typeof x.id === 'string') all.set(x.id, { id: x.id, key: x.key, part: x.part, about: x.about, ...(x.verdict && { verdict: x.verdict }), ...(x.text && { text: x.text }), at: x.at });
      else if (c && x.op === 'read') c.read ??= x.at;
      else if (c && x.op === 'reply') { c.reply = x.text; c.replied = x.at; c.read ??= x.at; }
    } catch {}
  });
  return [...all.values()];
}
export function appendPartComment(decisionsPath: string, key: string, part: string, about: string, verdict?: 'agree' | 'disagree', text?: string): PartComment {
  const id = randomBytes(6).toString('hex'), at = now();
  appendLine(annotationsPath(decisionsPath), { id, key, part, about, ...(verdict && { verdict }), ...(text && { text }), at });
  return { id, key, part, about, ...(verdict && { verdict }), ...(text && { text }), at };
}
export const markCommentsRead = (decisionsPath: string, ids: string[]) => { for (const id of ids) appendLine(annotationsPath(decisionsPath), { op: 'read', id, at: now() }); };
export const replyComment = (decisionsPath: string, id: string, text: string) => appendLine(annotationsPath(decisionsPath), { op: 'reply', id, text, at: now() });
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
/** Whole reports opened or marked unread, in the same file with no part: the last line for a key wins, so Reports' read and unread toggle (true read, false unread). */
export function readOpened(decisionsPath: string): Record<string, boolean> {
  const last: Record<string, boolean> = {};
  readRaw(readsPath(decisionsPath)).split('\n').forEach((line) => {
    try { const r = line && JSON.parse(line); if (r && typeof r.key === 'string' && r.part === undefined && typeof r.read === 'boolean') last[r.key] = r.read; } catch {}
  });
  return last;
}
export const appendOpened = (decisionsPath: string, keys: string[], read: boolean) => keys.forEach((key) => appendLine(readsPath(decisionsPath), { key, read, by: 'captain', at: now() }));

/** Go deeper: the person asks the agent about one part of a guided page; the agent answers in pieces that the board streams into that spot.
 * One line each: an ask (id, key, part, what it is about, an optional question), the agent reading it, a piece of the answer (`more` while it goes on), and its end. */
export type Engagement = { version: 1; kind: string; schema: number; filer: string; revision: string; action: 'question' | 'deeper' | 'simplify' | 'example' | 'why' | 'custom'; selection?: { field: string; start: number; end: number; quote: string } };
export type Deeper = Partial<Engagement> & { seen?: number; answerRevision?: number; id: string; key: string; part: string; about: string; q?: string; at: string; read?: string; text: string; answered?: string; done?: boolean };
export const deeperPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.deeper.jsonl';
export function readDeeper(decisionsPath: string): Deeper[] {
  const all = new Map<string, Deeper>();
  readRaw(deeperPath(decisionsPath)).split('\n').forEach((line) => {
    try {
      const x = line && JSON.parse(line), d = x && all.get(x.id);
      if (x?.op === 'ask' && typeof x.id === 'string') all.set(x.id, { id: x.id, key: x.key, part: x.part, about: x.about, ...(x.q && { q: x.q }), at: x.at, text: '', ...(x.version === 1 && { version: 1, kind: x.kind, schema: x.schema, filer: x.filer, revision: x.revision, action: x.action, ...(x.selection && { selection: x.selection }) }) });
      else if (d && x.op === 'read') d.read ??= x.at;
      else if (d && x.op === 'seen') d.seen = x.answerRevision;
      else if (d && x.op === 'say') { if (d.version === 1) d.answerRevision = (d.answerRevision ?? 0) + 1; d.text += (d.text ? '\n\n' : '') + x.text; d.answered = x.at; d.read ??= x.at; if (!x.more) d.done = true; }
    } catch {}
  });
  return [...all.values()];
}
export const askDeeper = (decisionsPath: string, key: string, part: string, about: string, q?: string): Deeper => {
  const id = randomBytes(6).toString('hex'), at = now();
  appendLine(deeperPath(decisionsPath), { op: 'ask', id, key, part, about, ...(q && { q }), at });
  return { id, key, part, about, ...(q && { q }), at, text: '' };
};
const engagementVersion = (file: string, id: string) => readDeeper(file).find(a => a.id === id)?.version === 1 ? { version: 1 } : {};
export const markDeeperRead = (decisionsPath: string, ids: string[]) => { for (const id of ids) appendLine(deeperPath(decisionsPath), { op: 'read', ...engagementVersion(decisionsPath, id), id, at: now() }); };
export const answerDeeper = (decisionsPath: string, id: string, text: string, more: boolean) => appendLine(deeperPath(decisionsPath), { op: 'say', ...engagementVersion(decisionsPath, id), id, text, ...(more && { more: true }), at: now() });

/** Hash only authored fields, independent of JSON property order and board-added metadata. */
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
export function documentRevision(m: any): string {
  const fields = ['contract', 'kind', 'schema', 'key', 'filer', 'title', 'link', 'about', 'filed', 'group', 'decided', 'asked_by', 'purpose', 'project', 'understood', 'visual', 'sections', 'decisions', 'next'];
  return createHash('sha256').update(JSON.stringify(canonical(Object.fromEntries(fields.filter(k => m[k] !== undefined).map(k => [k, m[k]]))))).digest('hex');
}
/** Target field paths are relative to exactly one authored part, never UI/control text. */
export function engagementField(d: Decision, part: string, field: string): string | undefined {
  const [id, i, extra] = part.split(':'), section = d.sections?.find(s => s.id === id);
  let target: any, allowed: string[] = [];
  if (part === 'this') { target = d; allowed = ['title', 'about', 'visual.heading', 'visual.text']; }
  else if (part === 'understood') { target = d; allowed = (d.understood ?? []).flatMap((_, n) => [`understood.${n}.label`, `understood.${n}.text`]); }
  else if (part === 'next') { target = d.next; allowed = ['heading', ...(d.next?.lines ?? []).map((_, n) => `lines.${n}`)]; }
  else if (id === 'd' && !extra) { target = d.decisions?.find(q => q.key === i); allowed = ['question', 'why', 'reason', 'after', 'quiet']; }
  else if (section && !extra) { target = i === undefined ? section : /^\d+$/.test(i) ? section.items?.[+i] : undefined; allowed = i === undefined ? ['heading', 'body'] : ['title', 'text', 'more']; }
  const value = allowed.includes(field) ? field.split('.').reduce((v, k) => v?.[k], target) : undefined;
  return typeof value === 'string' ? value : undefined;
}
export function checkEngagement(file: string, ask: Deeper) {
  if (ask.version !== 1) return;
  const d = loadDecisions(file).find(d => d.key === ask.key);
  if (!d?.engagement || d.engagement.revision !== ask.revision || d.filer !== ask.filer || !guidePart(d, ask.part)) throw new InputError('This request is stale; ask again on the current document');
}
export function askEngagement(file: string, input: any) {
  if (!input || typeof input !== 'object' || Object.keys(input).some(k => !['version', 'id', 'key', 'kind', 'schema', 'filer', 'revision', 'part', 'action', 'q', 'selection'].includes(k))) throw new InputError('Unknown engagement field');
  const d = loadDecisions(file).find(d => d.key === input.key), about = d && typeof input.part === 'string' && guidePart(d, input.part);
  if (input.version !== 1 || !isKey(input.id) || !about || input.part.split(':').length > 2 || !d?.engagement || !['question', 'deeper', 'simplify', 'example', 'why', 'custom'].includes(input.action)) throw new InputError('Send a version 1 engagement request with an id, action and valid part');
  if ((['question', 'custom'].includes(input.action) || input.q !== undefined) && (typeof input.q !== 'string' || !input.q.trim() || [...input.q].length > 500)) throw new InputError('Question and custom asks need text, at most 500 code points');
  for (const k of ['kind', 'schema', 'filer', 'revision'] as const) if (input[k] !== d.engagement[k]) throw new InputError('This target is stale; reload and ask again');
  const s = input.selection;
  if (s !== undefined) {
    if (!s || typeof s !== 'object' || Object.keys(s).sort().join(',') !== 'end,field,quote,start') throw new InputError('Selection needs field, start, end and quote');
    const value = typeof s.field === 'string' ? engagementField(d, input.part, s.field) : undefined;
    if (value === undefined || !Number.isSafeInteger(s.start) || !Number.isSafeInteger(s.end) || s.start < 0 || s.end <= s.start || s.end > [...value].length || typeof s.quote !== 'string' || [...s.quote].length > 500 || [...value].slice(s.start, s.end).join('') !== s.quote) throw new InputError('Selection does not match this authored field');
  }
  const prior = readDeeper(file).find(a => a.id === input.id);
  if (prior) {
    if (JSON.stringify(canonical(input)) !== JSON.stringify(canonical(Object.fromEntries(Object.keys(input).map(k => [k, (prior as any)[k]]))))) throw new InputError('Request id already belongs to another ask');
    return prior;
  }
  const ask = { ...input, about, at: now(), text: '' };
  appendLine(deeperPath(file), { ...ask, op: 'ask' }); return ask;
}
export function markEngagementSeen(file: string, id: string, revision: number) {
  const ask = readDeeper(file).find(a => a.id === id);
  if (!ask || ask.version !== 1 || !Number.isSafeInteger(revision) || revision !== ask.answerRevision) throw new InputError('This answer changed; read it again');
  appendLine(deeperPath(file), { op: 'seen', version: 1, id, answerRevision: revision, at: now() });
}

/** The trail of what the person sent: each answer (a pick, a note, a design's change notes, a plan's send-back), each new round, each comment and each discard with its reason, and how far it got:
 * delivered (handed over by a wait, a poll or the on_answer hook), read (taken by the agent itself) and replied (its words, a link to what it made, or the card posted again).
 * The agent's marks are one line each in <board>.trail.jsonl: a mark names a key and covers every send on it up to its time. The person opening a reply, or an answer the leash took, marks it seen. */
export type TrailMark = { op: 'delivered' | 'read' | 'reply' | 'seen'; key: string; id?: string; text?: string; link?: string; at: string };
export type Trail = { id: string; key: string; kind: 'answer' | 'round' | 'comment' | 'ask' | 'part' | 'ticket' | 'discard'; part?: string; /** An answer the leash took: its first step reads Taken or Picked, and `opened` is when the person first opened the card after it. */ taken?: Took['taken']; opened?: string; reason?: DiscardReason; /** A ticket comment's words: the board keeps them nowhere else. */ said?: string; at: string; delivered?: string; read?: string; reply?: { at: string; text?: string; link?: string; acted?: true }; seen?: string };
export const trailPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.trail.jsonl';
export const appendMark = (decisionsPath: string, mark: Omit<TrailMark, 'at'>, at = now()) => appendLine(trailPath(decisionsPath), { ...mark, at });
/** `delivery` is the owner dispatch's record per Go deeper ask (src/owner.ts deliveries): handed to the author's session, then acknowledged by it. */
export function readTrail(decisionsPath: string, items: Decision[], delivery: Record<string, { state: string; at: string }> = {}): Trail[] {
  const marks: TrailMark[] = readRaw(trailPath(decisionsPath)).split('\n').flatMap((line) => {
    try { const m = line && JSON.parse(line); return m && ['delivered', 'read', 'reply', 'seen'].includes(m.op) && typeof m.key === 'string' && !Number.isNaN(Date.parse(m.at)) ? [m] : []; } catch { return []; }
  });
  const taken = seenAt(decisionsPath), filed = new Map(items.map((d) => [d.key, d.filed]));
  const first = (...at: (string | undefined)[]) => at.filter((x): x is string => !!x).sort((x, y) => Date.parse(x) - Date.parse(y))[0];
  const sends: Trail[] = [
    ...answerLines(decisionsPath).filter((a) => a.answer !== '' && !a.merged_by).map((a): Trail => ({ id: `answer:${a.key}:${a.at}`, key: a.key, kind: 'answer', at: a.at, read: taken(a) === '' ? a.at : taken(a), ...(a.taken && { taken: a.taken }) })),
    ...readRounds(decisionsPath).map((r): Trail => ({ id: `round:${r.key}:${r.at}`, key: r.key, kind: 'round', at: r.at })),
    ...readDiscards(decisionsPath).map((x): Trail => ({ id: `discard:${x.key}:${x.at}`, key: x.key, kind: 'discard', reason: x.reason, at: x.at })),
    ...readMessages(decisionsPath).flatMap((m): Trail[] => (m.kind === 'comment' && m.key ? [{ id: m.id, key: m.key, kind: 'comment', at: m.at, delivered: m.delivered }] : [])),
    // On a guided plan or report: each Go deeper (or other) ask on a part, read when a wait handed it over or its author's session acknowledged it, replied once answered;
    // and each Agree, Disagree or Comment on a part, read when a wait handed it over, replied with the agent's words.
    ...readDeeper(decisionsPath).map((x): Trail => {
      const d = delivery[x.id], owned = d?.state === 'owner-read' ? d.at : undefined;
      return { id: x.id, key: x.key, kind: 'ask', part: x.part, at: x.at, ...(d?.state === 'delivered' && { delivered: d.at }), read: first(owned, x.read),
        ...(x.done && x.answered && { reply: { at: x.answered, text: x.text } }) };
    }),
    // A comment on a ticket, as the fleet dashboard keeps it: delivered unless its delivery failed, read once the lead picked it up, replied with the lead's last answer.
    ...readTicketComments(decisionsPath).map((c): Trail => ({ id: c.id, key: c.ticket, kind: 'ticket', said: c.text, at: iso(c.at), ...(!c.error && { delivered: iso(c.at) }), ...(c.picked && { read: iso(c.picked) }),
      ...(c.replies?.length && { reply: { at: iso(c.replies.at(-1)!.at ?? c.at), text: c.replies.at(-1)!.text } }) })),
    ...readPartComments(decisionsPath).map((c): Trail => ({ id: c.id, key: c.key, kind: 'part', part: c.part, at: c.at, read: c.read, ...(c.reply !== undefined && c.replied && { reply: { at: c.replied, text: c.reply } }) })),
  ];
  return sends.map((s) => {
    // A mark covers a send made at or before it (to the second: a post's time may carry milliseconds, a send's does not).
    const mark = (...ops: string[]) => marks.find((m) => ops.includes(m.op) && m.key === s.key && (!m.id || m.id === s.id) && second(m.at) >= second(s.at));
    const said = s.reply ? undefined : marks.filter((m) => m.op === 'reply' && m.key === s.key && (!m.id || m.id === s.id) && second(m.at) >= second(s.at)).sort((x, y) => second(y.at) - second(x.at))[0], again = filed.get(s.key), posted = again && second(again) > second(s.at) ? again : undefined;
    const reply = s.reply ?? (said ? { at: said.at, ...(said.text && { text: said.text }), ...(said.link && { link: said.link }) } : posted ? { at: posted, acted: true as const } : undefined);
    const read = first(mark('read')?.at, s.read, reply?.at), delivered = first(mark('delivered')?.at, s.delivered, read);
    const seen = reply && marks.find((m) => m.op === 'seen' && m.key === s.key && second(m.at) >= second(reply.at))?.at;
    const opened = s.taken && marks.find((m) => m.op === 'seen' && m.key === s.key && second(m.at) >= second(s.at))?.at;
    return { ...s, ...(delivered && { delivered }), ...(read && { read }), ...(reply && { reply }), ...(seen && { seen }), ...(opened && { opened }) };
  });
}

/** A comment the person made on a ticket in the fleet dashboard, in the dashboard's own thread record: its id, when it was sent (seconds since 1970), the words,
 * the delivery error if it failed, when the lead picked it up, and the lead's answers. The dashboard sends the record again as it moves (`ticket --id <id> --comment`):
 * one line each in <board>.ticket-comments.jsonl, the latest line for an id wins. */
export type TicketComment = { ticket: string; id: string; at: number; text: string; to?: string; error?: string | null; picked?: number | null; replies?: { at: number | null; text: string; by?: string }[] };
export const ticketCommentsPath = (decisionsPath: string) => decisionsPath.replace(/\.json$/, '') + '.ticket-comments.jsonl';
const seconds = (v: unknown) => Number.isSafeInteger(v) && (v as number) > 0;
export const ticketCommentFault = (c: any) => (!c || typeof c !== 'object' || Array.isArray(c) ? 'must be one JSON object, a comment as the dashboard keeps it'
  : !isKey(c.id) ? 'id must be the comment id, 1-128 of A-Z a-z 0-9 . _ -' : !seconds(c.at) ? 'at must be when it was sent, whole seconds since 1970'
  : !isText(c.text) || !c.text.trim() || [...c.text].length > 1000 ? 'text must be the comment, 1-1000 characters'
  : c.error != null && !isText(c.error) ? 'error must be text or null' : c.picked != null && !seconds(c.picked) ? 'picked must be whole seconds since 1970 or null'
  : c.replies !== undefined && (!Array.isArray(c.replies) || c.replies.some((r: any) => !r || (r.at != null && !seconds(r.at)) || !isText(r.text) || !r.text.trim() || [...r.text].length > 2000)) ? 'replies must be a list of {at, text, by}' : '');
export const appendTicketComment = (decisionsPath: string, ticket: string, c: any) => appendLine(ticketCommentsPath(decisionsPath),
  { ticket, id: c.id, at: c.at, text: c.text, ...(c.to && { to: c.to }), error: c.error ?? null, picked: c.picked ?? null, replies: (c.replies ?? []).map(({ at, text, by }: any) => ({ at: at ?? null, text, ...(by && { by }) })) });
export function readTicketComments(decisionsPath: string): TicketComment[] {
  const all = new Map<string, TicketComment>();
  for (const line of readRaw(ticketCommentsPath(decisionsPath)).split('\n')) { try { const c = line && JSON.parse(line); if (c && isKey(c.ticket) && !ticketCommentFault(c)) all.set(c.id, c); } catch {} }
  return [...all.values()];
}
const iso = (s: number) => new Date(s * 1000).toISOString().slice(0, 19) + 'Z';

const now = () => new Date().toISOString().slice(0, 19) + 'Z';
/** Appends one JSON line, starting a new line after a torn fragment. */
function appendLine(file: string, entry: object) {
  const raw = readRaw(file);
  appendFileSync(file, (raw && !raw.endsWith('\n') ? '\n' : '') + JSON.stringify(entry) + '\n', { mode: 0o600 });
}
