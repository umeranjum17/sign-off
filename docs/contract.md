# Communication contract, v1

sign-off owns this contract. Agents and tools use it to post asks, reports, evidence, gates and retro findings to the board, and to read the answers back. Every message has the same strict shape, so the person reading the board sees one kind of card per kind of message, whoever sent it.

Status: v1 target. Nothing in this file is enforced yet. Each part lands with its own change, and this line will name what is built. Until then, `raise` and `post` take the board format in [file-formats.md](file-formats.md), which ignores unknown keys.

## 1. Versions

- One contract, `"contract": 1`. Five kinds: `ask`, `report`, `evidence`, `gate` and `finding`.
- Each kind has its own `"schema"` number, starting at `1`. Every message carries `contract`, `kind` and `schema`.
- Strict: an unlisted field, a wrong type or a broken limit refuses the whole message, at every level (options, `run`, `media`). Nothing is dropped quietly, and nothing is stored or shown half-valid.
- Inside one `contract`, `kind` and `schema`, no field is added, removed, renamed or retyped. Any such change is a new `schema`.
- sign-off-axi accepts only the schemas it ships. Any other `schema` number is refused with the fix "upgrade sign-off-axi".
- The board file keeps its own `"schema": 2`. A posted message is stored as a board item that keeps its `kind` and `schema`.
- Producers pin an exact version in CI, for example `npx -y sign-off-axi@0.3.0`.

## 2. Items already on a board

Board items stored before v1 have no `kind` or `schema`. They read exactly as today, under [file-formats.md](file-formats.md), and are not checked again, so existing boards and answers keep working. Their answers report as `ask` schema 1.

Every new post of a contract kind, through `raise`, `post --type` and `post --from` (including `--replace` feeds) alike, is checked against that kind's v1 rules from the change that adds that kind. `raise` stamps `filed` itself where a kind needs it. A new item with no `kind` is refused with the fix "add contract, kind and schema".

## 3. How a message gets in

One validator, three ways in. No daemon, socket or HTTP API.

1. `sign-off-axi post [board.json] --kind <kind> --from <file.json>`, or `--from -` to read stdin. `--kind` picks this path and must equal the message's `kind`, so the wrong file is never posted.
2. A file drop: the producer writes one message file, then runs the same command on it. sign-off never watches for dropped messages.
3. A `--replace` feed, as in section 2.

`raise` and `post --type` check a file that carries `contract` and `kind` the same way `post --kind` does.

A message file holds one JSON object, in any layout. It is read with standard JSON parsing. A repeated field refuses the message with one fix line naming the field, such as `Remove the second "recommend_value".` A message with no `kind` is refused (section 2). `null` is a wrong type for every field.

| Producer | Kinds it sends |
|---|---|
| An agent, alone or under a supervisor | `ask`, `report` |
| done-done | `evidence`, `gate` |
| learn-from-mistakes | `finding` |

## 4. Field rules

- Text is a JSON string with at least one character that is not whitespace. It is stored as given; its length counts the Unicode code points of the whole value. Control characters other than newline are refused.
- A whole number is a JSON number from 0 to 9007199254740991 with no fractional part (`4.0` reads as 4). `"4"` is refused.
- `contract` is `1`. `schema` is a whole number (section 1).
- A key-set id is 1-128 of `A-Z a-z 0-9 . _ -`, case-sensitive.

| Field | Kinds | Rule |
|---|---|---|
| `contract`, `kind`, `schema` | all, required | as above |
| `key` | all, required (optional on `evidence`) | a key-set id, unique on the board |
| `title` | all, required | text, 1-160 |
| `filer` | all, optional | a key-set id: the agent session id or tool name |
| `link` | all, optional | `http://` or `https://` followed by 1-500 characters with no whitespace, or a 7-40 character lowercase hex commit |
| `about` | all, required (optional on `ask`) | text, 1-500 |
| `detail` | `ask`, optional | text, 1-1000 |
| `options` | `ask`, `gate`, `finding`, required | 2-6 objects of exactly `value` (a key-set id, unique in the message) and `label` (text, 1-80) |
| `recommend_value` | `ask`, `gate`, `finding`, required | one listed option `value` |
| `default_if_silent` | `ask`, optional | one listed option `value`; shown, never applied |
| `close` | `ask`, `gate`, optional | `done` (default) or `release`; copied into the answer |

When `filer` is missing, `post` takes it from `--filer`, else `SIGN_OFF_FILER` (empty means unset), else the agent session id. A `filer` in the message that differs from `--filer` is refused. Only `post` checks this; `validate` checks `filer` only when the message has one.

