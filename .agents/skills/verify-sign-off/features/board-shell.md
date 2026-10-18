# Board shell

The board page (web/index.html) in the Spacious look: system font, large titles, pill buttons, grouped lists, no shadows, its own light and dark palettes.

## Sub-features

- Summary (`#`), Waiting on you (`#waiting`), Evidence (`#evidence`), Reports (`#reports`), Answered (`#answered`).
- Desk (60rem and wider): a sidebar with Summary and the four areas, each with its count; the screen on show is marked.
- Phone: a solid tab bar at the bottom (Waiting, Evidence, Reports, Answered); the area on screen is blue; area screens keep a ‹ Summary link.
- After an answer, a toast with Undo sits above the tab bar.
- Focus rings show on every link and button in both themes.

## How to get to it (user POV)

Open the URL seed-board.sh prints, in a browser; tap an area in the sidebar or the tab bar.

## Driving it

1. Launch as SKILL.md says and keep BASE.
2. shots.sh BASE "$DONE_DONE_EVIDENCE_ROOT" summary waiting: 8 captures, <screen>.<theme>.<width>w.png. One check judges at most 10 captures, so a
   verify run keeps these 8 plus one toast and one focus capture; capture the other screens (shots.sh with no screens) outside the run folder.
3. Toast: at 390, open BASE#evidence, click Pass from the page, then screenshot toast.<theme>.390w.png; the toast's bottom is above the tab bar's top.
4. Focus: press Tab until a sidebar link (1280) or a tab (390) has the focus, then screenshot focus.<theme>.<width>w.png (one theme and width in a verify run).
5. Look at every capture: no text under the tab bar, nothing cut, the right area marked.
6. Stop what you started.

## Gotchas

- `chrome-devtools-axi wait <ms>` fails; wait with eval "() => new Promise((ok) => setTimeout(ok, 600))".
- An emulated tap can miss a button; click it from the page with eval instead.
- The contract fixture's shot.png is 1x1, so the seed uses the README's phone pictures for media and mocks.
