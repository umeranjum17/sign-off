# Inbox

The board's first screen and its only place: every exchange with an agent, whatever its kind (decision, plan, report, design, ticket, proof), is one thread in one list. It replaces Today and the separate Decide, Designs, Reports, Evidence and Tickets entries in the dock and the sidebar; their old addresses still open.

## What it shows

- The list, in four sections: **New** (a reply not opened yet, and a report or proof not read), **Decide** (what waits on the person), **Waiting on agents** (each row says what the person sent and its step: Sent, Delivered, Read), and **Answered and done**, folded behind `Show N answered and done`. Newest first in each; eight rows until `Show N more`.
- A search box and kind chips (All, Decisions, Plans, Reports, Designs, Tickets, Proofs; a kind shows only when the board holds one, with what is still open). Tickets reads the board's ticket roll-up when picked.
- The tab's title counts New and Decide: `(3) Inbox · sign-off`.
- A row opens its thread (`#inbox/<key>`; a ticket is `#inbox/~<id>`): the card's words (Asked or Posted), then each exchange as a pair with its four-step track: Your answer, Your action then What was done with its link, Your question then Reply. A reply that asks for a next step carries up to four follow-up buttons, the first in ink; a tap is the final answer and moves the card to Answered. Writing back in the box under the thread is a comment: the card stays in Decide until a final pick.
- `Open the <kind>` (`#inbox/<key>/open`) opens the item; each item links back with `Thread · N new`.
- A reply that lands while the board is open shows a notice at the top for 9 seconds; a tap opens its thread. The server sends the same notice to the configured receiver (`notify:`), linking `#inbox/<key>`.
- On a phone the list is one page and a row opens its thread over it. On a desk (1024px and wider) the list sits beside the open thread, and an item opened from its thread sits beside that thread.

## How to drive and prove it

`node .agents/skills/done-done-verify-sign-off/inbox-shots.mjs <out> <light|dark> <360|390|445|1280|1440>` (journey `inbox`), after `npm run build`. It posts five asks from two agents, a plan, a guided report and a ticket in a throwaway HOME and XDG_*, answers them through the board's API, lets the agents' own waits take them, and has the agents reply with `feedback --reply` (one with a link, one with two `--option` follow-ups) and `--acted`. A headless Chromium of its own over the DevTools protocol at the exact width (844 or 800 high, 2x) captures `inbox`, `thread`, `action`, `answered` (the first follow-up tapped), `notice` (a reply posted while the inbox is open, caught when the 20-second read shows it) and, on a desk, `beside`. Each capture's `.txt` holds the measured sections, chips, pairs and follow-ups; the run fails on a wrong order, a missing pair, sideways overflow, raw ids in the words or a console error.

test/design.test.mjs ("the inbox: one list of every kind") pins the order, the chips and search, the thread's pairs and the Decide rule; test/notifications.test.mjs ("a reply that lands") pins the notice.
