# Discard

Taking a card off the board with a reason its agent is told: an old design replaced by a newer one, an ask done some other way, a proof no longer relevant.
Phone (390) and desk (1280), light and dark.

## What a user sees

- **Discard on every card** (`xBtn` and `discardSheet` in web/index.html): the × on a card in a list, Discard on a card's own screen (an ask's More, a design's review, a proof, a report, a sign-in). It opens a sheet: the card's title, "It moves to Archived, and <agent> is told why.", then three rows, one tap each: Not relevant, Replaced by newer, Done elsewhere.
- **The toast**: "Discarded · <reason>" with Undo, which stays 10 seconds (`UNDO_MS`). Undo brings the card back.
- **Select in Decide and Designs** (`selectHead`): Decide's More line (Select, answer all or move all to later) and Designs' More hold Select. A tap picks a row (a round check at its end, ink once picked); the title counts the picks with Select all beside it; Cancel and Discard N sit where the dock is on a phone (the dock steps aside) and at the title row's right on a desk. Discard N opens the same reasons for all of them. Designs' More also holds Discard all.
- **Archived** (`archived`, `#ar-sheet`): one quiet line at a list's end, "Archived · N" (Decide, Designs on a phone, Evidence, Reports; a desk's Designs keeps it in More). It opens a sheet of rows: the card, its reason (or when it was filed, for a report archived after a day), the trail's badge (Sent, Delivered, Read) and Restore.
- **Activity**: "Discarded: <reason>", then Delivered to <agent> and <agent> read it.
- Evidence, Reports and Answered keep their own Select and Clear all, which dismiss without a reason.

## Where it comes from

- One line in `<board>.dismissed.jsonl` with `reason` (`not-relevant`, `replaced`, `done-elsewhere`): `POST /api/dismiss` with `reason`, or `sign-off-axi dismiss <key> --reason <r>`.
- The trail (`readTrail`, `readDiscards` in src/store.ts) counts each discard as a send; a restore inside 10 seconds drops it.
- The filer's `wait --filer` hands a discard over once its 10 seconds are over (read); any other wait passes it on (delivered). `answers` and `list --full` show it as `discarded`.

## Drive and prove

`node .agents/skills/done-done-verify-sign-off/discard-shots.mjs <folder> <light|dark> <390|1280>` (journey `discard`) seeds its own board (HOME and XDG_* in a temp folder: four asks, four designs of one dashboard with the oldest already discarded and read by its agent, a proof and a report), serves it, and drives a headless Chromium of its own at 390x844 or 1280x800 (2x).
It saves `sheet` (an ask's Discard), `select-decide`, `select` (two designs picked), `discarded` (after Discard 2 with Replaced by newer: the toast's Undo) and `archived` (the sheet with three discards, each Read) as `<state>.<theme>.<width>w.png`, each with a `.txt` of what the browser measured (no sideways overflow, no cut words but a row's one-line title, the three reasons, Cancel and Discard 2, the dock hidden under the bar, the toast's 10000 ms Undo, no raw reason codes, no console error), and `agent.<theme>.<width>w.txt`: the agent's `wait --filer` output, the ask discarded and undone inside 10 seconds timing out, and the board's trail of discards. It exits 1 on any failed measure.
The regression is test/design.test.mjs ("Discard: every card offers three reasons"); `board-actions.mjs` clicks Discard with a reason and Undo on every card kind, and Select, Discard 1, Select all and Cancel in Decide and Designs.
