// The v1 communication contract (docs/contract.md): one strict, versioned shape per kind of message.
import { createHash } from 'node:crypto';
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { CAPTION_MAX, EVIDENCE_STATUSES, GUARDS, isKey, MEDIA_MAX, PRIORITIES, REPORT_FORMS, REPORT_PARTS, REPORT_PURPOSES } from './store.js';
import { nestedCard, ownColours } from './pagestyle.js';

/** A message that does not match: what is wrong, and the one line that says how to fix it. */
export class ContractError extends Error {
  constructor(message: string, readonly help: string) { super(message); }
}
/** The kinds, with the schema number of each. */
export const SCHEMAS: Record<string, number> = { ask: 1, report: 5, evidence: 1, gate: 1, finding: 1, plan: 3, design: 2 };
/** Older schemas this sign-off-axi still takes, so a board that holds them loads and re-posts: the page-based report 2, the guided report 3 and 4 (4 with no purpose), plan 1 and 2, and design 1 (screens of one view each). */
const OLDER: Record<string, number[]> = { report: [2, 3, 4], plan: [1, 2], design: [1] };
/** The guided schemas: a report 3 and a plan 2 are fields the board draws as one guided page, not a page the agent draws. */
export const guided = (m: any) => (m?.kind === 'report' && [3, 4, 5].includes(m.schema)) || (m?.kind === 'plan' && [2, 3].includes(m.schema));
/** The schemas with versioned engagement, whose owning filer is required: report 4 and 5, plan 3. */
export const engaged = (m: any) => (m?.kind === 'report' && [4, 5].includes(m.schema)) || (m?.kind === 'plan' && m.schema === 3);
export const KINDS = Object.keys(SCHEMAS);
const COMMON = ['contract', 'kind', 'schema', 'key', 'title', 'filer', 'ticket', 'priority', 'link', 'about'];
const FIELDS: Record<string, string[]> = {
  ask: [...COMMON, 'ask_ref', 'detail', 'why', 'options', 'recommend_value', 'recommend_reason', 'default_if_silent', 'silent_by', 'guard', 'close', 'merges', 'proof', 'report'],
  report: [...COMMON, 'filed', 'group', 'decided', 'form', 'video', 'asked_by', 'purpose', 'project', 'view', 'preview'],
  evidence: [...COMMON, 'media', 'run', 'status', 'captions'],
  gate: [...COMMON, 'run', 'options', 'recommend_value', 'close'],
  finding: [...COMMON, 'cause', 'incidents', 'days', 'evidence_ids', 'change_kind', 'proposal', 'options', 'recommend_value'],
  plan: [...COMMON, 'project', 'sections', 'decisions', 'steps', 'view'],
  design: [...COMMON, 'group', 'filed', 'status', 'preview', 'journeys', 'accepts', 'reviewed'],
};
/** Design 1: screens of one view each and an optional pick between directions, with no question of its own. */
const DESIGN_1 = [...COMMON, 'group', 'filed', 'status', 'preview', 'journeys', 'options', 'recommend'];
/** A design 2 frame's role, in the order its columns show: what ships today, the new look (proposed or built) and the approved target design. */
export const FRAME_ROLES = ['today', 'proposed', 'built', 'target'];
const GUIDE = ['understood', 'visual', 'sections', 'next'];
const GUIDE_FIELDS: Record<string, string[]> = {
  report: [...COMMON, 'filed', 'group', 'decided', 'asked_by', 'purpose', 'project', ...GUIDE],
  plan: [...COMMON, 'project', 'decisions', ...GUIDE],
};
/** A done-done run: its id, full commit and the four Checks lines. */
const RUN = ['run_id', 'commit', 'outcome', 'repro', 'proof', 'evidence'];
/** The fixed options of a kind, each with its one label: a gate's are the actions of done-done respond --action. */
const ACTIONS: Record<string, Record<string, string>> = {
  gate: { approve: 'Approve', skip: 'Skip the judge', fix: 'Fix first' },
  finding: { apply: 'Apply', skip: 'Skip' },
};
/** The screens a gallery frame shows, and the files it may be. */
export const GALLERY_DEVICES = ['phone', 'desktop'];
const GALLERY_FILE = /\.(png|jpe?g|webp|html?)$/i;
/** The report kit's blocks, the files a block may name, and the words a status may take. */
export const KIT_BLOCKS = ['callout', 'beats', 'video', 'table', 'compare', 'evidence'];
const KIT_IMAGE = /\.(png|jpe?g|webp)$/i, KIT_VIDEO = /\.(mp4|webm)$/i;
export const KIT_STATUS: Record<string, string> = { fixed: 'Fixed', progress: 'In progress', waiting: 'Waiting on you' };
const KIT_TONES = ['note', 'warn', 'ask'];
export const MEDIA_BYTES = 50_000_000;
/** The command that makes a report's page, named in every refusal of a report without one. */
export const REPORT_INIT = 'sign-off-axi report init <folder>';
const KIT_HELP = `Draw the report with the board's own blocks instead: run \`${REPORT_INIT} --purpose <kind>\` and add \`blocks\` to a section (callout, beats, video, table, compare, evidence). A page of your own may use the system colours (Canvas, CanvasText, GrayText) and no cards`;
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
const FLAG_OF: Record<string, string> = { why: 'why', about: 'about', detail: 'detail', title: 'title', default_if_silent: 'default', recommend_reason: 'recommend-reason', recommend_value: 'recommend', silent_by: 'silent-by', guard: 'guard', merges: 'merge', proof: 'proof', report: 'report', options: 'option', label: 'option', value: 'option', outcome: 'outcome' };
/** The flag a field fills: options[1].outcome is --outcome, merges[0] is --merge. */
const flagOf = (field: string) => { const f = field.replace(/^options\[\d+\]\./, '').replace(/\[\d+\]$/, ''); return `--${FLAG_OF[f] ?? f}`; };
/** A field as a refusal names it: the JSON field, or the raise flag that fills it. */
const named = (field: string, flags: boolean) => (flags ? flagOf(field) : `"${field}"`);

