import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

/** Who works on a ticket, as a Juggernaut task record says it: the owning lead, the live worker, its model and its tool. Nothing is guessed: a value the record does not carry is left out. */
export type Assignee = { lead: string; worker?: string; model?: string; tool?: string; worker_id?: string; live: boolean; tool_logo?: string; model_logo?: string };

/** The tools a record's harness= names: the display name and the mark shipped under web/logos. A harness not here shows as it was written, with the plain placeholder. */
const TOOLS: Record<string, [string, string]> = { claude: ['Claude Code', 'claude-code'], codex: ['Codex', 'codex'], opencode: ['OpenCode', 'opencode'], pi: ['Pi', 'pi'] };
/** The model families a record's model= can name, by the words of its id: how the model reads, and whose mark it carries. Anything else shows as written, with the placeholder. */
const FAMILIES: [RegExp, (m: RegExpExecArray) => string, string][] = [
  [/(?:^|[/-])(opus|sonnet|haiku)(?:-(\d+(?:-\d+)?))?$/i, (m) => `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1).toLowerCase()}${m[2] ? ` ${m[2].replace('-', '.')}` : ''}`, 'anthropic'],
  [/(?:^|\/)deepseek-v(\d+(?:\.\d+)?)-([a-z]+)$/i, (m) => `DeepSeek V${m[1]} ${m[2]![0]!.toUpperCase()}${m[2]!.slice(1)}`, 'deepseek'],
  [/(?:^|\/)minimax-m(\d+(?:\.\d+)?)$/i, (m) => `MiniMax M${m[1]}`, 'minimax'],
  [/(?:^|\/)(gpt-[\w.-]+)$/i, (m) => m[1]!, 'openai'],
];
/** A provider that serves models under its own prefix (`ollama-cloud/qwen3`): when the model's family is not known, the provider's mark stands in for it. */
const PROVIDERS: [RegExp, string][] = [[/^ollama(?:[-_][\w-]+)?\//i, 'ollama']];
const GENERIC = 'generic';
const logo = (name: string) => `/logos/${name}.svg`;
/** A model id as the board reads it: `claude-sonnet-5-5` is Sonnet 5.5; a gpt id keeps its own words; an id it does not know is shown as written. */
export function modelOf(id: string): { label: string; logo: string } {
  for (const [re, label, mark] of FAMILIES) {
    const m = re.exec(id);
    if (m) return { label: label(m), logo: logo(mark) };
  }
  const provider = PROVIDERS.find(([re]) => re.test(id));
  return { label: id, logo: logo(provider ? provider[1] : GENERIC) };
}

/** A task id as a short readable title: `fix-menu-spacing-a0` reads "Fix menu spacing" (a trailing run tag such as -a0 is dropped). A record's own title= is used as written. */
export function workerTitle(id: string, named?: string): string {
  if (named) return named;
  const words = id.replace(/[-_.]+/g, ' ').trim().split(' ');
  if (words.length > 1 && /^[a-z]\d{1,3}$/i.test(words.at(-1)!)) words.pop();
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The `key=value` lines of a task record; a line of another shape is skipped. Lines that name an endpoint as `endpoint:` are kept under that key too. */
function lines(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*)\s*[=:]\s*(.*)$/.exec(line);
    if (m && !out.has(m[1]!)) out.set(m[1]!, m[2]!.trim());
  }
  return out;
}
const read = (path: string) => { try { return readFileSync(path, 'utf8'); } catch { return undefined; } };

/** The folder to read: a leading ~ is the user's home. Undefined when none is named. */
export const homeOf = (named?: string) => {
  const raw = named?.trim();
  if (!raw) return undefined;
  return raw === '~' ? homedir() : raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw;
};

/** The assignee of a ticket from <home>/state/<id>.meta, or undefined when there is no home, no record or no usable id. Read only: it never writes a file and runs nothing.
 * The task is live when its record names an endpoint (window= or endpoint:), no <id>.exit marks it ended, and its last status line is not done or failed. */
export function readAssignee(home: string | undefined, id: string): Assignee | undefined {
  if (!home || !/^[\w.-]{1,128}$/.test(id) || id.startsWith('.')) return undefined;
  const state = join(home, 'state'), meta = read(join(state, `${id}.meta`));
  if (meta === undefined) return undefined;
  const rec = lines(meta), harness = rec.get('harness'), model = rec.get('model');
  const last = (read(join(state, `${id}.status`)) ?? '').split(/\r?\n/).filter(Boolean).at(-1)?.split(/[\s:[]/)[0]?.toLowerCase();
  const live = !!(rec.get('window') || rec.get('endpoint')) && !existsSync(join(state, `${id}.exit`)) && last !== 'done' && last !== 'failed';
  const tool = harness ? TOOLS[harness.toLowerCase()] : undefined, family = model ? modelOf(model) : undefined;
  return {
    lead: rec.get('lead') || rec.get('owner') || (rec.get('project') ? basename(rec.get('project')!.replace(/[\\/]+$/, '')) : '') || (home ? basename(home.replace(/[\\/]+$/, '')) : '') || 'Fleet lead',
    ...(live && { worker: workerTitle(rec.get('endpoint_task_id') || id, rec.get('title')), worker_id: rec.get('endpoint_task_id') || id }),
    ...(family && { model: family.label, model_logo: family.logo }),
    ...(harness && { tool: tool ? tool[0] : harness, tool_logo: logo(tool ? tool[1] : GENERIC) }),
    live,
  };
}
