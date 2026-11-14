// A board is data on a report: shapes on grid cells, arrows by shape id, zones around shapes, steps that name what to frame.
// One place holds its geometry and its rules, so the page draws and the post-time check measures the same numbers.

/** The cell and shape sizes a board's drawing uses: a shape is one cell wide, and a shape's label fits inside it. */
export const CELL_W = 190, CELL_H = 70, CELL_X = 310, CELL_Y = 170, PAD = 6, FONT = 18, MOVE_FONT = 14, CHAR = 0.52;
export const COLUMNS = 12, ROWS = 24, SHAPES_MAX = 150, ARROWS_MAX = 300, ZONES_MAX = 12, STEPS_MAX = 12;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A board that does not match: the field inside the board, what is wrong, and the one line that says how to fix it. */
export type BoardFault = { ok: false; field: string; problem: string; fix: string };
/** A board that passed: what it holds, for the report it is part of. */
export type BoardFacts = { ok: true; form: 'shapes' | 'mermaid'; shapes?: number; arrows?: number; lines?: number; zones?: number; steps?: number };

const boxOf = (s: any) => ({ x: s.at[0] * CELL_X, y: s.at[1] * CELL_Y, w: CELL_W, h: CELL_H });
const centre = (b: { x: number; y: number; w: number; h: number }) => [b.x + b.w / 2, b.y + b.h / 2];
const hits = (a: any, b: any) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Where the centre line from box a to box b leaves box a. */
const leave = (a: any, b: any, pad = PAD) => {
  const [ax, ay] = centre(a), [bx, by] = centre(b), dx = bx - ax, dy = by - ay;
  const t = Math.min(dx ? (a.w / 2 + pad) / Math.abs(dx) : Infinity, dy ? (a.h / 2 + pad) / Math.abs(dy) : Infinity);
  return [ax + dx * t, ay + dy * t];
};
/** Does the segment p to q pass through box b? */
const through = (p: number[], q: number[], b: any, pad = 4) => {
  const x = b.x - pad, y = b.y - pad, w = b.w + 2 * pad, h = b.h + 2 * pad, dx = q[0] - p[0], dy = q[1] - p[1];
  let t0 = 0, t1 = 1;
  for (const [pp, qq] of [[-dx, p[0] - x], [dx, x + w - p[0]], [-dy, p[1] - y], [dy, y + h - p[1]]]) {
    if (pp === 0) { if (qq < 0) return false; } else { const t = qq / pp; if (pp < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t); if (t0 > t1) return false; }
  }
  return true;
};

/** A line between two shapes and where its label sits: arrows that run between the same two shapes share one line, whose label lists their names. */
export const lines = (board: any): any[] => {
  const shape = new Map<string, any>((board.shapes ?? []).map((s: any) => [s.id, s])), pairs = new Map<string, any>();
  for (const a of board.arrows ?? []) {
    if (!shape.has(a.from) || !shape.has(a.to)) continue;
    const k = [a.from, a.to].sort().join('|'), p = pairs.get(k) ?? { a: a.from, b: a.to, ids: [], there: [], back: [], dashed: false };
    p.ids.push(a.id);
    // A line is dashed when any arrow it carries is dashed, so a move that is not as drawn never shows as one that is.
    p.dashed = p.dashed || a.style === 'dashed';
    (a.from === p.a ? p.there : p.back).push(a.label ?? '');
    pairs.set(k, p);
  }
  return [...pairs.values()].map((p) => {
    const [x1, y1] = leave(boxOf(shape.get(p.a)), boxOf(shape.get(p.b))), [x2, y2] = leave(boxOf(shape.get(p.b)), boxOf(shape.get(p.a)));
    // A label sits at the middle of its line, where the editor puts the label of an arrow.
    const text = [...new Set([...p.there, ...p.back].filter(Boolean))].join(' · '), w = text.length * MOVE_FONT * CHAR + 10, h = MOVE_FONT * 1.35;
    const lx = x1 + (x2 - x1) / 2, ly = y1 + (y2 - y1) / 2;
    return { ...p, x1, y1, x2, y2, text, label: text ? { x: lx - w / 2, y: ly - h / 2, w, h } : null };
  });
};
/** A zone's box: the box of its shapes plus a margin. Its label sits at the box's top left corner. */
const zoneBox = (board: any, z: any) => {
  const bs = z.around.map((id: string) => boxOf(board.shapes.find((s: any) => s.id === id))), x = Math.min(...bs.map((b: any) => b.x)) - 24, y = Math.min(...bs.map((b: any) => b.y)) - 34;
  return { x, y, w: Math.max(...bs.map((b: any) => b.x + b.w)) + 24 - x, h: Math.max(...bs.map((b: any) => b.y + b.h)) + 24 - y };
};
const zoneLabelBox = (board: any, z: any) => { const b = zoneBox(board, z); return { x: b.x + 10, y: b.y + 6, w: z.label.length * MOVE_FONT * CHAR + 6, h: MOVE_FONT * 1.35 }; };
/** A label's lines inside its shape: one line when it fits, two when it can break at a space or hyphen. Null when it cannot fit. */
const labelLines = (label: string) => {
  const room = (CELL_W - 20) / (FONT * CHAR);
  if (label.length <= room) return [label];
  for (let i = Math.min(label.length - 1, Math.floor(room)); i > 0; i--) if (/[ -]/.test(label[i - 1]) && label.length - i <= room) return [label.slice(0, i).trim(), label.slice(i).trim()];
  return null;
};
const fail = (field: string, problem: string, fix: string): BoardFault => ({ ok: false, field, problem, fix });

