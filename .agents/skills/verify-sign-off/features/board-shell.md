# Board shell

The board page (web/index.html) in the Spacious look: system font, large titles, pill buttons, grouped lists, no shadows, its own light and dark palettes.

## Sub-features

- Summary (`#`), Waiting on you (`#waiting`), Designs (`#designs`), Evidence (`#evidence`), Reports (`#reports`), Answered (`#answered`).
- Desk (60rem and wider): a sidebar with Summary and the five areas, each with its count; the screen on show is marked.
- Phone: a solid tab bar at the bottom (Waiting, Designs, Evidence, Reports, Answered); the area on screen is blue; area screens keep a ‹ Summary link.
- Designs groups contract design reviews by project, with preview, date, status and any saved pick or note. Open a design to approve it or request a change with a note; on multi-screen designs, a native selector targets the note and full-preview link, while designs with no screens accept a design-level note. The preview is readable and scrollable, with a link to open its full asset. At 1280 the board sidebar remains visible with Designs selected; on Summary a design's primary action is Open designs, and on Waiting its ask opens the same review.
- After an answer, a toast with Undo sits above the tab bar.
- Summary: the date under the title, a glance card (a "Since you last looked at HH:MM" line on top once this browser has seen the board before: set `localStorage['sign-off-seen <board file>']` to an ISO time and reload; asks that need you and the oldest one's time in full colour, the rest quieter), a tile per area with its icon, its count large and its name (3 across on a phone, 5 on a desk), then Needs you first, Today, and a grouped inset list per area with a chevron per row, except Evidence (Proven today: today's passed updates as a swipeable card row on a phone, three across on a desk) and Reports (the newest report as one hero card).
- Answered: Done today, then Earlier, each one grouped inset list (also on a desk), newest first; each row shows the question, the answer and when (the time today, else the day and time) and opens to its full card.
- Waiting on you has its item count and date under the title, a plan hero with a preview (hidden on a phone), summary, sections/decisions/time and Open plan, then asks in a grouped inset list with type, title, deadline and dismiss.
- Opening an ask links to Decide: proof/preview, question and why, its options in one list with reasons and selected/recommended marks, the reply box, silent default/deadline, Answer (when the ask has options), Skip for now and Later. Skip, E and swipe left go to the next ask; swipe right answers with the recommended option, and a number picks that option and answers. The phone action bar clears the tab bar and content. A read-only board shows no answer controls.
- Reports (`#reports`): grouped inset lists, one per `group` (no groups: New and Earlier), each row a picture, title, what it says, kind, steps and date, a blue dot when filed today, and ×. A row with a page opens `#reports/<key>`: ‹ Reports, kind and time, the title in large type, what it says and decided, then the page in a tile; on a desk it opens beside the sidebar, on a phone over the board.
- Focus rings show on every link and button in both themes.
- Type follows the Spacious design: row titles 17 px regular with 15 px lines under them, never cut off with "…"; section links, back links and Clear all done in regular weight; Answered heads in small grey caps with a solid grey check badge per row; Decide named by a small centred title over the question, its stay-quiet line led by a clock and a bold "If you stay quiet:", and Answer on one line in the bar pinned above the tabs on a phone.

## How to get to it (user POV)

Open the URL seed-board.sh prints, in a browser; tap an area in the sidebar or the tab bar.

## Driving it

1. Launch as SKILL.md says and keep BASE.
2. For the R2 outcome, capture Waiting and Decide separately at both widths/themes so each shot has one screen claim. Waiting uses `shots.sh BASE "$DONE_DONE_EVIDENCE_ROOT" waiting`; for Decide, open `BASE#decide/look` (the seeded design pick with previews), pick an answer, and save `decide.<theme>.<width>w.png`. Use filenames `<screen>.<theme>.<width>w.png`. Force light with `--color-scheme light` for every light capture; do not rely on the host preference.
3. Designs: open `#designs`, check one project's preview/date/status, then open that design and exercise approve and change with a screen note. Capture `shots.sh BASE "$DONE_DONE_EVIDENCE_ROOT" designs design-review` at 390 and 1280 in light and dark; inspect every capture.
   Summary and Answered: `SHOTS_WIDTHS="390 1280" shots.sh BASE "$DONE_DONE_EVIDENCE_ROOT" summary answered`; check the tile counts match the sidebar counts and the Answered rows read newest first.
4. Toast: at 390, open BASE#evidence, click Pass from the page, then screenshot toast.<theme>.390w.png; the toast's bottom is above the tab bar's top.
5. Reports: seed-board.sh posts one report; post one more filed now in the same group and one with no group (`post <board> --kind report --from <json>` with `view` and `preview` from the seeded `page/` folder) so the list shows two sections and a dot.
   Capture `#reports` and `#reports/<key>` at 390 and 1280 in light and dark as `reports.<theme>.<width>w.png` and `report-page.<theme>.<width>w.png`; check the page's ‹ Reports goes back to the row.
6. Focus: press Tab until a sidebar link (1280) or a tab (390) has the focus, then screenshot focus.<theme>.<width>w.png (one theme and width in a verify run).
   One check judges at most 10 captures, so keep the Waiting, Decide and Designs captures in separate runs.
   When the outcome is about one width only ("on a computer" or "on a phone"), drive that width alone: SHOTS_WIDTHS=1280 (computer)
   or SHOTS_WIDTHS=390 (phone) for shots.sh, and the toast and focus captures at that width. A capture judged alone must show the whole claim.
7. Look at every capture: no text under the tab bar, nothing cut, the right area marked.
8. Stop the browser session you started; leave the board server, which stops itself.

## Gotchas

- `chrome-devtools-axi wait <ms>` fails; wait with eval "() => new Promise((ok) => setTimeout(ok, 600))".
- An emulated tap can miss a button; click it from the page with eval instead.
- The contract fixture's shot.png is 1x1, so the seed uses the README's phone pictures for media and mocks.
