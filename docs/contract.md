# Communication contract, v1

sign-off owns this contract. Agents and tools use it to post asks, reports, evidence, gates, retro findings and plans to the board, and to read the answers back. Every message has the same strict shape, so the person reading the board sees one kind of card per kind of message, whoever sent it.

Status: v1 target, built in parts. Built: seven kinds, `ask`, `report` (schema 5, a guided page with versioned engagement that names its kind; schemas 2 to 4 still load), `evidence`, `gate`, `finding`, `plan` (schema 3, a guided page with versioned engagement; schemas 1/2 still load; stored and answered, with send-back controls) and `design` (schema 2, one plain question with frames side by side, the changed area outlined on each, answered with Yes or Change; schema 1 still loads; the board groups reviews by project with previews and review controls); `validate`, with `--expect-invalid` (section 9), and their fixtures in the npm package; `post --kind`, from a file or stdin with `--from -`, where a key conflict exits 2; in a `raise --from` or `post --from` file, a new item that carries `contract` or `kind` is checked as a message before anything is stored, a new item of a contract kind without `kind` is refused, and a new item's title is held to 1-160. New contract evidence is posted with `post --kind evidence`, never in a `--from` file; `post --type evidence` keeps the board format. Answer events are built: `wait --events` and the contract fields on `on_answer` (section 7). The question standard on `ask` (section 5) is built, and `raise --title` and `post --type decision` check every new question against it. Not built yet: `schema`. `raise --title` and `post --type decision` still post board-format items (they do not fill in `contract`, `kind` and `schema` yet), and their key conflicts still exit 1.

## 1. Versions

- One contract, `"contract": 1`. Seven kinds: `ask`, `report`, `evidence`, `gate`, `finding`, `plan` and `design`.
- Each kind has its own `"schema"` number, starting at `1`. Every message carries `contract`, `kind` and `schema`.
- Strict: an unlisted field, a wrong type or a broken limit refuses the whole message, at every level (options, `run`, `media`). Nothing is dropped quietly, and nothing is stored or shown half-valid.
- Inside one `contract`, `kind` and `schema`, no field is added, removed, renamed or retyped. Any such change is a new `schema`. Three optional fields are the exception, added inside schema 1: `ask_ref` on `ask`, and `ticket` and `priority` on every kind. A message without them means exactly what it did, and a sign-off-axi older than the field refuses a message that carries it, so a producer that also posts to older boards leaves it out.
- sign-off-axi accepts only the schemas it ships: the latest of each kind, and for `report` schemas 2/3 and for `plan` schemas 1/2, which older boards and agents still post. Any other `schema` number is refused with the fix "upgrade sign-off-axi".
- The board file keeps its own `"schema": 2`. A posted message is stored as a board item that keeps its `kind` and `schema`.
- Producers pin an exact version in CI, for example `npx -y sign-off-axi@0.3.0`.

## 2. Items already on a board

Board items stored before v1 have no `kind` or `schema`. They read exactly as today, under [file-formats.md](file-formats.md), and are not checked again, so existing boards and answers keep working. Their answers report as `ask` schema 1.

Every new post of a contract kind is checked against that kind's v1 rules from the change that adds that kind. `post --kind` posts a message of any built kind. The target is for `raise --title` and `post --type decision`, which is the same thing, to post an `ask` with `contract`, `kind` and `schema` filled in, and for `post --type evidence` to post an `evidence` the same way; until then they post board-format items (see Status). `raise` stamps `filed` itself where a kind needs it.

Non-contract types stay outside this contract. `raise --title` and `post --type diagram|interactive|explainer|signin` keep the board rules in [file-formats.md](file-formats.md). Legacy `post --type design` picks also keep those board rules; journey-based design reviews use `post --kind design`. In a `--from` file, a new item of a contract kind with no `kind` is refused with a fix line to add `contract`, `kind` and `schema`, in a `--replace` feed too. New evidence, with or without `kind`, is refused there with a fix line to post it with `post --kind evidence`: its media files are copied and numbered one message at a time. A contract kind there is an item with no `type`, or `type` `decision` or `ask` (both an `ask`), `evidence`, `report`, `plan` or `design`. An item already on the board under that key is not new, so a feed keeps sending it as it is, and it is not checked again — except in a `--replace` feed, which replaces the stored item: a contract message that changed is checked against its kind's v1 rules again, so one that no longer matches is refused, with the board left unchanged, instead of being stored half-broken. An item whose message did not change is not checked again.

## 3. How a message gets in

One validator, one way in. No daemon, socket or HTTP API.

`sign-off-axi post [board.json] --kind <kind> --from <file.json>`, or `--from -` to read stdin. `--kind` must equal the message's `kind`, so the wrong file is never posted. A `post --from --replace` feed checks each new contract-kind item the same way, except evidence (section 2). A --replace feed is a whole-board resync: it does not refuse a contract item whose key holds a different message, it replaces it without rechecking an existing key (section 2). A key not already on the board is checked against its kind's rules. An answer stays with the question it was given for: in a `--replace` feed an answered item whose title, options, reply, run (for a gate), finding (for a finding), or media or run (for evidence) changed is refused. Known limit: ask `about`/`detail` changes are not part of that comparison. And once an item's key has left the board, an answer recorded for it does not re-attach for any contract kind — the re-added item is refused, and is posted under a new key (section 5). A design holding only screen notes is the exception: with no verdict yet it comes back, and its screen notes stay.

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
| `ticket` | all, optional | a key-set id: the ticket this card belongs to. Only a reference: the ticket need not be on the board, and nothing needs it (section 13) |
| `priority` | all, optional | `P0`, `P1`, `P2` or `P3`: how urgent the card is, `P0` the most. The board shows it as a chip and can sort by it; a card without one shows no chip. It changes nothing about how the card is asked or answered |
| `link` | all, optional | `http://` or `https://` followed by 1-500 characters with no whitespace, control character (C0, DEL or C1) or unpaired surrogate, or a 7-40 character lowercase hex commit |
| `about` | all, required (optional on `ask`) | text, 1-500 |
| `detail` | `ask`, optional | text, 1-1000 |
| `why` | `ask`, required | text, 1-200: what it is about and why it needs an answer now |
| `options` | `ask`, `gate`, `finding`, required | 2-6 (2 or 3 on `gate`, exactly 2 on `finding`, section 5) objects of exactly `value` (a key-set id, unique in the message) and `label` (text, 1-80); on an `ask` each also has `outcome` (text, 1-120): what happens next if it is picked |
| `recommend_value` | `ask`, `gate`, `finding`, required | one listed option `value` |
| `recommend_reason` | `ask`, required | text, 1-160: why that option, in one line |
| `default_if_silent` | `ask`, required | one listed option `value`; shown on the card. On the leash When it matters, the open board takes it as the answer at `silent_by` (section 5) |
| `silent_by` | `ask`, optional | an ISO 8601 UTC time, `YYYY-MM-DDTHH:MM[:SS]Z`: when the board takes the silent default; with none the ask waits |
| `guard` | `ask`, optional | one of `destructive`, `irreversible`, `money`, `credential`, `security`: only the person may answer it, so no default or agent pick is ever taken for it, on any leash |
| `close` | `ask`, `gate`, optional | `done` (default) or `release`; copied into the answer |
| `proof` | `ask`, optional | the key of an evidence update on the same board that this ask rests on, never its own; `post` refuses a key that is not an evidence update there. Decide shows that update's capture and result at the top, with a way into the whole proof |
| `report` | `ask`, optional | the key of a report on the same board that this ask is about, never its own; `post` refuses a key that is not a report there (`--report` on `raise` and `post`). On a desk the open ask shows that report beside it under Its report: what it says, up to four of its picture's numbers and Open report. |
| `merges` | `ask`, optional | 1-10 distinct keys of other items on the same board that this ask replaces, never its own; each must offer every option of this ask and merge nothing itself; a key named by an ask not yet answered, open or dismissed, cannot be named again, and an answered or dismissed card cannot be named |