/** Every id a board uses, of shapes, arrows and zones alike: the one namespace a mark names things by. */
export const boardIds = (board: any): string[] => [...(board?.shapes ?? []), ...(board?.arrows ?? []), ...(board?.zones ?? [])].map((x: any) => x?.id).filter((id: any) => typeof id === 'string');

/** The post-time check: the first rule broken, with the one line that says how to fix it. `retired` is every id an earlier version of this board removed. */
export function checkBoard(board: any, retired: string[] = []): BoardFault | BoardFacts {
  if (!board || typeof board !== 'object' || Array.isArray(board)) return fail('board', 'must be an object', 'Write the board as {"title":"...","shapes":[...],"arrows":[...]}');
  const known = ['title', 'shapes', 'arrows', 'zones', 'steps', 'mermaid'];
  for (const k of Object.keys(board)) if (!known.includes(k)) return fail(k, 'is not a field of a board', `Remove "${k}"; a board has ${known.join(', ')}`);
  if (typeof board.title !== 'string' || !board.title.trim() || board.title.length > 80) return fail('title', 'must be text of 1 to 80 characters', 'Name the board in 80 characters or fewer');
  if (board.mermaid !== undefined) {
    for (const k of ['shapes', 'arrows', 'zones']) if (board[k] !== undefined) return fail(k, 'cannot stand beside "mermaid"', 'Give the board either "mermaid" text or "shapes" and "arrows", never both');
    if (typeof board.mermaid !== 'string' || !board.mermaid.trim() || board.mermaid.length > 8000) return fail('mermaid', 'must be Mermaid text of 1 to 8,000 characters', 'Shorten the diagram or split it over two boards');
    return { ok: true, form: 'mermaid' };
  }
  const shapes = board.shapes, arrows = board.arrows ?? [], zones = board.zones ?? [], steps = board.steps ?? [];
  if (!Array.isArray(shapes) || shapes.length < 1 || shapes.length > SHAPES_MAX) return fail('shapes', `must list 1 to ${SHAPES_MAX} shapes`, 'Split a larger drawing over two boards');
  if (!Array.isArray(arrows) || arrows.length > ARROWS_MAX) return fail('arrows', `must list ${ARROWS_MAX} arrows at most`, 'Split the drawing over two boards');
  if (!Array.isArray(zones) || zones.length > ZONES_MAX) return fail('zones', `must list ${ZONES_MAX} zones at most`, `Keep the ${ZONES_MAX} zones that matter`);
  if (!Array.isArray(steps) || steps.length > STEPS_MAX) return fail('steps', `must list ${STEPS_MAX} steps at most`, `Tell the board in ${STEPS_MAX} steps or fewer`);
  const ids = new Map<string, string>(), cells = new Map<string, string>();
  const only = (o: any, at: string, fields: string[]) => { for (const k of Object.keys(o)) if (!fields.includes(k)) return fail(`${at}.${k}`, 'is not a field there', `Remove "${k}"; the fields are ${fields.join(', ')}`); return null; };
  const idOk = (id: any, at: string) => {
    if (typeof id !== 'string' || !ID.test(id)) return fail(`${at}.id`, 'must be 1 to 40 of a-z, 0-9 and -', 'Give it a short id such as "ready-to-land"');
    if (ids.has(id)) return fail(`${at}.id`, `repeats "${id}", which ${ids.get(id)} already uses`, 'Give every shape, arrow and zone its own id');
    if (retired.includes(id)) return fail(`${at}.id`, `"${id}" was removed in an earlier version of this board`, 'Use a new id: a removed id never comes back, so an old mark never lands on a new shape');
    ids.set(id, at);
    return null;
  };
  for (const [n, s] of shapes.entries()) {
    const at = `shapes[${n}]`, bad = only(s, at, ['id', 'label', 'at', 'kind', 'tone', 'note']) ?? idOk(s.id, at);
    if (bad) return bad;
    if (typeof s.label !== 'string' || !s.label.trim() || s.label.length > 40) return fail(`${at}.label`, 'must be text of 1 to 40 characters', 'Shorten the label; put the rest in "note"');
    if (!labelLines(s.label)) return fail(`${at}.label`, `"${s.label}" does not fit its shape`, `Shorten it to ${Math.floor((CELL_W - 20) / (FONT * CHAR))} characters, or add a space or hyphen so it can take two lines`);
    if (!Array.isArray(s.at) || s.at.length !== 2 || !Number.isInteger(s.at[0]) || !Number.isInteger(s.at[1]) || s.at[0] < 0 || s.at[0] >= COLUMNS || s.at[1] < 0 || s.at[1] >= ROWS) return fail(`${at}.at`, `must be [column 0-${COLUMNS - 1}, row 0-${ROWS - 1}]`, 'Place the shape on a grid cell such as [2, 1]');
    const cell = s.at.join(',');
    if (cells.has(cell)) return fail(`${at}.at`, `puts "${s.id}" on the cell of "${cells.get(cell)}"`, 'Give every shape its own cell');
    cells.set(cell, s.id);
    if (s.kind !== undefined && !['box', 'round', 'diamond', 'note'].includes(s.kind)) return fail(`${at}.kind`, 'must be box, round, diamond or note', 'Leave "kind" out for a plain box');
    if (s.tone !== undefined && !['start', 'end', 'ok', 'warn', 'bad'].includes(s.tone)) return fail(`${at}.tone`, 'must be start, end, ok, warn or bad', 'Leave "tone" out for a plain shape');
    if (s.note !== undefined && (typeof s.note !== 'string' || !s.note.trim() || s.note.length > 160)) return fail(`${at}.note`, 'must be text of 1 to 160 characters', 'Say it in 160 characters or fewer');
  }
  const shape = new Map<string, any>(shapes.map((s: any) => [s.id, s]));
  for (const [n, a] of arrows.entries()) {
    const at = `arrows[${n}]`, bad = only(a, at, ['id', 'from', 'to', 'label', 'note', 'style']) ?? idOk(a.id, at);
    if (bad) return bad;
    for (const end of ['from', 'to']) if (!shape.has(a[end])) return fail(`${at}.${end}`, `names "${a[end]}", which is not a shape of this board`, `Set "${end}" to the id of a shape, or add that shape`);
    if (a.from === a.to) return fail(`${at}.to`, 'is the shape the arrow starts from', 'Say a move that stays in one state in that shape\'s "note"');
    if (a.label !== undefined && (typeof a.label !== 'string' || !a.label.trim() || a.label.length > 30)) return fail(`${at}.label`, 'must be text of 1 to 30 characters', 'Name the move in 30 characters or fewer');
    if (a.style !== undefined && !['solid', 'dashed'].includes(a.style)) return fail(`${at}.style`, 'must be solid or dashed', 'Leave "style" out for a solid arrow');
    if (a.note !== undefined && (typeof a.note !== 'string' || !a.note.trim() || a.note.length > 160)) return fail(`${at}.note`, 'must be text of 1 to 160 characters', 'Say it in 160 characters or fewer');
  }
  for (const [n, z] of zones.entries()) {
    const at = `zones[${n}]`, bad = only(z, at, ['id', 'label', 'around']) ?? idOk(z.id, at);
    if (bad) return bad;
    if (typeof z.label !== 'string' || !z.label.trim() || z.label.length > 40) return fail(`${at}.label`, 'must be text of 1 to 40 characters', 'Name the zone in 40 characters or fewer');
    if (!Array.isArray(z.around) || z.around.length < 1 || z.around.length > 24) return fail(`${at}.around`, 'must list 1 to 24 shape ids', 'List the shapes the zone surrounds');
    for (const id of z.around) if (!shape.has(id)) return fail(`${at}.around`, `names "${id}", which is not a shape of this board`, 'List only ids of shapes on this board');
    const zb = zoneBox(board, z), inZone = (s: any) => { const [cx, cy] = centre(boxOf(s)) as number[]; return cx > zb.x && cx < zb.x + zb.w && cy > zb.y && cy < zb.y + zb.h; };
    const inside = shapes.find((s: any) => !z.around.includes(s.id) && inZone(s));
    if (inside) return fail(`${at}.around`, `surrounds "${inside.id}", which the zone does not list`, `Add "${inside.id}" to the zone, or move it out of the zone's cells`);
  }
  // Geometry: no line through a third shape, no label on a shape or on another label, no line across a zone's label, and no label longer than its line.
  const ls = lines(board);
  for (const l of ls) for (const s of shapes) if (s.id !== l.a && s.id !== l.b && through([l.x1, l.y1], [l.x2, l.y2], boxOf(s)))
    return fail(`arrows "${l.ids[0]}"`, `runs from "${l.a}" to "${l.b}" through the shape "${s.id}"`, `Move "${s.id}" off the line between them, or place "${l.a}" and "${l.b}" on neighbouring cells`);
  for (const [i, l] of ls.entries()) {
    if (!l.label) continue;
    const on = shapes.find((s: any) => hits(l.label, boxOf(s)));
    if (on) return fail(`arrows "${l.ids[0]}"`, `has the label "${l.text}", which covers the shape "${on.id}"`, 'Shorten the label, or leave more cells between the two shapes');
    const other = ls.slice(0, i).find((m) => m.label && hits(l.label, m.label));
    if (other) return fail(`arrows "${l.ids[0]}"`, `has the label "${l.text}", which covers the label "${other.text}"`, 'Shorten one of the two labels, or move one of the shapes so the lines spread');
  }
  for (const [n, z] of zones.entries()) {
    const box = zoneLabelBox(board, z), line = ls.find((l) => through([l.x1, l.y1], [l.x2, l.y2], box, 0));
    if (line) return fail(`arrows "${line.ids[0]}"`, `runs across the label "${z.label}" of the zone "${z.id}"`, `Shorten the zone's label, or move its shapes so no line crosses the label at its corner`);
  }
  for (const l of ls) {
    if (!l.label) continue;
    const along = Math.abs(l.x2 - l.x1) > Math.abs(l.y2 - l.y1) ? l.label.w : l.label.h, free = Math.round(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) - along);
    if (free < 0) {
      const room = Math.floor(l.text.length + free / (MOVE_FONT * CHAR));
      return fail(`arrows "${l.ids[0]}"`, `has the label "${l.text}", which is longer than its line by ${-free} units, so the editor draws it on two lines`, `Shorten the label to ${Math.max(1, room)} characters, or place "${l.a}" and "${l.b}" further apart`);
    }
  }
  for (const [n, st] of steps.entries()) {
    const at = `steps[${n}]`, bad = only(st, at, ['title', 'text', 'focus']);
    if (bad) return bad;
    if (typeof st.title !== 'string' || !st.title.trim() || st.title.length > 80) return fail(`${at}.title`, 'must be text of 1 to 80 characters', 'Name the step in 80 characters or fewer');
    if (st.text !== undefined && (typeof st.text !== 'string' || !st.text.trim() || st.text.length > 240)) return fail(`${at}.text`, 'must be text of 1 to 240 characters', 'Say the step in 240 characters or fewer');
    if (!Array.isArray(st.focus) || st.focus.length < 1 || st.focus.length > 12) return fail(`${at}.focus`, 'must list 1 to 12 ids', 'Name the shapes the step frames');
    for (const id of st.focus) if (!ids.has(id)) return fail(`${at}.focus`, `names "${id}", which is not on this board`, 'List only ids of shapes, arrows or zones on this board');
  }
  return { ok: true, form: 'shapes', shapes: shapes.length, arrows: arrows.length, lines: ls.length, zones: zones.length, steps: steps.length };
}

