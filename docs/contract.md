# Communication contract, v1

sign-off owns this contract. Agents and tools use it to post asks, reports, evidence, gates, retro findings and plans to the board, and to read the answers back. Every message has the same strict shape, so the person reading the board sees one kind of card per kind of message, whoever sent it.

Status: v1 target, built in parts. Built: six kinds, `ask`, `report` (schema 2, a page), `evidence`, `gate`, `finding` and `plan` (stored and answered; the board does not draw a plan card or page yet); `validate`, with `--expect-invalid` (section 9), and their fixtures in the npm package; `post --kind`, from a file or stdin with `--from -`, where a key conflict exits 2; in a `raise --from` or `post --from` file, a new item that carries `contract` or `kind` is checked as a message before anything is stored, a new item of a contract kind without `kind` is refused, and a new item's title is held to 1-160. New contract evidence is posted with `post --kind evidence`, never in a `--from` file; `post --type evidence` keeps the board format. Answer events are built: `wait --events` and the contract fields on `on_answer` (section 7). The question standard on `ask` (section 5) is built, and `raise --title` and `post --type decision` check every new question against it. Not built yet: `schema`. `raise --title` and `post --type decision` still post board-format items (they do not fill in `contract`, `kind` and `schema` yet), and their key conflicts still exit 1.

## 1. Versions

- One contract, `"contract": 1`. Six kinds: `ask`, `report`, `evidence`, `gate`, `finding` and `plan`.
- Each kind has its own `"schema"` number, starting at `1`. Every message carries `contract`, `kind` and `schema`.
- Strict: an unlisted field, a wrong type or a broken limit refuses the whole message, at every level (options, `run`, `media`). Nothing is dropped quietly, and nothing is stored or shown half-valid.
- Inside one `contract`, `kind` and `schema`, no field is added, removed, renamed or retyped. Any such change is a new `schema`.
- sign-off-axi accepts only the schemas it ships. Any other `schema` number is refused with the fix "upgrade sign-off-axi".
- The board file keeps its own `"schema": 2`. A posted message is stored as a board item that keeps its `kind` and `schema`.
- Producers pin an exact version in CI, for example `npx -y sign-off-axi@0.3.0`.

## 2. Items already on a board

Board items stored before v1 have no `kind` or `schema`. They read exactly as today, under [file-formats.md](file-formats.md), and are not checked again, so existing boards and answers keep working. Their answers report as `ask` schema 1.

Every new post of a contract kind is checked against that kind's v1 rules from the change that adds that kind. `post --kind` posts a message of any built kind. The target is for `raise --title` and `post --type decision`, which is the same thing, to post an `ask` with `contract`, `kind` and `schema` filled in, and for `post --type evidence` to post an `evidence` the same way; until then they post board-format items (see Status). `raise` stamps `filed` itself where a kind needs it.

Non-contract types stay outside this contract. `raise --title` and `post --type design|diagram|interactive|explainer|signin` keep the board rules in [file-formats.md](file-formats.md). In a `--from` file, a new item of a contract kind with no `kind` is refused with a fix line to add `contract`, `kind` and `schema`, in a `--replace` feed too. New evidence, with or without `kind`, is refused there with a fix line to post it with `post --kind evidence`: its media files are copied and numbered one message at a time. A contract kind there is an item with no `type`, or `type` `decision` or `ask` (both an `ask`), `evidence` or `report`. An item already on the board under that key is not new, so a feed keeps sending it as it is, and it is not checked again — except in a `--replace` feed, which replaces the stored item: a contract message that changed is checked against its kind's v1 rules again, so one that no longer matches is refused, with the board left unchanged, instead of being stored half-broken. An item whose message did not change is not checked again.

## 3. How a message gets in

One validator, one way in. No daemon, socket or HTTP API.

`sign-off-axi post [board.json] --kind <kind> --from <file.json>`, or `--from -` to read stdin. `--kind` must equal the message's `kind`, so the wrong file is never posted. A `post --from --replace` feed checks each new contract-kind item the same way, except evidence (section 2). A --replace feed is a whole-board resync: it does not refuse a contract item whose key holds a different message, it replaces it, re-checking a changed contract message against its kind's rules (section 2). An answer stays with the question it was given for: in a `--replace` feed an answered item whose title, options, reply, run (for a gate), finding (for a finding), or media or run (for evidence) changed is refused. Known limit: ask `about`/`detail` changes are not part of that comparison. And once an item's key has left the board, an answer recorded for it does not re-attach for any contract kind — the re-added item is refused, and is posted under a new key (section 5).

