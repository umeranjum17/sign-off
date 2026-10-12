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
    }
  ]
}
```

- `key`: 1-128 of `A-Z a-z 0-9 . _ -`, unique in the file. `title`: required.
- `options`: optional; only `yes` and `no` for now, each with a `label`.
- `recommend_value`, `default_if_silent`: optional, `yes` or `no`. Shown, never applied.
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
```

`*.answers.jsonl` is git-ignored here so an answer is never committed by accident.