/** A shape's fill by its tone: the canvas draws light colours and the editor inverts them for dark, as every other page colour. */
const TONE: Record<string, string> = { start: '#b2f2bb', end: '#d0bfff', ok: '#b2f2bb', warn: '#ffec99', bad: '#ffc9c9' };
const SHAPE_OF: Record<string, string> = { round: 'ellipse', diamond: 'diamond' };

/** A step's words, and the elements the canvas frames for it: the ids a step names, as the scene's own element ids. */
export type BoardStep = { title: string; text?: string; ids: string[] };
/** The canvas scene of a board: its geometry as absolute boxes and lines in the editor's own skeleton form, plus each step's frame. */
export function scene(board: any) {
  const ids = new Map<string, string[]>();
  const add = (id: string, ...elements: string[]) => ids.set(id, [...(ids.get(id) ?? []), ...elements]);
  const zones = (board.zones ?? []).flatMap((z: any) => {
    const box = zoneBox(board, z), label = zoneLabelBox(board, z);
    add(z.id, `z:${z.id}`, `zl:${z.id}`);
    return [
      { type: 'rectangle', id: `z:${z.id}`, x: box.x, y: box.y, width: box.w, height: box.h, strokeStyle: 'dashed', strokeColor: '#868e96', backgroundColor: 'transparent', strokeWidth: 1, roughness: 0 },
      { type: 'text', id: `zl:${z.id}`, x: label.x, y: label.y, width: label.w, height: label.h, text: z.label, fontSize: MOVE_FONT, strokeColor: '#868e96' },
    ];
  });
  const shapes = board.shapes.map((s: any) => {
    const b = boxOf(s);
    add(s.id, s.id);
    return { type: SHAPE_OF[s.kind] ?? 'rectangle', id: s.id, x: b.x, y: b.y, width: CELL_W, height: CELL_H, roundness: { type: 3 },
      backgroundColor: s.kind === 'note' ? '#fff3bf' : TONE[s.tone] ?? '#a5d8ff', fillStyle: 'solid', label: { text: labelLines(s.label)!.join('\n'), fontSize: FONT } };
  });
  const arrows = lines(board).map((l) => {
    for (const id of l.ids) add(id, `l:${l.a}|${l.b}`);
    return { type: 'arrow', id: `l:${l.a}|${l.b}`, x: l.x1, y: l.y1, width: l.x2 - l.x1, height: l.y2 - l.y1, points: [[0, 0], [l.x2 - l.x1, l.y2 - l.y1]],
      start: { id: l.a }, end: { id: l.b }, startArrowhead: l.back.length ? 'arrow' : null, endArrowhead: 'arrow', strokeStyle: l.dashed ? 'dashed' : 'solid',
      ...(l.text ? { label: { text: l.text, fontSize: MOVE_FONT } } : {}) };
  });
  const steps: BoardStep[] = (board.steps ?? []).map((s: any) => ({ title: s.title, ...(s.text ? { text: s.text } : {}), ids: s.focus.flatMap((id: string) => ids.get(id) ?? []) }));
  return { elements: [...zones, ...shapes, ...arrows], steps, title: board.title as string };
}

