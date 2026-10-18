# Board shell

The board page (web/index.html) in the Spacious look: system font, large titles, pill buttons, grouped lists, no shadows, its own light and dark palettes.

## Sub-features

- Summary (`#`), Waiting on you (`#waiting`), Designs (`#designs`), Evidence (`#evidence`), Reports (`#reports`), Answered (`#answered`).
- Desk (60rem and wider): a sidebar with Summary and the five areas, each with its count; the screen on show is marked.
- Phone: a solid tab bar at the bottom (Waiting, Designs, Evidence, Reports, Answered); the area on screen is blue; area screens keep a ‹ Summary link.
- Designs groups contract design reviews by project, with preview, date, status and any saved pick or note. Open a design to approve it or request a change with a note; on multi-screen designs, a native selector targets the note and full-preview link, while designs with no screens accept a design-level note. The preview is readable and scrollable, with a link to open its full asset. At 1280 the board sidebar remains visible with Designs selected; on Summary and Waiting, a design's primary action is Open designs.
- After an answer, a toast with Undo sits above the tab bar.
- Waiting on you has its item count and date under the title, a plan hero with preview/summary/sections/decisions/filer/time and Open plan, then asks in a grouped inset list with type, title, filer/deadline and dismiss.
- Opening an ask links to Decide: proof/preview, question and why, grouped options with reasons and selected/recommended marks, silent default/deadline, Answer and Later. The phone action bar clears the tab bar and content.
- Focus rings show on every link and button in both themes.

## How to get to it (user POV)

Open the URL seed-board.sh prints, in a browser; tap an area in the sidebar or the tab bar.

## Driving it

1. Launch as SKILL.md says and keep BASE.
2. Designs: open `#designs`, check one project's preview/date/status, then open that design and exercise approve and change with a screen note. Capture the Designs listing and opened review at 390 and 1280 in light and dark; inspect every capture.
3. shots.sh BASE "$DONE_DONE_EVIDENCE_ROOT" summary waiting: 8 captures, <screen>.<theme>.<width>w.png. One check judges at most 10 captures, so a
   verify run keeps these 8 plus one toast and one focus capture; capture the other screens (shots.sh with no screens) outside the run folder.
   For Decide, open `BASE#decide/look` (the seeded design pick with previews) and save `decide.<theme>.<width>w.png` separately so each shot has one screen claim. Force light with `--color-scheme light` for every light capture; do not rely on the host preference.
4. Toast: at 390, open BASE#evidence, click Pass from the page, then screenshot toast.<theme>.390w.png; the toast's bottom is above the tab bar's top.
5. Focus: press Tab until a sidebar link (1280) or a tab (390) has the focus, then screenshot focus.<theme>.<width>w.png (one theme and width in a verify run).
   When the outcome is about one width only ("on a computer" or "on a phone"), drive that width alone: SHOTS_WIDTHS=1280 (computer)
   or SHOTS_WIDTHS=390 (phone) for shots.sh, and the toast and focus captures at that width. A capture judged alone must show the whole claim.
6. Look at every capture: no text under the tab bar, nothing cut, the right area marked.
7. Stop the browser session you started; leave the board server, which stops itself.

## Gotchas

- `chrome-devtools-axi wait <ms>` fails; wait with eval "() => new Promise((ok) => setTimeout(ok, 600))".
- An emulated tap can miss a button; click it from the page with eval instead.
- The contract fixture's shot.png is 1x1, so the seed uses the README's phone pictures for media and mocks.
