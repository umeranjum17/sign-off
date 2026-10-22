---
name: done-done-verify-sign-off
description: Drive the sign-off CLI the way a user does and capture proof it works. Use when proving a sign-off change, capturing evidence, or keeping the feature map honest.
---

# done-done-verify-sign-off

Scaffolded by `done-done init` from this repo's own files (surface: CLI). Where a step says to find something, the first drive finds it and records it there.

## Launch

npm run build, then seed a new board in an empty folder and serve it (one real posted item of each kind, one answered):

d=$(mktemp -d); .agents/skills/done-done-verify-sign-off/seed-board.sh "$d"

It prints the board URL (BASE). It sets HOME and XDG_* to that folder, so your own board (~/.sign-off) is never read or written.
Ready when the URL answers. Before finishing, run `node dist/cli.js stop <folder>/board.json` with the same isolated HOME/XDG settings as the seed script. Do not shell-kill the printed PID or leave it for the 30-minute safety timeout. Stop only your run's board and browser session.
When the repo's .done-done.yaml has an instance block, done-done already runs the app at $DONE_DONE_BASE_URL (its own port and HOME): BASE is then that URL, never a hard-coded port.

## Doctor

Read-only: is this instance worth driving? The URL answers with the page titled "Dashboard · sign-off", dist/ was built from this checkout, and the port is the one seed-board.sh printed. Each run seeds its own board; never drive a board the user owns.

## Drive

Harness: a browser (chrome-devtools-axi, one CHROME_DEVTOOLS_AXI_SESSION per run) for the board, a terminal for the CLI. Prefer the repo's real handles (hash routes, button labels) over coordinates:

- Core journey (`done-done run core`): the installed CLI files a card, the person answers it in the board, and the agent reads the answer with `wait --filer`; the board then shows the read receipt. `done-done run upgrade` runs the same journey over the previous published version, upgraded in place. It brings its own clean home and its own install, so it never touches the board above. See [Core journey](features/core-journey.md)
- Decide ask reference (CLI only, screen: none): `npm run build && node --test --test-global-setup=./test/temp-folder.mjs --test-name-pattern='new Decide cards' test/question.test.mjs` drives the built CLI on isolated boards: new flag, contract-message and feed posts without a reference fail without writing a card; captain-message and hold references succeed and persist; malformed references fail; existing cards still re-post. Capture the TAP output as text. Plans, reports, evidence and engagement remain covered by their existing journeys.
- Server lifecycle (CLI only, screen: none): `npm run build && node --test test/serve-stop.test.mjs` starts two isolated foreground boards, follows the printed `stop <board>` guidance, checks exit/PID/port/record removal and repeated-stop no-op, and proves the other board stays reachable. See `docs/commands.md` for background `open` versus foreground `serve`.
- [Board shell](features/board-shell.md): the areas, the sidebar on a desk, the tab bar on a phone, light and dark; report/plan document frames fit their full content and available gutter width
- [Decide](features/decide.md): the grouped list (swipe right to answer, left to Later, More, Select), an ask with one Answer and one More, the answer's check and the row folding away, Undo, skeleton and all clear; `decide-shots.sh <folder>` for stills and `decide-record.mjs` for a recording
- [Plan review](features/plan-review.md): open a plan, approve or change sections, answer decisions and send back structured answers
- [Guided plan and report](features/guide.md): clean-install authoring, the one-scroll Guide view, read receipts, legacy Go deeper and native-owner Simplify with persistent New at both widths and themes, selected-text asks (`done-done run selection`), Archify diagrams on a plan (`diagram-shots.mjs`, see the feature file), research-bar authoring from the packaged skill, item detail line breaks and the comparison table (`table-shots.mjs`)
- [Evidence](features/evidence.md): the Evidence list (one list, newest first, with a project filter) with the capture as the card's hero, and the update's own screen with the whole capture, the proof rows and the verdicts
- Agree, Disagree, Comment and Ask on a part (`done-done run part-comment`, `part-comment-shots.mjs`): see [Guided plan and report](features/guide.md)
- [Evidence](features/evidence.md): the Evidence list grouped by project with the capture as the card's hero, and the update's own screen with the whole capture, the proof rows and the verdicts
- [Evidence attachment](features/evidence-attach.md): a file (an APK) attached to an update card, its file row at both widths and a real download whose byte count matches
- [Notification sender](features/notifications.md): configure a local receiver, post a new ask and verify the exact received JSON, once per card
- [Board actions](features/board-actions.md): every card kind on every tab, every action clicked, both widths and themes, with done-done's look step
- Comment with an answer: every yes/no and pick-one answer (Decide on a phone and a desk, cards, an update's verdict) has a quiet **Add a comment** line right under its choices (a box with the placeholder "Add a note (optional)", no help line, and a folded **More…** holding Send as my own answer, Ask for another round and Send without answering; on Decide that is the bar's one More… beside Answer, also holding Skip for now, Later and Dismiss, so the card keeps one answer button); what is typed there goes with the answer picked as its `note`, typing leaves no focus ring on the next page, a picked answer reads only "Yes" (Recommended stays, small and beside its label, on an answer not picked), an answer with none is still one tap, the card then shows "Your comment, sent with <answer>: …" and reads **Edit comment**, and `answers` (TOON `note` column and `--json`) carries it. Drive: `done-done run answer-comment` (all four cells, with the step record), or `node .agents/skills/done-done-verify-sign-off/comment-shots.mjs <folder> [light|dark]` (COMMENT_WIDTH=390 or 1280) saves decide, comment, more-open and answered-card shots and answers.<cell>.txt (where the line sits, the card's text, the press and ease-in durations, the agent's read); run it on the base too for a before. test/design.test.mjs ("Add a comment on every answer") is the regression.
- [Design viewer](features/design-viewer.md): the full-screen screen review, its note box against its buttons at 390, 820 and 1280

