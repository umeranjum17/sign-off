# Tickets

Tickets are not kept on the board. The Tickets screens, `sign-off-axi ticket` and the board's `/api/tickets` routes read and write them only through the ticket adapter: one executable, named by `SIGN_OFF_TICKETS_ADAPTER`, called as `adapter <operation>` with one JSON request on stdin and one JSON response on stdout (`docs/ticket-adapter.md`). The board writes no ticket file and keeps no cache; every read is another call, and a failed call is shown as the adapter said it.

## Sub-features

- `ticket`: no flag lists every ticket (`--json` gives them as the adapter sent them, with the keys of the cards that name each); `--id` shows one with its cards; `--fields` prints the adapter's `describe`; `--create --set title=...`, `--id <id> --rev <rev> --set k=v --unset k`, `--history` and `--text <words>` write or read through the adapter. A write carries `--op-id` (the CLI makes one) so a repeat is safe. `--id <id> --comment '<json>'` still records a comment the person made in the fleet dashboard, in `<board>.ticket-comments.jsonl`.
- `--ticket <id>` on every way a card gets in (`raise`, `post`); it is a loose reference, never checked at post time. A card's screen shows a Ticket row with the id, which opens the ticket's page; the ticket's page lists the cards that name it.
- The Tickets screen (`#tickets`), with three tabs: Tickets (grouped by `status` in the order `describe` lists them, a filter drawn from the fields `describe` gives words for, counts from the list just read), Epics (`#epics`, tickets that others name as `parent`) and Activity (`#activity`, the `history` of the tickets that changed last; "This backend keeps no history." when `describe` lacks `history`).
- A ticket (`#ticket/<id>`): its fields as `describe` names them, the body, every key of `extra` and every top-level key the board does not know under More fields, links, the tickets under it, the cards that name it, its history and a comment box where the backend has `comment`.
- New ticket (the round + in the header, `c` on a desk) and Edit are drawn from `describe`; an edit sends only the changed fields with the `rev` that was read. `invalid` marks the fields the adapter named and keeps every word typed; `conflict` shows the adapter's current version beside the person's ("Now", "Yours") with Save over theirs and Discard mine. There is no delete.
- A failed read shows the adapter's `code: message` with Retry and no rows. A list the adapter does not vouch for (`complete` not true) is `incomplete`, with no rows, never a partial list.
- Where a status, kind or label word comes from: the adapter. The board holds none.

## Drive

`node .agents/skills/done-done-verify-sign-off/tickets-adapter-shots.mjs <folder> <light|dark> <390|1280>` (journey `tickets-adapter`, one width and theme per run), after `npm run build`. It serves a throwaway board against the stand-in adapter on its own Chromium at exact device metrics (390 is a 2x mobile emulation) and captures the list, a ticket with More fields, a conflict, a failure and an incomplete list, one png each, with `steps.json`. Look at every capture: the group headings are the stand-in's own words, a failure reads `unavailable:` with the adapter's message and a Retry button and no rows, and a conflict has both versions with the person's text still in the form.

Tests: `test/tickets.test.mjs` (the CLI and the API against the stand-in: an unknown field, a conflict, a failure, `incomplete`, no ticket file, a patch rather than a rewrite) and `test/ticket-adapter.test.mjs` (the interface itself).
