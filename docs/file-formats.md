# File formats

**Questions**, written by the agent (`decisions.json`):

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

**Answers**, written by sign-off next to the questions (`decisions.answers.jsonl`, mode 600, one line per click, the latest line per key wins):

```json
{"key":"dark-default","answer":"yes","label":"Yes","close":"done","at":"2026-10-11T09:14:03Z"}
```

`*.answers.jsonl` is git-ignored here so an answer is never committed by accident.