shots.sh BASE <folder> captures every screen at 390, 820 and 1280, light and dark. An emulated tap can miss; click a button from the page (eval "() => document.querySelector('[aria-label^=\"Pass,\"]').click()") when a tap does not land.

## Evidence

Capture terminal transcripts, exit codes and side effects (files written, rows inserted). Exercise the real user path, not internal setters; done-done's judge checks every capture in the run folder against the outcome, so save only captures of the resulting state there and keep any of earlier steps outside it; verify side effects alongside what is visible. Evidence goes to the run folder `done-done run` prints. Every drive uses these done-done primitives:

- Matrix: when .done-done.yaml sets a matrix block, each journey runs once per theme x width x form cell with DONE_DONE_THEME, DONE_DONE_WIDTH, DONE_DONE_FORM and DONE_DONE_CELL set: name each capture with its cell suffix, so every cell is captured or skipped with a reason, never silently missing.
- DOM: when .done-done.yaml sets a dom block, write next to each capture its page-check record, the capture's name with .dom.json for its extension (home.dark.390w.png -> home.dark.390w.dom.json): {"url": "<page url>", "overflow": <true when content is wider than the viewport>, "overflowing": ["<element>", ...], "console_errors": ["<message>", ...], "failed_requests": [{"url": "<url>", "status": <HTTP status, 0 when none>}], "squashed_text": [{"element": "<element>", "text": "<text>", "chars": <width in characters>, "lines": <n>, "words": <n>}]}; with your browser tool (for example chrome-devtools-axi): overflow from eval "() => { const w = document.documentElement.clientWidth; return { overflow: document.documentElement.scrollWidth > w, overflowing: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')) } }", console errors from console --type error, failed requests (status 400 or more, or no response) from network, squashed_text from eval "() => { const ctx = document.createElement('canvas').getContext('2d'); const out = []; for (const e of document.querySelectorAll('body *')) { const nodes = [...e.childNodes].filter((n) => n.nodeType === 3 && n.data.trim()); const text = nodes.map((n) => n.data).join(' ').replace(/\s+/g, ' ').trim(); const s = getComputedStyle(e); const w = e.offsetWidth; const h = e.offsetHeight; if (!(e instanceof HTMLElement) || !text || !e.getClientRects().length || ((w <= 1 || h <= 1) && s.overflow !== 'visible') || s.visibility !== 'visible') continue; ctx.font = s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily; const chars = w / (ctx.measureText('abcdefghijklmnopqrstuvwxyz').width / 26); const words = text.split(' ').length; const tops = new Set(); for (const n of nodes) { const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width) tops.add(Math.round(b.top)); } if ((chars < 8 && ctx.measureText(text).width > w + 1) || tops.size > words) out.push({ element: e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.classList[0] ? '.' + e.classList[0] : ''), text: text.slice(0, 40), chars: Math.round(chars * 10) / 10, lines: tops.size, words }); } return out; }" exactly as written (in every frame, an embedded one too).
- Text: for a text outcome, save the CLI output, log or JSON itself as a .txt, .log or .json capture; the check needs it to hold text and JSON to parse.
- Secrets: never write a secret (key, token, password, Bearer header) into evidence or logs; verify scans them and fails the run on a hit.
- Spends: a journey with `spends:` runs only after the user approves the spend at verify's gate; never run it another way.
- Before/after: with `base_ref` set, verify also drives the base ref into the run folder's before/; save the same captures under the same names there, so each pairs with its base capture.

## Cleanup

Stop the instances this run started and remove scratch state. Evidence survives cleanup: never delete the run folder.