When `filer` is missing, `post` takes it from `--filer`, else `SIGN_OFF_FILER` (empty means unset), else the agent session id. A `filer` in the message that differs from `--filer` is refused. Only `post` checks this; `validate` checks `filer` only when the message has one.
When `ticket` is missing, `post` takes it from `--ticket`; a `ticket` in the message that differs from `--ticket` is refused. It is part of the message, so a key already on the board takes another `ticket` only as a new message (`CONFLICT`).
`priority` works the same way with `--priority`: filled in when missing, refused when it differs, and part of the message.

A key already on the board takes only the same message again (the same fields and values, in any order, with the same `filer`), which changes nothing. "In any order" refers to the order of fields; the order of options is part of the message, because it is the order the user sees, so the same options listed in another order are a different message. A message that names no `filed` matches the time the board stamped; a board-format item under that key is not the same message. Anything else under that key is refused with code `CONFLICT`, exit 2 and the help line "Post it under a new key". Today's CLI exits 1 on `CONFLICT`; this contract changes that, so every refusal exits 2.

## 5. One shape per kind

### ask, schema 1

A question the person answers by picking an option. Shows in Waiting on you.

- Fields: the common ones, `about`, `detail`, `why`, `options` (each with an `outcome`), `recommend_value`, `recommend_reason`, `default_if_silent`, `silent_by`, `guard`, `close`, `merges`, `proof`, `report`.
- A yes/no ask lists `yes` (Yes) and `no` (No) as its options, labelled exactly so.
- Posting a new Decide question (`raise`, default `post`, `post --type decision`, `post --kind ask`, or a feed including `--replace`) requires `--ask-ref <captain-message-id-or-hold-id>`, saved as `ask_ref`. A message or feed may carry `ask_ref` directly. Use the actual captain message or hold id: 1-256 characters, no whitespace or control characters. Posting checks the reference's shape, not whether another tool owns that id. Follow-ups belong in the backlog, not the board. This is new-card admission, not a new required field when reading or validating older messages: already-posted cards, plan/report posts, evidence posts and engagement records keep working.
- Asking a good question. One decision is one card, and the card passes a 10-second read on a phone:
  - `title` is one plain question the buttons answer: it ends in `?` and has 12 words or fewer. No robot prefix (`Say yes or no:`, `Captain hold:` or a leading `Captain:`, in any case) and no key-like word (a lowercase word joined by `-`, `_` or `/` that has a digit, underscore or slash in it, such as `ship-signin-2`, `ship_1` or `ch/cloud`). A robot prefix is refused only at the start of the title.
  - `why` says in 1 or 2 short lines what it is about and why it needs an answer now.
  - The buttons are exactly the choices in the text. When `title`, `why`, `about` or `detail` names lettered choices (`Option B`, `A)`, `(A)` or `A:` anywhere, or a line that starts with `A.`), there is one option per letter, each label starting with its letter (`A: Today` or `Option A`), and `yes`/`no` options are refused. A question never takes acknowledgement buttons (Done, OK, Not now, Got it, Noted, Seen, Dismiss).
  - Every option's `outcome` says what happens next, in one line. `recommend_value` with `recommend_reason` marks one option Recommended and says why.
  - `default_if_silent` says what happens if no one answers; `silent_by` says when. What happens then is the person's leash (`leash:` in `config.yaml`, the board's Leash control):
    - `ask` (Ask me first): nothing; every ask waits for the person.
    - `matters` (When it matters, the default): at `silent_by` with no answer, the open board takes `default_if_silent` as the answer. It is saved with `"taken": "default"` and a `reason`, the card says "Taken by default at <time>", and the waiting agent gets it. When the board was closed at that time, it takes the default when it starts. An ask with no `silent_by` waits. The card says "If you stay quiet, the board takes <label> at <time>", or "This ask has no deadline, so the agent waits for your answer."
    - `act` (Act, then tell me): `raise` and `post` take `recommend_value` at once, saved with `"taken": "agent"`; the card says "Agent picked <label>, tell me if wrong", with one Change. On the board an open ask also takes its default at `silent_by`, as on `matters`.
    - Never taken, whatever the leash: an ask with a `guard`, an ask whose `title`, `about`, `detail`, `why` or option labels and outcomes talk of money, deleting, what can't be undone, passwords and keys, or access (the board reads them as that guard), and every kind but a plain ask (a design, plan, sign-in, gate or finding). Its card says "Always waits for you" and why.
    - The person can still answer or change a taken answer: the change reaches the agent with `replaces`, whose `taken` says it was taken.
  - Every refusal names the field and gives one fix line. Items already on a board are not checked again (section 2).
