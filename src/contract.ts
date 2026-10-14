// The v1 communication contract (docs/contract.md): one strict, versioned shape per kind of message.
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { isKey, MEDIA_MAX } from './store.js';

/** A message that does not match: what is wrong, and the one line that says how to fix it. */
export class ContractError extends Error {
  constructor(message: string, readonly help: string) { super(message); }
}
export const KINDS = ['ask', 'report', 'evidence', 'gate', 'finding'];
/** The kinds this build checks, with the schema number of each. */
export const SCHEMAS: Record<string, number> = { ask: 1, report: 1, evidence: 1, gate: 1 };
const COMMON = ['contract', 'kind', 'schema', 'key', 'title', 'filer', 'link', 'about'];
const FIELDS: Record<string, string[]> = {
  ask: [...COMMON, 'detail', 'options', 'recommend_value', 'default_if_silent', 'close'],
  report: [...COMMON, 'filed', 'group', 'decided'],
  evidence: [...COMMON, 'media', 'run'],
  gate: [...COMMON, 'run', 'options', 'recommend_value', 'close'],
};
/** A done-done run: its id, full commit and the four Checks lines. */
const RUN = ['run_id', 'commit', 'outcome', 'repro', 'proof', 'evidence'];
/** A gate's options: the actions of done-done respond --action, each with its one label. */
const GATE: Record<string, string> = { approve: 'Approve', skip: 'Skip the judge', fix: 'Fix first' };
export const MEDIA_BYTES = 50_000_000;

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
  need('contract');
  if (m.contract !== 1) throw bad('contract', `must be 1, not ${show(m.contract)}`, whole(m.contract) ? 'Upgrade sign-off-axi: this one knows contract 1' : 'Set "contract": 1');
  need('kind');
  if (!KINDS.includes(m.kind)) throw bad('kind', `must be one of ${KINDS.join(', ')}, not ${show(m.kind)}`, `Set "kind" to one of ${KINDS.join(', ')}`);
  if (want !== undefined && m.kind !== want) throw bad('kind', `is ${m.kind}, not --kind ${want}`, `Pass --kind ${m.kind}, or name the ${want} message file`);
  if (!SCHEMAS[m.kind]) throw bad('kind', `${m.kind} is not checked by this sign-off-axi yet`, `Upgrade sign-off-axi to a version that checks ${m.kind}`);
  need('schema');
  if (!whole(m.schema)) throw bad('schema', `must be a whole number, not ${show(m.schema)}`, `Set "schema": ${SCHEMAS[m.kind]}`);
  if (m.schema !== SCHEMAS[m.kind]) throw bad('schema', `${m.schema} of ${m.kind} is not in this sign-off-axi`, `Upgrade sign-off-axi, or post ${m.kind} schema ${SCHEMAS[m.kind]}`);
  const fields = FIELDS[m.kind], extra = Object.keys(m).find((f) => !fields.includes(f));
  if (extra === 'options' && m.kind === 'report') throw bad('options', 'is not a field of report: a report takes no answer', 'Remove "options", or post an ask to get an answer');
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
    const what = ({ report: 'what happened', gate: 'why the run is held' } as Record<string, string>)[m.kind] ?? 'what this shows';
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
    return { kind: m.kind, schema: m.schema };
  }
  if (Object.hasOwn(m, 'about')) text('about', m.about, 500, 'a short note, or leave it out');
  if (Object.hasOwn(m, 'detail')) text('detail', m.detail, 1000, 'the longer note, or leave it out');
  // A gate offers 2 or 3 of done-done's actions, in any order, each with its own label.
  const options = m.options, max = m.kind === 'gate' ? 3 : 6, gate = Object.entries(GATE).map(([value, label]) => show({ value, label })).join(', ');
  const listed = m.kind === 'gate' ? `Set "options" to 2 or 3 of ${gate}` : 'Set "options" to 2-6 objects such as {"value":"yes","label":"Yes"}';
  if (!Array.isArray(options) || options.length < 2 || options.length > max) throw bad('options', Object.hasOwn(m, 'options') ? `must list ${max === 3 ? '2 or 3' : '2 to 6'} options` : 'is required', listed);
  options.forEach((o: any, n: number) => {
    const field = `options[${n}]`;
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad(field, 'must be an object', 'Write each option as {"value":"<id>","label":"<text>"}');
    const odd = Object.keys(o).find((f) => f !== 'value' && f !== 'label');
    if (odd !== undefined) throw bad(`${field}.${escaped(odd) || '""'}`, 'is not a field of an option', `Remove ${show(odd)}; an option has only value and label`);
    if (!isKey(o.value)) throw bad(`${field}.value`, 'must be 1-128 of A-Z a-z 0-9 . _ -', 'Set "value" to a short id such as "yes"');
    if (options.slice(0, n).some((p: any) => p.value === o.value)) throw bad(`${field}.value`, `repeats ${o.value}`, 'Give every option its own value');
    text(`${field}.label`, o.label, 80, 'the button text, in 80 characters or fewer');
  });
  const odd = m.kind === 'gate' && options.find((o: any) => !Object.hasOwn(GATE, o.value) || GATE[o.value] !== o.label);
  if (odd) throw bad('options', `${show(odd)} is not a gate action: ${Object.keys(GATE).join(', ')}, each with its label`, listed);
  const values = options.map((o: any) => o.value), pick = `the option you would pick: one of ${values.join(', ')}`;
  if (!Object.hasOwn(m, 'recommend_value')) throw bad('recommend_value', 'is required', `Add "recommend_value": ${show(values[0])}, ${pick}`);
  if (!values.includes(m.recommend_value)) throw bad('recommend_value', `${show(m.recommend_value)} is not an option value`, `Set "recommend_value" to ${pick}`);
  if (Object.hasOwn(m, 'default_if_silent') && !values.includes(m.default_if_silent)) {
    throw bad('default_if_silent', `${show(m.default_if_silent)} is not an option value`, `Set "default_if_silent" to one of ${values.join(', ')}, or leave it out`);
  }
  if (Object.hasOwn(m, 'close') && m.close !== 'done' && m.close !== 'release') throw bad('close', 'must be done or release', 'Set "close" to "done" or "release", or leave it out');
  // A gate's run is its own rule (section 5), so it comes after the field rules of section 4.
  if (m.kind === 'gate') {
    if (!Object.hasOwn(m, 'run')) throw bad('run', 'is required', 'Add "run": {"run_id": "<done-done run id>", "commit": "<full commit>"}, the run held for approval');
    checkRun(RUN.slice(0, 2));
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
