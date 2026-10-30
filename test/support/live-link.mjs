// The check every design card's Open live passes: it is that option's own prototype page, never the reference URL kept beside it.
// One definition, so the card, the full-screen bar and every test hold a live link to the same rule.
// `prototype` is the URL the board serves that option's mock at: /mock/<pass>/<key>~<value>/<file>, with its variant when the mock reads one.
export function liveLinkVerdict({ key, value, reference, live, prototype }) {
  if (!live) return `no Open live under ${key}~${value}`;
  if (reference && live === reference) return `Open live is the reference, ${key}~${value}`;
  return live === prototype ? '' : `Open live is not ${key}~${value}: ${live}`;
}