- One decision, one card. A new ask that repeats an open ask (the same option values, titles that share at least 80% of their words) is refused at post time, unless it names that ask in `merges`; when an ask is answered, every other open ask on the same decision takes the same answer, with the note `Answered with <key>`. Before posting, look at the open cards. When the same decision is already there, wait on that card, or post one ask whose `merges` names the other keys. While the ask is shown (open, not dismissed, not answered), the board hides the merged items; a dismissed or answered ask hides none. A merged item merges nothing itself, so a chain is refused at post time. When it is answered, the board writes one answer line per merged key that is on the board and has no answer of its own, with the same value and label, that item's own `close`, and the note `Answered with <key>`; a merged card that does not offer that value gets no line, and a Reply goes to each as a reply. A re-answer changes only the parent: a merged card that already has an answer, its own or one an earlier fan-out wrote, is never overwritten, and an Undo clears only the lines this ask wrote. A card is named by one ask until that ask is answered: a second ask may not name a card a dismissed or open ask still names, and a merge may not name an answered or dismissed card: both are refused at post time.
- An answered ask keeps its title, options and reply: an answered ask cannot take another one, not even in a `--replace` feed. Known limit: `about`/`detail` changes are not part of that comparison. A dropped answered ask key cannot come back in a `--replace` feed; post it under a new key.
- Design reviews are posted as `design` schema 2 (schema 1 still loads, validates and re-posts). Diagrams, interactive pages and explainers remain `post --type` board items under [file-formats.md](file-formats.md).

### report, schema 2

An explainer the person reads: made when they asked for an explanation, or when a concept, design or trade-off must be understood. It takes no answer. Shows in Reports and explainers, as a row with its picture; a tap opens its page, over the whole board on a phone and beside the sidebar on a desk. Proof that something works is `evidence`. A merge, a PR outcome, a receipt or a status note is never a report.

