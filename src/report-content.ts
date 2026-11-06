// The content gate for a new report: a plan must show its slices, a measured number and each risk's mitigation, and say what it has, never where it is kept;
// a research report must show its sources, its counts and its pick. Plain text rules, no model: a reader can predict the verdict from the file.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { ContractError } from './contract.js';

/** One part of a report as the reader sees it: its heading, its words, and the entries (list items, table rows or guided items) it lists. */
type Section = { heading: string; text: string; part?: string; entries: Entry[] };
/** One listed entry: its words, whether the page numbers it (an ordered list), and the size a guided item carries in its own field. */
type Entry = { text: string; numbered: boolean; size?: string };
type Miss = { rule: string; said: string; fix: string };

const NUMBER_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';
const URL = /https?:\/\/[^\s<>"')\]]+/gi;
/** A size: a time ("2 days", "half a day", "3-4 hours") or a T-shirt size (S, M, L, XL). */
const SIZE = /\b\d+(?:\.\d+)?\s*(?:(?:-|to)\s*\d+(?:\.\d+)?\s*)?(?:minutes?|mins?|hours?|hrs?|days?|weeks?|wks?)\b|\bhalf an? (?:day|hour)\b|\b(?:XS|S|M|L|XL)\b/;
/** An acceptance check: the words a slice uses to say how it is proved done. */
const CHECK = /\b(?:done when|accepted? when|acceptance|passes when|proved by|proof|verified by|checked by|tests?|checks?)\b/i;
/** An order: the entry starts with its number or its place in the sequence. */
const ORDER = /^\s*(?:\d+\s*[.):]|(?:slice|step|phase|stage)\s+\d+|(?:first|second|third|fourth|fifth|then|next|last|finally)\b)/i;
/** A mitigation: the words a risk uses to say what stops it, softens it or undoes it. */
const MITIGATION = /\b(?:mitigat\w+|rollback|roll back|rolled back|fall ?back|revert\w*|undo|guard\w*|safeguard\w*|prevent\w*|recover\w*|protects?|contained by)\b/i;
/** Where a section says its content is kept instead of showing it. */
const POINTS = [
  /\b(?:kept|stored|saved|recorded|held|filed|attached|written|listed|documented)\s+(?:with|in|on|at|under|by)\s+(?:this|the|that|our|a|an)\b/i,
  /\bsee\s+(?:the\s+)?(?:details|below|above|attached|appendix|record|plan|ticket|notes|docs?|document|thread|link)\b/i,
  /\b(?:in|on)\s+the\s+(?:record|ticket|notes|appendix|thread|repo|plan file)\b/i,
  /\b(?:available|provided|shared|sent)\s+(?:on|upon)\s+request\b|\bon request\b|\bask (?:me\s+)?for (?:it|them|details|the)\b/i,
  /\b(?:details|numbers|results|runs|costs?|slices?|list|steps)\s+(?:are|is)\s+(?:elsewhere|in a separate|not shown|not included)\b/i,
];
const PICK_HEAD = /\b(?:recommend\w*|pick|verdict|conclusion|my call|our call)\b/i;
const PICK_SAID = /\b(?:i|we)\s+(?:recommend|pick|picked|chose|choose|suggest)\b|\b(?:the|my|our) pick\b\s*:?|\b(?:recommendation|verdict)\s*:/i;
const COUNT = new RegExp(`\\b(?:\\d+|${NUMBER_WORDS})\\s+(?:[\\w$-]+\\s+){0,2}(?:sources?|options?|candidates?|alternatives?|tools?|services?|products?|projects?|repos?|libraries|packages?|issues?|reports?|tests?|runs?|samples?|papers?|interviews?|users?|cases?|sites?|pages?|results?|reviews?|participants?|sessions?|measurements?|responses?|files?|messages?|sign-ins?|devices?)\\b`, 'i');
/** The limit of reading a page: words a script writes and numbers drawn in a picture are not in the page's text. */
const PAGE_LIMIT = 'A page report is read as its text: words a script writes into the page and numbers drawn inside a picture are not read, so state each in the page text';