`raise --from` and `post --from` (no `--kind`) check each new item that carries `contract` and `kind` the same way `post --kind` does, and refuse a new item with no `kind` unless it names a non-contract type (section 2).

A message file holds one JSON object, in any layout. The validator reads it with a parser that reports repeated fields. A repeated field refuses the message with one fix line naming the field, such as `Remove the second "recommend_value".` A message with no `kind` is refused (section 2). `null` is a wrong type for every field.

| Producer | Kinds it sends |
|---|---|
| An agent, alone or under a supervisor | `ask`, `report`, `plan` |
| done-done | `evidence`, `gate` |
| learn-from-mistakes | `finding` |

## 4. Field rules

- Text is a JSON string with at least one character that is not whitespace. It is stored as given; its length counts the Unicode code points of the whole value. Control characters other than newline are refused, and so is an unpaired surrogate (half of a character, such as `"\ud800"`).
- A whole number is a JSON number from 0 to 9007199254740991 with no fractional part (`4.0` reads as 4). `"4"` is refused.
- `contract` is `1`. `schema` is a whole number (section 1).
- A key-set id is 1-128 of `A-Z a-z 0-9 . _ -`, case-sensitive.

| Field | Kinds | Rule |
|---|---|---|
| `contract`, `kind`, `schema` | all, required | as above |
| `key` | all, required (optional on `evidence`) | a key-set id, unique on the board |
| `title` | all, required | text, 1-160 |
| `filer` | all, optional | a key-set id: the agent session id or tool name |
| `link` | all, optional | `http://` or `https://` followed by 1-500 characters with no whitespace, control character (C0, DEL or C1) or unpaired surrogate, or a 7-40 character lowercase hex commit |
| `about` | all, required (optional on `ask`) | text, 1-500 |
| `detail` | `ask`, optional | text, 1-1000 |
| `why` | `ask`, required | text, 1-200: what it is about and why it needs an answer now |
| `options` | `ask`, `gate`, `finding`, required | 2-6 (2 or 3 on `gate`, exactly 2 on `finding`, section 5) objects of exactly `value` (a key-set id, unique in the message) and `label` (text, 1-80); on an `ask` each also has `outcome` (text, 1-120): what happens next if it is picked |
| `recommend_value` | `ask`, `gate`, `finding`, required | one listed option `value` |
| `recommend_reason` | `ask`, required | text, 1-160: why that option, in one line |
| `default_if_silent` | `ask`, required | one listed option `value`; shown, never applied |
| `silent_by` | `ask`, optional | an ISO 8601 UTC time, `YYYY-MM-DDTHH:MM[:SS]Z`: when the silent default would be taken |
| `close` | `ask`, `gate`, optional | `done` (default) or `release`; copied into the answer |
| `merges` | `ask`, optional | 1-10 distinct keys of other items on the same board that this ask replaces, never its own; each must offer every option of this ask and merge nothing itself; a key named by an ask not yet answered, open or dismissed, cannot be named again, and an answered or dismissed card cannot be named |

When `filer` is missing, `post` takes it from `--filer`, else `SIGN_OFF_FILER` (empty means unset), else the agent session id. A `filer` in the message that differs from `--filer` is refused. Only `post` checks this; `validate` checks `filer` only when the message has one.

A key already on the board takes only the same message again (the same fields and values, in any order, with the same `filer`), which changes nothing. "In any order" refers to the order of fields; the order of options is part of the message, because it is the order the user sees, so the same options listed in another order are a different message. A message that names no `filed` matches the time the board stamped; a board-format item under that key is not the same message. Anything else under that key is refused with code `CONFLICT`, exit 2 and the help line "Post it under a new key". Today's CLI exits 1 on `CONFLICT`; this contract changes that, so every refusal exits 2.

## 5. One shape per kind

### ask, schema 1

A question the person answers by picking an option. Shows in Waiting on you.