/** Checks one message against its kind's rules and returns its kind and schema; the first broken rule throws, in the order docs/contract.md gives.
 * `want` is the kind the caller expects, so the wrong file is refused before its fields are read. `fresh` is a new design posted by post --kind design,
 * whose title must be one plain question whatever its schema. */
export function checkMessage(m: any, want?: string, flags = false, fresh = false): { kind: string; schema: number } {
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
  /** A gallery: 1 to 6 options of a design output, each with its model, the time it ran and 1 or 2 frames (a phone's, a desktop's), every frame an image or page with the device it shows and a caption. Post pins each frame's file like a diagram's. */
  const gallery = (field: string, v: any) => list(field, 1, 6, ['label', 'model', 'ran', 'frames'], '{"label":"Option A","model":"Haiku 5.5","ran":"2026-10-24T09:30:00Z","frames":[{"device":"phone","src":"gallery/a-phone.png","caption":"Sign-in on a phone"}]}', v).forEach((o, n) => {
    const at = `${field}[${n}]`;
    text(`${at}.label`, o.label, 40, 'the option\'s name, such as "Option A", in 40 characters or fewer');
    text(`${at}.model`, o.model, 40, 'the model that made it, such as "Haiku 5.5", in 40 characters or fewer');
    const ran = typeof o.ran === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(o.ran) ? new Date(o.ran) : undefined;
    if (!ran || Number.isNaN(ran.getTime()) || ran.toISOString().replace('.000', '') !== o.ran) throw bad(`${at}.ran`, Object.hasOwn(o, 'ran') ? `${show(o.ran)} is not a UTC time such as 2026-10-13T07:19:00Z` : 'is required', 'Set "ran" to when the model made it, exactly YYYY-MM-DDTHH:MM:SSZ in UTC');
    list(`${at}.frames`, 1, 2, ['device', 'src', 'caption', 'sha256', 'bytes'], '{"device":"phone","src":"gallery/a-phone.png","caption":"Sign-in on a phone"}', o.frames).forEach((f, k) => {
      const fa = `${at}.frames[${k}]`, DEVICE = 'Set "device" to "phone" (390 wide) or "desktop" (1280 wide)';
      if (!Object.hasOwn(f, 'device')) throw bad(`${fa}.device`, 'is required: the screen the frame shows', DEVICE);
      if (!GALLERY_DEVICES.includes(f.device)) throw bad(`${fa}.device`, `${show(f.device)} is not one of ${GALLERY_DEVICES.join(', ')}`, DEVICE);
      if (o.frames.slice(0, k).some((p: any) => p.device === f.device)) throw bad(`${fa}.device`, `repeats ${f.device}`, 'Give an option one phone frame and one desktop frame at most');
      text(`${fa}.caption`, f.caption, 120, 'what the frame shows, in 120 characters or fewer');
      text(`${fa}.src`, f.src, 256, 'an image or page path from the board file\'s folder, such as "gallery/a-phone.png"');
      if (/^([\\/]|[A-Za-z]:)/.test(f.src) || f.src.split(/[\\/]/).includes('..') || /[?#\\]/.test(f.src) || !GALLERY_FILE.test(f.src)) throw bad(`${fa}.src`, `${show(f.src)} must be a relative .png, .jpg, .jpeg, .webp or .html path with no .., ?, # or \\`, 'Set "src" to the frame\'s file next to the message, such as "gallery/a-phone.png"');
      if (Object.hasOwn(f, 'sha256') && !/^[a-f0-9]{64}$/.test(f.sha256)) throw bad(`${fa}.sha256`, 'must be 64 lowercase hex digits', 'Leave "sha256" and "bytes" out; post pins the file');
      if (Object.hasOwn(f, 'bytes') && !(Number.isInteger(f.bytes) && f.bytes >= 0)) throw bad(`${fa}.bytes`, 'must be a whole number of bytes', 'Leave "sha256" and "bytes" out; post pins the file');
    });
  });
  /** A kit block's file: a path from the board file's folder to an image (or, for a video, a .mp4 or .webm), pinned by post like a gallery frame. */
  const kitFile = (field: string, v: any, re: RegExp, kinds: string, example: string) => {
    text(field, v, 256, `${kinds} path from the board file's folder, such as "${example}"`);
    if (/^([\\/]|[A-Za-z]:)/.test(v) || v.split(/[\\/]/).includes('..') || /[?#\\]/.test(v) || !re.test(v)) throw bad(field, `${show(v)} must be a relative ${kinds} path with no .., ?, # or \\`, `Set "${field.replace(/^.*\./, '')}" to the file next to the message, such as "${example}"`);
  };
  /** The report kit: 1 to 12 blocks a section draws in the board's own style, in the order given. A block is data (words, files, rows); it never carries markup or colour. */
  const blocks = (field: string, v: any) => {
    if (!Array.isArray(v) || v.length < 1 || v.length > 12) throw bad(field, 'must list 1 to 12 blocks', `Set "${field}" to blocks such as {"type":"callout","title":"Read this first","text":"..."}; the types are ${KIT_BLOCKS.join(', ')}`);
    v.forEach((o: any, n: number) => {
      const at = `${field}[${n}]`;
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad(at, 'must be an object', `Write each block as {"type":"callout",...}; the types are ${KIT_BLOCKS.join(', ')}`);
      if (!KIT_BLOCKS.includes(o.type)) throw bad(`${at}.type`, `${show(o.type)} is not one of ${KIT_BLOCKS.join(', ')}`, `Set "type" to ${KIT_BLOCKS.join(', ')}; a gallery is the section's "gallery", not a block`);
      const only = (fields: string[], example: string) => one(at, o, ['type', ...fields], example);
      if (o.type === 'callout') {
        only(['tone', 'title', 'text'], '{"type":"callout","tone":"warn","title":"Not measured","text":"How much of the plan\'s window this took."}');
        if (Object.hasOwn(o, 'tone') && !KIT_TONES.includes(o.tone)) throw bad(`${at}.tone`, `${show(o.tone)} is not one of ${KIT_TONES.join(', ')}`, `Set "tone" to ${KIT_TONES.join(', ')}, or leave it out`);
        text(`${at}.title`, o.title, 60, 'the callout\'s bold first line, in 60 characters or fewer');
        text(`${at}.text`, o.text, 280, 'the callout\'s words, in 280 characters or fewer');
      } else if (o.type === 'beats') {
        only(['beats'], '{"type":"beats","beats":[{"image":"beats/1.png","time":"0:00","title":"The pain","text":"..."}]}');
        list(`${at}.beats`, 2, 12, ['image', 'time', 'title', 'text'], '{"image":"beats/1.png","time":"0:00","title":"The pain","text":"One line."}', o.beats).forEach((b, k) => {
          kitFile(`${at}.beats[${k}].image`, b.image, KIT_IMAGE, 'a .png, .jpg, .jpeg or .webp', 'beats/1.png');
          if (Object.hasOwn(b, 'time')) text(`${at}.beats[${k}].time`, b.time, 12, 'the beat\'s time, such as "0:11", in 12 characters or fewer');
          text(`${at}.beats[${k}].title`, b.title, 80, 'the beat\'s title, in 80 characters or fewer');
          text(`${at}.beats[${k}].text`, b.text, 280, 'the beat\'s words, in 280 characters or fewer');
        });
      } else if (o.type === 'video') {
        only(['src', 'poster', 'length', 'caption'], '{"type":"video","src":"film.mp4","poster":"film.jpg","length":"0:10","caption":"The promo, 10 seconds."}');
        kitFile(`${at}.src`, o.src, KIT_VIDEO, 'a .mp4 or .webm', 'film.mp4');
        kitFile(`${at}.poster`, o.poster, KIT_IMAGE, 'a .png, .jpg, .jpeg or .webp', 'film.jpg');
        if (Object.hasOwn(o, 'length')) text(`${at}.length`, o.length, 12, 'the film\'s length, such as "0:10", in 12 characters or fewer');
        text(`${at}.caption`, o.caption, 280, 'what the film shows, in 280 characters or fewer');
      } else if (o.type === 'table') {
        only(['columns', 'rows'], '{"type":"table","columns":["Measured","App promo","Cinematic"],"rows":[["AI calls","3","1"]]}');
        if (!Array.isArray(o.columns) || o.columns.length < 2 || o.columns.length > 5) throw bad(`${at}.columns`, 'must list 2 to 5 column names', 'Set "columns" to 2-5 short names, such as ["Measured","App promo","Cinematic"]');
        o.columns.forEach((c: any, k: number) => text(`${at}.columns[${k}]`, c, 40, 'the column\'s name, in 40 characters or fewer'));
        if (!Array.isArray(o.rows) || o.rows.length < 1 || o.rows.length > 30) throw bad(`${at}.rows`, 'must list 1 to 30 rows', 'Set "rows" to arrays of text, one per column');
        o.rows.forEach((r: any, k: number) => {
          if (!Array.isArray(r) || r.length !== o.columns.length) throw bad(`${at}.rows[${k}]`, `must have ${o.columns.length} cells, one per column`, 'Write each row as an array of text with one cell for every column');
          r.forEach((c: any, j: number) => text(`${at}.rows[${k}][${j}]`, c, 120, 'the cell\'s words, in 120 characters or fewer'));
        });
      } else if (o.type === 'compare') {
        only(['before', 'after'], '{"type":"compare","before":{"image":"old.png","caption":"As filed"},"after":{"image":"new.png","caption":"In the kit"}}');
        for (const side of ['before', 'after']) {
          if (!Object.hasOwn(o, side)) throw bad(`${at}.${side}`, 'is required', `Add "${side}": {"image":"${side}.png","caption":"what it shows"}`);
          one(`${at}.${side}`, o[side], ['image', 'caption'], `{"image":"${side}.png","caption":"what it shows"}`);
          kitFile(`${at}.${side}.image`, o[side].image, KIT_IMAGE, 'a .png, .jpg, .jpeg or .webp', `${side}.png`);
          text(`${at}.${side}.caption`, o[side].caption, 80, 'what the frame shows, in 80 characters or fewer');
        }
      } else {
        only(['rows'], '{"type":"evidence","rows":[{"image":"a.png","title":"Line wrapped","note":"Version 1","status":"fixed"}]}');
        list(`${at}.rows`, 1, 12, ['image', 'title', 'note', 'status'], '{"image":"a.png","title":"Line wrapped","note":"Version 1","status":"fixed"}', o.rows).forEach((r, k) => {
          if (Object.hasOwn(r, 'image')) kitFile(`${at}.rows[${k}].image`, r.image, KIT_IMAGE, 'a .png, .jpg, .jpeg or .webp', 'a.png');
          text(`${at}.rows[${k}].title`, r.title, 80, 'what the capture shows, in 80 characters or fewer');
          if (Object.hasOwn(r, 'note')) text(`${at}.rows[${k}].note`, r.note, 80, 'a second line, in 80 characters or fewer');
          if (!Object.hasOwn(r, 'status') || !(r.status in KIT_STATUS)) throw bad(`${at}.rows[${k}].status`, Object.hasOwn(r, 'status') ? `${show(r.status)} is not one of ${Object.keys(KIT_STATUS).join(', ')}` : 'is required', `Set "status" to ${Object.keys(KIT_STATUS).join(', ')}`);
        });
      }
    });
  };
  /** The files a section's blocks name, pinned like gallery frames: each path once, with the hash and size post adds. */
  const pinList = (field: string, v: any) => list(field, 1, 60, ['src', 'sha256', 'bytes'], '{"src":"beats/1.png"}', v).forEach((o, n) => {
    text(`${field}[${n}].src`, o.src, 256, 'a path from the board file\'s folder');
    if (Object.hasOwn(o, 'sha256') && !/^[a-f0-9]{64}$/.test(o.sha256)) throw bad(`${field}[${n}].sha256`, 'must be 64 lowercase hex digits', 'Leave "pins" out; post pins the files');
    if (Object.hasOwn(o, 'bytes') && !(Number.isInteger(o.bytes) && o.bytes >= 0)) throw bad(`${field}[${n}].bytes`, 'must be a whole number of bytes', 'Leave "pins" out; post pins the files');
  });
  /** A report 5's parts: each part of its kind once, in a section naming it, with what that part needs (a source's link, a finding's confidence, a slice's size, a design's diagram). */
  const kindParts = (parts: [string, string][]) => {
    const init = `Run \`${REPORT_INIT.replace('<folder>', '<new folder>')} --purpose ${m.purpose}\` for a template with every part, or add the section`;
    const of = (part: string) => m.sections.findIndex((o: any) => o.part === part), items = (part: string) => m.sections[of(part)].items ?? [];
    for (const [part, name] of parts) {
      const at = of(part), twice = m.sections.findIndex((o: any, n: number) => o.part === part && n > at);
      if (at < 0) throw bad('sections', `has no ${show(part)} part (${name}): a ${m.purpose} report needs ${parts.map(([p]) => p).join(', ')}`, `Add a section with "part": ${show(part)}, ${name.toLowerCase()}. ${init}`);
      if (twice >= 0) throw bad(`sections[${twice}].part`, `repeats ${part}`, 'Give each part one section');
    }
    const need = (part: string, ok: boolean, rule: string, help: string) => { if (!ok) throw bad(`sections[${of(part)}]`, `(${part}) ${rule}`, help); };
    if (m.purpose === 'research') {
      need('sources', items('sources').length >= 3 && items('sources').every((it: any) => it.link && it.source), 'must list at least 3 sources, each with its "link" and "source"', 'List each source as an item with "link" (where to read it) and "source": "primary" (docs, code, a maintainer) or "user" (what users report)');
      need('sources', items('sources').some((it: any) => it.source === 'user'), 'must hold at least one user report ("source": "user")', 'Add what users report, with its link: a GitHub issue, a forum thread, Reddit, Hacker News or X; if a site blocked you, say so in "not-checked"');
      need('options', items('options').length >= 2, 'must compare at least 2 options, one item each', 'Give each option an item with the same axes in "more", one "Axis: value." per line, so the board draws one table');
      need('findings', items('findings').length >= 1 && items('findings').every((it: any) => it.confidence), 'must list each finding with its "confidence"', 'Give each finding an item with "confidence": "high", "medium" or "low"');
    }
    if (m.purpose === 'plan') {
      const d = m.sections[of('design')];
      need('design', !!(d.diagram || (d.items ?? []).some((it: any) => it.diagram) || m.visual?.diagram), 'needs a diagram (on the section, an item or the visual)', 'Draw the design as inline SVG in an .html page and add "diagram": [{"label": "Flow", "src": "diagrams/flow.html"}] (see the skill)');
      need('slices', items('slices').length >= 1 && items('slices').every((it: any) => it.size), 'must list each slice with its "size"', 'Give each slice an item with "size", such as "S, half a day"');
      need('tests', items('tests').length >= 1, 'must list how each slice is tested and proven', 'Add an item per slice: the test and the proof that it works');
    }
  };
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
    // A report 5 is built of its kind's parts: up to 10 sections, each naming the part it is, and items that carry a source's link, a finding's confidence or a slice's size.
    const v5 = m.kind === 'report' && m.schema >= 5, parts = v5 ? REPORT_PARTS[m.purpose] ?? [] : [];
    const ids = list('sections', minSections, v5 ? 10 : 6, ['id', 'stage', 'heading', 'body', 'items', 'details', 'diagram', 'gallery', 'blocks', 'pins', ...(v5 ? ['part'] : [])], '{"id":"steps","stage":"recommend","heading":"Eight steps, 22 to 31 Oct","body":"..."}').map((o, n) => {
      const at = `sections[${n}]`;
      if (!(typeof o.id === 'string' && /^[a-z0-9-]{1,40}$/.test(o.id))) throw bad(`${at}.id`, 'must be 1-40 of a-z 0-9 -', 'Set "id" to a short slug such as "steps"');
      if (!['found', 'recommend'].includes(o.stage)) throw bad(`${at}.stage`, `${show(o.stage)} is not found or recommend`, 'Set "stage" to "found" (what I found) or "recommend" (what I recommend)');
      text(`${at}.heading`, o.heading, 80, 'the section heading, in 80 characters or fewer');
      text(`${at}.body`, o.body, 300, 'the section\'s lead, in 300 characters or fewer');
      if (Object.hasOwn(o, 'part') && !parts.some(([p]) => p === o.part)) {
        throw bad(`${at}.part`, parts.length ? `${show(o.part)} is not a part of a ${m.purpose} report: ${parts.map(([p]) => p).join(', ')}` : `is not used by a report whose purpose is ${m.purpose}`, parts.length ? `Set "part" to the part this section is, one of ${parts.map(([p]) => p).join(', ')}` : 'Remove "part"');
      }
      if (Object.hasOwn(o, 'items')) list(`${at}.items`, 1, 8, ['title', 'text', 'more', 'tone', 'diagram', ...(v5 ? ['link', 'source', 'confidence', 'size'] : [])], '{"title":"Ship 0.2.5","text":"You test it.","more":"..."}', o.items).forEach((it, k) => {
        text(`${at}.items[${k}].title`, it.title, 80, 'the item, in 80 characters or fewer');
        text(`${at}.items[${k}].text`, it.text, 160, 'one line under it, in 160 characters or fewer');
        if (Object.hasOwn(it, 'more')) text(`${at}.items[${k}].more`, it.more, 600, 'what opens when it is tapped, in 600 characters or fewer, or leave it out');
        tone(`${at}.items[${k}]`, it);
        if (Object.hasOwn(it, 'diagram')) diagrams(`${at}.items[${k}].diagram`, it.diagram);
        if (Object.hasOwn(it, 'link') && !(typeof it.link === 'string' && /^https?:\/\/[^\s\p{Cc}\p{Cs}]{1,500}$/u.test(it.link))) throw bad(`${at}.items[${k}].link`, 'must be an http(s) link with no spaces', 'Set "link" to where the source can be read, such as "https://github.com/owner/repo/issues/12"');
        if (Object.hasOwn(it, 'source') && !['user', 'primary'].includes(it.source)) throw bad(`${at}.items[${k}].source`, `${show(it.source)} is not user or primary`, 'Set "source" to "user" (what users report: an issue, a forum, Reddit, Hacker News) or "primary" (docs, code, a maintainer\'s answer, your own check)');
        if (Object.hasOwn(it, 'confidence') && !['high', 'medium', 'low'].includes(it.confidence)) throw bad(`${at}.items[${k}].confidence`, `${show(it.confidence)} is not high, medium or low`, 'Set "confidence" to how sure you are of the finding: "high", "medium" or "low"');
        if (Object.hasOwn(it, 'size')) text(`${at}.items[${k}].size`, it.size, 24, 'how big the slice is, such as "S, half a day", in 24 characters or fewer');
      });
      if (Object.hasOwn(o, 'details')) details(`${at}.details`, o.details);
      if (Object.hasOwn(o, 'diagram')) diagrams(`${at}.diagram`, o.diagram);
      if (Object.hasOwn(o, 'gallery')) gallery(`${at}.gallery`, o.gallery);
      if (Object.hasOwn(o, 'blocks')) blocks(`${at}.blocks`, o.blocks);
      if (Object.hasOwn(o, 'pins')) pinList(`${at}.pins`, o.pins);
      return o.id;
    });
    const twice = ids.findIndex((id, n) => ids.indexOf(id) < n);
    if (twice >= 0) throw bad(`sections[${twice}].id`, `repeats ${ids[twice]}`, 'Give every section its own id');
    if (parts.length) kindParts(parts);
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
  const fields = (guided(m) ? GUIDE_FIELDS[m.kind] : m.kind === 'design' && m.schema === 1 ? DESIGN_1 : FIELDS[m.kind]), extra = Object.keys(m).find((f) => !fields.includes(f));
  if (extra === 'options' && m.kind === 'report') throw bad('options', 'is not a field of report: a report takes no answer', 'Remove "options", or post an ask to get an answer');
  if (extra === 'options' && m.kind === 'plan') throw bad('options', 'is not a field of plan: its answers come from its sections and decisions', 'Remove "options"; put each question in "decisions", with its options and "recommend"');
  if (extra !== undefined) throw bad(escaped(extra) || '""', `is not a field of ${m.kind} schema ${m.schema}`, `Remove ${show(extra)}; ${m.kind} takes ${fields.slice(3).join(', ')}`);
  if (!(m.kind === 'evidence' && !Object.hasOwn(m, 'key')) && !isKey(m.key)) throw bad('key', Object.hasOwn(m, 'key') ? `${show(m.key)} must be 1-128 of A-Z a-z 0-9 . _ -` : 'is required', 'Set "key" to a short id such as "ship-signin-2"');
  if (!Object.hasOwn(m, 'title')) throw bad('title', 'is required', 'Add "title": the question, in 160 characters or fewer');
  text('title', m.title, 160, 'the question, in 160 characters or fewer');
  if (engaged(m) && !isKey(m.filer)) throw bad('filer', 'is required', 'Set "filer" to the owning agent id');
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
    if (!Object.hasOwn(m, 'media') && !Object.hasOwn(m, 'run') && !Object.hasOwn(m, 'status')) throw bad('media', 'or run is required', 'Add "media": ["shot.png"], files next to the message, or "run": the done-done run it proves, or a "status" to post the card with its frame pending');
    if (Object.hasOwn(m, 'media')) {
      if (!Array.isArray(m.media) || !m.media.length || m.media.length > MEDIA_MAX) throw bad('media', `must list 1 to ${MEDIA_MAX} files`, 'Set "media" to file paths next to the message, such as ["shot.png"]');
      m.media.forEach((p: unknown, n: number) => {
        text(`media[${n}]`, p, 1000, 'a file path from the message file\'s folder, such as "shot.png"');
        if (/^([\\/]|[A-Za-z]:)/.test(p as string) || (p as string).split(/[\\/]/).includes('..')) throw bad(`media[${n}]`, `${show(p)} must be a relative path with no ..`, 'Give the path from the message file\'s folder, such as "evidence-out/after.png"');
        if (!/\.(png|jpe?g|webp|mp4|webm)$/i.test(p as string)) throw bad(`media[${n}]`, `${show(p)} must end in .png, .jpg, .jpeg, .webp, .mp4 or .webm`, 'Post a screenshot or recording in one of those formats');
      });
    }
    if (Object.hasOwn(m, 'status') && !EVIDENCE_STATUSES.includes(m.status)) throw bad('status', `${show(m.status)} is not one of ${EVIDENCE_STATUSES.join(', ')}`, `Set "status" to where the work stands: ${EVIDENCE_STATUSES.join(', ')}, or leave it out`);
    if (Object.hasOwn(m, 'captions')) {
      if (!Array.isArray(m.captions) || !Array.isArray(m.media) || m.captions.length !== m.media.length) throw bad('captions', 'must list one caption for each file in "media"', 'Set "captions" to one short caption per capture, such as ["Before", "After"], or leave it out');
      m.captions.forEach((c: unknown, n: number) => text(`captions[${n}]`, c, CAPTION_MAX, 'a caption such as "Before, phone", in 40 characters or fewer'));
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
    if (Object.hasOwn(m, 'project')) text('project', m.project, 40, 'the project it is about, in 40 characters or fewer');
    if (Object.hasOwn(m, 'decided')) text('decided', m.decided, 200, 'what was decided, in 200 characters or fewer, or leave it out');
    if (Object.hasOwn(m, 'form') && !REPORT_FORMS.includes(m.form)) throw bad('form', `${show(m.form)} is not one of ${REPORT_FORMS.join(', ')}`, `Set "form" to ${REPORT_FORMS.join(', ')}, or leave it out`);
    if (Object.hasOwn(m, 'video')) text('video', m.video, 10, 'the video length such as "0:28", in 10 characters or fewer, or leave it out');
    if (Object.hasOwn(m, 'asked_by')) text('asked_by', m.asked_by, 40, 'who asked for it, such as "You asked" or "Docs agent", in 40 characters or fewer, or leave it out');
    // A report 5 must name what it is for; an older one may, and a new post of one must (newReportKind).
    const set = `Set "purpose" to what this report is for, one of ${REPORT_PURPOSES.join(', ')}`;
    if (m.schema >= 5 && !Object.hasOwn(m, 'purpose')) throw bad('purpose', 'is required: the kind of report, which the board shows on its row and head', set);
    if (Object.hasOwn(m, 'purpose') && !REPORT_PURPOSES.includes(m.purpose)) throw bad('purpose', `${show(m.purpose)} is not one of ${REPORT_PURPOSES.join(', ')}`, set);
    // A report is a page to tap through and a picture of it for the card: text alone is a status note, not a report.
    if (g) { guide(1); return { kind: m.kind, schema: m.schema }; }
    const need = 'a report is a page to tap through, not text';
    page('view', /\.html$/i, '.html', '"mocks/<key>/index.html"', need);
    page('preview', /\.(svg|png|jpe?g|webp)$/i, '.svg, .png, .jpg, .jpeg or .webp', '"mocks/<key>/preview.svg"', need);
    if (dirname(m.preview) !== dirname(m.view)) throw bad('preview', `${show(m.preview)} must sit in the folder of ${show(m.view)}`, `Put the picture beside the page, such as "${dirname(m.view)}/preview.svg"`);
    return { kind: m.kind, schema: m.schema };
  }
  if (m.kind === 'design') {
    const two = m.schema === 2;
    // What the person reads on a design 2, and the title of any new design, is plain words: never an id, a pull request, a slice or a file name.
    const plain = (field: string, v: string) => {
      const hit = jargon(v);
      if (hit) throw bad(field, `has ${show(hit)}, words for agents that the person does not know`, `Say what changed in plain words; put ids, pull requests and file names in "link" (${JARGON_HELP})`);
    };
    if (two || fresh) {
      const title = m.title.trim(), words = title.split(/\s+/).length, ASK = 'Make the title the one plain question Yes answers, in 12 words or fewer, such as "Approve this new phone end of list for Reports?"';
      plain('title', title);
      if (!title.endsWith('?') || title.indexOf('?') !== title.length - 1) throw bad('title', 'must be one question, ending in its only "?"', ASK);
      if (words > 12) throw bad('title', `is ${words} words, over 12`, `${ASK}; put the rest in "about"`);
    }
    if (two) {
      text('about', m.about, 280, 'what changed and why, in one or two plain sentences (280 characters or fewer)');
      plain('about', m.about);
      if (Object.hasOwn(m, 'reviewed')) { text('reviewed', m.reviewed, 200, 'the reviewer\'s note, in 200 characters or fewer, or leave it out'); plain('reviewed', m.reviewed); }
    }
    text('group', m.group, 40, 'the project name, in 40 characters or fewer');
    const at = typeof m.filed === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(m.filed) ? new Date(m.filed) : undefined;
    if (!at || Number.isNaN(at.getTime()) || at.toISOString().replace('.000', '') !== m.filed) throw bad('filed', 'must be a real UTC time with seconds', 'Set "filed" to YYYY-MM-DDTHH:MM:SSZ');
    if (!['draft', 'in_review'].includes(m.status)) throw bad('status', 'must be draft or in_review', 'Set "status" to "draft" or "in_review"');
    page('preview', /\.(png|jpe?g|webp)$/i, '.png, .jpg, .jpeg or .webp', '"design/preview.png"', 'a design preview');
    const SCREEN = two ? '{"id":"list-end","title":"Reports, scrolled to its end","frames":[...]}' : '{"id":"welcome","title":"Welcome","views":{...}}';
    const journeys = list('journeys', two ? 1 : 0, 40, ['id', 'title', 'screens'], `{"id":"phone","title":"On a phone","screens":[${SCREEN}]}`);
    if (two) {
      if (!FRAME_ROLES.slice(1).includes(m.accepts)) throw bad('accepts', Object.hasOwn(m, 'accepts') ? `${show(m.accepts)} is not proposed, built or target` : 'is required: the frame Yes approves', 'Set "accepts" to the role of the frame Yes approves: "built", "proposed" or "target"');
      const count = journeys.reduce((n, j) => n + (Array.isArray(j?.screens) ? j.screens.length : 0), 0);
      if (count > 8) throw bad('journeys', `hold ${count} screens, over 8`, 'Show only the screens that changed, one per state that changed: 8 at most');
    }
    const ids: string[] = [], variants = ['phone_light', 'phone_dark', 'computer_light', 'computer_dark'];
    /** A frame's or a design 1 screen's views: phone_light, phone_dark, computer_light or computer_dark, each a board-relative picture or page; on a design 2 all of one device. */
    const views = (p: string, v: any) => {
      if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !variants.includes(k)) || !Object.keys(v).length) throw bad(p, 'must map at least one supported view to a path', 'Add a phone_light, phone_dark, computer_light or computer_dark path');
      if (two && new Set(Object.keys(v).map(k => k.split('_')[0])).size > 1) throw bad(p, 'mixes phone and computer views', 'Give a phone and a computer their own screen: the changed area differs between them');
      for (const [variant, path] of Object.entries(v)) {
        text(`${p}.${variant}`, path, 256, 'a board-relative image or HTML path');
        if (/^([\\/]|[A-Za-z]:)/.test(path as string) || (path as string).split(/[\\/]/).includes('..') || /[?#\\]/.test(path as string) || !/\.(png|jpe?g|webp|html)$/i.test(path as string)) throw bad(`${p}.${variant}`, 'must be a relative .png, .jpg, .jpeg, .webp or .html path without ..', 'Put the view under the board folder');
        if (two && !/\.(png|jpe?g|webp)$/i.test(path as string)) throw bad(`${p}.${variant}`, 'must be a .png, .jpg, .jpeg or .webp picture', 'Capture the screen as a picture, so its changed area can be outlined on it');
      }
      return Object.keys(v)[0].split('_')[0];
    };
    journeys.forEach((j, n) => {
      if (typeof j.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(j.id)) throw bad(`journeys[${n}].id`, 'must be a short lowercase id', 'Set it to a slug such as "signup"');
      if (ids.includes(j.id)) throw bad(`journeys[${n}].id`, `repeats ${j.id}`, 'Give each journey its own id'); ids.push(j.id);
      text(`journeys[${n}].title`, j.title, 120, 'the journey title');
      if (two) plain(`journeys[${n}].title`, j.title);
      if (!Array.isArray(j.screens) || !j.screens.length || j.screens.length > 80) throw bad(`journeys[${n}].screens`, 'must list 1 to 80 screens', 'Add at least one screen with a view');
      const screenIds: string[] = [];
      j.screens.forEach((s: any, k: number) => {
        const p = `journeys[${n}].screens[${k}]`, own = two ? ['id', 'title', 'frames'] : ['id', 'title', 'views'];
        if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).some(x => !own.includes(x))) throw bad(p, `must have only ${own.join(', ')}`, `Use ${SCREEN}`);
        if (typeof s.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(s.id)) throw bad(`${p}.id`, 'must be a short lowercase id', 'Set it to a slug such as "welcome"');
        if (screenIds.includes(s.id)) throw bad(`${p}.id`, `repeats ${s.id}`, 'Give each screen its own id'); screenIds.push(s.id);
        text(`${p}.title`, s.title, two ? 80 : 120, 'the screen title');
        if (!two) { views(`${p}.views`, s.views); return; }
        plain(`${p}.title`, s.title);
        // A design 2 screen: one to three frames in role order, each changed area outlined and named in one line whenever there is something to compare.
        const FRAME = '{"role":"built","views":{"phone_light":"design/after.light.png"},"area":{"x":0,"y":0.8,"w":1,"h":0.12},"caption":"More now sits clear of the dock"}';
        const frames = list(`${p}.frames`, 1, 3, ['role', 'views', 'area', 'caption'], FRAME, s.frames), roles = frames.map((f) => f.role);
        frames.forEach((f, i) => {
          const at = `${p}.frames[${i}]`;
          if (!FRAME_ROLES.includes(f.role)) throw bad(`${at}.role`, Object.hasOwn(f, 'role') ? `${show(f.role)} is not today, proposed, built or target` : 'is required', 'Set "role" to "today" (what ships now), "proposed" or "built" (the new look) or "target" (the approved design)');
          if (i && FRAME_ROLES.indexOf(f.role) <= FRAME_ROLES.indexOf(roles[i - 1])) throw bad(`${at}.role`, `${f.role} comes after ${roles[i - 1]}`, 'List the frames once each, in the order today, proposed or built, target');
          if (f.role === 'built' && roles.includes('proposed')) throw bad(`${at}.role`, 'is built beside proposed', 'Show one new look: built once it is built, else proposed');
          if (views(`${at}.views`, f.views) !== views(`${p}.frames[0].views`, frames[0].views)) throw bad(`${at}.views`, 'is another device than the first frame', 'Compare frames of one device in a screen');
          const compare = frames.length > 1;
          if (compare || Object.hasOwn(f, 'area')) {
            const r = f.area, AREA = 'Set "area" to the changed part as fractions of the picture, such as {"x":0,"y":0.8,"w":1,"h":0.12}';
            if (!r) throw bad(`${at}.area`, 'is required: outline what changed on each frame', AREA);
            one(`${at}.area`, r, ['x', 'y', 'w', 'h'], '{"x":0,"y":0.8,"w":1,"h":0.12}');
            if (!['x', 'y', 'w', 'h'].every((c) => typeof r[c] === 'number' && r[c] >= 0 && r[c] <= 1) || !(r.w > 0 && r.h > 0) || r.x + r.w > 1.001 || r.y + r.h > 1.001) throw bad(`${at}.area`, 'must be x, y, w and h from 0 to 1 that stay inside the picture', AREA);
          }
          if (compare || Object.hasOwn(f, 'caption')) {
            text(`${at}.caption`, f.caption, 90, 'what changed in this frame, in one line of 90 characters or fewer');
            if (/\n/.test(f.caption)) throw bad(`${at}.caption`, 'has more than one line', 'Name what changed in one line');
            plain(`${at}.caption`, f.caption);
          }
        });
        if (!roles.includes(m.accepts)) throw bad(`${p}.frames`, `has no ${m.accepts} frame, which Yes approves`, `Add the ${m.accepts} frame to every screen, or set "accepts" to a role every screen has`);
      });
    });
    if (two) return { kind: m.kind, schema: m.schema };
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
  if (Object.hasOwn(m, 'guard') && !GUARDS.includes(m.guard)) throw bad('guard', `${show(m.guard)} is not one of ${GUARDS.join(', ')}`, `Set ${named('guard', flags)} to why only the person may answer it (${GUARDS.join(', ')}), or leave it out`);
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
  if (Object.hasOwn(m, 'report')) {
    if (!isKey(m.report)) throw bad('report', 'must be 1-128 of A-Z a-z 0-9 . _ -', `Set ${named('report', flags)} to the key of a report on the board that this ask is about, such as ${flags ? '--report audit-plan' : '"audit-plan"'}`);
    if (m.report === m.key) throw bad('report', 'is this ask\'s own key', 'Name the report the ask is about, not the ask');
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
/** Words for agents in a text a person reads, the first one found: an id word (above), a long hyphened slug (a task or branch name such as
 * signoff-phone-designs-access), a pull request (PR, #265), a slice, an agent or ticket code (Lead4821, RL-02), a file name or a commit. */
export function jargon(text: string): string | undefined {
  const word = text.split(/\s+/).map((w) => w.replace(/^[^\w#]+|[^\w]+$/g, '')).find((w) => idWord(w) || /^[a-z0-9]+(?:-[a-z0-9]+){3,}$/.test(w));
  return word || text.match(/\bPRs?\b|#\d+\b|\b[Ss]lices?\b|\b[A-Z][a-z]+\d{3,}\b|\b[A-Z]{2,}-\d+\b|[\w.-]+\.(?:png|jpe?g|webp|svg|html?|jsonl?|[mc]js|ts|md|ya?ml)\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/)?.[0];
}
const JARGON_HELP = 'refused: task and branch names, PR or #number, slice, agent or ticket codes such as Lead4821 or RL-02, file names and commits';
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
/** The gallery frames of a guided report or plan, in the order the board counts them for `gallery.<n>`: each section's options, each option's frames. */
export const galleryFrames = (m: any): { device?: string; src: string; sha256?: string; bytes?: number }[] => [...(m?.sections ?? []).flatMap((s: any) => (s.gallery ?? []).flatMap((o: any) => o.frames)), ...(m?.sections ?? []).flatMap((s: any) => s.pins ?? [])];
/** The files a section's blocks name, each once, in the order the blocks use them. */
export const blockFiles = (s: any): string[] => [...new Set<string>((s?.blocks ?? []).flatMap((b: any) => b.type === 'beats' ? b.beats.map((x: any) => x.image) : b.type === 'video' ? [b.poster, b.src] : b.type === 'compare' ? [b.before.image, b.after.image] : b.type === 'evidence' ? b.rows.map((r: any) => r.image).filter(Boolean) : []))];
const SAME_WORDS = 0.75;
/** What the kit warns about, never refuses: a lead whose first sentence says again (most of its words are in) what the report's summary already said, so the reader reads it twice. */
export function kitWarnings(m: any): string[] {
  if (!guided(m)) return [];
  const words = (t: unknown) => new Set(String(t ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const first = (t: unknown) => String(t ?? '').split(/(?<=[.!?])\s/)[0];
  const same = (a: unknown, b: unknown) => { const x = words(first(a)), y = words(first(b)); return x.size >= 5 && y.size >= 5 && [...x].filter((w) => y.has(w)).length / Math.min(x.size, y.size) >= SAME_WORDS; };
  const leads: [string, string][] = [['visual.text', m.visual?.text], ...(m.sections ?? []).slice(0, 1).map((s: any, n: number): [string, string] => [`sections[${n}].body`, s.body])].filter(([, t]) => t);
  return leads.filter(([, t]) => same(m.about, t)).map(([f]) => `${f} says again what "about" already says; the reader reads it twice. Keep "about" as the summary and start ${f} with what it does not say`);
}
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
  // The files a section's blocks name are pinned as a section's "pins", each path once; they are checked and pinned below with the gallery frames.
  for (const sec of m.sections ?? []) { const files = blockFiles(sec); if (files.length) sec.pins = files.map((src) => ({ src })); else delete sec.pins; }
  // A gallery frame or block file is an image or a page of 5 MB or less (a video, 50 MB), inside the folder; it is pinned the same way.
  for (const f of galleryFrames(m)) {
    const bad = (rule: string, help: string) => new ContractError(`${at}gallery frame ${show(f.src)} ${rule}`, help);
    let real;
    try { real = realpathSync(resolve(root, f.src)); } catch { throw bad('is not there', `Put the file at ${f.src} from the board file's folder, or fix the path`); }
    const rel = relative(root, real);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw bad('leads outside the board file\'s folder', 'Copy the file into the board file\'s folder, such as under gallery/');
    const info = statSync(real);
    const video = KIT_VIDEO.test(f.src);
    if (!info.isFile() || info.size > (video ? MEDIA_BYTES : 5_000_000)) throw bad(video ? 'must be a file of 50 MB or less' : 'must be a file of 5 MB or less', video ? 'Render the film smaller' : 'Save the screenshot again at the device\'s own width (390 or 1280)');
    try { accessSync(real, constants.R_OK); } catch { throw bad('cannot be read', 'Make the file readable, then post again'); }
    const file = readFileSync(real);
    f.sha256 = createHash('sha256').update(file).digest('hex');
    f.bytes = file.length;
  }
}

/** The longest a block of plain text on a report page may run: about five lines on a phone. */
const BLOCK_CHARS = 240;
/** A report's or plan's page, and a report's picture, from `base`, the board file's folder: each a file of 5 MB or less
 * whose real path stays inside that folder, and a page filled in the ladder shape the scaffold gives. The first broken rule throws. */
export function reportPage(m: any, base: string, fresh = false): void {
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
  // The look rules bind a report posted for the first time: one already on the board is shown as it was filed, and is re-rendered through the kit instead.
  if (fresh) {
    const colours = ownColours(html);
    if (colours.length > 2) throw bad(`${page} draws its own colour palette (${colours.slice(0, 4).join(', ')}${colours.length > 4 ? ', ...' : ''}), but the board owns the colours`, KIT_HELP);
    const nested = nestedCard(html);
    if (nested) throw bad(`${page} puts a card inside a card (${nested}), but the board draws one level of card at most`, KIT_HELP);
  }
  // A block is one paragraph or list item; about five lines on a phone is the most a reader takes in at once.
  const long = [...html.matchAll(/<(p|li|dd|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((b) => b[2].replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim())
    .find((t) => [...t].length > BLOCK_CHARS);
  if (long) throw bad(`${page} has a block of ${[...long].length} characters, over ${BLOCK_CHARS} (about five lines on a phone): "${[...long].slice(0, 40).join('')}..."`, 'Split it, cut it, or show it as a picture or step');
}
