# File formats

**Questions**, written by the agent (`decisions.json`). `sign-off-axi raise` writes them into the board, `~/.sign-off/decisions.json` by default; a file in this format can be raised with `raise --from` or served as its own board:

```json
{
  "schema": 2,
  "items": [
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

- A 0.1.0 file, `"schema": 1` with a `"decisions"` list, still reads: each entry is an item, a decision unless it says otherwise. The first `raise` or `post` into it rewrites it as `"schema": 2` (temp file, then rename) and first keeps the old file once beside it as `<board>.schema-1.bak`. Answer and round files are not touched.
- `key`: 1-128 of `A-Z a-z 0-9 . _ -`, unique in the file. `title`: required.
- `type`: optional, `decision` (default), `design`, `evidence`, `diagram`,
  `interactive` or `explainer`. A design item
  is a pick between mock options shown side by side. An evidence item is a
  numbered update the person gives a verdict on (below). Any other lowercase
  word (1-32 of `a-z 0-9 -`, starting with a letter) also loads; the dashboard
  shows it as a plain card with its options until that type has its own view.
- `view`: required on `diagram` and `interactive` items, the path of one file
  relative to the board file's folder (keep it under `mocks/<key>/`), served only
  from inside that folder. A diagram is an image (`.svg`, `.png`, `.jpg`,
  `.jpeg`, `.webp`, 5 MB or less) shown at card width; tap it to open it full
  size. An interactive item is one self-contained `.html` page (inline CSS and
  JS, images as `data:` URLs) run in a sandboxed frame. Every mock and view
  file is served under a Content-Security-Policy that blocks `fetch`, remote
  files, nested frames and forms, and gives the page no access to the dashboard
  or its tab. A link in the page can still open a web page in its full-size tab. Both types
  answer like a decision: Yes/No by default, or their own `options`.

  ```json
  { "key": "sign-in-flow", "type": "diagram", "title": "Is this the sign-in flow?", "view": "mocks/sign-in-flow/flow.svg" }
  ```
- `explainer` items carry one narrated video the agent made: `media` holds one
  `.mp4` or `.webm` file under `evidence/<number>/`, with its `sha256` and
  `bytes`, copied there by `post --type explainer` and served the same
  hash-checked way as evidence media. `about` is its short summary.
  `chapters` is optional: 1 to 12 entries of `at` (whole seconds, each later
  than the one before) and `title` (120 characters or fewer); each shows as a
  button that plays the video from there. It answers like a decision.

  ```json
  { "key": "sign-in-tour", "type": "explainer", "title": "Is the new sign-in clear?", "about": "The new sign-in has 2 steps.",
    "media": [{ "path": "evidence/3/1.mp4", "sha256": "<64 hex>", "bytes": 358743 }],
    "chapters": [{ "at": 0, "title": "Start" }, { "at": 12, "title": "Step 2" }] }
  ```
- `tradeoff`: optional on design items, plain text up to 1000 characters, shown
  next to the mocks.
- `mocks`: optional on design items, up to 6 entries of an option `value` and a
  `path` to a mock file (`.html`, `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`), relative to the board file's folder. Each value must
  name one of the item's own options. Served only from inside that folder. An
  `.html` path may end in `?variant=<name>` (1-64 of `A-Z a-z 0-9 . _ -`): the
  page is loaded with that query, so one page can show each variant.
- `options`: optional, 2 to 6 choices. Each has a `value` (1-128 of `A-Z a-z 0-9 . _ -`, unique within the question) and a non-empty `label` shown on its button. Leave it out for **Yes** (`yes`) and **No** (`no`); files written before options existed read exactly as before.
- `recommend_value`, `default_if_silent`: optional, the `value` of one of the question's own options (`yes` or `no` when `options` is left out). Shown, never applied.
- `close`: optional, `done` (default) or `release`; copied into the answer.
- Other keys are ignored.
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

**Evidence updates**, written by `sign-off-axi post --type evidence`, which
also copies each file into `evidence/<number>/` next to the board:

```json
{
  "key": "update-2",
  "type": "evidence",
  "number": 2,
  "title": "Sign-in flow on a phone",
  "about": "Umer signs in on a phone. The screen loads in 1 second.",
  "link": "https://github.com/acme/app/pull/12",
  "media": [
    { "path": "evidence/2/1.png", "sha256": "<64 hex>", "bytes": 48213 },
    { "path": "evidence/2/2.mp4", "sha256": "<64 hex>", "bytes": 912004 }
  ]
}
```

- `number`: whole number from 1. `post` takes the next number whose `evidence/<number>/` folder and `update-<number>` key are both free (boards in one folder share `evidence/`) and sets `key` to `update-<number>`.
- `about`: the short note. `link`: optional, an `http(s)` link or a 7-40 character commit hash.
- `media`: 1 to 12 files, each under `evidence/<number>/` and ending in `.png`, `.jpg`, `.jpeg`, `.webp`, `.mp4` or `.webm`, with the `sha256` and `bytes` recorded at post time. The board serves a file only while both still match.
- `options` defaults to **Pass** (`pass`), **Fail** (`fail`) and **Needs work** (`needs-work`); the verdict and its note are saved as an answer.

**Answers**, written by sign-off next to the questions (`decisions.answers.jsonl`, mode 600, one line per click, the latest line per key wins):

```json
{"key":"dark-default","answer":"yes","label":"Yes","close":"done","at":"2026-10-11T09:14:03Z"}
{"key":"release-window","answer":"friday","label":"Friday","close":"done","at":"2026-10-12T04:50:32Z","note":"After the Friday stand-up."}
```

- `answer` is the picked option's `value`, `label` its label at the time of the click.
- `note`: present only when the person typed one. Optional free text, trimmed, up to 500 characters, sent with the click. Picking the same answer again with a changed note adds a new line; clearing the note and clicking again removes it. Lines without `note` (all lines written before notes existed) read as before.
- `sign-off-axi answers --json` prints the same fields per key, without `key`, and adds `note` only when the latest line has one.

`*.answers.jsonl` is git-ignored here so an answer is never committed by accident.

**Another-round asks**, written by sign-off next to the questions
(`decisions.rounds.jsonl`, mode 600, one line per ask, oldest first):

```json
{"key":"sign-in-layout","note":"Show B with the A header.","at":"2026-10-12T15:40:03Z"}
```

- Asking wakes a waiting agent the same way an answer does. `answers --json`
  adds a `rounds` list per answered key only when that key has asks.

