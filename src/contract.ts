// The v1 communication contract (docs/contract.md): one strict, versioned shape per kind of message.
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isKey, MEDIA_MAX } from './store.js';

/** A message that does not match: what is wrong, and the one line that says how to fix it. */
export class ContractError extends Error {
  constructor(message: string, readonly help: string) { super(message); }
}
/** The kinds, with the schema number of each. */
export const SCHEMAS: Record<string, number> = { ask: 1, report: 2, evidence: 1, gate: 1, finding: 1, plan: 1 };
export const KINDS = Object.keys(SCHEMAS);
const COMMON = ['contract', 'kind', 'schema', 'key', 'title', 'filer', 'link', 'about'];
const FIELDS: Record<string, string[]> = {
  ask: [...COMMON, 'detail', 'options', 'recommend_value', 'default_if_silent', 'close'],
  report: [...COMMON, 'filed', 'group', 'decided', 'view', 'preview'],
  evidence: [...COMMON, 'media', 'run'],
  gate: [...COMMON, 'run', 'options', 'recommend_value', 'close'],
  finding: [...COMMON, 'cause', 'incidents', 'days', 'evidence_ids', 'change_kind', 'proposal', 'options', 'recommend_value'],
  plan: [...COMMON, 'sections', 'decisions', 'steps', 'view'],
};
/** A done-done run: its id, full commit and the four Checks lines. */
const RUN = ['run_id', 'commit', 'outcome', 'repro', 'proof', 'evidence'];
/** The fixed options of a kind, each with its one label: a gate's are the actions of done-done respond --action. */
const ACTIONS: Record<string, Record<string, string>> = {
  gate: { approve: 'Approve', skip: 'Skip the judge', fix: 'Fix first' },
  finding: { apply: 'Apply', skip: 'Skip' },
};
export const MEDIA_BYTES = 50_000_000;
/** The command that makes a report's page, named in every refusal of a report without one. */
export const REPORT_INIT = 'sign-off-axi report init <folder>';
const PAGE_HELP = `Run \`${REPORT_INIT}\` to make the page, fill it, then post it with "view" and "preview"`;
/** A plan passes validate, but the board cannot show one yet: post refuses it rather than store it as a yes/no ask. */
export function postable(m: any): void {
  if (m.kind === 'plan') throw new ContractError(`${isKey(m.key) ? `key ${m.key}: ` : ''}kind plan cannot be posted yet: the board does not show plans`, 'Check it with `sign-off-axi validate <file.json>`; post it once sign-off-axi shows plans');
}

/** Parses one message; a field written twice in any object refuses it, since plain JSON.parse keeps the last one quietly. */
export function parseMessage(bytes: Uint8Array): unknown {
  let text, doc;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    throw new ContractError('the file is not UTF-8 text', 'Save the message as UTF-8');
  }
  try { doc = JSON.parse(text); } catch (e: any) {
    throw new ContractError(`invalid JSON: ${e.message}`, 'Write the message as one JSON object');
  }
  // The text is valid JSON, so only strings, brackets and commas matter: a string right after { or , in an object is a field name.
  const stack: { keys?: Set<string>; name: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i], top = stack.at(-1);
    if (c === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      const name: string = JSON.parse(text.slice(i, end + 1));
      if (top?.keys && top.name) {
        if (top.keys.has(name)) throw new ContractError(`field "${escaped(name)}" is written twice`, `Remove the second ${show(name)}.`);
        top.keys.add(name);
        top.name = false;
      }
      i = end;
    } else if (c === '{') stack.push({ keys: new Set(), name: true });
    else if (c === '[') stack.push({ name: false });
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',' && top?.keys) top.name = true;
  }
  return doc;
}

const whole = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const show = (v: unknown) => JSON.stringify(v);
/** A field name as it reads inside a sentence: escaped, so a newline or control character shows as \n or \u001b. */
const escaped = (v: string) => show(v).slice(1, -1);

/** Checks one message against its kind's rules and returns its kind and schema; the first broken rule throws, in the order docs/contract.md gives.
 * `want` is the kind the caller expects, so the wrong file is refused before its fields are read. */
