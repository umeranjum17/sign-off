# Tickets

A ticket is one piece of work (an id, a title, its progress 0 to 100, optionally the ticket it sits under), kept beside the board in `<board>.tickets.jsonl` and written by `sign-off-axi ticket`. A card names its ticket with `--ticket <id>` on `raise` and `post` (every `--type` and `--kind`) or `"ticket"` in a message. The link is optional and loose: a card without one, or naming a ticket the board has not got, is exactly as before.

## Sub-features

- `ticket`: with no `--id` it lists every ticket and how many cards name it; `--id` alone shows the ticket and its cards newest first (`kind`, `status`); `--title`, `--progress` and `--parent` write one. A new ticket needs `--title`; a later write changes only what it gives. Refused, with nothing written: progress outside 0-100 or not whole, a ticket as its own parent, a blank title, a bad id.
- `--ticket` on every way a card gets in: `raise`, `post --type decision|design|diagram|interactive|evidence|explainer|signin`, `post --kind <any>` (the flag fills the message's `ticket`; a message naming another ticket is refused), and `post --from` (fills each item with none). `--replace` with `--ticket` is refused: a feed puts `ticket` on its items.
- The Ticket row: on an ask (Decide), a sign-in, an evidence update, a design review, a guided report or plan, a report page and a plan page, one row under what the card says: the ticket's title, its id, a bar and the percent, and a chevron. It opens `#ticket/<id>`. On the update screen its label reads like Proof's (upper case). A card with no ticket, or a ticket not on the board, shows no row.
- The ticket's page, `#ticket/<id>`: the ticket above it as a link (`<parent title> › <id>`, else `Ticket · <id>`), the title, a progress bar with `N% done`, Linked (every card naming it, not dismissed, newest first; each row's line says what it is, where it stands and when, and opens where the card lives), and Tickets under it. Back returns to the card the row was tapped on. Both widths, both themes, no sideways scroll.

## Drive

`done-done run ticket` runs every cell. Or one cell: `TICKET_WIDTH=390|1280 node .agents/skills/done-done-verify-sign-off/ticket-shots.mjs <folder> light|dark`.
It seeds the standard board (seed-board.sh, whose cards name no ticket), adds tickets T-9, T-29 (under T-9) and T-30, then one card of each kind on T-29 (an ask, a contract evidence update, a design review, a guided report and a guided plan) and one ask naming T-404, which is not on the board.
It saves `<state>.<theme>.<width>w.png` and `.txt` for each linked card, the same kind unlinked, the unknown-ticket ask, `ticket` (T-29) and `ticket-parent` (T-9); `cli.<cell>.txt` (ticket list and show) and `walk.<cell>.txt` (a tap on the ask's row opens T-29 and Back returns). It fails when a linked screen lacks the row, an unlinked one has it, the page lists the wrong cards or anything scrolls sideways.
Look at every shot: the row sits under the card's words, its title is not cut, and the bar reads in dark.
test/design.test.mjs ("a card names its ticket") is the regression.
