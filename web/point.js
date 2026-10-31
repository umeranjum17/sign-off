// The pointing bridge: the board adds it to each design mock page it serves and turns it on for that frame.
// While on, a press in the mock does nothing of its own, and a click is named to the board as `ref`, a path to that element, with its `tag` and `text`.
// Whatever finds `ref` again must check `tag` and `text`, and show nothing when they differ. A revision that keeps the same tag and words at the same path can still match another element.
// window.signOffFind({ ref, tag, text }) gives back the element that reference finds, or null, on the mock page itself too.
(() => {
  // A report's page is told the board's light or dark before anything else: the page's ground and ink, and what a word that does not read is set to.
  let paper = null, ink = null, watch = 0;
  // An element's words are its text nodes joined with a space, so a container's children don't run together.
  const words = (e) => {
    if (e === document.body || e === document.documentElement) return '';
    const all = [], walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) all.push(walk.currentNode.data);
    return all.join(' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  };
  const find = ({ ref: path, tag, text }) => {
    let e;
    try { e = document.querySelector(path); } catch { return null; }
    return e && e.localName === tag && words(e) === text ? e : null;
  };
  window.signOffFind = find;
  // A report's own page draws in the board's light or dark, at the board's ink and ground, not the system's: the board says which on the frame's
  // address (`?report=1&theme=`) and again as `{'sign-off':'theme', theme, ink, ground}` when the person flips it. The page's scheme and each of its
  // prefers-color-scheme rules follow that pick, so Canvas and CanvasText are the board's ground and ink. A page that then paints a word in the
  // colour it sits on (white on white, black on black) has that word set to whichever of the board's ink or ground reads against what is behind it,
  // so no report leaves a blank block where its words are. Only a report's page: a design mock and a drawing keep the colours their author chose.
  const query = new URLSearchParams(location.search), told = query.get('report') === '1' ? query.get('theme') : null;
  // The theme pass is never allowed to take the rest of this bridge down with it: a page that cannot be read for its colours still points and still
  // reports its height, so a frame never waits on a `ready` that a colour lookup stopped.
  if (told === 'light' || told === 'dark') { try { board(told); } catch (e) { console.warn('sign-off: the page kept its own colours', e); } }
  if (parent === window) return;
  let on = false, touch;
  const navigate = (key) => parent.postMessage({ 'sign-off': 'viewer-nav', key }, '*');
  addEventListener('keydown', (e) => {
    if (!e.target.closest?.('textarea, input, select, [contenteditable]') && !e.ctrlKey && !e.metaKey && !e.altKey && ['ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key)) navigate(e.key);
  });
  addEventListener('touchstart', (e) => { touch = e.touches[0]; }, { passive: true });
  addEventListener('touchend', (e) => {
    const end = e.changedTouches[0];
    if (touch && Math.abs(end.clientX - touch.clientX) > 60 && Math.abs(end.clientX - touch.clientX) > Math.abs(end.clientY - touch.clientY) * 1.5) navigate(end.clientX < touch.clientX ? 'ArrowRight' : 'ArrowLeft');
    touch = null;
  }, { passive: true });
  const ref = (e) => {
    if (e === document.documentElement) return 'html';
    const path = [];
    for (; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      if (e.id && document.querySelectorAll(`#${CSS.escape(e.id)}`).length === 1) return [`#${CSS.escape(e.id)}`, ...path].join(' > ');
      let n = 1;
      for (let s = e.previousElementSibling; s; s = s.previousElementSibling) n += s.localName === e.localName;
      path.unshift(`${e.localName}:nth-of-type(${n})`);
    }
    return ['body', ...path].join(' > ');
  };
  addEventListener('message', (m) => {
    if (m.source === parent && m.data?.['sign-off'] === 'point') on = m.data.on === true;
    if (m.source === parent && m.data?.['sign-off'] === 'theme') { try { board(m.data.theme, m.data.ink, m.data.ground); } catch (e) { console.warn('sign-off: the page kept its own colours', e); } }
    if (m.source === parent && m.data?.['sign-off'] === 'size') {
      // The document reader owns scrolling; its frame follows the entire content height.
      document.documentElement.style.overflow = 'hidden';
      const size = () => parent.postMessage({ height: document.documentElement.scrollHeight }, '*');
      new ResizeObserver(size).observe(document.body); size();
    }
  });
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) addEventListener(type, (m) => {
    if (!on) return;
    m.preventDefault();
    m.stopImmediatePropagation();
    if (type === 'click') parent.postMessage({ 'sign-off': 'pointed', ref: ref(m.target), tag: m.target.localName, text: words(m.target) }, '*');
  }, true);
  for (const type of ['touchstart', 'touchend']) addEventListener(type, (m) => {
    if (on) m.stopImmediatePropagation();
  }, { capture: true, passive: true });
  /** The board's pick for this page: its scheme, its ink and its ground, and then every word that does not read set to one that does. */
  function board(theme, inkValue, ground) {
    if (theme !== 'light' && theme !== 'dark') return;
    const rgb = (c) => {
      const text = String(c ?? '').trim(), hex = /^#([\da-f]{3,8})$/i.exec(text)?.[1], rgba = /^rgba?\(([^)]+)\)$/.exec(text)?.[1];
      const p = hex ? (hex.length < 6 ? [...hex.slice(0, 3)].map((d) => parseInt(d + d, 16)) : [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)))
        : rgba ? rgba.split(/[,\s/]+/).filter(Boolean).map(Number) : null;
      return p?.length >= 3 && p.slice(0, 3).every(Number.isFinite) ? { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 } : null;
    };
    const linear = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (c) => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
    const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const css = (c) => `rgb(${[c.r, c.g, c.b].map(Math.round).join(' ')})`;
    document.documentElement.style.colorScheme = theme;
    // Each of the page's prefers-color-scheme rules, from the text it was written with: on for this pick, off for the other.
    const written = new WeakMap(), walk = (r) => (r instanceof CSSMediaRule ? [r, ...[...r.cssRules].flatMap(walk)] : []);
    for (const sheet of document.styleSheets) {
      let rules = [];
      try { rules = [...sheet.cssRules].flatMap(walk); } catch {}
      for (const r of rules) {
        if (!written.has(r)) written.set(r, r.media.mediaText);
        r.media.mediaText = written.get(r).replace(/\(\s*prefers-color-scheme:\s*(dark|light)\s*\)/g, (_, s) => (s === theme ? '(min-width: 0px)' : '(max-width: 0.001px)'));
      }
    }
    // The page's ground and ink as Canvas and CanvasText resolve in that scheme, unless the board named its own tokens' colours.
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;width:0;height:0;background-color:Canvas;color:CanvasText';
    document.body.append(probe);
    paper = rgb(ground) ?? rgb(getComputedStyle(probe).backgroundColor);
    ink = rgb(inkValue) ?? rgb(getComputedStyle(probe).color);
    probe.remove();
    // What a word sits on: the page's ground, then every background painted over it up to the element.
    const behind = (el) => {
      const painted = [];
      for (let e = el; e; e = e.parentElement) { const bg = rgb(getComputedStyle(e).backgroundColor); if (bg && bg.a > 0.001) painted.push(bg); }
      return painted.reverse().reduce((under, bg) => over(bg, under), paper);
    };
    // A word the page paints in the colour it sits on is set to the board's ink or its ground, whichever reads against that.
    const reads = () => {
      if (!paper || !ink) return;
      for (const el of document.querySelectorAll('body *')) {
        // The element that paints a word itself, and no control that is off: a box is judged by the words in it, not by its children's again.
        if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml' || el.closest(':disabled, [aria-disabled="true"]')) continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim())) continue;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity <= 0 || !el.getClientRects().length) continue;
        const bg = behind(el), now = over(rgb(s.color) ?? ink, bg);
        if (ratio(now, bg) >= 4.5) continue;
        const to = ratio(ink, bg) >= ratio(paper, bg) ? ink : paper;
        if (css(to) !== css(now)) el.style.color = css(to);
      }
    };
    let queued = 0;
    const soon = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; reads(); }); };
    // A page that moves under its own script (a step forward, a tab picked) is read again; the observer and the taps are wired once.
    if (!watch) {
      watch = 1;
      new MutationObserver(soon).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'aria-pressed', 'hidden', 'open', 'checked', 'disabled'] });
      addEventListener('click', soon, true);
      addEventListener('load', soon);
    }
    soon();
  }
  parent.postMessage({ 'sign-off': 'ready' }, '*');
})();
