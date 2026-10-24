# Designs

The design reviews a lead posts (`post --kind design`) that Main has not promoted to Decide, in the new look: on a phone as Reports' list draws it (the approved prototype's phone has no Designs tab), on a desk as the approved prototype's desk Designs (`signoff-restyle-board/v3/proto/index.html#v=designs`) fills the window. Built from `web/ui.css`'s parts; actions in ink.

## How to get to it (user POV)

Today's More → Designs, or the address `#designs`; a design opens at `#designs/<key>`. On a desk the sidebar lists Designs after Reports with how many designs are on the board.

## What it shows

- On a phone (below 1024px):
  - The dock keeps its five tabs (Today, Decide, Evidence, Reports, Tickets) and lights Today on Designs, as the prototype's dock maps the Designs address.
  - The title row: Designs, More (Select and Discard all, as a sheet; while selecting, the title counts the picks with Select all, and Cancel and Discard N take the dock's place: [Discard](discard.md)) and the round light-or-dark button.
  - To review: how many have no answer yet, of all, and how many are approved.
  - Newest: one card of 68px rows, newest first: the project's own icon (`project --icon`), else its kind icon from the shared tile; the title on one line; its state and day (In review, Draft, Approved, Changes requested), or its ticket's bar once the ticket has progress (full at 100%).
  - A row opens the design's review over the board: its project and day, the whole title, what it shows, the selected screen in its device's viewport, Open full preview, Review full screen, Where it stands (State, Your pick, Answered), What you said on this round (each note under its screen's name), then Your review: Pick a direction (a design with options), Screen for note (more than one screen), the note, and Approve in ink beside Change; the ticket, the Activity thread, Open original design and Discard.
- On a desk (1024px and wider) the whole window, 24px around:
  - The sidebar: Today, Decide, Evidence (its count), Reports, Designs (its count, lit) and Tickets, the prototype's places in its order.
  - The header: Sign-off › Designs, the 32px title, what is on the board ("3 designs on your board · changes requested on 1"), More and the light-or-dark button at the right.
  - A 12-column grid to the foot: the designs as picture cards across the top, four columns each (their picture, the title on up to two lines, project and day, the state); more than three scroll sideways a whole card at a time. The open card has an ink ring.
  - With no design in the address the newest is open; Where it stands shows Your pick whenever the design was answered with a direction (the prototype shows it only then too).
  - The open design (eight columns: project and day, Open full preview and Review full screen on its head line, the whole title, the screen filling the rest of the card) beside Where it stands (four columns: the state, pick and answer day, what you said, Your review with the note, What it shows, the ticket, the Activity, Open original design and Discard). Where it stands scrolls inside, fades at its foot while it holds more, and keeps Approve in ink and Change pinned at its foot.
  - A card opens its design at `#designs/<key>`; with none in the address the newest is open. No page scroll.
- Review full screen (both widths) is the [Design viewer](design-viewer.md), as before; its Approve screen is ink now.

## How to drive and prove it

`npm run build`, then `node .agents/skills/done-done-verify-sign-off/designs-shots.mjs <out> <light|dark|light,dark> <390|1280|1440>` (journey `designs`), with `DESIGNS_PROTO=<the approved prototype's v3 index.html>` to save each state beside the prototype's frame (`vs-proto/<state>.after.<theme>.<width>w.pair.png`; the phone pairs with the prototype's Reports list, an open report and its filter sheet, the look Designs follows). It posts three designs and three evidence updates through the CLI in a throwaway HOME and XDG_* (screens are the board's own `docs/media` shots), gives the Sign-off project its icon, puts one design on a finished ticket, answers two through the board's API (Change with a pick and a screen note on the newest, as the prototype's newest; Approve with a pick), serves the board in the foreground and drives a headless Chromium of its own at 390x844, 1280x800 or 1440x900 (2x):

- at 390: `designs` (also paired as `designs-dock` with the prototype's Designs address, Today lit in its dock), `design` (a row tapped), `design-end` (scrolled to its end), `full` (Review full screen), `more` (the title row's More) and `change` (a note typed and Change tapped on another design: the answers file holds it and the row reads Changes requested);
- at 1280 and 1440: `designs`, `design-picked` (another card clicked) and `full`.

Each capture is measured in the browser (`<state>.*.measure.json`, `measure.<side>.<theme>.<width>w.txt`): on a phone the dock's five tabs with Today lit on the list; on a desk the sidebar's six places in the prototype's order with Designs lit and Evidence 3 and Designs 3 (the board's own counts); on a phone every block on the 16px gutter's two edges and the 4px grid, 68px rows (40px tile 12px in, the title 12px after it), the last block at least 16px over the dock, no control under 44px; on a desk every card on the 12 column lines and the 4px grid, the cards' tops shared, the open design 24px over the window's foot, no page scroll, and under 15% of the viewport empty (the prototype's DESK_MEASURE way: outside the sidebar, the header and each card down to its last content); everywhere no cut text but a row's title (one line on a phone) or a desk card's title past two lines, no words drawn over other words (clipped parts left out), no file path or internal code in the words, no sideways overflow, no console error. Phone captures hide scrollbars (a phone draws overlay ones); desk captures keep the classic ones. `DESIGNS_SIDE=before SIGN_OFF_REPO=<built base checkout>` takes the same states from the base without the checks.

The regressions are `test/design.test.mjs` ("listed under Designs only", "a design without journey screens", the viewer and round tests) and `board-actions.mjs` (the `designs` and `design-review` pages: More's Select, a pick, Discard 1 with a reason and Undo, Cancel, Discard all with Undo, Discard on the design's page, Review full screen, Change without and with a note, Approve).

Design row tiles and desktop picture cards use the first journey screen’s image (preview picture when that screen has no still), with a project/kind fallback only if it cannot load. `report-rows` uses a real sign-off screen capture as that first frame.

The portrait thumbnail must fit the 40 px tile: the integration journey uses a real portrait image, and `report-rows` measures thumbnail bounds in every captured list.
