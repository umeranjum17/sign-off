// A small JSON Schema checker for the ticket adapter's schemas (docs/ticket-adapter/schemas). It knows only the keywords those schemas use and throws on any
// other, so a schema can never lean on a rule this file does not check. $ref points at another file of the folder, with or without a #/pointer, or at #/pointer.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const KEYWORDS = new Set(['$schema', '$id', '$defs', '$ref', 'title', 'description', 'type', 'const', 'enum', 'properties', 'required', 'additionalProperties', 'items',
  'minItems', 'uniqueItems', 'minLength', 'maxLength', 'minimum', 'minProperties', 'format', 'oneOf', 'anyOf']);
const RFC3339 = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const typeOk = (t, v) => t === 'null' ? v === null : t === 'array' ? Array.isArray(v) : t === 'object' ? isObject(v) : t === 'integer' ? Number.isInteger(v) : typeof v === t;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Every *.json of a schema folder, by file name. */
export function loadSchemas(dir) {
  return new Map(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(readFileSync(join(dir, f), 'utf8'))]));
}

/** The problems of `value` against the schema in `file`, each as "<pointer>: <what is wrong>"; none means it is valid. */
export function validate(schemas, file, value) {
  const resolve = (ref, base) => {
    const [name, pointer = ''] = ref.split('#');
    let found = schemas.get(name || base);
    for (const key of pointer.split('/').filter(Boolean)) found = found?.[key];
    if (found === undefined) throw new Error(`json-schema: ${ref} (from ${base}) points at nothing`);
    return [found, name || base];
  };
  const check = (s, v, at, base) => {
    const problems = [], bad = (why) => problems.push(`${at || '/'}: ${why}`);
    for (const k of Object.keys(s)) if (!KEYWORDS.has(k)) throw new Error(`json-schema: keyword ${k} is not supported (${base})`);
    if (s.$ref) { const [target, from] = resolve(s.$ref, base); problems.push(...check(target, v, at, from)); }
    if (s.type && ![].concat(s.type).some((t) => typeOk(t, v))) { bad(`must be ${[].concat(s.type).join(' or ')}`); return problems; }
    if ('const' in s && !same(s.const, v)) bad(`must be ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.some((x) => same(x, v))) bad(`must be one of ${s.enum.join(', ')}`);
    if (typeof v === 'string') {
      if (s.minLength !== undefined && v.length < s.minLength) bad(`must not be shorter than ${s.minLength}`);
      if (s.maxLength !== undefined && v.length > s.maxLength) bad(`must not be longer than ${s.maxLength}`);
      if (s.format === 'date-time' && !(RFC3339.test(v) && !Number.isNaN(Date.parse(v)))) bad('must be an RFC 3339 time');
    }
    if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) bad(`must be at least ${s.minimum}`);
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) bad(`must have at least ${s.minItems} items`);
      if (s.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) bad('must not repeat an item');
      if (s.items) v.forEach((x, i) => problems.push(...check(s.items, x, `${at}/${i}`, base)));
    }
    if (isObject(v)) {
      for (const k of s.required ?? []) if (!(k in v)) bad(`${k} is required`);
      if (s.minProperties !== undefined && Object.keys(v).length < s.minProperties) bad(`must have at least ${s.minProperties} keys`);
      for (const [k, x] of Object.entries(v)) {
        if (s.properties?.[k]) problems.push(...check(s.properties[k], x, `${at}/${k}`, base));
        else if (s.additionalProperties === false) problems.push(`${at}/${k}: is not a key of this object`);
      }
    }
    for (const word of ['oneOf', 'anyOf']) {
      if (!s[word]) continue;
      const tries = s[word].map((b) => check(b, v, at, base)), hits = tries.filter((t) => !t.length).length;
      if (word === 'oneOf' ? hits !== 1 : hits === 0) { bad(hits ? `matches ${hits} of the ${tries.length} alternatives, not one` : 'matches none of the alternatives'); problems.push(...tries.reduce((a, b) => (b.length < a.length ? b : a))); }
    }
    return problems;
  };
  const [schema, base] = resolve(file, file);
  return check(schema, value, '', base);
}
