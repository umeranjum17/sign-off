# Design viewer

The full-screen review a multi-screen design opens: one screen at a time, the screen's note and
Approve screen / Request change under it, and Previous / Next above it.

## How to get to it (user POV)

Open `#designs`, open a design review, then tap **Review full screen**. Step with Previous / Next,
the arrow keys, or a swipe on the screen.

## Driving it

1. Launch as SKILL.md says and keep BASE.
2. `shots.sh BASE "$DONE_DONE_EVIDENCE_ROOT" design-viewer` captures the viewer at 390, 820 and
   1280 in light and dark, and writes `design-viewer.<theme>.<width>w.widths.json` beside each:
   the screen note box and the buttons under it must have the same left and right edge
   (`aligned: true`), and all three widths are in the run (the pad width is where a fixed
   `max-width` on the note box shows).
3. Approve one screen through the viewer: `answers --json` holds it as a screen note and the design
   still waits ("Screens reviewed"). Then Request change on another screen: the design's answer is
   `change` ("Changes requested"), it leaves waiting, and the review page reads Changes requested
   after Close. Covered at 390 by the `viewer Request change answers it as Changes requested` test
   in `test/design.test.mjs`.
4. On an answers-only board: `REQUEST_WIDTH=390 done-done run request-change` (and 1280) types a screen note with real key events, checks Request change is enabled, sends it and checks the saved note, the status "Changes requested", and after Close the design answered Changes requested (card-answered.<width>w.png). Also covered by the `answers-only board takes a screen review` test in `test/design.test.mjs`.
5. Look at every capture: the screen shows whole with no crop and no inner scroll, the note box
   and the buttons line up, nothing overlaps and no text is cut.

## What it must not do

- Squeeze the note box against the buttons at any width, in either theme.
- Crop the screen, or scroll inside the stage.
- Leave the board behind it in a different state than the review shows.

## Designs list and review page

`shots.sh BASE <folder> designs design-review` captures them. The list is the Reports pattern (grey caps group label, one tile, a row per design with its picture, title, summary and "In review · date"); the review page opens with the way back, then the status, the title (34 px, 48 px at 1280) and the summary in one centred column, with the preview, Review full screen and the note under them. Look at both at 390 and 1280, light and dark: nothing cut, the button full width at 390.
