// The v1 communication contract (docs/contract.md): one strict, versioned shape per kind of message.
import { isKey } from './store.js';

/** A message that does not match: what is wrong, and the one line that says how to fix it. */
export class ContractError extends Error {
  constructor(message: string, readonly help: string) { super(message); }
}
export const KINDS = ['ask', 'report', 'evidence', 'gate', 'finding'];
/** The kinds this build checks, with the schema number of each. */
export const SCHEMAS: Record<string, number> = { ask: 1 };
const ASK = ['contract', 'kind', 'schema', 'key', 'title', 'filer', 'link', 'about', 'detail', 'options', 'recommend_value', 'default_if_silent', 'close'];

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
        if (top.keys.has(name)) throw new ContractError(`field "${name}" is written twice`, `Remove the second "${name}".`);
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

/** Checks one message against its kind's rules and returns its kind and schema; the first broken rule throws, in the order docs/contract.md gives.
 * `want` is the kind the caller expects, so the wrong file is refused before its fields are read. */
export function checkMessage(m: any, want?: string): { kind: string; schema: number } {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new ContractError('the message must be one JSON object', 'Write the message as one JSON object, such as {"contract":1,"kind":"ask",...}');
  const at = isKey(m.key) ? `key ${m.key}: ` : '';
  const bad = (field: string, rule: string, help: string) => new ContractError(`${at}${field} ${rule}`, help);
  const need = (f: string) => {
    if (!Object.hasOwn(m, f)) throw bad(f, 'is required', 'Add "contract": 1, "kind" and "schema" to the message, such as "contract": 1, "kind": "ask", "schema": 1');
  };
  /** Text: a string with something besides whitespace, no control character but newline, and at most max code points. */
  const text = (field: string, v: unknown, max: number, set: string) => {
    const name = field.replace(/^.*\./, '');
    if (typeof v !== 'string' || !/\S/.test(v)) throw bad(field, 'must be text', `Set "${name}" to ${set}`);
    if (/[\0-\x09\x0b-\x1f\x7f-\x9f]/.test(v)) throw bad(field, 'has a control character other than newline', `Remove tabs and other control characters from "${name}"`);
    if ([...v].length > max) throw bad(field, `is ${[...v].length} characters, over ${max}`, `Shorten "${name}" to ${max} characters`);
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
  const extra = Object.keys(m).find((f) => !ASK.includes(f));
  if (extra) throw bad(extra, `is not a field of ${m.kind} schema ${m.schema}`, `Remove "${extra}"; ${m.kind} takes ${ASK.slice(3).join(', ')}`);
  if (!isKey(m.key)) throw bad('key', Object.hasOwn(m, 'key') ? `${show(m.key)} must be 1-128 of A-Z a-z 0-9 . _ -` : 'is required', 'Set "key" to a short id such as "ship-signin-2"');
  if (!Object.hasOwn(m, 'title')) throw bad('title', 'is required', 'Add "title": the question, in 160 characters or fewer');
  text('title', m.title, 160, 'the question, in 160 characters or fewer');
  if (Object.hasOwn(m, 'filer') && !isKey(m.filer)) throw bad('filer', 'must be 1-128 of A-Z a-z 0-9 . _ -', 'Set "filer" to your agent session id or tool name, or leave it out');
  if (Object.hasOwn(m, 'link') && !(typeof m.link === 'string' && /^(https?:\/\/\S{1,500}|[a-f0-9]{7,40})$/u.test(m.link))) {
    throw bad('link', 'must be an http(s) link or a 7-40 character commit hash', 'Set "link" to a URL such as "https://example.com/pr/4" or a commit hash, or leave it out');
  }
  if (Object.hasOwn(m, 'about')) text('about', m.about, 500, 'a short note, or leave it out');
  if (Object.hasOwn(m, 'detail')) text('detail', m.detail, 1000, 'the longer note, or leave it out');
  const options = m.options;
  if (!Array.isArray(options) || options.length < 2 || options.length > 6) {
    throw bad('options', Object.hasOwn(m, 'options') ? 'must list 2 to 6 options' : 'is required', 'Set "options" to 2-6 objects such as {"value":"yes","label":"Yes"}');
  }
  options.forEach((o: any, n: number) => {
    const field = `options[${n}]`;
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad(field, 'must be an object', 'Write each option as {"value":"<id>","label":"<text>"}');
    const odd = Object.keys(o).find((f) => f !== 'value' && f !== 'label');
    if (odd) throw bad(`${field}.${odd}`, 'is not a field of an option', `Remove "${odd}"; an option has only value and label`);
    if (!isKey(o.value)) throw bad(`${field}.value`, 'must be 1-128 of A-Z a-z 0-9 . _ -', 'Set "value" to a short id such as "yes"');
    if (options.slice(0, n).some((p: any) => p.value === o.value)) throw bad(`${field}.value`, `repeats ${o.value}`, 'Give every option its own value');
    text(`${field}.label`, o.label, 80, 'the button text, in 80 characters or fewer');
  });
  const values = options.map((o: any) => o.value), pick = `the option you would pick: one of ${values.join(', ')}`;
  if (!Object.hasOwn(m, 'recommend_value')) throw bad('recommend_value', 'is required', `Add "recommend_value": ${show(values[0])}, ${pick}`);
  if (!values.includes(m.recommend_value)) throw bad('recommend_value', `${show(m.recommend_value)} is not an option value`, `Set "recommend_value" to ${pick}`);
  if (Object.hasOwn(m, 'default_if_silent') && !values.includes(m.default_if_silent)) {
    throw bad('default_if_silent', `${show(m.default_if_silent)} is not an option value`, `Set "default_if_silent" to one of ${values.join(', ')}, or leave it out`);
  }
  if (Object.hasOwn(m, 'close') && m.close !== 'done' && m.close !== 'release') throw bad('close', 'must be done or release', 'Set "close" to "done" or "release", or leave it out');
  return { kind: m.kind, schema: m.schema };
}
