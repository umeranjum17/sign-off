# Designs

The design reviews a lead posts (`post --kind design`) that Main has not promoted to Decide, in the new look: on a phone as Reports' list draws it (the approved prototype's phone has no Designs tab), on a desk as the approved prototype's desk Designs (`signoff-restyle-board/v3/proto/index.html#v=designs`) fills the window. Built from `web/ui.css`'s parts; actions in ink.

## How to get to it (user POV)

On a phone Decide's Designs (Decide holds Asks and Designs, each with its count) or a row under Today's Designs to review, one tap; Today's More → Designs, or the address `#designs`; a design opens at `#designs/<key>`. On a desk the sidebar lists Designs after Reports with how many designs are on the board.

## What it shows

- On a phone (below 1024px):
  - The dock keeps its five tabs (Today, Decide, Evidence, Reports, Tickets) and lights Decide on Designs: on a phone Designs is Decide's second list (a sixth tab does not fit at 360px: six tabs and Search need 374px).
  - The title row: Decide, More (Select and Discard all, as a sheet; while selecting, the title counts the picks with Select all, and Cancel and Discard N take the dock's place: [Discard](discard.md)) and the round light-or-dark button.
  - Asks and Designs under the title, each with its count (Designs: those in review or draft), Designs pressed; Asks goes back to Decide's asks ([Decide](decide.md)).
  - To review: how many have no answer yet, of all, and how many are approved.
  - Newest: one card of 68px rows, newest first: a thumbnail of the design's first screen picture (its preview picture when that screen has no still; its project's or kind's icon only if it cannot load; never letters); the title on one line; its state and day (In review, Draft, Approved, Changes requested), or its ticket's bar once the ticket has progress (full at 100%).
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

- at 390: `designs` (also paired as `designs-dock` with the prototype's Designs address), `design` (a row tapped), `design-end` (scrolled to its end), `full` (Review full screen), `more` (the title row's More) and `change` (a note typed and Change tapped on another design: the answers file holds it and the row reads Changes requested);
- at 1280 and 1440: `designs`, `design-picked` (another card clicked) and `full`.

Each capture is measured in the browser (`<state>.*.measure.json`, `measure.<side>.<theme>.<width>w.txt`): on a phone the dock's five tabs with Decide lit on the list; on a desk the sidebar's six places in the prototype's order with Designs lit and Evidence 3 and Designs 3 (the board's own counts); on a phone every block on the 16px gutter's two edges and the 4px grid, 68px rows (40px tile 12px in, the title 12px after it), the last block at least 16px over the dock, no control under 44px; on a desk every card on the 12 column lines and the 4px grid, the cards' tops shared, the open design 24px over the window's foot, no page scroll, and under 15% of the viewport empty (the prototype's DESK_MEASURE way: outside the sidebar, the header and each card down to its last content); everywhere no cut text but a row's title (one line on a phone) or a desk card's title past two lines, no words drawn over other words (clipped parts left out), no file path or internal code in the words, no sideways overflow, no console error. Phone captures hide scrollbars (a phone draws overlay ones); desk captures keep the classic ones. `DESIGNS_SIDE=before SIGN_OFF_REPO=<built base checkout>` takes the same states from the base without the checks.

The regressions are `test/design.test.mjs` ("listed under Designs only", "a design without journey screens", the viewer and round tests) and `board-actions.mjs` (the `designs` and `design-review` pages: More's Select, a pick, Discard 1 with a reason and Undo, Cancel, Discard all with Undo, Discard on the design's page, Review full screen, Change without and with a note, Approve).

Design row tiles and desktop picture cards use the first journey screen’s image (preview picture when that screen has no still), with a project/kind fallback only if it cannot load. `report-rows` uses a real sign-off screen capture as that first frame.

The portrait thumbnail must fit the 40 px tile: the integration journey uses a real portrait image, and `report-rows` measures thumbnail bounds in every captured list.

