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

## A new round and the preview

A design the agent writes again under its key (a new `filed` time, other screens, or a screen file drawn again in place) is a new round. On its review page:

- The note box starts empty. The note given on the earlier round for that screen is under a folded **Earlier note** line, and stays there after the first save on the new round. The viewer reads the screen as Not reviewed yet.
- The preview draws the selected screen (the first by default). An `.html` view fills the whole preview window from its top, on white where the page sets no background; before, the frame was 150 px tall and the rest of the window an empty box (all dark on a phone in dark).
- A screen whose file is gone shows the design's preview picture with "This screen could not be shown: this is the design's preview picture." above it.

Drive: `ROUND_WIDTH=390|1280 node .agents/skills/done-done-verify-sign-off/design-round-shots.mjs <folder> <light|dark>` (`done-done run design-round` runs all four cells). The person types a note with real key events and taps Change, the agent draws the screen again, and the run saves `preview`, `note` (Earlier note opened) and `fallback` as `<state>.<theme>.<width>w.png`, with `design-round.<theme>.<width>w.json` (the note box, the earlier note, the frame and window boxes, the viewer's screen line, the fallback). `ROUND_SIDE=before SIGN_OFF_REPO=<built base checkout>` takes the same shots from the base without the checks. Regressions: `test/design.test.mjs` ("a design posted again is a new round", "shows its screen on a phone in light and dark").

## Designs list and review page

`shots.sh BASE <folder> designs design-review` captures them. The list is the Reports pattern (grey caps group label, one tile, a row per design with its picture, title, summary and "In review · date"); the review page opens with the way back, then the status, the title (34 px, 48 px at 1280) and the summary in one centred column, with the preview, Review full screen and the note under them. Look at both at 390 and 1280, light and dark: nothing cut, the button full width at 390.