A key already on the board takes only the same message again (the same fields and values, in any order), which changes nothing. Anything else under that key is refused with code `CONFLICT` and exit 1: post it under a new key.

## 5. One shape per kind

### ask, schema 1

A question the person answers by picking an option. Shows in Waiting on you.

- Fields: the common ones, `about`, `detail`, `options`, `recommend_value`, `default_if_silent`, `close`.
- A yes/no ask lists `yes` (Yes) and `no` (No) as its options.
- Design picks, diagrams, interactive pages and explainers are not v1 kinds, so this contract does not post them.

### report, schema 1

Something the person reads. It takes no answer. Shows in Reports and explainers.

- Required: the common fields, `about`, `filed` (a real UTC date and time, exactly `YYYY-MM-DDTHH:MM:SSZ` with seconds 00-59, such as `2026-10-13T07:19:00Z`).
- Optional: `group` (text, 1-40), `decided` (text, 1-200).
- No `options` key, not even `[]`.

### evidence, schema 1

Proof the person gives a verdict on. Shows in Evidence. Its options are fixed and not in the message: `pass` (Pass), `fail` (Fail) and `needs-work` (Needs work).

- Required: the common fields (`key` is optional), `about`, and at least one of `media` or `run`.
- `media`: 1 to 12 relative file paths, with no `..`, resolved from the message file's folder (from the current folder for `--from -`), ending in `.png`, `.jpg`, `.jpeg`, `.webp`, `.mp4` or `.webm` (any case), each 50,000,000 bytes or fewer. `post` copies them into `evidence/<number>/` and records each `sha256` and `bytes`. A missing or oversized file refuses the message. `validate` checks the same and copies nothing.
- `run`: a done-done run, exactly `run_id` (a key-set id), `commit` (40 lowercase hex) and the four Checks lines `outcome`, `repro`, `proof` and `evidence` (text, 1-1000 each). The board stores it in the item's `evidence` field ([file-formats.md](file-formats.md)); `link` stays its own field.
- Without `key`, `post` sets `update-<number>`, where `<number>` is the next free `evidence/<number>/` folder next to the board.

### gate, schema 1

A run held for the person's approval. Shows in Waiting on you.

- Required: the common fields, `about`, `run` (exactly `run_id` and `commit`, with the evidence rules), `options`, `recommend_value`.
- `options`: 2 or 3, in any order, from `approve` (Approve), `skip` (Skip the judge) and `fix` (Fix first). Labels must match exactly. They are the actions of `done-done respond --action`.
- Optional: `close`.

### finding, schema 1

A repeated cause from a retro, with a proposed change. Shows in Waiting on you.

- Required: the common fields, `about`, `cause` (1-64 of `a-z 0-9 -`), `incidents` and `days` (whole numbers, 0 or more), `evidence_ids` (0 to 50 unique key-set ids), `change_kind` (`doc`, `rule` or `code`), `proposal` (text, 1-500), `options`, `recommend_value`.
- `options`: exactly `apply` (Apply) and `skip` (Skip), in any order. Labels must match exactly.
- No record text. `about` gives counts only and `evidence_ids` names records without quoting them. The validator checks every rule above but cannot see record text; keeping it out is the producer's job.

## 6. Worked examples

One per kind, each written on one line here. Demo data uses the name Umer.

```json
{"contract":1,"kind":"ask","schema":1,"key":"ship-signin-2","title":"Ship the new sign-in screen this week?","filer":"agent-41","about":"Slice 5 passed its checks.","options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}],"recommend_value":"yes","default_if_silent":"no","close":"done"}
{"contract":1,"kind":"report","schema":1,"key":"slice-5-live","title":"Board slice 5 is live","filer":"sign-off-builder","about":"Answered rows, the Dismiss footer and left-read cards are on main.","filed":"2026-10-13T07:19:00Z","group":"Board","decided":"Umer reviews slice 6 next."}
{"contract":1,"kind":"evidence","schema":1,"title":"Sign-in screen on a phone","filer":"done-done","about":"Umer signs in on a phone. The screen loads in 1 second.","media":["evidence-out/after.png"],"run":{"run_id":"20261011T120000Z-a1b2c3d4","commit":"0123456789abcdef0123456789abcdef01234567","outcome":"Umer can see the updated sign-in screen.","repro":"repro: n/a: no bug","proof":"verify-sign-off: real browser journey","evidence":"after.png"}}
{"contract":1,"kind":"gate","schema":1,"key":"dd-gate-a1b2c3d4","title":"Move the sign-in run on past its judge?","filer":"done-done","about":"The judge could not tell the screens apart.","run":{"run_id":"20261011T120000Z-a1b2c3d4","commit":"0123456789abcdef0123456789abcdef01234567"},"options":[{"value":"approve","label":"Approve"},{"value":"skip","label":"Skip the judge"},{"value":"fix","label":"Fix first"}],"recommend_value":"fix","close":"done"}
{"contract":1,"kind":"finding","schema":1,"key":"lfm-missing-env","title":"Repeated cause: missing env var in CI","filer":"learn-from-mistakes","about":"4 incidents over 3 days in 2 sources.","cause":"missing-env","incidents":4,"days":3,"evidence_ids":["rec-7f3a","rec-91be"],"change_kind":"doc","proposal":"Add the env var to the CI setup page.","options":[{"value":"apply","label":"Apply"},{"value":"skip","label":"Skip"}],"recommend_value":"apply"}
```