- Fields: the common ones, `about`, `detail`, `why`, `options` (each with an `outcome`), `recommend_value`, `recommend_reason`, `default_if_silent`, `silent_by`, `close`, `merges`.
- A yes/no ask lists `yes` (Yes) and `no` (No) as its options, labelled exactly so.
- Asking a good question. One decision is one card, and the card passes a 10-second read on a phone:
  - `title` is one plain question the buttons answer: it ends in `?` and has 12 words or fewer. No robot prefix (`Say yes or no:`, `Captain hold:` or a leading `Captain:`, in any case) and no key-like word (a lowercase word joined by `-`, `_` or `/` that has a digit, underscore or slash in it, such as `ship-signin-2`, `ship_1` or `ch/cloud`). A robot prefix is refused only at the start of the title.
  - `why` says in 1 or 2 short lines what it is about and why it needs an answer now.
  - The buttons are exactly the choices in the text. When `title`, `why`, `about` or `detail` names lettered choices in a choice form (`Option B`, `A:`, `A.`, `A)` or `(A)`), there is one option per letter, each label starting with its letter (`A: Today` or `Option A`), and `yes`/`no` options are refused. A question never takes acknowledgement buttons (Done, OK, Not now, Got it, Noted, Seen, Dismiss).
  - Every option's `outcome` says what happens next, in one line. `recommend_value` with `recommend_reason` marks one option Recommended and says why.
  - `default_if_silent` says what happens if no one answers; `silent_by` says when. The card shows "If you stay quiet: <label>, at <time>", or "If you stay quiet: <label> (no deadline)" when there is no `silent_by`.
  - Every refusal names the field and gives one fix line. Items already on a board are not checked again (section 2).
- One decision, one card. Before posting, look at the open cards. When the same decision is already there, wait on that card, or post one ask whose `merges` names the other keys. While the ask is shown (open, not dismissed, not answered), the board hides the merged items; a dismissed or answered ask hides none. A merged item merges nothing itself, so a chain is refused at post time. When it is answered, the board writes one answer line per merged key that is on the board and has no answer of its own, with the same value and label, that item's own `close`, and the note `Answered with <key>`; a merged card that does not offer that value gets no line, and a Reply goes to each as a reply. A re-answer changes only the parent: a merged card that already has an answer, its own or one an earlier fan-out wrote, is never overwritten, and an Undo clears only the lines this ask wrote. A card is named by one ask until that ask is answered: a second ask may not name a card a dismissed or open ask still names, and a merge may not name an answered or dismissed card: both are refused at post time.
- An answered ask keeps its title, options and reply: an answered ask cannot take another one, not even in a `--replace` feed. Known limit: `about`/`detail` changes are not part of that comparison. A dropped answered ask key cannot come back in a `--replace` feed; post it under a new key.
- Design picks, diagrams, interactive pages and explainers are not v1 kinds. They post with `post --type` under the board rules in [file-formats.md](file-formats.md), outside this contract.

### report, schema 2

An explainer the person reads: made when they asked for an explanation, or when a concept, design or trade-off must be understood. It takes no answer. Shows in Reports and explainers, as a card with its picture; a tap opens its page over the whole board. Proof that something works is `evidence`. A merge, a PR outcome, a receipt or a status note is never a report.

