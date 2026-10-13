// The pointing bridge: the board adds it to each design mock page it serves and turns it on for that frame.
// While on, a press in the mock does nothing of its own, and a click is named to the board as `ref`, a path to that element, with its `tag` and `text`.
// Whatever finds `ref` again must check `tag` and `text`, and show nothing when they differ, so a revised mock never marks the wrong element.
// window.signOffFind({ ref, tag, text }) gives back the element that reference finds, or null, on the mock page itself too.
(() => {
  const words = (e) => (e.getAttribute('aria-label') || e.getAttribute('alt') || e.getAttribute('placeholder') || e.innerText || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const find = ({ ref: path, tag, text }) => {
    let e;
    try { e = document.querySelector(path); } catch { return null; }
    return e && e.localName === tag && words(e) === text ? e : null;
  };
  window.signOffFind = find;
  if (parent === window) return;
  let on = false;
  const ref = (e) => {
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
  parent.postMessage({ 'sign-off': 'ready' }, '*');
})();
