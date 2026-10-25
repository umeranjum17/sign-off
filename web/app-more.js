// The screens beyond the first screen's own. app.js asks for this file once the board has drawn; until then a phone reads only the first screen.
  function openMediaViewer(items, start = 0, returnFocus) {
    if (!items?.length) return;
    // One viewer at a time: drop any sheet still open from another card or an earlier tap.
    document.querySelectorAll('dialog.media-viewer').forEach((d) => { d.close(); d.remove(); });
    let at = Math.max(0, Math.min(start | 0, items.length - 1)), scale = 1, ox = 0, oy = 0, moving = false;
    const count = el('h2', { id: 'mv-title', tabindex: '-1' }), cap = el('p', { class: 'mv-cap', dir: 'auto' }), srcLine = el('p', { class: 'mv-src', dir: 'auto' });
    const stage = el('div', { class: 'mv-stage', role: 'group', 'aria-roledescription': 'carousel' });
    const prev = el('button', { class: 'mv-nav prev', type: 'button', 'aria-label': 'Previous' }, glyph('left'));
    const next = el('button', { class: 'mv-nav next', type: 'button', 'aria-label': 'Next' }, glyph('right'));
    const close = el('button', { class: 'mv-close', type: 'button', 'aria-label': 'Close' }, glyph('x'));
    const dialog = el('dialog', { class: 'media-viewer', 'aria-labelledby': 'mv-title' },
      el('div', { class: 'mv-bar' }, count, close), stage, prev, next, el('div', { class: 'mv-foot' }, cap, srcLine));
    const apply = () => { const m = stage.querySelector('.mv-media'); if (m) m.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`; };
    const resetZoom = () => { scale = 1; ox = oy = 0; apply(); };
    const paint = () => {
      const it = items[at], name = it.caption || it.source || `Item ${at + 1}`;
      count.textContent = `${at + 1} of ${items.length}`;
      cap.textContent = it.caption || ''; cap.hidden = !it.caption;
      srcLine.textContent = it.source || ''; srcLine.hidden = !it.source;
      prev.hidden = items.length < 2; next.hidden = items.length < 2;
      prev.disabled = at === 0; next.disabled = at === items.length - 1;
      stage.setAttribute('aria-label', name);
      const node = it.video
        ? el('video', { class: 'mv-media', src: it.url, controls: '', playsinline: '', autoplay: '', preload: 'metadata', 'aria-label': name })
        : el('img', { class: 'mv-media', src: it.url, alt: name, draggable: 'false' });
      stage.replaceChildren(node);
      resetZoom();
      count.focus({ preventScroll: true });
    };
    const go = (n) => { if (n >= 0 && n < items.length && n !== at) { at = n; paint(); } };
    prev.onclick = () => go(at - 1); next.onclick = () => go(at + 1);
    const shut = () => {
      if (!dialog.isConnected) return;
      dialog.close(); dialog.remove();
      (returnFocus?.isConnected ? returnFocus : null)?.focus?.({ preventScroll: true });
    };
    close.onclick = shut; dialog.onclose = shut;
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); }
      else if (e.key === 'Escape') { e.preventDefault(); shut(); }
    });
    // One finger: swipe left/right for next/prev, swipe down to close; when zoomed, pan. Pinch and double-tap zoom.
    let x0, y0, t0, sx, sy, s0, dist0, lastTap = 0;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { stage.setPointerCapture?.(e.pointerId); } catch { /* synthetic taps have no active pointer id */ }
      const pts = stage._pts ??= new Map();
      pts.set(e.pointerId, e);
      if (pts.size === 1) { x0 = e.clientX; y0 = e.clientY; t0 = Date.now(); sx = ox; sy = oy; s0 = scale; moving = false; stage.classList.add('dragging'); }
      else if (pts.size === 2) { const [a, b] = pts.values(); dist0 = dist(a, b); s0 = scale; }
    });
    stage.addEventListener('pointermove', (e) => {
      const pts = stage._pts; if (!pts?.has(e.pointerId)) return;
      pts.set(e.pointerId, e);
      if (pts.size === 2) {
        const [a, b] = pts.values(), d = dist(a, b);
        if (dist0 > 0) { scale = Math.min(4, Math.max(1, s0 * (d / dist0))); if (scale === 1) ox = oy = 0; apply(); }
        moving = true; return;
      }
      if (x0 === undefined) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (!moving && Math.hypot(dx, dy) > 8) moving = true;
      if (!moving) return;
      if (scale > 1) { ox = sx + dx; oy = sy + dy; apply(); }
      else if (Math.abs(dy) > Math.abs(dx) && dy > 0) { stage.style.transform = `translateY(${dy}px)`; stage.style.opacity = String(Math.max(0.35, 1 - dy / 320)); }
    });
    const end = (e) => {
      const pts = stage._pts; if (!pts?.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size) return;
      stage.classList.remove('dragging');
      const dx = e.clientX - (x0 ?? e.clientX), dy = e.clientY - (y0 ?? e.clientY), dt = Date.now() - (t0 ?? 0);
      stage.style.transform = ''; stage.style.opacity = '';
      if (!moving && dt < 280 && Math.hypot(dx, dy) < 10) {
        const now = Date.now();
        if (now - lastTap < 320 && !items[at].video) {
          if (scale > 1) resetZoom(); else { scale = 2.5; ox = oy = 0; apply(); }
          lastTap = 0;
        } else lastTap = now;
      } else if (scale <= 1 && moving) {
        if (dy > 100 && Math.abs(dy) > Math.abs(dx) * 1.2) shut();
        else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.2) go(at + (dx < 0 ? 1 : -1));
      }
      x0 = y0 = undefined; moving = false;
    };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    stage.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && Math.abs(e.deltaY) < 40) return;
      e.preventDefault();
      const next = Math.min(4, Math.max(1, scale * (e.deltaY < 0 ? 1.12 : 0.9)));
      if (next === 1) resetZoom(); else { scale = next; apply(); }
    }, { passive: false });
    document.body.append(dialog); dialog.showModal(); paint();
  }
  function evidenceList(items, top, selected = '') {
    const proofs = items.filter((d) => d.type === 'evidence'), counts = new Map();
    for (const d of proofs) counts.set(projectOf(d) || '-', (counts.get(projectOf(d) || '-') ?? 0) + 1);
    if (!counts.has(evProject)) evProject = '';
    const pname = (p) => (p === '-' ? 'No project' : p), redraw = (control) => reshow(control);
    const h1 = top.querySelector('h1'), ro = top.querySelector(':scope > .meta');
    if (counts.size > 1) {
      const fb = el('button', { class: 'ui-rb ev-fb', 'aria-haspopup': 'dialog', 'aria-label': evProject ? `Filter by project, ${pname(evProject)} shown` : 'Filter by project' }, evGlyph('filter'), evProject ? el('b', { 'aria-hidden': 'true' }, '1') : '');
      fb.onclick = () => openSheet('Filter by project', el('div', { class: 'ui-props ev-pick' }, ...[...counts].sort((x, y) => y[1] - x[1] || (x[0] === '-') - (y[0] === '-') || x[0].localeCompare(y[0])).map(([p, n]) => {
        const b = el('button', { class: 'ui-pr', 'aria-pressed': String(p === evProject) }, el('span', { class: 'k' }, projectTile(p === '-' ? '' : p), el('span', { class: 'pn', dir: 'auto' }, pname(p))), el('span', { class: 'v' }, el('span', { class: 'n' }, String(n)), p === evProject ? evGlyph('check') : el('i')));
        b.onclick = () => { evProject = p === evProject ? '' : p; evMore = false; sheet.close(); redraw('.ev-fb'); };
        return b;
      })));
      top.replaceChildren(h1, fb, themeButton());
    } else top.replaceChildren(h1, themeButton());
    top.className = 'ui-top ev-top';
    if (!proofs.length) return [...(ro ? [ro] : []), el('p', { class: 'empty' }, EMPTY.evidence), ...items.map((d) => row(d))];
    const seg = el('div', { class: 'ui-seg ev-seg', role: 'group', 'aria-label': 'Order' }, ...[['new', 'Newest'], ['prio', 'By priority']].map(([v, n]) => {
      const b = el('button', { 'aria-pressed': String(evSort === v) }, n);
      b.onclick = () => { evSort = v; redraw('.ev-seg [aria-pressed="true"]'); };
      return b;
    }));
    let head;
    if (evProject) {
      const x = el('button', { class: 'ev-unpick', 'aria-label': 'Show every project' }, glyph('x'));
      x.onclick = () => { evProject = ''; redraw('.ev-fb'); };
      head = el('div', { class: 'ui-card ev-pill' }, projectTile(evProject === '-' ? '' : evProject), el('span', { dir: 'auto' }, pname(evProject)), x);
    } else {
      // Today's proofs in the order filed; as many columns (24 to 30) as leave the fewest empty squares, 27 on a tie.
      const today = state.decisions.filter((d) => d.type === 'evidence' && d.filed && isToday(d.filed)).sort((x, y) => Date.parse(x.filed) - Date.parse(y.filed)), marks = today.map(judged), n = marks.length;
      const held = marks.filter((m) => m === 'held').length, open = marks.filter((m) => !m).length;
      let cols = 27, waste = Infinity;
      for (let c = 24; c <= 30; c++) { const w = Math.ceil(n / c) * c - n; if (w < waste || (w === waste && c === 27)) cols = c, waste = w; }
      head = el('section', { class: 'ui-card ui-hero ev-held' }, el('div', { class: 'hl' }, el('span', { class: 'lab' }, 'Held up today')),
        el('div', { class: 'hv' }, el('span', { class: 'big' }, n ? `${held} ` : '0', n ? el('small', {}, `of ${n}`) : ''), el('span', { class: 'vs' }, n ? `${open} not checked` : 'None filed yet')),
        n ? el('div', { class: 'ev-dots', role: 'img', style: `--cols:${cols};--rows:${Math.ceil(n / cols)}`, 'aria-label': `${held} held up, ${n - held - open} not confirmed, ${open} not checked` },
          ...marks.map((m) => el('i', { class: m }))) : '');
    }
    const rank = (d) => (prio(d) ? Number(prio(d)[1]) : 9), list = (evProject ? proofs.filter((d) => (projectOf(d) || '-') === evProject) : proofs);
    const sorted = evSort === 'prio' ? [...list].sort((x, y) => rank(x) - rank(y)) : list, all = evMore || sorted.findIndex((d) => d.key === selected) >= 6;
    const see = sorted.length > 6 ? el('button', { class: 'see' }, all ? 'Show fewer' : 'See all') : '';
    if (see) see.onclick = () => { evMore = !all; redraw('.ev-sec .see'); };
    // Previews: every row with its first capture large beside its title, or compact rows; kept in this browser.
    const pv = el('button', { class: 'ev-pv', 'aria-pressed': String(evRich) }, evGlyph('image'), 'Previews');
    pv.onclick = () => { evRich = !evRich; try { localStorage.setItem('so-ev-view', evRich ? 'rich' : 'compact'); } catch {} redraw('.ev-pv'); };
    // The board's Select and Clear all, as Today keeps its More: while selecting, Cancel and Dismiss sit under the title; otherwise one quiet line under the list opens them.
    const bulk = canDismiss() && proofs.length ? (selecting ? bulkBar(proofs) : el('button', { class: 't-more-line ev-more', 'aria-haspopup': 'dialog' }, el('span', {}, 'Select or clear all'), glyph('right'))) : '';
    if (bulk && !selecting) bulk.onclick = () => openSheet('Proof', el('div', { class: 'ui-props ev-pick' }, ...[['Select', () => { selecting = true; render(); }],
      ['Clear all', () => dismiss(proofs.map((d) => d.key), `${plural(proofs.length, 'proof')} cleared`)]].map(([name, fn]) => {
      const b = el('button', { class: 'ui-pr' }, el('span', { class: 'k' }, el('span', { class: 'pn' }, name)));
      b.onclick = () => { sheet.close(); fn(); };
      return b;
    })));
    return [...(ro ? [ro] : []), ...(selecting ? [bulk] : []), seg, head, el('h2', { class: 'ui-sec ev-sec' }, el('span', { class: 'ev-st' }, evSort === 'prio' ? 'By priority' : 'Latest proof'), pv, see),
      sorted.length ? el('ul', { class: 'ui-card ui-list ev-list' }, ...(all ? sorted : sorted.slice(0, 6)).map(evRow)) : el('p', { class: 'empty' }, 'No proof for this project.'),
      ...items.filter((d) => d.type !== 'evidence').map((d) => row(d)), ...(selecting ? [] : [bulk])];
  }
  /** An update's verdict: Fail, Needs work and Pass on one row, Pass in ink until one is saved, then the saved one; a read-only board takes none. */
  function evidenceItem(d) {
    const project = projectOf(d), said = plain((d.about ?? '').replace(HELD, '').replace(UNCONFIRMED, '')), name = plain(headline(d)), why = plain(unchecked(d));
    return el('div', { class: 'ev-scroll' }, el('div', { class: 'ev-item' },
      el('div', { class: 'ev-shd' }, el('span', { class: 'lab' }, projectTile(project), el('span', { class: 'pt', dir: 'auto' }, [project || 'No project', d.filed && (isToday(d.filed) ? hhmm(d.filed) : stamp(d.filed))].filter(Boolean).join(' · '))),
        el('a', { class: 'ev-x', href: '#evidence', 'aria-label': 'Close' }, glyph('x'))),
      el('h1', { class: 'ev-title', id: 'reader-title', tabindex: '-1', dir: 'auto' }, name),
      captures(d, 'ev-hero') || el('div', { class: 'ev-hero none' }, evGlyph('image'), (d.status ? 'Frame pending' : 'Text only: no capture was filed')), attachments(d),
      evProps(d),
      said && said !== name ? el('p', { class: 'ev-about', dir: 'auto' }, said) : '', why ? el('p', { class: 'ev-why', dir: 'auto' }, why) : '', thread(d),
      state.readonly || FROZEN || !(d.options.length || d.reply) ? '' : verdicts(d)));
  }

  /** One proof on a desk, as the prototype's open proof: its project and time across, then its title in full and its capture on the left; beside them its panel
   *  (done-done's word, its priority, the ask it serves, its pull request), what it says, the verdict and its Activity. */
  function openFull(d, value, from) {
    const pages = fullPages(d);
    if (!pages.length) return;
    fullSize ??= matchMedia('(min-width: 64rem)').matches ? 'desktop' : 'phone';
    let shown = pages.find((p) => p.value === value) ?? pages[0], refOn = false, ref;
    const others = () => pages.filter((p) => p !== shown);
    const view = (p, title) => p.page ? el('iframe', { src: p.url, title, sandbox: 'allow-scripts' }) : el('div', { class: 'pf-img' }, el('img', { src: p.url, alt: title }));
    const frame = (cls) => { const cap = el('figcaption', {}), port = el('div', { class: 'pf-port' }); return { fig: el('figure', { class: `pf-frame ${cls}` }, cap, port), cap, port }; };
    const main = frame('pf-main'), back = frame('pf-back');
    const title = el('h2', { id: 'pf-title', tabindex: '-1', autofocus: '', dir: 'auto' }, d.title);
    const close = el('button', { class: 'pf-close', 'aria-label': 'Close full screen' }, glyph('x'), 'Close');
    const pick = pages.length > 1 ? el('select', { class: 'pf-pick', 'aria-label': 'Option shown' }, ...pages.map((p) => el('option', { value: p.value }, p.label))) : '';
    // On a phone each size is its picture; on a desk its name and width too.
    const sizes = Object.entries(SIZES).map(([k, [w]]) => el('button', { 'aria-pressed': String(k === fullSize), 'aria-label': `${k === 'phone' ? 'Phone' : 'Desktop'}, ${w} wide`, title: `${w} px wide`, 'data-size': k },
      glyph(k), el('span', { class: 'pf-name', 'aria-hidden': 'true' }, k === 'phone' ? 'Phone' : 'Desktop', el('span', { class: 'pf-w' }, String(w)))));
    const refBtn = pages.length > 1 ? el('button', { class: 'pf-ref', 'aria-pressed': 'false' }, glyph('layers'), 'Reference') : '';
    const live = el('a', { class: 'pf-live', target: '_blank', rel: 'noopener' }, 'Open live');
    const stage = el('div', { class: 'pf-stage' }, main.fig, back.fig);
    const dialog = el('dialog', { class: 'proto-full', 'aria-labelledby': title.id },
      el('header', { class: 'pf-bar' }, el('div', { class: 'pf-top' }, close, title, live),
        el('div', { class: 'pf-tools' }, pick, el('div', { class: 'seg pf-size', role: 'group', 'aria-label': 'Size' }, ...sizes), refBtn)), stage);
    // The frame shown is made again only for another option, so a size change or the reference never resets the prototype halfway through.
    const showMain = () => {
      main.port.replaceChildren(view(shown, `Prototype: ${shown.label}`));
      main.cap.replaceChildren(el('span', {}, 'Prototype'), el('b', { dir: 'auto' }, shown.label));
      live.hidden = !shown.link; if (shown.link) { live.href = shown.link; live.setAttribute('aria-label', `Open ${shown.label} live`); }
      if (pick) pick.value = shown.value;
    };
    const showRef = () => {
      back.fig.hidden = !refOn;
      if (!refOn) { back.port.replaceChildren(); return lay(); }
      if (!others().includes(ref)) ref = others()[0];
      const choose = others().length > 1 ? el('select', { 'aria-label': 'Reference option' }, ...others().map((p) => el('option', { value: p.value }, p.label))) : el('b', { dir: 'auto' }, ref.label);
      if (choose.localName === 'select') { choose.value = ref.value; choose.onchange = () => { ref = others().find((p) => p.value === choose.value); showRef(); }; }
      back.cap.replaceChildren(el('span', {}, 'Reference'), choose);
      back.port.replaceChildren(view(ref, `Reference: ${ref.label}`));
      lay();
    };
    // Each frame is the chosen device's own viewport, scaled down only where it does not fit the stage either way, framed where it leaves room at the sides; two side by side once each keeps half its width.
    const lay = () => {
      const [w, h] = SIZES[fullSize], box = stage.getBoundingClientRect(), gap = 16, beside = refOn && box.width >= 720 && (box.width - gap * 3) / 2 >= w / 2;
      stage.dataset.mode = !refOn ? 'one' : beside ? 'beside' : 'over';
      const room = beside ? (box.width - gap * 3) / 2 : box.width, tall = box.height - (refOn ? 32 : 0);
      const fit = (pad) => Math.min(1, (room - pad * 2) / w, (tall - (beside ? gap : pad) * 2) / h);
      const pad = w * fit(0) <= room - gap * 2 ? gap : 0, scale = fit(pad);
      stage.style.setProperty('--pad', `${beside ? gap : pad}px`);
      for (const f of [main, back]) {
        f.fig.classList.toggle('framed', pad > 0);
        Object.entries({ '--w': w * scale, '--h': h * scale, '--vw': w, '--vh': h, '--s': scale }).forEach(([k, v]) => f.port.style.setProperty(k, k === '--s' ? v : `${v}px`));
      }
    };
    sizes.forEach((b) => (b.onclick = () => { fullSize = b.dataset.size; sizes.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); lay(); }));
    if (pick) pick.onchange = () => { shown = pages.find((p) => p.value === pick.value); showMain(); showRef(); };
    if (refBtn) refBtn.onclick = () => { refOn = !refOn; refBtn.setAttribute('aria-pressed', String(refOn)); showRef(); };
    const fit = new ResizeObserver(lay);
    // Closed by its button or Escape, it goes at once, and the focus goes back to what opened it; the close event comes a moment later.
    const shut = () => {
      if (!dialog.isConnected) return;
      fit.disconnect(); dialog.close(); dialog.remove(); protoFull = null;
      document.querySelector(`[data-full="${CSS.escape(from)}"]`)?.focus({ preventScroll: true });
    };
    close.onclick = shut; dialog.onclose = shut;
    showMain(); showRef();
    document.body.append(dialog); protoFull = dialog; dialog.showModal(); fit.observe(stage); lay();
  }

  /** Comments on mock elements: the open editor per item, then the unsent list, then the sent ones. An unsent comment shows only on the mock file it was made on. */
  function annotations(d) {
    const hash = new Map((d.mocks ?? []).map((m) => [m.value, m.hash])), open = editing.get(d.key);
    // An unsent comment shows only on the mock file it was made on; the others are counted per mock. A sent one is always listed.
    const mine = [], old = new Map(), name = (m) => d.options.find((o) => o.value === m)?.label ?? m;
    for (const a of state.annotations ?? []) {
      if (a.key !== d.key) continue;
      if (a.sent || hash.get(a.mock) === a.hash) mine.push(a);
      else old.set(a.mock, (old.get(a.mock) ?? 0) + 1);
    }
    const what = (a) => `${name(a.mock)} · ${a.tag}${a.words ? ` “${a.words.length > 40 ? `${a.words.slice(0, 40)}…` : a.words}”` : ''}`;
    const err = el('div', { class: 'err', role: 'alert', id: `ann-err-${d.key}` });
    const post = (btn, body, sent) => {
      btn.disabled = true;
      call('/api/annotations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, sent).catch((e) => {
        shown(err).textContent = `Couldn't save: ${e.message}`;
        btn.disabled = false;
        if (e.status === 404) call('/api/decisions').catch(failed);
      });
    };
    // While Comment on the mocks is on, a tap on a mock names an element to comment on instead of opening the mock.
    const pages = (d.mocks ?? []).filter((m) => m.hash !== null && /\.html$/i.test(m.path.split('?')[0])), on = pages.some((m) => pointing.get(`${d.key}~${m.value}`));
    if (!talks()) return el('div', { class: 'ann', 'data-ann': d.key });
    const toggle = el('button', { class: 'quick', 'aria-pressed': String(on), 'aria-label': `Comment on the mocks, ${d.title}` }, 'Comment on the mocks');
    toggle.onclick = () => {
      for (const m of pages) pointing.set(`${d.key}~${m.value}`, !on);
      document.querySelectorAll('.mock iframe').forEach((f) => f.dataset.mock.startsWith(`${d.key}~`) && aim(f));
      redraw(d);
    };
    let form = '';
    if (open && pages.length) {
      const box = el('textarea', { id: `ann-text-${d.key}`, rows: 2, maxlength: 500, dir: 'auto' }), save = el('button', {}, 'Save comment'), cancel = el('button', { class: 'quick' }, 'Cancel');
      const at = spot(d.key, open);
      box.value = unsaved.get(at) ?? mine.find((a) => !a.sent && a.mock === open.mock && a.ref === open.ref)?.text ?? '';
      box.oninput = () => unsaved.set(at, box.value);
      // Saved, only this editor closes: one opened while the save was on its way stays open with its words.
      save.onclick = () => {
        const text = box.value;
        post(save, { id: open.id, key: d.key, mock: open.mock, ref: open.ref, tag: open.tag, words: open.words, text, hash: open.hash }, () => {
          if (unsaved.get(at) === text) unsaved.delete(at);
          if (editing.get(d.key) === open) editing.delete(d.key);
        });
      };
      cancel.onclick = () => { unsaved.delete(at); editing.delete(d.key); redraw(d); };
      form = el('div', {}, el('label', { for: box.id }, `Comment on ${what(open)}`), box, el('div', { class: 'actions' }, save, cancel));
    }
    const row = (a, ...buttons) => el('li', {}, el('div', {}, el('p', { class: 'meta' }, what(a)), el('p', { class: 'saved-note', dir: 'auto' }, a.text)), ...buttons);
    // A comment goes with the card's next answer or round; once sent it is the agent's and stays as it was.
    const sent = mine.filter((a) => a.sent).map((a) => row(a));
    const rows = mine.filter((a) => !a.sent).map((a) => {
      const edit = el('button', { class: 'quick', 'aria-label': `Edit comment, ${what(a)}` }, 'Edit'), del = el('button', { class: 'quick', 'aria-label': `Delete comment, ${what(a)}` }, 'Delete');
      edit.onclick = () => { editing.set(d.key, { ...a }); redraw(d); };
      del.onclick = () => post(del, { id: a.id, deleted: true }, () => { unsaved.delete(spot(d.key, a)); if (editing.get(d.key)?.mock === a.mock && editing.get(d.key)?.ref === a.ref) editing.delete(d.key); });
      return row(a, el('span', { class: 'actions' }, edit, del));
    });
    return el('div', { class: 'ann', 'data-ann': d.key }, pages.length ? el('div', { class: 'actions' }, toggle) : '',
      on ? el('p', { class: 'meta' }, 'Tap an element in a mock to comment on it. Turn this off to open a mock full size.') : '', form, ...(rows.length ? [el('p', { class: 'meta' }, 'Your comments on the mocks, not sent yet'), el('ul', {}, ...rows), el('p', { class: 'meta' }, 'They go with your pick, your Other answer or Another round.')] : []),
      ...(sent.length ? [el('p', { class: 'meta' }, 'Sent to the agent'), el('ul', {}, ...sent)] : []),
      ...[...old].map(([m, n]) => el('p', { class: 'meta' }, `${n} comment${n > 1 ? 's' : ''} on an earlier version of “${name(m)}” ${n > 1 ? 'are' : 'is'} hidden`)), err);
  }

  function tickets(by, id) {
    const L = tkLists(), desk = !phone(), picked = id && tkById(id);
    const open = picked || (desk ? L.moving[0] ?? L.hold[0] ?? L.todo[0] ?? L.done[0] : undefined);
    tkShown = open?.id ?? '';
    const empty = !tkAll().length;
    const say = `${L.kind === 'asks' ? 'Your asks: ' : L.kind === 'system' ? 'System work: ' : ''}${L.done.length} of ${L.shown.length} done · ${L.moving.length} moving · ${L.hold.length} on hold · ${L.todo.length} to do`;
    const pick = tkProj ? el('button', { class: 'tk-fpill' }, el('span', { class: 'tk-pt', 'aria-hidden': 'true' }, projectPic(tkProj)), tkProj, glyph('x')) : '';
    if (pick) pick.onclick = () => { tkProj = ''; render(); }, pick.setAttribute('aria-label', `Show every project, not only ${tkProj}`);
    const none = el('section', { class: 'ui-card tk-empty' }, el('h2', {}, 'No tickets yet'), el('p', {}, 'Agents add tickets as they plan work. Each one shows here with how far along it is.'));
    if (desk) {
      const head = el('header', { class: 'ui-dhead tk-dhead' }, el('div', { class: 'tx' }, el('p', { class: 'crumb' }, 'Sign-off', el('span', { 'aria-hidden': 'true' }, '›'), 'Tickets'), el('h1', { tabindex: '-1' }, 'Tickets'), el('p', {}, empty ? 'Nothing tracked yet' : say)),
        el('div', { class: 'acts' }, pick, tkSeg(L), tkFilter(L), themeButton()));
      if (empty) return [el('div', { class: 'ui-desk tk-desk' }, head, none)];
      return [el('div', { class: 'ui-desk tk-desk' }, head, el('div', { class: 'ui-dgrid' }, el('div', { class: 'ui-col s4' }, tkHero(L), tkGroup('mv', 'In progress', L.moving, true, 'grow')),
        el('div', { class: 'ui-col s4' }, tkGroup('hold', 'On hold', L.hold, true, 'half'), tkGroup('todo', 'To do', L.todo, true, 'grow')),
        open ? el('section', { class: 'ui-card ui-pane s4 tk-pane', 'aria-label': open.title }, ...ticketPage(open)) : el('section', { class: 'ui-card ui-pane s4 tk-pane' }, el('p', { class: 'tk-none' }, 'No ticket here.'))))];
    }
    const stat = (href, mark, lab, n) => el(href ? 'a' : 'div', { class: 'ui-card ui-stat', ...(href && { href }), 'aria-label': `${lab}: ${n}` }, fill(mark), el('span', { class: 'lab' }, lab), el('b', {}, String(n)));
    const p0 = L.shown.filter((t) => t.priority === 'P0' && tkStateOf(t) !== 'done').length;
    return [el('header', { class: 'ui-top tk-top' }, el('h1', { tabindex: '-1' }, 'Tickets'), tkFilter(L), themeButton()), tkSeg(L), pick,
      ...(empty ? [none] : [tkHero(L), tkGroup('mv', 'In progress', L.moving), tkGroup('hold', 'On hold', L.hold), tkGroup('todo', 'To do', L.todo), tkGroup('done', 'Done', L.done),
        el('div', { class: 'ui-tiles tk-tiles' }, stat('#waiting', 'M5 3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-4.5L6 18.2V15H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm1.5 4.2v1.6h7V7.2zm0 3v1.6h5v-1.6z', 'Wait on you', by.waiting.length),
          stat('', 'M4 2.5h1.6v1h9.9l-2.1 3.75 2.1 3.75H5.6v6.5H4z', 'Open at P0', p0))]),
      picked ? tkSheet(picked) : (tkUp = '')];
  }
  /** On a phone the ticket rises over the list as a sheet: a grab handle, its project and state with a close, then the ticket. Close (or Escape, or a tap above it) goes back. */
  function ticketPage(t, close = '') {
    const gone = new Set(state.dismissed ?? []), cards = state.decisions.filter((d) => d.ticket === t.id && !gone.has(d.key)).reverse().sort((x, y) => (Date.parse(y.filed) || 0) - (Date.parse(x.filed) || 0));
    const kids = tkUnder(t), done = kids.filter((x) => tkStateOf(x) === 'done').length, s = tkStateOf(t), up = tkAbove(t)[0], proj = tkProject(t);
    const prop = (draw, k, ...v) => el('div', { class: 'ui-pr' }, el('span', { class: 'k' }, tkMark(draw), k), el('span', { class: 'v' }, ...v));
    const linked = (d) => { const a = el('a', { class: 'ui-row', href: hrefOf(d) }, ...uiRow({ tile: cardTile(d), title: title(d), priority: d.priority, badge: trailBadge(d.key), meta: [tkKind(d), tkState(d), d.filed && tkWhen(d.filed)].filter(Boolean).join(' · ') }));
      a.onclick = () => (jump = d.key); return el('li', {}, a); };
    // Its cards' steps after their postings (Linked shows those), newest first, each naming its card.
    const steps = cards.flatMap((d) => threadOf(d).filter((e) => !e.posted).map((e) => ({ ...e, card: d }))).sort(bySecond).reverse(), said = trailOf(t.id, 'ticket');
    seeReply(t.id, 'ticket');
    return [el('div', { class: 'tk-shd' }, el('p', {}, tkTile(t), el('span', {}, [proj, TK_WORDS[s]].filter(Boolean).join(' · '))), close),
      el('h2', { class: 'tk-dt', tabindex: '-1', dir: 'auto' }, t.title),
      t.release ? el('span', { class: 'ui-pc tk-release', title: t.release }, t.release) : '',
      el('div', { class: 'ui-props' }, t.priority ? prop('flag', 'Priority', el('span', { class: `ui-pc ${t.priority.toLowerCase()}` }, t.priority)) : '',
        prop('half', 'Progress', ...tkStatus(t), ...((t.stage && !kids.length) || (t.progress > 0 && t.progress < 100) ? [el('span', { class: 'ui-bar' }, el('i', { style: `width: ${t.progress}%` })), el('span', { class: 'n' }, `${t.progress}%`)] : [el('span', {}, t.progress >= 100 ? 'All done' : 'Not started')])),
        up ? prop('layers', 'Part of', el('a', { href: `#ticket/${up.id}`, dir: 'auto' }, up.title)) : '',
        prop('clock', 'Last update', el('span', {}, stamp(t.at)))),
      ...(kids.length ? [el('p', { class: 'ui-dl' }, `${tkAbove(t).length ? 'Sub-tasks' : 'Tickets in this epic'} · ${done} of ${kids.length} done`), el('ul', { class: 'ui-list tk-in' }, ...kids.map(tkRow))] : []),
      el('p', { class: 'ui-dl' }, 'Linked'), cards.length || t.prs?.length ? el('ul', { class: 'ui-list tk-in' }, ...(t.prs ?? []).map((url) => { const pr = /\/pull\/(\d+)\/?$/.exec(new URL(url).pathname); return el('li', {}, el('a', { class: 'ui-row', href: url, title: url, target: '_blank', rel: 'noopener noreferrer' }, ...uiRow({ tile: el('span', { class: 'ui-icon', 'aria-hidden': 'true' }, glyph('link')), title: pr ? `Pull request #${pr[1]}` : url, meta: pr ? new URL(url).pathname.replace(/\/pull\/.*$/, '').slice(1) : 'Pull request' }))); }), ...cards.map(linked)) : el('p', { class: 'tk-none' }, 'No card names this ticket yet.'),
      // The person's comments on it (made in the fleet dashboard), oldest first, each with how far it got and the lead's reply.
      ...(said.length ? [el('p', { class: 'ui-dl' }, 'Your comments'), ...said.map((c) => el('div', { class: 'tk-said' }, el('p', { dir: 'auto' }, c.said), trailTrack(c)))] : []),
      thread(t, steps, 1)];
  }
  /** On a desk every list ends on a whole row: with 40px or more left under its whole rows, the next row fades out there (and the list's end is padded the same, so scrolled
   * to its end it shows whole rows); with less, the list ends on its last whole row. The open ticket fades at its foot while it holds more than it shows. */
  function report(d, i = 0) {
    const n = d.steps?.length;
    // Keep the kind and ticket readable on line two; read progress sits quietly below while unread.
    const t = ticketOf(d), ticket = d.ticket || t?.title;
    const meta = el('span', { class: 'rp-meta' }, kindChip(d), ticket ? el('span', { class: 'rp-ticket', title: t ? `${t.id}: ${t.title}` : ticket }, ticket) : '');
    const face = uiRow({ tile: cardTile(d), title: plain(title(d)), priority: d.priority, after: trailBadge(d.key), meta });
    if (unread(d)) face[1].append(el('span', { class: 'rp-progress', role: 'progressbar', 'aria-label': 'Report read', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(readPct(d)) },
      kindOf(d) === 'plan' && kindParts(d).length ? partsStrip(d) : el('span', { class: 'ui-bar' }, el('i', { style: `width: ${readPct(d)}%` })), el('span', { class: 'pct sr-only' }, `${readPct(d)}%`)));
    const sel = rpSel === d.key;
    const li = (...kids) => el('li', { class: `report dl-row${flash === d.key ? ' returned' : ''}${sel ? ' sel' : ''}`, style: `--n:${i}`, ...(reads(d) && { 'data-key': d.key, 'data-list': 'reports' }) }, ...kids);
    const act = (cls, mark, words) => el('div', { class: `dl-act ${cls}`, 'aria-hidden': 'true' }, glyph(mark), el('span', {}, words));
    // On a desk, hovering a row shows the same two actions as its swipes.
    const quick = (cls, mark, words, fn) => { const b = el('button', { class: cls, 'aria-label': `${words}, ${title(d)}` }, glyph(mark), words); b.onclick = fn; return b; };
    const hover = rpSel === null || !canDismiss() ? '' : el('span', { class: 'dl-hover' }, quick('read-q', unread(d) ? 'check' : 'dot', unread(d) ? 'Read' : 'Unread', () => readToggle(d)),
      quick('later-q', 'archive', 'Archive', () => archiveReport(d)));
    if (reads(d)) return li(act('yes', unread(d) ? 'check' : 'dot', unread(d) ? 'Read' : 'Unread'), canDismiss() ? act('later', 'archive', 'Archive') : '',
      el('a', { class: 'dl-face ui-row', href: `#reports/${d.key}`, draggable: 'false', id: `item-${d.key}`, 'data-row': '', ...(sel && { 'aria-current': 'true' }) }, ...face), hover);
    const full = n ? el('ol', { class: 'steps' }, ...d.steps.map((t, i) => el('li', {}, el('span', { class: 'num' }, String(i + 1)), el('span', { dir: 'auto' }, t.title), marks(t)))) : row(d, { x: false });
    full.removeAttribute('id');
    const box = el('details', { class: 'done', id: `item-${d.key}`, ...(opened.has(d.key) && { open: '' }) }, el('summary', { class: 'dl-face ui-row' }, ...face), full, decided(d), xBtn(d, 'Discard'));
    box.ontoggle = () => (box.open ? opened.add(d.key) : opened.delete(d.key));
    return li(box);
  }
  /** Reports' More, under the list as Today's is: one quiet line naming what it holds, opening a sheet with Mark all as read (while one is new), then Select and Archive all,
   *  which archive with Undo. The title's round button is the light-or-dark one. */
  function reportsMore(items, all) {
    const fresh = items.filter(unread), acts = [fresh.length && ['Mark all as read', 'read-all', () => markRead(fresh.map((d) => d.key), true, `${plural(fresh.length, 'report')} marked read`)],
      canDismiss() && all.length && ['Select', 'select', () => { selecting = true; render(); }],
      canDismiss() && all.length && ['Archive all', 'archive-all', () => dismiss(all.map((d) => d.key), `${plural(all.length, 'report')} archived`)]].filter(Boolean);
    if (!acts.length) return '';
    const names = acts.map(([name]) => name), line = el('button', { class: 't-more-line rp-more-line', 'aria-haspopup': 'dialog' }, el('span', {}, names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]), glyph('right'));
    line.onclick = () => {
      reportsSheet.replaceChildren(el('div', {}, sheetHead('rp-more', 'More'), el('div', { class: 'ui-props' }, ...acts.map(([name, act, fn]) => {
        const b = el('button', { class: 'ui-pr', 'data-act': act }, el('span', { class: 'k' }, name), el('span', { class: 'v' }, glyph('right')));
        b.onclick = () => { reportsSheet.close(); fn(); };
        return b;
      }))));
      reportsSheet.showModal();
      reportsSheet.querySelector('h2').focus();
    };
    return line;
  }

  /** What landed under Reports with no page and nothing to answer (receipts, status notes): folded under one row, each opening to its card in place. */
  function planReview(d, url) {
    const saved = answerOf(d.key), ro = !!saved || state.readonly || !!FROZEN, draftKey = `plan:${d.key}`;
    let draft;
    try { draft = JSON.parse(drafts.get(draftKey) ?? '{}'); } catch { draft = {}; }
    const notes = new Map((saved?.notes ?? draft.notes ?? []).filter((n) => d.sections.some((s) => s.id === n.section)).map((n) => [n.section, n]));
    const picks = new Map(Object.entries(saved?.decisions ?? draft.decisions ?? {}).filter(([key, value]) => d.decisions.some((q) => q.key === key) && typeof value === 'string' && value.trim()));
    let comment = saved?.note ?? (typeof draft.comment === 'string' ? draft.comment : '');
    const answered = (q) => typeof picks.get(q.key) === 'string' && !!picks.get(q.key).trim();
    const remember = () => { drafts.set(draftKey, JSON.stringify({ notes: [...notes.values()], decisions: Object.fromEntries(picks), ...(comment.trim() && { comment }) })); keep(); };
    const main = el('div', { class: 'plan-main' }), panel = el('aside', { class: 'plan-send' });
    const status = el('p', { role: 'status' }), err = el('p', { class: 'err', role: 'alert' }), progress = el('div', { class: 'plan-progress' });
    const send = el('button', { class: 'open-link' }, glyph('send'), 'Send back'), next = el('button', { class: 'plan-next' }, 'Go to next');
    const complete = (s) => { const n = notes.get(s.id); return n?.verdict === 'approve' || (n?.verdict === 'change' && n.note?.trim()); };
    next.onclick = () => {
      const section = d.sections.find((s) => !complete(s)), decision = d.decisions.find((q) => !answered(q));
      document.getElementById(section ? `plan-section-${section.id}` : `plan-decision-${decision?.key}`)?.scrollIntoView({ block: 'start' });
    };
    const update = () => {
      const left = d.sections.filter((s) => !complete(s)).length, decisions = d.decisions.filter((q) => !answered(q)).length;
      status.textContent = saved ? 'Sent back. Your answers are saved.' : left || decisions ? `${left} section${left === 1 ? '' : 's'} and ${decisions} decision${decisions === 1 ? '' : 's'} left` : 'Ready. Every part has an answer.';
      send.disabled = ro || !!left || !!decisions;
      next.hidden = !left && !decisions;
      progress.replaceChildren(...d.sections.map((s) => {
        const verdict = notes.get(s.id)?.verdict, b = el('button', {}, s.heading, el('span', {}, verdict === 'approve' ? 'Approved' : verdict === 'change' ? 'Change' : 'To review'));
        b.onclick = () => document.getElementById(`plan-section-${s.id}`).scrollIntoView(); return b;
      }), d.decisions.length ? el('p', { class: 'meta' }, `${d.decisions.length - decisions} of ${d.decisions.length} decisions answered`) : '');
    };
    if (saved) {
      main.append(el('div', { class: 'plan-sent', role: 'status' }, icon('answered'), el('h2', {}, 'Sent back'), el('p', {}, 'Your section notes and decisions are saved for the agent.'),
        el('a', { class: 'back', href: '#answered' }, 'See it in Answered'),
        saved.note ? el('p', { dir: 'auto' }, `Your whole-plan comment: ${saved.note}`) : ''));
    }
    main.append(el('p', { class: 'eyebrow' }, icon('plan'), ['Plan', d.project, `Planning agent${d.filed ? `, ${when(d.filed)}` : ''}`].filter(Boolean).join(' · ')), el('h2', { dir: 'auto' }, d.title), el('p', { dir: 'auto' }, d.about ?? ''), ticketRow(d), thread(d));
    if (!saved) main.append(el('figure', { class: 'plan-diagram' }, el('iframe', { class: 'plan-view', src: url, title: `Plan: ${d.title}`, sandbox: 'allow-scripts' })),
      el('p', { class: 'plan-summary' }, icon('plan'), `${plural(d.sections.length, 'section')} to approve or change, and ${plural(d.decisions.length, 'decision')} to make. Nothing is built until you send back.`));
    main.append(el('h2', { class: 'plan-h' }, saved ? 'What you sent' : 'The plan', saved ? '' : el('small', {}, 'Approve or change each part')));
    // Each decision sits under the section it names, else after the last; the explainer sits in the architecture section, else the last.
    const lastId = d.sections.at(-1).id, under = (id) => d.decisions.filter((q) => (d.sections.some((s) => s.id === q.after) ? q.after : lastId) === id);
    const hostId = (d.sections.find((s) => /architect/i.test(s.id + s.heading)) ?? d.sections.at(-1)).id;
    let explainer = '';
    if (d.steps?.length && !saved) {
      let step = 0;
      const head = el('p', { class: 'eh' }, 'How it works', el('span', {})), text = el('p', { 'aria-live': 'polite', class: 'narr' }), prev = el('button', { class: 'rnd', 'aria-label': 'Previous step' }, glyph('left')), next = el('button', { class: 'rnd', 'aria-label': 'Next step' }, glyph('right'));
      const draw = () => { head.lastChild.textContent = `Step ${step + 1} of ${d.steps.length}`; text.textContent = d.steps[step].text ?? d.steps[step].title; prev.disabled = !step; next.disabled = step === d.steps.length - 1; };
      prev.onclick = () => { step--; draw(); }; next.onclick = () => { step++; draw(); }; draw();
      explainer = el('div', { class: 'plan-explain' }, head, text, el('div', { class: 'foot' }, prev, next));
    }
    d.sections.forEach((s, i) => {
      const card = el('section', { class: 'plan-section', id: `plan-section-${s.id}`, 'aria-label': s.heading });
      const approve = el('button', { class: 'approve', 'aria-label': `Approve, ${s.heading}` }, glyph('check'), 'Approve'), badge = el('span', { class: 'num', 'aria-hidden': 'true' }, String(i + 1));
      const change = el('button', { class: 'change', 'aria-label': `Change, ${s.heading}` }, glyph('pencil'), 'Change');
      const field = el('textarea', { id: `plan-note-${s.id}`, maxlength: '500', placeholder: 'Write your note for the agent' });
      field.value = notes.get(s.id)?.note ?? '';
      field.disabled = ro;
      const caption = el('span', {}, '');
      const note = el('label', { for: field.id }, caption, field);
      const draw = () => {
        const verdict = notes.get(s.id)?.verdict;
        card.dataset.verdict = verdict ?? '';
        approve.setAttribute('aria-pressed', verdict === 'approve');
        approve.replaceChildren(glyph('check'), verdict === 'approve' ? 'Approved' : 'Approve');
        badge.replaceChildren(verdict === 'approve' ? glyph('check') : verdict === 'change' ? glyph('pencil') : String(i + 1));
        change.setAttribute('aria-pressed', verdict === 'change');
        approve.disabled = change.disabled = ro;
        caption.textContent = verdict === 'approve' ? `Comment for the agent on ${s.heading.toLowerCase()} (optional)` : `What should change in ${s.heading.toLowerCase()}?`;
        note.hidden = !verdict && !field.value;
        update();
      };
      [approve, change].forEach((b, n) => b.onclick = () => {
        notes.set(s.id, { section: s.id, verdict: n ? 'change' : 'approve', ...(field.value.trim() && { note: field.value }) });
        remember(); draw(); if (n) field.focus();
      });
      field.oninput = () => { notes.set(s.id, { section: s.id, verdict: notes.get(s.id)?.verdict ?? 'change', note: field.value }); remember(); draw(); };
      card.append(el('h3', { dir: 'auto' }, badge, s.heading), el('p', { dir: 'auto' }, s.body), s.id === hostId && explainer ? explainer : '', el('div', { class: 'plan-verdicts', role: 'group', 'aria-label': s.heading }, approve, change), note);
      main.append(card); draw();
      under(s.id).forEach((q) => main.append(decisionCard(q)));
    });
    function decisionCard(q) {
      const choices = el('div', { class: 'choices', role: 'group', 'aria-label': q.question });
      const other = el('textarea', { id: `plan-other-${q.key}`, maxlength: '500', placeholder: 'Other: write your own answer' });
      other.value = q.options.some((o) => o.value === picks.get(q.key)) ? '' : (picks.get(q.key) ?? '');
      other.disabled = ro;
      const press = () => [...choices.children].forEach((b, i) => b.setAttribute('aria-pressed', q.options[i].value === picks.get(q.key)));
      const n = d.decisions.indexOf(q) + 1;
      other.oninput = () => {
        if (other.value.trim()) picks.set(q.key, other.value);
        else if (!q.options.some((o) => o.value === picks.get(q.key))) picks.delete(q.key);
        remember(); press(); update();
      };
      q.options.forEach((o) => {
        const b = el('button', { 'aria-pressed': picks.get(q.key) === o.value, ...(ro && { disabled: '' }) }, el('span', { class: 'rd' }, glyph('check')), el('span', { class: 'lbl' }, el('strong', {}, o.label),
          o.value === q.recommend ? el('span', { class: 'tag' }, 'Recommended') : ''), el('span', { class: 'out', dir: 'auto' }, o.outcome),
          o.value === q.recommend && q.reason ? el('span', { class: 'out why2', dir: 'auto' }, `Why: ${q.reason}`) : '');
        b.onclick = () => { picks.set(q.key, o.value); other.value = ''; remember(); press(); update(); };
        choices.append(b);
      });
      return el('section', { class: 'plan-decision', id: `plan-decision-${q.key}` }, el('p', { class: 'eyebrow' }, icon('split'), `Decision ${n} of ${d.decisions.length}`), el('h3', { dir: 'auto' }, q.question), el('p', { class: 'meta', dir: 'auto' }, q.why), choices,
        el('details', { class: 'plan-other' }, el('summary', {}, 'Other answer'), el('label', { for: other.id }, 'Your own answer (optional)', other)),
        el('p', { class: 'quiet' }, icon('clock'), el('span', {}, el('b', {}, 'If you stay quiet:'), ' the plan waits, and the agent builds nothing until you send back.')));
    }
    if (!saved) main.append(el('details', { class: 'plan-fold' }, el('summary', {}, 'What the agent gets back'), el('p', {}, 'One send-back with every answer: each section as Approve or Change with your note, and the option you picked in each decision.'),
      el('p', {}, 'The agent acts on each change note and each pick, then posts round 2 of the plan here.')));
    const commentBox = el('textarea', { id: 'plan-comment', maxlength: '500', placeholder: 'Comment for the agent on the whole plan' });
    commentBox.value = comment;
    commentBox.disabled = ro;
    commentBox.oninput = () => { comment = commentBox.value; remember(); };
    if (!saved || saved.note) main.append(el('section', { class: 'plan-section', id: 'plan-comment-section', 'aria-label': 'Whole-plan comment' },
      el('h3', {}, 'Whole-plan comment'), el('label', { for: commentBox.id }, 'Comment for the agent on the whole plan (optional)', commentBox)));
    send.onclick = () => {
      send.disabled = true; err.textContent = '';
      sendWithFeedback(`plan:${d.key}`, send, () => call('/api/answers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: d.key, note: comment,
        notes: d.sections.map((s) => notes.get(s.id)), decisions: Object.fromEntries([...picks].map(([k, v]) => [k, v.trim()])) }) }, () => {
        drafts.delete(draftKey); keep(); location.hash = `#answered/${d.key}`;
      })).then((ok) => { if (!ok) update(); });
    };
    main.append(sendLine(`plan:${d.key}`));
    panel.append(el('h2', {}, 'Your answers'), progress, el('div', { class: 'plan-next-row' }, status, next), send, err); panel.hidden = !!saved; update();
    return el('div', { class: `plan-scroll${saved ? ' sent' : ''}` }, el('div', { class: `plan-layout${saved ? ' sent' : ''}` }, main, panel));
  }

  function designReview(d, h1, desk = false) {
    const asked = !!d.accepts;
    // Notes given on an earlier round of the design are history (the card's Activity shows them): the note box and each screen's state start from this round's.
    const now = () => state.decisions.find((x) => x.key === d.key) ?? d;
    const roundNotes = () => (now().earlier_answer ? [] : state.answers[d.key]?.notes ?? []);
    const saved = state.answers[d.key], screens = (d.journeys ?? []).flatMap((journey) => journey.screens.map((screen) => ({ journey, screen }))), savedNote = roundNotes()[0];
    const screenKey = (target) => target && `${target.journey.id}/${target.screen.id}`, screenFor = (key) => screens.find((target) => screenKey(target) === key);
    const note = el('textarea', { maxlength: '500', placeholder: asked ? 'A note: optional with Yes, needed for Change' : 'What should change? (optional for approval)' });
    const pick = el('select', { 'aria-label': 'Pick a direction' }, el('option', { value: '' }, 'Choose a direction'));
    for (const option of d.options ?? []) pick.append(el('option', { value: option.value }, option.label));
    pick.value = saved?.pick ?? '';
    const screenSelect = screens.length > 1 && !asked ? el('select', { 'aria-label': 'Screen for note' }, ...screens.map((target) => el('option', { value: screenKey(target) }, `${target.journey.title} — ${target.screen.title}`))) : '';
    if (designSession?.key !== d.key) designSession = { key: d.key, open: false, selected: '', drafts: new Map(), at: 0 };
    const session = designSession;
    const selectedKey = session.selected || (savedNote?.journey && savedNote?.screen ? `${savedNote.journey}/${savedNote.screen}` : screenKey(screens[0]));
    if (screenSelect) screenSelect.value = screenFor(selectedKey) ? selectedKey : screenKey(screens[0]);
    const target = () => asked ? screens[session.at] ?? screens[0] : screenSelect ? screenFor(screenSelect.value) : screens[0];
    const currentNote = () => roundNotes().find((n) => n.journey === target()?.journey.id && n.screen === target()?.screen.id);
    const screenLine = () => (currentNote() ? (currentNote().verdict === 'approve' ? 'Screen approved' : 'Changes requested') : 'Not reviewed yet');
    note.value = session.drafts.get(screenKey(target())) ?? currentNote()?.note ?? '';
    note.oninput = () => session.drafts.set(screenKey(target()), note.value);
    // The screen's view for this screen's size and theme, and the device it was drawn for: a phone below 960 wide, else a computer.
    const previewView = () => {
      const views = target()?.screen.views ?? {}, form = innerWidth < 960 ? 'phone' : 'computer', theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      const view = [`${form}_${theme}`, `${form}_${theme === 'dark' ? 'light' : 'dark'}`, ...Object.keys(views)].find((k) => views[k]);
      return view ? { path: views[view], form: view.split('_')[0] } : { path: d.preview, form };
    };
    const previewPath = () => previewView().path;
    // A screen that cannot be drawn shows the design's preview picture, and says so.
    const fallback = () => el('figure', { class: 'design-fallback' }, el('figcaption', {}, 'This screen could not be shown: this is the design’s preview picture.'), el('img', { src: src(designUrl(d, d.preview)), alt: `Design preview: ${d.title}` }));
    // A page runs in its device's own viewport, scaled to fit; a picture shows as it is; either in the box when one is named.
    const previewElement = ({ path, form }, cls = '') => {
      const boxed = (e) => (cls ? el('div', { class: cls, 'data-form': form }, e) : e);
      if (d.missing?.includes(path) && path !== d.preview) return boxed(fallback());
      if (/\.html?$/i.test(path)) return deviceFit(el('iframe', { class: 'design-review-preview', src: src(designUrl(d, path)), title: `Design preview: ${d.title}`, sandbox: 'allow-scripts' }), form, cls);
      const img = el('img', { class: 'design-review-preview', src: src(designUrl(d, path)), alt: `Design preview: ${d.title}` });
      if (path !== d.preview) img.onerror = () => img.replaceWith(fallback());
      return boxed(img);
    };
    const fullHref = (path) => src(designUrl(d, d.missing?.includes(path) ? d.preview : path));
    // Design 2: the screen's frames in role order, labelled Before and After when they are today and the new look, else by role; each picture opens full size.
    const ROLE = { today: 'Today', proposed: 'New (proposed)', built: 'New (built)', target: 'Target design' };
    const yesLine = asked ? el('p', { class: 'dz-yes', 'aria-live': 'polite' }) : '';
    const frameView = () => {
      const i = screens.indexOf(target()), frames = target()?.screen.frames ?? [], names = frames.length === 2 && frames[0].role === 'today' ? ['Before', 'After'] : frames.map((f) => ROLE[f.role]);
      const figure = (f, n) => {
        const keys = Object.keys(f.views), view = keys.find((k) => k.endsWith(isDark() ? '_dark' : '_light')) ?? keys[0], path = f.views[view];
        const img = el('img', { src: src(designUrl(d, path)), alt: `${names[n]}: ${target().screen.title}` });
        const pic = el('a', { class: 'dzf-pic', href: fullHref(path), target: '_blank', rel: 'noopener noreferrer', style: view.startsWith('phone') ? '--aw: 390; --ah: 844' : '--aw: 1280; --ah: 800' }, img,
          f.area ? el('span', { class: 'dzf-area', 'aria-hidden': 'true', style: `left: ${f.area.x * 100}%; top: ${f.area.y * 100}%; width: ${f.area.w * 100}%; height: ${f.area.h * 100}%` }) : '');
        img.onload = () => { pic.style.setProperty('--aw', img.naturalWidth); pic.style.setProperty('--ah', img.naturalHeight); };
        return el('figure', { class: 'dzf', ...(f.role === d.accepts && { 'data-yes': '' }) }, el('p', { class: 'dzf-l' }, f.role === d.accepts ? glyph('check') : '', names[n]),
          el('div', { class: 'dzf-box' }, pic), f.caption ? el('figcaption', { dir: 'auto' }, f.caption) : '');
      };
      const step = (delta) => () => { session.at = i + delta; const next = frameView(); preview.replaceWith(next); preview = next; };
      const move = (label, delta, icon) => Object.assign(el('button', { class: 'ui-rb', 'aria-label': label }, glyph(icon)), { disabled: !screens[i + delta], onclick: step(delta) });
      const head = el('div', { class: 'dzf-head' }, el('p', { class: 'dzf-t', dir: 'auto' }, screens.length > 1 ? el('span', { class: 'n' }, `${i + 1} of ${screens.length}`) : '', target().screen.title),
        ...(screens.length > 1 ? [move('Previous screen', -1, 'left'), move('Next screen', 1, 'right')] : []));
      const yes = names[frames.findIndex((f) => f.role === d.accepts)];
      yesLine.textContent = `Yes approves “${yes}”, the frame with the check${screens.length > 1 ? `, on all ${screens.length} screens` : ''}.`;
      return el('section', { class: 'dzf-wrap', 'aria-label': 'What changed' }, head, el('div', { class: 'dzf-row', 'data-n': frames.length }, ...frames.map(figure)));
    };
    let preview = asked ? frameView() : previewPath() ? previewElement(previewView(), 'design-preview-window') : '';
    const fullPreview = previewPath() && !asked ? el('a', { class: 'design-preview-full', href: fullHref(previewPath()), target: '_blank', rel: 'noopener noreferrer' }, 'Open full preview') : '';
    if (screenSelect) screenSelect.onchange = () => {
      const path = previewPath();
      if (preview) { const next = previewElement(previewView(), 'design-preview-window'); preview.replaceWith(next); preview = next; }
      if (fullPreview) fullPreview.href = fullHref(path);
      session.selected = screenKey(target());
      note.value = session.drafts.get(session.selected) ?? currentNote()?.note ?? '';
    };
    const status = el('span', { role: 'status' }, saved ? saved.label : d.status === 'draft' ? 'Draft' : 'In review');
    const err = el('p', { class: 'err', role: 'alert' });
    let saving = false;
    const save = (verdict) => {
      const screen = session.open;
      if (!screen && d.options?.length && !pick.value) { err.textContent = 'Choose a direction before sending your review.'; pick.focus(); return Promise.resolve(); }
      // A screen save (the viewer) sends no design-wide verdict; a note carries the verdict of the button that saved it, on a screen or at design level.
      const selected = asked ? null : target(), text = note.value.trim(), writes = (selected && screen) || text, live = new Set(screens.map(screenKey));
      const notes = roundNotes().filter((n) => (!n.journey || live.has(`${n.journey}/${n.screen}`)) && (n.journey !== selected?.journey.id || n.screen !== selected?.screen.id));
      if (writes) notes.push({ ...(selected && { journey: selected.journey.id, screen: selected.screen.id }), verdict, note: text });
      saving = true; approve.disabled = change.disabled = true;
      return sendWithFeedback(`design:${d.key}`, verdict === 'approve' ? approve : change, () => call('/api/answers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: d.key, ...(!screen && { verdict }), ...(screen && { requested: verdict === 'change' }),
        notes, ...(pick.value && { pick: pick.value }) }) }, () => { session.drafts.set(screenKey(selected), ''); note.value = ''; }))
        .finally(() => { saving = false; approve.disabled = change.disabled = state.readonly; if (session.open) { screenStatus.textContent = screenLine(); stamp(true); } });
    };
    const approve = el('button', { class: 'open-link dz-ink' }, asked ? 'Yes' : 'Approve'), change = el('button', { class: 'dz-change' }, 'Change');
    approve.disabled = change.disabled = state.readonly;
    approve.onclick = () => save('approve').catch((e) => { err.textContent = `Couldn't save: ${e.message}`; });
    change.onclick = () => { if (!note.value.trim()) { err.textContent = asked ? 'Say in the note what should change, then tap Change.' : 'Add a note describing what should change.'; note.focus(); return; } save('change').catch((e) => { err.textContent = `Couldn't save: ${e.message}`; }); };
    const foot = el('div', { class: 'foot' }, approve, change, sendLine(`design:${d.key}`));
    const controls = el('div', { class: 'dz-ctl' }, d.options?.length ? el('label', {}, 'Pick a direction', pick) : '', el('label', {}, asked ? 'Your note' : screens.length ? 'Screen note' : 'Design note', note));
    const open = el('button', { class: 'open-link dz-full', 'aria-haspopup': 'dialog', 'data-design': d.key }, 'Review full screen');
    // Where it stands: its state, the direction picked and when it was answered, then what was said on this round.
    const mark = (path) => { const m = el('span', { class: 'dz-mk', 'aria-hidden': 'true' }); m.innerHTML = `<svg viewBox="0 0 20 20">${path}</svg>`; return m; };
    const prop = (path, k, v) => el('div', { class: 'ui-pr' }, el('span', { class: 'k' }, mark(path), k), el('span', { class: 'v' }, v));
    const option = d.options?.find((o) => o.value === saved?.pick)?.label ?? saved?.pick;
    const stands = el('div', { class: 'ui-props dz-props' }, prop('<circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor"/>', 'State', status),
      option ? prop('<path d="M5 10.4l3.2 3.1L15 6.6"/>', 'Your pick', el('span', { dir: 'auto' }, option)) : '',
      d.reviewed ? prop('<path d="M5 10.4l3.2 3.1L15 6.6"/>', 'Main reviewed', el('span', { dir: 'auto' }, d.reviewed)) : '',
      saved?.at && saved.answer !== 'screens' ? prop('<circle cx="10" cy="10" r="7"/><path d="M10 6.2V10l2.6 1.8"/>', 'Answered', el('span', {}, day(saved.at))) : '');
    const said = roundNotes().filter((n) => n.note);
    const screenName = (n) => screens.length > 1 && screenFor(`${n.journey}/${n.screen}`)?.screen.title;
    const sent = trailOf(d.key).filter((t) => t.kind !== 'discard').at(-1);
    const told = [...(said.length ? [el('p', { class: 'ui-dl' }, 'What you said'), ...said.map((n) => el('blockquote', { class: 'dz-said', dir: 'auto' }, screenName(n) ? el('cite', {}, screenName(n)) : '', el('span', { class: 'q' }, n.note)))] : []),
      ...(sent ? [said.length ? '' : el('p', { class: 'ui-dl' }, 'What you sent'), trailTrack(sent)] : [])];
    seeReply(d.key);
    const lab = el('p', { class: 'dz-lab' }, d.group ? el('span', { class: 'dz-pic' }, projectPic(d.group)) : '', el('span', {}, [d.group, d.filed && day(d.filed)].filter(Boolean).join(' · ')));
    const about = d.about ? el('p', { class: 'about dz-about', dir: 'auto' }, d.about) : '', original = d.link ? el('a', { class: 'dz-link', href: d.link, target: '_blank', rel: 'noopener noreferrer' }, 'Open original design') : '';
    const screenPick = screenSelect ? el('label', {}, 'Screen for note', screenSelect) : '';
    let root;
    if (asked && desk) {
      h1.id = 'dz-open-title';
      root = [el('section', { class: 'dz-open', 'aria-labelledby': h1.id }, el('div', { class: 'dz-oh' }, lab), h1, el('div', { class: 'dz-fill' }, preview)),
        el('section', { class: 'dz-info', 'aria-label': 'Your answer' }, el('div', { class: 'dz-ib' }, el('h2', {}, 'Your answer'), controls, err, about ? el('p', { class: 'ui-dl' }, 'What changed') : '', about,
          el('p', { class: 'ui-dl' }, 'Where it stands'), stands, ticketRow(d), ...told,
          thread(d), original, xBtn(d, 'Discard')), yesLine, foot)];
    } else if (asked) root = el('div', { class: 'design-review' }, lab, h1, about, preview, el('p', { class: 'ui-dl' }, 'Your answer'), controls, foot, yesLine, err,
      el('p', { class: 'ui-dl' }, 'Where it stands'), stands, ticketRow(d), ...told, thread(d), original, xBtn(d, 'Discard'));
    else if (desk) {
      h1.id = 'dz-open-title';
      root = [el('section', { class: 'dz-open', 'aria-labelledby': h1.id }, el('div', { class: 'dz-oh' }, lab, fullPreview, screens.length ? open : ''), h1, el('div', { class: 'dz-fill' }, preview || '')),
        el('section', { class: 'dz-info', 'aria-label': 'Where it stands' }, el('div', { class: 'dz-ib' }, el('h2', {}, 'Where it stands'), stands, ticketRow(d), ...told,
          el('p', { class: 'ui-dl' }, 'Your review'), screenPick, controls, err, about ? el('p', { class: 'ui-dl' }, 'What it shows') : '', about, thread(d), original, xBtn(d, 'Discard')), foot)];
    } else root = el('div', { class: 'design-review' }, lab, h1, about, preview, fullPreview, screens.length ? open : '', el('p', { class: 'ui-dl' }, 'Where it stands'), stands, ticketRow(d), ...told,
      el('p', { class: 'ui-dl' }, 'Your review'), screenPick, controls, foot, err, thread(d), original, xBtn(d, 'Discard'));
    if (!screens.length || asked) return root;
    const heading = el('h2', { id: 'design-screen-title', dir: 'auto' }), count = el('p', { class: 'meta', 'aria-live': 'polite' });
    const stage = el('div', { class: 'design-stage' }), screenStatus = el('p', { class: 'meta', role: 'status' });
    const previous = el('button', { 'aria-label': 'Previous screen' }, '‹ Previous'), next = el('button', { 'aria-label': 'Next screen' }, 'Next ›');
    const close = el('button', { 'aria-label': 'Close viewer' }, 'Close');
    const viewer = el('dialog', { class: 'design-viewer', 'aria-labelledby': heading.id }, el('header', {}, el('div', {}, count, heading), close),
      el('div', { class: 'design-viewer-body' }, stage, el('section', { class: 'design-viewer-panel', 'aria-label': 'Screen review' },
        el('div', { class: 'foot' }, previous, next), screenStatus)));
    const panel = viewer.querySelector('.design-viewer-panel');
    // An approved screen carries a green check stamp, which springs in as the approval is saved.
    const stamp = (pop) => {
      stage.querySelector('.stamp')?.remove();
      if (currentNote()?.verdict !== 'approve') return;
      stage.append(el('span', { class: `stamp${pop ? ' pop' : ''}`, 'aria-hidden': 'true' }, glyph('check')));
      if (pop) buzz('success');
    };
    const draw = () => {
      const i = screens.indexOf(target());
      heading.textContent = `${target().journey.title} — ${target().screen.title}`;
      count.textContent = `${i + 1} of ${screens.length}`;
      previous.disabled = i === 0; next.disabled = i === screens.length - 1;
      stage.replaceChildren(previewElement(previewView())); stage.scrollTop = 0; stamp();
      screenStatus.textContent = screenLine();
      approve.textContent = 'Approve screen'; change.textContent = 'Request change'; err.textContent = '';
    };
    const step = (delta) => {
      const i = screens.indexOf(target()) + delta;
      if (i < 0 || i >= screens.length || saving) return;
      session.drafts.set(screenKey(target()), note.value);
      if (screenSelect) { screenSelect.value = screenKey(screens[i]); screenSelect.onchange(); }
      draw();
    };
    previous.onclick = () => step(-1); next.onclick = () => step(1);
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); shut(); }
      else if (!e.target.closest?.('textarea, input, select') && !e.ctrlKey && !e.metaKey && !e.altKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    viewer.onkeydown = key;
    let touch;
    stage.addEventListener('touchstart', (e) => { touch = e.touches[0]; }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      const end = e.changedTouches[0];
      if (touch && Math.abs(end.clientX - touch.clientX) > 60 && Math.abs(end.clientX - touch.clientX) > Math.abs(end.clientY - touch.clientY) * 1.5) step(end.clientX < touch.clientX ? 1 : -1);
      touch = null;
    });
    // The viewer takes the note and its buttons into its panel while it is open, and puts them back where they were.
    let parked = [];
    open.onclick = () => {
      parked = [controls, foot, err].map((e) => [e, e.parentNode, e.nextSibling]);
      session.open = true; panel.append(controls, foot, err); document.body.append(viewer); draw(); viewer.showModal();
    };
    // A stamp still springing in would hold back the dialog's close event (and the board's redraw), so it lands first.
    const shut = () => { stage.querySelector('.stamp')?.getAnimations().forEach((a) => a.finish()); viewer.close(); };
    close.onclick = shut;
    viewer.onclose = () => {
      session.open = false;
      viewer.remove();
      if (boardStale) {
        boardStale = false;
        render();
        document.querySelector(`[data-design="${CSS.escape(d.key)}"]`)?.focus();
        return;
      }
      for (const [e, parent, next] of parked.reverse()) parent.insertBefore(e, next);
      approve.textContent = 'Approve'; change.textContent = 'Change';
      open.focus();
    };
    return root;
  }

  /** The report a #reports/<key> link opens (or the plan a #waiting/<key> link opens), over the whole board: a bar with the way back and its title, then its page in a sandboxed frame.
   *  The frame is made again only for another page, so a redraw never resets a demo halfway through. */
  /* ---- A guided plan (plan 2) or report (report 3): one scroll, built from the message's fields. ----
     Read receipts and Go deeper are real: a part read for a moment is saved on the board (/api/reads), and Go deeper asks the agent (/api/deeper),
     whose answer (sign-off-axi deeper) is polled and shown under the part that was tapped. */
  function guideView(d) {
    const plan = d.type === 'plan', key = d.key, sections = d.sections ?? [], decisions = plan ? d.decisions ?? [] : [], by = (stage) => sections.filter((s) => s.stage === stage);
    const live = !FROZEN && !state.readonly;
    // View, this browser's choice: a report's pictures Drawn or As lists, and its numbers shown under the parts or not.
    const view = { lists: lsGet('sign-off-view-lists') === '1', nums: lsGet('sign-off-view-nums') !== '0' }, viewHooks = new Set();
    const stages = [d.visual && 'this', d.understood?.length && 'understood', by('found').length && 'found', by('recommend').length && 'recommend', decisions.length && 'decide', d.next && 'next'].filter(Boolean);
    const saved0 = answerOf(key);
    const sentNote = (saved0?.notes ?? []).find((n) => n.section === 'understood');
    // On a report, That is right and Not quite are said to the author as the understood part's Agree and Disagree, so a reload shows what was said.
    const saidU = () => (plan ? undefined : (state.comments ?? []).filter((c) => c.key === key && c.part === 'understood' && c.verdict).at(-1));
    const toldU = (c = saidU()) => (c?.verdict === 'disagree' && c.text ? c : undefined);
    const said0 = saidU();
    const S = { understood: sentNote ? (sentNote.verdict === 'approve' ? 'yes' : 'no') : said0 ? (said0.verdict === 'agree' ? 'yes' : 'no') : null, note: sentNote?.note ?? '', picks: Object.fromEntries(decisions.map((q) => [q.key, saved0?.decisions?.[q.key] ?? q.recommend])), told: !!toldU(said0) };
    const sent = () => answerOf(key)?.answer === 'sent';
    const parts = new Map();   // part id -> its card
    const stageOf = new Map(); // part id -> stage
    const rcs = new Map(), panels = new Map(), deeps = new Map();
    const readAt = (part) => state.reads?.[`${key}/${part}`];
    const changes = () => (S.understood === 'no' ? 1 : 0) + decisions.filter((q) => S.picks[q.key] !== q.recommend).length;

    // ---- receipts: who read this part and when
    const rd = (cls) => E('i', `gdot ${cls ?? ''}`);
    function receipt(part) {
      const at = readAt(part), seen = state.seen_at?.[key], mine = answerOf(key);
      const you = at ? E('span', '', rd(), E('b', '', 'Read by you'), ` ${hhmm(at)}`) : E('span', '', rd('hollow'), 'You have not read this yet');
      const told = part === 'understood' && toldU();
      let agent;
      if (plan && mine?.answer === 'sent' && ((part === 'understood' && sentNoteNow()) || part === 'next' || part.startsWith('d:'))) {
        const what = part === 'understood' ? 'note' : 'answers';
        agent = seen ? E('span', '', rd('agent'), E('b', '', `Agent read your ${what}`), ` ${hhmm(seen)}`) : E('span', '', rd('hollow'), `Agent has not read your ${what} yet`);
      } else if (told) agent = told.read ? E('span', '', rd('agent'), E('b', '', 'Agent read your note'), ` ${hhmm(told.read)}`) : E('span', '', rd('hollow'), 'Agent has not read your note yet');
      else agent = E('span', '', rd('agent'), E('b', '', 'Agent wrote this'), d.filed ? ` ${hhmm(d.filed)}` : '');
      return [you, agent];
    }
    const sentNoteNow = () => (answerOf(key)?.notes ?? []).some((n) => n.section === 'understood' && n.note);
    const rc = (part, small) => { if (!plan) return ''; const box = E('div', `gd-rc${small ? ' s' : ''}`); rcs.set(part + (small ? '~s' : ''), box); return box; };
    const paintRc = () => rcs.forEach((box, k) => box.replaceChildren(...receipt(k.replace(/~s$/, ''))));

    const actionLabels = { question: 'Ask a question', deeper: 'Go deeper', simplify: 'Simplify this', example: 'Show an example', why: 'Why?', custom: 'Your ask' };
    // ---- The person's ask, the agent's answer streaming in under the part
    const asksOf = (part) => (state.deeper ?? []).filter((x) => x.key === key && x.part === part);
    /** What the person sent on this page, by its id, as far as it got (the feedback trail). */
    const sentOf = (id) => (state.trail ?? []).find((t) => t.id === id);
    seeReply(key);
    const unfinished = () => (state.deeper ?? []).some((x) => x.key === key && !x.done);
    function paintAns(part) {
      const panel = panels.get(part), asks = asksOf(part), sig = JSON.stringify([asks, asks.map(a => [state.delivery?.[a.id], again.get(a.id) > Date.now(), sentOf(a.id)])]);
      if (!panel || panel.dataset.sig === sig) return;
      panel.dataset.sig = sig;
      const blocks = asks.map((a) => {
        const delivery = state.delivery?.[a.id];
        const waiting = !a.read, writing = !!a.text && !a.done, late = waiting && Date.now() - Date.parse(a.at) > 60_000;
        const head = [E('i', 'dot'), again.get(a.id) > Date.now() ? `Already sent ${hhmm(a.at)}` : a.done ? `Agent replied ${hhmm(a.answered)}` : writing ? 'Agent is answering' : waiting ? `Sent to the agent ${hhmm(a.at)}` : `Agent got it ${hhmm(a.read)}, working on it`];
        const block = el('div', { class: `gask${a.done ? '' : ' live'}${again.get(a.id) > Date.now() ? ' again' : ''}`, 'data-ask': a.id }, E('div', 'hd', ...head, ...(a.version === 1 && a.text && a.seen !== a.answerRevision ? [E('b', 'gd-chip', 'New')] : [])), E('p', 'q', `${actionLabels[a.action] ?? 'Go deeper'}: ${a.q ?? a.about}`),
          ...(a.selection ? [E('blockquote', '', a.selection.quote)] : []),
          ...(a.version === 1 && delivery?.error ? [E('p', 'gd-err', `Delivery pending: ${delivery.error}`)] : []),
          ...(a.text ? a.text.split(/\n+/).map((t, i, all) => E('p', '', t, ...(writing && i === all.length - 1 ? [E('span', 'caret')] : []))) : [E('div', 'shim', ''), E('div', 'shim', '')]),
          sentOf(a.id) ? trailTrack(sentOf(a.id), false) : '',
          ...(late ? [E('p', 'slow', 'The agent has not picked this up yet. It answers the next time it checks the board.')] : []));
        if (a.version === 1 && a.text && a.seen !== a.answerRevision) { block.dataset.answerId = a.id; block.dataset.answerRevision = a.answerRevision; answerIO.observe(block); }
        return block;
      });
      const done = asks.length && asks.every((a) => a.done);
      const form = el('form', { class: 'gd-fu' }), input = el('input', { 'aria-label': 'Ask a follow-up', placeholder: 'Ask a follow-up', maxlength: '500' }), go = el('button', { type: 'submit' }, 'Ask');
      form.append(input, go);
      form.onsubmit = (e) => { e.preventDefault(); const q = input.value.trim(); if (q) ask(part, q, go); };
      panel.replaceChildren(...blocks, ...(done && live && !d.engagement ? [form] : []));
    }
    // ---- Every ask answers the tap: the control pressed at once, then Sent to the agent with the time in view, then Agent replied.
    // The same ask again (same part, action, words and selection) sends nothing and says Already sent on the first one.
    const outbox = new Map(), again = new Map(); // an ask on its way, by sameness -> tapped again meanwhile; an ask id -> when its Already sent ends
    const same = (part, action, q, sel) => JSON.stringify([part, action ?? 'deeper', q ?? null, sel ? [sel.field, sel.start, sel.end] : null]);
    const sentAs = (s) => (state.deeper ?? []).find((a) => a.key === key && same(a.part, a.action, a.q, a.selection) === s);
    const showAsk = (part, id) => { if (!plan) { openAct(); actBox.querySelector(`[data-ask="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: quick ? 'auto' : 'smooth' }); return; } panels.get(part).hidden = false; panels.get(part).querySelector(`[data-ask="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: quick ? 'auto' : 'smooth' }); };
    const already = (part, a) => { again.set(a.id, Date.now() + 4000); paintAns(part); if (!plan) setTimeout(paintAct, 4100); showAsk(part, a.id); setTimeout(() => paintAns(part), 4100); };
    /** An error with the part's ask: under the part on a plan, in the bar on a report. */
    const fail = (part, node) => { if (plan) { panels.get(part).hidden = false; panels.get(part).append(node); } else flash(node); };
    async function sendAsk(part, action, q, selection, btn, post) {
      const s = same(part, action, q, selection), prior = sentAs(s);
      if (prior) { already(part, prior); return prior; }
      if (outbox.has(s)) { outbox.set(s, true); return; }
      outbox.set(s, false);
      try { if (!await sendWithFeedback(`ask:${key}:${part}`, btn, post)) throw new Error(sending.get(`ask:${key}:${part}`).error); sync(); const a = sentAs(s); if (a) (outbox.get(s) ? already(part, a) : showAsk(part, a.id)); return a; }
      finally { outbox.delete(s); }
    }
    async function ask(part, q, btn) {
      try { await sendAsk(part, 'deeper', q, undefined, btn, () => postJson('/api/deeper', { key, part, ...(q && { q }) })); } catch (e) { fail(part, E('p', 'gd-err', `Could not ask: ${e.message}`)); }
    }
    const deepBtn = (part) => {
      const b = el('button', { class: 'gd-lnk deep', type: 'button', 'aria-expanded': 'false', 'aria-controls': `gd-a-${part.replace(/\W/g, '-')}` }, gic('deeper'), 'Go deeper');
      deeps.set(part, b);
      b.onclick = () => {
        const p = panels.get(part), open = b.getAttribute('aria-expanded') === 'true';
        b.setAttribute('aria-expanded', String(!open)); p.hidden = open;
        if (!open && !asksOf(part).length) ask(part, undefined, b);
      };
      return b;
    };
    const ansPanel = (part) => { const p = el('div', { class: 'gd-panel gd-ans', id: `gd-a-${part.replace(/\W/g, '-')}`, hidden: '', 'aria-live': 'polite' }); panels.set(part, p); return p; };
    const detailsBtn = (part, rows) => {
      const id = `gd-d-${part.replace(/\W/g, '-')}`, b = el('button', { class: 'gd-lnk', type: 'button', 'aria-expanded': 'false', 'aria-controls': id }, 'Details', gic('chev', 'gchev'));
      const p = el('div', { class: 'gd-panel', id, hidden: '' }, el('table', { class: 'gd-dt' }, el('caption', { style: 'position:absolute;width:1px;height:1px;overflow:hidden' }, 'The numbers'),
        ...rows.map((r) => el('tr', {}, el('th', { scope: 'row' }, r.label), el('td', {}, r.value)))));
      b.onclick = () => { const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); p.hidden = !open; };
      return [b, p];
    };
    async function engage(part, action, q, id = crypto.randomUUID(), selection, btn) {
      try { return await sendAsk(part, action, q, selection, btn, () => postJson('/api/engagement', { version: 1, id, key, ...d.engagement, part, action, ...(q !== undefined && { q }), ...(selection && { selection }) })); }
      catch (e) {
        const retry = el('button', { type: 'button', class: 'gd-lnk' }, 'Retry');
        const error = E('p', 'gd-err', `Could not ask: ${e.message} `, retry);
        retry.onclick = () => { error.remove(); engage(part, action, q, id, selection, retry); };
        fail(part, error);
      }
    }
    // The presets and the composer for one part. With a selection they ask about those words, through this same engage().
    const controls = (part, selection) => {
      const form = el('form', { class: 'gd-fu' }), input = el('input', { 'aria-label': selection ? 'Ask about the selected text' : 'Ask about this part', placeholder: selection ? 'Ask about these words' : 'Ask about this' }), send = el('button', { type: 'submit' }, 'Send');
      let action = 'custom';
      form.append(input, send); form.hidden = !!selection;
      form.onsubmit = async (e) => { e.preventDefault(); if (input.value.trim()) { const sent = engage(part, action, input.value, undefined, selection, send); if (selection) asked(part, sent); if (await sent) { input.value = ''; action = 'custom'; input.placeholder = 'Ask a follow-up'; } } };
      const buttons = Object.entries(actionLabels).filter(([a]) => a !== 'custom').map(([a, label]) => {
        const b = el('button', { class: `gd-lnk ${a === 'deeper' ? 'deep' : a}`, type: 'button' }, label);
        b.onclick = () => { if (a === 'question') { action = a; form.hidden = false; input.focus(); } else { const sent = engage(part, a, undefined, undefined, selection, b); if (selection) asked(part, sent); } };
        return b;
      });
      return [E('div', 'gd-acts', ...buttons), form];
    };
    // ---- Agree, Disagree and Comment on a part: posted through /api/annotations like a note on a design, taken by the author agent's wait
    const said = (part) => (state.comments ?? []).filter((c) => c.key === key && c.part === part);
    const votes = new Map(), threads = new Map();
    const verdictOf = (part) => said(part).filter((c) => c.verdict).at(-1)?.verdict;
    function paintTalk(part) {
      const v = verdictOf(part), pair = votes.get(part);
      if (pair) for (const [name, b] of Object.entries(pair)) { const on = v === name; b.setAttribute('aria-pressed', String(on)); b.lastChild.textContent = on ? name === 'agree' ? 'Agreed' : 'Disagreed' : name === 'agree' ? 'Agree' : 'Disagree'; }
      const box = threads.get(part), mine = said(part).filter((c) => c.text), sig = JSON.stringify([mine, mine.map((c) => sentOf(c.id))]);
      if (!box || box.dataset.sig === sig) return;
      box.dataset.sig = sig;
      box.replaceChildren(...mine.flatMap((c) => [E('div', 'gd-cmt', E('span', 'av', 'Y'),
        E('div', 'hd', E('b', '', 'You'), ...(c.verdict ? [E('span', 'verdict ' + c.verdict, c.verdict === 'agree' ? 'Agree' : 'Disagree')] : []), E('span', '', hhmm(c.at))),
        E('p', '', c.text), sentOf(c.id) ? trailTrack(sentOf(c.id), false) : ''),
        ...(c.reply ? [E('div', 'gd-cmt agent', E('span', 'av', 'A'), E('div', 'hd', E('b', '', 'Agent'), E('span', '', hhmm(c.replied))), E('p', '', c.reply))] : [])]));
    }
    const acts = (part, rows, inItem) => {
      // A report's parts carry no buttons: its one bar and its Activity do the acting (reportBar). What stays is content, the numbers.
      if (!plan) { const thread = E('div', 'gd-thread'); threads.set(part, thread); queueMicrotask(() => paintTalk(part)); return [...(rows?.length ? [el('table', { class: 'gd-dt gd-nums' }, el('caption', { style: 'position:absolute;width:1px;height:1px;overflow:hidden' }, 'The numbers'), ...rows.map((r) => el('tr', {}, el('th', { scope: 'row' }, r.label), el('td', {}, r.value))))] : []), thread]; }
      const [db, dp] = rows?.length ? detailsBtn(part, rows) : [];
      const panel = live ? ansPanel(part) : null;
      if (!live) return [E('div', 'gd-acts', ...(db ? [db] : [])), ...(dp ? [dp] : [])];
      const err = E('p', 'gd-err'), ta = el('textarea', { rows: '2', maxlength: '500' }), send = el('button', { type: 'submit', class: 'gd-send', disabled: '' }, 'Send'), cancel = el('button', { type: 'button', class: 'gd-q' }, 'Cancel');
      const hint = E('span', 'gd-hint'), box = el('form', { class: 'gd-cbox', hidden: '' }, ta, E('div', 'gd-cbar', hint, cancel, send), err);
      err.setAttribute('role', 'alert');
      let mode = 'comment', lean;
      const copy = { comment: ['Comment for the agent', 'To the agent that wrote this'], disagree: ['What is off?', 'To the agent that wrote this'], question: ['Ask about this part', 'The answer appears here'] };
      const paint = () => { const c = copy[mode === 'question' ? mode : lean ?? mode]; ta.placeholder = c[0]; ta.setAttribute('aria-label', c[0]); hint.textContent = c[1]; send.disabled = !ta.value.trim(); };
      const comment = el('button', { type: 'button', class: 'gd-v cmt', 'aria-expanded': 'false', title: 'Comment' }, gic('cmt'), E('span', '', 'Comment'));
      const open = (m, v) => { mode = m; lean = v; box.hidden = false; err.textContent = ''; comment.setAttribute('aria-expanded', String(m === 'comment' && !v)); paint(); ta.focus({ preventScroll: true }); };
      const close = () => { box.hidden = true; ta.value = ''; lean = undefined; comment.setAttribute('aria-expanded', 'false'); paint(); };
      comment.onclick = () => (box.hidden || mode !== 'comment' ? open('comment') : close());
      cancel.onclick = close; ta.oninput = paint; ta.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
      const post = (body) => sendWithFeedback(`part:${key}:${part}`, send, async () => { await postJson('/api/annotations', { key, part, ...body }); sync(); });
      box.onsubmit = async (e) => {
        e.preventDefault(); const text = ta.value.trim(); if (!text || sending.get(`part:${key}:${part}`)?.busy) return;
        send.disabled = ta.disabled = cancel.disabled = comment.disabled = true;
        if (mode === 'question') { if (await engage(part, 'question', text, undefined, undefined, send)) close(); } else if (await post({ text, ...(lean && { verdict: lean }) })) close();
        ta.disabled = cancel.disabled = comment.disabled = false; paint();
      };
      const vote = (name, label, icon) => el('button', { type: 'button', class: 'gd-v ' + name + (inItem ? ' icon-only' : ''), 'aria-pressed': 'false', title: label }, gic(icon), E('span', '', label));
      const agree = vote('agree', 'Agree', 'up'), disagree = vote('disagree', 'Disagree', 'down');
      agree.onclick = () => { if (verdictOf(part) !== 'agree') post({ verdict: 'agree' }); };
      disagree.onclick = () => open('comment', 'disagree');
      votes.set(part, { agree, disagree });
      const thread = E('div', 'gd-thread');
      threads.set(part, thread);
      let ask = [];
      if (live && d.engagement) {
        const more = el('button', { type: 'button', class: 'gd-more', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, gic('spark'), E('span', '', 'Ask'), gic('chev', 'gchev'));
        const menu = el('div', { class: 'gd-menu', role: 'menu', hidden: '' }, ...MENU.map(([a, icon, sub]) => {
          const b = el('button', { type: 'button', role: 'menuitem', class: a === 'deeper' ? 'deep' : a }, gic(icon), E('span', '', actionLabels[a]), E('small', '', sub));
          b.onclick = () => { shutMenus(); if (a === 'question') open('question'); else engage(part, a, undefined, undefined, undefined, more); };
          return b;
        }));
        more.onclick = () => { const o = menu.hidden; shutMenus(); menu.hidden = !o; more.setAttribute('aria-expanded', String(o)); menu.classList.toggle('down', more.getBoundingClientRect().top < 340); };
        ask = [E('div', 'gd-menuwrap', more, menu)];
      } else if (live) ask = [deepBtn(part)];
      queueMicrotask(() => paintTalk(part));
      return [...(dp ? [dp] : []), thread, box, sendLine(`part:${key}:${part}`), sendLine(`ask:${key}:${part}`), E('div', 'gd-acts gd-foot' + (d.engagement ? '' : ' legacy'), agree, disagree, comment, E('span', 'sp'), ...(db ? [db] : []), ...ask), panel];
    };

    // ---- selected words: native selection of one authored field, offered the same presets right under that field
    const fld = (part, field, node) => { if (part && d.engagement) { node.dataset.sp = part; node.dataset.sf = field; } return node; };
    const tray = el('aside', { class: 'gd-selq', role: 'group', 'aria-label': 'Ask about the selected text', hidden: '' });
    let pressing = false;
    const fieldOf = (n) => (n?.nodeType === 1 ? n : n?.parentElement)?.closest('[data-sf]');
    // One authored field, counted in Unicode code points. null: nothing usable is selected. cross: it runs over more than one field.
    function selected() {
      const s = getSelection();
      if (!live || !s?.rangeCount || s.isCollapsed) return null;
      const r = s.getRangeAt(0), f = fieldOf(r.startContainer) ?? fieldOf(r.endContainer);
      if (!f || !root.contains(f)) return null;
      const whole = document.createRange(), inside = r.cloneRange();
      whole.selectNodeContents(f);
      if (r.compareBoundaryPoints(Range.START_TO_START, whole) < 0) inside.setStart(whole.startContainer, whole.startOffset);
      if (r.compareBoundaryPoints(Range.END_TO_END, whole) > 0) inside.setEnd(whole.endContainer, whole.endOffset);
      if (inside.toString().length !== r.toString().length) return { f, cross: true };
      const quote = inside.toString(), head = whole.cloneRange();
      head.setEnd(inside.startContainer, inside.startOffset);
      const start = [...head.toString()].length;
      return quote.trim() ? { f, part: f.dataset.sp, selection: { field: f.dataset.sf, start, end: start + [...quote].length, quote } } : null;
    }
    function drop(clear) {
      tray.hidden = true; tray.replaceChildren(); delete tray.dataset.sig;
      if (clear) getSelection().removeAllRanges();
    }
    // After a send from the tray the answer lands at the end of the part; say it was sent and when, and offer to go there.
    async function asked(part, sending) {
      const show = el('button', { type: 'button', class: 'gd-lnk' }, 'Show'), line = E('p', 'gd-selt', 'Sending… ');
      show.onclick = () => { if (plan) panels.get(part).scrollIntoView({ block: 'center' }); else openAct(); drop(); };
      getSelection().removeAllRanges();
      tray.replaceChildren(line); tray.dataset.sig = 'asked';
      const a = await sending;
      if (tray.dataset.sig !== 'asked') return;
      if (!a) { drop(); return; }
      line.replaceChildren(`${again.get(a.id) > Date.now() ? 'Already sent' : 'Sent to the agent'} ${hhmm(a.at)}. ${plan ? 'The answer appears under this part.' : 'The answer comes in Activity.'} `, show);
      setTimeout(() => tray.dataset.sig === 'asked' && drop(), 8000);
    }
    function follow() {
      if (!root.isConnected) { document.removeEventListener('selectionchange', follow); return; }
      if (pressing || tray.contains(document.activeElement)) return;
      const now = selected();
      if (!now) { if (tray.dataset.sig !== 'asked') drop(); return; }
      const sig = JSON.stringify(now.selection ?? 'cross');
      if (tray.dataset.sig === sig) return;
      let at = now.f.closest('.rowstat') ?? now.f;
      while (!at.matches('.rowstat') && !['DIV', 'SECTION'].includes(at.parentElement.tagName)) at = at.parentElement;
      at.after(tray);
      tray.hidden = false; tray.dataset.sig = sig;
      tray.replaceChildren(...(!now.selection || [...now.selection.quote].length > 500 ? [E('p', 'gd-selt', 'Select up to 500 characters inside one paragraph to ask about them.')]
        : [E('p', 'gd-selt', 'Ask about ', E('q', '', now.selection.quote)), ...controls(now.part, now.selection)]));
    }
    document.addEventListener('selectionchange', follow);
    // A tap on a preset can clear the browser's selection first on a phone; keep the tray until that tap has landed.
    tray.addEventListener('pointerdown', () => { pressing = true; setTimeout(() => { pressing = false; follow(); }, 600); });
    tray.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); drop(true); } });

    // ---- the picture
    // ---- diagrams. dgAll counts the views in the order the server's ~diagram.<n> route does.
    const dgAll = [d.visual?.diagram, ...sections.flatMap((s) => [s.diagram, ...(s.items ?? []).map((i) => i.diagram)])].filter(Boolean).flat();
    const night = matchMedia('(prefers-color-scheme: dark)'), phone = matchMedia('(max-width: 43.6875rem)');
    /** The picture in a sandboxed frame, its views as tabs; Show me opens the interactive viewer in place, Full size in a tab. */
    /** A report's picture: its views as tabs, the picture opening full size by a tap on it (a corner mark says so); its rows as a list under it when View says As lists. */
    function pictureFig(views, list) {
      let cur = 0;
      const frame = el('iframe', { sandbox: 'allow-scripts', loading: 'lazy' }), wide = el('a', { class: 'gd-corner', target: '_blank', rel: 'noopener' }, gic('full'), E('span', 'vh', 'Full size'));
      const box = E('div', 'gd-dgbox', frame, wide), panel = list ? E('div', 'gd-panel', list) : null;
      const paint = () => {
        const v = views[cur], url = `${mockUrl(d.key, `diagram.${dgAll.indexOf(v)}`, v.src)}?theme=${(() => { try { return isDark(); } catch { return night.matches; } })() ? 'dark' : 'light'}`;
        frame.style.height = ''; frame.title = `Diagram: ${v.label}`; frame.src = `${url}&embed=1`;
        wide.href = src(phone.matches ? `${url}&embed=1` : url); wide.setAttribute('aria-label', `Full size: ${v.label}`);
        tabs.forEach((b, i) => b.setAttribute('aria-pressed', String(i === cur)));
        if (panel) panel.hidden = !view.lists;
      };
      const tabs = views.length > 1 ? views.map((v, i) => { const b = el('button', { class: 'gd-choice', type: 'button', 'aria-pressed': 'false' }, v.label); b.onclick = () => { cur = i; paint(); }; return b; }) : [];
      const fig = E('figure', 'gd-fig gd-dg', ...(tabs.length ? [E('div', 'gd-seg', ...tabs)] : []), box, ...(panel ? [panel] : []));
      for (const q of [night, phone]) q.addEventListener('change', () => { if (fig.isConnected) paint(); });
      viewHooks.add(() => fig.isConnected && paint());
      paint();
      return fig;
    }
    function diagramFig(views, list) {
      if (!plan) return pictureFig(views, list);
      let cur = 0, full = false, listOpen = false;
      const frame = el('iframe', { sandbox: 'allow-scripts', loading: 'lazy' }), box = E('div', 'gd-dgbox', frame);
      const panel = list ? E('div', 'gd-panel', list) : null;
      const paint = () => {
        const v = views[cur], url = `${mockUrl(d.key, `diagram.${dgAll.indexOf(v)}`, v.src)}?theme=${(() => { try { return isDark(); } catch { return night.matches; } })() ? 'dark' : 'light'}`;
        box.classList.toggle('full', full);
        frame.style.height = ''; // a height the picture's own size handshake set must not outlive its mode
        frame.title = `${full ? 'Interactive diagram' : 'Diagram'}: ${v.label}`;
        frame.src = full ? url : `${url}&embed=1`;
        wide.href = src(phone.matches ? `${url}&embed=1` : url); // a phone's Full size is the drawing alone, at the screen's width
        tabs.forEach((b, i) => b.setAttribute('aria-pressed', String(i === cur)));
        showLabel.nodeValue = full ? 'Back to the picture' : 'Show me';
        show.setAttribute('aria-expanded', String(full));
        if (panel) { panel.hidden = !listOpen; listBtn.setAttribute('aria-expanded', String(listOpen)); }
      };
      const tabs = views.length > 1 ? views.map((v, i) => { const b = el('button', { class: 'gd-choice', type: 'button', 'aria-pressed': 'false' }, v.label); b.onclick = () => { cur = i; paint(); }; return b; }) : [];
      const showLabel = document.createTextNode('Show me');
      const show = el('button', { class: 'gd-lnk deep gd-show', type: 'button', 'aria-expanded': 'false' }, showLabel, gic('chev', 'gchev'));
      show.onclick = () => { full = !full; paint(); };
      const wide = el('a', { class: 'gd-lnk', target: '_blank', rel: 'noopener' }, 'Full size');
      const listBtn = el('button', { class: 'gd-lnk', type: 'button', 'aria-expanded': 'false' }, 'As a list', gic('chev', 'gchev'));
      listBtn.onclick = () => { listOpen = !listOpen; paint(); };
      const fig = E('figure', 'gd-fig gd-dg', ...(tabs.length ? [E('div', 'gd-seg', ...tabs)] : []), box, E('div', 'gd-dgbar', show, wide, ...(list ? [listBtn] : [])), ...(panel ? [panel] : []));
      for (const q of [night, phone]) q.addEventListener('change', () => { if (fig.isConnected) paint(); });
      paint();
      return fig;
    }
    // ---- galleries: a design output's options, each with its phone and desktop frame. glAll counts the frames in the order the server's ~gallery.<n> route does.
    const glAll = sections.flatMap((s) => (s.gallery ?? []).flatMap((o) => o.frames));
    const glUrl = (f, light) => src(`${mockUrl(d.key, `gallery.${glAll.indexOf(f)}`, f.src)}${light ? '?v=light' : ''}`);
    const DEVICES = { phone: [390, 844, 'Phone'], desktop: [1280, 800, 'Desktop'] };
    const stamp = (o) => `${o.model} · ${day(o.ran)} ${hhmm(o.ran)}`;
    const frameView = (f, title, light) => /\.html?$/i.test(f.src) ? el('iframe', { src: glUrl(f), title, sandbox: 'allow-scripts', loading: 'lazy', tabindex: '-1' })
      : el('img', { src: glUrl(f, light), alt: title, loading: 'lazy', decoding: 'async' });
    /** The options as a swipeable strip (a row on a desk), each with its frames side by side and a caption under each; a tap opens the sequence full size at that option. */
    function galleryFig(opts) {
      const fit = new ResizeObserver((rows) => rows.forEach((r) => r.target.style.setProperty('--s', r.contentRect.width / r.target.dataset.vw)));
      return E('ul', 'gl-strip gd-wide', ...opts.map((o, i) => E('li', 'gl-opt', E('div', 'gl-head', E('b', 'gl-name', o.label), E('span', 'gl-n', `${i + 1} of ${opts.length}`)),
        E('div', `gl-pair${o.frames.length === 1 ? ' one' : ''}`, ...[...o.frames].sort((a, b) => (b.device === 'phone') - (a.device === 'phone')).map((f) => {
          const [w, h, name] = DEVICES[f.device], page = /\.html?$/i.test(f.src);
          const b = el('button', { class: `gl-frame ${f.device}`, type: 'button', 'aria-label': `Open ${o.label}, ${name.toLowerCase()}, full size`, 'data-gl': `${d.key}~${glAll.indexOf(f)}`, style: `--ar:${w} / ${h};--vw:${w}px;--vh:${h}px` }, frameView(f, `${o.label}, ${name.toLowerCase()}: ${f.caption}`, true));
          if (page) { b.dataset.vw = w; fit.observe(b); }
          b.onclick = () => openGallery(opts, i, f.device, b.dataset.gl);
          return E('figure', 'gl-f', b, E('figcaption', '', E('span', 'gl-cap', f.caption), E('small', '', stamp(o))));
        })))));
    }
    /** The options full screen, one at a time: Previous and Next (or a swipe, or the arrow keys) move between options, Phone and Desktop switch the frame. `seq` is the order to walk, so another list can plug in. */
    function openGallery(seq, start, device, from) {
      let at = start, dev = device;
      const frameOf = () => seq[at].frames.find((f) => f.device === dev) ?? seq[at].frames[0];
      const title = el('h2', { id: 'gl-title', tabindex: '-1', autofocus: '', dir: 'auto' }), count = el('span', { class: 'gl-count', 'aria-live': 'polite' }), cap = el('p', { class: 'gl-full-cap' });
      const close = el('button', { class: 'pf-close', 'aria-label': 'Close full size' }, glyph('x'), 'Close');
      const prev = el('button', { class: 'gl-nav', 'aria-label': 'Previous option' }, glyph('left')), next = el('button', { class: 'gl-nav', 'aria-label': 'Next option' }, glyph('right'));
      const sizes = Object.entries(DEVICES).map(([k, [w, , name]]) => el('button', { 'aria-pressed': 'false', 'aria-label': `${name}, ${w} wide`, 'data-size': k }, glyph(k), el('span', { class: 'pf-name', 'aria-hidden': 'true' }, name, el('span', { class: 'pf-w' }, String(w)))));
      const port = el('div', { class: 'pf-port' }), stage = el('div', { class: 'pf-stage', 'data-mode': 'one' }, el('figure', { class: 'pf-frame pf-main framed' }, port));
      const dialog = el('dialog', { class: 'proto-full gl-full', 'aria-labelledby': 'gl-title' },
        el('header', { class: 'pf-bar' }, el('div', { class: 'pf-top' }, close, title), el('div', { class: 'pf-tools' }, prev, count, next, el('div', { class: 'seg pf-size', role: 'group', 'aria-label': 'Size' }, ...sizes))), stage, cap);
      const lay = () => {
        const [w, h] = DEVICES[frameOf().device], box = stage.getBoundingClientRect(), pad = 16, scale = Math.min(1, (box.width - pad * 2) / w, (box.height - pad * 2) / h);
        Object.entries({ '--w': w * scale, '--h': h * scale, '--vw': w, '--vh': h, '--s': scale }).forEach(([k, v]) => port.style.setProperty(k, k === '--s' ? v : `${v}px`));
      };
      const paint = () => {
        const o = seq[at], f = frameOf();
        dev = f.device;
        title.textContent = o.label; count.textContent = `${at + 1} of ${seq.length}`;
        cap.replaceChildren(el('span', {}, f.caption), el('small', {}, stamp(o)));
        const t = `${o.label}: ${f.caption}`;
        port.replaceChildren(/\.html?$/i.test(f.src) ? frameView(f, t) : el('div', { class: 'pf-img' }, frameView(f, t)));
        prev.disabled = at === 0; next.disabled = at === seq.length - 1;
        sizes.forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.size === dev)); b.disabled = !o.frames.some((x) => x.device === b.dataset.size); });
        lay();
      };
      const go = (n) => { if (n >= 0 && n < seq.length) { at = n; paint(); } };
      prev.onclick = () => go(at - 1); next.onclick = () => go(at + 1);
      sizes.forEach((b) => (b.onclick = () => { dev = b.dataset.size; paint(); }));
      dialog.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') go(at - 1); else if (e.key === 'ArrowRight') go(at + 1); });
      let x0, y0;
      stage.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; });
      stage.addEventListener('pointerup', (e) => { const dx = e.clientX - x0, dy = e.clientY - y0; if (x0 !== undefined && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(at + (dx < 0 ? 1 : -1)); x0 = undefined; });
      const fit = new ResizeObserver(lay);
      const shut = () => {
        if (!dialog.isConnected) return;
        fit.disconnect(); dialog.close(); dialog.remove();
        document.querySelector(`[data-gl="${CSS.escape(from)}"]`)?.focus({ preventScroll: true });
      };
      close.onclick = shut; dialog.onclose = shut;
      document.body.append(dialog); dialog.showModal(); fit.observe(stage); paint();
    }
    // ---- the report kit: a section's blocks, drawn in the board's own style. A block's files are the section's pins, served after the gallery frames by the same ~gallery.<n> route.
    const pinAll = sections.flatMap((s) => s.pins ?? []);
    const kitUrl = (s, file, light) => src(`${mockUrl(d.key, `gallery.${glAll.length + pinAll.indexOf(s.pins.find((p) => p.src === file))}`, file)}${light ? '?v=light' : ''}`);
    const KT_STATUS = { fixed: 'Fixed', progress: 'In progress', waiting: 'Waiting on you' };
    // Every image and video in this report, in reading order, so the shared viewer can swipe through the whole set.
    const reportMedia = [];
    for (const s of sections) {
      for (const o of s.gallery ?? []) for (const f of o.frames) reportMedia.push({ url: glUrl(f), caption: f.caption || '', source: o.label || s.heading || d.title || '' });
      for (const b of s.blocks ?? []) {
        if (b.type === 'image') reportMedia.push({ url: kitUrl(s, b.full || b.src), caption: b.caption || '', source: s.heading || d.title || '' });
        else if (b.type === 'video') reportMedia.push({ url: kitUrl(s, b.src), video: true, caption: b.caption || '', source: s.heading || d.title || '' });
        else if (b.type === 'beats') for (const x of b.beats) if (x.image) reportMedia.push({ url: kitUrl(s, x.image), caption: x.title || '', source: s.heading || d.title || '' });
        else if (b.type === 'compare') {
          reportMedia.push({ url: kitUrl(s, b.before.image), caption: b.before.caption || '', source: 'Before' });
          reportMedia.push({ url: kitUrl(s, b.after.image), caption: b.after.caption || '', source: 'After' });
        } else if (b.type === 'evidence') for (const r of b.rows) if (r.image) reportMedia.push({ url: kitUrl(s, r.image), caption: r.title || '', source: s.heading || d.title || '' });
      }
    }
    const openReportMedia = (url, from) => {
      const i = reportMedia.findIndex((m) => m.url === url || m.url.split('?')[0] === url.split('?')[0]);
      openMediaViewer(reportMedia, i < 0 ? 0 : i, from);
    };
    const mediaBtn = (preview, full, alt, cls = 'media-open') => {
      const b = el('button', { type: 'button', class: cls, 'aria-label': `Open ${alt || 'image'}` }, el('img', { src: preview, alt: alt || '', loading: 'lazy', decoding: 'async' }));
      b.onclick = () => openReportMedia(full, b);
      return b;
    };
    function beatsFig(s, b) {
      const n = b.beats.length, img = el('img', { alt: '', decoding: 'async' }), count = E('p', 'count'), title = el('h3'), words = E('p', ''), segs = el('div', { class: 'kb-segs', role: 'group' });
      const open = el('button', { type: 'button', class: 'media-open', 'aria-label': 'Open beat image' }, img);
      open.onclick = () => { const x = b.beats[at]; if (x?.image) openReportMedia(kitUrl(s, x.image), open); };
      const dots = b.beats.map((x, i) => { const t = el('button', { type: 'button', 'aria-label': `Beat ${i + 1} of ${n}: ${x.title}` }); t.onclick = () => show(i); return t; });
      segs.append(...dots);
      const back = el('button', { class: 'kb-btn', type: 'button' }, 'Back'), next = el('button', { class: 'kb-btn go', type: 'button' });
      const stage = E('div', 'kb-stage', open, E('div', 'kb-words', count, title, words));
      let at = 0;
      function show(i) {
        at = i; const x = b.beats[i];
        dots.forEach((t, k) => { t.classList.toggle('on', k <= i); if (k === i) t.setAttribute('aria-current', 'step'); else t.removeAttribute('aria-current'); });
        segs.setAttribute('aria-label', `Beat ${i + 1} of ${n}`);
        img.hidden = !x.image; open.hidden = !x.image; stage.classList.toggle('no-image', !x.image);
        if (x.image) img.src = kitUrl(s, x.image, true); img.alt = x.title;
        open.setAttribute('aria-label', `Open beat image: ${x.title}`);
        count.textContent = `Beat ${i + 1} of ${n}`;
        title.replaceChildren(...(x.time ? [E('span', '', x.time)] : []), document.createTextNode(x.title));
        words.textContent = x.text ?? '';
        back.disabled = i === 0; next.textContent = i === n - 1 ? 'Start again' : 'Next';
      }
      back.onclick = () => show(Math.max(0, at - 1)); next.onclick = () => show(at === n - 1 ? 0 : at + 1);
      show(0);
      return E('div', 'kt kt-beats', segs, stage, E('div', 'kb-nav', back, next));
    }
    function videoFig(s, b) {
      const frame = E('div', 'frame'), play = el('button', { class: 'play', type: 'button', 'aria-label': b.caption ? `Play the film: ${b.caption}` : 'Play the film' }, E('i', '', gic('play')));
      frame.append(el('img', { src: kitUrl(s, b.poster, true), alt: '', loading: 'lazy', decoding: 'async' }), play, ...(b.length ? [E('span', 'len', b.length)] : []));
      // Poster play still starts inline; a second tap on the playing video opens the shared viewer so the film sits in the report's media set.
      play.onclick = () => {
        const v = el('video', { src: kitUrl(s, b.src), controls: '', autoplay: '', playsinline: '', poster: kitUrl(s, b.poster, true), 'aria-label': b.caption ?? 'Film' });
        frame.replaceChildren(v); v.play?.().catch(() => {}); v.focus();
        v.addEventListener('click', (e) => { if (e.target === v) openReportMedia(kitUrl(s, b.src), v); });
      };
      return E('figure', 'kt kt-video gd-wide', frame, ...(b.caption ? [E('figcaption', 'kt-cap', b.caption)] : []));
    }
    function blockFig(s, b) {
      const local = (file) => `${kitUrl(s, file)}?download=1`;
      if (b.type === 'text') return b.level ? mdSpan(`h${b.level}`, 'kt', b.text, { local }) : mdDiv(b.text, { local });
      if (b.type === 'callout') return E('div', `kt kt-callout ${b.tone ?? 'note'}`, E('span', 'tile', gic(b.tone === 'warn' ? 'warn' : b.tone === 'ask' ? 'deeper' : 'info')), E('div', '', mdSpan('b', '', b.title, NOLINK), mdSpan('span', '', b.text)));
      if (b.type === 'beats') return beatsFig(s, b);
      if (b.type === 'video') return videoFig(s, b);
      if (b.type === 'image') {
        const preview = kitUrl(s, b.src, true), full = kitUrl(s, b.full || b.src);
        return E('figure', 'kt kt-image', mediaBtn(preview, full, b.alt ?? b.caption ?? ''), ...(b.caption ? [E('figcaption', 'kt-cap', b.caption)] : []));
      }
      if (b.type === 'file') return el('a', { class: 'kt kt-file', href: local(b.src), download: '' }, b.caption);
      if (b.type === 'table') {
        const wide = b.columns.length > 5 || [...b.columns, ...b.rows.flat()].some((c) => typeof c === 'object') || b.rows.some((r) => r.length !== b.columns.length);
        const cell = (c, tag, i) => el(tag, { ...(tag === 'th' ? { scope: 'col' } : !wide && i ? { 'data-h': b.columns[i] } : {}), ...(typeof c === 'object' ? { colspan: c.colspan ?? 1, rowspan: c.rowspan ?? 1 } : {}) }, mdSpan('span', '', typeof c === 'object' ? c.text : c, { local }));
        const table = el('table', { class: `kt-table${wide ? ' kt-wide' : ''}` }, el('thead', {}, el('tr', {}, ...b.columns.map((c, i) => cell(c, 'th', i)))), el('tbody', {}, ...b.rows.map((r) => el('tr', {}, ...r.map((c, i) => cell(c, 'td', i))))));
        return el('div', { class: `kt${wide ? ' kt-scroll' : ''}`, ...(wide ? { tabindex: '0', role: 'region', 'aria-label': 'Table' } : {}) }, table);
      }
      if (b.type === 'compare') return E('div', 'kt kt-compare', ...[['Before', b.before], ['After', b.after]].map(([w, x]) => E('figure', '', mediaBtn(kitUrl(s, x.image, true), kitUrl(s, x.image), `${w}: ${x.caption}`), E('figcaption', '', E('b', '', w), x.caption))));
      return el('ul', { class: 'kt kt-evid' }, ...b.rows.map((r) => E('li', '', ...(r.image ? [mediaBtn(kitUrl(s, r.image, true), kitUrl(s, r.image), r.title || '')] : []), E('div', '', E('b', '', r.title), ...(r.note ? [E('small', '', r.note)] : [])), E('span', `kt-status ${r.status}`, KT_STATUS[r.status]))));
    }
    function visual(v) {
      let body;
      if (v.type === 'bars') {
        const pair = v.rows.some((r) => r.before !== undefined), max = Math.max(...v.rows.flatMap((r) => [r.value, r.before ?? 0])) * 1.04 || 1, u = v.unit ? ` ${v.unit}` : '';
        body = E('div', 'gd-bars', ...v.rows.map((r) => E('div', 'br', E('div', 'lab', E('span', '', r.label), E('small', '', r.note ? `${r.note} · ` : '', E('span', 'gv', pair && r.before !== undefined ? `${gnum(r.before)}${u} to ${gnum(r.value)}${u}` : `${gnum(r.value)}${u}`))),
          pair ? E('div', 'pair', E('div', 'gd-track thin', el('i', { class: 'ghost', style: `width:${((r.before ?? 0) / max) * 100}%` })), E('div', 'gd-track', el('i', { class: r.tone ?? '', style: `width:${(r.value / max) * 100}%` })))
            : E('div', 'gd-track', el('i', { class: r.tone ?? '', style: `width:${(r.value / max) * 100}%` })))));
      } else if (v.type === 'steps') {
        body = E('ol', 'gd-chain', ...v.rows.map((r, i) => E('li', '', E('span', `nd ${r.tone ?? ''}`, String(i + 1)), E('div', 'tx', ...(r.note ? [E('small', '', r.note)] : []), mdSpan('span', '', r.label), ...(r.text ? [mdSpan('small', '', r.text)] : [])))));
      } else body = E('div', 'gd-tiles', ...v.rows.map((r) => E('div', 'gd-tile', ...(r.note ? [E('span', `gd-chip ${r.tone ?? ''}`, r.note)] : []), mdSpan('b', '', r.label), ...(r.text ? [mdSpan('span', 'gt', r.text)] : []))));
      if (v.diagram) {
        // The picture is the diagram; the rows stay the same answer in plain steps (open on a phone, one tap away on a desk).
        return diagramFig(v.diagram, body);
      }
      return E('figure', 'gd-fig', body);
    }

    // ---- cards
    const card = (part, stage, ...kids) => { const c = el('section', { class: 'gd-sec', 'data-part': part, id: `gd-${part.replace(/\W/g, '-')}` }, ...kids); parts.set(part, c); stageOf.set(part, stage); return c; };
    const head = (h, lead, kicker, part, hf, lf) => el('div', { class: 'gh' }, ...(kicker ? [E('span', 'gk', kicker)] : []), fld(part, hf, mdSpan('h2', '', h)), ...(lead ? [fld(part, lf, mdSpan('p', 'gd-lead', lead))] : []));
    const hero = d.visual ? card('this', 'this', head(d.visual.heading, d.visual.text, undefined, 'this', 'visual.heading', 'visual.text'), visual(d.visual), ...acts('this', d.visual.details), rc('this')) : null;

    const noteBox = el('textarea', { class: 'gd-note', 'aria-label': plan ? 'What is off' : 'What is off, for the agent', placeholder: 'What is off? One line is enough.', maxlength: '500', hidden: '' });
    noteBox.value = S.note;
    const tell = el('button', { class: 'gd-lnk gd-tell', type: 'button', hidden: '' }, 'Tell the agent');
    const choices = [['yes', 'That is right', true], ['no', 'Not quite']].map(([v, label, tick]) => {
      const b = el('button', { class: 'gd-choice', type: 'button', 'aria-pressed': 'false', 'data-u': v }, ...(tick ? [gic('check')] : []), label);
      b.onclick = () => { S.understood = S.understood === v ? null : v; syncU(); paintSummary(); if (!plan && S.understood === 'yes') sayU({ verdict: 'agree' }, b); };
      return b;
    });
    noteBox.oninput = () => { S.note = noteBox.value; if (!plan) syncU(); };
    // Said as a comment on the understood part, so the author's wait --filer takes it and the part shows Sent to the agent, then Agent read it.
    async function sayU(body, btn) {
      return sendWithFeedback(`tell:${key}`, btn, async () => { await postJson('/api/annotations', { key, part: 'understood', ...body }); sync(); });
    }
    tell.onclick = async () => { if (await sayU({ verdict: 'disagree', text: S.note.trim() }, tell)) { S.told = true; S.note = noteBox.value = ''; syncU(); } };
    function syncU() {
      const lock = sent() || !live;
      choices.forEach((b) => { b.setAttribute('aria-pressed', String(S.understood === b.dataset.u)); b.disabled = lock; });
      noteBox.hidden = S.understood !== 'no' || S.told; noteBox.disabled = lock;
      tell.hidden = plan || S.understood !== 'no' || !S.note.trim() || S.told || !live; tell.disabled = false;
    }
    const understood = d.understood?.length ? card('understood', 'understood', head('Check that I have this right', 'This is your ask in my words. If it is off, say what is off. That is the only correction that matters.'),
      el('dl', { class: 'gd-uq' }, ...d.understood.map((u, n) => E('div', '', fld('understood', `understood.${n}.label`, el('dt', {}, u.label)), fld('understood', `understood.${n}.text`, mdSpan('dd', '', u.text))))),
      E('div', 'gd-seg', ...choices), noteBox, tell, sendLine(`tell:${key}`), ...(live ? acts('understood') : []), rc('understood')) : null;

    // A comparison: every item's detail is the same "Axis: value" lines in the same order, so the section is one table.
    // The detail stays plain lines, so a board that predates the table still reads it as text.
    const compared = (items) => {
      if (items.length < 2 || items.some((it) => !it.more || it.diagram)) return null;
      const rows = items.map((it) => it.more.split('\n').filter((l) => l.trim()).map((l) => /^([^:]{1,40}):\s+(\S.*)$/.exec(l.trim())));
      const axes = rows[0].map((m) => m?.[1]);
      if (axes.length < 2 || rows.some((r) => r.length !== axes.length || r.some((m, k) => !m || m[1] !== axes[k]))) return null;
      return { axes, values: rows.map((r) => r.map((m) => m[2])) };
    };
    const cmpTable = (items, { axes, values }) => {
      const opt = (it) => E('span', 'ol', ...(it.tone ? [E('i', `dotk ${it.tone}`)] : []), mdSpan('span', '', it.title));
      const value = (t) => mdSpan('span', '', t);
      const row = (label, cells) => el('tr', {}, el('th', { scope: 'row' }, label), ...cells.map((c, i) => el('td', {}, opt(items[i]), value(c))));
      return E('div', `gd-cmp${items.length > 4 ? ' many' : ''}`, el('table', { class: 'gd-ct' },
        el('thead', {}, el('tr', {}, el('td', {}), ...items.map((it) => el('th', { scope: 'col' }, opt(it))))),
        el('tbody', {}, row('In short', items.map((it) => it.text)), ...axes.map((a, k) => row(a, values.map((v) => v[k]))))));
    };
    /** What a report 5 item carries beside its words: a source (from what users report, or primary), how sure a finding is, a slice's size; and the source's link, under it. */
    const tags = (it) => { const t = [it.source === 'user' ? 'User report' : it.source === 'primary' ? 'Primary source' : '', it.confidence ? `${it.confidence[0].toUpperCase()}${it.confidence.slice(1)} confidence` : '', it.size ?? ''].filter(Boolean);
      return t.length ? [E('span', 'gd-tags', ...t.map((x) => E('span', 'gd-tag', x)))] : []; };
    const srcLink = (it) => { if (!it.link) return []; let host = it.link; try { host = new URL(it.link).host.replace(/^www\./, ''); } catch {} return [el('a', { class: 'gd-src', href: it.link, target: '_blank', rel: 'noopener noreferrer' }, `Open on ${host}`)]; };
    const secCard = (s) => {
      const cmp = compared(s.items ?? []);
      const items = cmp ? [] : (s.items ?? []).map((it, i) => {
        const part = `${s.id}:${i}`;
        if (!it.more && !it.diagram) return E('li', '', E('div', 'rowstat', E('span', '', E('span', 'ti', ...(it.tone ? [E('i', `dotk ${it.tone}`)] : []), fld(part, 'title', mdSpan('span', '', it.title))), fld(part, 'text', mdSpan('span', 'sm', it.text)), ...tags(it))), ...srcLink(it), ...(d.engagement || live ? [E('div', 'body', ...acts(part, undefined, true))] : []));
        const body = E('div', 'body', ...(it.more ? [fld(part, 'more', mdDiv(it.more))] : []), ...(it.diagram ? [diagramFig(it.diagram)] : []), ...acts(part, undefined, true));
        body.hidden = true;
        const b = el('button', { class: 'rowbtn', type: 'button', 'aria-expanded': 'false' }, E('span', '', E('span', 'ti', ...(it.tone ? [E('i', `dotk ${it.tone}`)] : []), mdSpan('span', '', it.title, NOLINK)), mdSpan('span', 'sm', it.text, NOLINK), ...tags(it)), gic('chev', 'gchev'));
        b.onclick = () => { const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); body.hidden = !open; };
        return E('li', '', b, ...srcLink(it), body);
      });
      return card(s.id, s.stage, ...(s.heading || s.body ? [head(s.heading, s.body, undefined, s.id, 'heading', 'body')] : []), ...(s.diagram ? [diagramFig(s.diagram)] : []), ...(s.gallery ? [galleryFig(s.gallery)] : []), ...(s.blocks ?? []).map((b) => blockFig(s, b)), ...(cmp ? [cmpTable(s.items, cmp)] : items.length ? [E('ul', 'gd-rows', ...items)] : []), ...acts(s.id, s.details), rc(s.id));
    };

    const optBtns = new Map();
    const decCard = (q, n) => {
      const opts = q.options.map((o) => {
        const b = el('button', { class: 'gd-opt', type: 'button', role: 'radio', 'aria-checked': 'false' }, E('span', 'rdo'),
          E('span', '', E('span', 'ol', o.label, ...(o.value === q.recommend ? [E('span', 'gd-pick', 'My pick')] : [])), mdSpan('span', 'oo', o.outcome, NOLINK)));
        b.onclick = () => { S.picks[q.key] = o.value; paintOpts(); paintSummary(); };
        (optBtns.get(q.key) ?? optBtns.set(q.key, []).get(q.key)).push([o.value, b]);
        return b;
      });
      return card(`d:${q.key}`, 'decide', head(q.question, q.why, `Decision ${n + 1} of ${decisions.length}`, `d:${q.key}`, 'question', 'why'), E('div', 'gd-opts', ...opts),
        ...(q.reason ? [E('div', 'gd-why', E('b', '', 'Why my pick: '), fld(`d:${q.key}`, 'reason', mdSpan('span', '', q.reason)))] : []), ...(q.quiet ? [E('p', 'gd-quiet', gic('clock'), E('span', '', 'If you stay quiet: ', fld(`d:${q.key}`, 'quiet', mdSpan('span', '', q.quiet))))] : []), ...acts(`d:${q.key}`), rc(`d:${q.key}`));
    };
    const paintOpts = () => {
      const lock = sent() || !live;
      optBtns.forEach((list, k) => list.forEach(([v, b]) => { b.setAttribute('aria-checked', String(S.picks[k] === v)); b.disabled = lock; }));
    };

    // ---- next step and Go ahead
    const sendSlot = E('div', ''), err = E('p', 'gd-err');
    err.setAttribute('role', 'alert');
    const nextCard = d.next ? card('next', 'next', head(d.next.heading, undefined, undefined, 'next', 'heading'), E('ul', 'gd-checks', ...d.next.lines.map((l, n) => E('li', '', E('span', 'tk', gic('check')), fld('next', `lines.${n}`, mdSpan('span', '', l))))), ...(plan ? [sendSlot, sendLine(`plan:${key}`), err] : []), ...(d.engagement || live ? acts('next') : []), rc('next')) : null;
    async function go(b) {
      if (S.understood === 'no' && !S.note.trim()) { noteBox.focus(); noteBox.scrollIntoView({ block: 'center' }); err.textContent = 'Say what is off first, or choose That is right.'; return; }
      err.textContent = ''; b.disabled = true;
      const notes = S.understood ? [{ section: 'understood', verdict: S.understood === 'yes' ? 'approve' : 'change', ...(S.note.trim() && { note: S.note.trim() }) }] : [];
      if (!await sendWithFeedback(`plan:${key}`, b, async () => { await postJson('/api/answers', { key, note: '', notes, decisions: S.picks }); S.note = noteBox.value = ''; sync(); })) b.disabled = false;
    }
    const goBtn = () => { const b = el('button', { class: 'gd-btn block', type: 'button' }, gic('send'), changes() ? `Send ${plural(changes(), 'change')}` : 'Go ahead'); b.onclick = () => go(b); return b; };

    // ---- rail, progress and the phone bar
    const sumHost = E('div', 'gd-sum'), bar = E('div', 'gd-bar'), barTxt = E('div', 'txt'), nav = el('nav', { 'aria-label': 'Parts' }), segs = E('div', 'gd-segs');
    const now = E('div', 'now', E('span', '', E('b', '')), E('span', ''));
    stages.forEach((st, i) => {
      const a = el('a', { href: `#gd-st-${st}`, 'data-nav': st }, E('span', 'gn', String(i + 1)), E('span', 'gt', GSTAGES[st]));
      a.onclick = (e) => { e.preventDefault(); stageEl.get(st)?.scrollIntoView({ block: 'start' }); };
      nav.append(a);
      const s = el('button', { type: 'button', 'aria-label': GSTAGES[st] }); s.onclick = () => stageEl.get(st)?.scrollIntoView({ block: 'start' });
      segs.append(s);
    });
    const stageEl = new Map();
    const summaryRows = () => [['Understood', S.understood === 'yes' ? 'Right' : S.understood === 'no' ? E('span', 'chg', 'Not quite') : 'My reading stands'],
      ...decisions.map((q, i) => [q.question, S.picks[q.key] === q.recommend ? 'My pick' : E('span', 'chg', q.options.find((o) => o.value === S.picks[q.key])?.label ?? S.picks[q.key])])];
    function paintSummary() {
      const gone = sent(), n = changes();
      if (plan) {
        const sendBtn = el('button', { class: 'gd-btn block', type: 'button' }, gic('send'), gone ? 'Sent' : n ? `Send ${plural(n, 'change')}` : 'Go ahead');
        sendBtn.disabled = gone || !live; sendBtn.onclick = () => go(sendBtn);
        sumHost.replaceChildren(E('h4', '', 'Your answers'), E('ul', '', ...summaryRows().map(([k, v]) => E('li', '', E('span', '', k), E('span', '', v)))), sendBtn);
        const b2 = el('button', { class: 'gd-btn', type: 'button' }, gic('send'), gone ? 'Sent' : n ? `Send ${plural(n, 'change')}` : 'Go ahead');
        b2.disabled = gone || !live; b2.onclick = () => go(b2);
        barTxt.replaceChildren(...(gone ? [E('b', '', 'Sent'), 'Agent is on it'] : n ? [E('b', '', plural(n, 'change')), 'My picks for the rest'] : [E('b', '', 'My picks are set'), decisions.length ? `${plural(decisions.length, 'question')}, nothing required` : 'Nothing is required']));
        bar.replaceChildren(barTxt, b2);
        const mine = answerOf(key), seen = state.seen_at?.[key];
        sendSlot.replaceChildren(...(gone
          ? [E('div', 'gd-sent', E('h3', '', 'Sent. I am on it.'), E('p', '', mine.notes?.length || decisions.some((q) => mine.decisions?.[q.key] !== q.recommend) ? 'Your changes are with the agent.' : 'Your answers are my picks.'),
            E('p', 'gd-cap', seen ? `Agent read your answers ${hhmm(seen)}` : 'Agent has not read it yet'))]
          : [goBtn(), E('p', 'gd-cap', n ? 'I use my picks for everything you did not change.' : 'Nothing is required. This accepts my picks.')]));
      }
    }
    function paintRail() {
      const readAll = (st) => [...parts].filter(([id]) => stageOf.get(id) === st).every(([id]) => readAt(id));
      nav.querySelectorAll('a').forEach((a) => { const on = readAll(a.dataset.nav); a.classList.toggle('seen', on); a.querySelector('.gn').replaceChildren(on ? gic('check') : String(stages.indexOf(a.dataset.nav) + 1)); });
      [...segs.children].forEach((b, i) => b.classList.toggle('on', readAll(stages[i])));
    }
    let cur = stages[0];
    function setStage(st) {
      cur = st; const i = stages.indexOf(st);
      nav.querySelectorAll('a').forEach((a) => a.classList.toggle('cur', a.dataset.nav === st));
      [...segs.children].forEach((b, k) => b.classList.toggle('cur', k === i));
      now.firstChild.firstChild.textContent = GSTAGES[st]; now.lastChild.textContent = `${i + 1} of ${stages.length}`;
    }

    // ---- the page
    const cards = [hero, understood, ...by('found').map(secCard), ...by('recommend').map(secCard), ...decisions.map(decCard), nextCard].filter(Boolean);
    const stageBlocks = [];
    let last = '';
    for (const c of cards) {
      const st = stageOf.get(c.dataset.part);
      if (st !== last) { last = st; const s = el('div', { class: 'gd-stage', id: `gd-st-${st}`, 'data-stage': st }, E('i', '', String(stages.indexOf(st) + 1)), GSTAGES[st]); stageEl.set(st, s); stageBlocks.push(s); }
      stageBlocks.push(c);
    }
    const cols = E('div', 'gd-cols');
    // ---- A report's one bar, one View and one Activity (a plan keeps its parts' own rows until its slice). Each acts on the part in view.
    const unmd = (t) => String(t ?? '').replace(/[*`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    const names = new Map([['this', unmd(d.visual?.heading)], ['understood', 'What I understood'], ...sections.map((x) => [x.id, unmd(x.heading || d.title)]), ...decisions.map((q) => [`d:${q.key}`, unmd(q.question)]), ['next', unmd(d.next?.heading)]]);
    const partName = (part) => names.get(part) ?? names.get(String(part).replace(/:\d+$/, '')) ?? part;
    let curPart = d.visual ? 'this' : sections[0].id;
    const note = E('div', 'ra-note'); note.hidden = true; note.setAttribute('role', 'status');
    /** One line over the bar: what was sent, or what went wrong. */
    function flash(what) { note.replaceChildren(what); note.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => { note.hidden = true; }, 7000); }
    const sentLine = (at) => `Sent to the agent ${hhmm(at)}. What it says comes in Activity.`;
    async function say(part, body) {
      await postJson('/api/annotations', { key, part, ...body });
      if (part === 'understood' && body.verdict) { S.understood = body.verdict === 'agree' ? 'yes' : 'no'; S.told = !!body.text; syncU(); }
      sync();
    }
    const raBtn = (cls, icon, label, fn) => { const b = el('button', { type: 'button', class: `ra-b ${cls}` }, gic(icon), E('span', '', label)); b.onclick = fn; return b; };
    const onTxt = E('span', 'ra-ont');
    const agreeB = raBtn('agree', 'up', 'Agree', () => { if (verdictOf(curPart) !== 'agree') say(curPart, { verdict: 'agree' }).then(() => flash(sentLine(new Date()))).catch((e) => flash(E('span', 'gd-err', `Could not send: ${e.message}`))); });
    const disagreeB = raBtn('disagree', 'down', 'Disagree', () => openComposer('disagree'));
    const commentB = raBtn('cmt', 'cmt', 'Comment', () => openComposer('comment'));
    const askB = raBtn('asks', 'spark', 'Ask', () => (d.engagement ? openAsk() : ask(curPart, undefined, askB)));
    const reportBar = el('div', { class: 'ra-bar', role: 'group', 'aria-label': 'About the part in view' }, note, E('p', 'ra-on', 'On ', onTxt), E('div', 'ra-bs', agreeB, disagreeB, commentB, askB));
    function paintBar() {
      onTxt.textContent = nowPart.textContent = partName(curPart);
      const on = verdictOf(curPart) === 'agree';
      agreeB.setAttribute('aria-pressed', String(on)); agreeB.lastChild.textContent = on ? 'Agreed' : 'Agree';
      disagreeB.setAttribute('aria-pressed', String(verdictOf(curPart) === 'disagree'));
    }
    /** Disagree and Comment: one composer on the part, which can be changed here. */
    function openComposer(mode) {
      const sel = el('select', { class: 'ra-part', 'aria-label': 'The part this is about' }, ...[...parts.keys()].map((p) => el('option', { value: p }, partName(p)))), form = el('form', { class: 'ra-form' });
      sel.value = curPart;
      const ta = el('textarea', { rows: '4', maxlength: '500', 'aria-label': mode === 'disagree' ? 'What is off' : 'Comment for the agent' }), send = el('button', { type: 'submit', class: 'ra-send', disabled: '' }, 'Send to the agent'), err = E('p', 'gd-err');
      const paint = () => { ta.placeholder = mode === 'disagree' ? (sel.value === 'understood' ? 'What is off? One line is enough.' : 'What is off?') : 'Your comment, for the agent that wrote this'; send.disabled = !ta.value.trim(); };
      sel.onchange = paint; ta.oninput = paint; paint();
      const id = `bar:${key}`; sending.delete(id);
      form.append(E('label', 'ra-on', 'On ', sel), ta, err, sendLine(id), send);
      form.onsubmit = async (e) => {
        e.preventDefault(); const text = ta.value.trim(); if (!text || sending.get(id)?.busy) return;
        // Send itself answers at once: a spinner and Sending inside it, the words kept in view but locked. Not sent shows a red line in the box with Retry; Sent closes the box and the comment is a bubble under its part.
        const part = sel.value;
        err.textContent = ''; ta.readOnly = true; send.replaceChildren(E('i', 'ra-spin'), 'Sending');
        const sent = await sendWithFeedback(id, send, () => say(part, { text, ...(mode === 'disagree' && { verdict: 'disagree' }) }));
        if (sent) { sheet.close(); flash(sentLine(new Date())); threads.get(part)?.lastElementChild?.scrollIntoView({ block: 'center', behavior: quick ? 'auto' : 'smooth' }); }
        else { ta.readOnly = false; send.replaceChildren('Send to the agent'); paint(); }
      };
      openSheet(mode === 'disagree' ? (curPart === 'understood' ? 'Not quite' : 'Disagree') : 'Comment', form);
      ta.focus({ preventScroll: true });
    }
    /** Ask: the presets and a question of your own, on the part in view. */
    function openAsk() {
      const part = curPart, form = el('form', { class: 'ra-form' }), input = el('input', { 'aria-label': 'Your own question', placeholder: 'Type your own question', maxlength: '500' }), go = el('button', { type: 'submit', class: 'ra-send', disabled: '' }, 'Send to the agent');
      const sentTo = async (p) => { sheet.close(); const a = await p; if (a) flash(sentLine(a.at)); };
      const presets = MENU.filter(([a]) => a !== 'question').map(([a, icon, sub]) => { const b = el('button', { type: 'button', class: 'ra-pre' }, gic(icon), E('span', '', actionLabels[a], E('small', '', sub))); b.onclick = () => sentTo(engage(part, a, undefined, undefined, undefined, b)); return b; });
      input.oninput = () => { go.disabled = !input.value.trim(); };
      form.append(input, go); form.onsubmit = (e) => { e.preventDefault(); if (input.value.trim()) sentTo(engage(part, 'question', input.value.trim(), undefined, undefined, go)); };
      openSheet('Ask', E('p', 'ra-on', 'On ', E('b', '', partName(part))), E('div', 'ra-pres', ...presets), form);
    }
    /** View: the pictures Drawn or As lists, and the numbers under each part shown or not. */
    function openView() {
      const seg = (label, opts, get, set) => E('div', 'ra-vg', E('p', 'ra-vl', label), E('div', 'gd-seg', ...opts.map(([v, name]) => { const b = el('button', { type: 'button', class: 'gd-choice', 'aria-pressed': String(get() === v) }, name); b.onclick = () => { set(v); b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }; return b; })));
      openSheet('View', seg('Pictures', [[false, 'Drawn'], [true, 'As lists']], () => view.lists, (v) => { view.lists = v; lsSet('sign-off-view-lists', v ? '1' : '0'); viewHooks.forEach((f) => f()); }),
        seg('The numbers under each part', [[true, 'Shown'], [false, 'Hidden']], () => view.nums, (v) => { view.nums = v; lsSet('sign-off-view-nums', v ? '1' : '0'); paintView(); }));
    }
    const paintView = () => root.classList.toggle('ra-nonums', !view.nums);

    // Activity: every note, ask and reply, what was read and when the agent wrote it, newest first by day, from the board's own records.
    const actBox = el('aside', { class: 'gd-act', 'aria-label': 'Activity', hidden: '' }), deskMq = matchMedia('(min-width: 62.5rem)');
    const lastOpen = () => Date.parse(lsGet(`sign-off-act-${key}`)) || 0;
    let actOn = false, actSeen = lastOpen();
    const actCount = E('span', 'ra-n');
    const entriesOf = () => {
      const out = [], mine = (state.comments ?? []).filter((c) => c.key === key);
      for (const c of mine) {
        const u = c.part === 'understood', what = c.verdict === 'agree' ? 'You agreed' : c.verdict === 'disagree' ? (u ? 'You said Not quite' : 'You disagreed') : 'You commented';
        out.push({ at: c.at, icon: c.verdict === 'agree' ? 'up' : c.verdict === 'disagree' ? 'down' : 'cmt', title: what, part: c.part, text: c.text ? [c.text] : [], quote: !!c.text, trail: sentOf(c.id), you: true });
        if (c.reply) out.push({ at: c.replied ?? c.at, icon: 'spark', title: 'Agent replied to your note', part: c.part, text: c.reply.split(/\n+/), agent: true });
      }
      for (const a of (state.deeper ?? []).filter((x) => x.key === key)) {
        const label = actionLabels[a.action] ?? 'Go deeper', writing = !!a.text && !a.done, waiting = !a.read, again1 = again.get(a.id) > Date.now(), delivery = state.delivery?.[a.id];
        out.push({ at: a.done ? a.answered ?? a.at : a.at, icon: 'spark', agent: a.done || writing, title: a.done ? `Agent replied to your ${label}` : writing ? `Agent is answering your ${label}` : `You asked ${label}`, part: a.part,
          status: again1 ? `Already sent ${hhmm(a.at)}` : a.done || writing ? '' : waiting ? `Sent to the agent ${hhmm(a.at)}` : `Agent got it ${hhmm(a.read)}, working on it`,
          ask: a.q ?? (a.action === 'custom' ? a.about : ''), selection: a.selection?.quote, text: a.text ? a.text.split(/\n+/) : [], writing, shim: !a.text, id: a.id, fresh: a.version === 1 && !!a.text && a.seen !== a.answerRevision, rev: a.answerRevision,
          err: a.version === 1 && delivery?.error ? `Delivery pending: ${delivery.error}` : '', slow: waiting && !a.done && Date.now() - Date.parse(a.at) > 60_000, trail: sentOf(a.id) });
      }
      const reads = Object.entries(state.reads ?? {}).filter(([k]) => k.startsWith(`${key}/`)).map(([k, at]) => [k.slice(key.length + 1), at]).sort((x, y) => Date.parse(x[1]) - Date.parse(y[1]));
      let sit = [];
      const flush = () => { if (sit.length) out.push({ at: sit.at(-1)[1], icon: 'eye', title: `You read ${plural(sit.length, 'part')}`, text: [sit.map(([p]) => partName(p)).join(', ')], read: true }); sit = []; };
      for (const r of reads) { if (sit.length && Date.parse(r[1]) - Date.parse(sit.at(-1)[1]) > 600_000) flush(); sit.push(r); }
      flush();
      if (d.filed) out.push({ at: d.filed, icon: 'hist', title: 'Agent wrote this', text: [[who, when(d.filed)].filter(Boolean).join(', ')], posted: true });
      // Within one second (the board stores answers to the second) the later record is the newer.
      return out.map((e, i) => ({ ...e, i })).filter((e) => !Number.isNaN(Date.parse(e.at))).sort((x, y) => Math.floor(Date.parse(y.at) / 1000) - Math.floor(Date.parse(x.at) / 1000) || y.i - x.i);
    };
    const toPart = (part) => { if (!deskMq.matches) shutAct(); parts.get(part)?.scrollIntoView({ block: 'start', behavior: quick ? 'auto' : 'smooth' }); };
    function paintAct() {
      const es = entriesOf(), news = es.filter((e) => !e.posted && !e.read && Date.parse(e.at) > actSeen).length, total = es.filter((e) => !e.posted).length;
      actCount.textContent = deskMq.matches ? (total ? String(total) : '') : actOn || !news ? '' : String(news);
      actCount.hidden = !actCount.textContent; actCount.dataset.new = String(news);
      const sig = JSON.stringify(es);
      if (actBox.dataset.sig === sig) return;
      actBox.dataset.sig = sig;
      const x = el('button', { type: 'button', class: 'ra-x', 'aria-label': 'Close Activity' }, gic('x'));
      x.onclick = shutAct;
      const days = [];
      for (const e of es) { const g = isToday(e.at) ? 'Today' : day(e.at); (days.at(-1)?.[0] === g ? days.at(-1)[1] : days[days.push([g, []]) - 1][1]).push(e); }
      const item = (e) => {
        const li = el('li', { class: `ra-e${e.agent ? ' agent' : ''}`, ...(e.id && { 'data-ask': e.id }) }, E('span', 'ra-i', gic(e.icon)), E('div', 'ra-eb', E('div', 'ra-eh', E('b', '', e.title), E('time', '', hhmm(e.at)), ...(e.fresh ? [E('span', 'gd-chip', 'New')] : [])),
          ...(e.part ? [E('span', 'ra-chip', partName(e.part))] : []), ...(e.status ? [E('p', 'ra-st', e.status)] : []), ...(e.ask ? [E('p', 'ra-q', e.ask)] : []), ...(e.selection ? [E('blockquote', '', e.selection)] : []),
          ...(e.err ? [E('p', 'gd-err', e.err)] : []),
          ...(e.shim && e.id ? [E('div', 'shim', ''), E('div', 'shim', '')] : e.text.map((t, i, all) => E(e.quote ? 'blockquote' : 'p', e.quote ? 'ra-say' : 'ra-tx', e.quote ? `“${t}”` : t, ...(e.writing && i === all.length - 1 ? [E('span', 'caret')] : [])))),
          ...(e.trail ? [trailTrack(e.trail, false)] : []), ...(e.slow ? [E('p', 'slow', 'The agent has not picked this up yet. It answers the next time it checks the board.')] : []),
          ...(e.agent && e.part && parts.has(e.part) ? [(() => { const b = el('button', { type: 'button', class: 'ra-show' }, 'Show in the report'); b.onclick = () => toPart(e.part); return b; })()] : [])));
        if (e.fresh) { li.dataset.answerId = e.id; li.dataset.answerRevision = e.rev; answerIO.observe(li); }
        return li;
      };
      actBox.replaceChildren(E('div', 'ra-ah', E('h2', '', 'Activity', ...(total ? [E('span', '', ` ${total}`)] : [])), x),
        ...(days.length ? days.flatMap(([g, list]) => [E('p', 'ra-day', g), el('ol', { class: 'ra-list' }, ...list.map(item))]) : [E('p', 'ra-none', 'Nothing yet. Your notes, asks and the agent’s replies show here.')]));
    }
    function paintActOpen() {
      actBox.hidden = !actOn; cols.classList.toggle('act', actOn); actBtn.setAttribute('aria-expanded', String(actOn)); root.classList.toggle('ra-actopen', actOn);
      if (actOn) { actSeen = Date.now(); lsSet(`sign-off-act-${key}`, new Date().toISOString()); }
      paintAct();
    }
    function openAct() { actOn = true; paintActOpen(); }
    function shutAct() { actOn = false; paintActOpen(); actBtn.focus({ preventScroll: true }); }
    const viewBtn = el('button', { type: 'button', class: 'ra-tool', 'aria-label': 'View', 'aria-haspopup': 'dialog' }, gic('view'));
    const actBtn = el('button', { type: 'button', class: 'ra-tool ra-actb', 'aria-label': 'Activity', 'aria-expanded': 'false' }, gic('hist'), E('span', 'ra-lab', 'Activity'), actCount);
    viewBtn.onclick = openView; actBtn.onclick = () => (actOn ? shutAct() : openAct());
    deskMq.addEventListener('change', () => { if (root.isConnected) { actOn = deskMq.matches; paintActOpen(); } });

    const who = plan ? 'Planning agent' : d.asked_by ?? 'Reporting agent';
    const top = E('div', 'gd-top', E('p', 'geye', kindChip(d, true), E('span', '', [plan ? d.project : d.group, [who, d.filed && when(d.filed)].filter(Boolean).join(', ')].filter(Boolean).join(' · '))), fld('this', 'title', E('h1', '', d.title)), purposeLine(d), fld('this', 'about', mdSpan('p', 'sub', d.about)), ticketRow(d), el('div', { class: 'gd-activity' }, thread(d)),
      E('div', 'howto', gic('info'), E('span', '', plan ? 'A few short parts, in order. Tap Details for the numbers and Go deeper to ask me more. Nothing is required: Go ahead accepts my picks.' : `A few short parts, in order. The bar at the foot acts on the part you are reading${live ? '' : '.'}${live ? ': Agree, Disagree, Comment or Ask.' : ''}`)));
    const rail = el('aside', { class: 'gd-rail' }, E('h4', '', plan ? 'This plan' : 'This report'), nav, ...(plan ? [sumHost] : []));
    const nowPart = E('div', 'now-part'); nowPart.hidden = plan;
    const progress = E('div', 'gd-progress', now, segs, nowPart);
    const main = el('div', { class: 'gd-main' }, top, ...stageBlocks);
    cols.append(rail, main, ...(plan ? [] : [actBox]));
    const scroll = E('div', 'gd-scroll', E('div', 'gd', progress, cols));
    const root = E('div', plan ? '' : 'ra-root', scroll, ...(plan ? [bar] : live ? [reportBar] : []));
    if (!plan) root.tools = [viewBtn, actBtn];
    root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0';
    const answerTimers = new WeakMap();
    const answerIO = new IntersectionObserver(es => es.forEach(en => {
      clearTimeout(answerTimers.get(en.target));
      if (en.isIntersecting) answerTimers.set(en.target, setTimeout(async () => {
        if (!en.target.isConnected || document.visibilityState !== 'visible') return;
        try { await postJson('/api/engagement/seen', { id: en.target.dataset.answerId, answerRevision: +en.target.dataset.answerRevision }); sync(); }
        catch (e) { en.target.append(E('p', 'gd-err', `Could not mark read: ${e.message}`)); }
      }, 1400));
    }), { threshold: 0.35 });

    // ---- reading: a part on screen for a moment is read
    const mark = (part) => { if (!live || readAt(part) !== undefined) return; (state.reads ??= {})[`${key}/${part}`] = new Date().toISOString(); paintRc(); paintRail(); postJson('/api/reads', { key, part }).then(sync).catch(() => {}); };
    const timers = new Map();
    const quick = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const io = new IntersectionObserver((es) => es.forEach((en) => { const p = en.target.dataset.part; if (en.isIntersecting) timers.set(p, setTimeout(() => mark(p), 1400)); else clearTimeout(timers.get(p)); }), { root: scroll, threshold: 0.35 });
    parts.forEach((c) => io.observe(c));
    const io2 = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { setStage(en.target.dataset.stage); if (!plan && en.target.dataset.part) { curPart = en.target.dataset.part; paintBar(); } } }), { root: scroll, rootMargin: '-30% 0px -60% 0px' });
    stageEl.forEach((s) => io2.observe(s));
    parts.forEach((c) => c.dataset.stage = stageOf.get(c.dataset.part));
    parts.forEach((c) => io2.observe(c));

    // ---- keeping the page true to the board
    let timer;
    function sync() {
      if (!root.isConnected && timer) { clearInterval(timer); timer = undefined; return; }
      root.querySelector('.gd-activity')?.replaceChildren(thread(d));
      syncU(); paintOpts(); paintSummary(); paintRc(); paintRail(); if (!plan) { paintBar(); paintAct(); } threads.forEach((_, part) => paintTalk(part));
      panels.forEach((_, part) => { paintAns(part); if (asksOf(part).length && (d.engagement || (deeps.get(part).getAttribute('aria-expanded') === 'false' && !deeps.get(part).dataset.shut))) { deeps.get(part)?.setAttribute('aria-expanded', 'true'); panels.get(part).hidden = false; } });
      const need = live && (unfinished() || (state.comments ?? []).some((c) => c.key === key && c.text && !c.reply) || (plan && sent() && !state.seen_at?.[key]));
      if (need && !timer) timer = setInterval(async () => {
        if (!root.isConnected) { clearInterval(timer); timer = undefined; return; }
        try { const res = await fetch('/api/decisions'); if (res.ok) { state = await res.json(); sync(); } } catch {}
      }, 1500);
      else if (!need && timer) { clearInterval(timer); timer = undefined; }
    }
    root.sync = sync;
    deeps.forEach((b) => b.addEventListener('click', () => { b.dataset.shut = b.getAttribute('aria-expanded') === 'true' ? '' : '1'; }));
    setStage(stages[0]);
    if (!plan) { actOn = deskMq.matches; paintView(); paintActOpen(); }
    queueMicrotask(sync);
    return root;
  }
  function reportSheet(d, h1, page) {
    seeReply(d.key);
    const x = el('a', { class: 'rp-x', href: '#reports', 'aria-label': 'Close' }, glyph('x')), scrim = el('a', { class: 'rp-scrim', href: '#reports', tabindex: '-1', 'aria-hidden': 'true' });
    const what = [d.group, d.filed ? day(d.filed) : ''].filter(Boolean).join(' · ');
    const found = d.guided ? d.visual?.heading : d.decided, src = sourcesPanel(d, (p) => full(p));
    const full = (part) => { rpGuide = d.key; readPage(d, 'reports'); const at = part && document.getElementById(`gd-${part.replace(/\W/g, '-')}`); at ? at.scrollIntoView({ block: 'start' }) : reader.querySelector('h1')?.focus({ preventScroll: true }); };
    // Its head names its kind, then the project and day; under the title, what this kind of report is for; over its parts, a strip of them and the next to read.
    return [scrim, el('div', { class: 'read rp-sheet-body' }, el('span', { class: 'rp-grab', 'aria-hidden': 'true' }), el('div', { class: 'rp-shd' }, el('p', { class: 'rp-what', dir: 'auto' }, kindChip(d, true), el('span', { class: 'rp-when' }, what)), x),
      h1, purposeLine(d), d.about ? el('p', { class: 'about', dir: 'auto' }, plain(d.about)) : '', found ? el('p', { class: 'ui-dl' }, d.guided ? 'What it found' : 'What it decided') : '', found ? el('div', { class: 'ui-props rp-found', dir: 'auto' }, plain(found)) : '', ...src,
      ...reportParts(d, full), ticketRow(d), thread(d), page ?? '', dismissReport(d))];
  }
  /** A report's parts as one panel, each with a check once read, under a strip of them and the next one to read, then for a guided report Read the report:
   *  a part or the button opens it in full (at that part). A report 5's parts are its kind's. */
  function designsHead(items, top, gone) {
    const h1 = top.querySelector('h1'), ro = top.querySelector(':scope > .meta') ?? '', [, theme] = todayHead(), flip = theme.onclick, sel = selecting && canDismiss() && items.length && selectHead(items);
    theme.classList.add('dz-theme');
    theme.onclick = () => { flip(); document.querySelector('.dz-theme')?.focus({ preventScroll: true }); };
    let more = '';
    if (canDismiss() && (items.length || (!phone() && gone.length))) {
      more = el('button', { class: 'ui-rb dz-more', 'aria-label': 'More', 'aria-haspopup': 'dialog' }, glyph('more'));
      const act = (words, fn, n) => { const b = el('button', { class: 'ui-pr' }, el('span', { class: 'k' }, words), n ? el('span', { class: 'v' }, el('span', { class: 'n' }, String(n)), glyph('right')) : ''); b.onclick = () => { dzSheet.close(); fn(); }; return b; };
      more.onclick = () => {
        dzSheet.replaceChildren(el('div', {}, sheetHead('dz-sheet', 'More'), el('div', { class: 'ui-props' }, items.length ? act('Select', () => { selecting = true; render(); }) : '',
          items.length ? act('Discard all', () => discardSheet(items)) : '', !phone() && gone.length ? act('Archived', () => openArchived(gone), gone.length) : '')));
        dzSheet.showModal();
        dzSheet.querySelector('h2').focus();
      };
    }
    if (sel) h1.textContent = sel.title;
    const changes = items.filter((d) => designStatus(d) === 'Changes requested').length;
    if (phone() && !sel) h1.textContent = 'Decide';
    if (phone()) top.className = 'ui-top dz-top', top.replaceChildren(h1, ...(sel ? [sel.all, sel.bar] : [more, theme]));
    else top.className = 'ui-dhead dz-head', top.replaceChildren(el('div', { class: 'tx' }, el('p', { class: 'crumb' }, 'Sign-off', el('span', { 'aria-hidden': 'true' }, '›'), 'Designs'), h1,
      el('p', {}, items.length ? `${plural(items.length, 'design')} on your board${changes ? ` · changes requested on ${changes > 1 && changes === items.length ? `all ${changes}` : changes}` : ''}` : EMPTY.designs), ro), el('div', { class: 'acts' }, ...(sel ? [sel.all, sel.bar] : [more, theme])));
    return phone() ? [ro, decideSeg('designs')] : [''];
  }
  /** Designs, newest first: on a phone To review and the rows, then Archived; on a desk the cards and the open design (the one in the address, else the newest). */
  function decideList(items, hidden, done = [], today = 0) {
    const rows = { now: [], later: [] }, totals = { now: 0, later: 0 };
    decideOrder(items).forEach((d, i) => {
      if (leaving.has(d.key) && leaving.get(d.key).how !== 'later') return;
      const group = sideOf(d);
      if (!phone() || totals[group] < decideLimit[group]) rows[group].push(decideRow(d, i));
      totals[group]++;
    });
    for (const [, g] of leaving) {
      const list = rows[g.group], at = list.findIndex((r) => r.dataset.key === g.before && !r.classList.contains('leaving'));
      list.splice(at < 0 ? list.length : at, 0, decideRow(g.d, 0, g));
    }
    const n = totals.now, later = totals.later;
    const fresh = !risen;
    risen = true;
    const seg = el('div', { class: 'ui-seg', role: 'group', 'aria-label': 'Order' }, ...[['new', 'Newest'], ['priority', 'By priority']].map(([v, name]) => {
      const b = el('button', { type: 'button', 'aria-pressed': String(dsort === v) }, name);
      b.onclick = () => { dsort = v; try { localStorage.setItem('sign-off-decide-sort', v); } catch {} render(); };
      return b;
    }));
    const hero = el('section', { class: 'ui-card ui-hero' }, el('div', { class: 'hl' }, el('span', { class: 'lab' }, 'Waiting on you'), today ? el('span', { class: 'chip' }, `${today} answered today`) : ''),
      el('div', { class: 'hv' }, el('span', { class: 'big' }, String(n)), later ? el('span', { class: 'vs' }, `${later} for later`) : '', leashChip()));
    if (leashSheet.open) fillLeash();
    const sec = (name, k) => el('h2', { class: 'ui-sec' }, name, k === undefined ? '' : el('span', { class: 'n' }, String(k)));
    const card = (name, list, bare) => el('ul', { class: `${bare ? '' : 'ui-card '}ui-list dl-list`, 'aria-label': name }, ...list);
    const more = (group, name, total) => {
      if (!phone() || total <= decideLimit[group]) return '';
      const b = el('button', { class: 'decide-more', id: `decide-more-${group}` }, `Show more ${name.toLowerCase()} · ${total - decideLimit[group]} left`, glyph('down'));
      b.onclick = () => {
        const before = decideLimit[group];
        decideLimit[group] += 24;
        render();
        document.querySelectorAll(`.decide-list ul[aria-label="${name}"] .dl-face`)[before]?.focus();
      };
      return b;
    };
    // On a phone the asks' head sits over their card; on a desk, where the hero is hidden, the card carries its head and count inside it, as the prototype's list card.
    const desk = deskSel !== null, asks = rows.now.length ? card('Asks', rows.now, desk)
      : el('div', { class: `${desk ? '' : 'ui-card '}dl-clear` }, el('b', {}, 'All clear'), el('span', {}, `Nothing is waiting on you${state.name ? `, ${state.name}` : ''}.`));
    // Answers taken without the person sit under the asks until opened, each with its Change; then they join Answered.
    const took = done.filter((d) => takenOf(state.answers[d.key]) && unopened(d.key)), given = done.filter((d) => !took.includes(d));
    return el('div', { class: `waiting-page decide-list${fresh ? ' rise' : ''}` }, phone() ? decideSeg('asks') : seg, hero, ...(desk ? [el('section', { class: 'ui-card dl-asks' }, sec('Asks', n), asks)] : [sec('Asks'), asks, more('now', 'Asks', n)]),
      ...(took.length ? desk ? [el('section', { class: 'ui-card dl-asks' }, sec('Taken without you', took.length), card('Taken without you', took.map(tookRow), true))] : [sec('Taken without you', took.length), card('Taken without you', took.map(tookRow))] : []),
      ...(rows.later.length ? [sec('Later', later), card('Later', rows.later), more('later', 'Later', later)] : []),
      // Every answer given, newest first.
      ...(given.length ? [sec('Answered', given.length), card('Answered', given.slice(0, phone() ? decideLimit.done : given.length).map(doneRow)), more('done', 'Answered', given.length)] : []), items.length ? decideMoreLine(items) : '', archived(hidden));
  }
  /** After a redraw, a row on its way out keeps its height for a moment, then folds to nothing; a redraw midway picks up where it was. */
  function decidePage(d, next, desk = false, sink = {}) {
    if (!d) return el('p', { class: 'empty' }, EMPTY.waiting);
    const to = next ? `#decide/${next.key}` : '#waiting';
    skipTo = next && !state.readonly ? to : '';
    const who = d.type === 'signin' ? d.waits : d.by || 'Agent', at = d.filed ? ` · ${filedAt(d.filed)}` : '';
    sink.crumb = el('p', { class: 'crumb', dir: 'auto' }, el('b', {}, askKind(d)), ` · ${who}${at}`);
    const gone = xBtn(d, 'Discard', () => (location.hash = to));
    if (gone) { gone.setAttribute('role', 'menuitem'); gone.append(glyph('trash')); }
    // Ask me later moves it to Later: a phone goes back to the list, a desk steps on to the next ask.
    const later = () => { location.hash = desk ? to : '#waiting'; toLater([d.key], true); };
    // Ask me later is a button beside the answer, so More keeps only Discard; a sign-in's one button opens its link, so its More keeps both.
    const more = () => { const items = state.readonly ? [] : [d.type === 'signin' && ['Ask me later', later, 'later', 'clock'], gone].filter(Boolean); return items.length ? moreSheet('More', items) : ''; };
    // A sign-in keeps More too: one started on this host has no expiry, and Discard is the way to clear it.
    if (d.type === 'signin') {
      sink.more = more();
      return signinPage(d, desk);
    }
    const err = el('div', { class: 'err', role: 'alert', id: `err-${d.key}` }), opts = d.options ?? [], live = !state.readonly, name = headline(d);
    // An answered ask shows the answer given; Change answer brings the cards back, with nothing picked and that answer marked.
    const given = live ? answerOf(d.key) : undefined, done = !!given && !changing.has(d.key);
    // A pick remembered from an earlier round only counts while the ask still offers it.
    if (!opts.some((o) => o.value === selected.get(d.key))) selected.delete(d.key);
    // Your own answer: its words are the answer, kept in a draft of their own so the note stays the note. A reply ask is only words; an ask with an option valued text takes words only as a note.
    const reply = !opts.length && !!d.reply, mine = live && (reply || (opts.length > 0 && !opts.some((o) => o.value === 'text'))), ownKey = reply ? d.key : `own:${d.key}`;
    const isOwn = () => reply || own.has(d.key), chosen = () => opts.find((o) => o.value === selected.get(d.key));
    const ownBox = mine ? el('textarea', { class: 'own-box', id: `own-${d.key}`, rows: 3, maxlength: 500, dir: 'auto', placeholder: reply ? 'Your reply' : 'Your answer', 'aria-label': `Your own answer, ${name}` }) : null;
    // One note for any pick, always open: it goes with the answer as its comment.
    const note = live && opts.length ? el('textarea', { class: 'note-box', id: `note-${d.key}`, rows: 1, maxlength: 500, dir: 'auto', placeholder: 'A note for the agent, optional', 'aria-label': `Note, goes with your answer, ${name}` }) : null;
    // The answers are cards (1 to 9 pick one on a desk); the one picked gets a ring and a check that springs in, and the button's label slides to it.
    const card = (label, line, chip, now) => [el('span', { class: 'words' }, el('span', { class: 'label-line' }, el('span', { class: 'label' }, label), chip ? el('span', { class: 'recommend' }, 'Recommended') : '', now ? el('span', { class: 'recommend now' }, 'Your answer') : ''),
        line ? el('span', { class: 'reason', dir: 'auto' }, line) : ''), el('span', { class: 'check', 'aria-hidden': 'true' }, glyph('check'))];
    const pickers = opts.map((o) => el('button', { class: 'pick-option', 'aria-pressed': String(o.value === selected.get(d.key) && !own.has(d.key)) }, ...card(o.label, o.outcome, o.value === d.recommend_value, given?.answer === o.value)));
    const ownRow = mine && !reply ? el('button', { class: 'pick-option own-option', 'aria-pressed': String(own.has(d.key)), 'aria-controls': ownBox.id }, ...card('Your own answer', 'Write it in your words', false, given?.answer === 'text')) : null;
    const lbl = el('span', { class: 'lbl' });
    const answer = el('button', { class: 'answer', 'data-kbd': '↵', 'aria-keyshortcuts': 'Enter' }, lbl, el('span', { class: 'okmark', 'aria-hidden': 'true' }, glyph('check')));
    // The button reads the choice, and is off until there is one: a card picked, or words in Your own answer. A change is off while it would send the answer already given.
    const same = () => (isOwn() ? given.answer === 'text' && ownBox.value.trim() === given.note : chosen()?.value === given.answer && (note?.value ?? '').trim() === (given.note ?? ''));
    const sync = (swap) => {
      const text = isOwn() ? 'Send answer' : chosen() ? `${given ? 'Change to' : 'Answer'} ${chosen().label}` : given ? 'Pick a new answer' : 'Pick an answer';
      answer.disabled = (isOwn() ? !ownBox.value.trim() : !chosen()) || (!!given && same());
      if (lbl.textContent === text) return;
      lbl.textContent = text;
      if (swap) { lbl.classList.remove('swap'); void lbl.offsetWidth; lbl.classList.add('swap'); }
    };
    const pickOne = (b) => {
      [...pickers, ownRow].forEach((x) => x?.setAttribute('aria-pressed', String(x === b)));
      page.classList.toggle('own', isOwn());
      sync(true);
    };
    pickers.forEach((b, i) => (b.onclick = () => { selected.set(d.key, opts[i].value); own.delete(d.key); pickOne(b); }));
    if (ownRow) ownRow.onclick = () => { own.add(d.key); pickOne(ownRow); ownBox.focus({ preventScroll: true }); setTimeout(() => ownBox.scrollIntoView({ block: 'nearest', behavior: calm.matches ? 'auto' : 'smooth' }), 230); };
    for (const [box, key] of [[ownBox, ownKey], [note, d.key]]) {
      if (!box) continue;
      box.value = drafts.get(key) ?? (box === note ? noteOf(d) : given?.answer === 'text' ? given.note ?? '' : '');
      box.oninput = () => { drafts.set(key, box.value); keep(); if (box === ownBox || given) sync(); };
    }
    // The button turns green and draws a check, then this row folds away and the next ask opens, with Back to this one. A change stays on its ask.
    const answerWith = (o, words) => {
      answer.classList.add('done');
      const held = pause(380);
      // Once sent, the pick is spent: an Undo brings the ask back with nothing picked.
      save(d, o, [...pickers, ownRow, answer].filter(Boolean), err, null, async () => {
        await held; own.delete(d.key); selected.delete(d.key);
        if (given) return changing.delete(d.key);
        depart([d.key], 'answered'); location.hash = to;
      }, words);
    };
    answer.onclick = () => (isOwn() ? ownBox.value.trim() && answerWith({ value: 'text' }, ownKey) : chosen() && answerWith(chosen()));
    sync();
    sink.more = given ? '' : more();
    if (done) seeReply(d.key);
    // The answer given: when, what with its note or words, whether the agent has read it, and the answer it replaced. Its one button brings the cards back.
    const took = done ? takenOf(given) : undefined;
    if (took) openTook(d.key);
    const was = given?.replaces, sent = done && trailOf(d.key).filter((t) => t.kind !== 'discard').at(-1), change = done && el('button', { class: 'answer', 'data-kbd': '↵', 'aria-keyshortcuts': 'Enter' }, el('span', { class: 'lbl' }, took ? 'Change' : 'Change answer'));
    if (change) change.onclick = () => { changing.add(d.key); selected.delete(d.key); own.delete(d.key); render(); document.querySelector('.decide .pick-list')?.scrollIntoView({ block: 'nearest', behavior: calm.matches ? 'auto' : 'smooth' }); };
    // An answer taken without the person (the deadline's default, or the agent's pick on the leash Act, then tell me) says so in its head, in its card and on its trail's first step.
    const tookCard = took && el('div', { class: 'ans-card took' }, el('span', { class: 'donek', 'aria-hidden': 'true' }, glyph(took === 'default' ? 'clock' : 'picked')), el('div', {},
      el('b', { dir: 'auto' }, given.label), el('span', { dir: 'auto' }, took === 'default' ? `No answer by ${when(given.at)}, so the board took the default this ask showed.` : `Its pick: ${d.recommend_reason ?? 'the answer it recommended.'}`)));
    const said = took ? [el('p', { class: 'ui-dl' }, 'Answer'), el('p', { class: 'took-line', dir: 'auto' }, tookWord(given)), tookCard,
      sent ? trailTrack({ ...sent, taken: took }) : '', el('p', { class: 'ans-was' }, took === 'default' ? 'Still yours to answer: Change sends your answer in its place.' : 'Tell me if wrong: Change sends your answer in its place.')]
      : done ? [el('p', { class: 'ui-dl' }, 'Your answer'), el('p', { class: 'ans-meta' }, el('span', { class: 'res ok' }, was ? 'Changed' : 'Answered'), ` · ${when(given.at)}`),
      el('div', { class: 'ans-card' }, el('span', { class: 'donek', 'aria-hidden': 'true' }, glyph('check')), el('div', {}, el('b', { dir: 'auto' }, saidOf(d, { ...given, note: '' })),
        given.note ? el('q', { dir: 'auto' }, given.note) : '')), sent ? trailTrack(sent) : '',
      was ? el('p', { class: 'ans-was', dir: 'auto' }, `Before: ${saidOf(d, was)} · ${when(was.at)}`) : ''] : [];
    const cards = d.mocks?.length && d.options?.length ? mockCards(d, []) : null, proofLine = cards || d.view ? '' : proofRow(d);
    const preview = cards ?? (d.view ? rung(d) : proofLine ? '' : proof(d));
    const quiet = opts.find((o) => o.value === d.default_if_silent);
    const why = unchecked(d) || d.why || (d.tradeoff && firstDraft(d).text) || d.about;
    // Ask me later sits beside the answer, as the prototype draws it on a phone and on a desk.
    const askLater = live && !given ? el('button', { class: 'later-btn', type: 'button', 'data-kbd': 'L', 'aria-keyshortcuts': 'L' }, 'Ask me later') : '';
    if (askLater) askLater.onclick = later;
    const lead = el('div', { class: 'lead' }, badge(d), el('h2', { id: 'ask-title', class: 'dt', tabindex: '-1', dir: 'auto' }, name), d.filed && !given ? el('p', { class: 'since' }, `Waiting on you since ${day(d.filed)} ${hhmm(d.filed)}`) : '');
    // What it carries (Priority, Its ask) sits right under when it was asked, as the prototype's sheet has it; then why, its preview and its proof.
    const about = [askProps(d), why ? el('p', { class: 'why', dir: 'auto' }, why) : '', firstDraftLinks(d), preview ? el('div', { class: 'decide-preview' }, preview, cards ? fullButton(d) : '') : '',
      ...(d.mocks?.length ? [annotations(d)] : []), proofLine];
    const picks = done || !(live && opts.length) ? [] : [el('p', { class: 'ui-dl' }, 'Your answer'), el('ul', { class: 'pick-list', 'aria-label': d.title }, ...pickers.map((b) => el('li', {}, b)),
      ownRow ? el('li', {}, ownRow) : ''), ownRow ? el('div', { class: 'own-field' }, el('div', {}, ownBox)) : ''];
    const words = done ? [] : [reply ? el('label', { class: 'ui-dl', for: ownBox.id }, 'Your reply') : '', reply ? ownBox : ''];
    const noteField = !done && note ? el('div', { class: 'note-field' }, note) : '';
    // What happens if the person stays quiet, from the leash: a guarded ask always waits and says why, Ask first waits, When it matters takes the default at the deadline.
    const quietLine = given ? '' : d.guard ? el('p', { class: 'guard-line' }, glyph('lock'), el('span', { dir: 'auto' }, el('b', {}, 'Always waits for you. '), `${(GUARD[d.guard] ?? GUARD.irreversible).replace(/^i/, 'I')}, so no default or agent pick is ever taken.`))
      : !quiet ? '' : state.leash === 'ask' ? el('p', { class: 'silent-line' }, 'Your leash is Ask me first, so the agent waits for your answer.')
      // Only a plain yes/no or pick-one is ever taken for the person (src/store.ts plainAsk): a design, a gate or a finding waits.
      : !(d.type === 'decision' && !d.kind && !d.run && !d.finding) ? el('p', { class: 'silent-line' }, 'If you stay quiet, the agent waits for your answer.')
      : el('p', { class: 'silent-line' }, d.silent_by ? `If you stay quiet, the board takes ${quiet.label} at ${when(d.silent_by)}.` : `This ask has no deadline, so the agent waits for your answer.`);
    const bar = (...lead) => (done ? el('div', { class: 'decide-bar' }, change) : mine || (live && opts.length) ? el('div', { class: 'decide-bar' }, ...lead, askLater, answer) : '');
    const kind = `decide g-${reviewed(d) ? 'review' : 'answer'}${isOwn() ? ' own' : ''}`;
    // A desk sets the ask out as the prototype's open item: its head and the ask with what it carries scroll on the left, its Activity beside them, and the answers
    // pinned under a hairline at the foot, as cards side by side over one line of the note, Ask me later and Answer.
    const page = desk ? el('section', { class: `${kind} ui-card ui-pane ask2 s8 split-detail`, 'aria-labelledby': 'ask-title' },
      el('div', { class: 'pbody' }, askHead(d, sink), el('div', { class: 'pmain' }, lead, ...about, ...said, quietLine), el('div', { class: 'pside' }, ...askReport(d), thread(d))),
      el('div', { class: 'ppin' }, ...picks, ...words, sendLine(`card:${d.key}`), err, bar(noteField)))
      : el('section', { class: kind }, lead, ...about, ...said, ...picks, ...words, noteField, quietLine, thread(d), sendLine(`card:${d.key}`), err, bar());
    return page;
  }
  function evidenceDesk(top, items, archived, d) {
    const view = split(top, `${plural(items.length, 'proof')} on your board, newest first`, [...evidenceList(items, top, d?.key), archived], d ? proofPane(d) : pane('', el('p', { class: 'empty' }, EMPTY.evidence)));
    if (d) view.querySelector(`#item-${CSS.escape(d.key)}`)?.setAttribute('aria-current', 'true');
    return view;
  }
  /** Reports on a desk: the list beside the report selected (the newest until a row is picked), as the prototype's open report: its head line (what it is, its group and day,
   *  Mark read and Archive), then its title in full, what it says, what it found and its page on the left, and its parts, ticket and Activity beside them.
   *  A guided report, which reads in stages, opens over the board from Read the report or a part. */
  function reportsDesk(top, page, d, any, items) {
    const sub = `${items.filter(unread).length} of ${items.length} still to read`;
    if (!d) return split(top, sub, [page], pane('', any ? el('p', { class: 'empty' }, 'Open a report from the list.')
      : el('div', { class: 'all-clear-big' }, el('span', { class: 'big' }, glyph('check')), el('h2', {}, 'Nothing to read'), el('p', {}, EMPTY.reports))));
    // A read-only copy keeps no read marks.
    const read = FROZEN ? '' : el('button', { class: 'rp-read', 'data-kbd': 'U', 'aria-keyshortcuts': 'U' }, glyph(unread(d) ? 'check' : 'dot'), unread(d) ? 'Mark read' : 'Mark unread');
    if (read) read.onclick = () => readToggle(d);
    const gone = canDismiss() ? el('button', { class: 'rp-archive', 'data-kbd': 'E', 'aria-keyshortcuts': 'E' }, glyph('archive'), 'Archive') : '';
    if (gone) gone.onclick = () => archiveReport(d);
    const url = d.guided ? '' : src(mockUrl(d.key, '', d.view)), found = d.guided ? d.visual?.heading : d.decided;
    const what = [d.group, d.filed ? day(d.filed) : ''].filter(Boolean).join(' · ');
    const full = (part) => { rpFull = d.key; render(); const at = part && document.getElementById(`gd-${part.replace(/\W/g, '-')}`); at ? at.scrollIntoView({ block: 'start' }) : reader.querySelector('h1')?.focus({ preventScroll: true }); };
    // A guided report's key points, as the prototype's open report shows them: what you asked and when it is done, its own chart (a bar per row, longest full), and what it found
    // item by item, each with a dot by its tone; its next step sits beside its parts.
    const v = d.visual, top1 = v?.type === 'bars' ? Math.max(...v.rows.map((x) => x.value ?? 0)) : 0;
    const keys = !d.guided ? [] : [d.understood?.length ? el('div', { class: 'rp-kv' }, ...d.understood.map((u) => el('div', {}, el('small', { dir: 'auto' }, u.label), el('span', { dir: 'auto' }, plain(u.text))))) : '',
      top1 ? el('div', { class: 'rp-chart' }, v.text ? el('p', { class: 'vt', dir: 'auto' }, plain(v.text)) : '', ...v.rows.map((x) => el('div', { class: 'vrow' }, el('span', { class: 'vl' }, el('b', { dir: 'auto' }, x.label), x.note ? el('small', { dir: 'auto' }, x.note) : ''),
        el('span', { class: 'vb', 'aria-hidden': 'true' }, el('i', { class: x.tone ?? '', style: `width: ${Math.max(2, (100 * (x.value ?? 0)) / top1)}%` })), el('span', { class: 'vn' }, `${x.value}${v.unit ? ` ${v.unit}` : ''}`)))) : '',
      ...(d.sections ?? []).flatMap((x) => [el('p', { class: 'ui-dl', dir: 'auto' }, plain(x.heading)), el('p', { class: 'dp', dir: 'auto' }, plain(x.body)),
        x.items?.length ? el('ul', { class: 'rp-kp' }, ...x.items.map((i) => el('li', { class: i.tone ?? '' }, el('b', { dir: 'auto' }, plain(i.title)), i.text ? el('span', { dir: 'auto' }, plain(i.text)) : ''))) : ''])];
    const next = d.guided && d.next ? [el('p', { class: 'ui-dl' }, 'Next step'), el('div', { class: 'ui-props rp-next' }, el('b', { dir: 'auto' }, plain(d.next.heading)), ...(d.next.lines ?? []).map((l) => el('p', { dir: 'auto' }, plain(l))))] : [];
    return split(top, sub, [page], el('section', { class: `ui-card ui-pane s8 split-detail${d.guided ? ' two' : ''}`, 'aria-labelledby': 'report-title' },
      // The bar names the report's kind beside its project and day; under the title, what this kind of report is for.
      el('div', { class: 'ui-shd split-bar rp-bar' }, cardTile(d), kindChip(d, true), el('span', { dir: 'auto' }, what), read, gone),
      // The page is kept across redraws while this signature holds, so marking it read or a change elsewhere on the board does not load its frame again.
      el('div', { class: 'pmain read', 'data-sig': JSON.stringify([d.key, url, d.title, d.about, found]) }, el('h1', { id: 'report-title', class: 'dt', dir: 'auto' }, plain(d.title)), purposeLine(d),
        d.about ? el('p', { class: 'dp', dir: 'auto' }, plain(d.about)) : '', found ? el('p', { class: 'ui-dl' }, d.guided ? 'What it found' : 'What it decided') : '', found ? el('div', { class: 'ui-props rp-found', dir: 'auto' }, plain(found)) : '',
        ...keys, url ? el('iframe', { src: url, title: `Report: ${d.title}`, sandbox: 'allow-scripts' }) : ''),
      // A research report's Sources, then its parts.
      el('div', { class: 'pside' }, ...sourcesPanel(d, full), ...reportParts(d, full), ...next, ticketRow(d), thread(d))));
  }
  // Capture the actual visible list, after its filters and sorting, before opening any detail.
  // History owns the sequence so Back, reload and a change between sheet and desk keep it.