- Required: the common fields, `about`, `filed` (a real UTC date and time, exactly `YYYY-MM-DDTHH:MM:SSZ` with seconds 00-59, such as `2026-10-13T07:19:00Z`), `view` and `preview`.
- `view`: the page, a relative `.html` path of 1-256 characters with no `..`, `?`, `#` or `\`. `preview`: its picture on the card, `.svg`, `.png`, `.jpg`, `.jpeg` or `.webp`, in the same folder. `post` reads both from the board file's folder (as `--view` does) and `validate` from the message file's folder; symlinks are followed and the real path must stay inside it, each a file of 5,000,000 bytes or fewer.
- The page is filled in the shape `sign-off-axi report init <folder>` writes: no `FILL:` line left (in the picture either), a viewport tag, a dark mode (`prefers-color-scheme`), a picture or diagram, something to tap or slide (a button, input or select), its detail folded in `<details>`, nothing loaded from the web, and no paragraph or list item over 240 characters (about five lines on a phone). The first rule a page breaks refuses it with one fix line.
- Optional: `group` (text, 1-40), `decided` (text, 1-200).
- Schema 1, a report of text only, is refused with the fix line naming `sign-off-axi report init <folder>`. A schema 1 report already on a board still loads and is not checked again; the board folds it under Notes, never as a report card.
- `post --type report --title --about --view --preview` posts the same message from flags, with `filed` set to the time of the first post.
- No `options` key, not even `[]`: it is refused with the fix "post an ask to get an answer". On the board it is stored with no options, shows under Reports and explainers on any board, and never waits. A stored report that carries `options`, `reply`, `area` or `type` is refused when the board is read, the same way.

### plan, schema 1

An agent's plan the person reviews before the work starts: each section approved or changed with a note, each decision answered. It is not a report, because it takes answers. `post --kind plan` (or a `--from` feed) stores it as item type `plan`, with its sections, decisions, steps and view, under Waiting on you until it is sent back; a new item with `type` `plan` and no `kind` is refused.

- Required: the common fields, `about` (the plan, answer first), `sections`, `decisions` and `view`.
- `sections`: 1 to 8 objects of exactly `id` (1-40 of `a-z 0-9 -`, unique in the plan), `heading` (text, 1-80) and `body` (text, 1-1000), such as goals and non-goals, architecture, slices and order, coding standards, risks.
- `decisions`: 0 to 5 objects of exactly `key` (a key-set id, unique in the plan), `question` (text, 1-160: one question of 12 words or fewer, with one question mark (`?` or `？`) as its last character; `"Keep A? Or B?"` is refused), `why` (text, 1-500), `options` (2-6 ask options, each also with `outcome`, text 1-200: what picking it leads to) and `recommend` (one listed option `value`).
- `view`: the one page, with the direction diagram, held to the report page rules: `validate` checks the path, not the file; `post` and `--from` check the file, which must be 5 MB or less, inside the board file's folder, with a viewport, dark mode, a picture or diagram, something to tap, folded detail, no web links and blocks of 240 characters or fewer. A plan has no preview. Optional: `steps`, 2 to 12 tap-through steps, each exactly `title` (text, 1-80). The message lists step titles only; each step's explanation lives on the plan's view page.
- No `options` key: a plan's answers come from its sections and decisions, so top-level `options` is refused with a fix line to put each question in `decisions`.

### evidence, schema 1

Proof the person gives a verdict on. Shows in Evidence. Its options are fixed and not in the message: `pass` (Pass), `fail` (Fail) and `needs-work` (Needs work).

- Required: the common fields (`key` is optional), `about`, and at least one of `media` or `run`.
- `media`: 1 to 12 relative file paths, with no `..`, resolved from the message file's folder (from the current folder for `--from -`). Symlinks are followed: the real path must stay inside that folder, else the message is refused with a fix line naming the file. Each path ends in `.png`, `.jpg`, `.jpeg`, `.webp`, `.mp4` or `.webm` (any case), each 50,000,000 bytes or fewer. `post` copies them into `evidence/<number>/` and records each `sha256` and `bytes`. A missing or oversized file refuses the message. `validate` checks the same and copies nothing.
- `run`: a done-done run, exactly `run_id` (a key-set id), `commit` (40 lowercase hex) and the four Checks lines `outcome`, `repro`, `proof` and `evidence` (text, 1-1000 each). The board stores it in the item's `evidence` field ([file-formats.md](file-formats.md)); `link` stays its own field.
- Without `key`, `post` sets `update-<number>`, where `<number>` is the next free `evidence/<number>/` folder next to the board. A key already on the board takes the same message again only when its media also match by file hash (section 4). Its media and run are part of the question, as a gate's run is: under the key other media or another run is a different message in a `--from` feed too, and an answered evidence item cannot take other media or another run, not even in a `--replace` feed.

### gate, schema 1

A run held for the person's approval. Shows in Waiting on you.

- Required: the common fields, `about`, `run` (exactly `run_id` and `commit`, with the evidence rules), `options`, `recommend_value`.
- `options`: 2 or 3, in any order, from `approve` (Approve), `skip` (Skip the judge) and `fix` (Fix first). Labels must match exactly. They are the actions of `done-done respond --action`.
- Optional: `close`.
- The board keeps `run` on the item as sent. The card is a question in Waiting on you with the gate's title, about and actions; it does not show the run id or commit yet.
- `run` is part of the question: under the gate's key another run is a different message in a `--from` feed too, and an answered gate cannot take another run, not even in a `--replace` feed, since the answer belongs to the run it was given for. A dropped answered gate key cannot come back in a `--replace` feed; post it under a new key.

### finding, schema 1

A repeated cause from a retro, with a proposed change. Shows in Waiting on you.

- Required: the common fields, `about`, `cause` (1-64 of `a-z 0-9 -`), `incidents` and `days` (whole numbers, 0 or more), `evidence_ids` (0 to 50 unique key-set ids), `change_kind` (`doc`, `rule` or `code`), `proposal` (text, 1-500), `options`, `recommend_value`.
- `options`: exactly `apply` (Apply) and `skip` (Skip), in any order. Labels must match exactly.
- No record text. `about` gives counts only and `evidence_ids` names records without quoting them. The validator checks every rule above but cannot see record text; keeping it out is the producer's job.
- The board keeps the finding's fields on the item as sent. The card is a question in Waiting on you with the finding's title, about, Apply and Skip; it does not show the proposal yet (section 12).
- The proposal, with its cause, counts and records, is part of the question, as a gate's run is: under the key another one is a different message in a `--from` feed too, an answered finding cannot take another one, not even in a `--replace` feed, and a dropped answered finding key cannot come back in a `--replace` feed; post it under a new key.

## 6. Worked examples

One per kind, each written on one line here. Demo data uses the name Umer.

```json
{"contract":1,"kind":"ask","schema":1,"key":"ship-signin-2","title":"Ship the new sign-in screen this week?","filer":"agent-41","about":"Slice 5 passed its checks.","why":"The screen is ready and the release goes out Friday.","options":[{"value":"yes","label":"Yes","outcome":"It ships to everyone on Friday."},{"value":"no","label":"No","outcome":"It waits for next week's release."}],"recommend_value":"yes","recommend_reason":"Every check passed on 3 phones.","default_if_silent":"no","silent_by":"2026-10-17T16:00Z","close":"done"}
{"contract":1,"kind":"ask","schema":1,"key":"release-day","title":"Which day should the release ship?","filer":"agent-41","why":"Two fixes are still in review: A, B or C.","options":[{"value":"a","label":"A: Today","outcome":"It ships now, without the 2 fixes."},{"value":"b","label":"B: Friday","outcome":"It ships with both fixes."},{"value":"c","label":"C: Next week","outcome":"It waits for the redesign too."}],"recommend_value":"b","recommend_reason":"Both fixes land by Thursday.","default_if_silent":"b","merges":["release-friday"]}
{"contract":1,"kind":"report","schema":2,"key":"new-sign-in","title":"How the new sign-in works","filer":"sign-off-builder","about":"Sign-in now asks for a code after the password, so a stolen password alone opens nothing.","filed":"2026-10-13T07:19:00Z","group":"Sign-in","decided":"Umer keeps the code step.","view":"mocks/new-sign-in/index.html","preview":"mocks/new-sign-in/preview.svg"}
{"contract":1,"kind":"evidence","schema":1,"title":"Sign-in screen on a phone","filer":"done-done","about":"Umer signs in on a phone. The screen loads in 1 second.","media":["evidence-out/after.png"],"run":{"run_id":"20261011T120000Z-a1b2c3d4","commit":"0123456789abcdef0123456789abcdef01234567","outcome":"Umer can see the updated sign-in screen.","repro":"repro: n/a: no bug","proof":"done-done: real browser journey","evidence":"after.png"}}
{"contract":1,"kind":"gate","schema":1,"key":"dd-gate-a1b2c3d4","title":"Move the sign-in run on past its judge?","filer":"done-done","about":"The judge could not tell the screens apart.","run":{"run_id":"20261011T120000Z-a1b2c3d4","commit":"0123456789abcdef0123456789abcdef01234567"},"options":[{"value":"approve","label":"Approve"},{"value":"skip","label":"Skip the judge"},{"value":"fix","label":"Fix first"}],"recommend_value":"fix","close":"done"}
{"contract":1,"kind":"plan","schema":1,"key":"plan-filter-waiting","title":"Filter Waiting on you by type","about":"Umer can show only one type of question at a time.","sections":[{"id":"goals","heading":"Goals","body":"Add a type filter above Waiting on you."}],"decisions":[{"key":"default","question":"Show every type when the board opens?","why":"A remembered filter can hide a new question.","options":[{"value":"all","label":"All types","outcome":"Nothing is hidden on open."},{"value":"last","label":"Last filter","outcome":"The board opens as Umer left it."}],"recommend":"all"}],"view":"mocks/plan-filter-waiting/index.html"}
{"contract":1,"kind":"finding","schema":1,"key":"lfm-missing-env","title":"Repeated cause: missing env var in CI","filer":"learn-from-mistakes","about":"4 incidents over 3 days in 2 sources.","cause":"missing-env","incidents":4,"days":3,"evidence_ids":["rec-7f3a","rec-91be"],"change_kind":"doc","proposal":"Add the env var to the CI setup page.","options":[{"value":"apply","label":"Apply"},{"value":"skip","label":"Skip"}],"recommend_value":"apply"}
```

## 7. Answers

- `wait --filer <id>` without `--key` returns the answers to that filer's items it has not taken yet. With `--key`, it returns that key's answer even if it was taken before. Either way it marks each answer it returns as taken, so a later `wait --filer <id>` without `--key` does not return it again. Each answer is taken once; a changed answer is new again. Another-round asks wake it too: the person taps **Another round** on an answered item and types a note.
- `wait --filer <id> --events` prints one event line per answer and per another-round ask:

  ```json
  {"event":"answer","contract":1,"kind":"ask","schema":1,"key":"ship-signin-2","title":"Ship the new sign-in screen this week?","answer":"yes","label":"Yes","close":"done","at":"2026-10-13T08:00:00Z","filer":"agent-41","note":"Go."}
  {"event":"round","contract":1,"kind":"ask","schema":1,"key":"ship-signin-2","title":"Ship the new sign-in screen this week?","note":"Show it on a phone first.","at":"2026-10-13T08:05:00Z","filer":"agent-41"}
  ```

- An `answer` event has `event`, `contract`, `kind`, `schema`, `key`, `title`, `answer`, `label`, `close` and `at`. A `round` event has `event`, `contract`, `kind`, `schema`, `key`, `title`, `note` and `at`, and `filer` when the item has one.
- `note` is added to an answer only when the person typed one. `filer` is added only when the item has one. `close` is `done` on kinds that do not take it. An `evidence` answer's `label` is Pass, Fail or Needs work.
- An answer or round that carried comments on mock elements also has `comments`, as on `on_answer` below, since a round may carry only comments and an empty `note`.
- `--events` needs `--filer <id>` (or `SIGN_OFF_FILER`): it prints a filer's answer events, so a wait without one is refused (exit 2).
- Lines come oldest first, by `at`. `--events` does not take `--json` or `--full`. A private vault item that expired or was refused still reaches a filer wait as it does without `--events` (exit 1, no event line).
- `wait --json` and `answers --json` keep their map keyed by item key, so existing readers keep working.
- An `on_answer:` command in `config.yaml` keeps every field it gets today (`key`, `answer`, `label`, `close`, `at`, `note`, `title`, `filer`) and gains `event`, `contract`, `kind` and `schema`. An answer line that carried comments on mock elements also has `comments`, each with `id`, `mock`, `hash`, `ref`, `tag`, `words` and `text`. An Undo back to no answer still reaches it, with `"answer": ""`; `wait` never returns one.
- A plan's answer is its one send-back, which the board saves from `POST /api/answers` with `{"key", "notes", "decisions"}`: `"answer": "sent"`, `"label": "Sent back"`, plus `notes`, one per section in plan order, each `section` (its id), `verdict` (`approve` or `change`) and `note` (text, 1-500; required on `change`), and `decisions`, a map of each decision `key` to its picked option `value`, every decision answered. `answers --json`, `wait --json`, `wait --events` and `on_answer` carry both. A send-back that misses a section or decision, or a `change` with no note, is refused (HTTP 400) and nothing is saved.
- What each answer means: `ask`, act on the picked value. `evidence`, the verdict goes back to the producer. `gate`, run `done-done respond --action <value>`. `finding`, `apply` means apply the change and `skip` means leave it. `plan`, act on each `change` note and each picked decision value. A `report` has no answer.
- An answer to an ask with `merges` also reaches each merged key as its own answer line (section 5), so a `wait` on either key returns it. `on_answer` runs once, for the ask that was answered.

## 8. Refusals

A message that does not match is refused and nothing is written. Malformed JSON counts as a refusal; only a file that cannot be read at all is exit 1. The CLI prints TOON with `error`, `code: VALIDATION_ERROR` and one `help` line that names the fix, and exits 2.

- The error names the file (`stdin` for `--from -`), the key when there is one, and the field. In a feed it also names `items[<n>]`, as today.
- Checks run in this order, and the first failure is the one reported: `contract`, `kind`, `schema`, then the fields in the order of section 4, then the kind's own rules.

Target wording, for an ask with options and no `recommend_value`:

```
error: "ask.json: key pick-a: recommend_value is required"
code: VALIDATION_ERROR
help[1]: "Add \"recommend_value\": \"a\", the option you would pick: one of a, b"
```

For a plan, the same order then runs: `sections` (count, fields, `id`, unique ids), `decisions` (each `key`, `question`, `why`, `options`, `recommend`), `steps`, then `view`. A plan with no sections, two sections with one id, a decision question with more than one question mark, a decision with no `recommend` or one that names no option, a plan with no `view`, and a plan with top-level `options` are each refused with one fix line.

To recover: read the `help` line, fix the message file, post it again. Never edit the board file by hand.

## 9. Commands

- `sign-off-axi validate <file.json>... [--kind <kind>]` checks message files without posting them. `--kind`, when given, must equal each file's `kind`. It prints `files[n]{file,kind,schema,ok,error,help}`.
- Exit codes: 0 when all pass; 1 when any file cannot be read, which wins over a refusal; 2 when any is refused, or no file is named.
- `sign-off-axi validate --expect-invalid <file.json>...` exits 0 only when every file is refused, 2 when any passes, and 1 when one cannot be read. Conformance uses it (section 10).
- `sign-off-axi schema <kind>` prints that kind's JSON Schema (draft 2020-12). With no kind it lists the kinds and their schema numbers. The schema is generated from the validator, so the package has no separate schema files. The printed JSON Schema leaves out cross-field rules (`recommend_value` among the options, unique values, `media` or `run`, `--kind` matching, media files).

## 10. Conformance

Shared fixtures live in [fixtures/contract/](../fixtures/contract/README.md) and ship in the npm package, one folder per kind and schema; that README lists the folders this version ships. Each holds at least 2 valid messages and 3 invalid ones (a missing field, a broken limit, an unknown field). Each tool's CI installs the version it pins and runs them:

```
npm install --no-save sign-off-axi@<exact>
npx sign-off-axi validate node_modules/sign-off-axi/fixtures/contract/*/valid-*.json
npx sign-off-axi validate --expect-invalid node_modules/sign-off-axi/fixtures/contract/*/invalid-*.json
```

Both must exit 0: the first only when every valid file is accepted, the second only when every invalid file is refused.

Each producer's own tests also write one real message per kind it sends, to a temp file, and run `validate` on it.

## 11. Skills

A skill that posts to sign-off shows, for each kind it sends:

1. The install line.
2. The post command, `npx -y sign-off-axi post --kind <kind> --from <file|->`.
3. The shape, as the one example for that kind from section 6.
4. The wait command, `npx -y sign-off-axi wait --filer <id> --events`, and the event line it prints.
5. The refusal rule from section 8.
6. A pointer to `npx -y sign-off-axi --help`. A skill never copies flags from memory.

A skill works alone: it never needs a supervisor or another tool to post.

## 12. Open questions

- Should the board show a finding's `proposal`? Retro reports keep change text out; the board is local to the person.
- Should `ask` gain design, diagram and interactive shapes in schema 2, or should they get kinds of their own?
