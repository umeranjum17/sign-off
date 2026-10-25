
  let state = { decisions: [], answers: {} };
  // An exported copy carries its state and files inline and is read-only.
  const FROZEN = window.FROZEN, src = (url) => FROZEN?.files[url] ?? url;
  // Typed notes not yet sent, kept across re-renders and reloads in this browser, per board file.
  const drafts = new Map(), stored = () => `sign-off-drafts ${state.file}`;
  const keep = () => { try { localStorage.setItem(stored(), JSON.stringify([...drafts])); } catch {} };
  let loaded = false;
  // Text goes in as text nodes, never as HTML, so a title from the file can't run code.
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.append(...kids);
    return e;
  };

  // Motion and touch: reduced motion makes every wait instant; a haptic tick (Android only) marks a swipe's commit line, a saved answer and an Undo.
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const pause = (ms) => new Promise((ok) => setTimeout(ok, calm.matches ? 0 : ms));
  const HAPTIC = { tick: 10, success: [12, 70, 22], undo: [8, 40, 8] };
  const buzz = (kind) => { try { navigator.vibrate?.(HAPTIC[kind]); } catch {} };
  // A spring (stiffness 170, damping 17) sampled into a CSS linear() curve, so a pop or a row springing back settles like a physical thing.
  document.documentElement.style.setProperty('--spring', (() => {
    const at = [];
    for (let i = 0, x = 0, v = 0; i <= 600; i++) { if (i % 15 === 0) at.push(+x.toFixed(4)); v += (170 * (1 - x) - 17 * v) / 600; x += v / 600; }
    return `linear(${at.join(', ')})`;
  })());

  /** sent runs only once the server saved the request, so a draft is dropped only then; the redraw waits for it (an answer's check plays out before the list comes back). */
  /** What the person typed on this board, read once its file is known: a draft outlives a reload. */
  function loadDrafts() {
    if (loaded) return;
    loaded = true;
    try { for (const [k, v] of JSON.parse(localStorage.getItem(stored())) ?? []) drafts.set(k, v); } catch {}
  }
  async function call(path, init, sent) {
    const res = await fetch(path, init);
    const body = await res.json().catch(() => ({ error: `The server replied ${res.status}` }));
    if (!res.ok) throw Object.assign(new Error(body.error), { status: res.status });
    // An answer, a round or a dismiss answers with the whole board: the board on screen is all of it, so no page is read over it.
    (state = body), (wholeBoard = true);
    loadDrafts();
    await sent?.();
    renderKeepingFocus();
  }

  /** A part of the board as it comes back: rows with the counts and the page they are, one card whole, or the ticket roll-up. */
  const view = (path) => fetch(path).then(async (res) => {
    const body = await res.json().catch(() => ({ error: `The server replied ${res.status}` }));
    if (!res.ok) throw Object.assign(new Error(body.error), { status: res.status });
    return body;
  });
  /** Whether the board on screen is all of it, not the pages gathered so far: a whole-board read or an answer brings it all at once, so the
   * pages are not read again over it. */
  let wholeBoard = false;
  /** A part of the board joined to the board on screen. Rows replace or add, one card whole replaces its row and brings its own activity,
   * and a part is read for what it carries, never emptied for what it leaves out: nothing a person can see is cleared by a later read. */
  function mergeView(body) {
    // The whole board (an answer's own reply, or an older client reading it whole) is the board: it replaces what the parts had gathered.
    if (!body.page) return void ((state = body), (wholeBoard = true));
    // Everything a part says about the board itself is the board's: its address, its counts, who may answer it, its ticket roll-up outside the rows.
    const { decisions = [], tickets: rolled = [], trail = [], rounds = [], messages = [], annotations = [], comments = [], page = state.page, ...board } = body;
    const rows = new Map(state.decisions.map((d) => [d.key, d]));
    if (body.card) rows.set(body.card.key, { ...body.card, whole: true });
    // A page brings each row as the board has it now, a card already open included: its card is read again under the same key when the address names it.
    for (const d of decisions) rows.set(d.key, d);
    const roll = new Map((state.tickets ?? []).map((t) => [t.id, t]));
    for (const t of rolled) roll.set(t.id, t);
    // A card's own activity joins the board's lists, each entry once, so opening a card never doubles its thread.
    const joined = (name) => { const have = new Set((state[name] ?? []).map((x) => JSON.stringify(x))); return [...(state[name] ?? []), ...(body[name] ?? []).filter((x) => !have.has(JSON.stringify(x)))]; };
    state = { ...state, ...board, decisions: [...rows.values()], page,
      tickets: page.view === 'tickets' ? rolled : roll.size ? [...roll.values()] : state.tickets,
      // A part carries its own answers and dismissals; the whole board's own are the board's.
      ...(body.card ? { answers: { ...state.answers, ...body.answers }, seen_at: { ...state.seen_at, ...board.seen_at }, dismissed: [...new Set([...(state.dismissed ?? []), ...(body.dismissed ?? [])])] } : {}),
      ...Object.fromEntries(['trail', 'rounds', 'messages', 'annotations', 'comments'].map((name) => [name, joined(name)])) };
  }
  /** A card whole for the screen that opens it: its body, its proof and its own activity come with it, never with the list it was found in. */
  const fetching = new Set();
  function whole(key) {
    // A row read from a page is filled in with its card; a card the board holds whole, or one already coming, is left alone.
    const row = state.decisions.find((d) => d.key === key);
    if (!key || wholeBoard || fetching.has(key) || (row && (row.whole || !row.row))) return;
    fetching.add(key);
    view(`/api/decisions?view=card&key=${encodeURIComponent(key)}`).then((body) => {
      if (!body.card) return;
      // A card arriving under the address that names it opens a reader that was waiting for it, and takes the focus as an opened card does.
      const opening = location.hash.endsWith(`/${key}`) && reader.dataset.key !== key;
      mergeView(body);
      renderKeepingFocus();
      if (opening && !reader.hidden) reader.querySelector('h1')?.focus({ preventScroll: true });
    }, () => {}).finally(() => fetching.delete(key));
  }
  /** The rest of the board a page at a time, after the first screen is painted: each page merges in and the board is drawn when the pages are
   * done (or as they arrive on a screen the person has opened), so no read ever clears what is on screen for a skeleton. */
  let resting;
  async function rest() {
    if (resting || wholeBoard) return;
    resting = true;
    try {
      for (let offset = 0; ;) {
        const page = await view(`/api/decisions?view=items&offset=${offset}&limit=200`);
        mergeView(page);
        // Today already shows what the first page carries; another screen fills as its pages arrive.
        if (location.hash) renderKeepingFocus();
        if (page.more !== true || !page.decisions?.length) break;
        offset += page.decisions.length;
      }
    } catch { /* the first screen is on screen: a page that fails leaves it there, and the next poll reads it again */ } finally {
      resting = false;
      renderKeepingFocus();
    }
  }
  /** The ticket roll-up is the largest part of the board and only the Tickets screen shows it: it is read when that screen first opens. */
  let ticketsRead = false;
  function readTickets() {
    if (ticketsRead || wholeBoard) return;
    ticketsRead = true;
    view('/api/decisions?view=tickets').then((body) => { mergeView(body); renderKeepingFocus(); }, () => (ticketsRead = false));
  }

  // A response can arrive after the person has started typing on the next card.
  // Keep the active editor and its selection across that redraw, just as a poll does.
  function renderKeepingFocus() {
    const typing = (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.id === 'find') && document.activeElement;
    const start = typing && typing.selectionStart, end = typing && typing.selectionEnd, direction = typing && typing.selectionDirection;
    // A part of the board arriving redraws the list around its row: the row the person is on keeps the focus, as it does across a poll.
    const onRow = !typing && document.activeElement?.closest?.('.dl-row[data-key]')?.dataset.key;
    render();
    const box = typing && document.getElementById(typing.id);
    if (box) box.focus(), box.setSelectionRange(start, end, direction);
    else if (onRow) document.getElementById(`item-${onRow}`)?.focus?.({ preventScroll: true });
  }

  const clearIfSaved = (key, sent) => () => { if (drafts.get(key) === sent) drafts.delete(key); keep(); };

  function lock(...btns) {
    const controls = [...btns, ...(btns[0].closest('.decide, .row')?.querySelectorAll('button') ?? [])].filter((b) => !b.disabled);
    controls.forEach((b) => (b.disabled = true));
    return () => controls.forEach((b) => (b.disabled = false));
  }

  // `words` names the draft the note is read from: the card's box, or Decide's Your own answer, which it keeps apart from the note.
  async function save(d, o, buttons, err, after, land, words = d.key) {
    const unlock = lock(...buttons);
    // An answers-only board takes no comments, and words sent as the answer are the answer itself (a reply item's also go as a comment).
    const typed = state.answers_only || (o.value === 'text' && !d.reply) ? '' : (drafts.get(d.key) ?? '').trim();
    const note = drafts.get(words) ?? noteOf(d), before = answerOf(d.key);
    const drop = clearIfSaved(words, drafts.get(words));
    try {
      const sent = await sendWithFeedback(`card:${d.key}`, buttons.at(-1), () => call('/api/answers', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: d.key, answer: o.value, note }),
      }, async () => { forget(d.key); unfolded.delete(d.key); if (!typed) drop(); await land?.(); }));
      if (!sent) { buttons.forEach((b) => b.classList.remove('done')); return unlock(); }
    } catch (e) {
      buttons.forEach((b) => b.classList.remove('done'));
      shown(err).textContent = `Couldn't save: ${e.message}`;
      return unlock();
    }
    offerUndo(d, before);
    after?.();
    if (typed) {
      const sendNote = () => sendWithFeedback(`card:${d.key}`, null, () => call('/api/messages', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'comment', key: d.key, text: typed }),
      }, drop), sendNote);
      sendNote();
    }
  }

  const toast = document.getElementById('toast'), toastText = document.getElementById('toast-text'), undoBtn = document.getElementById('undo');
  let hide;
  const answerOf = (key) => (Object.hasOwn(state.answers, key) ? state.answers[key] : undefined);
  // The saved note, for the next pick or round. Words sent as the answer are that answer, not a note to carry over;
  // a reply item's reply still goes with the answer picked after it.
  const noteOf = (d) => (answerOf(d.key)?.answer === 'text' && !d.reply ? '' : answerOf(d.key)?.note ?? '');
  // The toast stays while the pointer is on it or the keyboard is on Undo.
  const later = (ms) => { clearTimeout(hide); hide = setTimeout(() => (toast.matches(':hover') || undoBtn.matches(':focus-visible') ? later(1500) : (toast.hidden = true)), ms); };
  /** The toast keeps its place unless that would cover Decide's bar: a bar not yet stuck can sit in the toast's band, and then the toast goes just above it. */
  const placeToast = () => {
    toast.style.bottom = '';
    const bar = document.querySelector('.decide-bar')?.getBoundingClientRect(), t = toast.getBoundingClientRect();
    if (!toast.hidden && bar?.height && t.bottom > bar.top && t.top < bar.bottom) toast.style.bottom = `${innerHeight - bar.top + 8}px`;
  };
  addEventListener('scroll', () => toast.hidden || placeToast(), { passive: true });
  // A redraw or a resize can move the bar under a toast that is already up.
  new ResizeObserver(() => toast.hidden || placeToast()).observe(document.documentElement);
  addEventListener('resize', () => toast.hidden || placeToast());
  // Every toast is one style: it rises on a spring, marked with what happened (a check, a clock for Later, an arrow for an undo,
  // a tray for a dismiss, a stop for a failure), and a hairline counts down to when it goes.
  const toastMark = (text) => (/^Could(n't| not)/.test(text) ? 'error' : /^(Undone|Back)/.test(text) ? 'undo' : /dismissed|cleared|archived/i.test(text) ? 'dismiss' : 'ok');
  // The words may lead with what they are about in bold, as in "<b>Keep the weekly digest?</b> · Yes".
  const say = (text, ms, undo, mark) => {
    toastText.replaceChildren(...[text].flat());
    undoBtn.hidden = !undo;
    undoBtn.disabled = false;
    undoBtn.onclick = undo && (() => { buzz('undo'); undo(); });
    toast.dataset.mark = mark ?? toastMark(toastText.textContent);
    toast.style.setProperty('--tms', `${ms}ms`);
    toast.hidden = true;
    void toast.offsetWidth;
    toast.hidden = false;
    placeToast();
    later(ms);
  };
  /** After a tap, a few seconds to take it back. Undo saves the answer from before the tap (or none) the usual way, so it is recorded too. */
  function offerUndo(d, before) {
    const now = answerOf(d.key);
    if (!now) return;
    undoBtn.setAttribute('aria-label', `Undo, ${headline(d)}`);
    buzz('success');
    say([el('b', {}, headline(d)), ` · ${before ? 'changed to ' : ''}${now.answer === 'text' ? 'your reply' : now.label}${now.note && now.answer !== 'text' ? ' · with your comment' : ''}`], 5000, () => {
      undoBtn.disabled = true;
      // On the Decide list the row comes back in place, with a flash; anywhere else the ask opens again.
      // On Today it comes back as Up next.
      const list = location.hash === '#waiting', home = !location.hash.slice(1);
      if ((list || !phone()) && !before) returned(d.key);
      call('/api/answers', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: d.key, answer: before?.answer ?? '', note: before?.note ?? '' }) })
        .then(() => {
          if (!before && !list && !home) location.hash = askHref(d);
          say(before ? `Back to: ${before.answer === 'text' ? 'your reply' : before.label}` : 'Undone: not answered', 3000);
        }, (e) => say(`Couldn't undo: ${e.message}`, 8000));
    }, 'ok');
    // The tap redrew its card and took the focus with it: put it on Undo so the keyboard can reach it in time.
    if (document.activeElement === document.body || !document.activeElement) undoBtn.focus();
  }

  // A render while a request was out replaced the error line; write to the one on screen.
  const shown = (err) => document.getElementById(err.id) ?? err;

  // The local, in-flight step of the feedback trail. Receipts survive a redraw; the saved trail still owns delivery and read times.
  const sending = new Map();
  function sendLine(id) {
    const line = el('div', { class: 'ui-send', 'data-send-feedback': id, role: 'status', 'aria-live': 'polite' });
    paintSend(line); return line;
  }
  function paintSend(line) {
    const s = sending.get(line.dataset.sendFeedback);
    line.hidden = !s;
    if (!s) return;
    line.dataset.state = s.busy ? 'busy' : s.error ? 'error' : 'sent';
    line.replaceChildren(s.busy ? 'Sending…' : s.error ? `Not sent · ${s.error} ` : `Sent · ${hhmm(s.at)}`);
    if (s.error) { const retry = el('button', { type: 'button', class: 'gd-lnk' }, 'Retry'); retry.onclick = s.retry; line.append(retry); }
  }
  async function sendWithFeedback(id, btn, post, retry = () => btn?.click()) {
    if (sending.get(id)?.busy) return false;
    const paint = () => document.querySelectorAll('[data-send-feedback]').forEach((line) => { paintSend(line); if (line.dataset.sendFeedback === id && !line.hidden) line.scrollIntoView({ block: 'nearest', behavior: 'instant' }); });
    sending.set(id, { busy: true }); btn?.setAttribute('aria-busy', 'true'); paint();
    try {
      await post(); sending.set(id, { at: new Date().toISOString() }); return true;
    } catch (e) {
      sending.set(id, { error: e.message, retry }); return false;
    } finally { btn?.removeAttribute('aria-busy'); paint(); }
  }

  /** Sends a comment or a queued prompt for the agent; the typed text stays until the server has it. */
  function send(btn, err, body, draft, text) {
    if (!text) return;
    const unlock = lock(btn);
    sendWithFeedback(`card:${body.key ?? 'prompt'}`, btn, () => call('/api/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, text }) },
      clearIfSaved(draft, drafts.get(draft)))).finally(unlock);
  }

  /** A linked run's result in plain words, for the line over the headline; the third word is the one the Evidence screens use. */
  const RESULT = { 'RUN PASS': ['ok', 'Check passed', 'Passed'], 'RUN FAIL': ['bad', 'Check failed', 'Failed'], INCONCLUSIVE: ['warn', 'Check did not finish', 'Did not finish'], UNVERIFIED: ['warn', 'Could not check', 'Could not check'] };
  /** What an engineer may want of a linked run or a commit, folded under Details so the card leads with the result. */
  function tech(d) {
    const run = d.evidence, commit = run?.commit ?? (/^[a-f0-9]{7,40}$/.test(d.link ?? '') ? d.link : '');
    if (!commit) return '';
    return el('details', { class: 'tech' }, el('summary', {}, 'Details'), headline(d) === d.title ? '' : el('p', { dir: 'auto' }, d.title), el('p', {}, `Commit ${commit}`),
      ...(run ? [el('p', {}, 'The agent wrote the lines below; the board did not check them.'), ...['outcome', 'repro', 'proof', 'evidence'].map((name) =>
        el('p', { dir: 'auto' }, el('strong', {}, `${name}: `), run[name].replace(new RegExp(`^${name}:\\s*(?=\\S)`, 'i'), '')))] : []));
  }

  const NAMES = { decision: 'Decision', design: 'Design', evidence: 'Evidence', diagram: 'Diagram', interactive: 'Interactive', explainer: 'Explainer', signin: 'Sign-in', plan: 'Plan' };
  // The type a question shows as, read from what it already carries: a design pick is a design, a gate has its run, a yes/no has exactly
  // yes and no, any other choice is a pick-one, one answered in words is a reply, and a question with nothing to answer is info.
  // A gate keeps the Approval name even with yes/no options: the brief names it as its own type.
  const TYPE_NAMES = { ...NAMES, design: 'Design pick', 'yes-no': 'Yes/No', 'pick-one': 'Pick one', reply: 'Reply', approval: 'Approval', info: 'Info' };
  const typeOf = (d) => (d.type === 'design' ? 'design' : d.type === 'signin' || d.type === 'plan' ? d.type : d.type === 'evidence' ? 'evidence' : d.run ? 'approval'
    : !d.options.length ? d.reply ? 'reply' : 'info' : d.options.map((o) => o.value).sort().join() === 'no,yes' ? 'yes-no' : 'pick-one');
  // Any other type gets the plain card until it has its own renderer. What waits shows its answer's name; what only reads keeps its own.
  const kind = (d) => (area(d) === 'waiting' ? TYPE_NAMES[typeOf(d)] : d.type === 'decision' ? '' : NAMES[d.type] ?? d.type.replace(/-/g, ' '));
  // A done-done run's outcome line is the plain result a person can now see; the title it sends only names the run.
  const headline = (d) => (d.type === 'evidence' && d.evidence?.outcome.length <= 160 ? d.evidence.outcome : d.title);
  const title = (d) => (d.type === 'evidence' ? `Update ${d.number} · ${headline(d)}` : d.title);

  /** Dismiss hides items from this board (the agent is not told, so an ask keeps waiting); a discard carries the person's reason, which its agent is told; Undo puts them back. */
  // The server takes at most 200 keys a request; the requests run one after another so the last reply carries every change.
  const setDismissed = (keys, dismissed, reason) => Array.from({ length: Math.ceil(keys.length / 200) }, (_, i) => keys.slice(i * 200, i * 200 + 200))
    .reduce((sent, part) => sent.then(() => call('/api/dismiss', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: part, dismissed, ...(reason && { reason }) }) })), Promise.resolve());
  /** back runs before an Undo puts them back; a swipe leaves the focus where it was, as a finger has no use for a ring on Undo. */
  function dismiss(keys, text, back, swiped) {
    return setDismissed(keys, true).then(() => {
      undoBtn.setAttribute('aria-label', `Undo, ${text}`);
      say(text, 5000, () => {
        undoBtn.disabled = true;
        back?.();
        setDismissed(keys, false).then(() => say('Back on the board', 3000), (e) => say(`Couldn't undo: ${e.message}`, 8000));
      });
      if (!swiped) undoBtn.focus();
    }, (e) => say(`Couldn't dismiss: ${e.message}`, 8000));
  }
  const canDismiss = () => !state.readonly && !FROZEN;
  /** Discard, on every card: a sheet of three reasons, one tap each (src/store.ts DISCARD_REASONS). The cards move to Archived and their agents are told why through the trail,
   *  once Undo's 10 seconds are over (src/store.ts UNDO_MS), so an undone discard never reaches them. `after` runs once a reason is picked. */
  const REASONS = [['not-relevant', 'Not relevant', 'slash'], ['replaced', 'Replaced by newer', 'newer'], ['done-elsewhere', 'Done elsewhere', 'check']], UNDO_MS = 10_000;
  const reasonOf = (r) => REASONS.find(([v]) => v === r)?.[1] ?? '';
  const dcSheet = sheetOf('dc-sheet');
  function discardSheet(items, after) {
    const one = items.length === 1, agents = [...new Set(items.map((d) => d.by).filter(Boolean))];
    const pick = ([reason, words, mark]) => { const b = el('button', { class: 'ui-pr', type: 'button', 'data-reason': reason }, el('span', { class: 'k' }, glyph(mark), words));
      b.onclick = () => { dcSheet.close(); after?.(); discard(items, reason); }; return b; };
    dcSheet.replaceChildren(el('div', {}, sheetHead('dc-sheet', one ? 'Discard' : `Discard ${items.length}`), el('p', { class: 'dc-t', dir: 'auto' }, one ? title(items[0]) : plural(items.length, items.every((d) => area(d) === 'designs') ? 'design' : 'card')),
      el('p', { class: 't-line' }, `${one ? 'It moves' : 'They move'} to Archived, and ${agents.length === 1 ? agents[0] : 'their agents'} ${agents.length === 1 ? 'is' : 'are'} told why.`), el('div', { class: 'ui-props' }, ...REASONS.map(pick))));
    dcSheet.showModal();
    dcSheet.querySelector('h2').focus();
  }
  function discard(items, reason) {
    const keys = items.map((d) => d.key), name = items.length === 1 ? title(items[0]) : plural(items.length, 'card');
    return setDismissed(keys, true, reason).then(() => {
      undoBtn.setAttribute('aria-label', `Undo, discard ${name}`);
      say([el('b', {}, 'Discarded'), ` · ${reasonOf(reason)}`], UNDO_MS, () => {
        undoBtn.disabled = true;
        setDismissed(keys, false).then(() => say('Back on the board', 3000), (e) => say(`Couldn't undo: ${e.message}`, 8000));
      }, 'dismiss');
      undoBtn.focus({ preventScroll: true });
    }, (e) => say(`Couldn't discard: ${e.message}`, 8000));
  }
  function xBtn(d, label, after) {
    if (!canDismiss()) return '';
    const b = el('button', { class: label ? 'dis' : 'x', 'aria-label': `Discard, ${title(d)}`, 'aria-haspopup': 'dialog' }, label ?? '×');
    b.onclick = () => discardSheet([d], after);
    return b;
  }
  function clearAll(items) {
    if (!canDismiss() || !items.length) return '';
    const b = el('button', { class: 'clear' }, 'Clear all');
    b.onclick = () => dismiss(items.map((d) => d.key), `${items.length} cleared${items.some((d) => area(d) === 'waiting') ? ' · the agent still waits' : ''}`);
    return b;
  }
  /** A card that is itself a link keeps its × beside it, at its corner. */
  /** Select mode: tap cards to pick them, then Dismiss them together; the same bar sits at the right of every tab's title. */
  let selecting = false;
  const picked = new Set(), cardOf = (e) => e.closest('li') ?? e.closest('.has-x, article') ?? e;
  const applyPicks = () => document.querySelectorAll('#board [id^="item-"]').forEach((e) => cardOf(e).classList.toggle('picked', selecting && picked.has(e.id.slice(5))));
  function bulkBar(items) {
    if (!canDismiss() || !items.length) return '';
    const keys = new Set(items.map((d) => d.key)), n = [...picked].filter((k) => keys.has(k)).length;
    const btn = (cls, text, fn) => { const b = el('button', { class: cls }, text); b.onclick = fn; return b; };
    const stop = () => { selecting = false; picked.clear(); render(); };
    return el('div', { class: 'bulk' }, ...(selecting
      ? [btn('clear', 'Cancel', stop), btn('clear sel-go', n ? `Dismiss ${n}` : 'Dismiss', () => { const ks = [...picked].filter((k) => keys.has(k)); if (ks.length) { dismiss(ks, `${ks.length} dismissed`); stop(); } })]
      : [btn('select', 'Select', () => { selecting = true; render(); }), clearAll(items)]));
  }
  /** Select on Decide and Designs: a tap picks a row (a round check at its end), the title counts the picks with Select all beside it, and Cancel and Discard N
   *  sit where the dock is on a phone (the dock steps aside) and in the title row on a desk. Discard N opens the reasons for all of them at once. */
  function selectHead(items) {
    const keys = items.map((d) => d.key), n = keys.filter((k) => picked.has(k)).length, all = n === keys.length;
    const btn = (cls, words, fn, off) => { const b = el('button', { class: cls, type: 'button', ...(off && { disabled: '' }) }, words); b.onclick = fn; return b; };
    const stop = () => { selecting = false; picked.clear(); render(); };
    return { title: n ? `${n} selected` : 'Select', all: btn('sel-all', all ? 'Select none' : 'Select all', () => { keys.forEach((k) => (all ? picked.delete(k) : picked.add(k))); render(); }),
      bar: el('div', { class: 'sel-bar' }, btn('sel-cancel', 'Cancel', stop), btn('sel-go', n ? `Discard ${n}` : 'Discard', () => discardSheet(items.filter((d) => picked.has(d.key)), stop), !n)) };
  }
  const selMark = (key) => (selecting ? el('span', { class: `sel-c${picked.has(key) ? ' on' : ''}`, 'aria-hidden': 'true' }, glyph('check')) : '');
  addEventListener('click', (e) => {
    const hit = selecting && !e.target.closest('.bulk') && e.target.closest('#board [id^="item-"]');
    if (!hit) return;
    e.preventDefault(), e.stopPropagation();
    const k = hit.id.slice(5);
    picked.has(k) ? picked.delete(k) : picked.add(k);
    render();
  }, true);
  const withX = (d, card) => (canDismiss() ? el('div', { class: 'has-x' }, card, xBtn(d)) : card);

  function row(d, { x = true } = {}) {
    if (d.kind === 'design') {
      const original = /^https?:/.test(d.link ?? '') ? el('p', { class: 'meta' }, el('a', { href: d.link, target: '_blank', rel: 'noopener noreferrer',
        'aria-label': `Open original, ${d.title}` }, 'Open original')) : '';
      return el('article', { class: 'row design', id: `item-${d.key}` },
        el('div', {}, el('h3', { dir: 'auto' }, d.title), el('p', { class: 'about', dir: 'auto' }, d.about)), original);
    }
    const err = el('div', { class: 'err', role: 'alert', id: `err-${d.key}` });
    const saved = Object.hasOwn(state.answers, d.key) ? state.answers[d.key] : undefined;
    // A read-only board, or an item with nothing to answer, shows no answer, note or comment controls.
    const design = d.type === 'design', ro = state.readonly || !(d.options.length || d.reply), name = headline(d);
    const buttons = d.options.map((o) => {
      // The picked answer reads as itself: Recommended stays on the ones not picked.
      const rec = o.value === d.recommend_value && !design && o.value !== saved?.answer;
      return el('button', { class: rec ? 'rec' : '', 'aria-label': `${o.label}${o.outcome ? `: ${o.outcome}` : ''}, ${name}`, 'aria-pressed': o.value === saved?.answer, ...(rec && { 'aria-describedby': `rec-${d.key}` }) },
        el('span', { class: 'label-line' }, design ? (o.value === saved?.answer ? 'Picked' : 'Pick') : o.label, rec ? el('span', { class: 'tag', id: `rec-${d.key}` }, 'Recommended') : ''),
        // What happens next if this is picked, and why the recommended one is.
        o.outcome ? el('span', { class: 'out', dir: 'auto' }, o.outcome) : '', rec && d.recommend_reason ? el('span', { class: 'reason', dir: 'auto' }, `Why: ${d.recommend_reason}`) : '');
    });
    buttons.forEach((b, i) => (b.onclick = () => save(d, d.options[i], buttons, err)));
    // The recommended answer is the first button.
    const top = d.options.findIndex((o) => o.value === d.recommend_value), ranked = top > 0 ? [buttons[top], ...buttons.filter((_, i) => i !== top)] : buttons;
    // The agent that posted the item took this answer with wait --filer.
    const seen = saved && state.seen?.includes(d.key) ? el('span', { class: 'chip seen' }, 'Seen by agent') : '';
    // Over the headline: what the card is (an update's number, and New or the day it was filed), a linked run's result in plain words, Seen by agent.
    const update = d.type === 'evidence', card = d.evidenceCard, result = RESULT[card?.result];
    const brow = [update && area(d) !== 'waiting' ? `Update ${d.number}` : kind(d), result ? el('span', { class: `st ${result[0]}` }, result[1]) : '',
      update && d.filed ? (isToday(d.filed) ? el('span', { class: 'st new' }, 'New') : day(d.filed)) : '', seen].filter(Boolean);
    const lead = el('div', { class: 'lead' }, x ? xBtn(d) : '', brow.length ? el('p', { class: 'eyebrow' }, ...(d.type === 'plan' ? [icon('plan')] : []), ...brow) : '', el('h3', { dir: 'auto' }, name));
    if (d.type === 'signin') return signin(d, lead, saved, err);
    if (d.type === 'plan') return plan(d, lead);
    const quiet = !ro && d.options.find((o) => o.value === d.default_if_silent);
    const silent = quiet ? `If you stay quiet: ${quiet.label}${d.silent_by ? `, at ${when(d.silent_by)}` : ' (no deadline)'}` : '';
    // The other cards this ask replaced are hidden; its answer closes them too.
    const merged = !saved && !state.dismissed?.includes(d.key) ? (d.merges ?? []).filter((k) => state.decisions.some((x) => x.key === k) && !answerOf(k)).length : 0;
    if (design) {
      return el('article', { class: 'row design', id: `item-${d.key}` }, lead,
        firstDraft(d).text ? el('p', { class: 'tradeoff', dir: 'auto' }, el('strong', {}, 'Trade-off '), firstDraft(d).text) : '', firstDraftLinks(d),
        mockCards(d, ro ? [] : buttons), fullButton(d), annotations(d), silent ? el('p', { class: 'silent' }, silent) : '', ro ? '' : other(d, saved, err), err);
    }
    // Yes/No rows keep the two fixed buttons they always had; any other choice set wraps; answers that say what they do stack.
    const many = d.options.some((o) => o.outcome) ? 'told' : d.options.map((o) => o.value).sort().join() !== 'no,yes' ? 'many' : '';
    const words = [d.why ? el('p', { class: 'ask-why', dir: 'auto' }, d.why) : '', d.about && d.about !== name ? el('p', { class: d.media ? 'about full' : 'about', dir: 'auto' }, d.about) : '',
      d.detail || (!d.media && d.about?.length > 180) ? el('details', {}, el('summary', {}, 'Show more'),
        ...[d.about, d.detail].filter(Boolean).map((t) => el('p', { dir: 'auto' }, t))) : '',
      // A web link names the site it opens; a commit goes under Details.
      /^https?:/.test(d.link ?? '') ? el('p', { class: 'meta' }, el('a', { href: d.link, target: '_blank', rel: 'noopener' }, `Open on ${d.link.split('/')[2]}`)) : '',
      silent ? el('p', { class: 'silent' }, silent) : '', merged ? el('p', { class: 'silent' }, `This also answers ${merged} other ${merged > 1 ? 'cards' : 'card'} that asked the same thing.`) : ''];
    return el('article', { class: update ? 'row update' : 'row', id: `item-${d.key}` }, el('div', {}, lead, ...words, ticketRow(d)), proof(d), attachments(d),
      card?.status === 'unverified' ? el('p', { class: 'why' }, `${card.reason} Ask the agent to run the check again.`) : '', chapters(d), rung(d),
      // An update states a result, so the one decision is asked in words above its buttons.
      update && !ro && buttons.length ? el('p', { class: 'ask-line' }, 'Does this look right?') : '',
      ro || !buttons.length ? '' : el('div', { class: `choices ${many}`.trim(), role: 'group', 'aria-label': name }, ...ranked),
      ro ? '' : other(d, saved, err), err, tech(d));
  }

  /** A count with its unit in the form it deserves: 1 section, 2 sections. */
  const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  /** A phrase set mid-sentence: "Publishing the release" reads "publishing the release"; a name with more capitals (GitHub, NPM) keeps them. */
  const lower = (s) => (/^[A-Z][a-z]*\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
  /** A plan: its one-line answer, how many sections and decisions it asks about, and one Open plan for its page over the board. */
  function plan(d, lead) {
    return el('article', { class: 'row plan', id: `item-${d.key}` }, el('div', {}, lead,
      el('p', { class: 'meta' }, `${plural(d.sections.length, 'section')} · ${plural(d.decisions.length, 'decision')}`)),
    el('a', { class: 'open-link', href: `#${area(d)}/${d.key}`, 'aria-label': `Open plan, ${d.title}` }, 'Open plan'));
  }
  /** A span of minutes: whole minutes under the hour, hours and the rest over it. */
  const mins = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
  /** The clock a sign-in's link ends at, in the person's own time, and under an hour the time left counting down: 19:35 · 04:12 left.
   *  It ends on the same comparison expiredLink uses, so a card never reads expired while its Open still works. */
  const endsAt = (at) => {
    const left = Date.parse(at) - Date.now();
    return left <= 0 ? 'Expired' : `${HHMM.format(new Date(at))}${left < 3600_000 ? ` · ${countdown(at)} left` : ''}`;
  };
  /** The same on a card's own line, in words; and short, for a list row beside the poster's name, where a bare time would read as when it was filed. */
  const validUntil = (at) => (endsAt(at) === 'Expired' ? 'Link expired' : `Link valid until ${endsAt(at)}`);
  const endsWords = (at) => (endsAt(at) === 'Expired' ? 'Expired' : `until ${endsAt(at)}`);
  /** A sign-in whose link the board would refuse already: the server says so (state's expired) and the page's own clock agrees, whichever comes first. */
  const expiredLink = (d) => d.type === 'signin' && (d.expired === true || (!!d.expires && Date.parse(d.expires) <= Date.now()));
  const findCard = (key) => state.decisions.find((d) => d.key === key);
  /** A sign-in's row says the one thing that matters about it: that the person opened it and it waits for approval, or when its link ends (and the countdown keeps it live). */
  const signinRow = (d) => {
    const opened = !!openedAt(d) && !expiredLink(d), live = !opened && !expiredLink(d) && !!d.expires;
    return el('span', live ? { 'data-left': d.expires } : {}, opened ? 'Opened — waiting for approval' : d.expires ? endsWords(d.expires) : '');
  };
  // The person's own marks, kept here so the page answers the tap at once: the sign-ins they opened, and the ones they asked a new link for on which link.
  const openedNow = new Set(), reissued = new Map();
  const openedAt = (d) => (state.signin_opened ?? {})[d.key] ?? (openedNow.has(d.key) ? 'now' : undefined);
  /** Opening the link is the person's own mark: the card then reads as waiting for approval, on every device, until its poster says the sign-in is done. */
  const markOpened = (key) => {
    if (openedNow.has(key) || state.readonly || FROZEN) return;
    openedNow.add(key); render();
    postJson('/api/opened', { key }).then(() => render()).catch(() => { openedNow.delete(key); render(); });
  };
  /** The one action that asks a sign-in's poster for a fresh link, by the comment its poll or wait reads; it works while the link still does, too.
   *  Asked, it says so until the poster posts a new link on that key, which is the card's new filed time. */
  function reissue(d, err) {
    const asked = reissued.get(d.key) === d.filed && d.filed !== undefined, button = el('button', { class: 'reissue-btn', type: 'button', ...(asked && { disabled: '' }) }, asked ? 'Asked for a new link' : 'Ask for a new link');
    if (asked || state.readonly || FROZEN) return button;
    button.onclick = async () => {
      reissued.set(d.key, d.filed);
      button.disabled = true;
      button.textContent = 'Asked for a new link';
      const text = `Reissue the ${d.title} sign-in link: ${expiredLink(d) ? 'the one on the card has expired' : `the one on the card expires at ${HHMM.format(new Date(d.expires))}`}.`;
      try { await postJson('/api/messages', { kind: 'comment', key: d.key, text }); render(); } catch (e) {
        reissued.delete(d.key); render(); shown(err).textContent = `The request did not reach the agent: ${e.message}`;
      }
    };
    return button;
  }
  /** A sign-in: the service, what it unlocks, who waits, the time left and one Open for its link (and one ask for a new one). Its poster closes it with signin done. */
  function signin(d, lead, saved, err) {
    const { open, line } = signinOpen(d, saved, err);
    return el('article', { class: 'row signin', id: `item-${d.key}` }, el('div', {}, lead,
      el('p', { class: 'line', dir: 'auto' }, `Unlocks: ${d.unlocks}`), el('p', { class: 'line', dir: 'auto' }, `Waits: ${d.waits}`),
      saved || !openedAt(d) ? '' : el('p', { class: 'meta' }, 'Opened — waiting for approval'), line), open, saved ? '' : reissue(d, err), err);
  }
  /** A sign-in's one Open and the line under it, for its card and its desk page alike. */
  function signinOpen(d, saved, err) {
    if (d.start) return started(d, saved, err);
    const gone = expiredLink(d);
    const open = saved ? '' : gone ? el('button', { class: 'open-link', disabled: '' }, 'Open')
      : el('a', { class: 'open-link', href: d.link, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open the ${d.title} sign-in` }, 'Open');
    // The link opens in its own tab first, so the mark is made after the click, not in its way.
    if (open && !gone && open.tagName === 'A') open.addEventListener('click', () => setTimeout(() => markOpened(d.key), 0));
    // The end time counts down on the page (data-expires); a link past its time is drawn once more, with Open off and the countdown stopped.
    const line = saved ? el('p', { class: 'meta' }, `Signed in at ${when(saved.at)}.`) : d.expires
      ? el('p', { class: gone ? 'expiry gone' : 'expiry', ...(!gone && { 'data-expires': d.expires }) }, validUntil(d.expires)) : '';
    return { open, line };
  }
  /** What a tap-time sign-in did last, in plain words. */
  const RUNS = { none: 'Each tap gets a new link.', starting: 'Getting a new link…', live: 'The sign-in page is open. Finish it there.' };
  /** A sign-in whose link this host makes at each tap: Open starts it and sends a new tab to the new link, so its link never expires on the card. */
  function started(d, saved, err) {
    const failed = d.run?.startsWith('failed: ') && d.run.slice(8);
    const open = saved ? '' : FROZEN || state.readonly ? el('button', { class: 'open-link', disabled: '' }, 'Open')
      : el('button', { class: 'open-link', 'aria-label': `Open the ${d.title} sign-in` }, 'Open');
    if (open && !open.disabled) open.onclick = async () => {
      // The tab opens on the tap itself, so a browser does not block it; it goes to the link once this host has made one.
      const tab = window.open('', '_blank');
      if (tab) tab.opener = null;
      open.disabled = true;
      open.textContent = 'Getting a new link…';
      try {
        const res = await fetch('/api/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: d.key }) });
        const body = await res.json().catch(() => ({ error: `The server replied ${res.status}` }));
        if (body.state) state = body.state;
        if (!res.ok) throw new Error(body.error);
        if (!body.open) tab?.close();
        else if (tab) tab.location.href = body.open;
        else location.href = body.open;
        render();
      } catch (e) {
        tab?.close();
        render();
        shown(err).textContent = `The sign-in did not start: ${e.message}`;
      }
    };
    const line = saved ? `Signed in at ${when(saved.at)}.` : failed ? `The last try failed: ${failed} Tap Open to try again.` : RUNS[d.run] ?? RUNS.none;
    return { open, line: el('p', { class: failed ? 'expiry gone' : saved ? 'meta' : 'expiry' }, line) };
  }
  setInterval(() => {
    // While a sign-in runs on this host, the page checks often, so the card closes soon after the sign-in is done.
    if (!FROZEN && state.decisions.some((d) => d.run === 'live' || d.run === 'starting')) refresh();
    for (const p of document.querySelectorAll('[data-expires]')) {
      if (Date.parse(p.dataset.expires) <= Date.now()) return render();
      p.textContent = validUntil(p.dataset.expires);
    }
  }, 5000);
  // A sign-in's end time counts down each second while its link has under an hour left, and the card redraws as expired once it is past.
  setInterval(() => {
    for (const p of document.querySelectorAll('[data-ends], [data-left]')) {
      const at = p.dataset.ends ?? p.dataset.left;
      if (Date.parse(at) <= Date.now()) return render();
      p.textContent = p.dataset.ends ? endsAt(at) : endsWords(at);
    }
    for (const p of document.querySelectorAll('[data-clock]')) {
      if (Date.parse(p.dataset.clock) <= Date.now()) return render();
      p.textContent = clock(p.dataset.clock);
    }
  }, 1000);
  /** The time left on a sign-in's page, as a clock that counts down each second: 11:40, or 1:05:00 over the hour. */
  const countdown = (at) => {
    const s = Math.max(0, Math.ceil((Date.parse(at) - Date.now()) / 1000)), two = (n) => String(n).padStart(2, '0');
    return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
  };

  /** Boxes the person unfolded, kept open across redraws. */
  const unfolded = new Set();
  /** More…: the actions a card keeps out of the way of its one answer button, folded into one control. */
  const moreMenu = (name, items) => (items.length ? el('details', { class: 'more-menu' }, el('summary', { 'aria-label': `More, ${name}` }, 'More…'), el('div', { class: 'menu' }, ...items)) : '');
  /** The one place to type on a card, folded behind a quiet Add a comment so the buttons come first and an answer still takes one tap.
   * Typed before a button is picked the words go with that answer as its comment (the note the agent reads); Send reply makes them the answer (`text`).
   * On a normal board they can also ask for another round (not on an evidence update) or go as a comment. */
  function other(d, saved, err) {
    const name = headline(d), reply = !d.options.length;
    const box = el('textarea', { id: `note-${d.key}`, rows: 2, maxlength: 500, dir: 'auto', placeholder: reply ? 'Reply in a few words' : 'Add a note (optional)',
      'aria-label': `${reply ? 'Reply' : 'Note'}, ${name}` });
    const kept = saved?.answer === 'text' ? '' : noteOf(d);
    box.value = drafts.get(d.key) ?? kept;
    box.oninput = () => { drafts.set(d.key, box.value); keep(); };
    // An option valued text would be the same answer, so that item takes words only as a note.
    const words = !d.options.some((o) => o.value === 'text'), talk = !state.answers_only, round = talk && d.type !== 'evidence';
    const sendBtn = el('button', { 'aria-label': `${reply ? 'Send reply' : 'Send as my own answer'}, ${name}` }, reply ? 'Send reply' : 'Send as my own answer');
    sendBtn.onclick = () => (box.value.trim() ? save(d, { value: 'text' }, [sendBtn], err) : (shown(err).textContent = 'Write the reply first.'));
    const roundBtn = el('button', { 'aria-label': `Ask for another round, ${name}` }, 'Ask for another round');
    roundBtn.onclick = () => {
      const unlock = lock(roundBtn);
      const note = (drafts.get(d.key) ?? noteOf(d)).trim();
      const drop = clearIfSaved(d.key, drafts.get(d.key));
      sendWithFeedback(`card:${d.key}`, roundBtn, () => call('/api/rounds', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: d.key, note }),
      }, () => { forget(d.key); drop(); })).finally(unlock);
    };
    const commentBtn = el('button', { 'aria-label': `Send without answering, ${name}` }, 'Send without answering');
    commentBtn.onclick = () => send(commentBtn, err, { kind: 'comment', key: d.key }, d.key, box.value.trim());
    // The card keeps one way to answer: the note goes with the answer button. Sending the words some other way is in More.
    const extra = [!reply && words ? sendBtn : '', round ? roundBtn : '', talk && !FROZEN ? commentBtn : ''].filter(Boolean);
    const more = moreMenu(name, extra);
    const asked = (state.rounds ?? []).filter((r) => r.key === d.key);
    // A comment typed before a pick also went on its own to the agent: it shows once, as the comment sent with the answer.
    const comments = (state.messages ?? []).filter((m) => m.kind === 'comment' && m.key === d.key && !(kept && m.text === kept));
    const status = [asked.length && `${asked.length} ${asked.length > 1 ? 'rounds' : 'round'} asked`,
      comments.length && `${comments.length} ${comments.length > 1 ? 'comments' : 'comment'}`].filter(Boolean).join(' · ');
    const label = reply ? 'Write a reply' : kept ? 'Edit comment' : 'Add a comment';
    const fold = el('details', { class: 'other comment', ...((unfolded.has(d.key) || drafts.get(d.key)) && { open: '' }) },
      el('summary', { 'aria-label': `${label}, ${name}` }, `${label}${status && ` · ${status}`}`),
      asked.length ? el('p', { class: 'meta saved-note', dir: 'auto' }, `You asked for another round: ${asked[asked.length - 1].note || 'with your comments on the mocks'}`) : '',
      ...comments.map((m) => el('p', { class: 'meta saved-note', dir: 'auto' }, `Your comment, ${m.delivered ? 'read by the agent' : 'not read yet'}: ${m.text}`)),
      box, reply || more ? el('div', { class: 'actions' }, reply ? sendBtn : '', more) : '');
    fold.ontoggle = () => (fold.open ? unfolded.add(d.key) : unfolded.delete(d.key));
    fold.firstChild.onclick = () => setTimeout(() => fold.open && box.focus());
    return el('div', { class: 'note' }, saved?.answer === 'text' ? el('p', { class: 'meta saved-note', dir: 'auto' }, `Your reply: ${saved.note}`) : '',
      kept ? el('p', { class: 'meta saved-note', dir: 'auto' }, `Your comment, sent with ${saved.label}: ${kept}`) : '', fold, sendLine(`card:${d.key}`));
  }

  /** Free-text prompts for the agent, which it reads with sign-off-axi poll. */
  function ask() {
    const prompts = (state.messages ?? []).filter((m) => m.kind === 'prompt'), queued = prompts.filter((m) => !m.delivered).length;
    const err = el('div', { class: 'err', role: 'alert', id: 'prompt-err' }), box = el('textarea', { id: 'prompt', rows: 3, maxlength: 2000, dir: 'auto' });
    box.value = drafts.get('') ?? '';
    box.oninput = () => { drafts.set('', box.value); keep(); };
    const btn = el('button', { 'aria-label': 'Queue the prompt for the agent' }, 'Queue for the agent');
    btn.onclick = () => send(btn, err, { kind: 'prompt' }, '', box.value.trim());
    return el('details', { class: 'note ask', ...(drafts.get('') && { open: '' }) },
      el('summary', {}, ['Ask the agent', queued && `${queued} queued`, prompts.length - queued && `${prompts.length - queued} read by the agent`].filter(Boolean).join(' · ')),
      ...prompts.map((m) => el('p', { class: 'meta saved-note', dir: 'auto' }, `${m.delivered ? 'Read by the agent' : 'Queued'}: ${m.text}`)),
      el('label', { for: box.id }, 'A prompt the agent reads the next time it checks in'), box, el('div', { class: 'actions' }, btn), sendLine('card:prompt'), err);
  }

  /** The proof on the card itself: its own captures, or else the media of its linked run.
   * Each file is hash-checked by the server; one that changed or went missing says so instead of a broken frame. */
  /** A capture's address names the file's hash (h), so the browser keeps it for good and never asks for it again; a frozen copy keys its files without it. */
  const mediaUrl = (d, i, v = '') => {
    const sha = (v ? d.media[i][v] : d.media[i])?.sha256;
    return `/api/media?key=${encodeURIComponent(d.key)}&i=${i}${v && `&v=${v}`}${FROZEN || !sha ? '' : `&h=${sha.slice(0, 16)}`}`;
  };
  /** Each capture as [original, clip?, light, thumb, tile]: the board shows the lighter copies post made of a still, and opens the original full size.
   * A capture with no copies (a clip, an older post, a run's media) shows the original everywhere. */
  const filesOf = (d) => d.media?.map((m, i) => [mediaUrl(d, i), /\.(mp4|webm)$/i.test(m.path), mediaUrl(d, i, m.light ? 'light' : ''), mediaUrl(d, i, m.thumb ? 'thumb' : m.light ? 'light' : ''), mediaUrl(d, i, m.tile ? 'tile' : m.thumb ? 'thumb' : m.light ? 'light' : '')])
    ?? d.evidenceCard?.media.map((m) => [m.url, m.type.startsWith('video/'), m.url, m.url, m.url]) ?? [];
  /** A capture's picture, fetched only as it nears the screen and decoded off the main thread. */
  const shot = (url, alt) => el('img', { src: src(url), alt, loading: 'lazy', decoding: 'async' });
  /** Media items for the shared viewer from a card's captures (originals, with caption and source). */
  const mediaItemsOf = (d) => filesOf(d).map(([path, video], i) => ({
    url: src(path), video: !!video, caption: d.captions?.[i] || '', source: headline(d) || d.title || '',
  }));
  /**
   * Shared full-screen media viewer for every image and video on reports, evidence and asks.
   * Opens as a sheet over the board (never a raw /api tab). Swipe or arrows move through the set;
   * pinch and double-tap zoom with pan; swipe down or ✕ closes back to the same scroll spot.
   */
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
  function captures(d, cls) {
    const files = filesOf(d), items = mediaItemsOf(d);
    if (!files.length) return '';
    return el('div', { class: cls }, ...files.map(([path, video, light], i) => {
      const url = src(path);
      const name = d.type === 'explainer' ? `Explainer video, ${d.title}` : `${d.type === 'evidence' ? `Update ${d.number}` : 'Proof'}, capture ${i + 1} of ${files.length}`;
      let node;
      if (video) {
        node = el('video', { src: url, controls: '', playsinline: '', preload: 'metadata', 'aria-label': name });
        node.addEventListener('click', (e) => { if (e.target === node) { e.preventDefault(); openMediaViewer(items, i, node); } });
      } else {
        // Keep the pinned link targets (phone: live board hash; desk: raw /api/media in a new tab) and open the shared viewer on tap.
        const live = pageHref(d);
        node = el('a', { href: live || url, class: 'media-open', ...(!live && { target: '_blank', rel: 'noopener' }), 'aria-label': `Open ${name}` }, shot(light, name));
        node.onclick = (e) => { e.preventDefault(); openMediaViewer(items, i, node); };
      }
      (node.tagName === 'A' ? node.querySelector('img') : node).onerror = () => node.replaceWith(el('p', { class: 'gone' }, `${name} can't be shown: the file is missing, changed since it was posted, or in a format this browser can't play.`));
      return d.captions?.[i] ? el('figure', { class: 'cap' }, node, el('figcaption', { dir: 'auto' }, d.captions[i])) : node;
    }));
  }
  const proof = (d) => captures(d, 'media proof');
  const sizeOf = (b) => (b < 1e6 ? `${Math.max(1, Math.round(b / 1e3))} KB` : b < 1e9 ? `${(b / 1e6).toFixed(b < 1e8 ? 1 : 0)} MB` : `${(b / 1e9).toFixed(2)} GB`);
  /** The files attached to an update: one row each with its name and size and a Download button. The server answers with a download header, so a tap saves the file. */
  const attachments = (d) => (d.attachments?.length ? el('div', { class: 'files' }, ...d.attachments.map((a, i) => {
    const row = { class: 'file', 'aria-label': `${a.name}, ${sizeOf(a.bytes)}` }, text = [icon('plan'), el('span', { class: 'fn', dir: 'auto' }, a.name, el('span', { class: 'fs' }, sizeOf(a.bytes)))];
    return FROZEN ? el('div', row, ...text, el('span', { class: 'dl off' }, 'Not in this copy'))
      : el('a', { ...row, href: `/api/attachment?key=${encodeURIComponent(d.key)}&i=${i}`, download: a.name }, ...text, el('span', { class: 'dl' }, 'Download'));
  })) : '');
  /** A capture in a device frame; a wide one (a desktop screen) gets the slimmer bezel. */
  const framed = (img, cls = '') => { const f = el('span', { class: `phone ${cls}`.trim() }, img); img.addEventListener('load', () => img.naturalWidth / img.naturalHeight > 0.8 && f.classList.add('wide')); return f; };
  /** A sheet over the page, from the bottom on a phone and a centred dialog on a desk; its ✕, a tap outside it, Escape or a link in it closes it. */
  const sheet = el('dialog', { id: 'sheet', 'aria-labelledby': 'sheet-title' });
  function openSheet(name, ...body) {
    const shut = el('button', { 'aria-label': 'Close' }, glyph('x'));
    shut.onclick = () => sheet.close();
    sheet.replaceChildren(el('div', {}, el('header', {}, el('h2', { id: 'sheet-title', dir: 'auto', tabindex: '-1', autofocus: '' }, name), shut), ...body));
    sheet.showModal();
  }
  sheet.onclick = (e) => (e.target === sheet || e.target.closest('a')) && sheet.close();
  document.body.append(sheet);
  /** The proof an ask rests on, as one row under the question: a small capture, what it shows, and its result with when it was checked. The row opens the capture in a sheet, and the capture opens the whole proof. */
  function proofRow(d) {
    const of = (d.proof && state.decisions.find((x) => x.key === d.proof)) || d, url = pic(of);
    if (!url) return '';
    const result = RESULT[of.evidenceCard?.result], name = of === d ? 'Capture' : of.title, update = of.type === 'evidence', img = el('img', { src: src(url), alt: '' });
    const status = () => el('span', { class: 'pst' }, result ? el('span', { class: `res ${result[0]}` }, result[2]) : '', of.filed ? `${result ? ' · checked ' : 'Filed '}${when(of.filed)}` : '');
    const row = el('button', { class: 'proof-row', 'aria-label': `View proof, ${name}` }, el('span', { class: 'pthumb' }, img), el('span', { class: 'pt' }, el('b', { dir: 'auto' }, name), status()), glyph('right'));
    img.onerror = () => row.parentElement?.remove();
    row.onclick = () => {
      const items = mediaItemsOf(of);
      if (items.length) {
        const shotBtn = el('button', { class: 'sheet-shot', type: 'button', 'aria-label': `Open the proof, ${name}` }, framed(el('img', { src: src(url), alt: name })));
        shotBtn.onclick = (e) => { e.stopPropagation(); openMediaViewer(items, 0, shotBtn); };
        openSheet(name, status(), shotBtn);
        return;
      }
      openSheet(name, status(), el('button', { class: 'sheet-shot', type: 'button', 'aria-label': `Open the proof, ${name}` }, framed(el('img', { src: src(url), alt: name }))));
    };
    return el('div', { class: 'proof-block' }, el('p', { class: 'ui-dl' }, 'Proof'), row);
  }
  /** The ticket a card names, when it is on the board: tickets stand alone, so a card without one, or naming one the board has not got, shows nothing. */
  const ticketOf = (d) => (d?.ticket ? (state.tickets ?? []).find((t) => t.id === d.ticket) : undefined);
  /** A card's ticket as one panel row under what the card says (ui.css): the ticket's title and progress. The row opens the ticket's page. */
  const ticketRow = (d) => { const p = uiProps(ticketProp(ticketOf(d))); if (p) p.classList.add('ui-tk'); return p; };
  let ticketBack = '';
  /** What a card on a ticket's page is, in a word, and where it stands: waiting, answered, its proof's result or its review. */
  const tkKind = (d) => (d.type === 'evidence' ? 'Proof' : d.kind === 'design' || d.type === 'design' ? 'Design' : d.type === 'plan' ? 'Plan' : ['reports', 'notes'].includes(area(d)) ? 'Report' : 'Ask');
  const tkState = (d) => {
    const s = state.answers[d.key];
    if (d.type === 'evidence') return RESULT[d.evidenceCard?.result]?.[2] ?? 'Not run';
    if (d.type === 'plan' && s?.answer === 'sent') return 'Sent back';
    if (isAnswered(d)) return `Answered: ${s.answer === 'text' ? 'your reply' : s.label}`;
    return { waiting: 'Waiting on you', designs: d.status === 'draft' ? 'Draft' : 'In review' }[area(d)] ?? '';
  };
  /** Steps in time order to the second, as answers are stored: within one second they keep the order they happen in (posted, answered, taken). */
  const bySecond = (x, y) => Math.floor(Date.parse(x.at) / 1000) - Math.floor(Date.parse(y.at) / 1000);
  /** A card's thread, oldest first, from what the board keeps: when it was posted (and the change it links), the answer it replaced,
   *  the answer and its note, when its agent took it, each new round asked for and each comment. Nothing is made up: a step the board has no record of is left out. */
  const threadOf = (d) => {
    const a = state.answers[d.key], by = d.by ?? 'Agent', change = changeHref(d);
    const said = (x) => (x.answer === 'text' ? 'in your own words' : x.label);
    // A design's answer on an earlier round with its notes, each named by its screen when the design has more than one: one note's screen goes in the step.
    const screens = (d.journeys ?? []).flatMap((j) => j.screens.map((s) => ({ j: j.id, s: s.id, title: s.title }))), was = d.earlier, wrote = was?.notes.filter((n) => n.note) ?? [];
    const on = (n) => (screens.length > 1 && n.journey ? screens.find((x) => x.j === n.journey && x.s === n.screen)?.title : '');
    return [d.filed && { at: d.filed, text: `Posted by ${by}`, link: change && [changeName(change), change], posted: true },
      was && { at: was.at, text: `Your answer on the earlier round: ${was.label}${wrote.length === 1 && on(wrote[0]) ? ` (${on(wrote[0])})` : ''}`,
        note: wrote.length === 1 ? wrote[0].note : wrote.map((n) => (on(n) ? `${on(n)}: ${n.note}` : n.note)).join(' · ') },
      a?.replaces?.at && { at: a.replaces.at, text: `Your answer: ${said(a.replaces)}`, note: a.replaces.note },
      a && !d.earlier_answer && { at: a.at, text: `${a.replaces ? 'Changed to' : takenOf(a) === 'default' ? 'Taken by default' : takenOf(a) ? `${by} picked` : 'Your answer'}: ${said(a)}`,
        note: takenOf(a) === 'default' ? 'No answer by its deadline' : takenOf(a) ? d.recommend_reason : a.note || a.notes?.map((n) => n.note).filter(Boolean).join(' · ') },
      ...trailOf(d.key).flatMap((t) => [t.delivered && { at: t.delivered, text: `Delivered to ${by}` }, t.read && { at: t.read, text: `${by} read it` },
        t.reply && (!t.reply.acted || d.type === 'signin') && { at: t.reply.at, text: `${by} ${t.reply.text ? 'replied' : t.reply.acted ? 'posted a new link' : 'acted on it'}`, note: t.reply.text, link: t.reply.link && [linkName(t.reply.link), t.reply.link] }]),
      ...(state.rounds ?? []).filter((r) => r.key === d.key).map((r) => ({ at: r.at, text: 'You asked for a new round', note: r.note })),
      ...trailOf(d.key, 'discard').map((t) => ({ at: t.at, text: `Discarded: ${reasonOf(t.reason)}` })),
      ...(state.comments ?? []).filter((c) => c.key === d.key && c.text).map((c) => ({ at: c.at, text: 'Your comment', note: c.text })),
      ...(state.messages ?? []).filter((m) => m.kind === 'comment' && m.key === d.key).map((m) => ({ at: m.at, text: 'Your comment', note: m.text }))]
      .filter((e, i, all) => e && !Number.isNaN(Date.parse(e.at)) && all.findIndex((x) => x && x.text === e.text && x.note === e.note && bySecond(x, e) === 0) === i).sort(bySecond);
  };
  /** A card's Activity (ui.css): its steps as one sunk group, each in plain words with its time, the note that went with it, and the card it is on where the steps
   *  are a ticket's. A card whose only step is its posting shows none (its time is already on it). */
  const thread = (d, steps = threadOf(d), min = 2) => (steps.length < min ? '' : el('div', { class: 'thread' }, el('p', { class: 'ui-dl' }, 'Activity'), el('ol', { class: 'ui-props ui-act' },
    ...steps.map((e) => el('li', { class: 'ui-pr' }, el('span', { class: 'aw' }, el('b', { dir: 'auto' }, e.text,
      ...(e.link ? [' · ', el('a', { href: e.link[1], ...(/^https?:/.test(e.link[1]) && { target: '_blank', rel: 'noopener' }), dir: 'auto' }, e.link[0])] : [])), el('time', { datetime: e.at }, stamp(e.at))),
    e.note ? el('span', { class: 'th-n', dir: 'auto' }, `“${e.note}”`) : '', e.card ? el('a', { class: 'on', href: hrefOf(e.card), dir: 'auto' }, title(e.card)) : '')))));
  /* ---- The feedback trail: each answer, note, new round and comment the person sent on a card, and how far it got with its agent (src/store.ts readTrail). ---- */
  const TRAIL = ['Sent', 'Delivered', 'Read', 'Replied'];
  const trailOf = (key, kind) => (state.trail ?? []).filter((t) => t.key === key && (kind ? t.kind === kind : t.kind !== 'ticket')).sort(bySecond);
  /** How far a send got: 1 sent, 2 delivered, 3 read, 4 replied (or acted on, when the agent sent a link or posted the card again with no words). */
  const stepOf = (t) => (t.reply ? 4 : t.read ? 3 : t.delivered ? 2 : 1);
  // A re-posted sign-in is a new link to open, never a card acted on and done: its poster still runs `signin done` when the person signs in.
  const stepWord = (t, n) => (n === 0 && t.taken ? (t.taken === 'default' ? 'Taken' : 'Picked') : n === 3 && t.reply && !t.reply.text ? (findCard(t.key)?.type === 'signin' ? 'New link' : 'Acted') : TRAIL[n]);
  const stepAt = (t, n) => [t.at, t.delivered, t.read, t.reply?.at][n];
  /** A reply the person has not opened yet: it waits in Today, and its badge is ink. */
  const unseen = (t) => !!t?.reply && !t.seen;
  /** A link the agent sent names the pull request it is, or else says it opens the new version. */
  const linkName = (url) => (/\/(?:pull|pulls|merge_requests)\/\d+/.test(url) ? changeName(url) : 'Open the new version');
  const trailWhen = (at) => (isToday(at) ? hhmm(at) : day(at));
  /** The trail on a card: four steps on one track, each its word and time once reached; under it the agent's reply and the link to what changed,
   *  unless the place it sits already shows the reply (an ask or a comment on a part of a guided page). */
  function trailTrack(t, said = true) {
    const n = stepOf(t), r = t.reply;
    return el('div', { class: 'ui-trail', role: 'group', 'aria-label': `${stepWord(t, n - 1)}: ${TRAIL.slice(0, n).map((w, i) => `${stepWord(t, i)} ${trailWhen(stepAt(t, i))}`).join(', ')}` },
      el('ol', { 'aria-hidden': 'true' }, ...TRAIL.map((_, i) => el('li', { class: i < n ? 'on' : '' }, el('i', {}), el('b', {}, stepWord(t, i)), el('time', {}, i < n ? trailWhen(stepAt(t, i)) : '')))),
      said && r && (r.text || r.link || r.acted) ? el('div', { class: 'tr-said' }, r.text ? el('p', { dir: 'auto' }, r.text) : r.acted ? el('p', {}, 'Posted a new version') : '',
        r.link ? el('a', { href: r.link, target: '_blank', rel: 'noopener', dir: 'auto' }, linkName(r.link)) : '') : '');
  }
  /** A card's badge in a list: where the last thing sent on it stands, four marks and a word; a reply not opened yet is ink. */
  const trailBadge = (key) => { const t = trailOf(key).at(-1); if (!t) return ''; const n = stepOf(t);
    return el('span', { class: `ui-tb${unseen(t) ? ' new' : ''}`, title: `${stepWord(t, n - 1)} ${trailWhen(stepAt(t, n - 1))}` }, el('span', { class: 'tb-d', 'aria-hidden': 'true' }, ...TRAIL.map((_, i) => el('i', { class: i < n ? 'on' : '' }))), stepWord(t, n - 1)); };
  /** Opening a card with a reply not opened yet marks it seen, once: it then leaves Today. */
  const seeReply = (key, kind) => { const t = trailOf(key, kind).at(-1); if (!unseen(t) || FROZEN || state.readonly) return; t.seen = new Date().toISOString(); postJson('/api/trail', { key }).catch(() => (t.seen = undefined)); };
  /** Replies: each card whose agent replied to what the person sent and the person has not opened it yet, newest first, the reply's words as its second line. */
  function repliesOn() {
    const gone = new Set(state.dismissed ?? []), last = new Map();
    for (const t of [...(state.trail ?? [])].filter((x) => x.kind !== 'ticket').sort(bySecond)) last.set(t.key, t);
    // A reply on a ticket comment opens its ticket.
    const asCard = (t) => { const k = tkById(t.key); return k && { key: `ticket:${k.id}`, onTicket: k }; };
    for (const t of [...(state.trail ?? [])].filter((x) => x.kind === 'ticket').sort(bySecond)) last.set(`ticket:${t.key}`, t);
    const rows = [...last.entries()].filter(([, t]) => unseen(t)).map(([k, t]) => [k.startsWith('ticket:') ? asCard(t) : state.decisions.find((d) => d.key === t.key), t])
      .filter(([d]) => d && !gone.has(d.key)).sort(([, x], [, y]) => Date.parse(y.reply.at) - Date.parse(x.reply.at));
    if (!rows.length) return '';
    return el('section', { class: 't-wait t-replies', 'aria-label': 'Replies' }, el('h2', { class: 'ui-sec' }, 'Replies', el('span', { class: 'n' }, String(rows.length))),
      el('ul', { class: 'ui-card ui-list' }, ...rows.map(([d, t]) => { const k = d.onTicket, a = el('a', { class: 'ui-row', href: k ? `#ticket/${k.id}` : hrefOf(d) }, ...uiRow({ tile: k ? tkTile(k) : cardTile(d), title: k ? k.title : title(d),
        meta: [trailWhen(t.reply.at), t.reply.text ?? (t.reply.link ? linkName(t.reply.link) : 'Posted a new version')].join(' · ') })); a.onclick = () => (jump = d.key); return el('li', {}, a); })));
  }
  /** A result's mark: the pass tick only for passed proof, a cross for failed, an alert for not finished or unchecked. */
  const mark = (kind) => { const s = el('span', { 'aria-hidden': 'true' }); s.innerHTML = kind === 'ok'
    ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>'
    : kind === 'bad' ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m9 9 6 6m0-6-6 6"/></svg>'
    : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 7v6"/><path d="M12 16.2v.1"/></svg>'; return s; };
  /** The board's reason a run could not be checked, with the next step the docs promise. */
  const unchecked = (d) => (d.evidenceCard?.status === 'unverified' && d.evidenceCard.reason ? `${d.evidenceCard.reason} Ask the agent to run the check again.` : '');
  /** The project an update proves something for, read from the check line its run recorded: "verify-margin: …" names margin. */
  const projectOf = (d) => /^(?:done-done-)?verify-([\w-]{1,40}):/i.exec((d.evidence?.proof ?? '').trim())?.[1]?.toLowerCase()
    // A capture with no run names its project by the repository of the change it links, such as github.com/owner/sign-off/pull/9.
    ?? /\/([\w.-]{1,40})\/(?:-\/)?(?:pull|pulls|merge_requests)\/\d+/.exec(d.link ?? '')?.[1]?.toLowerCase() ?? '';
  /** A link to a change names its number; any other link names the site it opens, as it always has. */
  const changeName = (url) => { const m = /\/(?:pull|pulls|merge_requests)\/(\d+)/.exec(url); return m ? `Pull request ${m[1]}` : `Open on ${new URL(url).host}`; };
  /** A link to a change, only when it is a full http(s) URL: a bare `http:` is text, not a place to open. */
  const changeHref = (d) => { try { const u = new URL(d.link ?? ''); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
  /** What the run's proof line says ran: the line after the checker's name ("done-done-verify-sign-off: npm test, phone" says "npm test, phone"). */
  const whatRan = (d) => { const line = (d.evidence?.proof ?? '').trim(); return /^[\w.-]{1,40}:\s*(.*)$/s.exec(line)?.[1] ?? line; };
  /** Updates listed together under one headline would read as one proof twice; each such card names what tells them apart best: its project, its own title or what ran. */
  function twins(items) {
    const by = new Map(), out = new Map();
    for (const d of items) by.set(headline(d), [...(by.get(headline(d)) ?? []), d]);
    for (const same of by.values()) {
      const [tell] = [projectOf, (d) => (d.title !== headline(d) ? d.title : ''), whatRan].map((f) => [f, new Set(same.map(f)).size]).reduce((x, y) => (y[1] > x[1] ? y : x));
      if (same.length > 1 && new Set(same.map(tell)).size > 1) for (const d of same) out.set(d.key, tell(d));
    }
    return out;
  }
  /** done-done's word on a proof: the board's check of its linked run when it has one, else the judge's line at the start of what the update says
   *  (a board served with no evidence root keeps only that line): 'held' when it holds up, 'not' when it failed or could not be confirmed, '' when nothing checked it. */
  const HELD = /^done-done checked the proof and it holds up\b[:.]?\s*/i, UNCONFIRMED = /^done-done could not confirm the proof\b[:.]?\s*/i;
  const judged = (d) => { const r = d.evidenceCard?.result; return r === 'RUN PASS' || (!r && HELD.test(d.about ?? '')) ? 'held' : r === 'RUN FAIL' || r === 'INCONCLUSIVE' || (!r && UNCONFIRMED.test(d.about ?? '')) ? 'not' : ''; };
  const judgedWord = (d) => ({ 'RUN PASS': 'Holds up', 'RUN FAIL': 'Failed', INCONCLUSIVE: 'Did not finish', UNVERIFIED: 'Could not check' })[d.evidenceCard?.result] ?? { held: 'Holds up', not: 'Could not confirm' }[judged(d)] ?? 'Not checked';
  /** The line drawings of Evidence's rows and sheet, as the approved prototype draws them on a 20px box; fixed strings from this page. */
  const EV_ICONS = { shield: '<path d="M10 2.6l6 2.4v4.4c0 3.9-2.6 6.6-6 8-3.4-1.4-6-4.1-6-8V5z"/><path d="M7.3 10l1.9 1.9 3.6-3.7"/>', flag: '<path d="M5 17.5v-14M5 4h9.5l-2 3.5 2 3.5H5"/>',
    layers: '<path d="M10 3.2 17 7l-7 3.8L3 7z"/><path d="M3 10.6l7 3.8 7-3.8"/>', pr: '<circle cx="6" cy="4.8" r="1.8"/><circle cx="6" cy="15.2" r="1.8"/><circle cx="14" cy="15.2" r="1.8"/><path d="M6 6.6v6.8M14 13.4V8.8a2.5 2.5 0 0 0-2.5-2.5H9.5"/>',
    image: '<rect x="3" y="4" width="14" height="12" rx="2"/><circle cx="7.5" cy="8.5" r="1.3"/><path d="M17 13l-3.5-3.5L6 16"/>', filter: '<path d="M3.5 5.5h13M6 10h8M8.5 14.5h3"/>',
    check: '<path d="M5 10.4l3.2 3.1L15 6.6"/>', cross: '<path d="M6.5 6.5l7 7M13.5 6.5l-7 7"/>' };
  const evGlyph = (a) => { const s = el('span', { class: 'ev-g', 'aria-hidden': 'true' }); s.innerHTML = `<svg viewBox="0 0 20 20">${EV_ICONS[a]}</svg>`; return s; };
  /** A proof's tile: its project's mark (the Reports tile), with done-done's check at its corner. */
  const evTile = (name, mark = '') => { const t = projectTile(name, () => icon('evidence')); t.append(mark); return t; };
  const judgedMark = (d) => (judged(d) ? el('span', { class: `ev-ok ${judged(d)}` }, evGlyph(judged(d) === 'held' ? 'check' : 'cross')) : '');
  const prio = (d) => (/^P[0-3]$/.test(d.priority ?? '') ? d.priority : '');
  const evWhen = (d) => (d.filed ? (isToday(d.filed) ? hhmm(d.filed) : day(d.filed)) : '');
  /** A ticket's progress shows as a bar once work on it has begun, a full one at 100%, as the prototype draws it: never an empty bar. */
  const begun = (t) => !!t && t.progress > 0;
  /** Evidence's rows show each proof's first capture: small at the row's end, or with Previews on, larger beside the title. The pick is kept in this browser. */
  let evRich = (() => { try { return localStorage.getItem('so-ev-view') === 'rich'; } catch { return false; } })(), evOpen = '';
  const evStills = (d) => filesOf(d).filter(([, video]) => !video);
  /** A row's picture is asked for only when its row is within 50px of the screen, so a long list or See all sends the few the eye can reach, not one per row. */
  const seen = 'IntersectionObserver' in window ? new IntersectionObserver((hits) => hits.forEach((h) => { if (h.isIntersecting) { h.target.src = h.target.dataset.src; seen.unobserve(h.target); } }), { rootMargin: '50px 0px' }) : null;
  /** Each picture is one element kept across redraws (a poll or a tap draws the list again), so a redraw never asks for a picture twice. */
  const lazyImgs = new Map();
  const lazyImg = (url) => {
    if (lazyImgs.has(url)) return lazyImgs.get(url);
    const img = el('img', { alt: '', decoding: 'async', 'data-src': url });
    lazyImgs.set(url, img);
    if (seen) seen.observe(img); else img.src = url;
    return img;
  };
  /** done-done's word as the row's second line leads with it: ink where it holds up, red where it did not, quiet where nothing checked it. */
  const frag = (...kids) => { const f = document.createDocumentFragment(); f.append(...kids); return f; };
  const evVerdict = (d) => el('span', { class: `ev-v ${judged(d) || 'none'}` }, judgedWord(d));
  /** One proof as a row: its project's tile with done-done's check, its title and P0-P3 chip, done-done's word with its project and time, and its first capture.
   *  On a phone a tap opens it in place: its captures in a strip to swipe, what it says in full, done-done's word, its ticket and pull request, and Open proof. */
  function evRow(d) {
    const project = projectName(d), meta = [d.status, project, evWhen(d)].filter(Boolean).join(' · '), title = plain(headline(d)), first = evStills(d)[0], desk = !phone(), open = !desk && evOpen === d.key;
    const th = first ? el('span', { class: 'ev-th', 'aria-hidden': 'true' }, lazyImg(src(first[4])))
      : evRich ? el('span', { class: 'ev-th none', 'aria-hidden': 'true' }, projectTile(project)) : '';
    const parts = uiRow({ tile: evTile(project, judgedMark(d)), title, priority: prio(d), meta: d.status && !judged(d) && !d.evidenceCard ? meta : frag(evVerdict(d), meta ? ` · ${meta}` : '') });
    const label = [title, judgedWord(d), prio(d), meta].filter(Boolean).join(', ');
    const row = desk ? el('a', { class: `ui-row ev-card${evRich ? ' rich' : ''}`, href: `#evidence/${d.key}`, id: `item-${d.key}`, 'data-row': '', 'aria-label': label }, ...parts, th)
      : el('button', { class: `ui-row ev-card${evRich ? ' rich' : ''}`, id: `item-${d.key}`, 'data-row': '', 'aria-expanded': String(open), 'aria-label': label }, ...parts, th);
    if (!desk) row.onclick = () => { evOpen = open ? '' : d.key; if (evOpen) whole(d.key); reshow(`#item-${CSS.escape(d.key)}`); };
    return el('li', { class: open ? 'open' : '' }, row, open ? evOpened(d) : '');
  }
  /** A proof opened in its row: its captures in a strip that snaps one to a swipe (each its own shape, as tall as the strip), what it says in full, its panel and Open proof. */
  function evOpened(d) {
    const stills = evStills(d), said = plain((d.about ?? '').replace(HELD, '').replace(UNCONFIRMED, '')), name = plain(headline(d)), items = mediaItemsOf(d).filter((m) => !m.video);
    const strip = stills.length ? el('div', { class: 'ev-strip', role: 'group', 'aria-label': `${plural(stills.length, 'capture')}, swipe for the next` },
      ...stills.map(([path, , light], i) => {
        // Keep the pinned raw-file link target; a tap opens the shared viewer instead of navigating away.
        const a = el('a', { href: src(path), target: '_blank', rel: 'noopener', class: 'media-open', 'aria-label': `Open capture ${i + 1} of ${stills.length} full size` }, el('img', { src: src(light), alt: '', loading: 'lazy', decoding: 'async' }));
        a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openMediaViewer(items, i, a); };
        return a;
      }))
      : el('div', { class: 'ev-hero none' }, evGlyph('image'), (d.status ? 'Frame pending' : 'Text only: no capture was filed'));
    const dots = stills.length > 1 ? el('div', { class: 'ev-dots-n', 'aria-hidden': 'true' }, ...stills.map((_, i) => el('i', { class: i ? '' : 'on' }))) : '';
    if (dots) strip.onscroll = () => { const kids = [...strip.children], at = kids.reduce((b, k, i) => (Math.abs(k.offsetLeft - strip.scrollLeft) < Math.abs(kids[b].offsetLeft - strip.scrollLeft) ? i : b), 0); [...dots.children].forEach((x, i) => x.classList.toggle('on', i === at)); };
    const go = el('a', { class: 'ev-go', href: `#evidence/${d.key}` }, el('span', {}, 'Open proof'), el('span', { class: 'ev-go-s' }, 'Verdict and activity'), glyph('right'));
    go.onclick = () => { evOpen = ''; };
    return el('div', { class: 'ev-open' }, strip, dots, said && said !== name ? el('p', { class: 'ev-about', dir: 'auto' }, said) : '', evProps(d), go);
  }
  /** Evidence as the approved new look draws it: the title row with the project filter, Newest or By priority, Held up today (one square per proof filed today
   *  in the order filed: ink where done-done says it holds up, red where it failed or could not be confirmed), then the proof as rows, six until See all.
   *  A project picked from the filter shows as a pill in place of the hero. `top` is the page's head, which this screen draws as its title row. */
  let evSort = 'new', evProject = '', evMore = false;
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
  function verdicts(d) {
    const saved = state.answers[d.key], err = el('div', { class: 'err', role: 'alert', id: `err-${d.key}` }), order = { fail: 0, 'needs-work': 1, pass: 2 };
    const opts = [...d.options].sort((x, y) => (order[x.value] ?? 1) - (order[y.value] ?? 1)), lead = saved?.answer ?? 'pass';
    const buttons = opts.map((o) => el('button', { class: `v-${o.value}${o.value === lead ? ' ink' : ''}`, 'aria-pressed': o.value === saved?.answer, 'aria-label': `${o.label}, ${headline(d)}` }, o.label));
    buttons.forEach((b, i) => (b.onclick = () => save(d, opts[i], buttons, err)));
    return el('div', { class: 'ev-verdict' }, el('div', { class: 'choices', role: 'group', 'aria-label': `Your verdict, ${headline(d)}` }, ...buttons), err, other(d, saved, err), xBtn(d, 'Discard'));
  }
  /** A proof's panel (ui.css): done-done's word, its priority, the ask it serves with its progress, and its pull request. */
  const evProps = (d) => { const p = uiProps(d.status && uiProp({ mark: 'dot', name: 'Status', value: el('span', { class: 'ev-status' }, d.status) }), !d.status || judged(d) || d.evidenceCard ? uiProp({ mark: 'shield', name: 'done-done', value: el('span', { class: `ev-word ${judged(d)}` }, judgedWord(d)) }) : '', priorityProp(prio(d)), ticketProp(ticketOf(d), 'Its ask'), changeProp(d)); p.classList.add('ev-props'); return p; };
  /** One update as a sheet over the list on a phone: its project and time, its whole title, the capture, then its panel, what it says, its Activity and the verdict. */
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
  function proofPane(d) {
    const project = projectOf(d), said = plain((d.about ?? '').replace(HELD, '').replace(UNCONFIRMED, '')), name = plain(headline(d)), why = plain(unchecked(d));
    return el('section', { class: 'ui-card ui-pane two s8 split-detail', 'aria-labelledby': 'reader-title' },
      el('div', { class: 'ui-shd split-bar' }, projectTile(project), el('span', { class: 'pt', dir: 'auto' }, [project || 'No project', d.filed && (isToday(d.filed) ? hhmm(d.filed) : stamp(d.filed))].filter(Boolean).join(' · '))),
      el('div', { class: 'pmain' }, el('h1', { class: `dt ev-title${name.length > 160 ? ' long' : ''}`, id: 'reader-title', tabindex: '-1', dir: 'auto' }, name),
        captures(d, 'ev-hero pv-cap') || el('div', { class: 'ev-hero none' }, evGlyph('image'), (d.status ? 'Frame pending' : 'Text only: no capture was filed')), attachments(d)),
      el('div', { class: 'pside' }, evProps(d), said && said !== name ? el('p', { class: 'dp ev-about', dir: 'auto' }, said) : '', why ? el('p', { class: 'dp ev-why', dir: 'auto' }, why) : '',
        state.readonly || FROZEN || !(d.options.length || d.reply) ? '' : verdicts(d), thread(d)));
  }

  /** An explainer's chapter list: each button starts the video at that chapter. */
  function chapters(d) {
    if (!d.chapters) return '';
    const at = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    return el('ol', { class: 'chapters', 'aria-label': `Chapters, ${d.title}` }, ...d.chapters.map((c) => {
      const b = el('button', { 'aria-label': `Play from ${at(c.at)}, ${c.title}` }, el('span', { class: 'at' }, at(c.at)), c.title);
      b.onclick = () => {
        const video = document.getElementById(`item-${d.key}`)?.querySelector('video');
        if (!video) return;
        video.currentTime = c.at;
        video.play().catch(() => {});
      };
      return el('li', {}, b);
    }));
  }

  /** A prototype page in a device's own viewport, a phone's 390 by 844 or a desk's 1280 by 800, scaled down to the width its box gets; the scale follows the box, so a resize never reloads the page. */
  const VIEWPORTS = { phone: [390, 844], computer: [1280, 800] };
  const fitting = new ResizeObserver((boxes) => boxes.forEach(({ target, contentRect }) => contentRect.width && target.style.setProperty('--s', contentRect.width / target.dataset.vw)));
  function deviceFit(frame, form, cls = '') {
    const [vw, vh] = VIEWPORTS[form], box = el('div', { class: `device-fit ${cls}`.trim(), 'data-form': form, 'data-vw': vw }, frame);
    box.style.setProperty('--vw', vw); box.style.setProperty('--vh', vh);
    // Its own size, so a page view's frame rules (100% of the reader) never stretch it.
    Object.assign(frame.style, { width: `${vw}px`, height: `${vh}px` });
    fitting.observe(box);
    return box;
  }

  /** A mock or view is served from inside its own folder, so the files beside it load by their relative names. */
  const mockUrl = (key, value, path) => `${state.mockBase}${key}~${value}/${encodeURIComponent(path.split('?')[0].split('/').pop())}`;
  /** A screen's views: its own (design 1), or on design 2 those of the frame Yes approves. */
  const viewsOf = (d, screen) => screen?.views ?? screen?.frames?.find((f) => f.role === d.accepts)?.views ?? {};
  const designFrame = (d) => Object.values(viewsOf(d, d.journeys?.[0]?.screens?.[0])).find(p => /\.(png|jpe?g|webp|svg)$/i.test(p)) || d.preview;
  const designUrl = (d, path) => `${state.mockBase.replace('/mock/', '/design/')}${d.key}/${encodeURIComponent(path)}`;
  /** A diagram shows inline at card width; an interactive page runs in a sandboxed frame. A tap or the link opens either full size. */
  function rung(d) {
    if (!d.view) return '';
    const url = mockUrl(d.key, '', d.view), page = reads(d);
    const open = { href: src(url), target: '_blank', rel: 'noopener' }, name = page ? 'interactive page' : 'diagram';
    let body;
    if (page) body = el('div', { class: 'frame' }, el('iframe', { src: src(url), title: `Interactive page: ${d.title}`, sandbox: 'allow-scripts', loading: 'lazy' }));
    else {
      const img = el('img', { src: src(url), alt: `Diagram: ${d.title}` });
      // The picture is a tap target too; keyboard and screen reader users get the one link below.
      body = el('a', { class: 'frame', ...open, tabindex: '-1' }, img);
      img.onerror = () => body.replaceWith(el('p', { class: 'gone' }, "The diagram can't be shown: its file is missing or in a format this browser can't draw."));
    }
    return el('div', { class: 'rung' }, body, page ? fullButton(d) : el('a', { class: 'meta', ...open, 'aria-label': `Open the ${name} full size, ${d.title}` }, 'Open full size'));
  }

  /** first-draft's `post` ends a design's trade-off with `Open in first-draft: <label> <url> · <label> <url>`: those urls, and the text before them. */
  const firstDraft = (d) => {
    const at = (d.tradeoff ?? '').search(/(?:^|\s)Open in first-draft: /), tail = at < 0 ? '' : d.tradeoff.slice(at).replace(/^\s*Open in first-draft: /, '');
    const links = tail.split(' · ').map((p) => /^(.*?)\s*(https?:\/\/\S+)$/.exec(p.trim())).filter(Boolean).map(([, label, href]) => ({ label: label || href, href }));
    return links.length ? { text: d.tradeoff.slice(0, at).trim(), links } : { text: d.tradeoff, links: [] };
  };
  /** Real links on the card itself: a link inside a mock is blocked by the frame's sandbox. */
  const firstDraftLinks = (d) => { const { links } = firstDraft(d);
    return links.length ? el('p', { class: 'fd-links' }, 'Open in first-draft ', ...links.map((l) => el('a', { href: l.href, target: '_blank', rel: 'noopener' }, l.label))) : ''; };

  /** One phone frame per option, the recommended one first: its label and Recommended badge, the mock (tap opens it full size) and its Pick button. */
  function mockCards(d, buttons) {
    const rec = (i) => d.options[i].value === d.recommend_value, order = d.options.map((_, i) => i).sort((a, b) => rec(b) - rec(a));
    return el('div', { class: 'mocks', role: 'group', 'aria-label': d.title }, ...order.map((i) => {
      const o = d.options[i], m = d.mocks?.find((x) => x.value === o.value);
      // A `page.html?variant=b` mock keeps its variant in the frame's query, where the page reads it.
      const [path, query] = m?.path.split('?') ?? [];
      const url = m && src(mockUrl(d.key, m.value, path) + (query ? `?${query}` : ''));
      const view = m && (/\.html?$/i.test(path) ? el('iframe', { src: url, title: `Mock ${o.label}`, sandbox: 'allow-scripts', tabindex: '-1', 'aria-hidden': 'true', loading: 'lazy', 'data-mock': `${d.key}~${m.value}` })
        : el('img', { src: url, alt: `Mock: ${o.label}` }));
      return el('figure', { class: 'mock' },
        el('figcaption', {}, el('span', { class: 'label', dir: 'auto' }, o.label), rec(i) ? el('span', { class: 'badge' }, 'Recommended') : ''),
        // A mock file that is gone has a null hash: the option says so in place of an empty frame.
        m && m.hash !== null ? fullShot(d, m.value, el('a', { class: 'shot', href: url, target: '_blank', rel: 'noopener', 'aria-label': `Open mock ${o.label} full screen` }, view))
          : el('p', { class: 'shot none' }, 'No mock for this option'),
        // The option's own link sits on the card, where a tap opens a tab: a link inside the sandboxed frame cannot.
        m?.link ? el('div', { class: 'under' }, el('a', { class: 'option-link', href: m.link, target: '_blank', rel: 'noopener', 'aria-label': `Open ${o.label} live` }, 'Open live'), buttons[i] ?? '') : buttons[i] ?? '');
    }));
  }

  /** Open full screen: a design's mocks or an interactive page over the whole viewport, in the same sandboxed frame, which here takes every tap, so the prototype's own links and buttons work.
   *  Its bar holds the way back, the option shown, Phone (390) or Desktop (1280) framed and centred, and Reference: another option's mock beside it, or over it where the two do not fit side by side. */
  const SIZES = { phone: VIEWPORTS.phone, desktop: VIEWPORTS.computer };
  let fullSize, protoFull;
  const fullPages = (d) => d.view ? [{ value: '', label: d.title, page: true, url: src(mockUrl(d.key, '', d.view)) }]
    : [...d.options].sort((a, b) => (b.value === d.recommend_value) - (a.value === d.recommend_value)).map((o) => {
      const m = d.mocks?.find((x) => x.value === o.value), [path, query] = m?.path.split('?') ?? [];
      return m && m.hash !== null && { value: m.value, label: o.label, link: m.link, page: /\.html?$/i.test(path), url: src(mockUrl(d.key, m.value, path) + (query ? `?${query}` : '')) };
    }).filter(Boolean);
  function fullButton(d) {
    if (!fullPages(d).length) return '';
    const b = el('button', { class: 'full-open', 'aria-haspopup': 'dialog', 'aria-label': `Open full screen, ${d.title}`, 'data-full': d.key }, glyph('expand'), 'Open full screen');
    b.onclick = () => openFull(d, undefined, b.dataset.full);
    return b;
  }
  /** A tap on a mock's frame opens it full screen; a click with a modifier still opens the file in a tab, and while pointing is on the tap names an element instead. */
  function fullShot(d, value, shot) {
    shot.dataset.full = `${d.key}~${value}`;
    shot.onclick = (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button || (talks() && pointing.get(shot.dataset.full))) return; e.preventDefault(); openFull(d, value, shot.dataset.full); };
    return shot;
  }
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
  const editing = new Map(), talks = () => !state.readonly && !state.answers_only && !FROZEN;
  // Words typed for an element and not saved yet, kept in page memory (not across a reload) so tapping another element or another Edit loses nothing.
  const unsaved = new Map(), spot = (key, a) => `${key}~${a.mock}~${a.ref}`;
  // Sent with an answer or round: the card's editor closes and its unsaved words go.
  const forget = (key) => { editing.delete(key); for (const k of unsaved.keys()) if (k.startsWith(`${key}~`)) unsaved.delete(k); };
  const redraw = (d) => document.querySelectorAll('.ann').forEach((n) => n.dataset.ann === d.key && n.replaceWith(annotations(d)));
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

  const AREAS = { waiting: 'Waiting on you', designs: 'Designs', evidence: 'Evidence', reports: 'Reports and explainers', answered: 'Answered' };
  // The tab bar holds five places: Today, Decide (what waits on you, a design Main promoted too), Evidence, Reports and Tickets.
  // The sidebar holds those and Designs, after Reports, as the approved prototype's desk draws it. Designs and Answered are not tabs: both are links on Today's More.
  const TABS = [['', 'Today'], ['waiting', 'Decide'], ['evidence', 'Evidence'], ['reports', 'Reports'], ['tickets', 'Tickets']];
  const SIDE = [...TABS.slice(0, 4), ['designs', 'Designs'], TABS[4]];
  const EMPTY = { waiting: 'Nothing is waiting on you.', designs: 'No designs yet.', evidence: 'No evidence updates.', reports: 'No reports or explainers.', answered: 'Nothing answered yet.' };
  const ICONS = { designs: 'M3 3h18v18H3zM3 9h18M9 21V9',
    waiting: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
    evidence: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2 4-4',
    reports: 'M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
    answered: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9 12l2 2 4-4',
    plan: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v6h6M8 13h8M8 17h8M8 9h2',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    split: 'M16 3h5v5M8 3H3v5M12 22v-8.3a4 4 0 0 0-1.17-2.87L3 3M15 9l6-6',
    clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
    you: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5',
    pick: 'm3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8', phone: 'M7.5 2h9A2.5 2.5 0 0 1 19 4.5v15a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 19.5v-15A2.5 2.5 0 0 1 7.5 2zM11 18h2',
    key: 'M2.6 17.4A2 2 0 0 0 2 18.8V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.2a2 2 0 0 0 1.4-.6l.8-.8a6.5 6.5 0 1 0-4-4zM16.5 7.5h.01',
    keys: 'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
    // Decide's other kinds, as the approved prototype draws them: a question for yes or no, a bubble for a reply.
    yesno: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
    reply: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z', done: 'M20 6 9 17l-5-5',
    // The dock's and the sidebar's filled drawings, as the approved prototype draws them (its 20px grid scaled to this 24px one), one per place by its address.
    'tab-today': 'M3.6 10.32 10.92 4.08a1.68 1.68 0 0 1 2.16 0L20.4 10.32V19.2a1.8 1.8 0 0 1-1.8 1.8h-13.2A1.8 1.8 0 0 1 3.6 19.2zM9 16.08v1.92h6v-1.92z',
    'tab-waiting': 'M5.4 3.6h13.2A3 3 0 0 1 21.6 6.6v8.4a3 3 0 0 1-3 3H12.6L7.2 21.84V18H5.4A3 3 0 0 1 2.4 15v-8.4A3 3 0 0 1 5.4 3.6zM7.2 8.64v1.92h9.6V8.64zm0 3.6v1.92h6v-1.92z',
    'tab-evidence': 'M12 2.16l8.16 3.24v6c0 5.28-3.48 8.88-8.16 10.68-4.68-1.8-8.16-5.4-8.16-10.68v-6zm4.32 6.72-1.32-1.32-4.08 4.2-1.92-1.92-1.32 1.32 3.24 3.24z',
    'tab-reports': 'M6.6 2.4h7.56L19.2 7.44v12.36a1.8 1.8 0 0 1-1.8 1.8h-10.8A1.8 1.8 0 0 1 4.8 19.8v-15.6A1.8 1.8 0 0 1 6.6 2.4zM8.4 11.76v1.8h7.2V11.76zm0 3.6v1.8h4.8v-1.8z',
    'tab-designs': 'M5.4 3.6h13.2A1.8 1.8 0 0 1 20.4 5.4v13.2a1.8 1.8 0 0 1-1.8 1.8h-13.2A1.8 1.8 0 0 1 3.6 18.6v-13.2A1.8 1.8 0 0 1 5.4 3.6zM6 6v4.8h12V6zm0 7.2v4.8h4.8v-4.8zm7.2 0v4.8h4.8v-4.8z',
    'tab-tickets': 'M4.2 5.4h15.6A1.8 1.8 0 0 1 21.6 7.2v2.76a2.16 2.16 0 0 0 0 4.08V16.8a1.8 1.8 0 0 1-1.8 1.8h-15.6A1.8 1.8 0 0 1 2.4 16.8v-2.76a2.16 2.16 0 0 0 0-4.08V7.2a1.8 1.8 0 0 1 1.8-1.8zm10.44 2.4v2.4h1.92v-2.4zm0 6v2.4h1.92v-2.4z' };
  // The drawings are fixed strings from this page, never text from the board file.
  // Small stroke drawings the plan page puts beside a button label or in a section badge; fixed strings from this page.
  const GLYPHS = { link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>', left: '<path d="m15 18-6-6 6-6"/>', up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', right: '<path d="m9 18 6-6-6-6"/>', check: '<path d="M20 6 9 17l-5-5"/>', copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
    archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>', dot: '<circle cx="12" cy="12" r="4.5" fill="currentColor"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.112z"/><path d="m21.854 2.147-10.94 10.939"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    picked: '<path class="fill" d="M12 3.5c.4 3.9 2.2 6 6.5 6.5-4.3.5-6.1 2.6-6.5 6.5-.4-3.9-2.2-6-6.5-6.5 4.3-.5 6.1-2.6 6.5-6.5z"/><path class="fill" d="M18.5 15.5c.2 1.5.8 2.2 2 2.5-1.2.3-1.8 1-2 2.5-.2-1.5-.8-2.2-2-2.5 1.2-.3 1.8-1 2-2.5z"/>', msg: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>', bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>', lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    slash: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>', newer: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7"/>',
    phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>', desktop: '<rect x="2.5" y="4" width="19" height="12.5" rx="1.5"/><path d="M8.5 20.5h7M12 16.5v4"/>',
    flag: '<path d="M5 21V4M5 4h12l-2.5 4.5L17 13H5"/>', expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>', layers: '<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 21h10a2 2 0 0 0 2-2V9"/>',
    pr: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5V21M13 6h3a2 2 0 0 1 2 2v7.5"/><path d="m15 3.5-2.5 2.5L15 8.5"/>', shield: '<path d="M12 21s7.5-3.5 7.5-9.5V5.5L12 3 4.5 5.5v6C4.5 17.5 12 21 12 21z"/><path d="m9 12 2 2 4-4"/>' };
  const glyph = (a) => { const s = el('span', { 'aria-hidden': 'true', style: 'display:inline-flex' }); s.innerHTML = `<svg class="glyph" viewBox="0 0 24 24">${GLYPHS[a]}</svg>`; return s; };
  const icon = (a) => { const s = el('span', { class: `icon i-${a}`, 'aria-hidden': 'true' }); s.innerHTML = `<svg viewBox="0 0 24 24"><path d="${ICONS[a]}"/></svg>`; return s; };
  /** The new look's icon tile (ui.css): a project's own picture when the board holds one, else one of this page's line drawings. */
  const uiIcon = ({ src, draw }) => { const s = el('span', { class: 'ui-icon', 'aria-hidden': 'true' }); if (src) s.append(el('img', { src, alt: '' })); else s.innerHTML = `<svg viewBox="0 0 24 24"><path d="${ICONS[draw]}"/></svg>`; return s; };
  /** The new look's row (ui.css), as the parts of a link or button: the icon tile, the title with what follows it and a P0-P3 chip only when one is set,
   * then one second line (project and time) or, where there is progress, a bar with its percent (and what leads it, such as a report's kind, or a bar of its own). */
  const uiRow = ({ tile, title, after = '', priority, meta, progress, badge = '', lead = '', bar }) => [tile, el('span', { class: 'rm' },
    el('span', { class: 'l1' }, el('span', { class: 't', dir: 'auto' }, title), after, progress === undefined ? '' : badge, priority ? el('span', { class: `ui-pc ${priority.toLowerCase()}` }, priority) : ''),
    progress === undefined ? (badge ? el('span', { class: 'l2' }, el('span', { class: 'meta', dir: 'auto' }, meta), badge) : el('span', { class: 'l2 meta', dir: 'auto' }, meta)) : el('span', { class: 'l2' }, lead, bar ?? el('span', { class: 'ui-bar' }, el('i', { style: `width: ${progress}%` })), el('span', { class: 'pct' }, `${progress}%`)))];
  /** The property panel (ui.css): one sunk group whose rows are each a mark and a name at the left and a value at the right; a row with an address opens it.
   *  A panel with no row is left out, as a card with no priority, ticket or change shows nothing more. */
  const uiProps = (...rows) => ((rows = rows.filter(Boolean)).length ? el('div', { class: 'ui-props' }, ...rows) : '');
  const uiProp = ({ mark, name, value, href, label, cls = '' }) => el(href ? 'a' : 'div', { class: `ui-pr ${cls}`.trim(), ...(href && { href, ...(/^https?:/.test(href) && { target: '_blank', rel: 'noopener' }) }),
    ...(label && { 'aria-label': label }) }, el('span', { class: 'k' }, glyph(mark), name), el('span', { class: 'v' }, ...[value].flat()));
  /** A card's priority as its chip, only where one is set. */
  const priorityProp = (p) => p && uiProp({ mark: 'flag', name: 'Priority', value: el('span', { class: `ui-pc ${p.toLowerCase()}` }, p) });
  /** The ticket a card belongs to: its title in full, then a bar with its percent once work on it has begun (full at 100%). The row opens the ticket's page. */
  const ticketProp = (t, name = 'Ticket') => t && uiProp({ mark: 'layers', name, cls: 'tall', href: `#ticket/${t.id}`, label: `${name}: ${t.title}, ${t.progress}% done`,
    value: [el('span', { class: 'wt', dir: 'auto' }, t.title), el('span', { class: 'bp' }, ...(t.progress > 0 ? [el('span', { class: 'ui-bar', 'aria-hidden': 'true' }, el('i', { style: `width: ${t.progress}%` })),
      el('span', { class: 'n' }, `${t.progress}%`)] : [el('span', { class: 'n' }, 'Not started')]))] });
  /** The change a card links: a pull request by its number, any other link by the site it opens. */
  const changeProp = (d) => { const c = changeHref(d), pr = /\/(?:pull|pulls|merge_requests)\/(\d+)/.exec(c)?.[1];
    return c && uiProp({ mark: 'pr', name: pr ? 'Pull request' : 'Change', href: c, label: `Open the change for ${headline(d)}`, value: el('span', {}, pr ? `#${pr}` : new URL(c).host) }); };
  /** The phone's tab bar is drawn once, so its pill slides from the area left to the one opened; each redraw marks the area on screen and sets the badges, and a badge whose count changed bumps. */
  const tabPill = el('span', { class: 'hl', 'aria-hidden': 'true' }), tabLinks = TABS.map(([a, name]) => el('a', { href: `#${a}`, 'aria-label': name }, icon(`tab-${a || 'today'}`)));
  document.documentElement.style.setProperty('--dock-n', TABS.length);
  tabLinks.forEach((t) => t.addEventListener('click', () => buzz('tick')));
  document.getElementById('tabs').append(tabPill, ...tabLinks);
  function paintTabs(active, count, badged) {
    TABS.forEach(([a, name], i) => {
      const t = tabLinks[i];
      t.setAttribute('aria-label', count(a) !== undefined ? `${name}, ${count(a)}${a === 'reports' && !state.readonly ? ' new' : ''}` : name);
      if (a !== active) return t.removeAttribute('aria-current');
      t.setAttribute('aria-current', 'page');
      // The first drawing puts the pill in place; after that it slides.
      const first = !tabPill.style.transform;
      if (first) tabPill.style.transition = 'none';
      tabPill.style.transform = `translateX(calc(${i} * (100% + 2px)))`;
      if (first) void tabPill.offsetWidth, tabPill.style.transition = '';
    });
    tabLinks.forEach((t, i) => {
      const n = badged(TABS[i][0]) ? count(TABS[i][0]) : 0;
      let bd = t.querySelector('.bd');
      if (!n) return bd?.remove();
      if (!bd) t.append(bd = el('span', { class: `bd${TABS[i][0] === 'reports' ? ' ink' : ''}`, 'aria-hidden': 'true' }));
      if (bd.textContent && bd.textContent !== String(n) && !calm.matches) { bd.classList.remove('bump'); void bd.offsetWidth; bd.classList.add('bump'); }
      bd.textContent = String(n);
    });
  }
  // A design with only screen notes (answer 'screens') still waits for its design-wide verdict.
  const isAnswered = (d) => Object.hasOwn(state.answers, d.key) && !(d.type === 'design' && state.answers[d.key].answer === 'screens');
  /** A design review a lead posts is Main's to pass first: it lives under Designs, never in Decide, Answered or any count of asks, until Main promotes it (sign-off-axi promote). */
  const promoted = (d) => (state.promoted ?? []).includes(d.key);
  /** Each item lives in one area: a design review Main has not promoted under Designs, then answered items, then the area the item names, then evidence updates (never an ask, whatever their result),
   *  then what is only to read (explainers, pages with nothing to answer), then the open asks.
   *  A plan has no options but waits for its send-back, unless it is guided with no decisions: that one is for reading. */
  const area = (d) => {
    if (d.kind === 'design' && !promoted(d)) return 'designs';
    const a = isAnswered(d) ? 'answered' : d.type === 'evidence' ? 'evidence' : d.area ?? (state.readonly || d.type === 'explainer' || !(d.options.length || d.reply || d.type === 'signin' || (d.type === 'plan' && !(d.guided && !d.decisions?.length)) || d.kind === 'design') ? 'reports' : 'waiting');
    // Reports lists only what explains: a page to tap through, or a narrated video. Text alone (a receipt, a status line) is a note, folded under it.
    return a === 'reports' && !state.readonly && d.type !== 'explainer' && !reads(d) ? 'notes' : a;
  };
  /** A page to open: an .html view, framed in a sandbox. */
  const reads = (d) => /\.html$/i.test(d.view ?? '') || !!d.guided;
  /** Where a card's picture opens: a report or plan is its live page, and on a phone any card is its own screen, never the raw capture file (a desktop screenshot shrunk to nothing). Empty on a desk, where the file opens in a tab. */
  const pageHref = (d) => (reads(d) ? (d.type === 'plan' ? `#waiting/${d.key}` : `#reports/${d.key}`) : matchMedia('(max-width: 43.6875rem)').matches ? (d.type === 'evidence' ? `#evidence/${d.key}` : askHref(d)) : '');
  // One formatter each, made once: a list of hundreds of cards stamps every one.
  const HHMM = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }), DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
  const hhmm = (at) => HHMM.format(new Date(at));
  /** Where an item opens: its own area, and inside Waiting on you a plan or a design has its own screen; every other ask opens on Decide. A design under Designs opens its review. */
  const askHref = (d) => {
    const a = area(d);
    if (a === 'designs') return `#designs/${d.key}`;
    if (a !== 'waiting') return `#${a === 'notes' ? 'reports' : a}`;
    return d.type === 'plan' ? `#waiting/${d.key}` : d.kind === 'design' ? `#designs/${d.key}` : `#decide/${d.key}`;
  };
  const left = (at) => { const m = Math.ceil((Date.parse(at) - Date.now()) / 60_000); return m <= 0 ? 'deadline passed' : `${mins(m)} left`; };
  /** The time left to the second, as a timer reads (11:41 left), for the last hour; before that, as left says it. */
  const clock = (at) => { const s = Math.ceil((Date.parse(at) - Date.now()) / 1000); return s <= 0 ? 'deadline passed' : s < 3600 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left` : left(at); };
  const isToday = (at) => new Date(at).toDateString() === new Date().toDateString();
  const day = (at) => DAY.format(new Date(at));
  const when = (at) => (isToday(at) ? hhmm(at) : `${day(at)} ${hhmm(at)}`);
  /** A time as a person says it: today needs no date. */
  const stamp = (at) => (isToday(at) ? `Today, ${hhmm(at)}` : `${day(at)}, ${hhmm(at)}`);
  const pic = (d) => {
    const i = d.media?.findIndex((m) => !/\.(mp4|webm)$/i.test(m.path)), m = d.mocks?.find((x) => !/\.html?$/i.test(x.path));
    return d.kind === 'design' && designFrame(d) ? designUrl(d, designFrame(d)) : i >= 0 ? filesOf(d)[i][3] : d.preview ? mockUrl(d.key, '', d.preview) : d.type === 'diagram' ? mockUrl(d.key, '', d.view)
      : m ? mockUrl(d.key, m.value, m.path) : d.evidenceCard?.media.find((x) => x.type.startsWith('image/'))?.url;
  };
  const thumb = (a, url) => { if (!url) return icon(a); const img = el('img', { class: 'thumb', src: src(url), alt: '', loading: 'lazy', decoding: 'async' }); img.onerror = () => img.replaceWith(icon(a)); return img; };

  const LEASH = { ask: ['Ask me first', 'Ask first', 'Agents wait for you on every ask.'], matters: ['Ask when it matters', 'When it matters', 'At an ask\u2019s deadline the board takes its default. Money, deletes and security always wait for you.'],
    act: ['Act, then tell me', 'Act, then tell', 'Agents take their pick at once and tell you. Money, deletes and security always wait for you.'] };
  /** Why an ask is never answered for the person, whatever the leash: its --guard, or what its kind and title say it does. */
  const GUARD = { destructive: 'it deletes or overwrites something', irreversible: 'it can\u2019t be undone', money: 'it spends money', credential: 'it touches a password or key', security: 'it changes who can get in' };
  /** An answer the person did not give: taken by the board at the ask's deadline (default), or picked by its agent at once (agent). */
  const takenOf = (a) => (a?.taken === 'default' || a?.taken === 'agent' ? a.taken : undefined);
  const tookWord = (a) => (takenOf(a) === 'default' ? `Taken by default at ${when(a.at)}` : `Agent picked ${a.label}, tell me if wrong`);
  /** The card's last answer on its trail: an answer the leash took carries `opened` once the person opened the card after it, on any device. */
  const lastAnswer = (key) => trailOf(key, 'answer').at(-1);
  // One opened stays under Taken without you until the board is opened again, so the row a person is reading never jumps away.
  const tookNow = new Set();
  const unopened = (key) => { const t = lastAnswer(key); return !!t?.taken && (!t.opened || tookNow.has(key)); };
  const openTook = (key) => {
    const t = lastAnswer(key);
    if (!t?.taken || t.opened || FROZEN || state.readonly) return;
    tookNow.add(key);
    t.opened = new Date().toISOString();
    postJson('/api/trail', { key }).catch(() => (t.opened = undefined));
  };
  /** The Leash, in Today's More and from Decide's leash chip: three segments that save the leash: line of config.yaml, and what the chosen one means under them.
   *  A board that takes no changes shows it without them working; an answers-only board takes it, as it is the person's own setting. */
  function leash() {
    const err = el('div', { class: 'err', role: 'alert' }), still = FROZEN || state.readonly;
    const seg = el('div', { class: 'ui-seg', role: 'group', 'aria-label': 'Leash' }, ...Object.entries(LEASH).map(([v, [, short]]) => {
      const b = el('button', { 'aria-pressed': String(state.leash === v) }, short);
      b.disabled = Boolean(still);
      b.onclick = () => {
        if (state.leash === v) return;
        seg.querySelectorAll('button').forEach((x) => (x.disabled = true));
        call('/api/leash', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ leash: v }) }).catch((e) => {
          err.textContent = `Couldn't save the leash: ${e.message}`;
          seg.querySelectorAll('button').forEach((x) => (x.disabled = false));
        });
      };
      return b;
    }));
    return [el('p', { class: 'ui-dl' }, 'How much may agents do without asking?'), seg, el('p', { class: 't-line' }, LEASH[state.leash][2]), err];
  }
  const hrefOf = (d) => (area(d) === 'reports' && reads(d) ? `#reports/${d.key}` : area(d) === 'evidence' ? `#evidence/${d.key}` : askHref(d));

  /* Today, as the approved prototype draws it: the title row with light or dark, Up next with one main action, the next three asks waiting on you, then Cleared today and Proofs today,
     and under them one quiet line into More, which holds what the screen leaves off. A phone stacks them; a desk sets Up next and the tiles beside what else waits.
     Search is the dock's round button (the sidebar's on a desk). */
  /** The project a card is for: a plan names it, a report or design names its group, proof names the app its done-done check verified, and an ask takes the project of the proof it rests on,
   *  or, filed by a tool that is itself a project on the board (its icon set with project --icon), that project. */
  const projectName = (d) => d.project || d.group || (d.type === 'evidence' ? projectOf(d) : d.proof && projectOf(state.decisions.find((x) => x.key === d.proof) ?? {}))
    || (ticketOf(d) && tkProject(ticketOf(d))) || (d.by && (state.projects ?? []).find((p) => p.name.toLowerCase() === d.by.toLowerCase())?.name) || undefined;
  /** One project picture and tile for every list; use the pinned record, with a neutral project icon when the project has none. */
  function projectPic(name, fallback = () => glyph('layers')) {
    const p = name && (state.projects ?? []).find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!p?.icon) return fallback();
    const img = el('img', { src: `/api/project-icon?name=${encodeURIComponent(p.name)}&h=${p.icon.sha256.slice(0, 16)}`, alt: '' });
    img.onerror = () => img.replaceWith(fallback());
    return img;
  }
  const projectTile = (name, fallback) => el('span', { class: 'ui-icon', role: 'img', 'aria-label': name || 'No project' }, projectPic(name, fallback));
  const cardTile = (d) => {
    const design = d.kind === 'design' || d.type === 'design', tile = projectTile(projectName(d), () => design ? icon('designs') : d.type === 'plan' ? icon('plan') : d.kind === 'report' || d.type === 'explainer' ? glyph('layers') : icon(d.type === 'evidence' ? 'evidence' : d.reply ? 'reply' : 'yesno'));
    const frame = design && designFrame(d);
    if (frame) { const img = el('img', { class: 'design-thumb', src: src(designUrl(d, frame)), alt: '' }); img.onerror = () => img.replaceWith(projectPic(projectName(d), () => icon('designs'))); tile.replaceChildren(img); }
    return tile;
  };
  /** A card as the new look's row, a link to where it opens: its tile, its title and priority, then its ticket's progress once it has some (a full bar when done), or else its project (or what it is) and when. */
  const progressOf = (n) => (n > 0 ? Math.min(n, 100) : undefined);
  function cardRow(d) {
    const t = ticketOf(d), what = projectName(d) ?? (area(d) === 'waiting' ? kind(d) : NAMES[d.type] ?? 'Report');
    const link = el('a', { class: 'ui-row', href: hrefOf(d), ...(t && { 'aria-label': `${title(d)}, ticket ${t.title}, ${t.progress}% done` }) }, ...uiRow({ tile: cardTile(d), title: d.type === 'signin' ? `Sign in to ${d.title}` : d.type === 'evidence' ? headline(d) : title(d), priority: d.priority, badge: trailBadge(d.key),
      meta: d.type === 'signin' ? el('span', {}, what, d.expires || openedAt(d) ? ' · ' : '', signinRow(d)) : [what, d.filed && filedAt(d.filed)].filter(Boolean).join(' · '), progress: progressOf(t?.progress) }));
    link.onclick = () => (jump = d.key);
    return el('li', {}, link);
  }

  /** Up next leads with a sign-in (someone is blocked now), then an ask with a recommended answer, then one to review; Later comes last. */
  const lead = (d) => (groupOf(d) === 'later' ? 3 : d.type === 'signin' ? 0 : recOf(d) ? 1 : 2);
  let upKey;
  /** Up next: the one ask that matters most, how many wait, its priority, its question, its project, time and the answer recommended, then one main action in ink
   * (answer with the pick, open the sign-in, or review) beside Other answer (or Details), which opens the ask. */
  function upNext(queue) {
    const d = queue[0];
    if (!d) return el('section', { class: 'ui-card ui-hero t-up clear', 'aria-label': 'Up next' }, el('div', { class: 'hl' }, el('span', { class: 'lab' }, 'Up next')),
      el('h2', { class: 'q' }, 'Nothing waits on you'), el('p', { class: 'meta' }, el('span', {}, 'Agents will ask when they need you.')));
    const rec = recOf(d), err = el('div', { class: 'err', role: 'alert', id: 'up-err' }), name = projectName(d);
    const btn = (cls, words, href) => el(href ? 'a' : 'button', { class: `t-btn ${cls}`, ...(href && { href }) }, el('span', { class: 'lbl' }, words));
    let go, soft = btn('white', 'Other answer', askHref(d));
    if (d.type === 'signin') {
      go = expiredLink(d) ? reissue(d, err) : signinOpen(d, undefined, err).open;
      go.className = 't-btn ink';
      if (!expiredLink(d)) go.replaceChildren(el('span', { class: 'lbl' }, 'Open sign-in'));
      soft = btn('white', 'Details', askHref(d));
    } else if (rec) {
      go = btn('ink', `Answer ${rec.label}`);
      go.setAttribute('aria-label', `Answer ${rec.label}, ${d.title}`);
      go.append(el('span', { class: 'okmark', 'aria-hidden': 'true' }, glyph('check')));
      go.onclick = () => { go.classList.add('done'); save(d, rec, [go], err); };
    } else {
      go = btn('ink', groupOf(d) === 'review' || reviewed(d) ? 'Review' : 'Answer', askHref(d));
      soft = '';
    }
    for (const a of [go, soft]) if (a?.tagName === 'A' && a.getAttribute('href')?.startsWith('#')) a.onclick = () => (jump = d.key);
    const fresh = upKey !== undefined && upKey !== d.key;
    upKey = d.key;
    const when = d.type === 'signin' ? (d.expires ? el('span', { ...(!expiredLink(d) && { 'data-left': d.expires }) }, endsWords(d.expires)) : '') : d.filed && filedAt(d.filed);
    return el('section', { class: `ui-card ui-hero t-up${fresh ? ' next' : ''}`, 'aria-label': 'Up next' },
      el('div', { class: 'hl' }, el('span', { class: 'lab' }, `Up next · 1 of ${queue.length}`), d.priority ? el('span', { class: `ui-pc ${d.priority.toLowerCase()}` }, d.priority) : ''),
      el('h2', { class: 'q', dir: 'auto' }, d.type === 'signin' ? `Sign in to ${d.title}` : title(d)),
      el('p', { class: 'meta' }, name ? projectPic(name) : '', el('span', { dir: 'auto' }, name ?? (d.type === 'signin' ? d.waits : kind(d)), ...[when, rec && `Recommended ${rec.label}`].filter(Boolean).flatMap((x) => [' · ', x]))),
      el('div', { class: 't-btns' }, go, soft), err);
  }
  /** A filled 20px mark for a tile, as the prototype draws them. */
  const fill = (d) => { const s = el('span', { class: 'si', 'aria-hidden': 'true' }); s.innerHTML = `<svg viewBox="0 0 20 20"><path d="${d}"/></svg>`; return s; };
  /** Cleared today (answered today, of that and what still waits), which opens Answered, and Proofs today (proof filed today), which opens Evidence. */
  function todayTiles(by) {
    // A first screen does not hold the answered cards or the proofs yet, so today's two numbers come with the page that painted it.
    const cleared = state.counts?.cleared_today ?? by.answered.filter((d) => isToday(state.answers[d.key].at)).length, proofs = state.counts?.proofs_today ?? state.decisions.filter((d) => d.type === 'evidence' && d.filed && isToday(d.filed) && !(state.dismissed ?? []).includes(d.key)).length;
    const stat = (href, mark, lab, n, of) => el('a', { class: 'ui-card ui-stat', href, 'aria-label': `${lab}: ${n}${of === undefined ? '' : ` of ${of}`}` }, fill(mark), el('span', { class: 'lab' }, lab), el('b', {}, String(n), of === undefined ? '' : el('small', {}, ` of ${of}`)));
    return el('div', { class: 'ui-tiles t-tiles' }, stat('#answered', 'M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm3.4 5.1-4.3 4.4-2-2-1.2 1.2 3.2 3.2 5.5-5.6z', 'Cleared today', cleared, cleared + by.waiting.length),
      stat('#evidence', 'M10 1.8l6.8 2.7v5c0 4.4-2.9 7.4-6.8 8.9-3.9-1.5-6.8-4.5-6.8-8.9v-5zm3.6 5.6-1.1-1.1-3.4 3.5-1.6-1.6-1.1 1.1 2.7 2.7z', 'Proofs today', proofs));
  }
  /** Waiting on you: the next three asks after Up next, with See all into Decide. */
  const waitingOn = (rest) => (rest.length ? el('section', { class: 't-wait', 'aria-label': 'Waiting on you' }, el('h2', { class: 'ui-sec' }, 'Waiting on you', el('a', { class: 'see', href: '#waiting' }, 'See all')),
    el('ul', { class: 'ui-card ui-list' }, ...rest.slice(0, 3).map(cardRow))) : '');

  /** A sheet from the bottom (in the middle on a desk): a modal dialog, so the keyboard stays in it and Escape or a tap outside closes it; a link in it closes it as it opens. */
  function sheetOf(id) {
    const s = el('dialog', { class: 't-sheet', id, 'aria-labelledby': `${id}-h` });
    s.onclick = (e) => { if (e.target === s || e.target.closest('a[href^="#"]')) s.close(); };
    document.body.append(s);
    return s;
  }
  const sheetHead = (id, name) => { const x = el('button', { class: 'x', 'aria-label': 'Close' }, glyph('x')); x.onclick = () => x.closest('dialog').close(); return el('div', { class: 't-shd' }, el('h2', { id: `${id}-h`, tabindex: '-1' }, name), x); };
  /** More: what Today leaves off, Answered and Designs with their counts, the Leash and Ask the agent, and last the version the board runs. */
  const todayMore = sheetOf('t-more');
  function fillMore(by) {
    const go = (href, name, n) => el('a', { class: 'ui-pr', href }, el('span', { class: 'k' }, name), el('span', { class: 'v' }, el('span', { class: 'n' }, String(n)), glyph('right')));
    const links = [['#answered', 'Answered', by.answered], ['#designs', 'Designs', by.designs]].filter(([, , l]) => l.length);
    todayMore.replaceChildren(el('div', {}, sheetHead('t-more', 'More'), links.length ? el('div', { class: 'ui-props' }, ...links.map(([h, name, l]) => go(h, name, l.length))) : '',
      ...(state.leash ? leash() : []), ...(FROZEN || state.readonly || state.answers_only ? [] : [ask()]),
      FROZEN ? '' : window.signOffInstall?.() ?? '',
      state.version ? el('div', { class: 'ui-props' }, el('div', { class: 'ui-pr' }, el('span', { class: 'k' }, 'Version'), el('span', { class: 'v' }, el('span', {}, state.version)))) : ''));
  }
  const hasMore = (by) => by.answered.length || by.designs.length || state.leash || state.version || !(FROZEN || state.readonly || state.answers_only);
  /** Search: each card's title and what it says, matched as typed, in groups (Asks, Proof, Reports, Answered, Designs, Tickets) of the first four rows each. */
  const searchSheet = sheetOf('t-search');
  let query = '';
  function openSearch() {
    if (searchSheet.open) return searchSheet.querySelector('input').focus();
    const box = el('input', { type: 'search', id: 'find', 'aria-label': 'Search the board', placeholder: 'An ask, a proof, a report or a ticket', autocomplete: 'off', enterkeyhint: 'search' }), out = el('div', {});
    const show = () => {
      const q = query.trim().toLowerCase(), gone = new Set(state.dismissed ?? []), hit = (...s) => s.join(' ').toLowerCase().includes(q);
      const cards = q ? state.decisions.filter((d) => !gone.has(d.key) && hit(title(d), d.about ?? '', projectName(d) ?? '')).reverse() : [];
      const group = (name, ...as) => [name, cards.filter((d) => as.includes(area(d))).slice(0, 4).map(cardRow)];
      const tickets = q ? (state.tickets ?? []).filter((t) => hit(t.title, t.id)).slice(0, 4).map((t) => el('li', {}, el('a', { class: 'ui-row', href: `#ticket/${t.id}` }, ...uiRow({ tile: tkTile(t), title: t.title, progress: progressOf(t.progress), meta: 'Not started' })))) : [];
      const groups = [group('Asks', 'waiting'), group('Proof', 'evidence'), group('Reports', 'reports', 'notes'), group('Answered', 'answered'), group('Designs', 'designs'), ['Tickets', tickets]].filter(([, rows]) => rows.length);
      out.replaceChildren(...(!q ? [el('p', { class: 't-grp' }, 'Type to search the whole board.')] : groups.length ? groups.flatMap(([name, rows]) => [el('p', { class: 't-grp' }, name), el('ul', { class: 'ui-card ui-list' }, ...rows)])
        : [el('p', { class: 't-grp' }, `Nothing matches “${query.trim()}”.`)]));
    };
    box.value = query;
    box.oninput = () => { query = box.value; show(); };
    show();
    searchSheet.replaceChildren(el('div', {}, sheetHead('t-search', 'Search'), el('label', { class: 't-find', role: 'search' }, document.getElementById('dock-find').firstChild.cloneNode(true), box), out));
    searchSheet.showModal();
    box.focus();
  }
  // Closed from the address #find, the sheet leaves Today at its own address.
  searchSheet.addEventListener('close', () => location.hash === '#find' && history.replaceState(null, '', location.pathname + location.search));
  // Search, the dock's round button or the sidebar's, opens over the screen it is tapped on.
  addEventListener('click', (e) => { if (e.target.closest?.('a[href="#find"]')) e.preventDefault(), openSearch(); });

  /* Tickets, as the approved prototype draws them: Your asks or System, the done dot grid, then In progress, On hold and To do; a ticket opens over the list on a phone
     (its project and state, its title in full, its priority, progress and what it sits under, the tickets under it, its cards and their Activity) and in a third column on a desk.
     An epic is a ticket with tickets under it, and those may have sub-tasks: the lists hold the tickets that sit under none, each as far along as what is under it (the server rolls it up). */
  const TK_WORDS = { done: 'Done', hold: 'On hold', moving: 'In progress', todo: 'To do' };
  // The property rows' marks, as the prototype draws them: a flag, a half-filled circle, two stacked sheets and a clock; fixed strings from this page.
  const TK_MARKS = { flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>', half: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
    layers: '<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 21h10a2 2 0 0 0 2-2V9"/>', clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>' };
  const tkMark = (a) => { const s = el('span', { class: 'tk-k', 'aria-hidden': 'true' }); s.innerHTML = `<svg viewBox="0 0 24 24">${TK_MARKS[a]}</svg>`; return s; };
  let tkWhose = 'asks', tkProj = '', tkShown = '';
  const tkMore = new Set();
  const tkAll = () => state.tickets ?? [];
  const tkById = (id) => tkAll().find((t) => t.id === id);
  const tkStateOf = (t) => ({ queued: 'todo', 'in progress': 'moving', 'on hold': 'hold', done: 'done' }[t.state] ?? (t.progress >= 100 ? 'done' : t.hold ? 'hold' : t.progress > 0 ? 'moving' : 'todo'));
  const TICKET_STUCK_SECONDS = 6 * 60 * 60;
  const tkStatus = (t) => {
    if (tkUnder(t).length) return [];
    const age = Date.now() / 1000 - t.last_event_at;
    return [t.stage ? el('span', { class: 'ui-pc tk-stage' }, t.stage) : '',
      t.last_event_at !== undefined && t.stage !== 'done' && age > TICKET_STUCK_SECONDS
        ? el('span', { class: 'tk-stuck' }, `stuck ${age < 86400 ? Math.floor(age / 3600) + 'h' : Math.floor(age / 86400) + 'd'}`) : ''];
  };
  const tkUnder = (t) => tkAll().filter((x) => x.parent === t.id);
  /** The tickets a ticket sits under, nearest first; a parent not on the board, or a loop of parents, ends the line. */
  const tkAbove = (t) => { const up = []; for (let x = tkById(t.parent); x && x !== t && !up.includes(x); x = tkById(x.parent)) up.push(x); return up; };
  const tkRoot = (t) => tkAbove(t).at(-1) ?? t;
  // A ticket under another takes the project and the asking of the ticket at the top of its line, unless it names its own project.
  const tkProject = (t) => t.project ?? tkRoot(t).project;
  const tkWhen = (at) => (isToday(at) ? hhmm(at) : day(at));
  /** Under an epic its tickets; under a ticket its sub-tasks. */
  const tkKids = (t) => (tkAbove(t).length ? 'sub-task' : 'ticket');
  /** A ticket uses the same project tile as every card list. */
  const tkTile = (t) => projectTile(tkProject(t), () => icon('pick'));
  /** A ticket's row: its tile, its title and priority, then a bar with its percent once it has progress (a full bar when done), or else where it stands and when it last moved,
   * with how many of what sits under it are done. On a desk the open ticket is marked. */
  function tkRow(t) {
    const kids = tkUnder(t), done = kids.filter((x) => tkStateOf(x) === 'done').length, s = tkStateOf(t);
    const link = el('a', { class: 'ui-row tk-row', href: `#ticket/${t.id}`, ...(t.id === tkShown && { 'aria-current': 'true' }), 'aria-label': `${t.title}, ${TK_WORDS[s].toLowerCase()}${t.progress ? `, ${t.progress}% done` : ''}` },
      ...uiRow({ tile: tkTile(t), title: t.title, priority: t.priority, progress: t.stage && !kids.length ? t.progress : progressOf(t.progress), lead: el('span', { class: 'tk-status' }, ...tkStatus(t)),
        meta: [TK_WORDS[s], kids.length ? `${done} of ${plural(kids.length, tkKids(kids[0]))} done` : tkWhen(t.at)].join(' · ') }));
    if (t.release) link.querySelector('.l1').append(el('span', { class: 'ui-pc tk-release', title: t.release }, t.release));
    return el('li', {}, link);
  }
  /** The tickets the lists hold (those under no ticket on the board), of the kind and project picked. The kinds show only while the board has both. */
  function tkLists() {
    const roots = tkAll().filter((t) => !tkById(t.parent)), asked = roots.filter((t) => t.asked), both = asked.length > 0 && asked.length < roots.length;
    const kind = both ? tkWhose : '', ofKind = roots.filter((t) => !kind || !!t.asked === (kind === 'asks')), shown = ofKind.filter((t) => !tkProj || tkProject(t) === tkProj);
    const byPrio = (x, y) => (x.priority ?? 'P9').localeCompare(y.priority ?? 'P9') || (Date.parse(y.at) || 0) - (Date.parse(x.at) || 0);
    const of = (s) => shown.filter((t) => tkStateOf(t) === s).sort(byPrio);
    return { roots, both, kind, asked: asked.length, ofKind, shown, done: of('done'), moving: of('moving'), hold: of('hold'), todo: of('todo') };
  }
  const tkHeroLabel = (kind) => (kind === 'asks' ? 'Your asks done' : kind === 'system' ? 'System work done' : 'Tickets done');
  /** The done dot grid: one square per ticket, done in ink, moving in the middle tone, the rest light; as many columns (24 to 30) as leave the fewest empty squares. */
  function tkDots(L) {
    const n = L.shown.length;
    if (!n) return '';
    let cols = 27, best = Infinity;
    for (let c = 24; c <= 30; c++) { const waste = Math.ceil(n / c) * c - n; if (waste < best || (waste === best && c === 27)) [best, cols] = [waste, c]; }
    return el('div', { class: 'tk-dots', role: 'img', style: `--cols:${cols};--rows:${Math.ceil(n / cols)}`, 'aria-label': `${L.done.length} done, ${L.moving.length} in progress, ${n - L.done.length - L.moving.length} on hold or to do` },
      ...[...L.done, ...L.moving, ...L.hold, ...L.todo].map((t) => el('i', { class: { done: 'd', moving: 'm' }[tkStateOf(t)] ?? '' })));
  }
  function tkHero(L) {
    const week = L.done.filter((t) => Date.now() - Date.parse(t.at) < 7 * 864e5).length;
    return el('section', { class: 'ui-card ui-hero tk-hero' }, el('div', { class: 'hl' }, el('span', { class: 'lab' }, tkHeroLabel(L.kind)), week ? el('span', { class: 'chip' }, el('i', { class: 'up', 'aria-hidden': 'true' }), `${week} this week`) : ''),
      el('div', { class: 'hv' }, el('span', { class: 'big' }, String(L.done.length), el('small', {}, ` of ${L.shown.length}`)), L.moving.length ? el('span', { class: 'vs' }, el('i', { 'aria-hidden': 'true' }), `${L.moving.length} moving`) : ''), tkDots(L));
  }
  /** Your asks or System, each with how many it holds. */
  function tkSeg(L) {
    const b = (v, name, n) => { const x = el('button', { 'aria-pressed': String(L.kind === v) }, name, el('small', {}, String(n))); x.onclick = () => { tkWhose = v; tkProj = ''; buzz('tick'); render(); }; return x; };
    return L.both ? el('div', { class: 'ui-seg tk-seg', role: 'group', 'aria-label': 'Whose tickets' }, b('asks', 'Your asks', L.asked), b('system', 'System', L.roots.length - L.asked)) : '';
  }
  /** The project filter: a round button in the header (marked while one is picked) that opens a sheet of the projects with tickets, and Every project. */
  const tkFilterSheet = sheetOf('tk-filter');
  function tkFilter(L) {
    const names = [...new Set(L.ofKind.map(tkProject).filter(Boolean))].sort((x, y) => x.localeCompare(y));
    if (!names.length) return '';
    const b = el('button', { class: `ui-rb tk-rb${tkProj ? ' on' : ''}`, 'aria-label': tkProj ? `Filter by project: ${tkProj}` : 'Filter by project', 'aria-haspopup': 'dialog' });
    b.innerHTML = '<svg class="glyph" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 6h13M6 10h8M8.5 14h3"/></svg>';
    b.onclick = () => {
      const pick = (name, n, tile) => { const x = el('button', { class: 'ui-pr tk-pick', ...(tkProj === name && { 'aria-current': 'true' }) }, el('span', { class: 'k' }, tile, name || 'Every project'), el('span', { class: 'v' }, el('span', { class: 'n' }, String(n)), tkProj === name ? glyph('check') : ''));
        x.onclick = () => { tkProj = name; tkFilterSheet.close(); render(); }; return x; };
      tkFilterSheet.replaceChildren(el('div', {}, sheetHead('tk-filter', 'Filter by project'), el('div', { class: 'ui-props' }, pick('', L.ofKind.length, ''),
        ...names.map((p) => pick(p, L.ofKind.filter((t) => tkProject(t) === p).length, el('span', { class: 'tk-pt', 'aria-hidden': 'true' }, projectPic(p)))))));
      tkFilterSheet.showModal();
      tkFilterSheet.querySelector('h2').focus();
    };
    return b;
  }
  /** One list of tickets under its head: on a phone the first three with See all, on a desk a card whose rows scroll inside it. */
  function tkGroup(key, name, list, desk, cls = '') {
    if (desk) return el('section', { class: `ui-card tk-card ${cls}`, 'aria-label': name }, el('h2', { class: 'tk-ch' }, name, el('small', {}, String(list.length))),
      list.length ? el('ul', { class: 'ui-list tk-rows' }, ...list.map(tkRow)) : el('p', { class: 'tk-none' }, 'None.'));
    if (!list.length) return '';
    const all = tkMore.has(key), see = el('button', { class: 'see' }, all ? 'Show fewer' : 'See all');
    see.onclick = () => { all ? tkMore.delete(key) : tkMore.add(key); render(); };
    return el('section', { 'aria-label': name }, el('h2', { class: 'ui-sec' }, name, el('small', {}, String(list.length)), list.length > 3 ? see : ''), el('ul', { class: 'ui-card ui-list' }, ...(all ? list : list.slice(0, 3)).map(tkRow)));
  }
  // A tap is aimed where the finger went down. When the list moves under it before the tap lands (a redraw, an image, the page settling), the tap lands on the row that slid under
  // the finger and opens a ticket; a tap that began on a section's See all or Show fewer does that button's work instead.
  let tkSeeDown = null;
  addEventListener('pointerdown', (e) => { const b = e.target.closest?.('body.tickets .ui-sec button.see'); tkSeeDown = b && { label: b.closest('section')?.getAttribute('aria-label'), at: e.timeStamp }; }, true);
  addEventListener('click', (e) => {
    const down = tkSeeDown;
    tkSeeDown = null;
    if (!down || e.timeStamp - down.at > 1000 || e.target.closest?.('.ui-sec button.see')) return;
    e.preventDefault(), e.stopPropagation();
    [...document.querySelectorAll('main section[aria-label]')].find((s) => s.getAttribute('aria-label') === down.label)?.querySelector('.ui-sec button.see')?.click();
  }, true);
  /** The Tickets screen. On a phone: the title row, Your asks or System, the hero, then In progress, On hold, To do and Done, and two tiles, with the open ticket as a sheet over them.
   * On a desk: one filled screen, the head across, then the hero over In progress, On hold over To do, and the open ticket (the first one moving when none is picked). */
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
  let tkUp = '';
  function tkSheet(t) {
    const rise = !tkUp, x = el('a', { class: 'x', href: ticketBack || '#tickets', 'aria-label': 'Close' }, glyph('x'));
    tkUp = t.id;
    return el('div', { class: `tk-over${rise ? ' up' : ''}`, 'data-key': t.id }, el('a', { class: 'tk-scrim', href: ticketBack || '#tickets', tabindex: '-1', 'aria-label': 'Close' }),
      el('section', { class: 'tk-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': t.title }, el('div', { class: 'grab', 'aria-hidden': 'true' }), ...ticketPage(t, x)));
  }
  addEventListener('keydown', (e) => e.key === 'Escape' && !e.defaultPrevented && document.querySelector('.tk-sheet') && !document.querySelector('dialog[open]') && (location.hash = ticketBack || '#tickets'));
  /** A ticket: its project and where it stands, its title in full, its priority, progress, what it sits under and when it last moved; then the tickets under it, the cards that name it
   * and their Activity, newest first. */
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
  function tkSettle() {
    if (phone()) return;
    for (const l of document.querySelectorAll('.tk-card .tk-rows')) {
      l.classList.remove('fades', 'at-end'); l.style.height = l.style.flex = l.style.paddingBottom = '';
      if (l.scrollHeight <= l.clientHeight + 1) continue;
      const top = l.getBoundingClientRect().top + l.clientTop, h = l.clientHeight, ends = [...l.children].map((r) => r.getBoundingClientRect().bottom - top);
      const last = ends.filter((b) => b <= h + 0.5).at(-1) ?? 0, room = h - last;
      if (room < 40) { l.style.flex = 'none'; l.style.height = `${last}px`; continue; }
      l.style.setProperty('--fz', `${room}px`); l.style.paddingBottom = `${room}px`; l.classList.add('fades');
      l.onscroll = () => l.classList.toggle('at-end', l.scrollTop + l.clientHeight >= l.scrollHeight - 2);
    }
  }
  addEventListener('resize', () => document.querySelector('.tk-desk') && tkSettle());
  /** On a desk a list's column and the open item scroll inside themselves; while one holds more than it shows it fades out over its last 64px, and the fade goes at its end. */
  // What is in them can grow after they are drawn (a report's page loads), so each is looked at again when a part of it changes size.
  const settled = 'ResizeObserver' in window && new ResizeObserver(() => uiSettle());
  function uiSettle() {
    for (const a of document.querySelectorAll('.ui-desk :is(.ui-col, .ui-pane:not(.ask2), .ask2 > .pbody)')) {
      a.onscroll = () => a.classList.toggle('at-end', a.scrollTop + a.clientHeight >= a.scrollHeight - 2);
      a.classList.toggle('fades', a.scrollHeight > a.clientHeight + 1); a.onscroll();
      if (settled) for (const part of a.children) settled.observe(part);
    }
  }
  addEventListener('resize', () => document.querySelector('.ui-desk') && uiSettle());

  /** Light or dark: the system's, unless one is picked here. A pick turns each dark-scheme media rule of the page's own sheets on or off (the board draws dark only there),
   * sets the colour scheme and the browser's bar colour, and is kept in this browser. */
  const sysDark = matchMedia('(prefers-color-scheme: dark)'), schemeRules = new Map();
  const isDark = () => (localStorage.getItem('so-theme') ?? (sysDark.matches ? 'dark' : 'light')) === 'dark';
  function applyTheme() {
    let pick = null;
    try { pick = localStorage.getItem('so-theme'); } catch {}
    const walk = (r) => (r instanceof CSSMediaRule ? [r, ...[...r.cssRules].flatMap(walk)] : []);
    for (const sheet of document.styleSheets) {
      let rules = [];
      try { rules = [...sheet.cssRules].flatMap(walk); } catch {}
      for (const r of rules) {
        if (!schemeRules.has(r)) schemeRules.set(r, r.media.mediaText);
        const was = schemeRules.get(r);
        if (/prefers-color-scheme/.test(was)) r.media.mediaText = pick ? was.replace(/\(\s*prefers-color-scheme:\s*(dark|light)\s*\)/g, (_, s) => (s === pick ? '(min-width: 0px)' : '(max-width: 0.001px)')) : was;
      }
    }
    document.documentElement.style.colorScheme = pick ?? '';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.dataset.media ??= m.media; m.media = pick ? (m.dataset.media.includes(pick) ? 'all' : 'not all') : m.dataset.media; });
  }
  applyTheme();
  /** The round light-or-dark button at the right of a screen's head (Today's, Decide's and Tickets'): a moon in light, a sun in dark. */
  function themeButton() {
    const dark = (() => { try { return isDark(); } catch { return sysDark.matches; } })();
    const b = el('button', { class: 'ui-rb theme', 'aria-label': dark ? 'Switch to light' : 'Switch to dark' });
    b.innerHTML = `<svg class="glyph" viewBox="0 0 20 20" aria-hidden="true">${dark ? '<circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3"/>' : '<path d="M16 11.6A6.5 6.5 0 1 1 8.4 4a5.2 5.2 0 0 0 7.6 7.6z"/>'}</svg>`;
    b.onclick = () => { try { localStorage.setItem('so-theme', dark ? 'light' : 'dark'); } catch {} applyTheme(); render(); document.querySelector('#board .theme')?.focus({ preventScroll: true }); };
    return b;
  }
  /** Today's head: its title and the light-or-dark button. */
  function todayHead() { return [el('h1', { tabindex: '-1' }, 'Today'), themeButton()]; }
  sysDark.addEventListener('change', () => loaded && render());
  /** The one quiet line under the tiles into More, naming what it holds. */
  function moreLine(by) {
    if (!hasMore(by)) return '';
    const held = [by.answered.length && 'Answered', by.designs.length && 'Designs', state.leash && 'Leash', !(FROZEN || state.readonly || state.answers_only) && 'Ask the agent'].filter(Boolean);
    // The version is named only when More holds nothing else.
    const names = held.length ? held : ['Version'];
    const b = el('button', { class: 't-more-line', 'aria-haspopup': 'dialog' }, el('span', {}, names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]), glyph('right'));
    b.onclick = () => { fillMore(by); todayMore.showModal(); todayMore.querySelector('h2').focus(); };
    return b;
  }
  /** Today itself. A redraw keeps an open More current; the address #find opens Search over it. */
  function today(by) {
    const queue = [...by.waiting].sort((x, y) => lead(x) - lead(y)), up = upNext(queue), rest = waitingOn(queue.slice(1)), tiles = todayTiles(by), more = moreLine(by), replies = repliesOn();
    if (todayMore.open) fillMore(by);
    if (location.hash === '#find' && !searchSheet.open) openSearch();
    const open = by.designs.filter(dzOpen), designs = open.length ? el('section', { class: 't-wait', 'aria-label': 'Designs to review' }, el('h2', { class: 'ui-sec' }, 'Designs to review', el('a', { class: 'see', href: '#designs' }, 'See all')),
      el('ul', { class: 'ui-card ui-list' }, ...open.slice(0, 2).map(designRow))) : '';
    return phone() ? [up, replies, rest, designs, tiles, more] : [el('div', { class: 't-cols' }, el('div', {}, up, tiles, more), el('div', {}, replies, rest, designs))];
  }

  /** A short row's second line: what changed, unless the headline already says it. */
  const sub = (d) => (d.type === 'signin' ? `Unlocks: ${d.unlocks}` : d.about && d.about !== headline(d) ? d.about : area(d) === 'waiting' ? kind(d) : NAMES[d.type] ?? d.type);
  /** A short row: a picture (or the area's mark) and the title; an answered item has its answer and time under the title. */
  const compact = (d, a) => {
    const s = state.answers[d.key];
    if (d.type === 'plan' && s?.answer === 'sent') {
      const changes = (s.notes ?? []).filter((n) => n.verdict === 'change').length, picks = Object.keys(s.decisions ?? {}).length;
      return [Object.assign(icon('plan'), { className: 'icon i-plan sent' }), el('span', { class: 't' }, el('strong', { dir: 'auto' }, title(d)),
        el('span', { class: 'sent-line' }, glyph('check'), 'Sent back'), el('span', { class: 'meta' }, `${plural(changes, 'change')}, ${plural(picks, 'decision')} · ${when(s.at)}`))];
    }
    return [thumb(d.type === 'plan' ? 'plan' : a, pic(d)), el('span', { class: 't' }, el('strong', { dir: 'auto' }, title(d)), s
      ? el('span', { class: 'ans' }, el('b', { dir: 'auto' }, s.answer === 'text' ? 'Your reply' : s.label), el('time', {}, when(s.at)))
      : el('span', { class: 'meta', dir: 'auto' }, sub(d)))];
  };
  let jump = null; // The item a Summary row was tapped for, scrolled to on its area's screen.

  /** Answered: a short row per item, today's first; a tap opens the full card in place, to change the answer. */
  function done(items) {
    const line = (d) => {
      const box = el('details', { class: 'done', ...((opened.has(d.key) || jump === d.key) && { open: '' }) }, el('summary', { class: 'compact' }, ...compact(d, 'answered')), row(d, { x: false }));
      box.ontoggle = () => (box.open ? opened.add(d.key) : opened.delete(d.key));
      return el('li', {}, box, xBtn(d));
    };
    const fresh = items.filter((d) => isToday(state.answers[d.key].at)), older = items.filter((d) => !fresh.includes(d));
    return [['Today', fresh], ['Earlier', older]].filter(([, list]) => list.length).flatMap(([name, list], i) => [
      el('div', { class: 'sec-head' }, el('h2', {}, name)), el('ul', { class: 'card rows i-answered' }, ...list.map(line))]);
  }

  /** Step marks: what a step uses or can stop on. The board file names them by word; the shapes are this page's own. */
  const MARKS = { ai: 'AI model', store: 'Stores', gate: 'Gate', fail: 'Hard fail' };
  const marks = (t) => el('span', { class: 'marks' }, ...(t.marks ?? []).map((m) => el('span', { class: `mk mk-${m}`, role: 'img', 'aria-label': MARKS[m] })));
  const opened = new Set(); // Reports and answered rows opened in place, kept open across redraws.
  const decided = (d) => (d.decided ? el('p', { class: 'decided', dir: 'auto' }, el('span', { class: 'lbl' }, 'What it decided'), d.decided) : '');
  /** One line drawing per form a report explains with, as the design draws them; a report with no form gets the book. */
  const FORMS = {
    diagram: ['Diagram', '<rect x="7" y="10" width="14" height="26" rx="3"/><path d="M15 17a4 4 0 1 0 4 5 3 3 0 0 1-4-5z"/><rect x="28" y="12" width="14" height="18" rx="2"/><path d="M33 34h4M21 23h7" stroke-dasharray="2 3"/>'],
    chart: ['Chart', '<path d="M6 40h36"/><path d="M11 34V24M19 34V16M27 34V8M35 34V20" stroke-width="5"/>'],
    'before-after': ['Before and after', '<rect x="6" y="8" width="16" height="30" rx="3.5"/><rect x="26" y="8" width="16" height="30" rx="3.5"/><path d="M11 30h6M31 18h6M31 24h6M31 30h6"/>'],
  };
  const BOOK = '<path d="M24 14v26M8 36a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h9a7 7 0 0 1 7 7 7 7 0 0 1 7-7h9a2 2 0 0 1 2 2v24a2 2 0 0 1-2 2H30a6 6 0 0 0-6 6 6 6 0 0 0-6-6z"/>';
  function rth(d) {
    const tile = el('span', { class: 'rth', 'aria-hidden': 'true' });
    tile.innerHTML = `<svg viewBox="0 0 48 48">${FORMS[d.form]?.[1] ?? BOOK}</svg>`;
    return tile;
  }
  /** What a report is for, its kind: a line icon, a short name for the row's chip, its full name for the head and the filter, and one line on what it is for.
   *  Each kind's chip is a neutral treatment from the palette (ink, an outline, a soft fill), told apart by its icon and shape: red and amber stay for priority. */
  const KINDS = {
    research: ['Research', 'Research and discovery', 'What we found out, with sources, so you can choose.', '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>'],
    plan: ['Plan', 'Implementation plan', 'How the work gets built, step by step, before it starts.', '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 5.5 5 5v3M3.8 11.2a1.2 1.2 0 1 1 1.7 1.5L3.8 14h2.4M3.8 17h1.8l-1 1.3a1.1 1.1 0 1 1-.8 1.7"/>'],
    decision: ['Decision', 'Decision and recommendation', 'One choice, the options weighed, and what I recommend.', '<path d="M12 3v18M12 6h6l2 2.5-2 2.5h-6M12 13H6l-2 2.5L6 18h6"/>'],
    audit: ['Audit', 'Audit', 'What was checked against a standard, and what to fix.', '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 13l2.5 2.5 4.5-5"/>'],
    incident: ['Incident', 'Incident and retro', 'What went wrong, why, and what changes so it does not repeat.', '<path d="M12 4 3 20h18z"/><path d="M12 10v4M12 17v.01"/>'],
    status: ['Status', 'Status', 'Where the work stands now and what comes next.', '<path d="M3 12h4l3-7 4 14 3-7h4"/>'],
    other: ['Report', 'Other report', 'An explainer of one idea.', '<path d="M12 7v13M4 18a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4.5A3.5 3.5 0 0 1 12 7.5 3.5 3.5 0 0 1 15.5 4H20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-5a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>'],
  };
  /** A report's kind: the one it was posted with or an agent set; a plan is always an implementation plan. A report with none shows as other. */
  const kindOf = (d) => (KINDS[d.purpose] ? d.purpose : d.type === 'plan' ? 'plan' : 'other');
  const kindSvg = (k) => { const s = el('span', { class: 'rkg', 'aria-hidden': 'true' }); s.innerHTML = `<svg viewBox="0 0 24 24">${KINDS[k][3]}</svg>`; return s; };
  /** The kind's chip: its icon and its short name on a row, its full name on a report's head. */
  const kindChip = (d, full) => { const k = kindOf(d); return el('span', { class: `rkc k-${k}`, 'data-kind': k }, kindSvg(k), (full ? KINDS[k][1] : KINDS[k][0])); };
  /** The kind's tile in the filter and its pill: its icon on the same treatment as its chip; Every kind is the filter's own drawing. */
  const kindTile = (k) => (k ? el('span', { class: `rkt k-${k}` }, kindSvg(k)) : el('span', { class: 'rkt k-all' }, evGlyph('filter')));
  /** One line under a report's title: what this kind of report is for. */
  const purposeLine = (d) => el('p', { class: 'rp-for', dir: 'auto' }, kindSvg(kindOf(d)), KINDS[kindOf(d)][2]);
  /* Reports, as the approved prototype draws them: Newest (or By project), a row each with its project's icon, its title and a bar of how much of it is read. A tap opens it;
     a swipe right marks it read or unread (the row springs home and its bar fills or empties, as in Mail), a swipe left archives it, with Undo. */
  // Read state is kept beside the board, so a phone and a desk agree: one filed today is new until it is opened; read and unread marks override that.
  const unread = (d) => { const o = state.opened?.[d.key]; return o === undefined ? !!d.filed && isToday(d.filed) : !o; };
  /** A guided report's parts, as its page reads them: what this is, what I understood, each section, the next step. A page report has none. */
  const rpParts = (d) => (d.guided ? [...(d.visual ? [['this', GSTAGES.this]] : []), ...(d.understood?.length ? [['understood', GSTAGES.understood]] : []), ...(d.sections ?? []).map((s) => [s.id, s.heading || d.title]), ...(d.next ? [['next', GSTAGES.next]] : [])] : []);
  const partRead = (d, part) => !!state.reads?.[`${d.key}/${part}`];
  /** A report's parts as its strip and its sheet list them: a report 5's kind parts (the sections naming one), else every part of its guided page; each [id, name]. */
  const kindParts = (d) => { const own = (d.sections ?? []).filter((x) => x.part); return own.length ? own.map((x) => [x.id, x.heading]) : rpParts(d); };
  /** A research report's sources: the items of its sources part with a link, and how many are what users report. */
  const sourcesOf = (d) => { const x = (d.sections ?? []).find((y) => y.part === 'sources'), its = (x?.items ?? []).filter((it) => it.link); return x && its.length ? { id: x.id, n: its.length, users: its.filter((it) => it.source === 'user').length } : null; };
  /** How much of a report is read: all of it once read; one not read yet, by the parts of it read (a report 5's kind parts; a page report has none). */
  /** A report's parts as a strip, one segment each, filled once read (all of it once the report is read); on a desk's head each segment names its part. */
  // On an unread row, each segment is a part; over its parts (a sheet, a desk's head), each segment records that part's read state.
  const partsStrip = (d, parts = false) => el('span', { class: 'rp-strip', 'aria-hidden': 'true' }, ...kindParts(d).map(([p]) => el('i', { class: (!parts && !unread(d)) || partRead(d, p) ? 'on' : '' })));
  /** Over a report's parts: the strip of them, and the next part to read. */
  const stripRow = (d) => { const next = kindParts(d).find(([p]) => !partRead(d, p)); return el('div', { class: 'rp-strip-row' }, partsStrip(d, true), next ? el('p', { class: 'rp-next', dir: 'auto' }, `Next: ${next[1]}`) : ''); };
  const readPct = (d) => { if (!unread(d)) return 100; const ps = kindParts(d); return ps.length ? Math.round((100 * ps.filter(([p]) => partRead(d, p)).length) / ps.length) : 0; };
  /** A title or line in plain words: no ticket code ("6198 ", "RL-02: ", "P1 ") ahead of it, and no file path in it ("the report" or "the plan" for one, else "the file"). */
  const plain = (t) => {
    const s = String(t ?? '').replace(/^[\w.-]+ #\d+:\s*/, '').replace(/^\d{3,5}\s+/, '').replace(/^(?:audit\s+)?[A-Z]{2,3}-\d{1,3}:\s*/i, '').replace(/^P[0-3]:?\s+/, '')
      .replace(/(?:~|\/home)\/\S+/g, '').replace(/\b(?:[\w.-]+\/)+([\w.-]+)\.(?:md|json|png|jpe?g|html|sh|mjs|js|ts|py|yaml)\b/g, (m, b) => (/^(report|plan)$/i.test(b) ? `the ${b.toLowerCase()}` : 'the file')).replace(/\s{2,}/g, ' ').trim();
    return s && s[0].toUpperCase() + s.slice(1);
  };
  let rpRisen = false;
  function markRead(keys, read, text) {
    keys.forEach((k) => ((state.opened ??= {})[k] = read));
    render();
    return call('/api/reads', post({ keys, read })).then(() => {
      if (!text) return;
      buzz('tick');
      say(text, 5000, () => markRead(keys, !read).then(() => say('Undone', 3000)), read ? 'ok' : 'undo');
    }, (e) => { keys.forEach((k) => (state.opened[k] = !read)); render(); say(`Couldn't save: ${e.message}`, 8000); });
  }
  const archive = (d) => dismiss([d.key], `Archived: ${title(d)}`, () => returned(d.key), true);
  /** On a desk, the key of the report shown beside the list ('' for none); null on a phone, where a report opens over the list. */
  let rpSel = null, rpVisit = '', rpPicked = false;
  // A report chosen in the desk's list (a click, or J and K) is shown beside it; one reached any other way is a link.
  addEventListener('click', (e) => { if (e.target.closest?.('.split-list a[data-row]')) rpPicked = true; }, true);
  const readToggle = (d) => markRead([d.key], unread(d), `${unread(d) ? 'Marked read' : 'Marked unread'}: ${title(d)}`);
  /** Archive from a desk's key, bar or hover: the row folds away, and when it was the one shown, the next report is selected once the board has it. */
  async function archiveReport(d) {
    const li = document.querySelector(`.split-list .dl-row[data-key="${CSS.escape(d.key)}"]`), rows = [...document.querySelectorAll('.split-list [data-row]')].map((r) => r.getAttribute('href'));
    const at = rows.indexOf(`#reports/${d.key}`), next = rpSel === d.key && location.hash !== '#reports' ? rows[at + 1] ?? rows[at - 1] ?? '#reports' : '';
    if (li) {
      li.style.height = `${li.offsetHeight}px`;
      void li.offsetHeight;
      li.style.transition = `height ${calm.matches ? 0 : 220}ms var(--ease), opacity ${calm.matches ? 0 : 220}ms linear`;
      li.style.height = '0px';
      li.style.opacity = '0';
      await pause(220);
    }
    await archive(d);
    if (next && location.hash === `#reports/${d.key}`) rpPicked = true, location.hash = next;
  }
  /** A report: a row with its project's icon, its title (and its priority when it has one), then its kind and ticket, with a quiet progress track only while unread.
   *  A tap opens its page; an explainer with no page opens in place, to its numbered steps or its video card. */
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
  const reportsSheet = sheetOf('rp-more');
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
  function notes(items) {
    if (!items.length) return '';
    const box = el('details', { class: 'other notes', ...(opened.has('#notes') && { open: '' }) }, el('summary', {}, `Notes (${items.length})`),
      el('p', { class: 'meta' }, 'Receipts and status notes: short text, with no page to open.'),
      el('ul', { class: 'card rows' }, ...items.map((d) => {
        const line = el('details', { class: 'done', ...(opened.has(d.key) && { open: '' }) }, el('summary', { class: 'compact' }, ...compact(d, 'reports')), row(d, { x: false }));
        line.ontoggle = () => (line.open ? opened.add(d.key) : opened.delete(d.key));
        return el('li', {}, line, xBtn(d));
      })));
    box.ontoggle = () => (box.open ? opened.add('#notes') : opened.delete('#notes'));
    return box;
  }

  /** Plan answers stay on the trusted board, never in the agent's sandboxed page. Drafts survive refresh until the server saves them. */
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

  let designSession, boardStale = false;
  addEventListener('message', (e) => {
    const viewer = document.querySelector('.design-viewer[open]');
    if (viewer && e.source === viewer.querySelector('iframe')?.contentWindow && e.data?.['sign-off'] === 'viewer-nav') viewer.dispatchEvent(new KeyboardEvent('keydown', { key: e.data.key }));
  });
  /** A design's review. On a phone (in the reader) one column: its project and day, the whole title, what it shows, the screen, Review full screen, where it stands and what you said,
   *  then the note with Approve in ink beside Change. On a desk two cards: the open design (its picture filling the card) and Where it stands, the note in it and its buttons pinned at its foot.
   *  A design asked as one plain question (design 2, which names the frame Yes approves) shows each screen's frames side by side instead, the changed area outlined on each and named
   *  under it, and is answered once: Yes with an optional note, or Change with what to change. */
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
  const GSTAGES = { this: 'What this is', understood: 'What I understood', found: 'What I found', recommend: 'What I recommend', decide: 'What you decide', next: 'Next step' };
  const GICONS = { chev: '<path d="m6 9 6 6 6-6"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    deeper: '<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>', send: '<path d="M21 3 10 14M21 3l-6.5 18-3.5-7.5L3.5 10z"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    up: '<path d="M7 10v10H4V10zM7 10l4-7c1.3 0 2.2 1 2 2.3L12.5 9H18a2 2 0 0 1 2 2.3l-1.2 6.5A2.5 2.5 0 0 1 16.3 20H7"/>', down: '<path d="M7 14V4H4v10zM7 14l4 7c1.3 0 2.2-1 2-2.3l-.5-3.7H18a2 2 0 0 0 2-2.3l-1.2-6.5A2.5 2.5 0 0 0 16.3 4H7"/>',
    cmt: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"/>',
    spark: '<path d="M12 3.5l1.6 4.9 4.9 1.6-4.9 1.6L12 16.5l-1.6-4.9L5.5 10l4.9-1.6zM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    q: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17h.01"/>', layers: '<path d="M12 4 3.5 8.5 12 13l8.5-4.5zM3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>', eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', hist: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>', view: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>', full: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    warn: '<path d="M12 4 21 20H3zM12 10v4M12 17h.01"/>', play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>',
    simple: '<path d="M5 7h14M5 12h9M5 17h5"/>', bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5.9 1.1.9 1.8V16h5.4v-.4c0-.7.3-1.3.9-1.8A6 6 0 0 0 12 3z"/>' };
  const MENU = [['question', 'q', 'Type your own question'], ['deeper', 'layers', 'More detail on this part'], ['simplify', 'simple', 'The same, in plainer words'], ['example', 'bulb', 'One worked case'], ['why', 'info', 'The reason behind it']];
  const shutMenus = () => document.querySelectorAll('.gd-menu:not([hidden])').forEach((m) => { m.hidden = true; m.previousElementSibling?.setAttribute('aria-expanded', 'false'); });
  addEventListener('click', (e) => { if (!e.target.closest?.('.gd-menuwrap')) shutMenus(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') shutMenus(); });
  const gic = (n, c = '') => { const s = el('span', { 'aria-hidden': 'true', style: 'display:inline-flex' }); s.innerHTML = `<svg class="ic ${c}" viewBox="0 0 24 24">${GICONS[n]}</svg>`; return s; };
  const E = (tag, cls, ...kids) => el(tag, cls ? { class: cls } : {}, ...kids);
  const gnum = (n) => String(Number.isInteger(n) ? n : +n.toFixed(2));
  async function postJson(path, body) {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({ error: `The server replied ${res.status}` }));
    if (!res.ok) throw new Error(out.error);
    state = out;
  }

  // BEGIN markdown
  // Authored text is escaped, then marked up. Every raw character stays in the page (the marks in hidden .mk spans, a link's address in its hidden text),
  // so a selection's offsets, counted in the raw field, still match. Only http(s) links; the page is never given raw HTML.
  const MD_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const mdEsc = (s) => s.replace(/[&<>"']/g, (c) => MD_ESC[c]);
  const mdMark = (s) => `<span class="gd-mk">${mdEsc(s)}</span>`;
  const MD_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\([^\s)]+\))|((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s),;]*[^\s),;.])/gi;
  /** A short label for an address: `repo #12` for an issue or pull request, `HN 123` for Hacker News, else the domain. */
  function mdShort(u) {
    const s = u.replace(/^https?:\/\//, ''); let m;
    if ((m = /^github\.com\/[^/]+\/([^/]+)\/(?:issues|pull)\/(\d+)/.exec(s))) return `${m[1]} #${m[2]}`;
    if ((m = /^news\.ycombinator\.com\/item\?id=(\d+)/.exec(s))) return `HN ${m[1]}`;
    if ((m = /^github\.com\/([^/]+\/[^/]+?)(?:\/releases)?\/?$/.exec(s))) return m[1];
    return s.split('/')[0].replace(/^www\./, '');
  }
  /** One line of authored text as HTML. links: false inside a button, where a link cannot be pressed. */
  function mdInline(t, { links = true, local } = {}) {
    const re = new RegExp(MD_RE.source, 'gi'), ref = (url, inner, short) => {
      const attrs = short ? ` data-short="${mdEsc(short)}"` : '';
      return links ? `<a class="gd-ref"${attrs} href="${mdEsc(url)}" target="_blank" rel="noopener noreferrer" title="${mdEsc(url)}">${inner}</a>` : `<span class="gd-ref"${attrs}>${inner}</span>`;
    };
    let out = '', i = 0, m;
    while ((m = re.exec(t))) {
      const s = m[0];
      out += mdEsc(t.slice(i, m.index)); i = m.index + s.length;
      if (m[1]) out += `${mdMark('`')}<code>${mdEsc(s.slice(1, -1))}</code>${mdMark('`')}`;
      else if (m[2]) out += `${mdMark('**')}<strong>${mdEsc(s.slice(2, -2))}</strong>${mdMark('**')}`;
      else if (m[3]) out += `${mdMark('*')}<em>${mdEsc(s.slice(1, -1))}</em>${mdMark('*')}`;
      else if (m[4]) { const [, label, url] = /^\[([^\]]+)\]\((.+)\)$/.exec(s), target = /^https?:/i.test(url) ? url : local?.(url); out += target ? ref(target, `${mdMark('[')}${mdEsc(label)}${mdMark(`](${url})`)}`) : mdEsc(s); }
      else out += ref(/^https?:/i.test(s) ? s : `https://${s}`, mdMark(s), mdShort(s));
    }
    return out + mdEsc(t.slice(i));
  }
  /** A detail as HTML blocks: a paragraph per line, bullet and numbered lists, fenced code. The newlines stay in the text. */
  function mdBlock(t, opts) {
    const ls = t.split('\n'), out = []; let k = 0;
    const item = /^(\s*)([-*]|\d+\.)(\s+)(.*)$/;
    while (k < ls.length) {
      const l = ls[k];
      if (/^\s*```/.test(l)) {
        const code = []; k++;
        while (k < ls.length && !/^\s*```/.test(ls[k])) code.push(ls[k++]);
        const close = k < ls.length ? ls[k] : null; k++;
        out.push(`<pre class="gd-code">${mdMark(`${l}\n`)}${code.length ? `<code>${mdEsc(code.join('\n'))}</code>` : ''}${close === null ? '' : mdMark(`${code.length ? '\n' : ''}${close}`)}</pre>`);
      } else if (item.test(l)) {
        const first = item.exec(l), tag = /\d/.test(first[2]) ? 'ol' : 'ul', lis = [];
        while (k < ls.length && item.test(ls[k]) && /\d/.test(item.exec(ls[k])[2]) === (tag === 'ol')) { const [, lead, bullet, gap, rest] = item.exec(ls[k++]); lis.push(`<li>${mdMark(lead + bullet + gap)}${mdInline(rest, opts)}</li>`); }
        out.push(`<${tag}${tag === 'ol' && parseInt(first[2]) !== 1 ? ` start="${parseInt(first[2])}"` : ''}>${lis.join('\n')}</${tag}>`);
      } else { out.push(l.trim() ? `<p>${mdInline(l, opts)}</p>` : mdEsc(l)); k++; }
    }
    return out.join('\n');
  }
  const NOLINK = { links: false };
  const mdSpan = (tag, cls, t, opts) => { const n = E(tag, cls); n.innerHTML = mdInline(t, opts); return n; };
  const mdDiv = (t, opts) => { const n = E('div', 'gd-md'); n.innerHTML = mdBlock(t, opts); return n; };
  // END markdown

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
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
  const reader = document.getElementById('reader');
  /** An update's change, opened in a new tab from the bar over the update. */
  function changeLink(d) {
    const change = changeHref(d);
    if (!change) return '';
    const out = el('a', { class: 'change-link', href: change, target: '_blank', rel: 'noopener', 'aria-label': `Open the change for ${d.title}` }), s = el('span', { 'aria-hidden': 'true' });
    s.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>';
    out.append(s);
    return out;
  }
  function readPage(d, from = 'reports') {
    // A card opens whole or not at all: a row from a page of the board carries what a list shows, and a card that is still coming is no card to read.
    if (d?.row && !d.whole) { if (reader.dataset.key !== d.key) readPage(undefined, from); return; }
    // A design or a report takes the board's place beside the sidebar on a desk; a plan, and anything on a phone, opens over the whole board.
    const pane = !!d && d.type !== 'plan' && !d.guided, inline = pane && matchMedia('(min-width: 64rem)').matches;
    document.body.classList.toggle('reading', !!d);
    document.body.classList.toggle('pane-reading', pane);
    reader.setAttribute('role', inline ? 'region' : 'dialog');
    if (inline) reader.removeAttribute('aria-modal'); else reader.setAttribute('aria-modal', 'true');
    document.querySelector('main').inert = !!d;
    document.getElementById('nav').inert = !!d && !inline;
    document.getElementById('tabs').inert = !!d;
    const swapped = !reader.hidden && !!d && !!reader.dataset.key && reader.dataset.key !== d.key;
    reader.hidden = !d;
    // A report opened from Reports (and not beside a desk's list) reads as a sheet over the list. A guided one tapped in the list shows its parts there until
    // Read the report opens it in full; reached by a link (Today's card, the CLI's open) it opens in full at once.
    // A card still coming is no card to read yet: the reader waits for it, and remembers how it was opened (a report tapped in the list, a guided one in full).
    if (d && rpGuide !== d.key) rpGuide = '';
    if (d && rpListed !== d.key) rpListed = '';
    const sheet = !!d && from === 'reports' && !inline, summary = sheet && d.guided && rpListed === d.key && rpGuide !== d.key;
    reader.classList.toggle('rp-sheet', sheet && (summary || !d.guided));
    const url = summary ? `sheet:${d.key}:${unread(d)}:${kindParts(d).filter(([p]) => partRead(d, p)).length}` : d?.guided ? `guide:${d.key}` : d?.kind === 'design' ? `design:${d.key}` : d?.type === 'evidence' ? `evidence:${d.key}` : d ? src(mockUrl(d.key, '', d.view)) : '';
    const answer = d?.guided ? '' : d?.type === 'plan' || d?.kind === 'design' || d?.type === 'evidence' ? JSON.stringify(state.answers[d.key] ?? null) : '';
    const plan = d?.type === 'plan' || d?.guided ? JSON.stringify(d) : '';
    const evidence = d?.type === 'evidence' ? JSON.stringify([d, (state.messages ?? []).filter((m) => m.key === d.key), (state.rounds ?? []).filter((r) => r.key === d.key)]) : '', ticket = JSON.stringify([ticketOf(d) ?? null, d ? threadOf(d) : null]);
    if (reader.dataset.url === url && reader.dataset.answer === answer && reader.dataset.plan === plan && reader.dataset.evidence === evidence && reader.dataset.ticket === ticket) return d && (reader._guide?.sync(), 1) && (reader.querySelector('h1').textContent = d.type === 'evidence' ? headline(d) : sheet ? plain(d.title) : d.title);
    Object.assign(reader.dataset, { answer, plan, evidence, ticket });
    Object.assign(reader.dataset, { url, key: d?.key ?? '', from });
    if (!d) return reader.replaceChildren();
    if (from === 'reports' && unread(d) && !state.readonly && !FROZEN) setTimeout(() => markRead([d.key], true));
    const back = el('a', { class: 'close', href: `#${from}` }, `‹ ${from.startsWith('reports') ? 'Reports' : AREAS[from]}`), h1 = el('h1', { id: 'reader-title', tabindex: '-1', dir: 'auto' }, sheet ? plain(d.title) : d.title);
    back.onclick = (e) => { if (`#${from}` === location.hash) e.preventDefault(), shutFull(); };
    // A report's page reads under its own head: what it is and when, its title, what it says and decided; a plan or a design keeps its title in the bar;
    // an update is a sheet of its own, with its own head and close.
    reader._guide = undefined;
    reader.replaceChildren(...(summary ? reportSheet(d, h1) : d.guided ? (reader._guide = guideView(d), [el('header', {}, back, ...(reader._guide.tools ?? [])), reader._guide]) : d.type === 'plan' ? [el('header', {}, back, Object.assign(h1, { className: 'plan-name' })), planReview(d, url)] : d.kind === 'design' ? [el('header', {}, back), designReview(d, h1)]
      : d.type === 'evidence' ? [evidenceItem(d)]
      : sheet ? reportSheet(d, h1, el('iframe', { src: url, title: `Report: ${d.title}`, sandbox: 'allow-scripts' }))
      : [el('header', {}, back), el('div', { class: 'read' }, el('p', { class: 'eyebrow' }, kindChip(d, true), el('span', {}, [d.asked_by, d.filed ? when(d.filed) : ''].filter(Boolean).join(' · '))), h1, purposeLine(d),
        d.about ? el('p', { class: 'about', dir: 'auto' }, d.about) : '', decided(d), ticketRow(d), thread(d), el('iframe', { src: url, title: `Report: ${d.title}`, sandbox: 'allow-scripts' }), dismissReport(d))]));
    if (swapped) swapIn([...reader.children].filter((n) => !n.matches('.rp-scrim')));
  }
  /** A guided report opened in full from its sheet (its key), else ''; and the report last tapped in the list, whose sheet stays until another opens. */
  let rpGuide = '', rpListed = '';
  addEventListener('click', (e) => { const row = e.target.closest?.('.rp-list a[data-row]'); if (row) rpListed = row.getAttribute('href').slice('#reports/'.length); }, true);
  /** A report as the prototype's sheet draws it: a handle; its project, what it is and the day, with Close; its title in full and what it says; what it found (or decided);
   *  for a guided report its parts, each with a check once read, and Read the report, which opens it in full at that part; its ticket and Activity; then its page. */
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
  function reportParts(d, full) {
    const ps = kindParts(d), n = ps.filter(([p]) => partRead(d, p)).length;
    const parts = ps.map(([p, name]) => { const b = el('button', { class: 'ui-pr rp-part', 'aria-label': `${name}, ${partRead(d, p) ? 'read' : 'not read yet'}` }, el('span', { class: 'k', dir: 'auto' }, name),
      el('span', { class: `rp-check${partRead(d, p) ? ' on' : ''}`, 'aria-hidden': 'true' }, partRead(d, p) ? glyph('check') : '')); b.onclick = () => full(p); return b; });
    const open = d.guided ? el('button', { class: 'rp-open-full rp-open', 'data-kbd': '↵', 'aria-keyshortcuts': 'Enter' }, 'Read the report') : '';
    if (open) open.onclick = () => full();
    return ps.length ? [el('p', { class: 'ui-dl' }, `Read ${n} of ${plural(ps.length, 'part')}`), stripRow(d), el('div', { class: 'ui-props rp-parts' }, ...parts), open] : [];
  }
  /** A research report's Sources: how many sources it links and how many are what users report, each opening the report at its sources part. */
  function sourcesPanel(d, open) {
    const c = sourcesOf(d);
    if (!c) return [];
    const row = (name, n, glyphName) => { const b = el('button', { class: 'ui-pr rp-src' }, el('span', { class: 'k' }, glyph(glyphName), name), el('span', { class: 'v' }, el('span', { class: 'n' }, String(n)), glyph('right'))); b.onclick = () => open(c.id); return b; };
    return [el('p', { class: 'ui-dl' }, 'Sources'), el('div', { class: 'ui-props rp-sources' }, row('Linked sources', c.n, 'link'), row('What users report', c.users, 'users'))];
  }
  /** Discard moved from the list row to the report's own page; once a reason is picked the page closes back to the list. */
  function dismissReport(d) {
    return xBtn(d, 'Discard', () => { location.hash = '#reports'; });
  }
  // A guided report opened in full from a desk's Reports keeps the report's address, so closing it redraws the list beside it.
  let rpFull = '';
  function shutFull() {
    rpFull = '';
    render();
    document.querySelector('.split-list [data-row][aria-current]')?.focus({ preventScroll: true });
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !reader.hidden) `#${reader.dataset.from}` === location.hash ? shutFull() : (location.hash = `#${reader.dataset.from}`); });
  addEventListener('resize', () => { if (!reader.hidden) readPage(state.decisions.find((d) => d.key === reader.dataset.key), reader.dataset.from); });

  /** Newest or By project, this browser's choice; Newest shows six on a phone until See all. */
  let rpBy = (() => { try { return localStorage.getItem('sign-off-reports-by') === 'project' ? 'project' : 'new'; } catch { return 'new'; } })(), rpAll = false;
  /** The kind Reports lists, '' for every kind; kept while the board is open, as Evidence keeps its project. */
  let rpKind = '';
  /** Reports listed under the kind picked (all of them with none). */
  const ofKind = (items) => (rpKind ? items.filter((d) => kindOf(d) === rpKind) : items);
  /** The title's filter button, beside the light-or-dark one, while more than one kind is listed (or one is picked): a sheet of Every kind and each kind listed,
   *  its tile, full name, what it is for and how many; a kind picked shows a 1 on the button and its pill in the hero's place. */
  function kindFilter(items) {
    const counts = new Map();
    for (const d of items) counts.set(kindOf(d), (counts.get(kindOf(d)) ?? 0) + 1);
    if (counts.size < 2 && !rpKind) return '';
    const b = el('button', { class: 'ui-rb ev-fb rp-fb', 'aria-haspopup': 'dialog', 'aria-label': rpKind ? `Filter by kind, ${KINDS[rpKind][1]} shown` : 'Filter by kind' }, evGlyph('filter'), rpKind ? el('b', { 'aria-hidden': 'true' }, '1') : '');
    b.onclick = () => openSheet('Filter by kind', el('div', { class: 'ui-props ev-pick rp-pick' }, ...['', ...Object.keys(KINDS).filter((k) => counts.has(k))].map((k) => {
      const on = k === rpKind, x = el('button', { class: 'ui-pr', 'aria-pressed': String(on), 'data-kind': k || 'all' },
        el('span', { class: 'k' }, kindTile(k), el('span', { class: 'kn' }, k ? KINDS[k][1] : 'Every kind', k ? el('small', {}, KINDS[k][2]) : '')),
        el('span', { class: 'v' }, el('span', { class: 'n' }, String(k ? counts.get(k) : items.length)), on ? evGlyph('check') : el('i')));
      x.onclick = () => { rpKind = k; rpAll = false; sheet.close(); render(); document.querySelector('.rp-fb')?.focus({ preventScroll: true }); };
      return x;
    })));
    return b;
  }
  /** Reports' head under the title: Newest or By project, then how many are still to read of all listed, and how many were filed this week (the archived ones too);
   *  with a kind picked, its pill in the hero's place: its tile, its name, how many of all, and a close that shows every kind again. */
  function reportsHead(items, all = items) {
    const seg = el('div', { class: 'ui-seg rp-seg', role: 'group', 'aria-label': 'Order' }, ...[['new', 'Newest'], ['project', 'By project']].map(([v, name]) => {
      const b = el('button', { 'aria-pressed': String(rpBy === v) }, name);
      b.onclick = () => { rpBy = v; try { localStorage.setItem('sign-off-reports-by', v); } catch {} buzz('tick'); render(); };
      return b;
    }));
    if (rpKind) {
      const x = el('button', { class: 'ev-unpick', 'aria-label': 'Show every kind' }, glyph('x'));
      x.onclick = () => { rpKind = ''; render(); document.querySelector('.rp-fb')?.focus({ preventScroll: true }); };
      return [seg, el('div', { class: 'ui-card ev-pill rp-pill' }, kindTile(rpKind), el('span', { dir: 'auto' }, KINDS[rpKind][1], el('small', {}, `${items.length} of ${all.length}`)), x)];
    }
    const week = state.decisions.filter((d) => area(d) === 'reports' && d.filed && Date.now() - Date.parse(d.filed) < 7 * 864e5).length;
    return [seg, el('section', { class: 'ui-card ui-hero rp-hero' }, el('div', { class: 'hl' }, el('span', { class: 'lab' }, 'Still to read')),
      el('div', { class: 'hv' }, el('span', { class: 'big' }, String(items.filter(unread).length), el('small', {}, ` of ${items.length}`)), el('span', { class: 'vs' }, `${week} filed this week`)))];
  }
  /** Reports newest first under Newest, or in one list per project (the most reports first, No project last), each under a head with its count; the rows rise in when the tab opens. */
  function reportGroups(items) {
    const newest = [...items].sort((a, b) => (Date.parse(b.filed) || 0) - (Date.parse(a.filed) || 0));
    let i = 0;
    const head = (name, n, right = '') => el('h2', { class: 'dl-head ui-sec', style: `--n:${i++}` }, name, n === undefined ? '' : el('span', { class: 'n' }, String(n)), right);
    const list = (name, ds) => el('ul', { class: 'dl-list rp-list ui-card ui-list', 'aria-label': name }, ...ds.map((d) => report(d, i++)));
    if (rpBy === 'project') {
      const groups = Map.groupBy(newest, (d) => d.group || 'No project');
      return [...groups].sort((a, b) => (a[0] === 'No project') - (b[0] === 'No project') || b[1].length - a[1].length).flatMap(([name, ds]) => [head(name, ds.length), list(name, ds)]);
    }
    // On a desk the list scrolls beside the report shown, so every row stays for J and K.
    const cut = rpSel === null && newest.length > 6, see = cut ? el('button', { class: 'see' }, rpAll ? 'Show fewer' : 'See all') : '';
    if (see) see.onclick = () => { rpAll = !rpAll; render(); };
    return [head('Newest', undefined, see), list('Newest', cut && !rpAll ? newest.slice(0, 6) : newest)];
  }

  /* ---- Designs in the new look. A phone lists them as Reports does: the title row, To review, then the designs as rows in one card, each opening its review over the board.
     A desk fills the window as the approved prototype's desk draws it: the designs as picture cards across the top, the open one large beside where it stands. ---- */
  const designStatus = (d) => { const a = state.answers[d.key]?.answer; return a === 'approve' ? 'Approved' : a === 'change' ? 'Changes requested' : d.status === 'draft' ? 'Draft' : 'In review'; };
  const dzSheet = sheetOf('dz-sheet');
  /** The title row: the title with More (Select, Discard all and, on a desk, Archived) and the round light-or-dark button; on a desk where it is over a 32px title and what is on the board.
   *  While selecting, the title counts the picks with Select all, and Cancel and Discard N sit where the dock is (phone) or at the row's right (desk). */
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
  function designGroups(items, top, key, gone = []) {
    const head = designsHead(items, top, gone);
    if (!items.length) return phone() ? [...head, el('p', { class: 'empty' }, EMPTY.designs), archived(gone)] : head;
    if (!phone()) {
      const cur = items.find((d) => d.key === key) ?? items[0], [open, info] = designReview(cur, el('h2', { class: 'dz-t', dir: 'auto' }, cur.title), true);
      const card = (d) => el('a', { class: 'dz-card', id: `item-${d.key}`, href: `#designs/${d.key}`, 'aria-label': `Open design, ${d.title}`, ...(d === cur && { 'aria-current': 'true' }) },
        el('span', { class: 'dz-shot' }, pic(d) ? el('img', { src: src(pic(d)), alt: '', loading: 'lazy' }) : ''), el('span', { class: 'dz-ct', dir: 'auto' }, d.title),
        el('span', { class: 'dz-cm' }, [d.group, d.filed && day(d.filed)].filter(Boolean).join(' · ')), el('span', { class: 'dz-tag' }, designStatus(d)), selMark(d.key));
      // Where it stands fades out at its foot while it holds more than it shows.
      const ib = info.querySelector('.dz-ib'), fade = () => ib.classList.toggle('fades', ib.scrollHeight - ib.scrollTop - ib.clientHeight > 1);
      ib.onscroll = fade; new ResizeObserver(fade).observe(ib);
      return [el('div', { class: 'ui-desk' }, top, ...head, el('div', { class: 'ui-dgrid dz-grid design-review' }, el('div', { class: 'dz-strip' }, ...items.map(card)), open, info))];
    }
    const toReview = items.filter((d) => ['In review', 'Draft'].includes(designStatus(d))).length, approved = items.filter((d) => designStatus(d) === 'Approved').length;
    return [...head, el('section', { class: 'ui-card ui-hero dz-hero', 'aria-label': 'To review' }, el('div', { class: 'hl' }, el('span', { class: 'lab' }, 'To review')),
      el('div', { class: 'hv' }, el('span', { class: 'big' }, String(toReview), el('small', {}, ` of ${items.length}`)), approved ? el('span', { class: 'vs' }, `${approved} approved`) : '')),
      el('h2', { class: 'ui-sec' }, 'Newest', el('span', { class: 'n' }, String(items.length))),
      el('ul', { class: 'ui-card ui-list dz-list' }, ...items.map(designRow)), archived(gone)];
  }
  /** A design as a row: its tile (a thumbnail of its first screen), the title, its state and day (or its ticket's bar); it opens the design's review. */
  function designRow(d) {
    const t = ticketOf(d);
    return el('li', { id: `item-${d.key}` }, el('a', { class: 'ui-row', href: `#designs/${d.key}`, 'aria-label': `Open design, ${d.title}${t?.progress > 0 ? `, ticket ${t.title}, ${t.progress}% done` : ''}` },
      ...uiRow({ tile: cardTile(d), title: d.title, priority: d.priority, badge: trailBadge(d.key), meta: [designStatus(d), d.filed && day(d.filed)].filter(Boolean).join(' · '), progress: progressOf(t?.progress) }), selMark(d.key)));
  }

  /** Archived: what was discarded or dismissed from a screen, and the evidence and reports archived a day after they were filed. One quiet line at the list's end opens them
   *  as rows in a sheet, each with why it went (the reason and when) and how far its agent got (the trail's badge), and Restore. Nothing is deleted. */
  const arSheet = sheetOf('ar-sheet');
  let arItems = [];
  function fillArchived() {
    const live = arItems.filter((d) => (state.dismissed ?? []).includes(d.key));
    if (!live.length) return arSheet.close();
    arSheet.replaceChildren(el('div', {}, sheetHead('ar-sheet', 'Archived'), el('ul', { class: 'ui-list ar-list' }, ...live.map((d) => {
      const x = state.discarded?.[d.key], b = el('button', { class: 'ar-back', type: 'button', 'aria-label': `Restore, ${title(d)}` }, 'Restore');
      b.onclick = () => setDismissed([d.key], false).then(fillArchived, (e) => say(`Couldn't restore: ${e.message}`, 8000));
      return el('li', { id: `ar-${d.key}` }, el('div', { class: 'ui-row' }, ...uiRow({ tile: cardTile(d), title: title(d), badge: x ? trailBadge(d.key) : '', meta: x ? reasonOf(x.reason) : d.filed ? `Filed ${trailWhen(d.filed)}` : '' }), b));
    }))));
  }
  const openArchived = (items) => { arItems = items; fillArchived(); arSheet.showModal(); arSheet.querySelector('h2').focus(); };
  function archived(items) {
    if (!canDismiss() || !items.length) return '';
    // A redraw while the sheet is open (a poll that brings the agent's read) redraws its rows too.
    arItems = items;
    if (arSheet.open) fillArchived();
    const line = el('button', { class: 't-more-line ar-line', type: 'button', 'aria-haspopup': 'dialog' }, el('span', {}, `Archived · ${items.length}`), glyph('right'));
    line.onclick = () => openArchived(items);
    return line;
  }
  /** Each kind of ask has its own mark: a key, a plan, a phone for screens or mocks to look over, a question for yes or no, a bubble for a reply, a checklist for any other pick. */
  const askIcon = (d) => (d.type === 'signin' ? 'key' : d.type === 'plan' ? 'plan' : reviewed(d) ? 'phone' : { 'yes-no': 'yesno', reply: 'reply' }[typeOf(d)] ?? 'pick');
  /** An update that waits on you says how its linked run went, in plain words. */
  const dateLine = (t = new Date()) => `${t.toLocaleDateString('en-GB', { weekday: 'long' })} ${t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
  const badge = (d) => { const r = RESULT[d.evidenceCard?.result]; return r ? el('span', { class: `st ${r[0]}` }, r[1]) : ''; };

  /* Decide, as the approved new look draws it: Newest or By priority, how many wait on you and how many were answered today, then every open ask in one card of rows,
     with Later and Answered under it. A row opens its ask, over the list on a phone and beside it on a desk.
     A swipe right answers with the recommended pick, a swipe left moves the ask to Later; past a third of the row it commits, and a fast fling commits sooner. */
  // Later is this browser's own shelf, kept per board file: the agent still waits, and an answered or gone ask simply drops off it.
  let shelf;
  const shelved = () => {
    if (!shelf) try { shelf = new Set(JSON.parse(localStorage.getItem(`sign-off-later ${state.file}`)) ?? []); } catch { shelf = new Set(); }
    return shelf;
  };
  const shelve = (keys, on) => {
    keys.forEach((k) => (on ? shelved().add(k) : shelved().delete(k)));
    try { localStorage.setItem(`sign-off-later ${state.file}`, JSON.stringify([...shelf])); } catch {}
  };
  // A plan or a design is looked over before it is answered, so it is reviewed, never answered from its row.
  const reviewed = (d) => d.type === 'plan' || d.kind === 'design' || typeOf(d) === 'design';
  const groupOf = (d) => (shelved().has(d.key) ? 'later' : d.type === 'signin' ? 'signin' : reviewed(d) ? 'review' : 'answer');
  /** Which card of rows an ask sits in: the asks, or Later under them. */
  const sideOf = (d) => (groupOf(d) === 'later' ? 'later' : 'now');
  /** A card's priority, P0 to P3, when it has one the board knows. */
  const priOf = (d) => (/^P[0-3]$/.test(d.priority ?? '') ? d.priority : undefined);
  /** Decide's order, kept in this browser: Newest (the board's order, a sign-in first) or By priority (P0 first, newest first within one, a card with none last); Later always at the foot. */
  let dsort = (() => { try { return localStorage.getItem('sign-off-decide-sort') === 'priority' ? 'priority' : 'new'; } catch { return 'new'; } })();
  const decideOrder = (items) => {
    const s = dsort === 'priority' ? [...items].sort((x, y) => (priOf(x) ?? 'P9').localeCompare(priOf(y) ?? 'P9')) : items;
    return [...s.filter((d) => sideOf(d) === 'now'), ...s.filter((d) => sideOf(d) === 'later')];
  };
  /** Whose an ask is, as its row and its sheet name it: its project when it has one, else who asked. */
  const whoOf = (d) => projectName(d) || (d.type === 'signin' ? d.waits : d.by) || 'Agent';
  /** What an ask carries, as one panel under its question (ui.css): its priority, and the ticket it belongs to (Its ask) with its progress, which opens the ticket's page.
   *  An ask with neither shows no panel: a ticket is only a reference, and a card without one shows nothing more. */
  const askProps = (d) => uiProps(priorityProp(priOf(d)), ticketProp(ticketOf(d), 'Its ask'));

  /** An answered ask Decide opens again, to see the answer or change it: one the person picked or wrote, not a sign-in, a review, a verdict or a card answered with another. */
  const redo = (d) => !state.readonly && d.type !== 'signin' && d.type !== 'evidence' && d.type !== 'plan' && d.kind !== 'design' && !state.answers[d.key]?.merged_by && !!(d.options?.length || d.reply);
  /** What an answer says in a row: the pick (or the person's own words), and the note that went with it. */
  const saidOf = (d, s) => [s.answer === 'text' ? (d.reply ? 'Your reply' : 'Your own answer') : s.label, s.note && `“${s.note}”`].filter(Boolean).join(' · ');
  const recOf = (d) => (d.type === 'signin' || reviewed(d) ? undefined : d.options?.find((o) => o.value === d.recommend_value));
  const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // Rows on their way out (answered, or moved to Later) stay drawn where they were while they tint and fold away; a row taken back flashes.
  const leaving = new Map();
  let flash = '', risen = false;
  /** On a desk, the key of the ask shown beside the list ('' for none); null on a phone, where the list is a page of its own. */
  let deskSel = null;
  const returned = (key) => { flash = key; setTimeout(() => flash === key && (flash = ''), 700); };
  function depart(keys, how, side) {
    const t = performance.now(), order = decideCtx.all;
    for (const k of keys) {
      const d = state.decisions.find((x) => x.key === k), g = sideOf(d), at = order.findIndex((x) => x.key === k);
      leaving.set(k, { d, how, side, t, group: g, before: order.slice(at + 1).find((x) => sideOf(x) === g && !keys.includes(x.key))?.key });
    }
    // Once folded, the rows leave the page for good (and a group left empty loses its head).
    setTimeout(() => { keys.forEach((k) => leaving.get(k)?.t === t && leaving.delete(k)); if (document.querySelector('.dl-row.leaving')) render(); }, 500);
  }
  /** When an ask was filed, as Decide says it: today's time, Yesterday, or the date. */
  const filedAt = (at) => (isToday(at) ? hhmm(at) : isToday(Date.parse(at) + 864e5) ? 'Yesterday' : day(at));
  /** A row (ui.css): the ask's icon tile, its question with its priority chip, then its ticket's progress once the ticket has any (a full bar when it is done), else whose it is and when it was filed (a sign-in counts its link down);
   *  the swipe actions sit under it, and on a desk a hover shows the same two as round buttons. */
  function decideRow(d, i, gone) {
    const g = gone?.group ?? sideOf(d), rec = recOf(d), t = ticketOf(d);
    const meta = d.type === 'signin' ? el('span', {}, `${whoOf(d)} · `, signinRow(d)) : `${whoOf(d)}${d.filed ? ` · ${filedAt(d.filed)}` : ''}`;
    const sel = deskSel === d.key && !gone, opens = askHref(d).startsWith('#decide/');
    const face = el('a', { class: 'dl-face ui-row', href: askHref(d), draggable: 'false', ...(!(gone && gone.how === 'later') && { id: `item-${d.key}` }), ...(opens && { 'data-row': '' }), ...(sel && { 'aria-current': 'true' }) },
      ...uiRow({ tile: cardTile(d), title: d.type === 'signin' ? `Sign in to ${d.title}` : title(d), priority: priOf(d), badge: trailBadge(d.key), ...(t?.progress > 0 ? { progress: t.progress } : { meta }) }), selMark(d.key));
    const act = (cls, mark, words) => el('div', { class: `dl-act ${cls}`, 'aria-hidden': 'true' }, glyph(mark), el('span', {}, words));
    const quick = (cls, mark, words, tip, fn) => { const b = el('button', { class: cls, 'aria-label': `${words}, ${d.title}`, title: tip }, glyph(mark)); b.onclick = fn; return b; };
    const hover = deskSel === null || gone || state.readonly ? '' : el('span', { class: 'dl-hover' }, rec ? quick('yes', 'check', rec.label, `Answer ${rec.label}`, () => quickAnswer(d.key)) : '',
      quick('later-q', 'clock', g === 'later' ? 'Now' : 'Later', g === 'later' ? 'Back from Later' : 'Later (L)', () => toLater([d.key], g !== 'later')));
    return el('li', { class: `dl-row${gone ? ` leaving ${gone.how}` : ''}${flash === d.key ? ' returned' : ''}${sel ? ' sel' : ''}`, 'data-key': d.key, 'data-group': groupOf(d), style: `--n:${i}`, ...(gone?.side && { 'data-side': gone.side }) },
      rec ? act('yes', 'check', rec.label) : '', act('later', 'clock', g === 'later' ? 'Now' : 'Later'), face, hover);
  }
  /** All clear in the ask's pane on a desk: agents will ask when they need you. */
  const allClear = (pane) => el('div', { class: `all-clear-big${pane ? ' pane' : ''}` }, el('span', { class: 'big' }, glyph('check')), el('h2', {}, 'All clear'),
    el('p', {}, `Nothing is waiting on you${state.name ? `, ${state.name}` : ''}.${pane ? ' Agents will ask when they need you.' : ''}`));
  /** An answered row: a check, the question, then the answer with its note and when it was given; it opens the ask, to see the answer or change it. */
  function doneRow(d, i) {
    const s = state.answers[d.key], sel = deskSel === d.key;
    return el('li', { class: `dl-row g-done${sel ? ' sel' : ''}`, 'data-key': d.key, style: `--n:${i}` }, el('a', { class: 'dl-face ui-row', href: `#decide/${d.key}`, draggable: 'false', 'data-row': '', ...(sel && { 'aria-current': 'true' }) },
      ...uiRow({ tile: uiIcon({ draw: 'done' }), title: title(d), badge: trailBadge(d.key), meta: `${s.replaces ? 'Changed to ' : takenOf(s) === 'default' ? 'Taken by default: ' : takenOf(s) ? 'Agent picked: ' : ''}${saidOf(d, s)} · ${filedAt(s.at)}` })));
  }
  /** An answer taken without the person, not yet opened: the question, then how it was taken (Taken by default at 16:00, or Agent picked B: Friday, tell me if wrong),
   *  and one Change at its end that opens the ask with its answers back to pick from. */
  function tookRow(d, i) {
    const s = state.answers[d.key], sel = deskSel === d.key;
    const chg = el('a', { class: 'dl-chg', href: `#decide/${d.key}`, 'aria-label': `Change, ${d.title}` }, 'Change');
    chg.onclick = () => { changing.add(d.key); selected.delete(d.key); own.delete(d.key); jump = d.key; };
    return el('li', { class: `dl-row g-took${sel ? ' sel' : ''}`, 'data-key': d.key, style: `--n:${i}` }, el('a', { class: 'dl-face ui-row', href: `#decide/${d.key}`, draggable: 'false', 'data-row': '', ...(sel && { 'aria-current': 'true' }) },
      ...uiRow({ tile: cardTile(d), title: title(d), meta: takenOf(s) === 'default' ? `Taken by default at ${filedAt(s.at)}` : `Agent picked ${s.label}` })), chg);
  }
  /** On a phone Decide holds two lists, as Tickets holds Your asks and System: Asks (what waits on you) and Designs (the reviews still open), each with its count.
   *  A desk keeps Designs in the sidebar. */
  let decideCounts = { asks: 0, designs: 0 };
  const dzOpen = (d) => ['In review', 'Draft'].includes(designStatus(d));
  function decideSeg(on) {
    const b = (v, href, name, n) => { const x = el('button', { type: 'button', 'aria-pressed': String(on === v) }, name, el('small', {}, String(n))); x.onclick = () => { if (on !== v) buzz('tick'), location.hash = href; }; return x; };
    return el('div', { class: 'ui-seg dl-seg', role: 'group', 'aria-label': 'Decide' }, b('asks', '#waiting', 'Asks', decideCounts.asks), b('designs', '#designs', 'Designs', decideCounts.designs));
  }
  /** On a phone Decide's order (Newest or By priority) is a round button in its head, marked while By priority is on, opening a sheet of the two. */
  const dlSortSheet = sheetOf('dl-sort');
  function decideSortButton() {
    const b = el('button', { class: `ui-rb dl-rb${dsort === 'priority' ? ' on' : ''}`, 'aria-label': `Order: ${dsort === 'priority' ? 'By priority' : 'Newest'}`, 'aria-haspopup': 'dialog' });
    b.innerHTML = '<svg class="glyph" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 6h13M6 10h8M8.5 14h3"/></svg>';
    b.onclick = () => {
      const pick = (v, name) => { const x = el('button', { class: 'ui-pr dl-pick', ...(dsort === v && { 'aria-current': 'true' }) }, el('span', { class: 'k' }, name), el('span', { class: 'v' }, dsort === v ? glyph('check') : ''));
        x.onclick = () => { dsort = v; try { localStorage.setItem('sign-off-decide-sort', v); } catch {} dlSortSheet.close(); render(); }; return x; };
      dlSortSheet.replaceChildren(el('div', {}, sheetHead('dl-sort', 'Order'), el('div', { class: 'ui-props' }, pick('new', 'Newest'), pick('priority', 'By priority'))));
      dlSortSheet.showModal();
      dlSortSheet.querySelector('h2').focus();
    };
    return b;
  }
  // Phone lists grow only when requested; desk lists keep every row for J/K navigation.
  const decideLimit = { now: 24, later: 24, done: 24 };
  /** The leash as a chip by how many wait on Decide: what agents may do without asking. A tap opens the Leash in a sheet to change it. */
  const leashSheet = sheetOf('l-sheet');
  const fillLeash = () => leashSheet.replaceChildren(el('div', {}, sheetHead('l-sheet', 'Leash'), ...leash()));
  function leashChip() {
    if (!state.leash) return '';
    const b = el('button', { class: 'leash-chip', type: 'button', 'aria-haspopup': 'dialog' }, `Leash: ${LEASH[state.leash][1]}`);
    b.onclick = () => { fillLeash(); leashSheet.showModal(); leashSheet.querySelector('h2').focus(); };
    return b;
  }
  /** Decide's list: Newest or By priority, the hero (how many wait on you, how many you answered today, how many are for later, the leash), the asks in one card,
   *  then Taken without you, Later and Answered. */
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
  function fold() {
    const now = performance.now();
    for (const li of document.querySelectorAll('.dl-row.leaving')) {
      const ago = now - leaving.get(li.dataset.key).t, hold = calm.matches ? 0 : Math.max(0, 200 - ago), run = calm.matches ? 0 : Math.max(0, 220 - Math.max(0, ago - 200));
      li.style.height = `${li.offsetHeight}px`;
      void li.offsetHeight;
      li.style.transition = `height ${run}ms var(--ease) ${hold}ms, opacity ${run}ms linear ${hold}ms`;
      li.style.height = '0px';
      li.style.opacity = '0';
    }
  }
  /** Answers each ask with its recommended pick, one after another so the last reply carries every answer; Undo puts back what each had. */
  async function answerAll(items) {
    const was = items.map((d) => [d, answerOf(d.key)]);
    depart(items.map((d) => d.key), 'answered');
    try {
      for (const d of items) await call('/api/answers', post({ key: d.key, answer: recOf(d).value, note: drafts.get(d.key) ?? noteOf(d) }));
    } catch (e) { leaving.clear(); render(); return say(`Couldn't save: ${e.message}`, 8000); }
    buzz('success');
    say([el('b', {}, `${items.length} answered`), ' with the recommended pick'], 6000, async () => {
      undoBtn.disabled = true;
      try {
        for (const [d, before] of was) await call('/api/answers', post({ key: d.key, answer: before?.answer ?? '', note: before?.note ?? '' }));
        say('Undone: not answered', 3000);
      } catch (e) { say(`Couldn't undo: ${e.message}`, 8000); }
    }, 'ok');
  }
  /** Moves asks to Later, or back from it, with an Undo. */
  function toLater(keys, on, side) {
    if (on) depart(keys, 'later', side);
    shelve(keys, on);
    render();
    fold();
    const one = keys.length === 1 && state.decisions.find((d) => d.key === keys[0]);
    say(!on ? 'Back from Later' : one ? [el('b', {}, headline(one)), ' · moved to later'] : [el('b', {}, `${keys.length} moved`), ' to later'], 5000,
      () => { shelve(keys, !on); keys.forEach(returned); render(); say(on ? 'Back from Later' : 'Moved to Later', 3000, null, on ? 'undo' : 'later'); }, 'later');
  }
  /** One More control: a menu that scales out of its button and closes on a tap anywhere else. */
  function moreSheet(label, items) {
    const menu = el('details', { class: 'dl-more' }, el('summary', { 'aria-label': label }, glyph('more')), el('div', { class: 'dl-menu', role: 'menu' },
      ...items.filter(Boolean).map((item) => {
        if (item instanceof Node) { item.addEventListener('click', () => (menu.open = false)); return item; }
        const [words, fn, act, mark, off] = item, b = el('button', { role: 'menuitem', 'data-act': act, ...(off && { disabled: '' }) }, el('span', {}, words), mark ? glyph(mark) : '');
        b.onclick = () => { menu.open = false; fn(); };
        return b;
      })));
    return menu;
  }
  addEventListener('click', (e) => document.querySelectorAll('.dl-more[open]').forEach((m) => !m.contains(e.target) && (m.open = false)));
  /** Decide's More, under the list as Today's is: one quiet line naming what it holds, which opens a sheet of Answer all recommended and Move all to later,
   *  each with how many it would move and off when it has nothing to do. */
  const decideMore = sheetOf('d-more');
  function decideMoreLine(items) {
    if (FROZEN || selecting) return '';
    const answerable = items.filter((d) => groupOf(d) === 'answer' && recOf(d)), now = items.filter((d) => groupOf(d) !== 'later');
    const act = (name, words, mark, list, fn) => { const b = el('button', { class: 'ui-pr', type: 'button', 'data-act': name, ...(!list.length && { disabled: '' }) },
      el('span', { class: 'k' }, glyph(mark), words), el('span', { class: 'v' }, el('span', { class: 'n' }, String(list.length))));
      b.onclick = () => { decideMore.close(); fn(); }; return b; };
    const line = el('button', { class: 't-more-line', type: 'button', 'aria-haspopup': 'dialog' }, el('span', {}, 'Select, answer all or move all to later'), glyph('right'));
    line.onclick = () => {
      const select = act('select', 'Select', 'check', items, () => { selecting = true; render(); });
      select.querySelector('.v').remove();
      decideMore.replaceChildren(el('div', {}, sheetHead('d-more', 'More'), el('div', { class: 'ui-props' }, select, act('answer-all', 'Answer all recommended', 'sparkle', answerable, () => answerAll(answerable)),
        act('later-all', 'Move all to later', 'clock', now, () => toLater(now.map((d) => d.key), true)))));
      decideMore.showModal(); decideMore.querySelector('h2').focus();
    };
    return line;
  }
  // The swipe follows the finger; the action under the row grows once it would commit, with a tick on Android.
  let sw = null, swiped = false;
  addEventListener('pointerdown', (e) => {
    const face = !selecting && !state.readonly && !FROZEN && e.isPrimary && e.target.closest?.('.dl-row:not(.leaving, .g-done) > .dl-face');
    if (!face) return;
    face.classList.add('down');
    sw = { face, row: face.parentElement, x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, on: false, armed: false, t: e.timeStamp, v: 0, lx: e.clientX };
  });
  addEventListener('pointermove', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (!sw.on) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) { sw.on = true; sw.face.classList.remove('down'); sw.row.classList.add('swiping'); }
      else if (Math.abs(dy) > 10) { sw.face.classList.remove('down'); sw = null; }
      if (!sw?.on) return;
    }
    sw.v = (e.clientX - sw.lx) / Math.max(1, e.timeStamp - sw.t); sw.t = e.timeStamp; sw.lx = e.clientX;
    // A row with nothing to answer resists a right swipe; past 80% of the width every row rubber-bands.
    const w = sw.face.clientWidth, can = dx < 0 || !!sw.row.querySelector('.yes');
    let d = can ? dx : dx * 0.15;
    if (Math.abs(d) > w * 0.8) d = Math.sign(d) * (w * 0.8 + (Math.abs(d) - w * 0.8) * 0.3);
    sw.dx = d;
    sw.face.style.transform = `translateX(${d}px)`;
    sw.row.dataset.side = d > 0 ? 'yes' : 'later';
    const armed = can && Math.abs(d) > w * 0.36;
    if (armed !== sw.armed) { sw.armed = armed; sw.row.classList.toggle('armed', armed); if (armed) buzz('tick'); }
  });
  const endSwipe = (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const s = sw;
    sw = null;
    s.face.classList.remove('down');
    if (!s.on) return;
    swiped = true;
    setTimeout(() => (swiped = false), 80);
    const fling = Math.abs(s.v) > 0.6 && Math.sign(s.v) === Math.sign(s.dx) && Math.abs(s.dx) > 40, can = s.dx < 0 || !!s.row.querySelector('.yes');
    if (e.type === 'pointerup' && can && (s.armed || fling)) return swipeDone(s);
    // Short of the line, the row springs back.
    s.face.style.transition = `transform ${calm.matches ? 0 : 420}ms var(--spring)`;
    s.face.style.transform = '';
    s.row.classList.remove('armed');
    setTimeout(() => { s.face.style.transition = ''; s.row.classList.remove('swiping'); }, calm.matches ? 0 : 420);
  };
  addEventListener('pointerup', endSwipe);
  addEventListener('pointercancel', endSwipe);
  // The tap that ends a drag does not open the row.
  addEventListener('click', (e) => swiped && e.target.closest?.('.dl-face') && e.preventDefault(), true);
  /** Past the line the row flies off its side, then folds away; a right swipe saves the recommended pick, a left one shelves the ask. */
  async function swipeDone(s) {
    const key = s.row.dataset.key, d = state.decisions.find((x) => x.key === key), yes = s.dx > 0;
    if (s.row.dataset.list === 'reports') return reportSwiped(s, d, yes);
    s.face.style.transition = `transform ${calm.matches ? 0 : 200}ms cubic-bezier(0.2, 0.7, 0.2, 1)`;
    s.face.style.transform = `translateX(${yes ? '' : '-'}100%)`;
    await pause(190);
    if (!yes) return toLater([key], groupOf(d) !== 'later', 'later');
    quickAnswer(key, 'yes');
  }
  /** Answers an ask from its row with its recommended pick: the row tints and folds away (a swiped one has flown off its side), with an Undo. */
  function quickAnswer(key, side) {
    const d = state.decisions.find((x) => x.key === key), before = answerOf(key);
    depart([key], 'answered', side);
    render();
    fold();
    call('/api/answers', post({ key, answer: recOf(d).value, note: drafts.get(key) ?? noteOf(d) }), () => forget(key))
      .then(() => offerUndo(d, before), (e) => { leaving.delete(key); render(); say(`Couldn't save: ${e.message}`, 8000); });
  }
  /** A report row swiped right springs home and toggles its dot; swiped left it flies off, folds away and is archived. */
  async function reportSwiped(s, d, yes) {
    s.face.style.transition = `transform ${calm.matches ? 0 : yes ? 420 : 200}ms ${yes ? 'var(--spring)' : 'cubic-bezier(0.2, 0.7, 0.2, 1)'}`;
    s.face.style.transform = yes ? '' : 'translateX(-100%)';
    if (yes) { await pause(300); return readToggle(d); }
    await pause(190);
    s.row.style.height = `${s.row.offsetHeight}px`;
    void s.row.offsetHeight;
    s.row.style.transition = `height ${calm.matches ? 0 : 220}ms var(--ease), opacity ${calm.matches ? 0 : 220}ms linear`;
    s.row.style.height = '0px';
    s.row.style.opacity = '0';
    await pause(220);
    archive(d);
  }
  const selected = new Map();
  let decideCtx = { all: [], shown: [], hidden: [] };
  // A phone opens an ask as a sheet over the list, and answering it closes back to the list. A desk steps on to the next ask.
  const phone = () => matchMedia('(max-width: 63.999rem)').matches;
  /** Where E (and a swipe left) goes from the ask on screen: the next ask, round to the first after the last. */
  let skipTo = '';
  /** Asks the person chose to answer in their own words, kept across redraws. */
  const own = new Set();
  /** The answered ask whose cards are back for a change. */
  const changing = new Set();
  /** The ask whose sheet is up on a phone ('' for none), so a redraw keeps it in place and only a newly opened one rises. */
  let sheetUp = '';
  addEventListener('keydown', (e) => e.key === 'Escape' && !e.defaultPrevented && document.querySelector('.ask-sheet') && !document.querySelector('dialog[open], .dl-more[open]') && (location.hash = '#waiting'));
  /** An ask on a phone, as the prototype's sheet draws it over Decide's list: a grab handle, its tile with whose it is and when, More and Close, then the ask.
   *  A tap on the dimmed list, Close or Escape goes back to the list. */
  function askSheet(d) {
    const bar = {}, page = decidePage(d, undefined, false, bar), rise = !sheetUp;
    sheetUp = d.key;
    return el('div', { class: `ask-over${rise ? ' up' : ''}`, 'data-key': d.key }, el('a', { class: 'ask-scrim', href: '#waiting', tabindex: '-1', 'aria-hidden': 'true' }),
      el('section', { class: 'ask-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ask-title' }, el('div', { class: 'grab', 'aria-hidden': 'true' }),
        el('header', { class: 'sh-head' }, cardTile(d), el('span', { class: 'sh-lab', dir: 'auto' }, `${whoOf(d)}${d.filed ? ` · ${filedAt(d.filed)}` : ''}`), bar.more,
          el('a', { class: 'sh-x', href: '#waiting', 'aria-label': 'Close' }, glyph('x'))), page));
  }
  /** An ask's kind as Decide names it over the question, as in "Pick one · Release agent · 08:01". */
  const askKind = (d) => ({ signin: 'Sign in', 'yes-no': 'Yes or no' })[typeOf(d)] ?? TYPE_NAMES[typeOf(d)];
  /** A sign-in as a page of its own: its key, the headline, what it unlocks, how long the link lasts (on a phone; on a desk the row beside it counts that down) and where it signs in,
   *  with Open sign-in as the one button; once tapped it says it waits for you until the agent closes the card. */
  /** Copies a fact's whole value: the clipboard API where the board is a secure context, else a hidden box the browser copies from. The button says Copied for a moment,
   *  then returns to its own name, and the board's toast shows the word. */
  async function copyValue(text, btn) {
    const said = (label) => { btn.setAttribute('aria-label', label); btn.classList.toggle('ok', label === 'Copied'); clearTimeout(btn.said); btn.said = setTimeout(() => said(btn.dataset.name), 1600); };
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch {
      // A board on a plain address has no clipboard API: a hidden box and the browser's own copy stand in.
      try { const box = el('textarea', { 'aria-hidden': 'true', style: 'position: fixed; top: 0; left: -9999px; opacity: 0' }); box.value = text; document.body.append(box); box.select(); ok = document.execCommand('copy'); box.remove(); } catch {}
    }
    said(ok ? 'Copied' : 'Could not copy');
    if (ok) say('Copied', 1600);
  }
  /** One row of a sign-in's facts: its icon, the label, which keeps its word, and the value, which takes the free width and wraps inside it. A value that cannot wrap cleanly
   *  (a link, or one long word) keeps one line with an ellipsis beside a copy button that hands over the whole value. */
  const fact = (mark, name, value) => {
    const text = value.textContent ?? '', clip = /^https?:\/\//i.test(text) || !/\s/.test(text) && [...text].length > 24;
    const row = el('div', { class: 'fact' }, glyph(mark), el('span', { class: 'fl' }, name), value);
    if (!clip) return row;
    value.classList.add('clip');
    const btn = el('button', { class: 'cp', type: 'button', 'aria-label': `Copy ${name}` }, glyph('copy'));
    btn.dataset.name = btn.getAttribute('aria-label');
    btn.addEventListener('click', () => copyValue(text, btn));
    row.append(btn);
    return row;
  };
  function signinPage(d, desk) {
    const err = el('div', { class: 'err', role: 'alert', id: `err-${d.key}` }), { open, line } = signinOpen(d, undefined, err);
    const gone = expiredLink(d), host = /^https?:\/\/(?:www\.)?([^/?#]+)/.exec(d.link ?? '')?.[1], opened = !d.start && !gone && !!openedAt(d);
    if (open) { open.textContent = 'Open sign-in'; if (desk) open.dataset.kbd = '↵'; }
    // Opened, the card waits for approval on the poster's side, and it says so; it never reads as done until `signin done`.
    const hint = d.start || gone ? line
      : el('p', {}, opened ? 'Opened — waiting for approval. It stays until the agent says the sign-in is done.' : `Opens ${d.title} in a new tab. It stays until the agent says the sign-in is done.`);
    if (hint) hint.classList.add('hint');
    return el('section', { class: 'decide signin-ask g-signin' }, icon('key'), el('div', { class: 'lead' }, el('h2', { id: 'ask-title', tabindex: '-1', dir: 'auto' }, `Sign in to ${d.title}`)), askProps(d),
      d.about ? el('p', { class: 'why', dir: 'auto' }, d.about) : '',
      el('div', { class: 'facts' }, fact('bolt', 'Unlocks', el('b', { dir: 'auto' }, d.unlocks)), d.expires ? fact('clock', 'Expires', el('b', { ...(!gone && { 'data-ends': d.expires }) }, endsAt(d.expires))) : '',
        host ? fact('lock', 'Where', el('b', {}, host)) : ''), thread(d), err, el('div', { class: 'decide-bar' }, open, d.start ? '' : reissue(d, err), hint));
  }
  /** An ask, as the approved prototype lays it out: its kind, who asked and when over the question (on a desk that line is the bar's), why, the proof it rests on, the answers as cards
   *  ending in Your own answer, one optional note, what happens if you stay quiet, and one button. Nothing is picked until the person picks: Recommended is only a tag, and the button
   *  stays off until a pick, then names it (Send answer for their own words). The sink takes the parts of the bar above it:
   *  the kind line for a desk (crumb), the question for a phone's bar once scrolled (mid), and More (···): Ask me later and Discard. */
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
  const kc = (k) => el('kbd', { class: 'kc' }, k);
  /** The desk (ui.css), as the approved prototype draws it: the head across, where you are, the title, one line of what it holds and the screen's controls at its right
   *  (the order and light or dark, taken from its phone title row and list so each is drawn once), then the list in four columns beside the open item in eight. */
  function split(top, sub, list, pane) {
    const segs = list.flatMap((n) => (n?.matches?.('.ui-seg') ? [n] : n?.querySelectorAll ? [...n.querySelectorAll(':scope > .ui-seg')] : []));
    const acts = [...segs, ...[...top.children].filter((e) => !e.matches('h1, .lede, .back'))];
    list = list.filter((n) => !segs.includes(n));
    if (!acts.some((e) => e.matches?.('.ui-rb'))) acts.push(themeButton());
    return el('div', { class: 'ui-desk' }, el('header', { class: 'ui-dhead' }, el('div', { class: 'tx' }, el('p', { class: 'crumb' }, 'Sign-off', el('span', { 'aria-hidden': 'true' }, '›'), top.querySelector('h1')?.dataset.crumb ?? top.querySelector('h1')?.textContent),
      el('h1', { tabindex: '-1' }, top.querySelector('h1')?.textContent), el('p', {}, ...[sub].flat())), el('div', { class: 'acts' }, ...acts)),
      el('div', { class: 'ui-dgrid split' }, el('div', { class: 'ui-col s4 split-list' }, ...list), pane));
  }
  /** The report an ask is about (its --report), beside the ask on a desk as the prototype draws it: what the report says, up to four of the numbers its picture
   *  shows (each with its label), and Open report. An ask about no report on the board shows none. */
  const askReport = (d) => {
    const r = d.report && state.decisions.find((x) => x.key === d.report);
    if (!r) return [];
    const unit = r.visual?.unit ? ` ${r.visual.unit}` : '', tiles = (r.visual?.rows ?? []).filter((x) => x.value !== undefined || x.note).slice(0, 4);
    return [el('p', { class: 'ui-dl' }, 'Its report'), el('div', { class: 'ui-props ask-rp' }, el('p', { class: 'cx', dir: 'auto' }, plain(r.about ?? r.title)),
      tiles.length ? el('div', { class: 'cxn' }, ...tiles.map((x) => el('span', {}, el('b', {}, x.value !== undefined ? `${x.value}${unit}` : x.note), el('small', { dir: 'auto' }, x.label)))) : '',
      el('a', { class: 'see', href: `#reports/${r.key}` }, 'Open report'))];
  };
  /** The open item's head line on a desk: its tile, what it is, whose and when, and its More. */
  const askHead = (d, sink) => el('div', { class: 'ui-shd split-bar' }, cardTile(d), sink.crumb, sink.more ?? '');
  /** An open item on a desk that is not an ask's own pane: one card with its head line over it. */
  const pane = (head, ...body) => el('section', { class: 'ui-card ui-pane s8 split-detail' }, head, ...body);
  /** Decide on a desk: the list beside the ask it has selected (the first until a row is picked). Answering folds the row away and selects the next. */
  function decideDesk(top, items, hidden, queue, key, done, today) {
    const old = done.find((x) => x.key === key), i = Math.max(0, queue.findIndex((d) => d.key === key)), d = old ?? queue[i], next = !old && queue.length > 1 ? queue[(i + 1) % queue.length] : undefined;
    deskSel = d?.key ?? '';
    const list = [decideList(items, hidden, done, today)], sub = [`${plural(queue.length, 'ask')} ${queue.length === 1 ? 'waits' : 'wait'} on you · ${today} answered today`, leashChip()];
    if (!d) return split(top, sub, list, pane('', items.length ? el('p', { class: 'empty' }, 'Open a review from the list.') : allClear(true)));
    const bar = {}, page = decidePage(d, next, true, bar);
    return split(top, sub, list, page.matches('.ui-pane') ? page : pane(askHead(d, bar), page));
  }
  /** Evidence on a desk: the list of updates beside the one selected. */
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
  const detailRoute = /^#(?:decide|waiting|designs|evidence|reports|answered|ticket)\/[\w.-]+$/;
  const detailScope = '.split-detail, .ask-sheet, .tk-sheet, .tk-pane, .dz-open, #reader:not([hidden])';
  const detailHeaders = '#reader:not([hidden]) .ev-shd, #reader:not([hidden]) .rp-shd, #reader:not([hidden]) .reader-head, #reader:not([hidden]) > header, .ask-sheet .sh-head, .split-detail .split-bar, .tk-shd, .dz-oh';
  let sequence = history.state?.detailSequence ?? null;
  /** Which way the last Next or Previous moved (0 for a link or Back), so the content that swaps in slides from that side. */
  let swapDir = 0;
  /** Content swapped inside a sheet that stays open: a short cross-fade, sliding from the side it moved. Nothing plays under reduced motion. */
  const swapIn = (nodes) => {
    if (calm.matches) return;
    for (const n of nodes) n.animate?.([{ opacity: 0, transform: `translateX(${swapDir * 1.5}rem)` }, { opacity: 1, transform: 'none' }], { duration: 160, easing: 'ease-out' });
  };
  /** A sheet that Next, Previous, J, K or a swipe moves on to another item keeps its element (moving it would replay its open animation): only what is in it changes, and it starts at the top.
   *  It is the last thing on the board, so the rest is drawn before it. Returns the kept sheet. */
  const keepSheet = (content) => {
    for (const [over, sheet] of [['.ask-over', '.ask-sheet'], ['.tk-over', '.tk-sheet']]) {
      const fresh = content.find((n) => n.matches?.(over)), old = document.querySelector(`#board > ${over}`);
      if (!fresh || !old) continue;
      const was = old.querySelector(sheet), now = fresh.querySelector(sheet), moved = old.dataset.key !== fresh.dataset.key, top = was.scrollTop;
      old.dataset.key = fresh.dataset.key;
      old.querySelector('a[class$="scrim"]').setAttribute('href', fresh.querySelector('a[class$="scrim"]').getAttribute('href'));
      for (const a of ['aria-label', 'aria-labelledby']) now.hasAttribute(a) ? was.setAttribute(a, now.getAttribute(a)) : was.removeAttribute(a);
      was.replaceChildren(...now.childNodes);
      was.scrollTop = moved ? 0 : top;
      if (moved) swapIn([...was.children].filter((n) => !n.matches('.grab')));
      content.splice(content.indexOf(fresh), 1);
      return old;
    }
  };
  const visibleRoutes = (root) => [...new Set([...root.querySelectorAll('a[href]')]
    .filter((a) => detailRoute.test(a.hash) && a.getClientRects().length && !a.closest(detailScope + ', .detail-sequence, .dl-menu'))
    .map((a) => a.hash))];
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || !detailRoute.test(a.hash) || a.closest(detailScope)) return;
    const routes = visibleRoutes(a.closest('.split-list, .dz-strip') ?? document.getElementById('board'));
    if (routes.includes(a.hash)) sequence = { routes, from: location.hash };
  }, true);
  const sequenceStep = (step) => {
    const at = sequence?.routes.indexOf(location.hash) ?? -1, next = sequence?.routes[at + step];
    if (at < 0 || !next) return;
    rpPicked = true;
    swapDir = step;
    location.hash = next;
  };
  function detailSequence() {
    document.querySelectorAll('.detail-sequence').forEach((n) => n.remove());
    const header = [...document.querySelectorAll(detailHeaders)].find((n) => n.getClientRects().length);
    if (!header) return;
    // Desk lists may select their first item before there is an item in the address.
    const selected = document.querySelector('.split-list a[aria-current], .dz-strip a[aria-current], .tk-row[aria-current]');
    const route = detailRoute.test(location.hash) ? location.hash : selected?.hash;
    if (!route) return;
    if (!detailRoute.test(location.hash) || !sequence?.routes.includes(route)) {
      const routes = visibleRoutes(document.querySelector('.split-list, .dz-strip') ?? document.getElementById('board'));
      sequence = { routes: routes.includes(route) ? routes : [route], from: location.hash };
    }
    const at = sequence.routes.indexOf(route);
    history.replaceState({ ...history.state, detailSequence: sequence }, '');
    const nav = el('nav', { class: 'detail-sequence', 'aria-label': 'Browse items' });
    const move = (step, label) => {
      const b = el('button', { type: 'button', 'aria-label': label, title: label }, el('span', { 'aria-hidden': 'true' }, step < 0 ? '‹' : '›'));
      b.disabled = at + step < 0 || at + step >= sequence.routes.length;
      b.onclick = () => {
        // A desk's implicit selection must first acquire its route.
        if (!detailRoute.test(location.hash)) history.replaceState(history.state, '', route);
        sequenceStep(step);
      };
      return b;
    };
    nav.append(move(-1, 'Previous item (K or Left arrow)'), el('span', { class: 'position', 'aria-live': 'polite', 'aria-atomic': 'true' }, `${at + 1} of ${sequence.routes.length}`), move(1, 'Next item (J or Right arrow)'));
    header.append(nav);
  }
  addEventListener('popstate', () => { if (history.state?.detailSequence) sequence = history.state.detailSequence; });
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.target.closest?.('input, textarea, select, [contenteditable], iframe') || document.querySelector('dialog[open]') || designSession?.open || protoFull) return;
    const step = { j: 1, k: -1, ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
    const nav = document.querySelector('.detail-sequence');
    if (!step || !nav) return;
    e.preventDefault(); e.stopImmediatePropagation();
    nav.querySelectorAll('button')[step > 0 ? 1 : 0].click();
  }, true);
  let detailTouch;
  document.addEventListener('touchstart', (e) => {
    detailTouch = null;
    if (!phone() || e.touches.length !== 1 || !e.target.closest?.(detailScope) || e.target.closest('button, a, input, textarea, select, iframe, img, canvas, [contenteditable], .captures, .mock, .rung') || document.querySelector('dialog[open]') || protoFull) return;
    // Leave horizontal screenshot strips and other scrollers to their own gestures.
    for (let n = e.target; n && n !== document.body; n = n.parentElement) if (n.scrollWidth > n.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return;
    detailTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: location.hash };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!detailTouch) return;
    if (e.touches.length !== 1 || Math.abs(e.touches[0].clientY - detailTouch.y) > 30) detailTouch = null;
  }, { passive: true });
  document.addEventListener('touchcancel', () => { detailTouch = null; }, { passive: true });
  document.addEventListener('touchend', (e) => {
    const start = detailTouch; detailTouch = null;
    if (!start || start.at !== location.hash || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - start.x, dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy) * 2) sequenceStep(dx < 0 ? 1 : -1);
  }, { passive: true });
  /** Every key, in one sheet behind ?. A desk hints each where it works; they work at any width with a keyboard. */
  const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  const KEYS = [['Anywhere', [['Go to Today', 'G', 'T'], ['Go to Decide', 'G', 'D'], ['Go to Evidence', 'G', 'E'], ['Go to Reports', 'G', 'R'], ['Undo', MOD, 'Z'], ['This list', '?']]],
    ['Lists', [['Next', 'J'], ['Previous', 'K']]],
    ['Today', [['Up next', '↵']]],
    ['Decide', [['Answer', '↵'], ['Pick option 1 to 9', '1', '–', '9'], ['Note', 'C'], ['Answer from the note', MOD, '↵'], ['Later', 'L'], ['Next ask', 'E']]],
    ['Reports', [['Read or unread', 'U'], ['Archive', 'E'], ['Open a guided report', '↵']]]];
  const shut = el('button', { 'aria-label': 'Close' }, '✕');
  const keysSheet = el('dialog', { id: 'keys', 'aria-labelledby': 'keys-title' }, el('div', {}, el('header', {}, el('h2', { id: 'keys-title' }, 'Keyboard shortcuts'), shut),
    ...KEYS.flatMap(([head, rows]) => [el('h3', {}, head), el('ul', {}, ...rows.map(([words, ...keys]) => el('li', {}, el('span', {}, words), ...keys.map(kc))))])));
  shut.onclick = () => keysSheet.close();
  keysSheet.onclick = (e) => e.target === keysSheet && keysSheet.close();
  document.body.append(keysSheet);
  const GO = { t: '#', d: '#waiting', e: '#evidence', r: '#reports' };
  let gAt = 0;
  addEventListener('keydown', (e) => {
    const typing = e.target.closest?.('textarea, input, select'), mod = e.metaKey || e.ctrlKey;
    // From the note (or Your own answer) on an ask, Cmd+Enter answers with it.
    if (mod && e.key === 'Enter' && typing?.closest('.decide')) { e.preventDefault(); document.querySelector('.decide-bar .answer')?.click(); return; }
    const undo = !toast.hidden && !undoBtn.hidden && !undoBtn.disabled && (!location.hash.slice(1) || location.hash === '#waiting' || /^#(decide|reports)\//.test(location.hash) || location.hash === '#reports') ? undoBtn : null;
    if (mod && !e.altKey && e.key.toLowerCase() === 'z' && !typing && undo && !protoFull) { e.preventDefault(); undo.click(); return; }
    if (mod || e.altKey || typing || keysSheet.open || designSession?.open || protoFull || !reader.hidden) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, g = gAt && e.timeStamp - gAt < 1500;
    gAt = k === 'g' ? e.timeStamp : 0;
    if (g && GO[k]) { e.preventDefault(); location.hash = GO[k]; return; }
    if (k === '?') { e.preventDefault(); keysSheet.showModal(); return; }
    // J and K (or the arrow keys) move the selection through a desk list.
    const rows = [...document.querySelectorAll('.split-list [data-row]')], step = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 }[k];
    if (step && rows.length) { e.preventDefault(); const at = rows.findIndex((r) => r.matches('[aria-current]')); rows[Math.min(rows.length - 1, Math.max(0, at + step))].click(); return; }
    // On Decide, a number picks that answer (Enter then sends it); E skips to the next ask, Z undoes the last answer.
    const onDecide = /^#decide\//.test(location.hash) || !!document.querySelector('.split-detail.decide, .split-detail .decide'), choices = [...document.querySelectorAll('.decide .pick-option')];
    const pick = onDecide && /^[1-9]$/.test(k) ? choices[Number(k) - 1] : null;
    if (pick) { e.preventDefault(); pick.click(); return; }
    if (k === 'e' && onDecide && skipTo) { e.preventDefault(); location.hash = skipTo; return; }
    if (k === 'z' && undo) { e.preventDefault(); undo.click(); return; }
    // On a desk's Reports, U reads or unreads the report shown, E archives it, Enter opens a guided one.
    const rp = document.querySelector('.split-bar.rp-bar')?.parentElement, rpKey = rp && { u: '.rp-read', e: '.rp-archive', Enter: '.rp-open' }[k];
    if (rpKey && !(k === 'Enter' && e.target.closest?.('a:not([aria-current]), button, summary'))) { const b = rp.querySelector(rpKey); if (b) e.preventDefault(), b.click(); return; }
    // On Today, Enter takes Up next's main action: open the sign-in, answer with the pick, or start the review.
    if (k === 'Enter' && !location.hash.slice(1) && !e.target.closest?.('a, button, summary')) { const go = document.querySelector('.t-up .t-btn.ink:not(:disabled)'); if (go) e.preventDefault(), go.click(); return; }
    if (!onDecide) return;
    // Enter answers (or opens a sign-in), C goes to the note, L moves the ask to Later.
    if (k === 'Enter' && !e.target.closest?.('a:not([aria-current]), button, summary')) { const go = document.querySelector('.decide-bar .answer:not(:disabled), .decide .open-link:not(:disabled)'); if (go) e.preventDefault(), go.click(); }
    if (k === 'c') { const box = document.querySelector('.decide .note-box'); if (box) { e.preventDefault(); box.focus({ preventScroll: true }); box.scrollIntoView({ block: 'center' }); } }
    if (k === 'l') { const b = document.querySelector('.decide .later-btn'); if (b) e.preventDefault(), b.click(); }
  });
  const reshow = (control) => { render(); document.querySelector(control)?.focus({ preventScroll: true }); };
  /** Today's small title shows in its bar once the large one has scrolled under it. */

  function render() {
    if (designSession?.open) return (boardStale = true);
    const by = { waiting: [], designs: [], evidence: [], reports: [], answered: [], notes: [] };
    // The board file appends new items at the end, so each list reads newest first; answers sort by their time.
    // One decision is one card: a card an open ask merges is not shown; that ask's answer closes it.
    const gone = new Set(state.dismissed ?? []), open = state.decisions.filter((d) => !gone.has(d.key) && !isAnswered(d));
    const openKeys = new Set(open.map((d) => d.key));
    const merged = new Set(open.flatMap((d) => d.merges ?? []).filter((k) => openKeys.has(k)));
    for (const d of [...state.decisions].reverse()) if (!gone.has(d.key) && !merged.has(d.key)) by[area(d)].push(d);
    // Evidence keeps every proof that is not dismissed, answered or not, newest first, however old: a passed check, a capture with no run to check (it says Not run) or one that could not be checked.
    // A failed run or one that did not finish is no proof, so it is left off; its own screen still opens, and a verdict moves it to Answered.
    // Today's Proof tile counts the same list, and says how many runs failed.
    const shownProof = state.decisions.filter((d) => d.type === 'evidence' && !['RUN FAIL', 'INCONCLUSIVE'].includes(d.evidenceCard?.result) && !gone.has(d.key));
    by.evidence = [...by.evidence.filter((d) => d.type !== 'evidence'), ...shownProof].sort((x, y) => (Date.parse(y.filed) || 0) - (Date.parse(x.filed) || 0));
    by.failedProof = state.decisions.filter((d) => d.type === 'evidence' && d.evidenceCard?.result === 'RUN FAIL' && !gone.has(d.key));
    by.designs = [...state.decisions].reverse().filter((d) => d.kind === 'design' && !gone.has(d.key));
    // Waiting on you reads newest first. A sign-in blocks someone now, so sign-ins come first.
    let latest = -Infinity;
    const inFileOrder = by.waiting.slice().reverse().map((d, i) => { const t = Date.parse(d.filed); if (!Number.isNaN(t)) latest = t; return { d, t: latest, i }; });
    const asked = inFileOrder.sort((x, y) => (x.t === y.t ? x.i - y.i : x.t - y.t)).map((x) => x.d).reverse();
    by.waiting = [...asked.filter((d) => d.type === 'signin'), ...asked.filter((d) => d.type !== 'signin')];
    const hidden = state.decisions.filter((d) => gone.has(d.key) && !merged.has(d.key) && area(d) === 'waiting');
    decideCtx = { all: decideOrder(by.waiting), hidden };
    by.answered.sort((x, y) => state.answers[y.key].at.localeCompare(state.answers[x.key].at));
    const [, at, key] = /^#(waiting|decide|designs|evidence|reports|answered|tickets|ticket)(?:\/([\w.-]+))?$/.exec(location.hash) ?? [];
    if (at === 'tickets') readTickets();
    // The asks Decide steps through, in the list's order, Later last.
    const decideQueue = decideCtx.all.filter((d) => d.type === 'signin' || (d.type !== 'plan' && d.kind !== 'design'));
    // Answered asks it opens again, newest first in its list; the arrows step through them oldest first, then through the open asks.
    const decideDone = by.answered.filter(redo), walk = [...decideDone].reverse().concat(decideQueue);
    // On a desk, Decide's list and its ask share the screen, Evidence's list and its update, and Reports' list and its report.
    // On a phone an ask opens as a sheet over Decide's list, so the page under it keeps the list's head.
    decideCounts = { asks: by.waiting.filter((d) => sideOf(d) === 'now').length, designs: by.designs.filter(dzOpen).length };
    const deskSplit = !phone() && ((at === 'waiting' || at === 'decide' || at === 'reports') && !state.readonly || at === 'evidence'), head = at === 'decide' ? 'waiting' : at;
    deskSel = null;
    // A report in the address is shown (and read) beside the list; with none, the newest is shown, not yet marked read.
    // A kind that no longer lists anything is let go; the newest shown is the newest of the kind listed.
    if (rpKind && !by.reports.some((d) => kindOf(d) === rpKind)) rpKind = '';
    const newest = ofKind(by.reports).filter(reads).sort((x, y) => (Date.parse(y.filed) || 0) - (Date.parse(x.filed) || 0))[0];
    const shownReport = deskSplit && at === 'reports' ? (key && by.reports.find((d) => d.key === key && reads(d))) || newest : undefined;
    rpSel = deskSplit && at === 'reports' ? shownReport?.key ?? '' : null;
    // It is read once per visit, so Mark unread on it holds through the redraws that follow.
    if (!shownReport || shownReport.key !== key) rpVisit = '';
    else if (rpVisit !== key) {
      rpVisit = key;
      // A guided report reached by a link rather than from the list (Today's card, the CLI's open) opens over the board, as on a phone.
      if (shownReport.guided && !rpPicked) rpFull = key;
      if (unread(shownReport) && !FROZEN) setTimeout(() => markRead([key], true));
    }
    if (rpSel === null || rpFull !== shownReport?.key) rpFull = '';
    document.body.classList.toggle('split-view', deskSplit);
    const askAt = decideQueue.findIndex((d) => d.key === key), decideAt = key ? askAt : 0, doneAt = key && askAt < 0 ? walk.findIndex((d) => d.key === key && isAnswered(d)) : -1;
    const shownAsk = doneAt >= 0 ? walk[doneAt] : decideQueue[decideAt];
    // The address of a card opens it whole: a row from the first screen is filled in with its body and its proof as it opens.
    const opened = /^#(?:waiting|decide|designs|evidence|reports|ticket)\/([\w.-]+)$/.exec(location.hash)?.[1];
    whole(opened);
    for (const k of changing) if (k !== shownAsk?.key) changing.delete(k);
    // A decision lives under Decide; Designs has its own place in the sidebar, and on a phone, as the prototype's dock has it, Designs and Answered light Today, whose More opens them.
    const active = at === 'decide' ? 'waiting' : at === 'answered' ? '' : at === 'ticket' ? 'tickets' : at ?? '';
    // Tickets, as the prototype draws its place, carries no count.
    const count = (a) => (a === 'reports' && !state.readonly ? by.reports.filter(unread).length : a && a !== 'tickets' ? by[a].length : undefined);
    // Decide's count is a red badge and new Reports' an ink one, in the sidebar and the tab bar alike; Evidence's is a plain number.
    const badge = (a) => (a === 'waiting' ? 'red' : a === 'reports' && !state.readonly ? 'ink' : '');
    const link = ([a, name]) => el('a', { href: `#${a}`, ...(a === active && { 'aria-current': 'page' }) }, icon(`tab-${a || 'today'}`), name,
      count(a) === undefined || (badge(a) && !count(a)) ? '' : el('span', { class: `n ${badge(a)}`.trim() }, String(count(a))));
    // The sidebar as the prototype draws it: the board's mark and name, Search, the areas, and at its foot whose board it is with the light-or-dark button
    // (on a desk the one place it sits), then the version the board runs (0.6.1-dev on a dev build). Every key stays in the ? sheet.
    const who = state.name || 'You';
    document.getElementById('nav').replaceChildren(el('p', { class: 'brand' }, el('span', { class: 'logo', 'aria-hidden': 'true' }, glyph('check')), el('span', {}, 'Sign-off')),
      el('a', { class: 'sfind', href: '#find' }, document.getElementById('dock-find').firstChild.cloneNode(true), 'Search'), ...SIDE.map(link),
      el('div', { class: 'me' }, el('i', { 'aria-hidden': 'true' }, [...who][0].toUpperCase()), el('span', { dir: 'auto' }, who), themeButton()),
      state.version ? el('p', { class: 'ver' }, `Version ${state.version}`) : '');
    paintTabs(active === 'designs' ? 'waiting' : active, count, badge);
    const ro = state.readonly ? 'Read only' : FROZEN ? `Read-only copy, ${FROZEN.exported}` : '';
    const pageTitle = head === 'decide' || head === 'waiting' ? 'Decide' : head === 'reports' ? 'Reports' : AREAS[head];
    document.body.classList.toggle('today', !at);
    document.body.classList.toggle('tickets', at === 'tickets' || at === 'ticket');
    const bulk = { waiting: by.waiting, designs: by.designs, evidence: by.evidence, reports: [...by.reports, ...by.notes], answered: by.answered }[at] ?? [];
    const answeredToday = by.answered.filter((d) => isToday(state.answers[d.key].at)).length;
    // Decide's head, as ui.css draws it: the title and the light-or-dark button at its right edge; More sits under the list.
    const sel = selecting && canDismiss() && bulk.length && ['waiting', 'designs'].includes(head) && selectHead(bulk);
    const top = head === 'waiting' && !state.readonly ? el('header', { class: 'ui-top' }, el('h1', { tabindex: '-1', 'data-crumb': pageTitle }, sel ? sel.title : pageTitle), ro ? el('p', { class: 'meta' }, ro) : '', ...(sel ? [sel.all, sel.bar] : [phone() ? decideSortButton() : '', themeButton()]))
      : el('header', { class: head === 'reports' && !state.readonly ? 'top ui-top rp-top' : head ? 'top' : 'ui-top today-top' }, head && !TABS.some(([a]) => a === head)
      ? el('a', { class: 'back', href: '#' }, '‹ Today') : '',
    ...(head ? [el('h1', { tabindex: '-1' }, pageTitle)] : todayHead()),
    ro ? el('p', { class: 'meta' }, ro) : '',
    head === 'answered' && by.answered.length ? el('p', { class: 'lede' }, (() => { const n = by.answered.filter((d) => isToday(state.answers[d.key].at)).length; return `${n} ${n === 1 ? 'answer' : 'answers'} today. Each one has gone back to its agent.`; })())
      : head === 'designs' && by.designs.length ? el('p', { class: 'lede' }, 'Designs to look over. Approve one, or say what should change.') : '',
    head === 'reports' && !selecting && !state.readonly ? kindFilter(by.reports) : '', head === 'reports' && !selecting && !state.readonly && !FROZEN ? themeButton() : bulkBar(bulk));
    const board = document.getElementById('board');
    board.removeAttribute('aria-busy');
    const listTop = document.querySelector('.split-list')?.scrollTop;
    // An update in the address opens even when the list leaves it off (a failed run); with none, the newest is selected.
    // Reports' list: Newest or By project and what is still to read, the legend (only while a report with no page lists its steps in place), the lists, Notes and Archived;
    // on a desk an empty board says so in the pane beside it.
    const listed = ofKind(by.reports);
    const rpPage = () => el('div', { class: `rp-page${rpRisen ? '' : ' rise'}` }, ...(by.reports.length ? reportsHead(listed, by.reports) : []), listed.some((d) => d.steps && !reads(d)) ? el('p', { class: 'card legend' }, ...Object.keys(MARKS).map((m) => el('span', {}, el('span', { class: `mk mk-${m}` }), MARKS[m]))) : '',
      ...(by.reports.length ? reportGroups(listed) : rpSel !== null ? [] : [el('div', { class: 'all-clear-big' }, el('span', { class: 'big' }, glyph('check')), el('h2', {}, 'Nothing to read'), el('p', {}, EMPTY.reports))]),
      notes(by.notes), archived(state.decisions.filter((d) => gone.has(d.key) && !merged.has(d.key) && ['reports', 'notes'].includes(area(d)))),
      !selecting && !state.readonly && !FROZEN && bulk.length ? reportsMore(by.reports, bulk) : '');
    const update = at === 'evidence' && ((key && state.decisions.find((d) => d.key === key && !gone.has(d.key) && d.type === 'evidence')) || by.evidence.find((d) => d.type === 'evidence'));
    const content = at === 'tickets' || at === 'ticket' ? tickets(by, at === 'ticket' ? key : '') : [...(deskSplit ? [at === 'evidence' ? evidenceDesk(top, by.evidence, archived(state.decisions.filter((d) => gone.has(d.key) && d.type === 'evidence')), update)
      : at === 'reports' ? reportsDesk(top, rpPage(), shownReport, by.reports.length > 0, by.reports) : decideDesk(top, by.waiting, hidden, decideQueue, key, decideDone, answeredToday)] : at === 'designs' && !phone() && by.designs.length ? [] : [top]), ...(deskSplit ? [] : (at === 'waiting' || at === 'decide') && !state.readonly ? [at === 'decide' && !shownAsk ? el('p', { class: 'empty' }, 'Nothing to decide for that question.') : '', decideList(by.waiting, hidden, decideDone, answeredToday), at === 'decide' && shownAsk ? askSheet(shownAsk) : '']
      : at === 'designs' ? designGroups(by.designs, top, key, state.decisions.filter((d) => gone.has(d.key) && !merged.has(d.key) && area(d) === 'designs')) : at === 'evidence' ? [...evidenceList(by.evidence, top), archived(state.decisions.filter((d) => gone.has(d.key) && d.type === 'evidence'))] : at === 'reports' && !state.readonly ? [rpPage()] : at === 'answered' && by.answered.length ? done(by.answered) : at ? [by[at].length ? el('div', { class: `list in-${at}${state.readonly ? ' readonly' : ''}` }, ...by[at].map(row))
      : el('p', { class: 'empty' }, at === 'answered' && state.decisions.some((d) => gone.has(d.key) && isAnswered(d)) ? 'All done items cleared.' : EMPTY[at])] : today(by))];
    if (!(at === 'decide' && shownAsk && !deskSplit)) sheetUp = '';
    // The report shown on a desk stays in place under a new list and bar while it is the same report, so its frame is not loaded again.
    const keptRead = document.querySelector('#board .split-detail > .read'), newRead = content[0]?.querySelector?.('.split-detail > .read');
    if (keptRead && newRead && keptRead.dataset.sig === newRead.dataset.sig) {
      // The page stays; the head, the list, the report's head line and its parts beside it are drawn again.
      for (const part of ['.ui-dhead', '.split-list', '.split-detail > .split-bar', '.split-detail > .pside']) document.querySelector(`#board ${part}`).replaceWith(content[0].querySelector(part));
    } else {
      const kept = swapDir && keepSheet(content);
      if (kept) { for (const n of [...board.children]) if (n !== kept) n.remove(); kept.before(...content); }
      else board.replaceChildren(...content);
    }
    // A redraw keeps the desk list where it was scrolled, with the selected row in view.
    const listEl = document.querySelector('.split-list');
    if (listEl && listTop) listEl.scrollTop = listTop;
    listEl?.querySelector('[data-row][aria-current]')?.scrollIntoView({ block: 'nearest' });
    if (!toast.hidden) placeToast();
    if (at === 'reports' && !key) rpRisen = true;
    if (rpSel !== null) rpRisen = true;
    readPage(rpFull ? shownReport : key && !(deskSplit && (at === 'evidence' || at === 'reports')) && !(at === 'designs' && !phone()) ? state.decisions.find((d) => d.key === key && !gone.has(d.key) && (at === 'reports' && reads(d) || at === 'designs' && d.kind === 'design' || at === 'evidence' && d.type === 'evidence' || d.type === 'plan' && (area(d) === at || (d.guided && (at === 'waiting' || at === 'answered'))))) : undefined, rpFull ? location.hash.slice(1) : at);
    detailSequence();
    fold();
    applyPicks();
    if (FROZEN) freeze();
    if (document.querySelector('.tk-desk')) requestAnimationFrame(tkSettle), document.fonts.ready.then(tkSettle);
    if (document.querySelector('.ui-desk')) requestAnimationFrame(uiSettle), document.fonts.ready.then(uiSettle);
  }
  function freeze() {
    // Answers stay as they are, but nothing in the copy can be sent.
    document.querySelectorAll('#board .choices button, #board .pick-list button, #board .decide-bar .answer, #board .t-up button, #board .mock button, #board .note button, #board .note textarea').forEach((e) => (e.disabled = true));
    // A browser will not open a data: link in a new tab; the inline preview is the copy.
    document.querySelectorAll('#board a[href^="data:"]').forEach((a) => a.removeAttribute('href'));
  }
  // Typing in a box is not moving around by keyboard (a phone's keyboard sends keys too); Tab out of it is.
  addEventListener('keydown', (e) => { if (e.key === 'Tab' || !e.target.closest?.('textarea, input, select')) document.documentElement.dataset.kbd = ''; }, true);
  addEventListener('pointerdown', () => delete document.documentElement.dataset.kbd, true);
  // A new screen starts at its top, or at the item tapped on the Summary, with the focus on its title.
  // Closing a report or plan goes back to its card, with the focus on its link; an open report takes the focus on its title.
  // On a phone an ask pushes in from the right over Decide, and going back (or answering) slides the list in from the left; the list's rows rise in when the tab opens.
  let lastHash = location.hash;
  // Crossing 64rem swaps the phone's stack for the desk's list beside its ask, and back.
  matchMedia('(max-width: 63.999rem)').addEventListener('change', () => loaded && render());
  addEventListener('hashchange', () => {
    const back = !reader.hidden && reader.dataset.key, from = lastHash, ask = /^#decide\//;
    lastHash = location.hash;
    // A ticket's Back returns to the card its row was tapped on; from one ticket to another it keeps that card.
    if (/^#ticket\//.test(location.hash) && !/^#ticket\//.test(from)) ticketBack = from;
    if (jump && location.hash === '#waiting') jump = null;
    if (location.hash === '#waiting' && !ask.test(from)) risen = false;
    if (location.hash === '#reports' && !/^#reports\//.test(from)) rpRisen = false;
    selecting = false, picked.clear();
    // On a desk the new detail slides in from the side the selection moved.
    const rowsOf = () => [...document.querySelectorAll('.split-list [data-row]')], order = rowsOf().map((r) => r.getAttribute('href')), was = rowsOf().findIndex((r) => r.matches('[aria-current]'));
    render();
    swapDir = 0;
    rpPicked = false;
    if (!phone()) {
      const detail = document.querySelector('.split-detail'), now = document.querySelector('.split-list [data-row][aria-current]')?.getAttribute('href');
      if (detail && was >= 0 && now && now !== order[was] && !calm.matches) detail.dataset.dir = order.indexOf(now) >= 0 && order.indexOf(now) < was ? 'up' : 'down', detail.classList.add('in');
    }
    // On a phone an ask's sheet rises over Decide's list and closes back to it: the list stays where it was scrolled.
    const overList = phone() && [location.hash, from].every((h) => h === '#waiting' || ask.test(h));
    if (!reader.hidden) { scrollTo(0, 0); return reader.querySelector('h1').focus({ preventScroll: true }); }
    const item = (jump || back) && document.getElementById(`item-${jump || back}`);
    jump = null;
    // Opening or closing a ticket over Tickets' list leaves the list where it was, as an ask over Decide's does.
    const tix = /^#tickets?(\/|$)/;
    item ? item.scrollIntoView() : overList || (tix.test(from) && tix.test(location.hash)) ? '' : scrollTo(0, 0);
    // A Decide row is itself the link back to its page.
    // On a desk the focus stays on the selected row, so J, K and Enter carry on from it.
    // An ask's sheet takes the focus on its question; closed, the focus goes back to the row it was opened from.
    ((back && (item?.matches('a.dl-face') ? item : item?.querySelector('h3 a, .open-link, a.compact'))) || document.querySelector('.ask-sheet #ask-title') || document.querySelector('.tk-sheet .tk-dt')
      || (overList && ask.test(from) && document.getElementById(`item-${from.slice(8)}`)) || document.querySelector('.split-list [data-row][aria-current]') || document.querySelector('#board h1')).focus({ preventScroll: true });
  });
  // An interactive page may post its own height, `{ height: <px> }`, and its frame then fits it with no blank below.
  // Only a frame's own message sizes it. Document readers must fit even long pages; previews stay capped.
  addEventListener('message', (e) => {
    const frame = [...document.querySelectorAll('.rung iframe, iframe.plan-view, :is(#reader, .split-detail) .read iframe, .gd-dgbox:not(.full) iframe')].find((f) => f.contentWindow === e.source), h = e.data?.height;
    const documentFrame = frame?.matches('iframe.plan-view, :is(#reader, .split-detail) .read iframe, .gd-dgbox iframe');
    if (documentFrame && e.data?.['sign-off'] === 'ready') {
      frame.scrolling = 'no';
      frame.contentWindow.postMessage({ 'sign-off': 'size' }, '*');
    }
    if (frame && Number.isFinite(h) && h > 0) frame.style.height = `${Math.ceil(documentFrame ? h : Math.min(h, 10_000))}px`;
  });
  // A design mock page may point (web/point.js): the board keeps the last element named per mock, and turns pointing on for one mock frame.
  const pointing = new Map(), pointed = new Map();
  const mockFrame = (source) => [...document.querySelectorAll('.mock iframe')].find((f) => f.contentWindow === source);
  const aim = (frame) => {
    const on = talks() && pointing.get(frame.dataset.mock) === true;
    frame.style.pointerEvents = on ? 'auto' : '';
    frame.parentElement.classList.toggle('aiming', on);
    frame.contentWindow.postMessage({ 'sign-off': 'point', on }, '*');
  };
  function point(frame, on) {
    pointing.set(frame.dataset.mock, on);
    aim(frame);
  }
  // While pointing is on, a tap never opens the mock full size, even one that reaches the board instead of the frame:
  // one on the frame's edge, one the browser sends there until it has drawn the frame taking taps, or one before a frame drawn anew is ready.
  addEventListener('click', (e) => {
    const frame = e.target.closest?.('.shot')?.querySelector('iframe[data-mock]');
    if (frame && talks() && pointing.get(frame.dataset.mock) === true) e.preventDefault();
  });
  addEventListener('message', (e) => {
    const frame = mockFrame(e.source), msg = e.data;
    if (!frame || !msg) return;
    if (msg['sign-off'] === 'ready') aim(frame);
    if (msg['sign-off'] !== 'pointed' || !['ref', 'tag', 'text'].every((k) => typeof msg[k] === 'string')) return;
    pointed.set(frame.dataset.mock, { ref: msg.ref, tag: msg.tag, text: msg.text });
    // The element named opens the comment editor on its card, with its saved comment when it has one.
    const dm = frame.dataset.mock, cut = dm.indexOf('~'), d = state.decisions.find((x) => x.key === dm.slice(0, cut));
    if (!d || !talks() || pointing.get(dm) !== true) return;
    const mock = dm.slice(cut + 1);
    editing.set(d.key, { mock, hash: d.mocks?.find((m) => m.value === mock)?.hash, ref: msg.ref, tag: msg.tag, words: msg.text });
    redraw(d);
    document.getElementById(`ann-text-${d.key}`)?.focus();
  });

  const banner = document.getElementById('banner');
  const failed = (e) => {
    banner.textContent = `Can't read the board file: ${e.message}`;
    banner.hidden = false;
  };
  // Another program can change the board file (a feed, a new sign-in, signin done), so the page checks it every 20 seconds. The check is the
  // first screen's own page, tagged as last read: an unchanged board is a 304 with no body and no redraw, and a changed one is 15 KB, not five.
  let seenTag = '';
  async function refresh() {
    try {
      const open = /^#(?:waiting|decide|designs|evidence|reports|ticket)\/([\w.-]+)$/.exec(location.hash)?.[1];
      const res = await fetch('/api/decisions?view=asks&limit=20', { headers: seenTag ? { 'if-none-match': seenTag } : {} });
      let changed = false;
      if (res.status !== 304) {
        const body = await res.json().catch(() => ({ error: `The server replied ${res.status}` }));
        if (!res.ok) throw new Error(body.error);
        banner.hidden = true;
        seenTag = res.headers.get('etag') ?? '';
        mergeView(body);
        changed = true;
      }
      // The card on screen is read with the page: the board changes under an open card without changing the page that painted the first screen.
      if (open) {
        const card = await view(`/api/decisions?view=card&key=${encodeURIComponent(open)}`).catch(() => undefined);
        if (card?.card) mergeView(card), (changed = true);
      }
      if (!changed) return;
      renderKeepingFocus();
      rest();
    } catch (e) { failed(e); }
  }
  /** The first screen: one page of the asks waiting on the person, painted before the rest of the board is read. */
  const first = () => fetch('/api/decisions?view=asks&limit=20').then(async (res) => {
    const body = await res.json().catch(() => ({ error: `The server replied ${res.status}` }));
    if (!res.ok) throw new Error(body.error);
    seenTag = res.headers.get('etag') ?? '';
    // The first page names the board's file, so its drafts are read after it, never before.
    mergeView(body);
    loadDrafts();
    renderKeepingFocus();
  });
  if (FROZEN) (state = FROZEN), render();
  else first().then(() => {
    banner.hidden = true;
    setInterval(refresh, 20_000);
    rest();
  }, failed);
