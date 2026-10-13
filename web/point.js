// The pointing bridge: the board adds it to each design mock page it serves. The board turns it on for one frame;
// then a tap on an element is kept from the mock and named to the board by a reference that finds that element again,
// and the elements the board lists are marked with their numbers. It only ever sends text: the frame has no reach into the board.
(() => {
  if (parent === window) return;
  let on = false, marks = [], hover = null, boxes = [];
  const box = (e, n) => {
    const r = e.getBoundingClientRect(), b = document.createElement('div');
    b.style.cssText = `position:absolute;left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px;box-sizing:border-box;margin:0;`
      + 'border:4px solid #C2410C;border-radius:6px;pointer-events:none;z-index:2147483647;font:700 20px/28px system-ui,sans-serif;color:#fff;text-align:left';
    // The number sits just outside the corner, above the element (below it when there is no room), so it hides none of it.
    if (n) b.append(Object.assign(document.createElement('span'), { textContent: n, style: `position:absolute;left:-4px;${r.top + scrollY < 36 ? 'top' : 'bottom'}:100%;margin:4px 0;padding:0 9px;background:#C2410C;border-radius:6px` }));
    document.documentElement.append(b);
    return b;
  };
  const find = (ref) => { try { return document.querySelector(ref); } catch { return null; } };
  const draw = () => {
    boxes.forEach((b) => b.remove());
    boxes = marks.map((ref, i) => find(ref) && box(find(ref), String(i + 1))).filter(Boolean);
    if (on && hover && hover !== document.body) boxes.push(box(hover));
  };
  // The nearest element with an id of its own anchors the path; every step below it is its tag and place among its kind.
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
  const words = (e) => (e.getAttribute('aria-label') || e.getAttribute('alt') || e.getAttribute('placeholder') || e.innerText || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  addEventListener('message', (m) => {
    if (m.source !== parent || m.data?.['sign-off'] !== 'point') return;
    [on, marks, hover] = [m.data.on === true, Array.isArray(m.data.marks) ? m.data.marks.filter((r) => typeof r === 'string') : [], null];
    draw();
  });
  addEventListener('mouseover', (m) => on && ((hover = m.target), draw()), true);
  // While pointing, a press does nothing in the mock (no focus, no handler of its own); its click names what was pressed.
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) addEventListener(type, (m) => {
    if (!on) return;
    m.preventDefault();
    m.stopImmediatePropagation();
    if (type === 'click') parent.postMessage({ 'sign-off': 'pointed', ref: ref(m.target), tag: m.target.localName, text: words(m.target) }, '*');
  }, true);
  addEventListener('resize', draw);
  parent.postMessage({ 'sign-off': 'ready' }, '*');
})();