export function checkMessage(m: any, want?: string): { kind: string; schema: number } {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new ContractError('the message must be one JSON object', 'Write the message as one JSON object, such as {"contract":1,"kind":"ask",...}');
  const at = isKey(m.key) ? `key ${m.key}: ` : '';
  const bad = (field: string, rule: string, help: string) => new ContractError(`${at}${field} ${rule}`, help);
  const need = (f: string) => {
    if (!Object.hasOwn(m, f)) throw bad(f, 'is required', 'Add "contract": 1, "kind" and "schema" to the message, such as "contract": 1, "kind": "ask", "schema": 1');
  };
  /** Text: a string with something besides whitespace, no control character but newline, no unpaired surrogate, and at most max code points. */
  const text = (field: string, v: unknown, max: number, set: string) => {
    const name = field.replace(/^.*\./, '');
    if (typeof v !== 'string' || !/\S/.test(v)) throw bad(field, 'must be text', `Set "${name}" to ${set}`);
    if (/[\0-\x09\x0b-\x1f\x7f-\x9f]/.test(v)) throw bad(field, 'has a control character other than newline', `Remove tabs and other control characters from "${name}"`);
    if (/\p{Cs}/u.test(v)) throw bad(field, 'has an unpaired surrogate (half of a character)', `Remove the broken character from "${name}", or write it whole`);
    if ([...v].length > max) throw bad(field, `is ${[...v].length} characters, over ${max}`, `Shorten "${name}" to ${max} characters`);
  };
  /** A done-done run block with exactly these fields: an id, a full commit, and on evidence the four Checks lines. */
  const checkRun = (fields: string[]) => {
    const r = m.run;
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw bad('run', 'must be an object', `Set "run" to {${fields.map(show).join(', ')}}`);
    const odd = Object.keys(r).find((f) => !fields.includes(f));
    if (odd !== undefined) throw bad(`run.${escaped(odd) || '""'}`, 'is not a field of run', `Remove ${show(odd)}; run has only ${fields.join(', ')}`);
    const missing = fields.find((f) => !Object.hasOwn(r, f));
    if (missing) throw bad(`run.${missing}`, 'is required', `Add "${missing}" to "run"`);
    if (!isKey(r.run_id)) throw bad('run.run_id', 'must be 1-128 of A-Z a-z 0-9 . _ -', 'Set "run_id" to the done-done run id');
    if (!(typeof r.commit === 'string' && /^[a-f0-9]{40}$/.test(r.commit))) throw bad('run.commit', 'must be a full 40-character lowercase commit', 'Set "commit" to the full hash, such as the output of git rev-parse HEAD');
    for (const f of fields.slice(2)) text(`run.${f}`, r[f], 1000, `the run's ${f} Checks line, in 1000 characters or fewer`);
  };
  /** A list of min to max objects, each with only `fields`: a plan's sections, decisions and steps. */
  const list = (f: string, min: number, max: number, fields: string[], example: string): any[] => {
    const v = m[f], one = f.slice(0, -1), set = `Set "${f}" to ${min}-${max} objects such as ${example}`;
    if (!Array.isArray(v) || v.length < min || v.length > max) throw bad(f, Object.hasOwn(m, f) ? `must list ${min} to ${max} ${f}` : 'is required', set);
    v.forEach((o: any, n: number) => {
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad(`${f}[${n}]`, 'must be an object', set);
      const odd = Object.keys(o).find((k) => !fields.includes(k));
      if (odd !== undefined) throw bad(`${f}[${n}].${escaped(odd) || '""'}`, `is not a field of a ${one}`, `Remove ${show(odd)}; a ${one} has only ${fields.join(', ')}`);
    });
    return v;
  };
  /** Each option: exactly value and label (and on a plan's decision, outcome), its value unique. Ask, gate, finding and plan decisions share it. */
  const checkOptions = (field: string, options: any[], outcome = false) => options.forEach((o: any, n: number) => {
    const at = `${field}[${n}]`, fields = outcome ? ['value', 'label', 'outcome'] : ['value', 'label'];
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad(at, 'must be an object', `Write each option as {"value":"<id>","label":"<text>"${outcome ? ',"outcome":"<what it leads to>"' : ''}}`);
    const odd = Object.keys(o).find((f) => !fields.includes(f));
    if (odd !== undefined) throw bad(`${at}.${escaped(odd) || '""'}`, 'is not a field of an option', `Remove ${show(odd)}; an option has only ${fields.join(', ')}`);
    if (!isKey(o.value)) throw bad(`${at}.value`, 'must be 1-128 of A-Z a-z 0-9 . _ -', 'Set "value" to a short id such as "yes"');
    if (options.slice(0, n).some((p: any) => p.value === o.value)) throw bad(`${at}.value`, `repeats ${o.value}`, 'Give every option its own value');
    text(`${at}.label`, o.label, 80, 'the button text, in 80 characters or fewer');
    if (outcome) text(`${at}.outcome`, o.outcome, 200, 'what picking it leads to, in 200 characters or fewer');
  });
  /** The option the poster would pick, `field` on `o`: required, and one of the option values, which it returns. */
  const recommend = (field: string, o: any, options: any[]): string[] => {
    const name = field.replace(/^.*\./, ''), values = options.map((p: any) => p.value), pick = `the option you would pick: one of ${values.join(', ')}`;
    if (!Object.hasOwn(o, name)) throw bad(field, 'is required', `Add "${name}": ${show(values[0])}, ${pick}`);
    if (!values.includes(o[name])) throw bad(field, `${show(o[name])} is not an option value`, `Set "${name}" to ${pick}`);
    return values;
  };
  /** A page path, as a report's view and preview are: relative, inside the board file's folder, with the given ending. */
  const page = (f: string, ends: RegExp, kinds: string, example: string, need: string, help = PAGE_HELP) => {
    if (!Object.hasOwn(m, f)) throw bad(f, `is required: ${need}`, help);
    text(f, m[f], 256, `${example}, a path from the board file's folder`);
    if (/^([\\/]|[A-Za-z]:)/.test(m[f]) || m[f].split(/[\\/]/).includes('..') || /[?#\\]/.test(m[f])) throw bad(f, `${show(m[f])} must be a relative path with no .., ?, # or \\`, `Set "${f}" to ${example}, a path from the board file's folder`);
    if (!ends.test(m[f])) throw bad(f, `${show(m[f])} must end in ${kinds}`, help);
  };
  need('contract');
  if (m.contract !== 1) throw bad('contract', `must be 1, not ${show(m.contract)}`, whole(m.contract) ? 'Upgrade sign-off-axi: this one knows contract 1' : 'Set "contract": 1');
  need('kind');
  if (!KINDS.includes(m.kind)) throw bad('kind', `must be one of ${KINDS.join(', ')}, not ${show(m.kind)}`, `Set "kind" to one of ${KINDS.join(', ')}`);
  if (want !== undefined && m.kind !== want) throw bad('kind', `is ${m.kind}, not --kind ${want}`, `Pass --kind ${m.kind}, or name the ${want} message file`);
  need('schema');
  if (!whole(m.schema)) throw bad('schema', `must be a whole number, not ${show(m.schema)}`, `Set "schema": ${SCHEMAS[m.kind]}`);
  if (m.kind === 'report' && m.schema === 1) throw bad('schema', '1 of report is text only: a report must be a page to tap through, with "view" and "preview"', PAGE_HELP);
  if (m.schema !== SCHEMAS[m.kind]) throw bad('schema', `${m.schema} of ${m.kind} is not in this sign-off-axi`, `Upgrade sign-off-axi, or post ${m.kind} schema ${SCHEMAS[m.kind]}`);
  const fields = FIELDS[m.kind], extra = Object.keys(m).find((f) => !fields.includes(f));
  if (extra === 'options' && m.kind === 'report') throw bad('options', 'is not a field of report: a report takes no answer', 'Remove "options", or post an ask to get an answer');
  if (extra === 'options' && m.kind === 'plan') throw bad('options', 'is not a field of plan: its answers come from its sections and decisions', 'Remove "options"; put each question in "decisions", with its options and "recommend"');
  if (extra !== undefined) throw bad(escaped(extra) || '""', `is not a field of ${m.kind} schema ${m.schema}`, `Remove ${show(extra)}; ${m.kind} takes ${fields.slice(3).join(', ')}`);
  if (!(m.kind === 'evidence' && !Object.hasOwn(m, 'key')) && !isKey(m.key)) throw bad('key', Object.hasOwn(m, 'key') ? `${show(m.key)} must be 1-128 of A-Z a-z 0-9 . _ -` : 'is required', 'Set "key" to a short id such as "ship-signin-2"');
  if (!Object.hasOwn(m, 'title')) throw bad('title', 'is required', 'Add "title": the question, in 160 characters or fewer');
  text('title', m.title, 160, 'the question, in 160 characters or fewer');
  if (Object.hasOwn(m, 'filer') && !isKey(m.filer)) throw bad('filer', 'must be 1-128 of A-Z a-z 0-9 . _ -', 'Set "filer" to your agent session id or tool name, or leave it out');
  if (Object.hasOwn(m, 'link') && !(typeof m.link === 'string' && /^(https?:\/\/[^\s\p{Cc}\p{Cs}]{1,500}|[a-f0-9]{7,40})$/u.test(m.link))) {
    throw bad('link', 'must be an http(s) link with no spaces or control characters, or a 7-40 character commit hash',
      'Set "link" to a URL such as "https://example.com/pr/4" or a commit hash, or leave it out');
  }
  if (m.kind !== 'ask') {
    const what = ({ report: 'what happened', plan: 'the plan, answer first', gate: 'why the run is held', finding: 'the counts, with no record text' } as Record<string, string>)[m.kind] ?? 'what this shows';
    if (!Object.hasOwn(m, 'about')) throw bad('about', 'is required', `Add "about": ${what}, in 500 characters or fewer`);
    text('about', m.about, 500, `${what}, in 500 characters or fewer`);
  }
  if (m.kind === 'evidence') {
    if (!Object.hasOwn(m, 'media') && !Object.hasOwn(m, 'run')) throw bad('media', 'or run is required', 'Add "media": ["shot.png"], files next to the message, or "run": the done-done run it proves');
    if (Object.hasOwn(m, 'media')) {
      if (!Array.isArray(m.media) || !m.media.length || m.media.length > MEDIA_MAX) throw bad('media', `must list 1 to ${MEDIA_MAX} files`, 'Set "media" to file paths next to the message, such as ["shot.png"]');
      m.media.forEach((p: unknown, n: number) => {
        text(`media[${n}]`, p, 1000, 'a file path from the message file\'s folder, such as "shot.png"');
        if (/^([\\/]|[A-Za-z]:)/.test(p as string) || (p as string).split(/[\\/]/).includes('..')) throw bad(`media[${n}]`, `${show(p)} must be a relative path with no ..`, 'Give the path from the message file\'s folder, such as "evidence-out/after.png"');
        if (!/\.(png|jpe?g|webp|mp4|webm)$/i.test(p as string)) throw bad(`media[${n}]`, `${show(p)} must end in .png, .jpg, .jpeg, .webp, .mp4 or .webm`, 'Post a screenshot or recording in one of those formats');
      });
    }
    if (Object.hasOwn(m, 'run')) checkRun(RUN);
    return { kind: m.kind, schema: m.schema };
  }
  if (m.kind === 'report') {
    // An exact UTC second that exists on the calendar: Date.parse would roll 2026-02-30 over to March.
    const at = typeof m.filed === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(m.filed) ? new Date(m.filed) : undefined;
    if (!at || Number.isNaN(at.getTime()) || at.toISOString().replace('.000', '') !== m.filed) {
      throw bad('filed', Object.hasOwn(m, 'filed') ? `${show(m.filed)} is not a UTC time such as 2026-10-13T07:19:00Z` : 'is required', 'Set "filed" to when it happened, exactly YYYY-MM-DDTHH:MM:SSZ in UTC, such as "2026-10-13T07:19:00Z"');
    }
    if (Object.hasOwn(m, 'group')) text('group', m.group, 40, 'the section it belongs to, in 40 characters or fewer, or leave it out');
    if (Object.hasOwn(m, 'decided')) text('decided', m.decided, 200, 'what was decided, in 200 characters or fewer, or leave it out');
    // A report is a page to tap through and a picture of it for the card: text alone is a status note, not a report.
    const need = 'a report is a page to tap through, not text';
    page('view', /\.html$/i, '.html', '"mocks/<key>/index.html"', need);
    page('preview', /\.(svg|png|jpe?g|webp)$/i, '.svg, .png, .jpg, .jpeg or .webp', '"mocks/<key>/preview.svg"', need);
    if (dirname(m.preview) !== dirname(m.view)) throw bad('preview', `${show(m.preview)} must sit in the folder of ${show(m.view)}`, `Put the picture beside the page, such as "${dirname(m.view)}/preview.svg"`);
    return { kind: m.kind, schema: m.schema };
  }
  // A plan is sections to approve or change, decisions with a recommended pick, steps to tap through, and where it goes as a diagram.
  if (m.kind === 'plan') {
    const ids = list('sections', 1, 8, ['id', 'heading', 'body'], '{"id":"goals","heading":"Goals and non-goals","body":"<what it does and does not do>"}').map((o, n) => {
      if (!(typeof o.id === 'string' && /^[a-z0-9-]{1,40}$/.test(o.id))) throw bad(`sections[${n}].id`, 'must be 1-40 of a-z 0-9 -', 'Set "id" to a short slug such as "goals"');
      text(`sections[${n}].heading`, o.heading, 80, 'the section heading, in 80 characters or fewer');
      text(`sections[${n}].body`, o.body, 1000, 'the section, in 1000 characters or fewer');
      return o.id;
    });
    const twice = ids.findIndex((id, n) => ids.indexOf(id) < n);
    if (twice >= 0) throw bad(`sections[${twice}].id`, `repeats ${ids[twice]}`, 'Give every section its own id');
    list('decisions', 0, 5, ['key', 'question', 'why', 'options', 'recommend'], '{"key":"store","question":"Keep plans in the board file?","why":"...","options":[...],"recommend":"yes"}').forEach((o, n, all) => {
      const at = `decisions[${n}]`;
      if (!isKey(o.key)) throw bad(`${at}.key`, 'must be 1-128 of A-Z a-z 0-9 . _ -', 'Set "key" to a short id such as "store"');
      if (all.slice(0, n).some((p) => p.key === o.key)) throw bad(`${at}.key`, `repeats ${o.key}`, 'Give every decision its own key');
      text(`${at}.question`, o.question, 160, 'the question, ending in a question mark');
      // One question: a single ?, as its last character, so "Keep A? Or B?" is two decisions.
      const q = o.question.trim();
      if (q.search(/[?？]/) !== q.length - 1) throw bad(`${at}.question`, 'must be one question, with one question mark as its last character', 'Ask one question ending in a question mark, and split any other into its own decision');
      if (!/[\p{L}\p{N}]/u.test(q) || q.split(/\s+/).length > 12) throw bad(`${at}.question`, 'must be one question of 12 words or fewer, ending in a question mark', 'Ask it in 12 words or fewer, ending in a question mark; put the rest in "why"');
      text(`${at}.why`, o.why, 500, 'why it matters, in 500 characters or fewer');
      if (!Array.isArray(o.options) || o.options.length < 2 || o.options.length > 6) throw bad(`${at}.options`, Object.hasOwn(o, 'options') ? 'must list 2 to 6 options' : 'is required', 'Set "options" to 2-6 objects such as {"value":"yes","label":"Yes","outcome":"Plans live in the board file"}');
      checkOptions(`${at}.options`, o.options, true);
      recommend(`${at}.recommend`, o, o.options);
    });
    if (Object.hasOwn(m, 'steps')) list('steps', 2, 12, ['title'], '{"title":"The agent posts the plan"}').forEach((o, n) => text(`steps[${n}].title`, o.title, 80, 'the step, in 80 characters or fewer'));
    page('view', /\.html$/i, '.html', '"mocks/<key>/index.html"', 'a plan shows where it goes as a diagram on a page', 'Set "view" to "mocks/<key>/index.html", a path from the board file\'s folder');
    return { kind: m.kind, schema: m.schema };
  }
  if (Object.hasOwn(m, 'about')) text('about', m.about, 500, 'a short note, or leave it out');
  if (Object.hasOwn(m, 'detail')) text('detail', m.detail, 1000, 'the longer note, or leave it out');
  // A gate offers 2 or 3 of done-done's actions and a finding both of apply and skip, in any order, each with its own label.
  const options = m.options, actions = ACTIONS[m.kind], max = actions ? Object.keys(actions).length : 6;
  const named = actions && Object.entries(actions).map(([value, label]) => show({ value, label })).join(', ');
  const listed = !actions ? 'Set "options" to 2-6 objects such as {"value":"yes","label":"Yes"}' : max === 3 ? `Set "options" to 2 or 3 of ${named}` : `Set "options" to ${named}`;
  if (!Array.isArray(options) || options.length < 2 || options.length > max) throw bad('options', Object.hasOwn(m, 'options') ? `must list ${({ 2: '2', 3: '2 or 3' } as Record<number, string>)[max] ?? '2 to 6'} options` : 'is required', listed);
  checkOptions('options', options);
  const odd = actions && options.find((o: any) => !Object.hasOwn(actions, o.value) || actions[o.value] !== o.label);
  if (odd) throw bad('options', `${show(odd)} is not a ${m.kind} action: ${Object.keys(actions).join(', ')}, each with its label`, listed);
  const values = recommend('recommend_value', m, options);
  if (Object.hasOwn(m, 'default_if_silent') && !values.includes(m.default_if_silent)) {
    throw bad('default_if_silent', `${show(m.default_if_silent)} is not an option value`, `Set "default_if_silent" to one of ${values.join(', ')}, or leave it out`);
  }
  if (Object.hasOwn(m, 'close') && m.close !== 'done' && m.close !== 'release') throw bad('close', 'must be done or release', 'Set "close" to "done" or "release", or leave it out');
  // A gate's run is its own rule (section 5), so it comes after the field rules of section 4.
  if (m.kind === 'gate') {
    if (!Object.hasOwn(m, 'run')) throw bad('run', 'is required', 'Add "run": {"run_id": "<done-done run id>", "commit": "<full commit>"}, the run held for approval');
    checkRun(RUN.slice(0, 2));
  }
  // A finding names its records by id only; the validator cannot see record text, so keeping it out is the producer's job.
  if (m.kind === 'finding') {
    const must = (f: string, ok: (v: any) => boolean, rule: string, help: string) => {
      if (!Object.hasOwn(m, f)) throw bad(f, 'is required', help);
      if (!ok(m[f])) throw bad(f, rule, help);
    };
    must('cause', (v) => typeof v === 'string' && /^[a-z0-9-]{1,64}$/.test(v), 'must be 1-64 of a-z 0-9 -', 'Set "cause" to the repeated cause, such as "missing-env"');
    for (const f of ['incidents', 'days']) must(f, whole, 'must be a whole number, 0 or more', `Set "${f}" to a count, such as 4`);
    must('evidence_ids', (v) => Array.isArray(v) && v.length <= 50, 'must list 0 to 50 record ids', 'Set "evidence_ids" to the ids of the records, such as ["rec-7f3a"], never their text');
    m.evidence_ids.forEach((id: unknown, n: number) => {
      if (!isKey(id)) throw bad(`evidence_ids[${n}]`, 'must be 1-128 of A-Z a-z 0-9 . _ -', 'Name each record by its id, never its text');
      if (m.evidence_ids.indexOf(id) < n) throw bad(`evidence_ids[${n}]`, `repeats ${id}`, 'List each record id once');
    });
    must('change_kind', (v) => ['doc', 'rule', 'code'].includes(v), 'must be doc, rule or code', 'Set "change_kind" to "doc", "rule" or "code"');
    if (!Object.hasOwn(m, 'proposal')) throw bad('proposal', 'is required', 'Add "proposal": the change, in 500 characters or fewer');
    text('proposal', m.proposal, 500, 'the change, in 500 characters or fewer');
  }
  return { kind: m.kind, schema: m.schema };
}

/** An evidence message's media files, from `base`, the message file's folder: each a file of 50,000,000 bytes or fewer whose real path,
 * symlinks followed, stays inside that folder. Returns the real paths; validate checks them and copies nothing. */
export function mediaFiles(m: any, base: string): string[] {
  const root = realpathSync(base), at = isKey(m.key) ? `key ${m.key}: ` : '';
  return (m.media ?? []).map((p: string, n: number) => {
    const bad = (rule: string, help: string) => new ContractError(`${at}media[${n}] ${show(p)} ${rule}`, help);
    let real;
    try { real = realpathSync(resolve(root, p)); } catch { throw bad('is not there', `Put ${p} in the message file's folder, or fix the path`); }
    const rel = relative(root, real);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw bad('leads outside the message file\'s folder', 'Copy the file into the message file\'s folder instead of linking to it');
    const info = statSync(real);
    if (!info.isFile()) throw bad('is not a file', 'Name a screenshot or recording file');
    if (!/\.(png|jpe?g|webp|mp4|webm)$/i.test(real)) throw bad('links to a file that does not end in .png, .jpg, .jpeg, .webp, .mp4 or .webm', 'Name the screenshot or recording itself');
    try { accessSync(real, constants.R_OK); } catch { throw bad('cannot be read', 'Make the file readable, then post again'); }
    if (info.size > MEDIA_BYTES) throw bad(`is over ${MEDIA_BYTES} bytes`, 'Trim or compress the recording');
    return real;
  });
}

/** The longest a block of plain text on a report page may run: about five lines on a phone. */
const BLOCK_CHARS = 240;
/** A report's page and picture, from `base`, the board file's folder (or, for validate, the message file's): each a file of 5 MB or less
 * whose real path stays inside that folder, and a page filled in the ladder shape the scaffold gives. The first broken rule throws. */
export function reportPage(m: any, base: string): void {
  const at = isKey(m.key) ? `key ${m.key}: ` : '';
  // A board not made yet has no folder, so its page is not there either.
  let root = resolve(base);
  try { root = realpathSync(base); } catch {}
  const bad = (rule: string, help = PAGE_HELP) => new ContractError(`${at}${rule}`, help);
  const files = (['view', 'preview'] as const).map((f) => {
    let real;
    try { real = realpathSync(resolve(root, m[f])); } catch { throw bad(`${f} ${show(m[f])} is not there`, `Put the file at ${m[f]} from the board file's folder, or fix the path`); }
    const rel = relative(root, real);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw bad(`${f} ${show(m[f])} leads outside the board file's folder`, 'Copy the page into the board file\'s folder, such as under mocks/<key>/');
    const info = statSync(real);
    if (!info.isFile() || info.size > 5_000_000) throw bad(`${f} ${show(m[f])} must be a file of 5 MB or less`, 'Shrink the page or its picture');
    try { accessSync(real, constants.R_OK); } catch { throw bad(`${f} ${show(m[f])} cannot be read`, 'Make the file readable, then post again'); }
    return /\.(html|svg)$/i.test(real) ? readFileSync(real, 'utf8') : '';
  });
  const [html, picture] = files, page = `view ${show(m.view)}`;
  for (const [f, t] of [[page, html], [`preview ${show(m.preview)}`, picture]]) {
    if (/FILL:/.test(t)) throw bad(`${f} still has FILL: lines from the scaffold`, 'Replace every FILL: line with your own words and pictures, then post again');
  }
  if (!/<meta[^>]+name=["']?viewport/i.test(html)) throw bad(`${page} has no viewport tag, so a phone shows it zoomed out`, 'Add <meta name="viewport" content="width=device-width, initial-scale=1">, or start again from report init');
  if (!/prefers-color-scheme/i.test(html)) throw bad(`${page} has no dark mode`, 'Add a @media (prefers-color-scheme: dark) block, or start again from report init');
  if (!/<(svg|img|canvas|video)\b/i.test(html)) throw bad(`${page} has no picture or diagram`, 'Draw the idea: add an <svg> or <img> under the answer and a diagram under it');
  if (!/<(button|input|select)\b/i.test(html)) throw bad(`${page} has nothing to tap or slide, so it is text, not a report`, 'Add a demo the reader can tap through, such as the scaffold\'s steps with Back and Next');
  if (!/<details\b/i.test(html)) throw bad(`${page} has no folded detail`, 'Fold the detail into <details><summary>Details</summary>...</details> at the end');
  if (/<(script|img|iframe|link|video|audio|source)\b[^>]*\b(src|href)\s*=\s*["']?\s*(https?:)?\/\//i.test(html)) throw bad(`${page} loads something from the web, which the board blocks`, 'Put scripts, styles and pictures in the page or beside it');
  // A block is one paragraph or list item; about five lines on a phone is the most a reader takes in at once.
  const long = [...html.matchAll(/<(p|li|dd|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((b) => b[2].replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim())
    .find((t) => [...t].length > BLOCK_CHARS);
  if (long) throw bad(`${page} has a block of ${[...long].length} characters, over ${BLOCK_CHARS} (about five lines on a phone): "${[...long].slice(0, 40).join('')}..."`, 'Split it, cut it, or show it as a picture or step');
}
