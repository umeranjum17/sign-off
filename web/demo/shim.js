// sign-off demo shim: served only by the static demo build (never by the
// local server). It stands in for the board's API routes in the browser:
// seed items come from window.SIGN_OFF_DEMO_SEED, taps are saved to
// localStorage, and media/mock frames are rewritten to static files listed
// in window.SIGN_OFF_DEMO_FILES. The board page itself is untouched.
(() => {
  'use strict';
  const SEED = window.SIGN_OFF_DEMO_SEED;
  const FILES = window.SIGN_OFF_DEMO_FILES || {};
  const DIGEST = window.SIGN_OFF_DEMO_DIGEST || 'v1';
  if (!SEED) return;
  const KEY = `sign-off-demo-${DIGEST}`;
  const clone = (v) => JSON.parse(JSON.stringify(v));

  // Saved taps, kept in this browser only.
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) ?? {};
    } catch {
      return {};
    }
  };
  const saved = load();
  const state = () => ({
    file: 'demo',
    mockBase: SEED.mockBase,
    decisions: SEED.decisions,
    readonly: false,
    answers_only: false,
    answers: saved.answers ?? {},
    seen: [],
    rounds: saved.rounds ?? [],
    messages: saved.messages ?? [],
    annotations: saved.annotations ?? [],
    dismissed: saved.dismissed ?? [],
  });
  const keep = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        answers: saved.answers ?? {},
        dismissed: saved.dismissed ?? [],
        messages: saved.messages ?? [],
        rounds: saved.rounds ?? [],
        annotations: saved.annotations ?? [],
      }));
    } catch {}
  };
  const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const rid = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');

  const ok = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const err = (status, message) => new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } });
  const decision = (key) => SEED.decisions.find((d) => d.key === key);

  async function api(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'GET' && url === '/api/board') return ok({ file: 'demo', pid: 0 });
    if (method === 'GET' && url === '/api/decisions') return ok(state());
    if (method !== 'POST') return err(404, 'Not found');
    let body = {};
    try {
      body = JSON.parse(init.body ?? '{}');
    } catch {
      return err(400, 'Send JSON');
    }
    if (url === '/api/answers') {
      const { key, answer, note = '' } = body;
      const d = decision(key);
      if (answer === '') {
        // Undo back to unanswered: the item waits again.
        if (saved.answers) delete saved.answers[key];
        keep();
        agentView();
        return ok(state());
      }
      const other = d && (d.reply || d.options.length) ? [{ value: 'text', label: 'Reply' }] : [];
      const option = d?.options.find((o) => o.value === answer) ?? other.find((o) => o.value === answer);
      if (!d || !option) return err(404, 'This question is no longer in the file');
      if (answer === 'text' && !String(note).trim() && !d.options.some((o) => o.value === 'text')) return err(400, 'Write the reply first');
      saved.answers ??= {};
      const current = saved.answers[key];
      const clean = String(note).trim();
      if (current?.answer === option.value && (current.note ?? '') === clean) return ok(state());
      saved.answers[key] = { key, answer: option.value, label: option.label, close: d.close, at: now(), ...(clean && { note: clean }) };
      keep();
      agentView();
      return ok(state());
    }
    if (url === '/api/dismiss') {
      const { keys, dismissed } = body;
      if (!Array.isArray(keys) || !keys.length || typeof dismissed !== 'boolean') return err(400, 'Send 1 to 200 keys and dismissed true or false');
      saved.dismissed ??= [];
      saved.dismissed = [...new Set(dismissed ? [...saved.dismissed, ...keys] : saved.dismissed.filter((k) => !keys.includes(k)))];
      keep();
      return ok(state());
    }
    if (url === '/api/messages') {
      const { kind, key, text } = body;
      if (kind !== 'comment' && kind !== 'prompt') return err(400, 'Send a comment or a prompt');
      if (typeof text !== 'string' || !text.trim()) return err(400, 'Write it first');
      saved.messages ??= [];
      saved.messages.push({ id: rid(), kind, ...(key && { key }), text: text.trim(), at: now() });
      keep();
      return ok(state());
    }
    if (url === '/api/rounds') {
      const { key, note = '' } = body;
      if (!decision(key)) return err(404, 'This question is no longer in the file');
      if (!String(note).trim()) return err(400, 'Write a note first: another round needs your comment');
      saved.rounds ??= [];
      saved.rounds.push({ key, note: String(note).trim(), at: now() });
      keep();
      return ok(state());
    }
    if (url === '/api/annotations') {
      const { id, deleted } = body;
      saved.annotations ??= [];
      if (deleted === true) {
        saved.annotations = saved.annotations.filter((a) => a.id !== id);
        keep();
        return ok(state());
      }
      const { key, mock, ref, tag, words, text, hash } = body;
      if (!decision(key)) return err(404, 'This mock is no longer on the board');
      if (typeof text !== 'string' || !text.trim()) return err(400, 'Write the comment first');
      const found = id !== undefined && saved.annotations.find((a) => a.id === id);
      const row = { id: found?.id ?? rid(), key, mock, hash, ref, tag, words, text: text.trim(), at: now() };
      saved.annotations = [...saved.annotations.filter((a) => a.id !== row.id), row];
      keep();
      return ok(state());
    }
    return err(404, 'Not found');
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('/api/')) return api(url, typeof input === 'string' ? init : { ...init, method: input.method, body: init?.body });
    return realFetch(input, init);
  };

  // Static files for captures and mock frames: the page asks for /api/media
  // and /mock/... URLs, which a static host cannot serve, so point them at
  // the files the demo build copied next to this page.
  function map(url) {
    if (FILES[url]) return FILES[url];
    const [path, query] = url.split('?');
    if (FILES[path]) return FILES[path] + (query ? `?${query}` : '');
    return null;
  }
  function sweep(root = document) {
    for (const e of root.querySelectorAll('img[src^="/"],video[src^="/"],iframe[src^="/"],a[href^="/"]')) {
      const attr = e.hasAttribute('src') ? 'src' : 'href';
      const to = map(e.getAttribute(attr));
      if (to && e.getAttribute(attr) !== to) e.setAttribute(attr, to);
    }
  }
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes' && m.target instanceof Element) sweep(m.target.parentElement ?? document);
      for (const n of m.addedNodes) if (n instanceof Element) sweep(n);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href'] });

  // The demo bar and the agent view: demo-only controls above the real board.
  const css = document.createElement('style');
  css.textContent = `#demo-bar{margin:1rem 0 0;padding:.625rem .875rem;border:1px dashed var(--border);border-radius:.75rem;background:var(--surface);display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .75rem;font-size:.875rem;color:var(--muted)}#demo-bar>*{min-width:0}#demo-bar b{color:var(--text)}#demo-bar button{min-height:2.25rem;padding:0 .875rem;border-radius:999px;font-size:.875rem}#demo-answers{margin:.5rem 0 0;flex-basis:100%;min-width:0;max-width:100%}#demo-answers summary{color:var(--accent);font-weight:600;min-height:2rem;font-size:.875rem}#demo-answers pre{margin:.25rem 0 0;padding:.625rem .75rem;border-radius:.5rem;background:var(--sunk);font-size:.8125rem;white-space:pre-wrap;overflow-wrap:anywhere}`;
  document.head.append(css);
  const bar = document.createElement('div');
  bar.id = 'demo-bar';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset demo';
  reset.setAttribute('aria-label', 'Reset the demo answers');
  reset.onclick = () => {
    try {
      localStorage.removeItem(KEY);
    } catch {}
    location.reload();
  };
  const box = document.createElement('details');
  box.id = 'demo-answers';
  const pre = document.createElement('pre');
  pre.id = 'demo-answers-out';
  pre.setAttribute('aria-live', 'polite');
  box.append(Object.assign(document.createElement('summary'), { textContent: 'Agent view: saved answers' }), pre);
  const lead = document.createElement('span');
  lead.innerHTML = '<b>Demo board.</b> Answers stay in this browser.';
  bar.append(lead, reset, box);
  document.querySelector('main')?.prepend(bar);

  // What an agent would read back: the saved answers in the CLI's shape.
  function agentView() {
    const rows = Object.values(saved.answers ?? {}).sort((a, b) => a.at.localeCompare(b.at));
    pre.textContent = rows.length
      ? `answers[${rows.length}]{key,answer,at}:\n${rows.map((a) => `  ${a.key},${a.answer},"${a.at}"`).join('\n')}`
      : 'No answers yet — tap an answer above.';
  }
  agentView();
  sweep();
})();