const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const plain = (html: string) => decode(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** The sections of a guided report: each section's heading, lead and items, and the report's own lead, so nothing the reader sees is left out. */
function guidedSections(m: any): Section[] {
  const words = (v: any): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(words).join(' ') : v && typeof v === 'object' ? Object.values(v).map(words).join(' ') : '');
  const sections: Section[] = (m.sections ?? []).map((s: any) => ({
    heading: s.heading ?? '', part: s.part,
    text: [s.body, ...(s.items ?? []).map((i: any) => [i.title, i.text, i.more, i.size, i.link].filter(Boolean).join(' ')), words(s.details), words(s.blocks)].filter(Boolean).join(' '),
    entries: (s.items ?? []).map((i: any) => ({ text: [i.title, i.text, i.more, i.size].filter(Boolean).join(' '), numbered: false, size: i.size })),
  }));
  const lead = [m.title, m.about, words(m.understood), words(m.visual), words(m.next)].filter(Boolean).join(' ');
  return [{ heading: '', text: lead, entries: [] }, ...sections];
}

/** The sections of a page report: the text between its headings (h1 to h6, and a Details summary), with its list items and table rows as entries. */
function pageSections(html: string): Section[] {
  const body = html.replace(/<head\b[\s\S]*?<\/head>/i, ' ').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ');
  const heads = [...body.matchAll(/<(h[1-6]|summary)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  const cut = (heading: string, from: number, to: number): Section => {
    const part = body.slice(from, to), entries: Entry[] = [];
    for (const list of part.matchAll(/<(ol|ul)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      for (const li of list[2].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) entries.push({ text: plain(li[1]), numbered: list[1].toLowerCase() === 'ol' });
    }
    for (const row of part.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => plain(c[1]));
      if (cells.length) entries.push({ text: cells.join(' '), numbered: /^\d+$/.test(cells[0]) });
    }
    return { heading, text: plain(part), entries };
  };
  const out = [cut('', 0, heads[0]?.index ?? body.length)];
  heads.forEach((h, n) => out.push(cut(plain(h[2]), h.index! + h[0].length, heads[n + 1]?.index ?? body.length)));
  return out;
}

/** The numbers a report states: figures other than a link, a date, a version, a leading list number or a size. */
function figures(text: string): string[] {
  const bare = text.replace(URL, ' ').replace(/\b\d{4}-\d{2}-\d{2}(?:T[\d:]+Z?)?\b/g, ' ').replace(/\bv?\d+(?:\.\d+){2,}\b/g, ' ');
  return [...bare.matchAll(/(?<![\w./#-])(\$?\d[\d,]*(?:\.\d+)?)(%|\s*[A-Za-z]+)?/g)].map((x) => x[0].trim());
}

const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean);
const clip = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

/** The rules a plan report breaks. */
function planMisses(sections: Section[]): Miss[] {
  const misses: Miss[] = [];
  const slices = sections.find((s) => s.part === 'slices') ?? sections.find((s) => /\b(?:slices?|steps?|milestones?|phases?|build order|work plan)\b/i.test(s.heading) && s.entries.length);
  if (!slices || !slices.entries.length) {
    misses.push({ rule: 'plan-slices', said: 'no visible slice list: no section lists the slices of the build', fix: 'Add a "Slices" section that lists each slice as its own item: "1. Name - size - done when ..."' });
  } else {
    const lack = (what: string, ok: (e: Entry) => boolean) => {
      const bad = slices.entries.filter((e) => !ok(e));
      if (bad.length) misses.push({ rule: 'plan-slices', said: `${bad.length} of ${slices.entries.length} slices lack their ${what}: "${clip(bad[0].text)}"`, fix: `Give every slice its ${what}` });
    };
    lack('size (such as "S, half a day" or "2 days")', (e) => !!e.size || SIZE.test(e.text));
    lack('acceptance check (write "done when ..." or "proof: ...")', (e) => CHECK.test(e.text));
    lack('order (start it with "1.", "2." or "Slice 1")', (e) => e.numbered || ORDER.test(e.text));
  }
  // A measured number is a figure outside the slice list and outside the sizes: a time, a count, a cost or a rate that was run or counted.
  const outside = sections.filter((s) => s !== slices && s.part !== 'estimate' && !/^(?:time|estimate|schedule|timeline)\b/i.test(s.heading)).map((s) => `${s.heading} ${s.text}`).join(' ');
  if (!figures(outside).length) {
    misses.push({ rule: 'plan-measured', said: 'states no measured number: no figure outside the slice list and the time estimate', fix: 'State what you measured with its number and unit, such as "12 bots used 8 GB of 16 GB" or "a run took 4 minutes"' });
  }
  for (const s of sections) {
    if (!s.heading && !s.text) continue;
    const point = sentences(s.text).filter((x) => POINTS.some((p) => p.test(x)));
    if (!point.length) continue;
    const rest = sentences(s.text).filter((x) => !point.includes(x)).join(' ');
    if (!s.entries.length && !figures(rest).length) {
      misses.push({ rule: 'plan-pointer', said: `section ${JSON.stringify(s.heading || 'lead')} only points elsewhere ("${clip(point[0], 110)}") and shows no number, list or table`, fix: 'Put the content in the section, or delete the section; never write where it is kept' });
    }
  }
  for (const s of sections.filter((x) => x.part === 'risks' || /\brisks?\b/i.test(x.heading))) {
    const own = s.entries.length ? s.entries : [{ text: s.text, numbered: false }];
    const bad = own.filter((e) => !MITIGATION.test(e.text));
    if (bad.length) misses.push({ rule: 'plan-risk', said: `${bad.length} risk${bad.length > 1 ? 's' : ''} in ${JSON.stringify(s.heading)} without a mitigation: "${clip(bad[0].text)}"`, fix: 'After each risk write what stops it or undoes it: "Mitigation: ..." or "Rollback: ..."' });
  }
  return misses;
}

/** The rules a research report breaks. */
function researchMisses(sections: Section[], hrefs: string[]): Miss[] {
  const misses: Miss[] = [];
  const all = sections.map((s) => `${s.heading} ${s.text}`).join(' ');
  const links = new Set([...hrefs, ...(all.match(URL) ?? [])].map((u) => u.replace(/[.,;]+$/, '')));
  if (links.size < 3) misses.push({ rule: 'research-sources', said: `names ${links.size} source link${links.size === 1 ? '' : 's'}, under 3`, fix: 'List at least 3 sources, each with the https link where it can be read' });
  if (!COUNT.test(all)) misses.push({ rule: 'research-counts', said: 'states no count of what was looked at (sources, options, runs, issues)', fix: 'Say how many you looked at, such as "5 services compared" or "3 sources read"' });
  const pick = sections.some((s) => (s.part === 'recommendation' || PICK_HEAD.test(s.heading)) && s.text.split(/\s+/).length >= 3) || PICK_SAID.test(all);
  if (!pick) misses.push({ rule: 'research-pick', said: 'names no pick', fix: 'Add a "Recommendation" section that names the one option you pick and why' });
  return misses;
}

/** Reads a report's page from the folder its message sits in, as the board does: a file inside that folder. */
function readPage(m: any, base: string): string {
  const root = realpathSync(base);
  let real;
  try { real = realpathSync(resolve(root, m.view)); } catch { throw new ContractError(`view ${JSON.stringify(m.view)} is not there`, `Put the page at ${m.view} from the message file's folder`); }
  const rel = relative(root, real);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) || !statSync(real).isFile()) throw new ContractError(`view ${JSON.stringify(m.view)} leads outside the message file's folder`, 'Copy the page into that folder');
  return readFileSync(real, 'utf8');
}

/** Holds a new plan or research report to its content rules; the first post of a key only (the caller says so). Throws one ContractError naming every rule broken. */
export function reportContent(m: any, base: string): void {
  if (m?.kind !== 'report' || !['plan', 'research'].includes(m.purpose)) return;
  const page = !Array.isArray(m.sections), html = page ? readPage(m, base) : '';
  const sections = page ? pageSections(html) : guidedSections(m);
  const hrefs = page ? [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']?(https?:\/\/[^\s"'>]+)/gi)].map((x) => x[1]) : [];
  const misses = m.purpose === 'plan' ? planMisses(sections) : researchMisses(sections, hrefs);
  if (!misses.length) return;
  const at = typeof m.key === 'string' ? `key ${m.key}: ` : '';
  const shape = page ? 'page' : 'guided';
  throw new ContractError(`${at}a new ${m.purpose} report (${shape}) breaks ${misses.length} content rule${misses.length > 1 ? 's' : ''}: ${misses.map((x) => `[${x.rule}] ${x.said}`).join('; ')}`,
    `${misses.map((x) => x.fix).join('. ')}.${page ? ` ${PAGE_LIMIT}.` : ''} Then post again; a report already on the board is not held to this`);
}