Designs one tap away on a phone (journey `designs-access`): `node .agents/skills/done-done-verify-sign-off/designs-access-shots.mjs <out>` posts three designs of the board's own screens (docs/media), three asks, eight reports and a proof on the sign-off project (its icon pinned) in a throwaway HOME and XDG_*, and drives chrome-devtools-axi at 360, 390, 445, 1280 and 1440 in light and dark: `today`, `decide`, `designs` (reached by tapping Decide's Designs on a phone), `reports-end` (a phone, scrolled to its end) and `order` (390, Decide's order sheet). Each frame's `.dom.json` holds the dock's or the sidebar's lit place, Asks and Designs with their counts, the order, Today's Designs to review, every tile's picture (no letters, every picture loaded), the More line against the dock (at least 16px over it), the fade under the dock, overflow and console errors; `DESIGNS_ACCESS_SIDE=before SIGN_OFF_REPO=<built base checkout>` records the base. `test/design.test.mjs` ("listed under Designs only", the tab bar test) is the regression.

## A design asked as one plain question (design 2)

A design 2 card is one question answered once. Its title is the question Yes answers ("Approve this new phone end-of-list for Reports?"). Each screen shows its frames side by side: **Before** and **After** when they are today and the new look, else **Today**, **New (built)** or **New (proposed)** and **Target design**. On each frame the changed area is outlined in ink, the rest of the picture is dimmed, and a one-line caption sits under it. The frame Yes approves is ringed in ink, with a check by its label. More screens step with Previous and Next (`2 of 3`). Under the frames are the note ("A note: optional with Yes, needed for Change"), **Yes** in ink beside **Change**, and the line "Yes approves “New (built)”, the frame with the check". A note typed beside Yes is saved as an approval with that note. Change needs the note. A phone shows it in the reader. A desk shows the open design's card filled with the frames, with Your answer (the note, What changed, Where it stands) beside it, and the line and the buttons pinned at its foot. While a question is open, the cards across the top keep their words but drop their pictures.

`post --kind design` refuses a new design whose title is not one plain question of 12 words or fewer. It also refuses words for agents in what the person reads (task or branch names, PR or #number, slice, agent or ticket codes, file names, commits) and two frames of a screen that look the same (under 0.1% of pixels apart). A design already on the board re-posts as it was.

Drive: `npm run build`, then `node .agents/skills/done-done-verify-sign-off/design-ask-shots.mjs <out> <frames folder>` (journey `design-ask`, `DESIGN_ASK_FRAMES`). The frames folder holds `today`, `built` and `target` as `.light.webp` and `.dark.webp`, cropped from the owner's three-column card ("Reports at its end", 390). The run first posts the card as it was written, one rule at a time, and saves each refusal with its exit 2 in `refusals.txt`: the title, the about's "PR", then Today and New (built) looking the same. Then it posts the card as the rules have it. For each of 390x844 and 1280x800 (2x), light and dark, on a board of its own, it saves `ask` (the card opened from Designs), `answer` (a note typed beside Yes) and `approved` (Yes tapped: the answers file holds `approve` with the note) as `<state>.after.<theme>.<width>w.png`, each with `.dom.json` and `.measure.json`. The measures fail on any of these:
- the frames' labels, pictures or widths off their shared lines;
- an area outside its picture;
- not exactly one frame marked for Yes, or that frame without its check;
- cut text, words over words, a letter tile or raw ids and file names;
- a control under 44px on a phone, or a page scroll on a desk;
- a console error.

`DESIGN_ASK_SIDE=before SIGN_OFF_REPO=<built base checkout>` posts the same card as the owner saw it (design 1, the three-column picture) and saves the same states unasserted. Regressions: the design.v2 fixtures in `test/contract.test.mjs` (every shipped fixture) and "a design asked as one question" in `test/contract.test.mjs`. The palette gate (`palette-shots.mjs`, feel-board.sh's onboarding is a design 2) checks its colours.

