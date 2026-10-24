# Feedback trail

What the person sends on a card (an answer with its note, a design's change notes, a plan's send-back, a new round, a comment) and how far it got with the agent: Sent, Delivered, Read, Replied.
Phone (390) and desk (1280), light and dark.

## What a user sees

- **On the card** (`trailTrack` in web/index.html, `.ui-trail` in ui.css): under Your answer on an ask, and under What you said (or What you sent) on a design, four steps on one track, each its word and, once reached, its time.
  - Under it, once the agent replied: its words and its link (Pull request N, or Open the new version). With a link and no words the last step reads Acted; a card posted again after the send reads Acted with Posted a new version.
- **In its Activity:** Delivered to <agent>, <agent> read it, <agent> replied · Pull request N with the reply quoted. One step per word and second.
- **In the lists** (`trailBadge`, `.ui-tb`): at the end of a row's second line, four 4px marks and the step's word; a reply not opened yet is ink. On Decide's Answered rows, Designs' rows, Today's rows and a ticket's Linked rows.
- **The badge keeps its look on every phone:** the page names `tokens.css` and `ui.css` by content (`?v=<hash>`), so a phone that kept an older stylesheet for a day never draws the badge unstyled (a large word over the row). One 20px line, the words before it take the ellipsis, at 360, 390 and 445: `TRAIL_LONG=1 trail-shots.mjs <folder> <theme> <360|390|445>` (journey `trail-badge`); the regression is test/design.test.mjs ("the feedback trail").
- **In Today:** Replies, the cards with a reply not opened yet, newest first, the reply's words as the second line; above Waiting on you on a phone, at the top of the right column on a desk. Opening the card marks the reply seen and it leaves Today.

## Where each step comes from

- Delivered: a `wait` that is not the filer's own handed the answer over; `poll` handed a comment over; the `on_answer` hook ran and exited 0.
- Read: the filer's own `wait --filer`, or `sign-off-axi feedback <key> --read`.
- Replied: `sign-off-axi feedback <key> --reply "<text>" [--link <url>]` or `--acted --link <url>`; or the card posted again after the send.
- All in `<board>.trail.jsonl` (docs/file-formats.md).

## Drive and prove

`node .agents/skills/done-done-verify-sign-off/trail-shots.mjs <folder> <light|dark> <390|1280>` seeds its own board (HOME and XDG_* in a temp folder), answers in the board as a tap would, hands one answer over with a plain `wait`, lets the agent's own `wait --filer` take two, and replies with `feedback --reply --link`.
It saves, per cell, `today`, `decide`, `designs`, `sent`, `delivered`, `read`, `replied`, `design` and `today-seen` (`<state>.<theme>.<width>w.png`), each with a `.txt` of what the browser measured (the track's steps on one line inside its card, no word cut, each 20px badge, Today's Replies, the Activity, no sideways overflow, no raw words, no console error), and `trail.<theme>.<width>w.json`, the board's trail. It exits 1 on any failed measure.
The regression is test/design.test.mjs ("the feedback trail"), with the hook's Delivered in "answer events".
