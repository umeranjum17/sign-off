// Fill the initialized scaffold with the corrected BYOKit report content (polish round end state):
// as-of date named, TakeOne spelled right, model quota as a risk line outside the chain.
import { readFileSync, writeFileSync } from 'node:fs';

const page = 'mocks/byokit-plan/index.html';
const card = 'mocks/byokit-plan/preview.svg';
let html = readFileSync(page, 'utf8');
let svg = readFileSync(card, 'utf8');

const rep = (s, from, to) => {
  if (!s.includes(from)) throw new Error(`missing: ${from}`);
  return s.replace(from, to);
};

html = rep(html, '<title>FILL: the report title</title>', '<title>BYOKit runs on your own key</title>');
html = rep(html, 'FILL: the answer in one plain sentence', 'BYOKit runs on your own OpenRouter key.');
html = rep(html, 'FILL: one or two short lines on why it matters to the reader.', 'Your key, your spend, your limits: the plan holds with no middleman.');
html = rep(html, 'As of FILL: the date the facts were true, e.g. 15 Oct. Name a real date, never today or now.', 'As of 15 Oct.');
html = rep(html, 'aria-label="FILL: what the picture shows"', 'aria-label="A shared key becomes your own key"');
html = rep(html, 'FILL: before', 'No key');
html = rep(html, 'FILL: after', 'Your key');
// Real steps in the chain only; the quota concern is a risk line under the chain.
html = rep(html, 'FILL: part one', 'Sign in');
html = rep(html, 'FILL: part two', 'Add your key');
html = rep(html, 'FILL: part three', 'Chat runs');
html = rep(html, 'FILL: one line on how the parts fit.', 'Risk, not a step: model quota may throttle at peak hours.');
html = rep(html, "title: 'FILL: first step', text: 'FILL: what happens, in one line.'", "title: 'Open BYOKit', text: 'Sign in with your TakeOne account; nothing to install.'");
html = rep(html, "title: 'FILL: second step', text: 'FILL: what happens, in one line.'", "title: 'Paste your key', text: 'Your OpenRouter key stays in your browser.'");
html = rep(html, "title: 'FILL: third step', text: 'FILL: what happens, in one line.'", "title: 'Chat', text: 'Pick a model and send the first message.'");
html = rep(html, '<li>FILL: a detail some readers want, in a line or two.</li>', '<li>Model quota is a watch item: if the provider throttles, chats queue. It is a risk, not a step the kit waits on.</li>');
html = rep(html, '<li>FILL: another, or delete this line.</li>', '<li>TakeOne stores nothing: your key stays on your device.</li>');
writeFileSync(page, html);

svg = rep(svg, 'FILL: before', 'No key');
svg = rep(svg, 'FILL: after', 'Your key');
svg = rep(svg, 'FILL: as of the date, e.g. As of 15 Oct', 'Made 15 Oct');
writeFileSync(card, svg);

if (/FILL:/.test(html) || /FILL:/.test(svg)) throw new Error('a FILL line survived');
console.log('filled: no FILL lines left; as-of on page and card:', /As of 15 Oct\./.test(html), /Made 15 Oct/.test(svg));
