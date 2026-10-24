// The v1 communication contract (docs/contract.md): one strict, versioned shape per kind of message.
import { createHash } from 'node:crypto';
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isKey, MEDIA_MAX, PRIORITIES, REPORT_FORMS } from './store.js';

/** A message that does not match: what is wrong, and the one line that says how to fix it. */
export class ContractError extends Error {
  constructor(message: string, readonly help: string) { super(message); }
}
/** The kinds, with the schema number of each. */
export const SCHEMAS: Record<string, number> = { ask: 1, report: 4, evidence: 1, gate: 1, finding: 1, plan: 3, design: 1 };
/** Older schemas this sign-off-axi still takes, so a board that holds them loads and re-posts: the page-based report 2 and plan 1. */
const OLDER: Record<string, number[]> = { report: [2, 3], plan: [1, 2] };
/** The guided schemas: a report 3 and a plan 2 are fields the board draws as one guided page, not a page the agent draws. */
export const guided = (m: any) => (m?.kind === 'report' && [3, 4].includes(m.schema)) || (m?.kind === 'plan' && [2, 3].includes(m.schema));
export const KINDS = Object.keys(SCHEMAS);
const COMMON = ['contract', 'kind', 'schema', 'key', 'title', 'filer', 'ticket', 'priority', 'link', 'about'];
const FIELDS: Record<string, string[]> = {
  ask: [...COMMON, 'ask_ref', 'detail', 'why', 'options', 'recommend_value', 'recommend_reason', 'default_if_silent', 'silent_by', 'close', 'merges', 'proof'],
  report: [...COMMON, 'filed', 'group', 'decided', 'form', 'video', 'asked_by', 'view', 'preview'],
  evidence: [...COMMON, 'media', 'run'],
  gate: [...COMMON, 'run', 'options', 'recommend_value', 'close'],
  finding: [...COMMON, 'cause', 'incidents', 'days', 'evidence_ids', 'change_kind', 'proposal', 'options', 'recommend_value'],
  plan: [...COMMON, 'project', 'sections', 'decisions', 'steps', 'view'],
  design: [...COMMON, 'group', 'filed', 'status', 'preview', 'journeys', 'options', 'recommend'],
};
const GUIDE = ['understood', 'visual', 'sections', 'next'];
const GUIDE_FIELDS: Record<string, string[]> = {
  report: [...COMMON, 'filed', 'group', 'decided', 'asked_by', ...GUIDE],
  plan: [...COMMON, 'project', 'decisions', ...GUIDE],
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
const PAGE_HELP = `Run \`${REPORT_INIT} --page\` to make the page, fill it, then post it with "view" and "preview"`;
const GUIDE_HELP = `Run \`${REPORT_INIT}\` to write report.json, fill every FILL: line, then post it with \`post --kind report --from <folder>/report.json\``;

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
/** The raise flag each question field fills: a refusal of a flag post names that flag, not the field. */
const FLAG_OF: Record<string, string> = { why: 'why', about: 'about', detail: 'detail', title: 'title', default_if_silent: 'default', recommend_reason: 'recommend-reason', recommend_value: 'recommend', silent_by: 'silent-by', merges: 'merge', proof: 'proof', options: 'option', label: 'option', value: 'option', outcome: 'outcome' };
/** The flag a field fills: options[1].outcome is --outcome, merges[0] is --merge. */
const flagOf = (field: string) => { const f = field.replace(/^options\[\d+\]\./, '').replace(/\[\d+\]$/, ''); return `--${FLAG_OF[f] ?? f}`; };
/** A field as a refusal names it: the JSON field, or the raise flag that fills it. */
const named = (field: string, flags: boolean) => (flags ? flagOf(field) : `"${field}"`);

/** Checks one message against its kind's rules and returns its kind and schema; the first broken rule throws, in the order docs/contract.md gives.
 * `want` is the kind the caller expects, so the wrong file is refused before its fields are read. */
export function checkMessage(m: any, want?: string, flags = false): { kind: string; schema: number } {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new ContractError('the message must be one JSON object', 'Write the message as one JSON object, such as {"contract":1,"kind":"ask",...}');
  const at = isKey(m.key) ? `key ${m.key}: ` : '';
  const bad = (field: string, rule: string, help: string) => new ContractError(`${at}${flags ? flagOf(field) : field} ${rule}`, help);
  const need = (f: string) => {
    if (!Object.hasOwn(m, f)) throw bad(f, 'is required', 'Add "contract": 1, "kind" and "schema" to the message, such as "contract": 1, "kind": "ask", "schema": 1');
  };
  /** Text: a string with something besides whitespace, no control character but newline, no unpaired surrogate, and at most max code points. */
  const text = (field: string, v: unknown, max: number, set: string) => {
    const name = named(field.replace(/^.*\./, ''), flags);
    if (typeof v !== 'string' || !/\S/.test(v)) throw bad(field, 'must be text', `Set ${name} to ${set}`);
    if (/[\0-\x09\x0b-\x1f\x7f-\x9f]/.test(v)) throw bad(field, 'has a control character other than newline', `Remove tabs and other control characters from ${name}`);
    if (/\p{Cs}/u.test(v)) throw bad(field, 'has an unpaired surrogate (half of a character)', `Remove the broken character from ${name}, or write it whole`);
    if ([...v].length > max) throw bad(field, `is ${[...v].length} characters, over ${max}`, `Shorten ${name} to ${max} characters`);
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
  /** A list of min to max objects, each with only `fields`: a plan's sections, decisions and steps, or `v` for a list inside one. */
  const list = (f: string, min: number, max: number, fields: string[], example: string, v: any = m[f]): any[] => {
    const one = f.replace(/^.*[.\]]/, '').slice(0, -1), set = `Set "${f}" to ${min}-${max} objects such as ${example}`;
    if (!Array.isArray(v) || v.length < min || v.length > max) throw bad(f, v !== undefined ? `must list ${min} to ${max} ${f.replace(/^.*[.\]]/, '')}` : 'is required', set);
    v.forEach((o: any, n: number) => {
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad(`${f}[${n}]`, 'must be an object', set);
      const odd = Object.keys(o).find((k) => !fields.includes(k));
      if (odd !== undefined) throw bad(`${f}[${n}].${escaped(odd) || '""'}`, `is not a field of a ${one}`, `Remove ${show(odd)}; a ${one} has only ${fields.join(', ')}`);
    });
    return v;
  };
  /** Each option: exactly value and label (and on a plan's decision, outcome), its value unique. Ask, gate, finding and plan decisions share it. */
  const checkOptions = (field: string, options: any[], outcome: false | 'plan' | 'ask' | 'legacy-ask' = false) => options.forEach((o: any, n: number) => {
    const at = `${field}[${n}]`, fields = outcome ? ['value', 'label', 'outcome'] : ['value', 'label'];
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad(at, 'must be an object', `Write each option as {"value":"<id>","label":"<text>"${outcome ? ',"outcome":"<what it leads to>"' : ''}}`);
    const odd = Object.keys(o).find((f) => !fields.includes(f));
    if (odd !== undefined) throw bad(`${at}.${escaped(odd) || '""'}`, 'is not a field of an option', `Remove ${show(odd)}; an option has only ${fields.join(', ')}`);
    if (!isKey(o.value)) throw bad(`${at}.value`, 'must be 1-128 of A-Z a-z 0-9 . _ -', flags ? 'Give each --option a short value before the =, such as yes=Yes' : 'Set "value" to a short id such as "yes"');
    if (options.slice(0, n).some((p: any) => p.value === o.value)) throw bad(`${at}.value`, `repeats ${o.value}`, 'Give every option its own value');
    text(`${at}.label`, o.label, 80, 'the button text, in 80 characters or fewer');
    if (outcome === 'ask') {
      const OUTCOME = `what happens next if ${o.value} is picked, in one line (120 characters or fewer)`;
      if (!Object.hasOwn(o, 'outcome')) throw bad(`${at}.outcome`, 'is required', `Add ${flags ? `--outcome ${o.value}=<text>` : `"outcome" to option ${o.value}`}: ${OUTCOME}`);
      text(`${at}.outcome`, o.outcome, 120, OUTCOME);
    } else if (outcome === 'plan' || (outcome === 'legacy-ask' && Object.hasOwn(o, 'outcome'))) text(`${at}.outcome`, o.outcome, 200, 'what picking it leads to, in 200 characters or fewer');
  });
  /** The option the poster would pick, `field` on `o`: required, and one of the option values, which it returns. */
  const recommend = (field: string, o: any, options: any[]): string[] => {
    const name = field.replace(/^.*\./, ''), values = options.map((p: any) => p.value), pick = `the option you would pick: one of ${values.join(', ')}`, rec = named(name, flags);
    if (!Object.hasOwn(o, name)) throw bad(field, 'is required', flags ? `Add ${rec} ${values[0]}, ${pick}` : `Add ${rec}: ${show(values[0])}, ${pick}`);
    if (!values.includes(o[name])) throw bad(field, `${show(o[name])} is not an option value`, `Set ${rec} to ${pick}`);
    return values;
  };
  /** A page path, as a report's view and preview are: relative, inside the board file's folder, with the given ending. */
  const page = (f: string, ends: RegExp, kinds: string, example: string, need: string, help = PAGE_HELP) => {
    if (!Object.hasOwn(m, f)) throw bad(f, `is required: ${need}`, help);
    text(f, m[f], 256, `${example}, a path from the board file's folder`);
    if (/^([\\/]|[A-Za-z]:)/.test(m[f]) || m[f].split(/[\\/]/).includes('..') || /[?#\\]/.test(m[f])) throw bad(f, `${show(m[f])} must be a relative path with no .., ?, # or \\`, `Set "${f}" to ${example}, a path from the board file's folder`);
    if (!ends.test(m[f])) throw bad(f, `${show(m[f])} must end in ${kinds}`, help);
  };
  const g = guided(m);
  const TONES = ['ok', 'warn', 'bad'];
  const one = (field: string, o: any, fields: string[], example: string) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad(field, 'must be an object', `Write it as ${example}`);
    const odd = Object.keys(o).find((k) => !fields.includes(k));
    if (odd !== undefined) throw bad(`${field}.${escaped(odd) || '""'}`, `is not a field there`, `Remove ${show(odd)}; it has only ${fields.join(', ')}`);
  };
  const tone = (field: string, o: any) => {
    if (Object.hasOwn(o, 'tone') && !TONES.includes(o.tone)) throw bad(`${field}.tone`, `${show(o.tone)} is not one of ${TONES.join(', ')}`, `Set "tone" to ${TONES.join(', ')}, or leave it out`);
  };
  /** label and value pairs folded behind a Details tap: the numbers that back a point. */
  const details = (field: string, v: any) => list(field, 1, 8, ['label', 'value'], '{"label":"Timed","value":"12 Oct, test phone"}', v).forEach((o, n) => {
    text(`${field}[${n}].label`, o.label, 40, 'the number\'s name, in 40 characters or fewer');
    text(`${field}[${n}].value`, o.value, 120, 'the number and its unit, in 120 characters or fewer');
  });
  /** A diagram: 1 to 3 views of one picture (Today, After), each a board-relative .html file the board frames. Post adds each file's `sha256` and `bytes`, as it does for media. */
  const diagrams = (field: string, v: any) => list(field, 1, 3, ['label', 'src', 'sha256', 'bytes'], '{"label":"Today","src":"diagrams/flow.html"}', v).forEach((o, n) => {
    if (Object.hasOwn(o, 'sha256') && !/^[a-f0-9]{64}$/.test(o.sha256)) throw bad(`${field}[${n}].sha256`, 'must be 64 lowercase hex digits', 'Leave "sha256" and "bytes" out; post pins the file');
    if (Object.hasOwn(o, 'bytes') && !(Number.isInteger(o.bytes) && o.bytes >= 0)) throw bad(`${field}[${n}].bytes`, 'must be a whole number of bytes', 'Leave "sha256" and "bytes" out; post pins the file');
    text(`${field}[${n}].label`, o.label, 40, 'the view name, such as "Today", in 40 characters or fewer');
    text(`${field}[${n}].src`, o.src, 256, 'a page path from the board file\'s folder, such as "diagrams/flow.html"');
    if (/^([\\/]|[A-Za-z]:)/.test(o.src) || o.src.split(/[\\/]/).includes('..') || /[?#\\]/.test(o.src) || !/\.html?$/i.test(o.src)) throw bad(`${field}[${n}].src`, `${show(o.src)} must be a relative .html path with no .., ?, # or \\`, 'Draw the diagram as inline SVG in an .html page (by hand or with the archify skill), then set "src" to that file next to the message');
  });
  /** The guided page every plan 2 and report 3 is: what I understood, one picture, sections with expandable items, and the next step. Returns the section ids. */
  const guide = (minSections: number): string[] => {
    list('understood', 1, 6, ['label', 'text'], '{"label":"You asked","text":"Make the first start smooth."}').forEach((o, n) => {
      text(`understood[${n}].label`, o.label, 40, 'what this line is, such as "You asked" or "Done when", in 40 characters or fewer');
      text(`understood[${n}].text`, o.text, 240, 'your reading of it, in 240 characters or fewer');
    });
    const v = m.visual;
    if (!Object.hasOwn(m, 'visual')) throw bad('visual', 'is required: one picture for the answer', 'Add "visual": {"type":"bars","heading":"...","rows":[{"label":"Cloud box","value":4.5}]}');
    one('visual', v, ['type', 'heading', 'text', 'unit', 'rows', 'details', 'diagram'], '{"type":"bars","heading":"...","rows":[...]}');
    if (!['bars', 'steps', 'tiles'].includes(v.type)) throw bad('visual.type', `${show(v.type)} is not one of bars, steps, tiles`, 'Set "type" to "bars" for numbers, "steps" for a sequence, "tiles" for parallel points');
    text('visual.heading', v.heading, 100, 'the point the picture makes, in 100 characters or fewer');
    if (Object.hasOwn(v, 'text')) text('visual.text', v.text, 240, 'one line under the picture, in 240 characters or fewer, or leave it out');
    if (Object.hasOwn(v, 'unit')) {
      if (v.type !== 'bars') throw bad('visual.unit', 'is only for bars', 'Remove "unit"');
      text('visual.unit', v.unit, 12, 'the unit shown after each number, such as "min", in 12 characters or fewer');
    }
    list('visual.rows', 2, 8, ['label', 'text', 'note', 'tone', 'value', 'before'], '{"label":"Cloud box","value":4.5,"note":"slow","tone":"bad"}', v.rows).forEach((o, n) => {
      const at = `visual.rows[${n}]`;
      text(`${at}.label`, o.label, 60, 'the row name, in 60 characters or fewer');
      if (Object.hasOwn(o, 'text')) text(`${at}.text`, o.text, 160, 'one line, in 160 characters or fewer, or leave it out');
      if (Object.hasOwn(o, 'note')) text(`${at}.note`, o.note, 40, 'a short tag, in 40 characters or fewer, or leave it out');
      tone(at, o);
      for (const f of ['value', 'before']) {
        if (!Object.hasOwn(o, f)) { if (f === 'value' && v.type === 'bars') throw bad(`${at}.value`, 'is required on a bars row', 'Set "value" to the number the bar shows'); continue; }
        if (v.type !== 'bars') throw bad(`${at}.${f}`, 'is only for bars', `Remove "${f}", or set "type" to "bars"`);
        if (typeof o[f] !== 'number' || !Number.isFinite(o[f]) || o[f] < 0) throw bad(`${at}.${f}`, 'must be a number, 0 or more', `Set "${f}" to a number such as 4.5`);
      }
    });
    if (Object.hasOwn(v, 'details')) details('visual.details', v.details);
    if (Object.hasOwn(v, 'diagram')) diagrams('visual.diagram', v.diagram);
    const ids = list('sections', minSections, 6, ['id', 'stage', 'heading', 'body', 'items', 'details', 'diagram'], '{"id":"steps","stage":"recommend","heading":"Eight steps, 22 to 31 Oct","body":"..."}').map((o, n) => {
      const at = `sections[${n}]`;
      if (!(typeof o.id === 'string' && /^[a-z0-9-]{1,40}$/.test(o.id))) throw bad(`${at}.id`, 'must be 1-40 of a-z 0-9 -', 'Set "id" to a short slug such as "steps"');
      if (!['found', 'recommend'].includes(o.stage)) throw bad(`${at}.stage`, `${show(o.stage)} is not found or recommend`, 'Set "stage" to "found" (what I found) or "recommend" (what I recommend)');
      text(`${at}.heading`, o.heading, 80, 'the section heading, in 80 characters or fewer');
      text(`${at}.body`, o.body, 300, 'the section\'s lead, in 300 characters or fewer');
      if (Object.hasOwn(o, 'items')) list(`${at}.items`, 1, 8, ['title', 'text', 'more', 'tone', 'diagram'], '{"title":"Ship 0.2.5","text":"You test it.","more":"..."}', o.items).forEach((it, k) => {
        text(`${at}.items[${k}].title`, it.title, 80, 'the item, in 80 characters or fewer');
        text(`${at}.items[${k}].text`, it.text, 160, 'one line under it, in 160 characters or fewer');
        if (Object.hasOwn(it, 'more')) text(`${at}.items[${k}].more`, it.more, 600, 'what opens when it is tapped, in 600 characters or fewer, or leave it out');
        tone(`${at}.items[${k}]`, it);
        if (Object.hasOwn(it, 'diagram')) diagrams(`${at}.items[${k}].diagram`, it.diagram);
      });
      if (Object.hasOwn(o, 'details')) details(`${at}.details`, o.details);
      if (Object.hasOwn(o, 'diagram')) diagrams(`${at}.diagram`, o.diagram);
      return o.id;
    });
    const twice = ids.findIndex((id, n) => ids.indexOf(id) < n);
    if (twice >= 0) throw bad(`sections[${twice}].id`, `repeats ${ids[twice]}`, 'Give every section its own id');
    if (!Object.hasOwn(m, 'next')) throw bad('next', 'is required', 'Add "next": {"heading":"Go ahead, and I start on 22 Oct","lines":["..."]}');
    one('next', m.next, ['heading', 'lines'], '{"heading":"...","lines":["..."]}');
    text('next.heading', m.next.heading, 80, 'the next step, in 80 characters or fewer');
    if (!Array.isArray(m.next.lines) || m.next.lines.length < 1 || m.next.lines.length > 4) throw bad('next.lines', 'must list 1 to 4 lines', 'Set "lines" to 1-4 texts, what happens after the person answers');
    m.next.lines.forEach((l: unknown, n: number) => text(`next.lines[${n}]`, l, 160, 'one line, in 160 characters or fewer'));
    return ids;
  };
  need('contract');
  if (m.contract !== 1) throw bad('contract', `must be 1, not ${show(m.contract)}`, whole(m.contract) ? 'Upgrade sign-off-axi: this one knows contract 1' : 'Set "contract": 1');
  need('kind');
  if (!KINDS.includes(m.kind)) throw bad('kind', `must be one of ${KINDS.join(', ')}, not ${show(m.kind)}`, `Set "kind" to one of ${KINDS.join(', ')}`);
  if (want !== undefined && m.kind !== want) throw bad('kind', `is ${m.kind}, not --kind ${want}`, `Pass --kind ${m.kind}, or name the ${want} message file`);
  need('schema');
  if (!whole(m.schema)) throw bad('schema', `must be a whole number, not ${show(m.schema)}`, `Set "schema": ${SCHEMAS[m.kind]}`);
  if (m.kind === 'report' && m.schema === 1) throw bad('schema', '1 of report is text only: a report must be a page to tap through, with "view" and "preview"', GUIDE_HELP);
  if (m.schema !== SCHEMAS[m.kind] && !OLDER[m.kind]?.includes(m.schema)) throw bad('schema', `${m.schema} of ${m.kind} is not in this sign-off-axi`, `Upgrade sign-off-axi, or post ${m.kind} schema ${SCHEMAS[m.kind]}`);
  if (g && /FILL:/.test(JSON.stringify(m))) throw bad('message', 'still has FILL: lines from the template', 'Replace every FILL: line with your own words, then post again');
  const fields = guided(m) ? GUIDE_FIELDS[m.kind] : FIELDS[m.kind], extra = Object.keys(m).find((f) => !fields.includes(f));
  if (extra === 'options' && m.kind === 'report') throw bad('options', 'is not a field of report: a report takes no answer', 'Remove "options", or post an ask to get an answer');
  if (extra === 'options' && m.kind === 'plan') throw bad('options', 'is not a field of plan: its answers come from its sections and decisions', 'Remove "options"; put each question in "decisions", with its options and "recommend"');
  if (extra !== undefined) throw bad(escaped(extra) || '""', `is not a field of ${m.kind} schema ${m.schema}`, `Remove ${show(extra)}; ${m.kind} takes ${fields.slice(3).join(', ')}`);
  if (!(m.kind === 'evidence' && !Object.hasOwn(m, 'key')) && !isKey(m.key)) throw bad('key', Object.hasOwn(m, 'key') ? `${show(m.key)} must be 1-128 of A-Z a-z 0-9 . _ -` : 'is required', 'Set "key" to a short id such as "ship-signin-2"');
  if (!Object.hasOwn(m, 'title')) throw bad('title', 'is required', 'Add "title": the question, in 160 characters or fewer');
  text('title', m.title, 160, 'the question, in 160 characters or fewer');
  if (g && m.schema === SCHEMAS[m.kind] && !isKey(m.filer)) throw bad('filer', 'is required', 'Set "filer" to the owning agent id');
  if (Object.hasOwn(m, 'filer') && !isKey(m.filer)) throw bad('filer', 'must be 1-128 of A-Z a-z 0-9 . _ -', 'Set "filer" to your agent session id or tool name, or leave it out');
  if (Object.hasOwn(m, 'ticket') && !isKey(m.ticket)) throw bad('ticket', 'must be 1-128 of A-Z a-z 0-9 . _ -', 'Set "ticket" to the id of the ticket this card belongs to, or leave it out');
  if (Object.hasOwn(m, 'priority') && !PRIORITIES.includes(m.priority)) throw bad('priority', `${show(m.priority)} is not one of ${PRIORITIES.join(', ')}`, `Set ${named('priority', flags)} to how urgent the card is, P0 (most) to P3 (least), or leave it out`);
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
    if (Object.hasOwn(m, 'form') && !REPORT_FORMS.includes(m.form)) throw bad('form', `${show(m.form)} is not one of ${REPORT_FORMS.join(', ')}`, `Set "form" to ${REPORT_FORMS.join(', ')}, or leave it out`);
    if (Object.hasOwn(m, 'video')) text('video', m.video, 10, 'the video length such as "0:28", in 10 characters or fewer, or leave it out');
    if (Object.hasOwn(m, 'asked_by')) text('asked_by', m.asked_by, 40, 'who asked for it, such as "You asked" or "Docs agent", in 40 characters or fewer, or leave it out');
    // A report is a page to tap through and a picture of it for the card: text alone is a status note, not a report.
    if (g) { guide(1); return { kind: m.kind, schema: m.schema }; }
    const need = 'a report is a page to tap through, not text';
    page('view', /\.html$/i, '.html', '"mocks/<key>/index.html"', need);
    page('preview', /\.(svg|png|jpe?g|webp)$/i, '.svg, .png, .jpg, .jpeg or .webp', '"mocks/<key>/preview.svg"', need);
    if (dirname(m.preview) !== dirname(m.view)) throw bad('preview', `${show(m.preview)} must sit in the folder of ${show(m.view)}`, `Put the picture beside the page, such as "${dirname(m.view)}/preview.svg"`);
    return { kind: m.kind, schema: m.schema };
  }
  if (m.kind === 'design') {
    text('group', m.group, 40, 'the project name, in 40 characters or fewer');
    const at = typeof m.filed === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(m.filed) ? new Date(m.filed) : undefined;
    if (!at || Number.isNaN(at.getTime()) || at.toISOString().replace('.000', '') !== m.filed) throw bad('filed', 'must be a real UTC time with seconds', 'Set "filed" to YYYY-MM-DDTHH:MM:SSZ');
    if (!['draft', 'in_review'].includes(m.status)) throw bad('status', 'must be draft or in_review', 'Set "status" to "draft" or "in_review"');
    page('preview', /\.(png|jpe?g|webp)$/i, '.png, .jpg, .jpeg or .webp', '"design/preview.png"', 'a design preview');
    const journeys = list('journeys', 0, 40, ['id', 'title', 'screens'], '{"id":"signup","title":"Sign up","screens":[...]}');
    const ids: string[] = [];
    journeys.forEach((j, n) => {
      if (typeof j.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(j.id)) throw bad(`journeys[${n}].id`, 'must be a short lowercase id', 'Set it to a slug such as "signup"');
      if (ids.includes(j.id)) throw bad(`journeys[${n}].id`, `repeats ${j.id}`, 'Give each journey its own id'); ids.push(j.id);
      text(`journeys[${n}].title`, j.title, 120, 'the journey title');
      if (!Array.isArray(j.screens) || !j.screens.length || j.screens.length > 80) throw bad(`journeys[${n}].screens`, 'must list 1 to 80 screens', 'Add at least one screen with a view');
      const screenIds: string[] = [];
      j.screens.forEach((s: any, k: number) => {
        const p = `journeys[${n}].screens[${k}]`;
        if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).some(x => !['id','title','views'].includes(x))) throw bad(p, 'must have only id, title and views', 'Use {"id":"welcome","title":"Welcome","views":{...}}');
        if (typeof s.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(s.id)) throw bad(`${p}.id`, 'must be a short lowercase id', 'Set it to a slug such as "welcome"');
        if (screenIds.includes(s.id)) throw bad(`${p}.id`, `repeats ${s.id}`, 'Give each screen its own id'); screenIds.push(s.id);
        text(`${p}.title`, s.title, 120, 'the screen title');
        const views = s.views, variants = ['phone_light','phone_dark','computer_light','computer_dark'];
        if (!views || typeof views !== 'object' || Array.isArray(views) || Object.keys(views).some(v => !variants.includes(v)) || !Object.keys(views).length) throw bad(`${p}.views`, 'must map at least one supported view to a path', 'Add a phone_light, phone_dark, computer_light or computer_dark path');
        for (const [variant, path] of Object.entries(views)) {
          text(`${p}.views.${variant}`, path, 256, 'a board-relative image or HTML path');
          if (/^([\\/]|[A-Za-z]:)/.test(path as string) || (path as string).split(/[\\/]/).includes('..') || /[?#\\]/.test(path as string) || !/\.(png|jpe?g|webp|html)$/i.test(path as string)) throw bad(`${p}.views.${variant}`, 'must be a relative .png, .jpg, .jpeg, .webp or .html path without ..', 'Put the view under the board folder');
        }
      });
    });
    if (m.options !== undefined) {
      if (!Array.isArray(m.options) || m.options.length < 2 || m.options.length > 6) throw bad('options', 'must list 2 to 6 options', 'Set options to 2-6 {"value":"...","label":"..."} choices');
      checkOptions('options', m.options);
      recommend('recommend', m, m.options);
    } else if (m.recommend !== undefined) throw bad('recommend', 'requires options', 'Add options or remove recommend');
    return { kind: m.kind, schema: m.schema };
  }
  // A plan is sections to approve or change, decisions with a recommended pick, steps to tap through, and where it goes as a diagram.
  if (m.kind === 'plan') {
    if (Object.hasOwn(m, 'project')) text('project', m.project, 40, 'the project name, in 40 characters or fewer, or leave it out');
    const ids = g ? guide(0) : list('sections', 1, 8, ['id', 'heading', 'body'], '{"id":"goals","heading":"Goals and non-goals","body":"<what it does and does not do>"}').map((o, n) => {
      if (!(typeof o.id === 'string' && /^[a-z0-9-]{1,40}$/.test(o.id))) throw bad(`sections[${n}].id`, 'must be 1-40 of a-z 0-9 -', 'Set "id" to a short slug such as "goals"');
      text(`sections[${n}].heading`, o.heading, 80, 'the section heading, in 80 characters or fewer');
      text(`sections[${n}].body`, o.body, 1000, 'the section, in 1000 characters or fewer');
      return o.id;
    });
    const twice = ids.findIndex((id, n) => ids.indexOf(id) < n);
    if (twice >= 0) throw bad(`sections[${twice}].id`, `repeats ${ids[twice]}`, 'Give every section its own id');
    list('decisions', 0, 5, g ? ['key', 'question', 'why', 'reason', 'quiet', 'options', 'recommend'] : ['key', 'question', 'why', 'reason', 'after', 'options', 'recommend'], '{"key":"store","question":"Keep plans in the board file?","why":"...","options":[...],"recommend":"yes"}').forEach((o, n, all) => {
      const at = `decisions[${n}]`;
      if (!isKey(o.key)) throw bad(`${at}.key`, 'must be 1-128 of A-Z a-z 0-9 . _ -', 'Set "key" to a short id such as "store"');
      if (all.slice(0, n).some((p) => p.key === o.key)) throw bad(`${at}.key`, `repeats ${o.key}`, 'Give every decision its own key');
      text(`${at}.question`, o.question, 160, 'the question, ending in a question mark');
      // One question: a single ?, as its last character, so "Keep A? Or B?" is two decisions.
      const q = o.question.trim();
      if (q.search(/[?？]/) !== q.length - 1) throw bad(`${at}.question`, 'must be one question, with one question mark as its last character', 'Ask one question ending in a question mark, and split any other into its own decision');
      if (!/[\p{L}\p{N}]/u.test(q) || q.split(/\s+/).length > 12) throw bad(`${at}.question`, 'must be one question of 12 words or fewer, ending in a question mark', 'Ask it in 12 words or fewer, ending in a question mark; put the rest in "why"');
      text(`${at}.why`, o.why, 500, 'why it matters, in 500 characters or fewer');
      if (Object.hasOwn(o, 'reason')) text(`${at}.reason`, o.reason, 300, 'why the recommended option, in 300 characters or fewer, or leave it out');
      if (Object.hasOwn(o, 'quiet')) text(`${at}.quiet`, o.quiet, 160, 'what happens if the person stays quiet, in 160 characters or fewer, or leave it out');
      if (Object.hasOwn(o, 'after') && !ids.includes(o.after)) throw bad(`${at}.after`, `must be the id of one of the plan's sections`, `Set "after" to one of: ${ids.join(', ')}`);
      if (!Array.isArray(o.options) || o.options.length < 2 || o.options.length > 6) throw bad(`${at}.options`, Object.hasOwn(o, 'options') ? 'must list 2 to 6 options' : 'is required', 'Set "options" to 2-6 objects such as {"value":"yes","label":"Yes","outcome":"Plans live in the board file"}');
      checkOptions(`${at}.options`, o.options, 'plan');
      recommend(`${at}.recommend`, o, o.options);
    });
    if (g) return { kind: m.kind, schema: m.schema };
    if (Object.hasOwn(m, 'steps')) list('steps', 2, 12, ['title', 'text'], '{"title":"The agent posts the plan"}').forEach((o, n) => {
      text(`steps[${n}].title`, o.title, 80, 'the step, in 80 characters or fewer');
      if (Object.hasOwn(o, 'text')) text(`steps[${n}].text`, o.text, 300, 'what happens in this step, in 300 characters or fewer, or leave it out');
    });
    page('view', /\.html$/i, '.html', '"mocks/<key>/index.html"', 'a plan shows where it goes as a diagram on a page', 'Set "view" to "mocks/<key>/index.html", a path from the board file\'s folder');
    return { kind: m.kind, schema: m.schema };
  }
  if (Object.hasOwn(m, 'about')) text('about', m.about, 500, 'a short note, or leave it out');
  if (Object.hasOwn(m, 'detail')) text('detail', m.detail, 1000, 'the longer note, or leave it out');
  // An ask is read on a phone with no other context: it says why it is asked, what each answer does, why one is recommended and what silence does.
  const ask = m.kind === 'ask', WHY = 'what it is about and why it needs an answer now, in 1 or 2 short lines (200 characters or fewer)';
  if (ask && flags && !Object.hasOwn(m, 'why')) throw bad('why', 'is required', `Add ${named('why', flags)}: ${WHY}`);
  if (ask && flags) text('why', m.why, 200, WHY);
  // A gate offers 2 or 3 of done-done's actions and a finding both of apply and skip, in any order, each with its own label.
  const options = m.options, actions = ACTIONS[m.kind], max = actions ? Object.keys(actions).length : 6;
  const actionList = actions && Object.entries(actions).map(([value, label]) => show({ value, label })).join(', ');
  const listed = !actions ? (flags ? 'Give 2 to 6 --option flags, such as --option yes="Yes" --option no="No"' : 'Set "options" to 2-6 objects such as {"value":"yes","label":"Yes"}') : max === 3 ? `Set "options" to 2 or 3 of ${actionList}` : `Set "options" to ${actionList}`;
  if (!Array.isArray(options) || options.length < 2 || options.length > max) throw bad('options', Object.hasOwn(m, 'options') ? `must list ${({ 2: '2', 3: '2 or 3' } as Record<number, string>)[max] ?? '2 to 6'} options` : 'is required', listed);
  checkOptions('options', options, ask ? (flags ? 'ask' : 'legacy-ask') : false);
  const odd = actions && options.find((o: any) => !Object.hasOwn(actions, o.value) || actions[o.value] !== o.label);
  if (odd) throw bad('options', `${show(odd)} is not a ${m.kind} action: ${Object.keys(actions).join(', ')}, each with its label`, listed);
  const values = recommend('recommend_value', m, options);
  const REASON = `why you recommend ${m.recommend_value}, in one line (160 characters or fewer)`;
  if (ask && flags && !Object.hasOwn(m, 'recommend_reason')) throw bad('recommend_reason', 'is required', `Add ${named('recommend_reason', flags)}: ${REASON}`);
  if (ask && flags) text('recommend_reason', m.recommend_reason, 160, REASON);
  if (ask && flags && !Object.hasOwn(m, 'default_if_silent')) throw bad('default_if_silent', 'is required', `Add ${named('default_if_silent', flags)}: the option that happens if the person stays quiet, one of ${values.join(', ')}`);
  if (Object.hasOwn(m, 'default_if_silent') && !values.includes(m.default_if_silent)) {
    throw bad('default_if_silent', `${show(m.default_if_silent)} is not an option value`, `Set ${named('default_if_silent', flags)} to one of ${values.join(', ')}${ask ? '' : ', or leave it out'}`);
  }
  // A real UTC time to the minute, seconds optional: Date.parse would roll 2026-02-30 over to March.
  const utc = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v.slice(0, -1));
  if (Object.hasOwn(m, 'silent_by') && (!ask || flags) && !utc(m.silent_by)) throw bad('silent_by', `${show(m.silent_by)} is not a UTC time such as 2026-10-17T18:00:00Z`, `Set ${named('silent_by', flags)} to when the silent default happens, as YYYY-MM-DDTHH:MM:SSZ in UTC, or leave it out`);
  if (Object.hasOwn(m, 'close') && m.close !== 'done' && m.close !== 'release') throw bad('close', 'must be done or release', 'Set "close" to "done" or "release", or leave it out');
  if (Object.hasOwn(m, 'merges')) {
    const keys = m.merges, MERGES = `Set ${named('merges', flags)} to the keys of 1 to 10 other cards on the board that ask the same thing, such as ${flags ? '--merge ship-signin' : '["ship-signin"]'}`;
    if (!Array.isArray(keys) || !keys.length || keys.length > 10) throw bad('merges', 'must list 1 to 10 keys', MERGES);
    keys.forEach((k: unknown, n: number) => {
      if (!isKey(k)) throw bad(`merges[${n}]`, 'must be 1-128 of A-Z a-z 0-9 . _ -', MERGES);
      if (k === m.key) throw bad(`merges[${n}]`, 'is this ask\'s own key', 'Name the other cards that ask the same thing, not this one');
      if (keys.indexOf(k) < n) throw bad(`merges[${n}]`, `repeats ${k}`, 'List each key once');
    });
  }
  if (Object.hasOwn(m, 'proof')) {
    if (!isKey(m.proof)) throw bad('proof', 'must be 1-128 of A-Z a-z 0-9 . _ -', `Set ${named('proof', flags)} to the key of an evidence update on the board that this ask rests on, such as ${flags ? '--proof update-3' : '"update-3"'}`);
    if (m.proof === m.key) throw bad('proof', 'is this ask\'s own key', 'Name the evidence update the ask rests on, not the ask');
  }
  if (ask && flags) question(m, bad, flags);
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

/** An id or task name, never a word a person says: a lowercase token with an underscore or slash, or a letter-first token with a digit, such as slice-5, ship_1 or ch/cloud. */
const idWord = (w: string) => /^[a-z0-9]+(?:[-_/][a-z0-9]+)+$/.test(w) && (/[_/]/.test(w) || (/^[a-z]/.test(w) && /\d/.test(w)));
/** Buttons that close a card but answer no question. */
const NOT_ANSWERS = /^(done|not now|ok|okay|got it|noted|seen|acknowledged?|dismiss)$/i;
/** The lettered choices a text names: "Option A", "A)", "(A)" or "A:" anywhere, and "A." only at a line start, so initials such as "D. A. Brown" are not choices. */
function lettered(text: string) {
  const found = new Set<string>();
  for (const [, c] of text.matchAll(/\b[Oo]ption ([A-F])\b/g)) found.add(c);
  for (const [, c] of text.matchAll(/(?:^|[\s(,;])\(?([A-F])[:)](?!\w)/gm)) found.add(c);
  for (const [, c] of text.matchAll(/^[ \t]*([A-F])\.(?!\w)/gm)) found.add(c);
  return [...found].sort();
}
/** The question standard on a new ask: a plain question the buttons answer, with buttons that match the choices its words name. */
function question(m: any, bad: (field: string, rule: string, help: string) => ContractError, flags: boolean) {
  const title = m.title.trim(), words = title.split(/\s+/).length, PLAIN = 'Write one plain question the buttons answer, in 12 words or fewer, such as "Ship the new sign-in screen this week?"';
  if (/^(say yes or no|captain(\s+hold\b[^:?]*)?)\s*:/i.test(title)) {
    throw bad('title', 'starts with a label for agents, not the question', 'Remove the label in front (such as "Say yes or no:" or "captain hold <id>:") and ask the question itself');
  }
  const id = title.split(/\s+/).map((w: string) => w.replace(/^[^\w]+|[^\w]+$/g, '')).find(idWord);
  if (id) throw bad('title', `has the id ${show(id)}, which the person does not know`, 'Say what it is in plain words, and put ids in "link" or "detail"');
  if (!title.endsWith('?')) throw bad('title', 'must be a question ending in "?"', PLAIN);
  if (words > 12) throw bad('title', `is ${words} words, over 12`, `${PLAIN}; put the rest in ${named('why', flags)}`);
  const options: { value: string; label: string }[] = m.options, letters = lettered([m.title, m.why, m.about, m.detail].filter(Boolean).join('\n'));
  const PICK = `Give one option per choice, each label starting with its letter, such as ${flags ? '--option a="A: <short label>" --outcome a=<text>' : '{"value":"a","label":"A: <short label>","outcome":"<what happens next>"}'}`;
  if (letters.length >= 2) {
    const letterList = letters.join(', ');
    if (options.some((o) => o.value === 'yes' || o.value === 'no')) throw bad('options', `must not be Yes/No, because the text names choices ${letterList}`, PICK);
    if (options.length !== letters.length) throw bad('options', `has ${options.length} options, but the text names ${letters.length} choices: ${letterList}`, PICK);
    for (const c of letters) {
      const n = options.filter((o) => new RegExp(`^(Option\\s+)?${c}(?![a-z])`).test(o.label.trim())).length;
      if (n !== 1) throw bad('options', n ? `has ${n} option labels that start with ${c}` : `has no option label that starts with ${c}`, PICK);
    }
  }
  options.forEach((o, n) => {
    const want = ({ yes: 'Yes', no: 'No' } as Record<string, string>)[o.value];
    if (want && o.label !== want) throw bad(`options[${n}].label`, `is ${show(o.label)}, not ${want}`, `Set the label of ${o.value} to "${want}"`);
    if (NOT_ANSWERS.test(o.label.trim())) throw bad(`options[${n}].label`, `${show(o.label)} does not answer a question`, 'Use buttons that answer the title: Yes and No, or one per choice');
  });
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

/** The diagram views of a guided plan or report, in the order the board counts them for `diagram.<n>`: the picture's, then each section's and its items'. */
export const diagramViews = (m: any): { label: string; src: string; sha256?: string; bytes?: number }[] => [m?.visual?.diagram, ...(m?.sections ?? []).flatMap((s: any) => [s.diagram, ...(s.items ?? []).map((i: any) => i.diagram)])].filter(Boolean).flat();
/** The text size a diagram must keep on a phone: its smallest text, drawn as wide as Full size draws it on a 390 px screen (the chrome-free page, 8 px of margin each side). */
const DIAGRAM_MIN_PX = 12;
const PHONE_PX = 390, PHONE_DRAW_PX = PHONE_PX - 16;
/** A guided plan's or report's diagram pages, from `base`, the board file's folder: each a file of 5 MB or less whose real path stays inside it,
 * with a drawing whose smallest text is at least 12 px at 390 and no brand marks (their licenses differ). The first broken rule throws.
 * Each view that passes is pinned with the file's `sha256` and `bytes`, so the board serves only the file that was posted and the revision covers its content. */
export function diagramPages(m: any, base: string): void {
  const at = isKey(m.key) ? `key ${m.key}: ` : '';
  let root = resolve(base);
  try { root = realpathSync(base); } catch {}
  for (const v of diagramViews(m)) {
    const name = `diagram ${show(v.src)}`, bad = (rule: string, help: string) => new ContractError(`${at}${name} ${rule}`, help);
    let real;
    try { real = realpathSync(resolve(root, v.src)); } catch { throw bad('is not there', `Put the file at ${v.src} from the board file's folder, or fix the path`); }
    const rel = relative(root, real);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw bad('leads outside the board file\'s folder', 'Copy the page into the board file\'s folder, such as under diagrams/');
    const info = statSync(real);
    if (!info.isFile() || info.size > 5_000_000) throw bad('must be a file of 5 MB or less', 'Render it again as a narrow architecture diagram');
    try { accessSync(real, constants.R_OK); } catch { throw bad('cannot be read', 'Make the file readable, then post again'); }
    const file = readFileSync(real), html = file.toString('utf8'), svg = html.match(/<svg\b[^>]*\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+[\d.]+[^>]*>([\s\S]*?)<\/svg>/i);
    if (!svg) throw bad('has no <svg> drawing with a viewBox', 'Draw it as inline <svg> with a viewBox 320 to 340 wide (by hand or with the archify skill), its legend hidden');
    if (/data-brand-mark/i.test(html)) throw bad('uses brand marks, whose licenses differ', 'Draw it again without "brand" on any component');
    const sizes = [...svg[2].matchAll(/<text\b[^>]*?\bfont-size\s*=\s*["']([\d.]+)/gi)].map((t) => Number(t[1]));
    const small = Math.min(...sizes), real12 = small * PHONE_DRAW_PX / Number(svg[1]);
    if (sizes.length && real12 < DIAGRAM_MIN_PX) throw bad(`has text of ${Math.round(real12 * 10) / 10} px at ${PHONE_PX} (${small} in a ${svg[1]} wide drawing), under ${DIAGRAM_MIN_PX}`, `Draw it narrower, an architecture viewBox 320 to 340 wide with no sublabels and the legend hidden ("legend": {"mode": "hidden"} in "meta"), so every text is ${DIAGRAM_MIN_PX} px or more on a phone`);
    v.sha256 = createHash('sha256').update(file).digest('hex');
    v.bytes = file.length;
  }
}

/** The longest a block of plain text on a report page may run: about five lines on a phone. */
const BLOCK_CHARS = 240;
/** A report's or plan's page, and a report's picture, from `base`, the board file's folder: each a file of 5 MB or less
 * whose real path stays inside that folder, and a page filled in the ladder shape the scaffold gives. The first broken rule throws. */
export function reportPage(m: any, base: string): void {
  const at = isKey(m.key) ? `key ${m.key}: ` : '';
  // A board not made yet has no folder, so its page is not there either.
  let root = resolve(base);
  try { root = realpathSync(base); } catch {}
  const bad = (rule: string, help = PAGE_HELP) => new ContractError(`${at}${rule}`, help);
  const read = (f: 'view' | 'preview') => {
    let real;
    try { real = realpathSync(resolve(root, m[f])); } catch { throw bad(`${f} ${show(m[f])} is not there`, `Put the file at ${m[f]} from the board file's folder, or fix the path`); }
    const rel = relative(root, real);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw bad(`${f} ${show(m[f])} leads outside the board file's folder`, 'Copy the page into the board file\'s folder, such as under mocks/<key>/');
    const info = statSync(real);
    if (!info.isFile() || info.size > 5_000_000) throw bad(`${f} ${show(m[f])} must be a file of 5 MB or less`, 'Shrink the page or its picture');
    try { accessSync(real, constants.R_OK); } catch { throw bad(`${f} ${show(m[f])} cannot be read`, 'Make the file readable, then post again'); }
    return /\.(html|svg)$/i.test(real) ? readFileSync(real, 'utf8') : '';
  };
  const html = read('view'), picture = m.preview === undefined ? '' : read('preview'), page = `view ${show(m.view)}`;
  for (const [f, t] of [[page, html], [`preview ${show(m.preview)}`, picture]]) {
    if (/FILL:/.test(t)) throw bad(`${f} still has FILL: lines from the scaffold`, 'Replace every FILL: line with your own words and pictures, then post again');
  }
  if (!/<meta[^>]+name=["']?viewport/i.test(html)) throw bad(`${page} has no viewport tag, so a phone shows it zoomed out`, 'Add <meta name="viewport" content="width=device-width, initial-scale=1">, or start again from report init');
  if (!/prefers-color-scheme/i.test(html)) throw bad(`${page} has no dark mode`, 'Add a @media (prefers-color-scheme: dark) block, or start again from report init');
  if (!/<(svg|img|canvas|video)\b/i.test(html)) throw bad(`${page} has no picture or diagram`, 'Draw the idea: add an <svg> or <img> under the answer and a diagram under it');
  // A plan's page is its diagram: the steps and the details are on the board, so it needs nothing to tap and no fold.
  if (m.kind !== 'plan' && !/<(button|input|select)\b/i.test(html)) throw bad(`${page} has nothing to tap or slide, so it is text, not a report`, 'Add a demo the reader can tap through, such as the scaffold\'s steps with Back and Next');
  if (m.kind !== 'plan' && !/<details\b/i.test(html)) throw bad(`${page} has no folded detail`, 'Fold the detail into <details><summary>Details</summary>...</details> at the end');
  if (/<(script|img|iframe|link|video|audio|source)\b[^>]*\b(src|href)\s*=\s*["']?\s*(https?:)?\/\//i.test(html)) throw bad(`${page} loads something from the web, which the board blocks`, 'Put scripts, styles and pictures in the page or beside it');
  // A block is one paragraph or list item; about five lines on a phone is the most a reader takes in at once.
  const long = [...html.matchAll(/<(p|li|dd|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((b) => b[2].replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim())
    .find((t) => [...t].length > BLOCK_CHARS);
  if (long) throw bad(`${page} has a block of ${[...long].length} characters, over ${BLOCK_CHARS} (about five lines on a phone): "${[...long].slice(0, 40).join('')}..."`, 'Split it, cut it, or show it as a picture or step');
}
