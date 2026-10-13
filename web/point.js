// The pointing bridge: the board adds it to each design mock page it serves and turns it on for that frame.
// While on, a press in the mock does nothing of its own, and a click is named to the board as `ref`, a path to that element, with its `tag` and `text`.
// Whatever finds `ref` again must check `tag` and `text`, and show nothing when they differ. A revision that keeps the same tag and words at the same path can still match another element.
// window.signOffFind({ ref, tag, text }) gives back the element that reference finds, or null, on the mock page itself too.
(() => {
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
  if (parent === window) return;
  let on = false;
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
  parent.postMessage({ 'sign-off': 'ready' }, '*');
})();
