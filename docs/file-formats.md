# File formats

**Questions**, written by the agent (`decisions.json`). `sign-off-axi raise` writes them into the board, `~/.sign-off/decisions.json` by default; a file in this format can be raised with `raise --from` or served as its own board:

```json
{
  "schema": 1,
  "decisions": [
    {
      "key": "dark-default",
      "title": "Turn on dark mode by default for new users?",
      "about": "Most test users switch to dark within a day.",
      "detail": "Changes the first-run default only.",
      "recommend_value": "yes",
      "default_if_silent": "no"
    },
    {
      "key": "release-window",
      "title": "When should the new sign-in screen go out?",
      "options": [
        { "value": "today", "label": "Today" },
        { "value": "friday", "label": "Friday" },
        { "value": "next-week", "label": "Next week" }
      ],
      "recommend_value": "friday"
    }
  ]
}
```

- `key`: 1-128 of `A-Z a-z 0-9 . _ -`, unique in the file. `title`: required.
- `options`: optional, 2 to 6 choices. Each has a `value` (1-128 of `A-Z a-z 0-9 . _ -`, unique within the question) and a non-empty `label` shown on its button. Leave it out for **Yes** (`yes`) and **No** (`no`); files written before options existed read exactly as before.
- `recommend_value`, `default_if_silent`: optional, the `value` of one of the question's own options (`yes` or `no` when `options` is left out). Shown, never applied.
- `close`: optional, `done` (default) or `release`; copied into the answer.
- `type`: optional, `decision` only. Other keys are ignored.
- `evidence`: optional read-only link to a done-done schema 1 run. Set `run_id`, its full 40-character `commit`, and the four plain-text Checks lines (`outcome`, `repro`, `proof`, `evidence`), each non-empty trimmed text up to 1000 characters. Start `serve` with `--evidence-root <store-root>` (the directory containing `.done-done/`); the board only reads that root and only opens media listed and hash-matched in that run record. The card reports the run command outcome, not a persisted claim-check receipt. done-done has no receipt schema yet; a missing or mismatched record stays **UNVERIFIED**.

```json
"evidence": {
  "run_id": "20261011T120000Z-a1b2c3d4",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "outcome": "Umer can see the updated sign-in screen.",
  "repro": "repro: n/a: no bug",
  "proof": "verify-sign-off: real browser journey",
  "evidence": "after.png, walkthrough.mp4"
}
```

**Answers**, written by sign-off next to the questions (`decisions.answers.jsonl`, mode 600, one line per click, the latest line per key wins):

```json
{"key":"dark-default","answer":"yes","label":"Yes","close":"done","at":"2026-10-11T09:14:03Z"}
{"key":"release-window","answer":"friday","label":"Friday","close":"done","at":"2026-10-12T04:50:32Z","note":"After the Friday stand-up."}
```

- `answer` is the picked option's `value`, `label` its label at the time of the click.
- `note`: present only when the person typed one. Optional free text, trimmed, up to 500 characters, sent with the click. Picking the same answer again with a changed note adds a new line; clearing the note and clicking again removes it. Lines without `note` (all lines written before notes existed) read as before.
- `sign-off-axi answers --json` prints the same fields per key, without `key`, and adds `note` only when the latest line has one.

`*.answers.jsonl` is git-ignored here so an answer is never committed by accident.

