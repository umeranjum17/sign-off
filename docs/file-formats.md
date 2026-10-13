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

- `"readonly": true` beside `"schema"` makes a **read-only board**: a page for
  items another program writes into the file (rewrite it whole: a temp file,
  then a rename). Its cards have no answer, note or comment buttons, there is
  no Ask box, the server refuses every answer, round and comment with 403, and
  the open page checks the file every 20 seconds and redraws when it changed.
  An `interactive` item on it gets most of the screen's height, unless its page
  posts its own height (below).
- `"answers_only": true` instead makes an **answers-only board**, also fed by
  another program: the same Summary and area screens, checked every 20 seconds, but the items
  that ask something take answers and replies. There is no Ask box, and
  **Other answer** has no Another round or comment button; the server refuses rounds, comments
  and prompts with 403. An answer or reply to an item the program dropped
  while the person answered it is still saved. A feeding program writes the
  board with `sign-off-axi post <board> --from <file> --replace`, which checks
  the whole file the way the board reads it and refuses a bad item before
  anything is written; answers stay. A key that was answered may not come back
  with a different title, options or reply: post that question under a new key.
- `.sign-off-vault-id` (0600, in the board's folder, written only by a vault item): holds the random id naming that folder's private vault records; no other command reads it, and vault custody is not enabled in this build.
  Private custody metadata includes `expires`, an absolute integer Unix deadline in milliseconds, authenticated with the encrypted payload. Give defaults to 10 minutes; Receive requires an explicit deadline. New deadlines must be in the future and at most one hour away; the producer must supply an earlier provider deadline when applicable.
  Under the private custody lock, accessing an elapsed pending/ready record writes an `expired` tombstone without ciphertext. Inspect reports that state; deposit/refuse return fixed `EXPIRED` errors, and no terminal key can be recreated. Existing records without a deadline fail validation, rather than gaining a new lifetime.
  This remains an OFF, unwired module with **access-driven expiry only**, including access after restart. Startup/background expiry sweeps and event/wait wakeups without a browser are still required before activation. Deletion is logical, not guaranteed erasure from backups or storage journals.
- A 0.1.0 file, `"schema": 1` with a `"decisions"` list, still reads: each entry is an item, a decision unless it says otherwise. The first write that changes it (a `raise` of a new key, or a `post`) rewrites it as `"schema": 2` (temp file, then rename) and first keeps the old file once beside it as `<board>.schema-1.bak`. Answer and round files are not touched.
- `key`: 1-128 of `A-Z a-z 0-9 . _ -`, unique in the file. `title`: required.
- `recommend_value`: the option the poster would pick; the board shows it first and marks it **Recommended**.
  `raise`, `post` and `raise --from` refuse an item that lists `options` without one; a plain Yes/No may leave it out,
  and a feed written with `post --from <file> --replace` is not held to it.
- `filer`: optional, who filed the item (1-128 of `A-Z a-z 0-9 . _ -`), written by `post --filer`.
  `wait --filer` with the same id returns the answers to that filer's items. The page never shows it.
  `post --from <file> --replace --filer <id>` replaces only the items with that filer (and items with
  no filer the file names by key); every other item, the board's other top-level fields and the answers stay.
- `area`: optional, the board area the item shows in: `waiting`, `evidence`, `reports` or `answered`
  (Waiting on you, Evidence, Reports and explainers, Answered). Without it an `evidence` item is in Evidence;
  an `explainer`, an item with nothing to answer, or any item on a read-only board is in Reports and
  explainers; any other item is in Waiting on you. An answered item is always in Answered. A feed's
  evidence page, an `interactive` item, can say `"area": "evidence"` to count and open under Evidence.
- `steps`: optional, how it works step by step: 2 to 12 entries of a `title` (80 characters or fewer)
  and optional `marks`, each once, from `ai` (AI model), `store` (Stores), `gate` (Gate) and `fail`
  (Hard fail). List only the mark that matters at that step; a step can have none. Reports and
  explainers draws them as numbered steps on a line with the marks under each, and **Open** lists them;
  an item without steps shows a picture of its page there.

  ```json
  { "key": "how-sync", "type": "interactive", "title": "How it works: Notes sync", "view": "mocks/how-sync/index.html", "options": [],
    "steps": [{ "title": "You change a note" }, { "title": "The phone saves it", "marks": ["store"] }, { "title": "It goes to the server", "marks": ["gate"] }] }
  ```
- `group`, `filed`, `decided`: optional, for Reports and explainers. `group` (40 characters or fewer)
  puts items under one section head, such as `How it works`, in the order each group first shows;
  items with no group come last, under `Other reports`. `filed` is an ISO 8601 date-time such as `2026-10-13T07:19:00Z`: the
  section head shows the newest (`Filed 07:19 today`), and the card says `New today` when it was filed
  today or `Current` before that. `decided` (200 characters or fewer) shows under the label
  `What it decided`. An item without them keeps its kind chip and its about line.
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
  size. An interactive item is one `.html` page run in a sandboxed frame; it
  can load files beside it (see `mocks`). Every mock and view
  file is served under a Content-Security-Policy that blocks `fetch`, remote
  files, nested frames and forms, and gives the page no access to the dashboard
  or its tab. A link in the page can still open a web page in its full-size tab.
  To fit its frame to its content, a page can post its height in CSS pixels,
  `parent.postMessage({ height: document.documentElement.offsetHeight }, '*')`,
  again whenever it changes; the frame then takes that height, up to 10000px.
  Only the message from a frame's own page sizes it. Both types
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
  page is loaded with that query, so one page can show each variant. An `.html`
  mock or view loads the files beside it by relative name (`style.css`,
  `img/dot.png`): the board serves `.html`, `.css`, `.js`, `.mjs`, `.svg`,
  `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.woff2`, `.mp4` and `.webm` files
  from inside that page's own folder only, never anything above it. `export`
  inlines the page itself, so those files show only on the running board.
- Every item that asks something has one place to type, folded behind
  **Other answer** after its buttons (a design's Picks too): a short text,
  500 characters or fewer. **Send reply** saves it as the answer `text` with
  the words as its `note`; typed before a button is picked, it goes with that
  answer as its note. On a normal board the same box also asks for
  **Another round** (not on an evidence update) and sends a comment
  (**Send as a comment**). An item with an option valued `text` takes the
  words only as a note: it has no **Send reply**.
- `reply`: optional, `true` lets an item take a text reply with
  `"options": []`, where the reply is the only answer (**Write a reply**); on an
  item with options, the reply also goes to the agent as a comment and stays
  the note of an answer picked after it. No option may use the value `text`
  then.
- `options`: optional, 2 to 6 choices, or `[]` on a read-only or answers-only board for an item that is only shown and waits on nothing (unless it has `reply`). Each has a `value` (1-128 of `A-Z a-z 0-9 . _ -`, unique within the question) and a non-empty `label` shown on its button. Leave it out for **Yes** (`yes`) and **No** (`no`); files written before options existed read exactly as before.
- `recommend_value`, `default_if_silent`: optional, the `value` of one of the question's own options (`yes` or `no` when `options` is left out). Shown, never applied.
- `close`: optional, `done` (default) or `release`; copied into the answer.
- `link`: optional on any item, an `http(s)` link (shown as a link on its card) or a 7-40 character commit hash.
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
- `about`: the short note. `link`: optional, as on any item.
- `media`: 1 to 12 files, each under `evidence/<number>/` and ending in `.png`, `.jpg`, `.jpeg`, `.webp`, `.mp4` or `.webm`, with the `sha256` and `bytes` recorded at post time. The board serves a file only while both still match.
- `options` defaults to **Pass** (`pass`), **Fail** (`fail`) and **Needs work** (`needs-work`); the verdict and its note are saved as an answer.

**Answers**, written by sign-off next to the questions (`decisions.answers.jsonl`, mode 600, one line per click, the latest line per key wins):

```json
{"key":"dark-default","answer":"yes","label":"Yes","close":"done","at":"2026-10-11T09:14:03Z"}
{"key":"release-window","answer":"friday","label":"Friday","close":"done","at":"2026-10-12T04:50:32Z","note":"After the Friday stand-up."}
```

- `answer` is the picked option's `value`, `label` its label at the time of the click. An **Other answer** is saved as
  `"answer":"text","label":"Reply"` with the typed words as its `note`.
- An **Undo** (offered for a few seconds after each tap) is saved as one more line: the answer before the tap, or, when there
  was none, an empty `answer` and `label` (`{"key":"dark-default","answer":"","label":"","close":"done","at":"..."}`), which
  leaves the key unanswered, so the item waits again. An `on_answer:` command gets that line too.
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

**Dismissed items**, written by sign-off next to the questions (`decisions.dismissed.jsonl`, mode 600, one line
per item per tap, the latest line per key wins). **Dismiss** (the × on an item) and **Clear all done** (on Answered) hide
items from the page; **Undo** saves `"dismissed": false`. The agent is not told: an ask it waits on keeps waiting.
A new answer or another round after the line brings the item back. Read-only boards refuse it; answers-only boards take it.
`*.dismissed.jsonl` is git-ignored here like `*.answers.jsonl`.

```json
{"key":"keep-the-weekly-digest","dismissed":true,"at":"2026-10-12T15:41:10Z"}
```

**Taken answers**, written by `wait --filer` next to the questions (`decisions.seen.jsonl`, mode 600):
one line per answer the item's filer took, so the card shows **Seen by agent**. A changed answer is new
again until the filer takes it too.

```json
{"key":"keep-the-weekly-digest","answer":"yes","at":"2026-10-12T15:40:03Z","seen":"2026-10-12T15:40:04Z"}
```

**Comments and queued prompts**, written by sign-off next to the questions
(`decisions.messages.jsonl`, mode 600, oldest first). A comment names its item's `key`; a prompt has none.
`poll` hands each one over once and marks it with a `delivered` line:

```json
{"id":"a17530f156b9","kind":"prompt","text":"Also try a dark header.","at":"2026-10-12T16:26:39Z"}
{"id":"0c1d2e3f4a5b","kind":"comment","key":"sign-in-layout","text":"B's header is too tall.","at":"2026-10-12T16:27:10Z"}
{"delivered":["a17530f156b9","0c1d2e3f4a5b"],"at":"2026-10-12T16:27:12Z"}
```

- `text`: 1 to 2000 characters, trimmed.

**Access token** (`decisions.token`, mode 600): made the first time the board is served beyond `127.0.0.1`
and reused after that. The board reads it on every request, so deleting it shuts old links out at once.
Deleting it, then `stop` and `open` again, makes a new one (`stop` and `open` alone reuse it). `open` prints
it in the link; the server log never holds it. `init` git-ignores `*.messages.jsonl`, `*.token` and
`*.export.html` with the other files sign-off writes.

