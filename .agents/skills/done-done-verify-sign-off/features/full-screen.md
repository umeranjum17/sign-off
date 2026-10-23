# Prototype full screen

**Open full screen** on a design pick (under its mock frames, or a tap on a frame) and on an interactive page's card shows the prototype over the whole screen, in the same sandboxed frame, which takes every tap: the prototype's own links, tabs and the pages and files beside it work. One bar: Close, the card's title, Open live (when the option shown has a `--link`), the option shown, **Phone** (390) and **Desktop** (1280), and **Reference** (a design pick only).

## How to get to it (user POV)

Open a design pick or an interactive page on Decide (`#decide/<key>`) and tap **Open full screen**, or tap a mock's frame. Close (or Escape) goes back to the card, with the focus on what opened it.

## What it must do

- Fill the viewport (no board behind it, no sideways scroll), the recommended option first, at Phone on a phone and Desktop on a desk.
- Draw the prototype in its device's own viewport, 390 by 844 CSS pixels for Phone and 1280 by 800 for Desktop, so its breakpoints and full-height layouts see that device; scaled down with a transform where it does not fit under the bar either way (Desktop on a phone is about 0.3, Phone on a 1280 desk about 0.84), centred, framed with rounded corners where it does not fill the width. A size change keeps the page and its state; another option loads that option's page. A click lands where the scaled page draws a control.
- Reference: another option's mock beside the prototype, both labelled, where each keeps at least half its width (Phone on a desk), else over it (a phone, Desktop on a 1280 desk); a picker when there are more than two options. Off again, the prototype is as it was. An interactive page has no Reference and no option picker.
- An option's `--link` is an Open live link in the bar, opening a tab: the frame loads no remote files.
- While Comment on the mocks is on, a tap on a mock names an element and does not open the full screen.
- Light and dark, 390 and 1280, all controls 44 px tall.

## Driving it

1. `npm run build`.
2. `FULL_WIDTH=390|1280 node .agents/skills/done-done-verify-sign-off/fullscreen-shots.mjs <folder> <light|dark>` seeds its own board (own HOME and XDG_*) with a two-option fleet dashboard prototype (`fullscreen-sample/a` links to a page beside it and uses a stylesheet beside it; `b` has a tab switcher) and an interactive tour (`fullscreen-sample/tour`), then drives it with chrome-devtools-axi: the card, Open full screen, the prototype's own Done tab and Lanes link (real key presses inside the frame: Tab to the control the accessibility snapshot names, then Enter), the other size, Reference on and off, Close, and the tour's own Next. It saves `card`, `full`, `nav`, `size`, `reference`, `closed` and `tour` as `<state>.<theme>.<width>w.png`, `fullscreen.<theme>.<width>w.json` (the dialog's box, each frame's box, viewport width and height and scale, checked to fit the dialog, the mode, the captions, the live link, overflow) and `steps.json`, and exits non-zero when a check fails. `done-done run fullscreen` runs all four cells.
3. Regression: `node --test --test-global-setup=./test/temp-folder.mjs --test-name-pattern='Open full screen' test/design.test.mjs` (real taps on the board's controls at 390 with touch, real clicks inside the frame, each frame's 390 by 844 or 1280 by 800 viewport fitting the stage, the scaled Desktop frame taking a click on a phone and a small corner button taking one at its scaled place on a desk, the stylesheet beside the page, Reference over at 390 and beside at 1280, Close, the interactive page, pointing).
4. Look at every capture: the bar on one line at 1280 and two at 390, nothing cut, the frame centred, the captions readable.

## Gotchas

- Headless Chrome puts the sandboxed frame in its own process and misplaces the click it makes from an emulated touch tap inside it (the touch events land right). Click inside the frame with the mouse, or from the accessibility snapshot; a phone keeps the frame in-process. chrome-devtools-axi's click on an element inside a frame scaled to Desktop on a phone times out, and inside any scaled frame it aims at the element's unscaled place, so it can miss; the journey presses the prototype's controls from the keyboard and taps Phone before the tour. The node test clicks with the mouse at the scaled place.
