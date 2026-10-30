
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
  /** Every page of the board has merged: what the whole board's own counts are made from, while a card is still read whole. */
  let paged = false, restFailed = '';
  /** What a failed read says to a person: the board's own words, or that it could not be reached (a browser's own wording is not for them). */
  const why = (e) => (e instanceof TypeError ? 'The board could not be reached.' : e.message);
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
    // A page names the cards it read last, and the board's own lists (an answer, a dismissal, what was read or restored) come with it for those
    // cards only: a card it names with no answer (a link posted again under the same key clears one) has lost it, and a card it does not name keeps
    // what an earlier page brought.
    const mine = new Set([...decisions.map((d) => d.key), ...(body.card ? [body.card.key] : [])]);
    const had = (name) => Object.hasOwn(body, name);
    // The lists read on their own carry all of every list: they are the board's truth about cards no page names, so they replace it, never join it.
    const full = page.view === 'lists';
    const kept = (name, of = (k) => k) => ({ ...Object.fromEntries(Object.entries(state[name] ?? {}).filter(([k]) => !mine.has(of(k)))), ...body[name] });
    const listed = (name) => (full ? body[name] : [...(state[name] ?? []).filter((x) => !mine.has(x?.key ?? x)), ...(body[name] ?? [])]);
    state = { ...state, ...board, decisions: [...rows.values()], page,
      tickets: page.view === 'tickets' ? rolled : roll.size ? [...roll.values()] : state.tickets,
      ...Object.fromEntries(['trail', 'rounds', 'messages', 'annotations', 'comments'].map((name) => [name, joined(name)])),
      // A part that says nothing of a list leaves it alone: a card brings its own answer and nobody else's, and a list it never mentions stays as it was.
      ...Object.fromEntries(['dismissed', 'promoted', 'seen', 'deeper'].filter(had).map((name) => [name, listed(name)])),
      ...Object.fromEntries(['answers', 'seen_at', 'opened', 'discarded', 'signin_opened'].filter(had).map((name) => [name, kept(name)])),
      ...(had('reads') && { reads: kept('reads', (k) => k.split('/')[0]) }),
      ...(had('delivery') && { delivery: { ...state.delivery, ...body.delivery } }) };
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
  /** The board's own lists, read once the first screen has painted: a page names the rows it shows, and the screens that list a card no page names
   * (Answered, Archived) need every answer and dismissal the board holds. Nothing of it is asked for before the first screen is on screen. */
  const readLists = () => view('/api/decisions?view=lists').then((body) => { mergeView(body); renderKeepingFocus(); }, () => {});
  async function rest() {
    if (resting || wholeBoard) return;
    resting = true;
    try {
      for (let offset = 0; ;) {
        const page = await view(`/api/decisions?view=items&offset=${offset}&limit=200`);
        mergeView(page);
        // The board's own data goes first; the rest of the styles follows once this page is in.
        restSoon();
        // Today already shows what the first page carries; another screen fills as its pages arrive.
        if (location.hash) renderKeepingFocus();
        if (page.more !== true || !page.decisions?.length) break;
        offset += page.decisions.length;
      }
      paged = true; restFailed = '';
    } catch (e) { restFailed = why(e); /* the first screen is on screen: a page that fails leaves it there, and the next poll reads it again */ } finally {
      resting = false;
      loadMore();
      renderKeepingFocus();
    }
  }
  /** The ticket roll-up is the largest part of the board and only the Tickets screen shows it: it is read when that screen first opens. */
  let ticketsRead = false, ticketsFailed = '', ticketTag = '', ticketRequest, ticketScreen = false;
  function readTickets(force = false) {
    if (!force && ticketsRead) return Promise.resolve(false);
    if (ticketRequest) return ticketRequest;
    ticketRequest = fetch('/api/decisions?view=tickets', { headers: ticketTag ? { 'if-none-match': ticketTag } : {} }).then(async (res) => {
      if (res.status === 304) return false;
      const body = await res.json().catch(() => ({ error: `The server replied ${res.status}` }));
      if (!res.ok) throw new Error(body.error);
      ticketTag = res.headers.get('etag') ?? '';
      ticketsRead = true; ticketsFailed = '';
      mergeView(body);
      renderKeepingFocus();
      return true;
    }).catch((e) => { ticketsRead = false; ticketsFailed = why(e); renderKeepingFocus(); return false; }).finally(() => { ticketRequest = undefined; });
    return ticketRequest;
  }
  /** Where the ticket roll-up stands, so a screen never calls a read still on its way, or one that failed, an empty board. A frozen copy holds it already. */
  const tkLoad = () => (FROZEN || ticketsRead ? 'ready' : ticketsFailed ? 'error' : 'loading');

  /** The addresses whose screens live in app-more.js: Decide, Designs, Evidence, Reports, Answered, Tickets. Today is the first screen and waits for nothing. */
  const MORE_SCREENS = /^#(?:waiting|decide|designs|evidence|reports|answered|tickets|ticket|activity|inbox|channels)(?:\/|$)/;
  // A response can arrive after the person has started typing on the next card.
  // Keep the active editor and its selection across that redraw, just as a poll does.
  // The screens beyond the first screen's own (the guide, the plan and design reviews, the tickets, the evidence and decide desks, the report and
  // annotation pages, the full-size and media views) live in app-more.js: fetched once the board has drawn, and waited on by a tap that lands before
  // they arrive, which then draws the screen itself.
  // An exported copy carries app-more.js in the same file, so every screen is there from the start: only a served board fetches the rest.
  let moreAsked = false, moreReady = !!FROZEN, moreLoad = null;
  // The rest of the styles are not in the page: they are asked for once the first screen has drawn, so a phone paints from the small sheet it already
  // holds. Every screen beyond the first waits for them, and for the file that draws it, so neither is ever half drawn.
  let restLink = null;
  const restStyle = () => (restLink ??= new Promise((ok) => {
    const link = el('link', { rel: 'stylesheet', href: document.querySelector('script[src^="app.js"]')?.dataset.css ?? 'app.css' });
    const done = () => { document.getElementById('first')?.remove(); ok(); };
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
    document.head.append(link);
  }));
  /** Two frames after the first screen has drawn, the rest of the styles start: the browser paints the board before it reads another file. */
  const restSoon = () => requestAnimationFrame(() => requestAnimationFrame(() => restStyle()));
  const restStyled = () => restStyle();
  const loadMore = () => (moreLoad ??= restStyled().then(() => new Promise((ok) => {
    const src = document.querySelector('script[src^="app.js"]')?.dataset.more ?? 'app-more.js';
    const s = el('script', { src });
    s.addEventListener('load', () => {
      moreReady = true;
      // A screen or a card that found its file missing draws now, in one redraw of the board: the screen the person went to, or the card they opened,
      // which render reads again from the top so its body fills where the small file left only the frame. One redraw, whatever asked first.
      if (moreAsked) renderKeepingFocus();
      ok(true);
    }, { once: true });
    s.addEventListener('error', () => ok(false), { once: true });
    document.head.append(s);
  })));
  /** A screen app-more.js holds, asked for before it lands: the file loads, and the screen draws as it does. */
  const waitMore = () => { moreAsked = true; return loadMore(); };
  // The full-size and media views are taps of their own, not screens: a tap that lands before app-more.js arrives is finished when it does.
  function openFull(...args) { waitMore().then((ok) => ok && globalThis.openFull(...args)); }
  function openMediaViewer(...args) { waitMore().then((ok) => ok && globalThis.openMediaViewer(...args)); }
  function renderKeepingFocus() {
    const typing = (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.id === 'find') && document.activeElement;
    const start = typing && typing.selectionStart, end = typing && typing.selectionEnd, direction = typing && typing.selectionDirection;
    // A part of the board arriving redraws the list around its row: the row the person is on keeps the focus, as it does across a poll.
    const onRow = !typing && document.activeElement?.closest?.('.dl-row[data-key]')?.dataset.key;
    // A part of the board arriving redraws the report the person is reading too: the place they had scrolled to is kept, as the row they are on keeps
    // the focus, so a poll never sends a reader back to the top of what they were reading.
    const open = document.getElementById('reader');
    const places = open && !open.hidden ? [...open.querySelectorAll('.gd-scroll')].map((s) => s.scrollTop) : null;
    render();
    if (places?.length) {
      const now = document.getElementById('reader');
      if (now && !now.hidden) [...now.querySelectorAll('.gd-scroll')].forEach((s, i) => { if (places[i]) s.scrollTop = places[i]; });
    }
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
  // A read in flight says so: a hairline that sweeps along the page's top edge while the board is being read, gone when what it read is on screen.
  // It is fixed to the edge and 2 px tall, so it never moves the list or the control under a thumb.
  const net = document.getElementById('net');
  const busy = (on) => { if (net) net.hidden = !on; };

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
        mockCards(d, ro ? [] : buttons), demoRow(d), fullButton(d), annotations(d), silent ? el('p', { class: 'silent' }, silent) : '', ro ? '' : other(d, saved, err), err);
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
      : el('a', { class: 'open-link', href: d.link, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open sign-in, ${d.title}` }, 'Open');
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
      : el('button', { class: 'open-link', 'aria-label': `Open sign-in, ${d.title}` }, 'Open');
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
    fold.addEventListener('toggle', () => (fold.open ? unfolded.add(d.key) : unfolded.delete(d.key)));
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
      (node.tagName === 'A' ? node.querySelector('img') : node).addEventListener('error', () => node.replaceWith(el('p', { class: 'gone' }, `${name} can't be shown: the file is missing, changed since it was posted, or in a format this browser can't play.`)));
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
    img.addEventListener('error', () => row.parentElement?.remove());
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
  const threadOf = (d, all = false) => {
    const a = state.answers[d.key], by = d.by ?? 'Agent', change = changeHref(d);
    const said = (x) => (x.answer === 'text' ? 'in your own words' : x.label);
    // A design's answer on an earlier round with its notes, each named by its screen when the design has more than one: one note's screen goes in the step.
    const screens = (d.journeys ?? []).flatMap((j) => j.screens.map((s) => ({ j: j.id, s: s.id, title: s.title }))), was = d.earlier, wrote = was?.notes.filter((n) => n.note) ?? [];
    const on = (n) => (screens.length > 1 && n.journey ? screens.find((x) => x.j === n.journey && x.s === n.screen)?.title : '');
    return [d.filed && { at: d.filed, text: `Posted by ${by}`, link: change && [changeName(change), change], posted: true },
      was && { at: was.at, text: `Your answer on the earlier round: ${was.label}${wrote.length === 1 && on(wrote[0]) ? ` (${on(wrote[0])})` : ''}`,
        note: wrote.length === 1 ? wrote[0].note : wrote.map((n) => (on(n) ? `${on(n)}: ${n.note}` : n.note)).join(' · ') },
      a?.replaces?.at && { at: a.replaces.at, text: `Your answer: ${said(a.replaces)}`, note: a.replaces.note },
      ...(moreReady ? reopenSteps(d, by, said) : []),
      a && !d.earlier_answer && { at: a.at, text: `${a.replaces ? 'Changed to' : takenOf(a) === 'default' ? 'Taken by default' : takenOf(a) ? `${by} picked` : 'Your answer'}: ${said(a)}`,
        note: takenOf(a) === 'default' ? 'No answer by its deadline' : takenOf(a) ? d.recommend_reason : a.note || a.notes?.map((n) => n.note).filter(Boolean).join(' · ') },
      ...trailOf(d.key).flatMap((t) => [t.delivered && { at: t.delivered, text: `Delivered to ${by}` }, t.read && { at: t.read, text: `${by} read it` },
        all && t.reply && (!t.reply.acted || d.type === 'signin') && { at: t.reply.at, text: `${by} ${t.reply.text ? 'replied' : t.reply.acted ? 'posted a new link' : 'acted on it'}`, note: t.reply.text, link: t.reply.link && [linkName(t.reply.link), t.reply.link] }]),
      ...(state.rounds ?? []).filter((r) => r.key === d.key).map((r) => ({ at: r.at, text: 'You asked for a new round', note: r.note })),
      ...trailOf(d.key, 'discard').map((t) => ({ at: t.at, text: `Discarded: ${reasonOf(t.reason)}` })),
      ...(state.comments ?? []).filter((c) => c.key === d.key && c.text).map((c) => ({ at: c.at, text: 'Your comment', note: c.text })),
      ...(all ? (state.messages ?? []).filter((m) => m.kind === 'comment' && m.key === d.key) : []).map((m) => ({ at: m.at, text: 'Your comment', note: m.text }))]
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
  // A card read again brings its trail as it is now beside the earlier read of it, so a send is taken once by its id, the latest.
  const trailOf = (key, kind) => [...new Map((state.trail ?? []).map((t) => [t.id, t])).values()].filter((t) => t.key === key && (kind ? t.kind === kind : t.kind !== 'ticket')).sort(bySecond);
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
    // Replies counts the whole board — a reply can sit on a card no page has reached yet — so the section waits for the board's pages and counts them
    // once, rather than showing one reply and then two a moment later.
    if (!paged && !wholeBoard) return '';
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
    const label = [title, prio(d), judgedWord(d), meta].filter(Boolean).join(', ');
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
  function proofPane(d) {
    const project = projectOf(d), said = plain((d.about ?? '').replace(HELD, '').replace(UNCONFIRMED, '')), name = plain(headline(d)), why = plain(unchecked(d));
    return el('section', { class: 'ui-card ui-pane two s8 split-detail', 'aria-labelledby': 'reader-title' },
      el('div', { class: 'ui-shd split-bar' }, projectTile(project), el('span', { class: 'pt', dir: 'auto' }, [project || 'No project', d.filed && (isToday(d.filed) ? hhmm(d.filed) : stamp(d.filed))].filter(Boolean).join(' · '))),
      el('div', { class: 'pmain' }, el('h1', { class: `dt ev-title${name.length > 160 ? ' long' : ''}`, id: 'reader-title', tabindex: '-1', dir: 'auto' }, name),
        captures(d, 'ev-hero pv-cap') || el('div', { class: 'ev-hero none' }, evGlyph('image'), (d.status ? 'Frame pending' : 'Text only: no capture was filed')), attachments(d)),
      el('div', { class: 'pside' }, evProps(d), said && said !== name ? el('p', { class: 'dp ev-about', dir: 'auto' }, said) : '', why ? el('p', { class: 'dp ev-why', dir: 'auto' }, why) : '',
        state.readonly || FROZEN || !(d.options.length || d.reply) ? '' : verdicts(d), ...sentPairs(d), thread(d)));
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

  /** A preview frame that cannot load is never left as a blank box: its file is read once, and one that is gone or empty is replaced by a plain line and logged as a console error,
   *  which the page's error record (and a proof's console_errors) carries. */
  function guardFrame(frame, label) {
    const url = frame.getAttribute('src');
    if (FROZEN || !url) return frame;
    fetch(url).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); if (!(await r.text()).trim()) throw new Error('the file is empty'); })
      .catch((e) => { console.error(`Preview of ${label} could not be shown (${url.split('?')[0]}): ${e.message}`); frame.replaceWith(el('p', { class: 'gone' }, 'This preview could not be shown: its file is missing or empty.')); });
    return frame;
  }
  /** A mock or view is served from inside its own folder, so the files beside it load by their relative names. */
  const mockUrl = (key, value, path) => `${state.mockBase}${key}~${value}/${encodeURIComponent(path.split('?')[0].split('/').pop())}`;
  /** A mock is a prototype when it is a page that can be tapped, not a picture of one. */
  const prototype = (m) => !!m && /\.html?$/i.test(m.path.split('?')[0]);
  /** One place decides where a live link goes: that option's own prototype page, this card's key and this option's value, with the variant its mock reads.
   *  Never the option's `--link`, which is a reference beside it (see `mockCards` and `fullPages`). */
  const liveUrl = (d, m) => { const [path, query] = m.path.split('?'); return src(mockUrl(d.key, m.value, path) + (query ? `?${query}` : '')); };
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
      img.addEventListener('error', () => body.replaceWith(el('p', { class: 'gone' }, "The diagram can't be shown: its file is missing or in a format this browser can't draw.")));
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

  /** An option's demo recording and its round score (post --video and --score). The address names the file's hash, so the browser keeps it. */
  const demoOf = (d, value) => {
    const v = d.mocks?.find((x) => x.value === value)?.video;
    return v && { score: v.score, url: src(`/api/media?key=${encodeURIComponent(d.key)}&video=${encodeURIComponent(value)}${FROZEN ? '' : `&h=${v.sha256.slice(0, 16)}`}`) };
  };
  /** The first frame of a recording: the browser draws it from the file itself when asked to start a hair in. */
  const still = (url) => `${url}#t=0.001`;
  // The demo's card and full screen are app-more.js's: until it loads a card draws no demos.
  function demoRow() { return ''; }

  /** One phone frame per option, the recommended one first: its label and Recommended badge, the mock (tap opens it full size) and its Pick button. */
  function mockCards(d, buttons) {
    const rec = (i) => d.options[i].value === d.recommend_value, order = d.options.map((_, i) => i).sort((a, b) => rec(b) - rec(a));
    return el('div', { class: 'mocks', role: 'group', 'aria-label': d.title }, ...order.map((i) => {
      const o = d.options[i], m = d.mocks?.find((x) => x.value === o.value);
      const url = m && liveUrl(d, m), live = !!(m && prototype(m) && m.hash !== null && !FROZEN);
      const view = m && (prototype(m) ? guardFrame(el('iframe', { src: url, title: `Mock ${o.label}`, sandbox: 'allow-scripts', tabindex: '-1', 'aria-hidden': 'true', loading: 'lazy', 'data-mock': `${d.key}~${m.value}` }), `option ${o.label}`)
        : el('img', { src: url, alt: `Mock: ${o.label}` }));
      return el('figure', { class: 'mock' },
        el('figcaption', {}, el('span', { class: 'label', dir: 'auto' }, o.label), rec(i) ? el('span', { class: 'badge' }, 'Recommended') : ''),
        // A mock file that is gone has a null hash: the option says so in place of an empty frame.
        m && m.hash !== null ? fullShot(d, m.value, el('a', { class: 'shot', href: url, target: '_blank', rel: 'noopener', 'aria-label': `Open mock ${o.label} full screen` }, view))
          : el('p', { class: 'shot none' }, 'No mock for this option'),
        // The links sit on the card, where a tap opens a tab: a link inside the sandboxed frame cannot. Open live is that option's own prototype,
        // from liveUrl; its --link is the reference beside it and is drawn as one, never as the live prototype.
        live || m?.link ? el('div', { class: 'under' }, el('p', { class: 'live-links' },
          live ? el('a', { class: 'option-link', href: url, target: '_blank', rel: 'noopener', 'data-live': `${d.key}~${m.value}`, 'aria-label': `Open ${o.label} live, its own prototype full size` }, 'Open live') : '',
          m?.link ? el('a', { class: 'option-link ref-link', href: m.link, target: '_blank', rel: 'noopener', 'aria-label': `Open the reference for ${o.label}` }, 'Reference') : ''), buttons[i] ?? '') : buttons[i] ?? '');
    }));
  }

  /** Open full screen: a design's mocks or an interactive page over the whole viewport, in the same sandboxed frame, which here takes every tap, so the prototype's own links and buttons work.
   *  Its bar holds the way back, the option shown, Phone (390) or Desktop (1280) framed and centred, and Reference: another option's mock beside it, or over it where the two do not fit side by side. */
  const SIZES = { phone: VIEWPORTS.phone, desktop: VIEWPORTS.computer };
  let fullSize, fullFit = false, protoFull;
  const fullPages = (d) => d.view ? [{ value: '', label: d.title, page: true, url: src(mockUrl(d.key, '', d.view)) }]
    : [...d.options].sort((a, b) => (b.value === d.recommend_value) - (a.value === d.recommend_value)).map((o) => {
      const m = d.mocks?.find((x) => x.value === o.value);
      return m && m.hash !== null && { value: m.value, label: o.label, page: prototype(m), url: liveUrl(d, m) };
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
  const editing = new Map(), talks = () => !state.readonly && !state.answers_only && !FROZEN;
  // Words typed for an element and not saved yet, kept in page memory (not across a reload) so tapping another element or another Edit loses nothing.
  const unsaved = new Map(), spot = (key, a) => `${key}~${a.mock}~${a.ref}`;
  // Sent with an answer or round: the card's editor closes and its unsaved words go.
  const forget = (key) => { editing.delete(key); for (const k of unsaved.keys()) if (k.startsWith(`${key}~`)) unsaved.delete(k); };
  const redraw = (d) => document.querySelectorAll('.ann').forEach((n) => n.dataset.ann === d.key && n.replaceWith(annotations(d)));
  const AREAS = { waiting: 'Waiting on you', designs: 'Designs', evidence: 'Evidence', reports: 'Reports and explainers', answered: 'Answered' };
  // The tab bar holds six places: Today, Inbox, Decide (what waits on you, a design Main promoted too), Evidence, Reports and Tickets.
  // The sidebar holds those and Designs, after Reports, as the approved prototype's desk draws it. Designs and Answered are not tabs: both are links on Today's More.
  const TABS = [['', 'Today'], ['inbox', 'Inbox'], ['waiting', 'Decide'], ['evidence', 'Evidence'], ['reports', 'Reports'], ['tickets', 'Tickets']];
  const SIDE = [...TABS.slice(0, 5), ['designs', 'Designs'], TABS[5], ['channels', 'Channels']];
  const EMPTY = { waiting: 'Nothing is waiting on you.', designs: 'No designs yet.', evidence: 'No evidence updates.', reports: 'No reports or explainers.', answered: 'Nothing answered yet.' };
  const ICONS = { 'tab-channels': 'M3 3h14v12H8l-5 4V3zm16 5h3v14l-5-4h-6v-1h8V8z', designs: 'M3 3h18v18H3zM3 9h18M9 21V9',
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
    'tab-inbox': 'M5.4 3.6h13.2l2.4 8.4v7.2a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 19.2V12zM5.4 12v5.4h13.2V12h-4.2a2.4 2.4 0 0 1-4.8 0z',
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
    el('span', { class: 'l1' }, el('span', { class: 't', dir: 'auto' }, title), ' ', after, progress === undefined ? '' : badge, ' ', priority ? el('span', { class: `ui-pc ${priority.toLowerCase()}` }, priority) : ''), ' ',
    progress === undefined ? (badge ? el('span', { class: 'l2' }, el('span', { class: 'meta', dir: 'auto' }, meta), badge) : el('span', { class: 'l2 meta', dir: 'auto' }, meta)) : el('span', { class: 'l2' }, lead, bar ?? el('span', { class: 'ui-bar' }, el('i', { style: `width: ${progress}%` })), el('span', { class: 'pct' }, `${progress}%`)))];
  /** The property panel (ui.css): one sunk group whose rows are each a mark and a name at the left and a value at the right; a row with an address opens it.
   *  A panel with no row is left out, as a card with no priority, ticket or change shows nothing more. */
  const uiProps = (...rows) => ((rows = rows.filter(Boolean)).length ? el('div', { class: 'ui-props' }, ...rows) : '');
  const uiProp = ({ mark, name, value, href, label, cls = '' }) => el(href ? 'a' : 'div', { class: `ui-pr ${cls}`.trim(), ...(href && { href, ...(/^https?:/.test(href) && { target: '_blank', rel: 'noopener' }) }),
    ...(label && { 'aria-label': label }) }, el('span', { class: 'k' }, glyph(mark), name), ' ', el('span', { class: 'v' }, ...[value].flat()));
  /** A card's priority as its chip, only where one is set. */
  const priorityProp = (p) => p && uiProp({ mark: 'flag', name: 'Priority', value: el('span', { class: `ui-pc ${p.toLowerCase()}` }, p) });
  /** The ticket a card belongs to: its title in full, then a bar with its percent once work on it has begun (full at 100%). The row opens the ticket's page. */
  const ticketProp = (t, name = 'Ticket') => t && uiProp({ mark: 'layers', name, cls: 'tall', href: `#ticket/${t.id}`, label: `${name}: ${t.title}, ${t.progress}% done`,
    value: [el('span', { class: 'wt', dir: 'auto' }, t.title), ' ', el('span', { class: 'bp' }, ...(t.progress > 0 ? [el('span', { class: 'ui-bar', 'aria-hidden': 'true' }, el('i', { style: `width: ${t.progress}%` })),
      el('span', { class: 'n' }, `${t.progress}%`)] : [el('span', { class: 'n' }, 'Not started')]))] });
  /** The change a card links: a pull request by its number, any other link by the site it opens. */
  const changeProp = (d) => { const c = changeHref(d), pr = /\/(?:pull|pulls|merge_requests)\/(\d+)/.exec(c)?.[1];
    return c && uiProp({ mark: 'pr', name: pr ? 'Pull request' : 'Change', href: c, label: `${pr ? 'Pull request' : 'Change'} ${pr ? `#${pr}` : new URL(c).host}, ${headline(d)}`, value: el('span', {}, pr ? `#${pr}` : new URL(c).host) }); };
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
  /** An answer whose agent reply asks for a next step (it carries follow-up buttons) is not final: the card stays in Decide until the person taps one. */
  const exchanging = (d) => !!trailOf(d.key, 'answer').at(-1)?.reply?.options?.length;
  const isAnswered = (d) => Object.hasOwn(state.answers, d.key) && !(d.type === 'design' && state.answers[d.key].answer === 'screens') && !exchanging(d);
  /** A design review a lead posts is Main's to pass first: it lives under Designs, never in Decide, Answered or any count of asks, until Main promotes it (sign-off-axi promote). */
  const promoted = (d) => (state.promoted ?? []).includes(d.key);
  /** A design pick: a choice between mocks (post --type design). It waits in Decide to be answered, and Designs lists it as well, answered or not, so it can be found again. */
  const isPick = (d) => d.type === 'design' && d.kind !== 'design';
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
  /** A design pick with a demo shows the recording's own first frame as its row media, the recommended option's first, in place of a picture sheet. */
  const demoThumb = (d) => {
    if (!isPick(d) || !d.mocks?.some((m) => m.video)) return;
    const o = [...d.options].sort((a, b) => (b.value === d.recommend_value) - (a.value === d.recommend_value)).find((x) => demoOf(d, x.value));
    const v = o && el('video', { class: 'design-thumb', src: still(demoOf(d, o.value).url), muted: '', playsinline: '', preload: 'metadata', 'aria-hidden': 'true', tabindex: '-1' });
    if (v) v.muted = true;
    return v;
  };
  const thumb = (a, url) => { if (!url) return icon(a); const img = el('img', { class: 'thumb', src: src(url), alt: '', loading: 'lazy', decoding: 'async' }); img.addEventListener('error', () => img.replaceWith(icon(a))); return img; };

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
  /** A design's group is what its filer typed: a project's name, or sometimes a raw key (fd-wrapper-design). A name no project has that reads as a key is not shown as one. */
  const plainGroup = (d) => { const g = d.group; if (!g) return g; const known = (state.projects ?? []).find((p) => p.name.toLowerCase() === g.toLowerCase()); return known ? known.name : /^[\w.]+([-_.][\w.]+)+$/.test(g) && !/\s/.test(g) && g === g.toLowerCase() ? '' : g; };
  const projectName = (d) => d.project || ((d.kind === 'design' || d.type === 'design') ? plainGroup(d) : d.group) || (d.type === 'evidence' ? projectOf(d) : d.proof && projectOf(state.decisions.find((x) => x.key === d.proof) ?? {}))
    || (ticketOf(d) && tkProject(ticketOf(d))) || (d.by && (state.projects ?? []).find((p) => p.name.toLowerCase() === d.by.toLowerCase())?.name) || undefined;
  /** One project picture and tile for every list; use the pinned record, with a neutral project icon when the project has none. */
  function projectPic(name, fallback = () => glyph('layers')) {
    const p = name && (state.projects ?? []).find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!p?.icon) return fallback();
    const img = el('img', { src: `/api/project-icon?name=${encodeURIComponent(p.name)}&h=${p.icon.sha256.slice(0, 16)}`, alt: '' });
    img.addEventListener('error', () => img.replaceWith(fallback()));
    return img;
  }
  const projectTile = (name, fallback) => el('span', { class: 'ui-icon', role: 'img', 'aria-label': name || 'No project' }, projectPic(name, fallback));
  /** The board's own identity, which a design card with no project of its own wears: its name and app icon, never an empty tile. */
  const boardPic = () => el('img', { src: '/icon.svg', alt: '' });
  const cardTile = (d) => {
    const design = d.kind === 'design' || d.type === 'design', tile = design && !projectName(d) ? projectTile('Sign-off', boardPic) : projectTile(projectName(d), () => design ? boardPic() : d.type === 'plan' ? icon('plan') : d.kind === 'report' || d.type === 'explainer' ? glyph('layers') : icon(d.type === 'evidence' ? 'evidence' : d.reply ? 'reply' : 'yesno'));
    const frame = design && designFrame(d), demo = isPick(d) && demoThumb(d);
    if (demo) tile.replaceChildren(demo);
    else if (frame) { const img = el('img', { class: 'design-thumb', src: src(designUrl(d, frame)), alt: '' }); img.addEventListener('error', () => img.replaceWith(projectPic(projectName(d), boardPic))); tile.replaceChildren(img); }
    return tile;
  };
  /** A card as the new look's row, a link to where it opens: its tile, its title and priority, then its ticket's progress once it has some (a full bar when done), or else its project (or what it is) and when. */
  const progressOf = (n) => (n > 0 ? Math.min(n, 100) : undefined);
  function cardRow(d) {
    const t = ticketOf(d), what = projectName(d) ?? (area(d) === 'waiting' ? kind(d) : NAMES[d.type] ?? 'Report'), shown = d.type === 'signin' ? `Sign in to ${d.title}` : d.type === 'evidence' ? headline(d) : title(d);
    // The name leads with the words the row shows (title, priority, percent), then says what the percent is of.
    const link = el('a', { class: 'ui-row', href: hrefOf(d), ...(t?.progress > 0 && { 'aria-label': `${shown}${d.priority ? ` ${d.priority}` : ''} ${t.progress}% done, ticket ${t.title}` }) }, ...uiRow({ tile: cardTile(d), title: shown, priority: d.priority, badge: trailBadge(d.key),
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
    const stat = (href, mark, lab, n, of) => el('a', { class: 'ui-card ui-stat', href, 'aria-label': `${lab}: ${n}${of === undefined ? '' : ` of ${of}`}` }, fill(mark), el('span', { class: 'lab' }, lab), ' ', el('b', {}, String(n), of === undefined ? '' : el('small', {}, ` of ${of}`)));
    return el('div', { class: 'ui-tiles t-tiles' }, stat('#answered', 'M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm3.4 5.1-4.3 4.4-2-2-1.2 1.2 3.2 3.2 5.5-5.6z', 'Cleared today', cleared, cleared + by.asks.length),
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
    const go = (href, name, n) => el('a', { class: 'ui-pr', href }, el('span', { class: 'k' }, name), el('span', { class: 'v' }, n === undefined ? '' : el('span', { class: 'n' }, String(n)), glyph('right')));
    const links = [['#answered', 'Answered', by.answered], ['#designs', 'Designs', by.designs], ['#channels', 'Channels', []]].filter(([h, , l]) => h === '#channels' || l.length);
    todayMore.replaceChildren(el('div', {}, sheetHead('t-more', 'More'), links.length ? el('div', { class: 'ui-props' }, ...links.map(([h, name, l]) => go(h, name, h === '#channels' ? undefined : l.length))) : '',
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
        : [typeof emptyState === 'function' ? emptyState('empty', { mark: 'list', title: `Nothing matches “${query.trim()}”`, text: 'Try another word, or a shorter one.', small: true }) : el('p', { class: 't-grp' }, `Nothing matches “${query.trim()}”.`)]));
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
  const TK_MARKS = { chip: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/>', flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>', half: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
    layers: '<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 21h10a2 2 0 0 0 2-2V9"/>', clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/>' };
  const tkMark = (a) => { const s = el('span', { class: 'tk-k', 'aria-hidden': 'true' }); s.innerHTML = `<svg viewBox="0 0 24 24">${TK_MARKS[a]}</svg>`; return s; };
  let tkWhose = '', tkProj = '', tkShown = '';
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
  /** A mark from web/logos, drawn as a mask in the text colour. */
  const logoMark = (src, name) => el('span', { class: 'tk-logo', role: 'img', 'aria-label': name, style: `--logo: url("${/^\/logos\/[\w-]+\.svg$/.test(src ?? '') ? src : '/logos/generic.svg'}")` });
  /** Who works on a ticket: model and tool marks, model, lead and Live. */
  function tkWho(t) {
    const a = t.assignee;
    if (!a) return el('span', { class: 'tk-as none' }, 'Unassigned');
    return el('span', { class: `tk-as${a.live ? ' live' : ''}` }, a.model ? logoMark(a.model_logo, a.model) : '', a.tool ? logoMark(a.tool_logo, a.tool) : '', el('span', { class: 'tk-aw', dir: 'auto' }, [a.model ?? a.tool, a.lead].filter(Boolean).join(' · ')),
      a.live ? el('span', { class: 'tk-live' }, el('i', { 'aria-hidden': 'true' }), 'Live') : '');
  }
  /** A ticket's row: its tile, its title and priority, then a bar with its percent once it has progress (a full bar when done), or else where it stands and when it last moved,
   * with how many of what sits under it are done. On a desk the open ticket is marked. */
  function tkRow(t) {
    const kids = tkUnder(t), done = kids.filter((x) => tkStateOf(x) === 'done').length, s = tkStateOf(t), progress = t.stage && !kids.length ? t.progress : progressOf(t.progress);
    const meta = [TK_WORDS[s], kids.length ? `${done} of ${plural(kids.length, tkKids(kids[0]))} done` : tkWhen(t.at)].join(' · ');
    // The name leads with the words the row shows (title, priority, release, then the percent or the line), as the label rule reads them in that order.
    const link = el('a', { class: 'ui-row tk-row', href: `#ticket/${t.id}`, ...(t.id === tkShown && { 'aria-current': 'true' }), 'aria-label': `${[t.title, t.priority, t.release].filter(Boolean).join(' ')}, ${progress === undefined ? meta : `${progress}% done, ${TK_WORDS[s].toLowerCase()}`}, ${t.assignee ? [t.assignee.model ?? t.assignee.tool, t.assignee.lead, t.assignee.live && 'live'].filter(Boolean).join(' ') : 'unassigned'}` },
      ...uiRow({ tile: tkTile(t), title: t.title, priority: t.priority, progress, lead: el('span', { class: 'tk-status' }, ...tkStatus(t)), meta }));
    if (t.release) link.querySelector('.l1').append(el('span', { class: 'ui-pc tk-release', title: t.release }, t.release));
    link.querySelector('.rm').append(tkWho(t));
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
    return el('section', { class: 'ui-card ui-hero tk-hero' }, el('div', { class: 'hl' }, el('span', { class: 'lab' }, 'Tickets done'), week ? el('span', { class: 'chip' }, el('i', { class: 'up', 'aria-hidden': 'true' }), `${week} this week`) : ''),
      el('div', { class: 'hv' }, el('span', { class: 'big' }, String(L.done.length), el('small', {}, ` of ${L.shown.length}`)), L.moving.length ? el('span', { class: 'vs' }, el('i', { 'aria-hidden': 'true' }), `${L.moving.length} moving`) : ''), tkDots(L));
  }
  /** The two tabs at the top of Tickets: every ticket, and Activity, the timeline of what moved on them. */
  function tkTabs(on) {
    const b = (v, name) => { const x = el('button', { type: 'button', 'aria-pressed': String(on === v) }, name); x.onclick = () => { if (on !== v) buzz('tick'), location.hash = `#${v}`; }; return x; };
    return el('div', { class: 'ui-seg tk-seg', role: 'group', 'aria-label': 'Tickets view' }, b('tickets', 'All tickets'), b('activity', 'Activity'));
  }
  /** Who asked for a ticket: the ones the board's owner asked for, and the fleet's own upkeep. */
  const TK_WHO = { asks: 'From you', system: 'Fleet upkeep' };
  /** The filter: a round button in the header (marked while one is picked) that opens a sheet of who asked (while the board has both) and of the projects with tickets, each with Every one. */
  const tkFilterSheet = sheetOf('tk-filter');
  function tkFilter(L) {
    const names = [...new Set(L.ofKind.map(tkProject).filter(Boolean))].sort((x, y) => x.localeCompare(y));
    if (!names.length && !L.both) return '';
    const b = el('button', { class: `ui-rb tk-rb${tkProj || L.kind ? ' on' : ''}`, 'aria-label': tkProj || L.kind ? `Filter tickets: ${[TK_WHO[L.kind], tkProj].filter(Boolean).join(', ')}` : 'Filter tickets', 'aria-haspopup': 'dialog' });
    b.innerHTML = '<svg class="glyph" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 6h13M6 10h8M8.5 14h3"/></svg>';
    b.onclick = () => {
      const pick = (name, n, tile) => { const x = el('button', { class: 'ui-pr tk-pick', ...(tkProj === name && { 'aria-current': 'true' }) }, el('span', { class: 'k' }, tile, name || 'Every project'), el('span', { class: 'v' }, el('span', { class: 'n' }, String(n)), tkProj === name ? glyph('check') : ''));
        x.onclick = () => { tkProj = name; tkFilterSheet.close(); render(); }; return x; };
      const who = (v, n) => { const x = el('button', { class: 'ui-pr tk-pick', ...(L.kind === v && { 'aria-current': 'true' }) }, el('span', { class: 'k' }, TK_WHO[v] ?? 'Everyone'), el('span', { class: 'v' }, el('span', { class: 'n' }, String(n)), L.kind === v ? glyph('check') : ''));
        x.onclick = () => { tkWhose = v; tkProj = ''; tkFilterSheet.close(); render(); }; return x; };
      tkFilterSheet.replaceChildren(el('div', {}, sheetHead('tk-filter', 'Filter tickets'),
        ...(L.both ? [el('p', { class: 'ui-dl' }, 'Who asked'), el('div', { class: 'ui-props' }, who('', L.roots.length), who('asks', L.asked), who('system', L.roots.length - L.asked))] : []),
        ...(names.length ? [el('p', { class: 'ui-dl' }, 'Project'), el('div', { class: 'ui-props' }, pick('', L.ofKind.length, ''),
          ...names.map((p) => pick(p, L.ofKind.filter((t) => tkProject(t) === p).length, el('span', { class: 'tk-pt', 'aria-hidden': 'true' }, projectPic(p)))))] : [])));
      tkFilterSheet.showModal();
      tkFilterSheet.querySelector('h2').focus();
    };
    return b;
  }
  /** One list of tickets under its head: on a phone the first three with See all, on a desk a card whose rows scroll inside it. */
  function tkGroup(key, name, list, desk, cls = '') {
    if (desk) return el('section', { class: `ui-card tk-card ${cls}`, 'aria-label': name }, el('h2', { class: 'tk-ch' }, name, el('small', {}, String(list.length))),
      list.length ? el('ul', { class: 'ui-list tk-rows' }, ...list.map(tkRow)) : emptyState('empty', { mark: 'list', title: `Nothing ${name.toLowerCase()}`, small: true }));
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
  function tkSettle() {
    if (phone()) return;
    for (const l of document.querySelectorAll('.tk-card .tk-rows')) {
      l.classList.remove('fades', 'at-end'); l.style.height = l.style.flex = l.style.paddingBottom = '';
      if (l.scrollHeight <= l.clientHeight + 1) continue;
      const top = l.getBoundingClientRect().top + l.clientTop, h = l.clientHeight, ends = [...l.children].map((r) => r.getBoundingClientRect().bottom - top);
      const last = ends.filter((b) => b <= h + 0.5).at(-1) ?? 0, room = h - last;
      if (room < 40) { l.style.flex = 'none'; l.style.height = `${last}px`; continue; }
      l.style.setProperty('--fz', `${room}px`); l.style.paddingBottom = `${room}px`; l.classList.add('fades');
      l.addEventListener('scroll', () => l.classList.toggle('at-end', l.scrollTop + l.clientHeight >= l.scrollHeight - 2));
    }
  }
  addEventListener('resize', () => document.querySelector('.tk-desk') && tkSettle());
  /** On a desk a list's column and the open item scroll inside themselves; while one holds more than it shows it fades out over its last 64px, and the fade goes at its end. */
  // What is in them can grow after they are drawn (a report's page loads), so each is looked at again when a part of it changes size.
  const settled = 'ResizeObserver' in window && new ResizeObserver(() => uiSettle());
  function uiSettle() {
    for (const a of document.querySelectorAll('.ui-desk :is(.ui-col, .ui-pane:not(.ask2), .ask2 > .pbody)')) {
      const atEnd = () => a.classList.toggle('at-end', a.scrollTop + a.clientHeight >= a.scrollHeight - 2);
      a.addEventListener('scroll', atEnd);
      a.classList.toggle('fades', a.scrollHeight > a.clientHeight + 1); atEnd();
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
  /** Today keeps More current and opens Search at #find. */
  function today(by) {
    const queue = [...by.asks].sort((x, y) => lead(x) - lead(y)), up = upNext(queue), rest = waitingOn(queue.slice(1)), tiles = todayTiles(by), more = moreLine(by), replies = repliesOn();
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
      box.addEventListener('toggle', () => (box.open ? opened.add(d.key) : opened.delete(d.key)));
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
  const reportsSheet = sheetOf('rp-more');
  function notes(items) {
    if (!items.length) return '';
    const box = el('details', { class: 'other notes', ...(opened.has('#notes') && { open: '' }) }, el('summary', {}, `Notes (${items.length})`),
      el('p', { class: 'meta' }, 'Receipts and status notes: short text, with no page to open.'),
      el('ul', { class: 'card rows' }, ...items.map((d) => {
        const line = el('details', { class: 'done', ...(opened.has(d.key) && { open: '' }) }, el('summary', { class: 'compact' }, ...compact(d, 'reports')), row(d, { x: false }));
        line.addEventListener('toggle', () => (line.open ? opened.add(d.key) : opened.delete(d.key)));
        return el('li', {}, line, xBtn(d));
      })));
    box.addEventListener('toggle', () => (box.open ? opened.add('#notes') : opened.delete('#notes')));
    return box;
  }

  /** Plan answers stay on the trusted board, never in the agent's sandboxed page. Drafts survive refresh until the server saves them. */
  let designSession, boardStale = false;
  addEventListener('message', (e) => {
    const viewer = document.querySelector('.design-viewer[open]');
    if (viewer && e.source === viewer.querySelector('iframe')?.contentWindow && e.data?.['sign-off'] === 'viewer-nav') viewer.dispatchEvent(new KeyboardEvent('keydown', { key: e.data.key }));
  });
  /** A design's review. On a phone (in the reader) one column: its project and day, the whole title, what it shows, the screen, Review full screen, where it stands and what you said,
   *  then the note with Approve in ink beside Change. On a desk two cards: the open design (its picture filling the card) and Where it stands, the note in it and its buttons pinned at its foot.
   *  A design asked as one plain question (design 2, which names the frame Yes approves) shows each screen's frames side by side instead, the changed area outlined on each and named
   *  under it, and is answered once: Yes with an optional note, or Change with what to change. */
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
    // A card's body comes from app-more.js: a card opened before it lands opens, whole, when it does.
    if (d && !moreReady) return void waitMore();
    // A design or a report takes the board's place beside the sidebar on a desk; a plan, and anything on a phone, opens over the whole board.
    const desk = matchMedia('(min-width: 64rem)').matches, beside = !!d && desk && from.startsWith('inbox/'), pane = beside || (!!d && d.type !== 'plan' && !d.guided), inline = pane && desk;
    document.body.classList.toggle('reading', !!d && !beside);
    document.body.classList.toggle('pane-reading', pane);
    document.body.classList.toggle('thread-beside', beside);
    reader.setAttribute('role', inline ? 'region' : 'dialog');
    if (inline) reader.removeAttribute('aria-modal'); else reader.setAttribute('aria-modal', 'true');
    document.querySelector('main').inert = !!d && !beside;
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
    if ((from === 'reports' || from.startsWith('inbox/')) && unread(d) && !state.readonly && !FROZEN) setTimeout(() => markRead([d.key], true));
    const back = el('a', { class: 'close', href: `#${from}` }, `‹ ${from.startsWith('reports') ? 'Reports' : from.startsWith('inbox/') ? `Thread${trailOf(d.key).some(unseen) ? ` · ${trailOf(d.key).filter(unseen).length} new` : ''}` : AREAS[from]}`), h1 = el('h1', { id: 'reader-title', tabindex: '-1', dir: 'auto' }, sheet ? plain(d.title) : d.title);
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
  const designStatus = (d) => { const a = state.answers[d.key]?.answer; if (isPick(d)) return a && a !== 'screens' ? 'Picked' : 'Waiting on you'; return a === 'approve' ? 'Approved' : a === 'change' ? 'Changes requested' : d.status === 'draft' ? 'Draft' : 'In review'; };
  const dzSheet = sheetOf('dz-sheet');
  /** The title row: the title with More (Select, Discard all and, on a desk, Archived) and the round light-or-dark button; on a desk where it is over a 32px title and what is on the board.
   *  While selecting, the title counts the picks with Select all, and Cancel and Discard N sit where the dock is (phone) or at the row's right (desk). */
  function designGroups(items, top, key, gone = []) {
    const head = designsHead(items, top, gone);
    if (!items.length) return phone() ? [...head, screenEmpty('designs'), archived(gone)] : [...head, screenEmpty('designs')];
    // A pick opens its own card in Decide, where its options run full screen: only a design review has a review screen to show beside the list.
    const reviews = items.filter((d) => !isPick(d));
    if (!phone() && reviews.length) {
      const cur = reviews.find((d) => d.key === key) ?? reviews[0], [open, info] = designReview(cur, el('h2', { class: 'dz-t', dir: 'auto' }, cur.title), true);
      const card = (d) => el('a', { class: 'dz-card', id: `item-${d.key}`, href: designHref(d), 'aria-label': `Open design, ${d.title}`, ...(d === cur && { 'aria-current': 'true' }) },
        el('span', { class: 'dz-shot' }, pic(d) ? el('img', { src: src(pic(d)), alt: '', loading: 'lazy' }) : ''), el('span', { class: 'dz-ct', dir: 'auto' }, d.title),
        el('span', { class: 'dz-cm' }, [plainGroup(d), d.filed && day(d.filed)].filter(Boolean).join(' · ')), el('span', { class: 'dz-tag' }, designStatus(d)), selMark(d.key));
      // Where it stands fades out at its foot while it holds more than it shows.
      const ib = info.querySelector('.dz-ib'), fade = () => ib.classList.toggle('fades', ib.scrollHeight - ib.scrollTop - ib.clientHeight > 1);
      ib.addEventListener('scroll', fade); new ResizeObserver(fade).observe(ib);
      return [el('div', { class: 'ui-desk' }, top, ...head, el('div', { class: 'ui-dgrid dz-grid design-review' }, el('div', { class: 'dz-strip' }, ...items.map(card)), open, info))];
    }
    const toReview = reviews.filter((d) => ['In review', 'Draft'].includes(designStatus(d))).length, approved = reviews.filter((d) => designStatus(d) === 'Approved').length;
    return [...head, reviews.length ? el('section', { class: 'ui-card ui-hero dz-hero', 'aria-label': 'To review' }, el('div', { class: 'hl' }, el('span', { class: 'lab' }, 'To review')),
      el('div', { class: 'hv' }, el('span', { class: 'big' }, String(toReview), el('small', {}, ` of ${reviews.length}`)), approved ? el('span', { class: 'vs' }, `${approved} approved`) : '')) : '',
      el('h2', { class: 'ui-sec' }, 'Newest', el('span', { class: 'n' }, String(items.length))),
      el('ul', { class: 'ui-card ui-list dz-list' }, ...items.map(designRow)), archived(gone)];
  }
  /** A design as a row: its tile (a thumbnail of its first screen), the title, its state and day (or its ticket's bar); it opens the design's review. */
  const designHref = (d) => (isPick(d) ? `#decide/${d.key}` : `#designs/${d.key}`);
  /** A pick's thumbnail: its first option's mock, scaled into the row. Load it eagerly: the small transformed frame must paint even on a phone, where lazy frame scheduling can leave its visible tile empty. */
  function pickThumb(d) {
    const [m] = (d.options ?? []).map((o) => d.mocks?.find((x) => x.value === o.value)).filter((x) => x && x.hash !== null);
    if (!m) return '';
    const [path, query] = m.path.split('?'), url = src(mockUrl(d.key, m.value, path) + (query ? `?${query}` : ''));
    return el('span', { class: 'pk-thumb', 'aria-hidden': 'true' }, /\.html?$/i.test(path) ? guardFrame(el('iframe', { src: url, title: '', sandbox: 'allow-scripts', tabindex: '-1', loading: 'eager' }), `thumbnail of ${d.title}`) : el('img', { src: url, alt: '', loading: 'eager', decoding: 'async' }));
  }
  function designRow(d) {
    const t = ticketOf(d);
    return el('li', { id: `item-${d.key}` }, el('a', { class: 'ui-row', href: designHref(d) },
      ...uiRow({ tile: cardTile(d), title: d.title, priority: d.priority, badge: trailBadge(d.key), meta: [designStatus(d), d.filed && day(d.filed)].filter(Boolean).join(' · '), progress: progressOf(t?.progress) }), isPick(d) ? pickThumb(d) : '', selMark(d.key)));
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
    setTimeout(() => { keys.forEach((k) => leaving.get(k)?.t === t && leaving.delete(k)); if (document.querySelector('.dl-row.leaving')) renderKeepingFocus(); }, 500);
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
  const dzOpen = (d) => ['In review', 'Draft', 'Waiting on you'].includes(designStatus(d));
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
  function askSheet(d, close = '#waiting') {
    const bar = {}, page = decidePage(d, undefined, false, bar), rise = !sheetUp;
    sheetUp = d.key;
    return el('div', { class: `ask-over${rise ? ' up' : ''}`, 'data-key': d.key }, el('a', { class: 'ask-scrim', href: close, tabindex: '-1', 'aria-hidden': 'true' }),
      el('section', { class: 'ask-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ask-title' }, el('div', { class: 'grab', 'aria-hidden': 'true' }),
        el('header', { class: 'sh-head' }, cardTile(d), el('span', { class: 'sh-lab', dir: 'auto' }, `${isPick(d) ? plain(d.title) : whoOf(d)}${d.filed ? ` · ${filedAt(d.filed)}` : ''}`), bar.more,
          el('a', { class: 'sh-x', href: close, 'aria-label': 'Close' }, glyph('x'))), page));
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
    // The value is read at the tap, not closed over: a redraw keeps this button, and a reissued link has to be the one it copies.
    btn.addEventListener('click', () => copyValue(value.textContent ?? '', btn));
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
  /** Desk: list beside the selected ask; answering folds its row and selects the next. */
  function decideDesk(top, items, hidden, queue, key, done, today) {
    const old = done.find((x) => x.key === key), i = Math.max(0, queue.findIndex((d) => d.key === key)), d = old ?? queue[i], next = !old && queue.length > 1 ? queue[(i + 1) % queue.length] : undefined;
    deskSel = d?.key ?? '';
    const asks = queue.filter((d) => !isPick(d)).length, list = [decideList(items, hidden, done, today)], sub = [`${plural(asks, 'ask')} ${asks === 1 ? 'waits' : 'wait'} on you · ${today} answered today`, leashChip()];
    if (!d) return split(top, sub, list, pane('', items.length ? emptyState('empty', { mark: 'waiting', title: 'No review open', text: 'Pick one from the list to answer it here.', small: true }) : allClear(true)));
    const bar = {}, page = decidePage(d, next, true, bar);
    return split(top, sub, list, page.matches('.ui-pane') ? page : pane(askHead(d, bar), page));
  }
  /** Evidence on a desk: the list of updates beside the one selected. */
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
  const KEYS = [['Anywhere', [['Go to Today', 'G', 'T'], ['Go to the inbox', 'G', 'I'], ['Go to Decide', 'G', 'D'], ['Go to Evidence', 'G', 'E'], ['Go to Reports', 'G', 'R'], ['Undo', MOD, 'Z'], ['This list', '?']]],
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
  const GO = { t: '#', i: '#inbox', d: '#waiting', e: '#evidence', r: '#reports' };
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

  /* A redraw draws into the page it already has. The board is built as a tree of fresh nodes every time, and swapping that tree in whole is what made the
     board flash: on one answer, or on one poll that brought a change, the main region was torn down and built again two to four times in as many frames,
     so every row, picture and frame in it was made again (a picture re-decoded, a report's frame reloaded, an entry animation played a second time) and the
     list jumped under the thumb. So a node the new tree repeats keeps its element: a row is matched by its data-key, anything else by its place, and its
     attributes and text are brought up to date in place. */
  // A frame, a player or a canvas carries state of its own (a loaded picture, a scroll, a playing video): a redraw never rebuilds one showing the same thing.
  const KEEP_WHOLE = new Set(['iframe', 'video', 'audio', 'canvas', 'embed', 'object']);
  // A field's value and a dialog's open state belong to the element, so these come fresh and take the board's new state with them.
  const KEEP_FRESH = new Set(['dialog', 'input', 'textarea', 'select']);
  // The handlers the board puts on its own nodes (every other listener sits on the document or the window).
  const HANDLERS = ['onclick', 'oninput', 'onchange', 'onsubmit', 'onscroll', 'onerror', 'onload', 'onclose', 'ontoggle', 'onkeydown', 'onplay', 'onpause'];
  const wired = (n) => n.nodeType === 1 && HANDLERS.some((on) => n[on]);
  const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') ?? n.id ?? '' : '');
  // Two nodes of the same place are the same kind when they are the same tag and neither names itself, or they name themselves the same.
  const sameNode = (old, fresh) => old.nodeType === fresh.nodeType && (old.nodeType !== 1 || (old.localName === fresh.localName && old.id === fresh.id));
  // A node with a handler, or with a child that has one, is drawn fresh: its handler closes over the nodes and the card the board had when it was drawn,
  // so a group of elements that act on each other (a player and its play button, an option and the answer bar) is never half carried over.
  const wiredNear = (n) => n.nodeType === 1 && (wired(n) || [...n.children].some(wired));
  // A node is kept only where carrying it over changes nothing but its place: no handler to lose, no field to reset, and an embedded page or a player
  // only when it shows the same thing already.
  const keepable = (old, fresh) => !wiredNear(old) && !wiredNear(fresh) && !KEEP_FRESH.has(old.localName)
    && (!KEEP_WHOLE.has(old.localName) || ['src', 'data-mock', 'data-src'].every((a) => old.getAttribute(a) === fresh.getAttribute(a)));
  function patchNode(old, fresh) {
    if (old.nodeType !== 1) { if (old.nodeValue !== fresh.nodeValue) old.nodeValue = fresh.nodeValue; return old; }
    // A kept element's own inline styles (a width the board set from a measurement, a scroll a page settled at) stay: the fresh tree never carried them.
    // A gesture's leftovers do not: a row flown off its side by a swipe or a spring-back in flight is drawn where the board now puts it.
    for (const at of [...old.attributes]) if (at.name !== 'style' && !fresh.hasAttribute(at.name)) old.removeAttribute(at.name);
    for (const p of ['transform', 'transition']) if (!fresh.style.getPropertyValue(p)) old.style.removeProperty(p);
    for (const at of [...fresh.attributes]) if (old.getAttribute(at.name) !== at.value) old.setAttribute(at.name, at.value);
    const kids = [...old.childNodes];
    old.replaceChildren(...reuse(kids, [...fresh.childNodes]));
    return old;
  }
  /** A new element takes over the parts of the one it replaces that can be kept, so a row whose one button changed keeps its title, its tile and its picture.
   *  A node with a handler keeps its own children: its handler closes over them, so carrying the old ones over would leave it naming nodes off the page. */
  function freshNode(fresh, old) {
    if (fresh.nodeType !== 1 || wired(fresh) || !old || !old.childNodes.length) return fresh;
    const kids = [...fresh.childNodes];
    if (kids.length) fresh.replaceChildren(...reuse([...old.childNodes], kids));
    return fresh;
  }
  /** The nodes to draw for a list of new children, matched against the ones the page already has: a row is matched by its data-key, so a new ask at the
   *  top of the list leaves the rows under it where they are, and everything else keeps its place. */
  function reuse(olds, nodes) {
    const keyed = new Map();
    for (const o of olds) { const k = keyOf(o); if (k && !keyed.has(k)) keyed.set(k, o); }
    const taken = new Set();
    return nodes.map((n, i) => {
      const k = keyOf(n), old = k ? keyed.get(k) : olds[i];
      if (!old || taken.has(old) || !(k ? old.nodeType === n.nodeType && old.localName === n.localName : sameNode(old, n))) return freshNode(n, null);
      taken.add(old);
      return keepable(old, n) ? patchNode(old, n) : freshNode(n, old);
    });
  }
  function patchChildren(parent, nodes) {
    const next = reuse([...parent.childNodes], nodes);
    for (let i = 0; i < next.length; i++) if (parent.childNodes[i] !== next[i]) parent.insertBefore(next[i], parent.childNodes[i] ?? null);
    while (parent.childNodes.length > next.length) parent.lastChild.remove();
  }
  const drawInto = (parent, nodes) => patchChildren(parent, nodes.flatMap((n) => (n instanceof Node ? [n] : [document.createTextNode(String(n))])));
  /** Today's small title shows in its bar once the large one has scrolled under it. */

  function render() {
    if (designSession?.open) return (boardStale = true);
    // Every screen but the first lives in app-more.js, and the route for it waits for that file (see the hashchange handler) before it draws: a render
    // that reaches here first, from a page merging in or a poll, leaves the screen to that route.
    if (!moreReady && MORE_SCREENS.test(location.hash)) return;
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
    by.designs = [...state.decisions].reverse().filter((d) => !gone.has(d.key) && (d.kind === 'design' || (isPick(d) && !merged.has(d.key))));
    // Newest asks first, with sign-ins ahead.
    let latest = -Infinity;
    const inFileOrder = by.waiting.slice().reverse().map((d, i) => { const t = Date.parse(d.filed); if (!Number.isNaN(t)) latest = t; return { d, t: latest, i }; });
    const asked = inFileOrder.sort((x, y) => (x.t === y.t ? x.i - y.i : x.t - y.t)).map((x) => x.d).reverse();
    by.waiting = [...asked.filter((d) => d.type === 'signin'), ...asked.filter((d) => d.type !== 'signin')];
    by.asks = by.waiting.filter((d) => !isPick(d));
    const hidden = state.decisions.filter((d) => gone.has(d.key) && !merged.has(d.key) && area(d) === 'waiting');
    decideCtx = { all: decideOrder(by.waiting), hidden };
    by.answered.sort((x, y) => state.answers[y.key].at.localeCompare(state.answers[x.key].at));
    const [, at, key, opening] = /^#(waiting|decide|designs|evidence|reports|answered|tickets|ticket|activity|inbox|channels)(?:\/([\w.~-]+)(\/open)?)?$/.exec(location.hash) ?? [];
    const inboxAt = at === 'inbox', all = moreReady ? inboxThreads(merged) : [], needs = all.filter((t) => t.needs).length;
    const showingTickets = at === 'tickets' || at === 'ticket' || at === 'activity';
    if (showingTickets && !ticketScreen) readTickets(true);
    ticketScreen = showingTickets;
    // The asks Decide steps through, in the list's order, Later last.
    const decideQueue = decideCtx.all.filter((d) => d.type === 'signin' || (d.type !== 'plan' && d.kind !== 'design'));
    // Answered asks it opens again, newest first in its list; the arrows step through them oldest first, then through the open asks.
    const decideDone = by.answered.filter(redo), walk = [...decideDone].reverse().concat(decideQueue);
    // On a desk, Decide's list and its ask share the screen, Evidence's list and its update, and Reports' list and its report.
    // On a phone an ask opens as a sheet over Decide's list, so the page under it keeps the list's head.
    decideCounts = { asks: by.asks.filter((d) => sideOf(d) === 'now').length, designs: by.designs.length };
    const deskSplit = !phone() && ((at === 'waiting' || at === 'decide' || at === 'reports') && !state.readonly || at === 'evidence' || inboxAt), head = at === 'decide' ? 'waiting' : at;
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
    const opened = /^#(?:waiting|decide|designs|evidence|reports|ticket|inbox)\/([\w.-]+)(?:\/open)?$/.exec(location.hash)?.[1];
    whole(opened);
    for (const k of changing) if (k !== shownAsk?.key) changing.delete(k);
    // A decision lives under Decide; Designs has its own place in the sidebar, and on a phone, as the prototype's dock has it, Designs and Answered light Today, whose More opens them.
    const active = at === 'decide' ? 'waiting' : at === 'answered' ? '' : at === 'ticket' || at === 'activity' ? 'tickets' : at ?? '';
    // Tickets, as the prototype draws its place, carries no count.
    const count = (a) => (a === 'reports' && !state.readonly ? by.reports.filter(unread).length : a === 'inbox' ? needs : a === 'waiting' ? by.asks.length : a && a !== 'tickets' && a !== 'channels' ? by[a].length : undefined);
    // Ask/inbox badges are red, unread reports ink, evidence plain; Channels carries no count.
    const badge = (a) => (a === 'waiting' || a === 'inbox' ? 'red' : a === 'reports' && !state.readonly ? 'ink' : '');
    const link = ([a, name]) => el('a', { href: `#${a}`, ...(a === active && { 'aria-current': 'page' }) }, icon(`tab-${a || 'today'}`), name,
      count(a) === undefined || (badge(a) && !count(a)) ? '' : el('span', { class: `n ${badge(a)}`.trim() }, String(count(a))));
    // The sidebar as the prototype draws it: the board's mark and name, Search, the areas, and at its foot whose board it is with the light-or-dark button
    // (on a desk the one place it sits), then the version the board runs (0.6.1-dev on a dev build). Every key stays in the ? sheet.
    const who = state.name || 'You';
    document.getElementById('nav').replaceChildren(el('p', { class: 'brand' }, el('span', { class: 'logo', 'aria-hidden': 'true' }, glyph('check')), el('span', {}, 'Sign-off')),
      el('a', { class: 'sfind', href: '#find' }, document.getElementById('dock-find').firstChild.cloneNode(true), 'Search'), ...SIDE.map(link),
      el('div', { class: 'me' }, el('i', { 'aria-hidden': 'true' }, [...who][0].toUpperCase()), el('span', { dir: 'auto' }, who), themeButton()),
      state.version ? el('p', { class: 'ver' }, `Version ${state.version}`) : '');
    paintTabs(active === 'channels' ? '' : active === 'designs' ? 'waiting' : active, count, badge);
    const ro = state.readonly ? 'Read only' : FROZEN ? `Read-only copy, ${FROZEN.exported}` : '';
    const pageTitle = head === 'decide' || head === 'waiting' ? 'Decide' : head === 'reports' ? 'Reports' : AREAS[head];
    document.body.classList.toggle('today', !at);
    document.body.classList.toggle('tickets', showingTickets);
    document.body.classList.toggle('channels', at === 'channels');
    const bulk = { waiting: by.asks, designs: by.designs, evidence: by.evidence, reports: [...by.reports, ...by.notes], answered: by.answered }[at] ?? [];
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
      ...(by.reports.length ? reportGroups(listed) : rpSel !== null ? [] : [boardLoad('reports') === 'ready' ? el('div', { class: 'all-clear-big' }, el('span', { class: 'big' }, glyph('check')), el('h2', {}, 'Nothing to read'), el('p', {}, EMPTY.reports)) : screenEmpty('reports')]),
      notes(by.notes), archived(state.decisions.filter((d) => gone.has(d.key) && !merged.has(d.key) && ['reports', 'notes'].includes(area(d)))),
      !selecting && !state.readonly && !FROZEN && bulk.length ? reportsMore(by.reports, bulk) : '');
    const update = at === 'evidence' && ((key && state.decisions.find((d) => d.key === key && !gone.has(d.key) && d.type === 'evidence')) || by.evidence.find((d) => d.type === 'evidence'));
    const th = inboxAt && all.find((t) => t.id === key), inboxRead = th?.d && opening && !inPlace(th.d) && (phone() || th.d.type !== 'evidence') ? th.d : undefined;
    const content = at === 'channels' ? [channelsScreen(key)] : inboxAt ? inboxScreen(all, key, !!opening) : showingTickets ? tickets(by, at === 'ticket' ? key : '', at === 'activity') : [...(deskSplit ? [at === 'evidence' ? evidenceDesk(top, by.evidence, archived(state.decisions.filter((d) => gone.has(d.key) && d.type === 'evidence')), update)
      : at === 'reports' ? reportsDesk(top, rpPage(), shownReport, by.reports.length > 0, by.reports) : decideDesk(top, by.asks, hidden, decideQueue, key, decideDone, answeredToday)] : at === 'designs' && !phone() && by.designs.length ? [] : [top]), ...(deskSplit ? [] : (at === 'waiting' || at === 'decide') && !state.readonly ? [at === 'decide' && !shownAsk ? emptyState('empty', { mark: 'waiting', title: 'That question isn’t waiting', text: 'It may already be answered. Pick another from the list.' }) : '', decideList(by.asks, hidden, decideDone, answeredToday), at === 'decide' && shownAsk ? askSheet(shownAsk) : '']
      : at === 'designs' ? designGroups(by.designs, top, key, state.decisions.filter((d) => gone.has(d.key) && !merged.has(d.key) && area(d) === 'designs')) : at === 'evidence' ? [...evidenceList(by.evidence, top), archived(state.decisions.filter((d) => gone.has(d.key) && d.type === 'evidence'))] : at === 'reports' && !state.readonly ? [rpPage()] : at === 'answered' && by.answered.length ? done(by.answered) : at ? [by[at].length ? el('div', { class: `list in-${at}${state.readonly ? ' readonly' : ''}` }, ...by[at].map(row))
      : at === 'answered' && state.decisions.some((d) => gone.has(d.key) && isAnswered(d)) ? emptyState('empty', { mark: 'answered', title: 'All done items cleared' }) : screenEmpty(at)] : today(by))];
    if (!(at === 'decide' && shownAsk && !deskSplit) && !(inboxAt && opening && phone())) sheetUp = '';
    // The report shown on a desk stays in place under a new list and bar while it is the same report, so its frame is not loaded again.
    const keptRead = document.querySelector('#board .split-detail > .read'), newRead = content[0]?.querySelector?.('.split-detail > .read');
    if (keptRead && newRead && keptRead.dataset.sig === newRead.dataset.sig) {
      // The page stays; the head, the list, the report's head line and its parts beside it are drawn again, in place.
      for (const part of ['.ui-dhead', '.split-list', '.split-detail > .split-bar', '.split-detail > .pside']) {
        const at = board.querySelector(part), fresh = content[0].querySelector(part);
        if (at && fresh && at !== fresh) drawInto(at, [...fresh.childNodes]);
      }
    } else {
      const kept = swapDir && keepSheet(content);
      if (kept) { for (const n of [...board.children]) if (n !== kept) n.remove(); kept.before(...content); }
      else drawInto(board, content);
    }
    // A redraw keeps the desk list where it was scrolled, with the selected row in view.
    const listEl = document.querySelector('.split-list');
    if (listEl && listTop) listEl.scrollTop = listTop;
    listEl?.querySelector('[data-row][aria-current]')?.scrollIntoView({ block: 'nearest' });
    if (!toast.hidden) placeToast();
    if (at === 'reports' && !key) rpRisen = true;
    if (rpSel !== null) rpRisen = true;
    if (inboxAt) readPage(inboxRead, `inbox/${key}`); else readPage(rpFull ? shownReport : key && !(deskSplit && (at === 'evidence' || at === 'reports')) && !(at === 'designs' && !phone()) ? state.decisions.find((d) => d.key === key && !gone.has(d.key) && (at === 'reports' && reads(d) || at === 'designs' && d.kind === 'design' || at === 'evidence' && d.type === 'evidence' || d.type === 'plan' && (area(d) === at || (d.guided && (at === 'waiting' || at === 'answered'))))) : undefined, rpFull ? location.hash.slice(1) : at);
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
    // A route whose screen lives in app-more.js loads that file first and draws the screen itself, so a screen is never left waiting on a later redraw.
    const settle = () => {
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
    };
    if (!moreReady && MORE_SCREENS.test(location.hash)) waitMore().then(settle);
    else settle();
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
    busy(false);
    banner.textContent = `Can't read the board file: ${e.message}`;
    banner.hidden = false;
  };
  // Another program can change the board file (a feed, a new sign-in, signin done), so the page checks it every 20 seconds. The check is the
  // first screen's own page, tagged as last read: an unchanged board is a 304 with no body and no redraw, and a changed one is 15 KB, not five.
  let seenTag = '';
  async function refresh() {
    busy(true);
    try {
      const open = /^#(?:waiting|decide|designs|evidence|reports|ticket|inbox)\/([\w.-]+)(?:\/open)?$/.exec(location.hash)?.[1];
      const heard = moreReady && heardReplies();
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
      if (/^#(?:tickets?|activity)(?:\/|$)/.test(location.hash) && await readTickets(true)) changed = true;
      if (!changed) return;
      // One redraw for what the poll read: the lists come in with the page, and the rest of the board draws once when its own pages land.
      await readLists();
      if (heard) noticeNew(heard);
      // A whole-board read (an answer, a discard, a note) holds the board as it was when that request was written, and the poll's own page carries
      // the asks, never a proof. So when the board holds a row that read did not have, the pages bring it; while the page holds every row, nothing
      // is read again and a report being read keeps its place.
      if (!wholeBoard || state.decisions.length >= (state.counts?.items ?? 0)) return rest();
      wholeBoard = false;
      await rest();
      wholeBoard = state.decisions.length >= (state.counts?.items ?? 0);
    } catch (e) { failed(e); } finally { busy(false); }
  }
  /** The first screen: one page of the asks waiting on the person, painted before the rest of the board is read. The shell starts that read itself,
   * so it arrives beside the script instead of a round trip behind it. */
  const first = () => (globalThis.__asks ?? fetch('/api/decisions?view=asks&limit=20')).then(async (res) => {
    const body = await res.json().catch(() => ({ error: `The server replied ${res.status}` }));
    if (!res.ok) throw new Error(body.error);
    seenTag = res.headers.get('etag') ?? '';
    // The first page names the board's file, so its drafts are read after it, never before.
    mergeView(body);
    loadDrafts();
    renderKeepingFocus();
    busy(false);
  });
  // An exported copy's app-more.js is the next inline script, so the first draw waits for it: a desk's first screen calls its functions.
  if (FROZEN) (state = FROZEN), busy(false), document.addEventListener('DOMContentLoaded', render);
  else first().then(() => {
    banner.hidden = true;
    setInterval(refresh, 20_000);
    // The board as an app (its service worker, the offline line, the install row) is armed once the first screen is on screen: those bytes are
    // not part of what a phone moves before it can see the board, and the worker is in place long before anyone closes the tab.
    const app = document.querySelector('script[data-pwa]');
    if (app) app.src = app.dataset.pwa;
    // The tab's mark and the install manifest are named now too: a phone asks for both the moment it reads the page, and neither is what it came for.
    for (const l of document.querySelectorAll('link[data-icon], link[data-manifest]')) l.href = l.dataset.icon ?? l.dataset.manifest;
    // The screens beyond the first start here, with the read that paints the first screen: a tap that lands on one of them waits for a file already on
    // its way, never for one that has not been asked for. A link that opens one of those screens draws it once the file is in.
    loadMore().then(() => renderKeepingFocus());
    rest();
    readLists();
  }, failed);
