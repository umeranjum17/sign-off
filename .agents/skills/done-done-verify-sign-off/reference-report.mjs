// A reference report page (the markdown a report page draws, as the page's own `const MD="..."`) turned into the same report for sign-off: a guided report with
// layout "document", one section per `## ` heading, tables as table blocks and everything else as text blocks, the words and their order unchanged.
// Used by document-reader-shots.mjs to draw one report in both products side by side; it never touches a board itself.
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
const asBlocks = (lines) => {
  const out = []; let text = [], fence = false;
  const flush = () => { let t = text.join('\n').trim(); text = [];
    while (t) { let end = t.length; if (end > 39000) { end = t.lastIndexOf('\n\n', 39000); if (end < 1) end = 39000; } out.push({ type: 'text', text: t.slice(0, end).trim() }); t = t.slice(end).trim(); } };
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) fence = !fence;
    if (!fence && /^\|/.test(lines[i]) && /^\|[\s:|-]+\|?$/.test(lines[i + 1] ?? '')) {
      flush(); const columns = cells(lines[i]), rows = []; i += 2;
      for (; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(cells(lines[i]));
      i--; for (let k = 0; k < rows.length; k += 100) out.push({ type: 'table', columns, rows: rows.slice(k, k + 100) });
    } else text.push(lines[i]);
  }
  flush(); return out;
};
/** The report message for a reference page's html, or null when the page carries no markdown. */
export function reportFromPage(html, { key, filer, project }) {
  const found = /const MD=("(?:[^"\\]|\\.)*");/.exec(html);
  if (!found) return null;
  const lines = JSON.parse(found[1]).split('\n'), parts = [{ h: 'Overview', b: [] }];
  for (const l of lines.slice(1)) { if (/^## /.test(l)) parts.push({ h: l.slice(3), b: [] }); else parts.at(-1).b.push(l); }
  const sections = parts.filter((p) => p.b.join('').trim()).map((p, n) => ({ id: `s${n + 1}`, stage: 'found', heading: p.h.slice(0, 80), body: '', blocks: asBlocks(p.b) }));
  return { contract: 1, kind: 'report', schema: 5, layout: 'document', purpose: 'other', key, filer, project, title: lines[0].replace(/^#\s*/, '').slice(0, 120),
    about: 'The same report as the reference page, with its words and order kept.', filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    actions: { role: 'Reviewer', recommended: 'approve', first_pull_request: '2026-12-01' }, sections };
}