- Required: the common fields, `about`, `filed` (a real UTC date and time, exactly `YYYY-MM-DDTHH:MM:SSZ` with seconds 00-59, such as `2026-10-13T07:19:00Z`), `view` and `preview`.
- `view`: the page, a relative `.html` path of 1-256 characters with no `..`, `?`, `#` or `\`. `preview`: its picture on the card, `.svg`, `.png`, `.jpg`, `.jpeg` or `.webp`, in the same folder. `post` reads both from the board file's folder (as `--view` does), where symlinks are followed and the real path must stay inside it, each a file of 5,000,000 bytes or fewer; `validate` checks only their shape, as it does a plan's `view`.
- The page is filled in the shape `sign-off-axi report init <folder> --page` writes: no `FILL:` line left (in the picture either), a viewport tag, a dark mode (`prefers-color-scheme`), a picture or diagram, something to tap or slide (a button, input or select), its detail folded in `<details>`, nothing loaded from the web, and no paragraph or list item over 240 characters (about five lines on a phone). The first rule a page breaks refuses it with one fix line.
- Optional: `group` (text, 1-40), `decided` (text, 1-200), `form` (`diagram`, `chart` or `before-after`: the line icon on its Reports row), `video` (text, 1-10, the length of its narrated video such as `0:28`) and `asked_by` (text, 1-40, such as `You asked` or `Docs agent`). The row's line reads its form, video, group and time, such as `Diagram · Video 0:28 · Release · 11:58`, and with none of them `Report · 11:58`; `asked_by` heads the report's page (`Diagram · You asked · Today, 11:58`).
- Schema 1, a report of text only, is refused with the fix line naming `sign-off-axi report init <folder>`. A schema 1 report already on a board still loads and is not checked again; the board folds it under Notes, never as a report card.
- `post --type report --title --about --view --preview` posts the same message from flags, with `filed` set to the time of the first post.
- No `options` key, not even `[]`: it is refused with the fix "post an ask to get an answer". On the board it is stored with no options, shows under Reports and explainers on any board, and never waits. A stored report that carries `options`, `reply`, `area` or `type` is refused when the board is read, the same way.

### report schema 5: the report's kind

The new `report init` default. Every field and rule of report 4 below, plus one required field, `purpose`: what the report is for, its kind, one of `research` (research and discovery), `plan` (implementation plan), `decision` (decision and recommendation), `audit`, `incident` (incident and retro), `status`, or `other`. A report 5 without it, or with another value, is refused with the fix line naming the seven. `report init <folder> --purpose <kind>` writes it filled in. The board shows the kind on the report's row (a chip with its icon) and its head (its full name), with one line under the title on what that kind of report is for, and Reports filters by kind. A report 4 or older has no `purpose`: the board shows its best guess from its title, what it says and its section heads (`other` when nothing fits), and never writes it back. A guided plan is always an implementation plan.

Each kind but `other` has its parts, in order: one section each, naming it in `"part"` (up to 10 sections). A part missing, repeated or not of the report's kind is refused, naming the part and `report init <new folder> --purpose <kind>`, which writes every part to fill.

| Kind | Parts | What a part needs |
|---|---|---|
| `research` | `question`, `scope`, `method`, `sources`, `options`, `findings`, `not-checked`, `recommendation`, `open-questions` | `sources`: at least 3 items, each with `link` (an http(s) link) and `source` (`primary`, or `user` for what users report), and at least one `user`; `options`: at least 2 items; `findings`: each item with `confidence` (`high`, `medium`, `low`) |
| `plan` | `goal`, `current`, `design`, `slices`, `tests`, `risks`, `rollout`, `estimate`, `owner-calls` | `design`: a `diagram` on the section, one of its items or the `visual`; `slices`: each item with `size` (text, 1-24); `tests`: at least one item |
| `decision` | `context`, `options`, `recommendation`, `consequences` | |
| `audit` | `scope`, `standard`, `findings`, `fixes` | |
| `incident` | `impact`, `timeline`, `root-cause`, `actions` | |
| `status` | `done`, `in-progress`, `blocked`, `up-next` | |

An item of a report 5 may also carry `link`, `source`, `confidence` and `size` in any part. The board draws a report 5's kind parts as its strip and its parts list, counts a research report's linked sources and user reports on its head, and shows each item's source, confidence or size, and its link.

### report schema 4 and plan schema 3: engagement v1

The new `report init` defaults retain every field and limit of report 3 / plan 2 below, but **require `filer`**, using the existing key syntax. Contract stays 1. No routing commands or session paths belong in the authored message. Every guided part gains **Simplify this**, alongside the unchanged legacy Go deeper path. Original documents and plan decisions are never rewritten by explanatory replies.

`POST /api/engagement` takes exactly `version: 1`, `id` (caller-generated key, 1–128 characters), `key`, `kind`, `schema`, `filer`, `revision`, `part`, `action`, and optional `q` and `selection`. All identity fields must equal the current document. `revision` is a lowercase SHA-256 of the authored fields (`contract,kind,schema,key,filer,title,link,about,filed,group,decided,asked_by,purpose,project,understood,visual,sections,decisions,next`), omitting absent fields, sorting object keys recursively, preserving arrays, then UTF-8 encoding compact JSON. The server supplies this identity in each item's `engagement` descriptor. Unknown fields and invalid/stale targets fail before saving or dispatching.

The action vocabulary is `question`, `deeper`, `simplify`, `example`, `why`, `custom`. Every authored part offers **Ask a question**, **Go deeper**, **Simplify this**, **Show an example**, **Why?**, and a free-text Send composer. Ask a question focuses that part's composer and sends only after text and Send; the other presets send immediately. Free text and follow-ups use `custom`. Question/custom require nonblank plain `q`; optional `q` on any action must be nonblank and at most 500 code points. The exact text is retained. Requests remain explanatory: no rewriting, approval or implementation. All actions use the same versioned endpoint, owner dispatch, acknowledgement and answer path; older schemas retain `/api/deeper`. Section intent fixtures ship in `fixtures/engagement-v1.json`. Retrying an identical id returns the existing request; a changed ask under that id fails. Different ids remain distinct, including on the same part.

Targets use the existing part ids: `this`, `understood`, section id, `section:index`, `d:decision-key`, `next`. Optional `selection` has exactly `field`, `start`, `end`, `quote`. Offsets are zero-based Unicode code points, start inclusive/end exclusive; the nonempty quote is at most 500 code points and must exactly match that range in one authored field. Field paths are relative to the part: `this` allows `title`, `about`, `visual.heading`, `visual.text`; understood allows `understood.N.label/text`; a section `heading/body`; an item `title/text/more`; a decision `question/why/reason/after/quiet`; next `heading/lines.N`. Missing fields, cross-part paths and UI/control text are refused. The page offers the same presets for a native text selection inside one authored field: a tray in the page flow under that field names the quote and sends through `POST /api/engagement` (the quote shows with the request and its reply in the part). A selection across fields or parts, longer than 500 code points, or on control text offers no presets and sends nothing. Copying and the native selection handles are untouched; collapsing the selection or Escape cancels. The title and summary of an expandable item row sit inside its button and are not selectable targets; its detail is.

Requests remain in `<board>.deeper.jsonl`: version-1 `ask` records contain the immutable target above plus server `about` and `at`. Version-1 `read`, `say` and `seen` records reference that request id and inherit its identity; `say` keeps `text` (1–2000 code points), optional `more`, and `at`. Legacy records/events retain their existing shape. `deeper --json --all` and filer-bound `wait --events` expose version-1 identity/action/selection. Active replies require the matching `--filer`; registered sessions must match the local binding and explicitly acknowledge before their single final reply. Replies and acknowledgements to stale documents or another owner fail. Completed native-owner retries never append duplicate text.

Owner delivery uses the existing local board/filer binding, not posted executable routes. Pending means queued (including a visible real delivery failure), delivered means handed to the host, owner-read means explicit acknowledgement, and `say` streams until completion. Claude Code is the supported standalone host: register the actual author UUID with `owner --filer … --host claude --session … --cwd …`, then keep a separate `owner --dispatch --timeout 3600` process running; do not race it with an active wait for that filer. Firstmate may provide a separate trusted adapter; this package neither implements nor depends on it.

Each new answer piece increments `answerRevision`. `POST /api/engagement/seen` takes `id` and that exact integer; stale cursors fail. The browser expands incoming answers without scrolling/focusing and shows **New** until the actual answer is at least 35% visible for 1.4 seconds in a visible tab. A version-1 `seen` record persists that revision; polling, section receipts and reload do not clear it. The board's original approval/send-back behavior is unchanged.

### report, schema 3

The older guided report: the board draws it, so the agent writes no page. One scroll, in the order *What this is* (one picture), *What I understood*, *What I found*, *Next step*; the numbers and the longer answers open in place. `sign-off-axi report init <folder>` writes `report.json` to fill; `post --kind report --from <folder>/report.json` posts it. Shows in Reports and explainers, and opens over the whole board. It takes no answer; if the person says the understanding is off, that reaches the agent as a comment.

- Required: the common fields, `about`, `filed` (as schema 2), `understood`, `visual`, `sections` (1 to 6) and `next`. Optional: `group` (text, 1-40), `decided` (text, 1-200) and `asked_by` (text, 1-40).
- `understood`: 1 to 6 objects of exactly `label` (text, 1-40) and `text` (text, 1-240): the request in the agent's words, so the person can see it was understood.
- `visual`: the one picture, exactly `type` (`bars`, `steps` or `tiles`), `heading` (text, 1-100: the one point it makes), `rows` (2 to 8) and optionally `text` (text, 1-240: what it measures and where the number is from), `unit` (text, 1-12, `bars` only) and `details` (1 to 8 objects of `label`, text 1-40, and `value`, text 1-120: the numbers, folded behind a Details control). A row is exactly `label` (text, 1-60) and optionally `text` (1-160), `note` (1-40: a tag), `tone` (`ok`, `warn` or `bad`) and, on `bars`, `value` (a number, 0 or more; required) and `before` (a number: a Today and After pair).
- `sections`: 0 to 6 objects of exactly `id` (1-40 of `a-z 0-9 -`, unique), `stage` (`found` or `recommend`), `heading` (text, 1-80), `body` (text, 1-300) and optionally `items` (1 to 8 objects of `title`, text 1-80, `text`, text 1-160, `more`, text 1-600: the part that opens in place, its line breaks kept, and `tone`) and `details`, as on `visual`. When every item of a section has `more` and no diagram, and each `more` is two or more lines of `Axis: value` with the same axes in the same order, the board draws the section as one comparison table: the options across and the axes down, each axis listing every option under it on a phone. The message is unchanged, so a board without the table shows the same lines as text.
- `diagram`, optional on `visual`, a section and an item: 1 to 3 views, each `label` (text, 1-40: the tab) and `src` (a relative `.html` path of 1-256 characters with no `..`, `?`, `#` or `\`), and the `sha256` and `bytes` of the file, which `post` writes (as it does for media; do not author them). Use it only where structure, order or dependency is the point; the rows stay as the same answer in a list. `validate` checks the shape; `post` also reads each file from the board file's folder (5 MB or less, inside it) and refuses a page with no `<svg>` drawing, with brand marks (`data-brand-mark`), or whose smallest `<text>` is under 12 px once its drawing is as wide as Full size draws it on a 390 px screen, 374 px (`font-size` times 374 over the `viewBox` width). `post` pins each file: the board serves only that file, refuses it once it has changed since it was posted, and the plan's revision covers its content. Full size is the page by itself, with a Back to the plan link, and on a phone sized to the drawing. The board serves it in the same sandbox as a plan's page, at `/mock/<pass>/<key>~diagram.<n>/<file>`, `n` counting views in the order of `visual`, then each section and its items. A board that does not know the field refuses it with "is not a field there". An Archify page is drawn as an `architecture` diagram 320 to 340 wide (320 is the smallest Archify makes) with its legend hidden; sign-off ships none of Archify, and it draws in its own mono type.
- `gallery`, optional on a section of a guided plan or report: a design output shown as options, 1 to 6 objects of `label` (text, 1-40), `model` (text, 1-40: the model that made it), `ran` (UTC time `YYYY-MM-DDTHH:MM:SSZ`: when it ran) and `frames` (1 or 2 objects of `device` (`phone`, 390 wide, or `desktop`, 1280 wide; each at most once per option; required), `caption` (text, 1-120; required), `src` (a relative `.png`, `.jpg`, `.jpeg`, `.webp` or `.html` path of 1-256 characters with no `..`, `?`, `#` or `\`) and the `sha256` and `bytes` of the file, which `post` writes: do not author them). `post` reads each frame from the board file's folder (5 MB or less, inside it), pins it like a diagram and refuses a frame with no caption, no device, or no file. The board draws the options as a strip to swipe on a phone and a row on a desk, each option's phone and desktop frame side by side with the caption, model and run time under each frame and the images lazy and downscaled (the board sends a copy no wider than 1600 px, `?v=light`, for the thumbnail); a tap opens an option full size with Previous and Next between options (a swipe or the arrow keys too) and Phone and Desktop. Frames are served at `/mock/<pass>/<key>~gallery.<n>/<file>`, `n` counting frames in the order of the sections, their options and each option's frames. `report init <folder> --gallery` writes one to fill. Use it whenever a report is about design output.
- `next`: exactly `heading` (text, 1-80) and `lines` (1 to 4 texts, 1-160): what happens after the person has read it.
- No `view`, `preview`, `form`, `video` or `options`; a message that still has `FILL:` in it is refused.
- Under every part the board shows who read it and when (the person, once the part was on screen for a moment; the agent, when it wrote it and when it read a comment), and a **Go deeper** control (section 7).

### plan, schema 1

An agent's plan the person reviews before the work starts: each section approved or changed with a note, each decision answered. It is not a report, because it takes answers. `post --kind plan` (or a `--from` feed) stores it as item type `plan`, with its sections, decisions, steps and view, under Waiting on you until it is sent back; a new item with `type` `plan` and no `kind` is refused.

- Required: the common fields, `about` (the plan, answer first), `sections`, `decisions` and `view`.
- `sections`: 1 to 8 objects of exactly `id` (1-40 of `a-z 0-9 -`, unique in the plan), `heading` (text, 1-80) and `body` (text, 1-1000), such as goals and non-goals, architecture, slices and order, coding standards, risks.
- `decisions`: 0 to 5 objects of exactly `key` (a key-set id, unique in the plan), `question` (text, 1-160: one question of 12 words or fewer, with one question mark (`?` or `？`) as its last character; `"Keep A? Or B?"` is refused), `why` (text, 1-500), `options` (2-6 ask options, each also with `outcome`, text 1-200: what picking it leads to) and `recommend` (one listed option `value`); optionally `reason` (text, 1-300: why the recommended option, shown as "Why:" under it) and `after` (a section `id`: the decision sits under that section, otherwise after the last).
- `view`: the one page, with the direction diagram, held to the report page rules: `validate` checks the path, not the file; `post` and `--from` check the file, which must be 5 MB or less, inside the board file's folder, with a viewport, dark mode, a picture or diagram, no web links and blocks of 240 characters or fewer; unlike a report's page it needs nothing to tap and no folded detail, because the board shows the steps and the detail. The page is the diagram alone: the board shows the title and the answer above it. A plan has no preview. Optional: `project` (text, 1-40: the project it is for, shown in the eyebrow); `steps`, 2 to 12 tap-through steps, each `title` (text, 1-80) and optionally `text` (text, 1-300: what happens in the step), which the board shows in "How it works" beside the architecture section.
- No `options` key: a plan's answers come from its sections and decisions, so top-level `options` is refused with a fix line to put each question in `decisions`.
- Open the plan from its board card to approve or change each section and answer each decision. Change needs a note of at most 500 characters, and an approval may carry a comment that short too. A decision takes a listed option or the person's own words (Other, at most 500 characters); Send back may carry one whole-plan comment that short too. The board keeps unsent answers in this browser until Send back succeeds. Send back stays disabled until every section and decision is answered. The sent plan moves from Waiting on you to Answered; opening it there shows the saved answers read-only. The agent's view stays sandboxed; the board itself owns the answer controls.

### plan, schema 2

The older guided plan: the board draws it, in the shape of a schema 3 report with the plan's own questions; `sign-off-axi report init <folder> --plan` writes `plan.json` to fill. One scroll: *What this is*, *What I understood*, *What I found*, *What I recommend*, *What you decide*, *Next step*. On a desk a rail beside it holds the parts and **Your answers** with **Go ahead**; on a phone a progress bar and a **Go ahead** bar stay in reach. **Go ahead** accepts the agent's picks: nothing is required.

- Required: the common fields, `about`, `understood`, `visual`, `sections` (0 to 6), `decisions` (0 to 5) and `next`, each as in report schema 3. Optional: `project` (text, 1-40).
- `decisions`: as in schema 1 (`key`, `question`, `why`, `options` with `outcome`, `recommend`, `reason`), without `after`, and with `quiet` (text, 1-160): what the agent does when the person stays quiet.
- No `view`, `steps` or `options`. Sections are not approved one by one: the person answers only what is off. **Go ahead** saves one send-back, `"answer": "sent"`, with `decisions` (every key, the picked `value`) and, only if the person marked it, `notes` with one entry for `understood` (`approve`, or `change` with a note of 1-500 characters). The plan then stays open and shows when the agent read the answers.

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

### design, schema 2

One plain question about a design, answered once with **Yes** or **Change**, so a reviewer never meets an internal title, a column that repeats another, or a change they cannot find.

- Required: the common fields, `about` (what changed and why, in one or two plain sentences, text 1-280), `group`, `filed`, `status` and `preview` as in schema 1, `journeys` (at least one), and `accepts`.
- `title` is the question Yes answers: one sentence of 12 words or fewer, ending in its only `?`, such as "Approve this new phone end-of-list for Reports?". The board shows it as the card's title everywhere.
- Plain words: `title`, `about`, `reviewed`, every journey and screen title and every caption are refused when they hold words for agents. The check (`jargon` in src/contract.ts) refuses a lowercase word with an underscore or slash, or one that starts with a letter, has a digit and is joined by hyphens (`slice-5`, `fm/branch`, `signoff-s9-move-fleet`); a lowercase word of four or more hyphened parts (a task name such as `signoff-phone-designs-access`); `PR`, `PRs` or `#<number>`; `slice` or `slices`; a capitalised word ending in three or more digits (an agent's message id) or a ticket code such as `RL-02`; a file name ending in `.png`, `.jpg`, `.webp`, `.svg`, `.html`, `.json`, `.jsonl`, `.mjs`, `.cjs`, `.ts`, `.md` or `.yaml`; and a commit hash (7-40 hex digits with a letter and a digit). The refusal names the word.
- `accepts`: the frame Yes approves, `built`, `proposed` or `target`. Every screen has a frame with that role.
- Optional `reviewed`: the reviewer's note (text 1-200), shown on the card as **Main reviewed**.
- At most 8 screens in all: one per state that changed, never the same state at several widths.
- Each screen has a lowercase slug `id`, a `title` (text 1-80, what the screen is, such as "Reports, scrolled to its end") and `frames`: 1-3 objects in the order `today`, `proposed` or `built` (never both), `target`, each with its `role` and `views` (as schema 1, but pictures only, `.png`, `.jpg`, `.jpeg` or `.webp`, and all of one device: phone or computer). A phone and a computer get a screen each.
- When a screen has two or three frames, each frame has `area`, the changed part as fractions of its picture (`{"x":0,"y":0.8,"w":1,"h":0.12}`, inside the picture), and `caption`, what changed in that frame in one line of 90 characters or fewer.
- Two frames of a screen that look the same are refused at post: under 0.1% of their pixels differ (a channel moving by more than 24 of 255), compared view by view for the views both frames have. Drop the frame that did not change, or capture the state that shows the change.
- No `options` or `recommend`: a pick between directions is `post --type design`.
- The board shows the screen's frames side by side, labelled **Before** and **After** when they are `today` and the new look, else **Today**, **New (proposed)** or **New (built)** and **Target design**; the changed area is outlined in ink on each picture with the rest dimmed, the caption under it, and the frame Yes approves ringed in ink with a check by its label. A design with more screens steps through them with Previous and Next. Under the frames sit the note ("A note: optional with Yes, needed for Change"), **Yes** in ink and **Change**, and the line "Yes approves “<label>”, the frame with the check". Each picture opens full size.
- The answer is schema 1's with no screen notes: `{verdict:"approve"|"change",notes:[{verdict,note}]}`. Yes takes an optional note and stores `approve` with it; Change needs the note. Praise typed beside Yes is an approval, never a change.
- `post --kind design` holds every new design to the question rule above, whatever its schema: a schema 1 design whose key is new is refused without a plain question title. A design already on the board under its key re-posts as it was.

### design, schema 1

A set of project design reviews and screen views. The board groups reviews by project, with a preview, filed date and status; the review screen supports an optional direction pick, screen-targeted notes and design-level notes when there are no screens. The board opens a design review with its selected screen preview and note target, and "Review full screen" opens a full-screen viewer that steps through every screen in order, with approve or change per screen.

A design is reviewed by Main, not the user: it shows under Designs only and is never an ask of the user's (not in Decide, Answered or any count) until Main runs `sign-off-axi promote <key>`, which no message field can do.

- Required: the common fields, `about`, `group` (project name, text 1-40), `filed` (real UTC date-time with seconds), `status` (`draft` or `in_review`), `preview` (relative `.png`, `.jpg`, `.jpeg` or `.webp` path), and `journeys`.
- `journeys`: 0-40 objects with unique lowercase slug `id`, `title` (text 1-120), and 1-80 `screens`. An empty list is a design-level review with no screen-specific views.
- Each screen has a lowercase slug `id`, `title` (text 1-120), and `views`, a nonempty map of `phone_light`, `phone_dark`, `computer_light` or `computer_dark` to a relative `.png`, `.jpg`, `.jpeg`, `.webp` or `.html` path.
- Every preview and view must exist inside the board folder when posted, be readable and no larger than 5 MB.
- HTML views are served in the board's sandbox with point annotations enabled.
- Optional `options` (2-6 `{value,label}` choices) and `recommend` (one option value) let the reviewer pick a direction.
- The answer is `{verdict:"approve"|"change",pick?,notes:[{journey?,screen?,verdict?,note?}]}`. When a design has screens, the reviewer can target a note at one screen by supplying both `journey` and `screen`; a design-level note omits both. A note's `verdict` is `approve` or `change`, on a screen or at design level; a note with no `verdict` is a change, so stored answers from before per-screen verdicts read the same. A design-wide save with a note gives that note the same verdict as the save, on its screen or at design level. A save may also omit the design-wide `verdict` for a screen save; section 7 gives its rules and what it stores.
- A design-level change needs at least one note. A `change` on a screen needs its note text; an `approve` on a screen may omit `note`. Each note's text is 500 characters or fewer and each note either names an existing screen or omits both target fields for a design-level review.
- Approval sets the displayed status to `approved`.
- A design written again under its key with another `filed` time, other screens or options, or changed bytes in any of its files is a new round. Each design answer the board saves names the round it was given on; an older answer that names none belongs to the round it came after. On a new round the note box starts empty, the card's Activity shows the last earlier round's answer with its notes once ("Your answer on the earlier round"), and a save carries neither the earlier round's notes nor its verdict.
- The review page draws the selected screen (the first, until another is chosen) in its preview: an `.html` view fills the preview from its top, on white where the page sets no background of its own. A view whose file is gone, or a picture view that will not load, shows the design's `preview` picture in its place, with a line saying the screen could not be shown.

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
{"contract":1,"kind":"ask","schema":1,"key":"ship-signin-2","title":"Ship the new sign-in screen this week?","filer":"agent-41","about":"Slice 5 passed its checks.","why":"The screen is ready and the release goes out Friday.","options":[{"value":"yes","label":"Yes","outcome":"It ships to everyone on Friday."},{"value":"no","label":"No","outcome":"It waits for next week's release."}],"recommend_value":"yes","recommend_reason":"Every check passed on 3 phones.","default_if_silent":"no","silent_by":"2026-10-19T16:00Z","close":"done"}
{"contract":1,"kind":"ask","schema":1,"key":"release-day","title":"Which day should the release ship?","filer":"agent-41","why":"Two fixes are still in review: A, B or C.","options":[{"value":"a","label":"A: Today","outcome":"It ships now, without the 2 fixes."},{"value":"b","label":"B: Friday","outcome":"It ships with both fixes."},{"value":"c","label":"C: Next week","outcome":"It waits for the redesign too."}],"recommend_value":"b","recommend_reason":"Both fixes land by Thursday.","default_if_silent":"b","merges":["release-friday"]}
{"contract":1,"kind":"report","schema":2,"key":"new-sign-in","title":"How the new sign-in works","filer":"sign-off-builder","about":"Sign-in now asks for a code after the password, so a stolen password alone opens nothing.","filed":"2026-10-13T07:19:00Z","group":"Sign-in","decided":"Umer keeps the code step.","view":"mocks/new-sign-in/index.html","preview":"mocks/new-sign-in/preview.svg"}
{"contract":1,"kind":"evidence","schema":1,"title":"Sign-in screen on a phone","filer":"done-done","about":"Umer signs in on a phone. The screen loads in 1 second.","media":["evidence-out/after.png"],"run":{"run_id":"20261011T120000Z-a1b2c3d4","commit":"0123456789abcdef0123456789abcdef01234567","outcome":"Umer can see the updated sign-in screen.","repro":"repro: n/a: no bug","proof":"done-done: real browser journey","evidence":"after.png"}}
{"contract":1,"kind":"gate","schema":1,"key":"dd-gate-a1b2c3d4","title":"Move the sign-in run on past its judge?","filer":"done-done","about":"The judge could not tell the screens apart.","run":{"run_id":"20261011T120000Z-a1b2c3d4","commit":"0123456789abcdef0123456789abcdef01234567"},"options":[{"value":"approve","label":"Approve"},{"value":"skip","label":"Skip the judge"},{"value":"fix","label":"Fix first"}],"recommend_value":"fix","close":"done"}
{"contract":1,"kind":"design","schema":1,"key":"demo-chat-design","title":"Approve the chat app journey boards?","about":"Review the current onboarding and conversation screens.","group":"Chat app","filed":"2026-10-18T12:00:00Z","status":"in_review","preview":"design/preview.png","journeys":[{"id":"onboarding","title":"Onboarding","screens":[{"id":"welcome","title":"Welcome","views":{"phone_light":"design/welcome.png","phone_dark":"design/welcome-dark.png","computer_light":"design/welcome.html"}}]}]}
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
- `taken` and `reason` are added to an answer the leash took for the person (section 5): `taken` is `default` (the board took `default_if_silent` at `silent_by`) or `agent` (your own `recommend_value`, taken at once on Act, then tell me), and `reason` says why in one line. Go ahead with it, and keep waiting: the person can still change it. `wait --json`, `answers --json` and `on_answer` carry them too, and the default output adds a `taken` column.
- `replaces` is added when the person changed an answer (on the board, **Change answer** on an answered ask, or an Undo back to the answer before): `{answer, label, at, note?}`, the answer this one replaces, or, when an Undo had taken that answer back, the one `wait --filer` handed you before it. You may already have acted on it: act on this answer in its place. `wait --json`, `answers --json` and `on_answer` carry it too, and the default output adds a `replaces` column with the earlier `answer`. The earlier answer stays in the answers file.
- An answer or round that carried comments on mock elements also has `comments`, as on `on_answer` below, since a round may carry only comments and an empty `note`.
- `--events` needs `--filer <id>` (or `SIGN_OFF_FILER`): it prints a filer's answer events, so a wait without one is refused (exit 2).
- Lines come oldest first, by `at`. `--events` does not take `--json` or `--full`. A private vault item that expired or was refused still reaches a filer wait as it does without `--events` (exit 1, no event line).
- `wait --json` and `answers --json` keep their map keyed by item key, so existing readers keep working.
- An `on_answer:` command in `config.yaml` keeps every field it gets today (`key`, `answer`, `label`, `close`, `at`, `note`, `title`, `filer`) and gains `event`, `contract`, `kind` and `schema`. An answer line that carried comments on mock elements also has `comments`, each with `id`, `mock`, `hash`, `ref`, `tag`, `words` and `text`. An Undo back to no answer still reaches it, with `"answer": ""`; `wait` never returns one.
- A design's answer is `{verdict:"approve"|"change",pick?,notes:[{journey?,screen?,verdict?,note?}]}`; `change` requires a note, screen targets are paired, a note without `verdict` is a change, and an untargeted note is design-level. A viewer screen save sends no design-wide `verdict` and needs no `pick`: the design keeps its saved verdict, except that a viewer Request change sends `requested: true` with a change note on that screen, which sets the design to `change` (label "Changes requested"), with or without a saved verdict. Any other screen save with no design verdict yet is stored as `answer:"screens"` (label "Screens reviewed") and the design stays waiting. Optional `pick` must name a listed direction, and a design-wide verdict needs one when options were offered. `answers --json`, `wait --json` and `wait --events` return these fields, and approve displays status approved.
- A plan's answer is its one send-back, which the board saves from `POST /api/answers` with `{"key", "notes", "decisions", "note"?}`: `"answer": "sent"`, `"label": "Sent back"`, plus `notes`, one per section in plan order, each `section` (its id), `verdict` (`approve` or `change`) and `note` (text, 1-500; required on `change`, a comment on `approve`), `decisions`, a map of each decision `key` to its answer — the picked option `value`, or the person's own words (Other, text, 1-500) when none fits — every decision answered, and `note` (text, 1-500), the optional whole-plan comment. `answers --json`, `wait --json`, `wait --events` and `on_answer` carry all three. A send-back that misses a section or decision, a `change` with no note, or text over 500 characters, is refused (HTTP 400) and nothing is saved.
- **Go deeper** and the read receipts of a guided plan or report are stored beside the board, never in the message. The board saves a part read with `POST /api/reads` (`{"key","part"}`), and a whole report opened, or marked read or unread on Reports, with `POST /api/reads` (`{"keys","read"}`, the last mark for a key wins) and an ask with `POST /api/deeper` (`{"key","part","q"?}`). A part is `this`, `understood`, `next`, `d:<decision key>`, a section `id` or `<section id>:<item number>`. `wait --filer <id>` wakes on an ask and returns it; `sign-off-axi deeper <board> --filer <id>` lists the open asks and `deeper <board> --id <id> --text <answer> [--more]` answers: the board streams each piece into the spot the person tapped and shows that the agent read it. With `--events`, an ask is `{"event":"deeper","key","part","about","q"?,"id","at"}`.
- Producers must keep a `wait --filer <id>` listener running after posting a guided report as well as a plan, and run it again after each reply and after plan send-back. These waits stay open for Go deeper on their own guided pages even on report-only boards or when the plan's answer was already taken. Each wait returns one batch; `TIMEOUT` (exit 1) means start the next wait, not that the page is finished. Boards without owned guided pages keep the existing `NOT_FOUND` behavior when nothing waits. This is active listening, not dormant-session wake-up.
- Standalone owners may instead register a local Claude Code session with `owner <board> --filer <id> --host claude --session <actual UUID> --cwd <absolute project folder> [--model <id>]`. Registration is scoped to canonical board identity plus filer, not part of posted JSON. A separate `owner <board> --dispatch [--filer <id>] [--timeout <seconds>]` resumes that exact idle author using installed Claude Code and its normal environment, never a shell command from document data. No other host or Firstmate route is promised. Do not also run an active wait for the registered owner.
- This dispatcher retains existing Go deeper ids/fields and all document schemas. Its separate local delivery log records `delivered` after process handoff (not model receipt), `owner-read` after the owning child explicitly calls `owner --ack <id>`, or `queued` with the real delivery failure. Inspect it with `owner <board>`. Missing/inaccessible owners remain queued without substitute answers. Restart retries unfinished requests, including those already handed over but not completed. The resumed owner sends one final atomic reply without `--more`; an already-completed owner reply is a no-op, so replay cannot append duplicate text. Existing non-owner active listeners keep streaming. These are local CLI delivery states, not new HTTP event fields or UI controls.
- Only a filer-bound wait consumes Go deeper; a board-wide answer wait leaves requests queued. A keyed filer wait takes only requests for that key. Requests saved before a wait starts survive server/listener restarts and are taken once under the existing request lock, including concurrent waits for the same filer. A delivered request is not replayed after restart; `deeper --filer <id> --json` still lists unfinished requests to recover interrupted replies. Timeout and stopping a listener before delivery do not take queued requests.
- **Agree, Disagree and Comment** on a part of a guided plan or report are saved with `POST /api/annotations` (`{"key","part","verdict"?,"text"?}`: `verdict` is `agree` or `disagree`, `text` at most 500 characters, at least one of them), beside the comments on design mocks in `<board>.annotations.jsonl`; an answers-only board takes them too, a read-only board none. On a report, **That is right** is the `understood` part's `agree`, and **Not quite** with its note (**Tell the agent**) its `disagree` with the note as `text`. A comment is not an answer: it never reaches `answers`, a round or `on_answer`. `wait --filer <id>` wakes on one, once, after the Go deeper asks, and the board then shows *Agent read it*. With `--events` it is `{"event":"comment","contract":1,"kind","schema","key","title","id","part","about","verdict"?,"text"?,"at"}`. Reply with `deeper <board> --filer <id> --id <id> --text <reply>`: the reply shows under the comment.
- What each answer means: `ask`, act on the picked value. `evidence`, the verdict goes back to the producer. `gate`, run `done-done respond --action <value>`. `finding`, `apply` means apply the change and `skip` means leave it. `plan`, act on each `change` note and each picked decision value. A `report` has no answer. `design`, `approve` or `change` is the verdict to act on; `screens` means screen notes saved, design not answered yet.
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

## 13. Tickets

A ticket is one piece of work: an `id` (a key-set id), a `title` (text, 1-160), its `progress` (a whole number, 0 to 100) and optionally the `parent` ticket it sits under, its `priority` (`P0`-`P3`), its `project`, whether it is on `hold` and whether the board's owner `asked` for it. It is not a message kind and has no `schema`: it stands alone beside the board, in the open format of [file-formats.md](file-formats.md) (**Tickets**), written by `sign-off-axi ticket --id <id> --title <text> [--progress <0-100>] [--parent <id>] [--priority P0-P3] [--project <name>] [--hold yes|no] [--asked yes|no]` or by any program that appends lines in that shape.

- Tickets nest: an epic has tickets under it, and a ticket may have sub-tasks. A ticket with tickets under it is as far along as they are on average, worked out on reading (the file keeps what was written).
- A card links to a ticket only by naming its id in `ticket` (section 4). The link is loose on both sides: posting never checks that the ticket exists, a ticket's record never names its cards (its page finds them by their `ticket`), and removing either leaves the other as it was.
- Where the card's ticket is on the board, the card's screen shows a **Ticket** row (on an ask, **Its ask** in the panel under the question), the ticket's title, id and progress, that opens the ticket; where it is not, the card shows nothing more than before. The board's **Tickets** tab lists the tickets that sit under none, by where they stand; a ticket shows the tickets under it, the cards that name it (asks, designs, proof, reports and plans), newest first, and their Activity.
- `ticket --id <id> --json` reads a ticket and its cards back (`key`, `kind`, `status`, `title`, `filed`); `ticket --json` lists every ticket. A ticket changes nothing about how a card is asked, answered or waited for.

## 14. Project icons

A project may have its own icon, which the board draws on the project's rows. Like a ticket it is not a message kind: it stands alone beside the board, in the open format of [file-formats.md](file-formats.md) (**Projects**), written by `sign-off-axi project --name <name> --icon <path>`.

- The name is the project as cards give it (a report's or design's `group`, a plan's `project`, the app of a `verify-<app>` proof), text of 1-40, matched without regard to case.
- The icon is a picture in the board file's folder, named by its path from that folder: no `..`, `?`, `#` or `\`, and its real path, links followed, stays inside the folder. It is a `.png`, `.jpg`, `.jpeg`, `.webp` or `.svg` file whose content is that type (an SVG holds no script, `foreignObject` or event attribute), 500,000 bytes or fewer. `project` pins it by its `sha256` and `bytes`; the board serves only that file, and a file changed since is not served.
- Both are optional. A project with no icon, a project not on the board and an icon that cannot be served all show a monogram tile, the project's initials. No icon ships with sign-off: each board brings its own.
