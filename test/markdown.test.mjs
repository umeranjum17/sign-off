// The board's markdown renderer for authored text (web/app.js, between BEGIN markdown and END markdown), run on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const src = /\/\/ BEGIN markdown\n([\s\S]*?)\/\/ END markdown/.exec(page)[1].replace(/^\s*const (?:mdSpan|mdDiv|NOLINK) .*$/gm, '');
const { mdInline, mdBlock, mdShort } = new Function(`${src}\nreturn { mdInline, mdBlock, mdShort };`)();

const unescape = (h) => h.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

test('inline marks become code, bold, emphasis and short links', () => {
  const h = mdInline('Run `npm test` for **both** *quickly*, see https://github.com/acme/widgets/issues/42 and news.ycombinator.com/item?id=50133401 or example.com/a/b.');
  assert.match(h, /<code>npm test<\/code>/);
  assert.match(h, /<strong>both<\/strong>/);
  assert.match(h, /<em>quickly<\/em>/);
  assert.match(h, /data-short="widgets #42"/);
  assert.match(h, /data-short="HN 50133401"/);
  assert.match(h, /data-short="example.com"/);
  assert.match(h, /href="https:\/\/example.com\/a\/b"/);
  assert.equal(mdShort('https://github.com/acme/widgets'), 'acme/widgets');
  assert.equal(mdShort('https://www.apple.com/newsroom/x'), 'apple.com');
});

test('unsafe input never becomes raw HTML', () => {
  for (const evil of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', '**<b>x</b>**', '`<u>x</u>`', '[click](javascript:alert(1))', '[a](https://x.test/"onmouseover="alert(1))', '<a href="javascript:alert(1)">x</a>']) {
    for (const h of [mdInline(evil), mdBlock(evil), mdBlock(`- ${evil}`), mdBlock(`\`\`\`\n${evil}\n\`\`\``)]) {
      const tags = [...h.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase());
      assert.deepEqual(tags.filter((t) => !['span', 'code', 'strong', 'em', 'a', 'p', 'ul', 'ol', 'li', 'pre'].includes(t)), [], h);
      assert.doesNotMatch(h, /<(?:script|img|svg|b|u)\b/i, h);
      assert.doesNotMatch(h, /<[^>]*\son[a-z]+=/i, h);
      assert.doesNotMatch(h, /href="javascript:/i, h);
    }
  }
  assert.doesNotMatch(mdInline('[click](javascript:alert(1))'), /<a /);
  assert.match(mdInline('<script>alert(1)</script>'), /^&lt;script&gt;alert\(1\)&lt;\/script&gt;$/);
  const link = mdInline('[a](https://x.test/"onmouseover="alert(1))');
  assert.equal([...link.matchAll(/<a /g)].length <= 1, true);
  assert.doesNotMatch(link, /"onmouseover=/);
});

test('blocks render lists and fenced code, one paragraph per line', () => {
  const h = mdBlock('First line\nSecond line\n- one\n- **two**\n3. three\n```js\nconst a = 1 < 2;\n```');
  assert.equal([...h.matchAll(/<p>/g)].length, 2);
  assert.match(h, /<ul><li>.*one<\/li>\n<li>.*<strong>two<\/strong>.*<\/li><\/ul>\n<ol start="3">/s);
  assert.match(h, /<ol start="3">/);
  assert.match(h, /<pre class="gd-code">.*<code>const a = 1 &lt; 2;<\/code>.*<\/pre>/s);
});

test('every raw character stays in the page, so selection offsets still match', () => {
  for (const raw of ['plain', 'Run `npm test` for **both** *quickly*', 'see https://github.com/acme/widgets/pull/9, then [docs](https://example.com/docs)', 'a < b && "c" <script>', '- a\n- b\n\n1. c\n2. d\nend', 'x\n```\ncode\n```\ny', '```\n```', '```\nopen fence']) {
    assert.equal(unescape(mdBlock(raw)), raw, raw);
    assert.equal(unescape(mdInline(raw)), raw, raw);
  }
});
