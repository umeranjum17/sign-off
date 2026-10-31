// The board's layout lint, run inside the page: it returns one line per fault in what is on screen under `scope` (the whole page by default).
// An icon beside its label sits a spacing token away (4, 8, 12 or 16 px) and on the label's first line's centre; a header's icon, label and buttons share one centre line;
// a tap target in a header is at least 44 px; nothing runs past the screen's edge or its scroller; no text is clipped: a heading shows in full and no line is cut at its foot.
export const GAPS = [4, 8, 12, 16];
export const lint = (scope = 'body', heads = '.sh-head') => `(() => {
  const root = document.querySelector(${JSON.stringify(scope)}); if (!root) return ['nothing on screen matches ${scope}'];
  const out = [], W = document.documentElement.clientWidth, box = (e) => e.getBoundingClientRect(), r1 = (n) => Math.round(n * 10) / 10;
  const shown = (e) => { const r = box(e), c = getComputedStyle(e); return r.width > 1 && r.height > 1 && c.visibility !== 'hidden' && !e.closest('[hidden], [aria-hidden="true"]:not(svg)'); };
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
  // The first line of words inside an element, in reading order.
  const lineOf = (e) => { for (const n of e.childNodes) { if (n.nodeType === 3 && n.textContent.trim()) { const g = document.createRange(); g.selectNodeContents(n); return g.getClientRects()[0]; }
    if (n.nodeType === 1 && n.textContent.trim() && shown(n)) return lineOf(n); } return null; };
  const icon = (e) => e.matches('svg, img, .ui-icon, .glyph, .icon') && !e.textContent.trim();
  // An icon's ink: its own box and everything drawn inside it, so a fill that spills out of its tile counts where it is painted.
  const ink = (e) => [...e.querySelectorAll('*')].filter((k) => box(k).width > 0 && getComputedStyle(k).visibility !== 'hidden').map(box).reduce((a, b) => ({ left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) }), box(e));
  const els = [root, ...root.querySelectorAll('*')].filter(shown);
  for (const e of els) {
    const c = getComputedStyle(e), r = box(e);
    // Overflow: past the screen, or past a scroller that clips it (a row inside its own scroll box is fine).
    const scrolls = (a) => /auto|scroll|hidden|clip/.test(getComputedStyle(a).overflowX);
    let a = e.parentElement; while (a && a !== document.body && !scrolls(a)) a = a.parentElement;
    if ((!a || a === document.body) && c.position !== 'fixed' && (r.right > W + 0.5 || r.left < -0.5)) out.push('overflow ' + name(e) + ' spans ' + r1(r.left) + '-' + r1(r.right) + ' on a ' + W + 'px screen');
    // Truncation: a heading cut short, text clipped without an ellipsis, or a line box cut at its foot.
    if (e.firstChild && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
      const hid = /hidden|clip/.test(c.overflowX + c.overflowY), wide = e.scrollWidth > e.clientWidth + 1, tall = e.scrollHeight > e.clientHeight + 1 && c.webkitLineClamp === 'none';
      if (e.matches('h1, h2, h3, [id$="title"]') && hid && (wide || tall)) out.push('truncated heading ' + name(e) + ' "' + e.textContent.trim().slice(0, 40) + '"');
      else if (hid && wide && c.textOverflow !== 'ellipsis') out.push('clipped text ' + name(e) + ' "' + e.textContent.trim().slice(0, 40) + '"');
      else if (hid && tall && c.whiteSpace !== 'nowrap') out.push('cut at the foot ' + name(e) + ' "' + e.textContent.trim().slice(0, 40) + '"');
    }
    // An icon and the label after it: the gap on the token scale, the icon on the label's first line's centre.
    if (/flex|grid/.test(c.display)) for (const k of e.children) {
      const n = k.nextElementSibling; if (!n || !icon(k) || !shown(k) || !shown(n) || icon(n) || !n.textContent.trim()) continue;
      const ki = ink(k), line = lineOf(n); if (!line) continue;
      // A tile beside a block of lines (a row's title over its meta) sits on the block's centre; beside one label, on its line's.
      const nb = box(n), gap = r1(line.left - ki.right), c = (ki.top + ki.bottom) / 2, mid = r1(Math.abs(c - (nb.top + nb.height / 2)) < 1 ? 0 : c - (line.top + line.height / 2));
      if (!${JSON.stringify(GAPS)}.some((g) => Math.abs(gap - g) <= 0.5)) out.push('icon gap ' + gap + 'px off the scale: ' + name(k) + ' before ' + name(n));
      if (Math.abs(mid) > 1) out.push('icon ' + mid + 'px off its label line: ' + name(k) + ' beside ' + name(n));
    }
  }
  // A header's parts: each on the centre line of its row (a header may wrap to a second row), each control a 44 px target.
  for (const h of root.querySelectorAll(${JSON.stringify(heads)})) if (shown(h)) {
    const parts = [...h.children].filter(shown).map((k) => { const t = k.matches('a, button') ? k : k.querySelector(':scope > summary, :scope > a, :scope > button') ?? k, kr = box(t), b = icon(t) ? ink(t) : kr;
      const line = icon(t) || t.matches('a, button, summary') ? { top: b.top, height: b.bottom - b.top } : lineOf(t) ?? kr; return { k, t, kr, line, row: box(k) }; });
    for (const p of parts) {
      const row = parts.filter((q) => q.row.top < p.row.bottom && q.row.bottom > p.row.top), ctr = (Math.min(...row.map((q) => q.row.top)) + Math.max(...row.map((q) => q.row.bottom))) / 2;
      if (Math.abs(p.line.top + p.line.height / 2 - ctr) > 1) out.push('baseline ' + name(p.t) + ' centre ' + r1(p.line.top + p.line.height / 2 - ctr) + 'px off its header row');
      if (p.t.matches('a, button, summary') && (p.kr.width < 43.5 || p.kr.height < 43.5)) out.push('tap target ' + name(p.t) + ' ' + r1(p.kr.width) + 'x' + r1(p.kr.height));
    }
  }
  return [...new Set(out)];
})()`;