## 7. Answers

- `wait --filer <id>` without `--key` returns the answers to that filer's items it has not taken yet. Each answer is taken once; a changed answer is new again. Another-round asks wake it too: the person taps **Another round** on an answered item and types a note.
- `wait --filer <id> --events` prints one event line per answer and per another-round ask:

  ```json
  {"event":"answer","contract":1,"kind":"ask","schema":1,"key":"ship-signin-2","title":"Ship the new sign-in screen this week?","answer":"yes","label":"Yes","close":"done","at":"2026-10-13T08:00:00Z","filer":"agent-41","note":"Go."}
  {"event":"round","contract":1,"kind":"ask","schema":1,"key":"ship-signin-2","title":"Ship the new sign-in screen this week?","note":"Show it on a phone first.","at":"2026-10-13T08:05:00Z","filer":"agent-41"}
  ```

- An `answer` event has `event`, `contract`, `kind`, `schema`, `key`, `title`, `answer`, `label`, `close` and `at`. A `round` event has `event`, `contract`, `kind`, `schema`, `key`, `title`, `note` and `at`.
- `note` is added to an answer only when the person typed one. `filer` is added only when the item has one. `close` is `done` on kinds that do not take it. An `evidence` answer's `label` is Pass, Fail or Needs work.
- `wait --json` and `answers --json` keep their map keyed by item key, so existing readers keep working.
- An `on_answer:` command in `config.yaml` keeps every field it gets today (`key`, `answer`, `label`, `close`, `at`, `note`, `title`, `filer`) and gains `event`, `contract`, `kind` and `schema`. An Undo back to no answer still reaches it, with `"answer": ""`; `wait` never returns one.
- What each answer means: `ask`, act on the picked value. `evidence`, the verdict goes back to the producer. `gate`, run `done-done respond --action <value>`. `finding`, `apply` means apply the change and `skip` means leave it. A `report` has no answer.

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

To recover: read the `help` line, fix the message file, post it again. Never edit the board file by hand.

## 9. Commands

- `sign-off-axi validate <file.json>... [--kind <kind>]` checks message files without posting them. `--kind`, when given, must equal each file's `kind`. It prints `files[n]{file,kind,schema,ok,error,help}`.
- Exit codes: 0 when all pass; 1 when any file cannot be read, which wins over a refusal; 2 when any is refused, or no file is named.
- `sign-off-axi validate --expect-invalid <file.json>...` exits 0 only when every file is refused, and 1 when one cannot be read. Conformance uses it.
- `sign-off-axi schema <kind>` prints that kind's JSON Schema (draft 2020-12). With no kind it lists the kinds and their schema numbers. The schema is generated from the validator, so the package has no separate schema files. The printed JSON Schema leaves out cross-field rules (`recommend_value` among the options, unique values, `media` or `run`, `--kind` matching, media files).

## 10. Conformance

Shared fixtures live in [fixtures/contract/](../fixtures/contract/README.md) and will ship in the npm package once the first validator lands, one folder per kind and schema (`ask.v1/`): for each, at least 2 valid messages and 3 invalid ones (a missing field, a broken limit, an unknown field). Each tool's CI installs the version it pins and runs them:

```
npm install --no-save sign-off-axi@<exact>
npx sign-off-axi validate node_modules/sign-off-axi/fixtures/contract/*/valid-*.json
npx sign-off-axi validate --expect-invalid node_modules/sign-off-axi/fixtures/contract/*/invalid-*.json
```

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