/** The board as a picture for the report it sits on: the scene the canvas draws, as one SVG of plain boxes, lines and words.
 *  It is a picture, not the editor — one request, no script — and it measures the board with the same geometry the page and the check use,
 *  so the preview, the canvas and the check cannot disagree. Its paper is paper in either theme, as a whiteboard is, so the block never has to be
 *  redrawn when the board's light or dark is flipped. `width` and `height` are the picture's own size, so a page reserves its room before it loads. */
export function preview(board: any): string {
  const pal = { paper: '#ffffff', ink: '#1d1d1f', line: '#6b7280', mute: '#4b5563', head: '#5f6672' };
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const { elements } = scene(board), parts: string[] = [], room = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (x: number, y: number, w: number, h: number) => { room[0] = Math.min(room[0], x); room[1] = Math.min(room[1], y); room[2] = Math.max(room[2], x + w); room[3] = Math.max(room[3], y + h); };
  /** Words centred on a point, one line to each line of the label, so a shape's two-line label sits inside it. */
  const words = (text: string, cx: number, cy: number, size: number, fill: string) => {
    const lines = text.split('\n'), lh = size * 1.3, first = cy - ((lines.length - 1) * lh) / 2 + size * 0.35;
    return lines.map((line, i) => `<text x="${cx}" y="${first + i * lh}" text-anchor="middle" font-size="${size}" fill="${fill}">${esc(line)}</text>`).join('');
  };
  /** The head of an arrow at a point, pointing away from the other end. */
  const head = (x: number, y: number, dx: number, dy: number) => {
    const len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, s = 11, w = 5;
    return `<path d="M${x} ${y}L${x - ux * s - uy * w} ${y - uy * s + ux * w}L${x - ux * s + uy * w} ${y - uy * s - ux * w}Z" fill="${pal.head}"/>`;
  };
  for (const e of elements) {
    grow(e.x, e.y, e.width, e.height);
    const label = (e as any).label;
    // A zone is the scene's own `z:` box and its `zl:` words; every other element is a shape or a line.
    if (String(e.id).startsWith('z:')) {
      parts.push(`<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="8" fill="none" stroke="${pal.line}" stroke-width="1.5" stroke-dasharray="7 6"/>`);
    } else if (String(e.id).startsWith('zl:')) {
      parts.push(`<text x="${e.x}" y="${e.y + 14 * 1.15}" font-size="14" fill="${pal.mute}">${esc((e as any).text)}</text>`);
    } else if (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond') {
      const fill = (e as any).backgroundColor;
      const paint = e.type === 'ellipse'
        ? `<ellipse cx="${e.x + e.width / 2}" cy="${e.y + e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}" fill="${fill}"/>`
        : e.type === 'diamond'
          ? `<polygon points="${e.x + e.width / 2},${e.y} ${e.x + e.width},${e.y + e.height / 2} ${e.x + e.width / 2},${e.y + e.height} ${e.x},${e.y + e.height / 2}" fill="${fill}"/>`
          : `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="6" fill="${fill}"/>`;
      parts.push(paint + (label ? words(label.text, e.x + e.width / 2, e.y + e.height / 2, label.fontSize, pal.ink) : ''));
    } else if (e.type === 'arrow') {
      const x2 = e.x + e.width, y2 = e.y + e.height;
      parts.push(`<line x1="${e.x}" y1="${e.y}" x2="${x2}" y2="${y2}" stroke="${pal.line}" stroke-width="1.5"${(e as any).strokeStyle === 'dashed' ? ' stroke-dasharray="7 6"' : ''}/>`);
      parts.push(head(x2, y2, e.width, e.height));
      if ((e as any).startArrowhead) parts.push(head(e.x, e.y, -e.width, -e.height));
      if (label) {
        const cx = e.x + e.width / 2, cy = e.y + e.height / 2, w = label.text.length * label.fontSize * 0.52 + 6;
        grow(cx - w / 2, cy - label.fontSize * 0.9, w, label.fontSize * 1.8);
        parts.push(`<rect x="${cx - w / 2}" y="${cy - label.fontSize * 0.75}" width="${w}" height="${label.fontSize * 1.5}" rx="3" fill="${pal.paper}"/>`);
        parts.push(words(label.text, cx, cy, label.fontSize, pal.mute));
      }
    }
  }
  const pad = 12, w = Math.round(room[2] - room[0] + pad * 2), h = Math.round(room[3] - room[1] + pad * 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${room[0] - pad} ${room[1] - pad} ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(board.title)}">`
    + `<rect x="${room[0] - pad}" y="${room[1] - pad}" width="${w}" height="${h}" fill="${pal.paper}"/>`
    + `<g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">${parts.join('')}</g></svg>`;
}
