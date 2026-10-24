/** The look rules for a page an agent writes for a report (report schema 2, `--page`): the board owns the palette and the card, so a page that brings its own is refused. */

const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;
const PLAIN = new Set(['#fff', '#ffffff', '#000', '#000000']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const CONTROLS = new Set(['button', 'summary', 'input', 'select', 'textarea', 'kbd', 'code', 'pre', 'th', 'td', 'img', 'video', 'canvas']);

/** The CSS a page declares: its style blocks and its style attributes, with comments gone. */
function css(html: string): string {
  const blocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const inline = [...html.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[1] ?? m[2]);
  return [...blocks, ...inline].join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The colours a page writes out by hand (a hex, rgb, hsl and the like), black and white aside; one accent is a choice, three or more are a palette. */
export function ownColours(html: string): string[] {
  const seen = new Set<string>();
  for (const [c] of css(html).matchAll(COLOUR)) {
    const v = c.toLowerCase();
    if (v.endsWith('(') || !PLAIN.has(v)) seen.add(v);
  }
  return [...seen];
}

/** A length in a border-radius that rounds a box into a card: 8 px or more. A percentage is a circle or a pill, never a card. */
function rounded(value: string): boolean {
  return [...value.matchAll(/(\d*\.?\d+)(px|rem|em)\b/g)].some((m) => parseFloat(m[1]) * (m[2] === 'px' ? 1 : 16) >= 8);
}

/** The compounds (a tag, .class or #id, joined) of the CSS rules that draw a card: round corners with a fill, an edge or a shadow. */
function cardRules(sheet: string): string[] {
  const out: string[] = [];
  for (const [, selectors, body] of sheet.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const d = new Map([...body.matchAll(/([a-z-]+)\s*:\s*([^;]+)/gi)].map((m) => [m[1].toLowerCase(), m[2].trim()] as const));
    const radius = [...d].some(([k, v]) => /^border(-\w+)*-radius$/.test(k) && rounded(v));
    const drawn = [...d].some(([k, v]) => (k === 'box-shadow' && v !== 'none') || (/^border(-top|-right|-bottom|-left)?$/.test(k) && !/^(0|none)\b/.test(v)) || (/^background(-color)?$/.test(k) && !/^(none|transparent|inherit)\b/.test(v)));
    if (!radius || !drawn) continue;
    for (const s of selectors.split(',')) {
      const last = s.trim().split(/[\s>+~]+/).pop() ?? '';
      if (last && !last.includes(':') && !CONTROLS.has(last)) out.push(last);
    }
  }
  return out;
}

/** A card inside a card: the first element drawn as one that sits in another, as "section.panel in .wrap", or undefined when there is none. */
export function nestedCard(html: string): string | undefined {
  const cards = cardRules(css(html));
  if (!cards.length) return undefined;
  const is = (tag: string, attrs: string, compound: string) => {
    const t = /^[a-z][a-z0-9]*/i.exec(compound)?.[0], id = /#([\w-]+)/.exec(compound)?.[1];
    const want = [...compound.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
    const have = (/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs) ?? []).slice(1).join(' ').split(/\s+/);
    return (!t || t.toLowerCase() === tag) && (!id || new RegExp(`\\sid\\s*=\\s*["']?${id}["'\\s>]`, 'i').test(attrs + ' ')) && want.every((w) => have.includes(w));
  };
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<svg\b[\s\S]*?<\/svg>/gi, '<svg></svg>');
  const stack: { tag: string; card?: string }[] = [];
  for (const [, close, name, attrs] of body.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const tag = name.toLowerCase();
    if (close) {
      const at = stack.map((s) => s.tag).lastIndexOf(tag);
      if (at >= 0) stack.length = at;
      continue;
    }
    if (VOID.has(tag) || attrs.endsWith('/')) continue;
    const card = cards.find((c) => is(tag, ' ' + attrs, c));
    const outer = card && stack.find((s) => s.card);
    if (outer) return `${card} in ${outer.card}`;
    stack.push({ tag, card });
  }
  return undefined;
}
