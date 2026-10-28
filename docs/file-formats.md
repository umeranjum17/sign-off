# File formats

New guided defaults use plan schema 3 / report schema 5, contract 1, with a required owning `filer`; a report 5 also names its kind in `purpose` (see [report schema 5](contract.md#report-schema-5-the-reports-kind)). Older schemas still load. Engagement v1 records share the deeper sidecar without changing legacy records: immutable document revision/owner/part/action, optional authored-field selection, streamed replies and a persisted answer-revision seen cursor. See [the exact contract](contract.md#report-schema-4-and-plan-schema-3-engagement-v1).

**Questions**, written by the agent (`decisions.json`). `sign-off-axi raise` writes them into the board it names, or the default board when none is named (see the board rule in [Test runs never touch your board](../README.md#test-runs-never-touch-your-board)); a file in this format can be raised with `raise --from` or served as its own board:

```json
{
  "schema": 2,
  "items": [
    {
      "key": "dark-default",
      "title": "Turn on dark mode by default for new users?",
      "about": "Most test users switch to dark within a day.",
      "detail": "Changes the first-run default only.",
      "why": "The setting ships with Friday's release.",
      "options": [
        { "value": "yes", "label": "Yes", "outcome": "New users start in dark mode." },
        { "value": "no", "label": "No", "outcome": "New users start in light mode, as today." }
      ],
      "recommend_value": "yes",
      "recommend_reason": "Most users pick dark anyway.",
      "default_if_silent": "no",
      "silent_by": "2026-10-19T16:00Z"
    },
    {
      "key": "release-window",
      "title": "When should the new sign-in screen go out?",
      "why": "Two fixes are still in review.",
      "options": [
        { "value": "today", "label": "Today", "outcome": "It ships without the fixes." },
        { "value": "friday", "label": "Friday", "outcome": "It ships with both fixes." },
        { "value": "next-week", "label": "Next week", "outcome": "It waits for the redesign." }
      ],
      "recommend_value": "friday",
      "recommend_reason": "Both fixes land by Thursday.",
      "default_if_silent": "friday",
      "merges": ["sign-in-date"]
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
  **Add a comment** has no Ask for another round or Send without answering; the server refuses rounds, comments
  on cards and mocks, and prompts with 403. What the person says on a guided plan or report goes to its own
  author's `wait --filer`, so it works here: Go deeper, Agree, Disagree and Comment on a part, and a report's
  **That is right** and **Not quite** with its note (**Tell the agent**), saved as the Agree or Disagree of its
  `understood` part. An answer or reply to an item the program dropped
  while the person answered it is still saved. A feeding program writes the
  board with `sign-off-axi post <board> --from <file> --replace`, which checks
  the whole file the way the board reads it and refuses a bad item before
  anything is written; answers stay. A key that was answered may not come back
  with a different title, options or reply; a contract key the program dropped
  after it was answered may not come back at all: post that question under a new
  key. A design, diagram, interactive or explainer item that comes back keeps
  its answer.
- `.sign-off-vault-id` (0600, in the board's folder, written only by a vault item): holds the random id naming that folder's private vault records. Besides vault items, only the waits read it, by identity only, and vault custody is not enabled in this build.
  Private custody metadata includes `expires`, an absolute integer Unix deadline in milliseconds, authenticated with the encrypted payload. Give defaults to 10 minutes; Receive requires an explicit deadline. New deadlines must be in the future and at most one hour away; the producer must supply an earlier provider deadline when applicable.
  Under the private custody lock, accessing an elapsed pending/ready record writes an `expired` tombstone without ciphertext. Inspect reports that state; deposit/refuse return fixed `EXPIRED` errors, and no terminal key can be recreated. Existing records without a deadline fail validation, rather than gaining a new lifetime.
  **Approved Give destinations** (module only while the vault is OFF): `$XDG_CONFIG_HOME/sign-off/vault-destinations` (default `~/.config/sign-off/vault-destinations`), a 0600 file owned by you, edited by hand only. No command, route, flag, environment variable or board field writes it. One absolute folder per line, `#` lines are comments. If the file is missing, or any line is bad, every Give is refused with `DESTINATION_DENIED`. A listed folder must be its own real path (no symlink in it), a folder you own with mode 0700, with no `.git` in it or in any folder above it, not `$HOME` or a folder above it, and not inside or around the vault folder or the board's folder. So a dotfile git repo at `$HOME` refuses every folder under `$HOME`, the same rule the vault folder itself follows. A Give destination must be a new file directly inside a listed folder: anything already there, even a dangling symlink, is `DESTINATION_EXISTS`, and a raw `.` or `..` in the path is `VALIDATION_ERROR`. The list is checked when the item is created and again under the custody lock before delivery. The list is a guard against mistakes and injected paths, not a security boundary: any program running as you can edit it or the folder (the trusted same-user model).
  **Approved Receive providers** (module only while the vault is OFF): `$XDG_CONFIG_HOME/sign-off/vault-providers` (default `~/.config/sign-off/vault-providers`), a 0600 file owned by you, not a symlink, edited by hand only. No command, route, flag, environment variable or board field writes it. One `<provider> <origin>` pair per line, `#` lines are comments; for example `npm https://www.npmjs.com`. The provider is a name in key form, listed once. The origin is written exactly as the browser would: `https://`, a lowercase host name with a dot, no IP address, no trailing dot, no port, no user, path or slash. If the file is missing or any line is bad, every Receive is refused. Like the Give list, it guards against mistakes and injected links, not against a program running as you.
  **Receive link check**: a Receive item names its `provider`, which is kept in the private metadata and authenticated with the encrypted payload (a Give item has none, and its authentication is unchanged). Before any vault folder, folder id, key or record exists, the value must be one `https://` link, at most 8,192 bytes, valid UTF-8 with no space or control character (one trailing newline is dropped), with no user or password, whose origin equals that provider's listed origin exactly. Anything else is `VALIDATION_ERROR` with the fixed sentence; the link is never printed. This is module-only: no command or route creates a Receive item while the vault is OFF.
  **Give delivery** (through `wait --into`, below): delivery needs the item's filer and the exact bound destination, else `READER_MISMATCH`; a pending item returns nothing yet. Once the destination is approved, the record is first rewritten as `claimed` with the encrypted payload removed, then the value is decrypted once in memory and written to a new 0600 file (created exclusively, file and folder fsynced), then the record becomes `delivered`, also without payload. Any failure after the claim, including a crash, leaves `claimed`: `DELIVERY_UNCERTAIN`, never decrypted again; a file this attempt created is removed, and a file someone else put there is left alone. A second delivery of a delivered item is `ALREADY_READ`. A denial before the claim leaves the item `ready`. Claimed and delivered items do not count as waiting for `wait --filer`; they reach the waits as `delivery-uncertain` and `delivered` events (below). The destination keeps the plaintext for its tool; removal from the vault is logical deletion only. A crash after the claim also leaves `vault/lock` behind; remove it by hand once no sign-off-axi is running.
  Vault admission and payload access remain **OFF**. Before serving a board, startup housekeeping scans existing private records under the custody lock and expires elapsed pending/ready items without decrypting or exposing contents. Absent custody is a no-op, with no key, folder identity or storage initialization. Unsafe or malformed custody emits one fixed value-free warning and does not prevent an ordinary board from serving; each bad record (malformed, misnamed, wrong-binding, non-file, or stray `.json`) is left unchanged while other elapsed records still expire. Custody inside or equal to the board's folder is not swept. Vault operations still fail closed on access.
  While serving, the same private sweep repeats five seconds after each preceding sweep finishes, without browser or vault access. Sweeps do not overlap within a server, do not initialize absent custody, and stop scheduling when its listener closes. Unsafe/busy custody never disables later attempts or ordinary serving; at most one fixed value-free warning is emitted per server process across startup and periodic failures. Access still enforces the absolute deadline even if housekeeping is delayed. The private module can observe an immutable `expired` tombstone as a durable expiry event: `{schema:1,id:<record digest>:expired,status:'expired',at:<stored transition milliseconds>}`. This is an explicit allowlisted projection, not a second journal or a payload hash; it requires a valid timestamp at or after the deadline and no sealed payload. Exact folder identity, key and filer are checked under the existing lock. No public route consumes this private keyed observer event; `wait --filer` (below) reads the same tombstones through its own take, and `wait --key <key> --filer <id>` (below) through a public keyed read. Private keyed observer reads never create custody/identity or drive expiry (the filer wait in the next paragraph and the public keyed wait below do expire elapsed records under the lock), and matching keyed observers replay the same event after restart without acknowledgment or rewriting it. A bounded private module wait polls once per second, with an explicit integer observer budget from 0 to 3,600,000 milliseconds measured by elapsed monotonic time. It returns only that event; timeout, refused, wrong-filer and unsafe/busy cases use fixed value-free errors. Existing lock/filesystem latency can overrun the observer budget. Without a running expiry producer, elapsed live records remain unobserved and the wait times out. Ordinary `answers`, seen files and hooks are unchanged; used/confirmed events, `--until done`, hooks and other lifecycle audit events remain required before activation. Deletion is logical, not guaranteed erasure from backups or storage journals.
  `wait --filer <id>` without `--key` (or `SIGN_OFF_FILER`) also takes that filer's private vault expiry, refusal and delivery events for items bound to the board's folder, so two board files in one folder share them. Ordinary answers and rounds come first, unchanged, with exit 0; only a poll that finds none looks at the vault. When `$XDG_STATE_HOME/sign-off/vault` (default `~/.local/state/sign-off/vault`) or the folder's `.sign-off-vault-id` is missing, this is silent: no permission walk, lock or state is created. Otherwise one non-retrying try of the custody lock expires this filer's elapsed pending/ready records (as any vault access does; nothing is decrypted) and takes each valid `expired` tombstone, `refused` record, `claimed` record (as `delivery-uncertain`) or `delivered` record that has no take marker. One poll takes one kind, in the order expired, refused, delivery-uncertain, delivered, so a later kind waiting beside an untaken earlier one comes on the next poll, and a failure is never hidden behind a delivery. Live pending/ready records count as waiting, so the wait does not exit `NOT_FOUND` while one is open; a refused record does not. Taken events print metadata only and exit 1: TOON `expired[]{key,at}` with `error: Vault item expired; request a fresh item.` and `code: EXPIRED`, or with `--json` `{"<key>":{"answer":"expired","label":"Vault item expired; request a fresh item.","close":"done","at":"<ISO>"}}`. A refusal prints the same shapes with `refused[]{key,at}`, `error: User refused this vault item; no value was delivered.`, `code: REFUSED` and `"answer":"refused"`, its `at` being the refusal time; only an expiry's `at` must be at or after the deadline. An item left `claimed` prints the same shapes with `"delivery-uncertain"[]{key,at}`, `error: Delivery interrupted; do not retry this item. Check destination locally, then request a fresh item if needed.`, `code: DELIVERY_UNCERTAIN` and `"answer":"delivery-uncertain"` (exit 1). A `delivered` item exits 0: TOON `delivered[]{key,at}` with `label: Saved to the approved destination file.`, or with `--json` `{"<key>":{"answer":"delivered","label":"Saved to the approved destination file.","close":"done","at":"<ISO>"}}`. A delivery made by `wait --into` writes no take marker, so the agent that ran it may see its own delivery once more on a filer wait. No value, URL, destination, mode, filer or folder id is printed.
  `wait --key <key> --filer <id>` (or with `SIGN_OFF_FILER`) reads that one key's vault item when no board row of that filer holds the key; a board row, waiting or answered, always wins and the wait behaves as before. The read is silent when the vault or the folder's `.sign-off-vault-id` is missing, and when the item is absent, still live or belongs to another filer, so the wait keeps polling to `TIMEOUT` as for any unanswered key. Otherwise one non-retrying try of the custody lock expires that item if its deadline has passed and returns an `expired`, `refused`, `delivery-uncertain` or `delivered` item in the shapes above (exit 1, or 0 for `delivered`). It is a replay: it writes no take marker and repeats on every later keyed wait, and it never consumes another wait's take. Without a filer the keyed wait never reads the vault. Busy or unsafe custody prints the warning below once per wait and keeps polling. Known limits before activation: a key used by both a board row and a vault item is not refused at creation, and `TIMEOUT` wording does not yet mention the vault.
  `wait --into <file> --key <key> --filer <id>` (not in `--help` while the vault is OFF) delivers that one Give item into `<file>`, which must be the item's exact bound destination. `--key` and `--filer` must both be given; `SIGN_OFF_FILER` alone is refused (`VALIDATION_ERROR`, exit 2), so an inherited environment never routes a secret write. It runs its own loop before any board read: once a second it tries the delivery, waiting while the item is absent or pending, and through busy or unavailable custody (one warning, `sign-off-axi: Vault delivery status unavailable; still waiting.`). A delivery prints the `delivered` shapes above and exits 0. Every other vault code is final for the wait: `ALREADY_READ`, `READER_MISMATCH`, `DESTINATION_DENIED`, `DESTINATION_EXISTS`, `DELIVERY_UNCERTAIN`, `EXPIRED` and `REFUSED` exit 1 with their fixed sentence; a relative or dotted path, or a Receive item, is `VALIDATION_ERROR` (exit 2). Running out of `--timeout` is `TIMEOUT` (exit 1). When the vault or the folder's `.sign-off-vault-id` was never created, it is silent and creates nothing, and so ends in `TIMEOUT`. The destination path is never printed, in any outcome.
  **Take markers**, `<record digest>.<kind>.taken` beside the record, `<kind>` being `expired`, `refused`, `delivery-uncertain` or `delivered` (0600, in the private vault folder): created exclusively (`wx`) and fsynced under the lock, holding the event id (`<record digest>:<kind>`). One marker means that filer's waits have taken the event once; a concurrent or later wait never gets it again, while the private keyed observer still replays the unchanged expiry tombstone, still fails a refused key with `REFUSED` and reports no delivery event; the keyed wait replays its item without markers (above). A take is all or nothing: if any marker cannot be made, the markers made by that try are removed before it fails. Markers are written before the output, so a crash in between loses that public notice (at most once). An existing marker that is not a private file fails the take closed. Sweeps, expiry, key creation and lock cleanup ignore markers. Busy or unsafe custody prints `sign-off-axi: Vault expiry status unavailable; ordinary answers still arrive.` at most once per wait, and a failed take never reads as nothing waiting, so such a wait keeps polling to `TIMEOUT`. An unreadable record anywhere in the vault folder, or an expired, refused, claimed or delivered record failing the event check, prints the same warning once per wait but keeps the wait's normal result (`NOT_FOUND` when nothing else is waiting). Bad records are skipped, never turned into events. A wait killed while it holds the custody lock leaves `vault/lock` behind; remove it by hand once no sign-off-axi is running.
- A 0.1.0 file, `"schema": 1` with a `"decisions"` list, still reads: each entry is an item, a decision unless it says otherwise. The first write that changes it (a `raise` of a new key, or a `post`) rewrites it as `"schema": 2` (temp file, then rename) and first keeps the old file once beside it as `<board>.schema-1.bak`. Answer and round files are not touched.
- `key`: 1-128 of `A-Z a-z 0-9 . _ -`, unique in the file. `title`: required, 160 characters or fewer for a new item; an item already on the board is not checked again, so an older longer title still loads.
- `recommend_value`: the option the poster would pick; the board shows it first and marks it **Recommended**.
  `raise` and `post` refuse an item that lists `options` without one; a plain Yes/No may leave it out.
  In a `--from` file (a `--replace` feed too), a new item of a contract kind must be a contract message: see [contract.md](contract.md) section 2. An item already on the board is not checked again, except in a `--replace` feed, which replaces the stored item: a contract message that changed is checked against its kind's rules again, so one that no longer matches is refused and the board is left as it was.
- `filer`: optional, who filed the item (1-128 of `A-Z a-z 0-9 . _ -`), written by `post --filer`.
  `wait --filer` with the same id returns the answers to that filer's items. The page shows it only in a card's **Activity** (below), as who posted the card and picked up its answer, and never a session UUID, which reads `Agent` there.
  `post --from <file> --replace --filer <id>` replaces only the items with that filer (and items with
  no filer the file names by key); every other item, the board's other top-level fields and the answers stay.
- `ticket`: optional, the id of the ticket the item belongs to (1-128 of `A-Z a-z 0-9 . _ -`), written by `raise` and `post` with `--ticket <id>` or carried in a message or `--from` item.
  It is only a reference: the ticket need not be on the board, and nothing checks or needs it. While a ticket with that id is on the board (**Tickets**, below),
  the item's screen shows a **Ticket** row (on an ask, **Its ask** in the panel under the question), the ticket's title, id and progress, that opens the ticket; otherwise it shows none. It does not change what the item asks or how it is answered.
- `priority`: optional, how urgent the item is: `P0` (most), `P1`, `P2` or `P3` (least), written by `raise` and `post` with `--priority` or carried in a message or `--from` item. Any other value refuses the board file.
  The board shows it as a chip and can sort by it; an item without one shows no chip. It does not change what the item asks or how it is answered.
- **Activity**: every card's screen (an ask, a sign-in, an update, a design review, a report and a plan) lists, oldest first, what the board keeps of it: when it was posted and by whom (its `filer`, with its `link` when that is a web link),
  the answer a change replaced, the answer and its note, when its filer took it with `wait --filer` (`*.seen.jsonl`), each another-round ask with its note (`*.rounds.jsonl`) and each comment on it (`*.messages.jsonl`).
  Steps are compared to the second (answers are stored to the second); within one second they keep that order. A card whose only step is its posting shows no Activity. A ticket shows its cards' steps after their postings together, newest first, each naming its card. Nothing is written for it.
- `area`: optional, the board area the item shows in: `waiting`, `evidence`, `reports` or `answered`
  (Waiting on you, Evidence, Reports and explainers, Answered). Without it an `evidence` item is in Evidence;
  an `explainer`, an item with nothing to answer, or any item on a read-only board is in Reports and
  explainers; a `signin`, a `plan` and any other item is in Waiting on you, a sign-in on top of them; a plan stays there until it is sent back. An answered item is always in Answered. On a board
  that is not read-only, Reports and explainers lists only an `explainer` and an item with an `.html`
  `view`; any other item there is folded under Notes, a short row that opens to its card. A feed's
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
- `contract`, `kind`, `schema`: an item posted as a contract message keeps them ([contract.md](contract.md)).
  An item with `"kind": "report"` is only read, on any board, and never waits; it takes no `options`, `reply`, `area` or `type` ([contract.md](contract.md) section 5).
  It keeps its page, `view` (`.html`), and that page's picture, `preview`, from the board file's folder; a report stored before reports had pages has neither and still loads.
  An item with `"kind": "gate"` waits like a decision and keeps the done-done `run` it holds (`run_id` and `commit`) as sent; its answer is the `done-done respond --action` to take.
  An item with `"kind": "finding"` waits like a decision and keeps its `cause`, `incidents`, `days`, `evidence_ids`, `change_kind` and `proposal` as sent; its answer, `apply` or `skip`, says whether to make the proposed change.
  An item with `"kind": "plan"` keeps its `about`, `sections`, `decisions`, `steps` and `view` as sent; its answer is the one send-back ([contract.md](contract.md) section 7). Its card shows the title, how many sections and decisions it has, and Open plan, which opens the `view` page over the board. Its page reviews each section and decision and sends them back at once.
- `filed`: optional, when the item was filed, an ISO 8601 date-time such as `2026-10-13T07:19:00Z`.
  `raise` and `post` write the current time when the item or flags give none, and `post --replace`
  keeps the time an item already has, so a feeder that runs every few seconds does not reset it.
  An open ask's card says `waiting since 07:19`, and the Waiting on you tile shows the oldest (`Oldest 07:19`);
  with no `filed` on any waiting ask the tile keeps its count.
- `group`, `decided`, `form`, `video` and `asked_by`: on Reports and explainers. The list is two sections, `New` (filed today) above `Earlier`,
  newest first in each, with no × on a row (Dismiss is on the report's page). `form` (`diagram`, `chart` or `before-after`) picks the row's line icon; with none the row shows a book.
  `video` (10 characters or fewer, such as `0:28`) and `asked_by` (40 or fewer, such as `You asked`) fill the row's line, `Diagram · Interactive · Video 0:28 · You asked, 07:19`;
  with none of `form`, `video` and `asked_by` it reads `Report · 07:19`. `group` (40 characters or fewer) is kept but the list does not show it.
  A dot marks a report filed today. `decided`
  (200 characters or fewer) shows under the label `What it decided` on the report's page, or in the opened row of an explainer with no page.
  An item without these keeps its kind and its about line.
- `type`: optional, `decision` (default), `design`, `evidence`, `diagram`,
  `interactive`, `explainer` or `signin`. A design item
  is a pick between mock options shown side by side. An evidence item is a
  numbered update the person gives a verdict on (below). A sign-in asks the
  person to sign in (below). Any other lowercase
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
- `signin` items ask the person to sign in: `title` is the service, `link`
  (required) the `http(s)` sign-in link, 2000 characters or fewer, with no user
  name or password in it, `unlocks` and `waits` (required, 120 characters or
  fewer each) what it unlocks and who waits on it, and `expires` (optional) an
  ISO 8601 date-time when the link stops working. In place of `link` and
  `expires`, `start` is a command as a list of 1 to 64 texts, such as
  `["npm", "login", "--auth-type=web"]`: each tap on Open runs it on the board's
  computer with no shell and opens the first https link it prints on stdout
  (on stderr when stdout has none within 2 seconds). A sign-in takes no `options`,
  `reply`, `recommend_value` or `default_if_silent`: `signin done` saves its
  answer, `done` with the label `Signed in`.

  ```json
  { "key": "npm-login", "type": "signin", "title": "npm", "link": "https://example.com/login",
    "unlocks": "Publish the release", "waits": "Main", "expires": "2026-10-16T17:10:00Z" }
  ```
- `tradeoff`: optional on design items, plain text up to 1000 characters, shown
  next to the mocks. A trailing `Open in first-draft: <label> <url> · <label> <url>`
  (what `first-draft-axi post` writes) is shown as real links under the text, outside the
  mock frames; the text before it stays the trade-off.
- `mocks`: optional on design items, up to 6 entries of an option `value`, a
  `path` to a mock file (`.html`, `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`, 5 MB or less), relative to the board file's folder, and an optional `link` (http or
  https, no spaces, 500 characters or fewer) drawn as an Open live link under that option's mock,
  outside its sandboxed frame. Each value must
  name one of the item's own options. Served only from inside that folder. An
  `.html` path may end in `?variant=<name>` (1-64 of `A-Z a-z 0-9 . _ -`): the
  page is loaded with that query, so one page can show each variant. An `.html`
  mock or view loads the files beside it by relative name (`style.css`,
  `img/dot.png`): the board serves `.html`, `.css`, `.js`, `.mjs`, `.svg`,
  `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.woff2`, `.mp4` and `.webm` files
  from inside that page's own folder only, never anything above it. `export`
  inlines the page itself, so those files show only on the running board.
  The board adds a small pointing script to each `.html` mock page and plan page it serves
  (see the README); it passes only text to the board. A pointed element is
  kept as `{ ref, tag, text }`: `ref` is a path to it, and anything that finds
  it again must check `tag` and `text` and show nothing when they differ. The
  mock page itself has `window.signOffFind({ ref, tag, text })`, which gives
  back that element, or null when its tag or words differ. A ref is made on one
  mock file. If that file is overwritten in place, an old ref is checked against
  the new file and can match a different element with the same tag and words at
  the same path; to keep refs exact, post a revised mock under a new round or
  key. The words are the element's text nodes joined with one space, at most 80
  characters. Tag and words are only a safety check, so empty words for a field are
  fine.
- Every item that asks something has one place to type, folded behind a quiet
  **Add a comment** right after its buttons (a design's Picks too; a sign-in has none,
  it closes with `signin done`; on Decide it is one **Note** open under the cards,
  and **Your own answer**, the last card, sends its own words as the answer `text`): a short text,
  500 characters or fewer, with the placeholder "Add a note (optional)". Typed
  before a button is picked, it goes with that answer as its note (the comment),
  and the card then shows it and reads **Edit comment**. The card keeps one
  answer button; the box's **More…** (not on Decide, whose **More** holds only Ask me later and Dismiss) holds **Send as my own answer** (saves the
  answer `text` with the words as its `note`) and, on a normal board,
  **Ask for another round** (not on an evidence update) and
  **Send without answering** (a comment). An item with an option valued `text`
  takes the words only as a note: it has no **Send as my own answer**. A
  `reply` item with no options sends its reply with **Send reply**.
- `reply`: optional, `true` lets an item take a text reply with
  `"options": []`, where the reply is the only answer (**Write a reply**); on an
  item with options, the reply also goes to the agent as a comment and stays
  the note of an answer picked after it. No option may use the value `text`
  then.
- `options`: optional, 2 to 6 choices, or `[]` on a read-only or answers-only board for an item that is only shown and waits on nothing (unless it has `reply`). Each has a `value` (1-128 of `A-Z a-z 0-9 . _ -`, unique within the question) and a non-empty `label` shown on its button. Leave it out for **Yes** (`yes`) and **No** (`no`); files written before options existed read exactly as before.
- `recommend_value`, `default_if_silent`: the `value` of one of the question's own options (`yes` or `no` when `options` is left out). Optional on a board item; both are required on a new question (the bullet below). The board shows `default_if_silent`, and on the leash When it matters takes it as the answer at `silent_by` ([contract.md](contract.md) section 5).
- `guard`: optional, `destructive`, `irreversible`, `money`, `credential` or `security`: no leash ever answers the question for the person.
- `close`: optional, `done` (default) or `release`; copied into the answer.
- `why`, `recommend_reason`, `silent_by`, an option's `outcome`, `merges`, `proof` (the evidence update an ask rests on) and `report` (the report an ask is about): the question standard, owned by [contract.md](contract.md) section 5. `raise` and `post --type decision` check every new question against it; items already on the board read as before.
- `link`: optional on any item, an `http(s)` link (shown on its card as **Open on** and the site name) or a 7-40 character commit hash (shown under **Details**); a sign-in's link is its own and shows as its **Open** button (above).
- Other keys are ignored.
- `evidence`: optional read-only link to a done-done schema 1 run. Set `run_id`, its full 40-character `commit`, and the four plain-text Checks lines (`outcome`, `repro`, `proof`, `evidence`), each non-empty trimmed text up to 1000 characters. Start `serve` with `--evidence-root <store-root>` (the directory containing `.done-done/`); the board only reads that root and only opens media listed and hash-matched in that run record. The card reports the run command outcome, not a persisted claim-check receipt. done-done has no receipt schema yet; a missing or mismatched record stays `UNVERIFIED` in `evidenceCard.result`. On the list card and the update screen the result is **Check passed**, **Check failed**, **Check did not finish**, or **Could not check**, the last with a one-sentence reason and **Ask the agent to run the check again.**; an evidence update takes `outcome` (160 characters or fewer) as its headline, shows the run's media when it has none of its own, and folds its own title, the commit and the four lines under **Details**. Without `--evidence-root` the board looks for the run's record in done-done's own folder for its app (`~/.done-done/evidence/<app>/.done-done/runs/<run_id>.json`) and checks it the same way; a run it finds nowhere is not checked and the update shows **No result yet**. Evidence lists every evidence update, and an update is never an ask: Waiting on you, the Decide count and the Need you tile do not count it. Each card says its honest result: **Passed** (`evidenceCard.result` is `RUN PASS`, with the tick), **Not run** (no linked run, or a run the board finds nowhere), **Failed**, **Did not finish** or **Could not check**. Only a passed run shows the tick, and the update's own screen keeps the verdict and dismiss controls. **Proven today** and the glance's "N updates filed" count every update filed today, each keeping its own result tag. For the project filter, the project name is the `[done-done-]verify-<project>: ...` line at the start of `proof`, trimmed and compared without case; with no such line it is the repository named in the update's change link (`.../<repository>/pull/<n>`); an update with neither counts as Other, which comes last. Evidence lists updates in one list, newest first, whatever their result, with no project or day headings; when updates name more than one project, a picker beside the search box shows one project at a time. On the update screen, Checked by is the one-word name before the first colon of `proof` (for example `done-done-verify-sign-off`) and What ran is the rest of that line; without that prefix the Checked by row is omitted and What ran is the whole line.

```json
"evidence": {
  "run_id": "20261011T120000Z-a1b2c3d4",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "outcome": "Umer can see the updated sign-in screen.",
  "repro": "repro: n/a: no bug",
  "proof": "done-done: real browser journey",
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
- `media`: 1 to 12 files, each under `evidence/<number>/` and ending in `.png`, `.jpg`, `.jpeg`, `.webp`, `.mp4` or `.webm` (any case), with the `sha256` and `bytes` recorded at post time. The board serves a file only while both still match.
  A still may also carry `light`, `thumb` and `tile`, smaller copies `post` made beside it (`evidence/<number>/<n>-light.jpg` or `.png`, `<n>-thumb.jpg` or `.png`, `<n>-tile.jpg` or `.png`), each `{ path, sha256, bytes, width, height }`. The light copy is at most 1600 pixels wide and is shown on cards and the update's screen; the thumb is cropped to at most twice as tall as wide (from the top) or twice as wide as tall (from the centre), at up to 720 by 1440 pixels, and is shown in lists and at the top of Decide; the tile is that same crop at up to 264 by 528 pixels (a few KB) and is shown on each row of Evidence. Each is made only when it weighs less than what it stands in for, with the original's colour profile and EXIF orientation applied, and is served at `/api/media?key=<key>&i=<n>&v=light` or `&v=thumb` under the same hash check. The original is never changed and opens full size; a still with no copies (a recording, an older post, one the board could not read) is shown as posted.
  An update that has an `evidence` run link or `attachments` may leave `media` out.
- `attachments`: optional, 1 to 5 files a user downloads from the card (`post --attach <file>`, any type, 1 GB each unless `SIGN_OFF_ATTACH_MAX_MB` says otherwise). Each is `{ path, name, sha256, bytes }`: `path` is `evidence/<number>/attach-<n>.<extension>` (named by the board, never by the poster), `name` is the download name (letters, digits and `. _ ( ) + -` only, 120 characters or fewer). `post` copies the file without reading it into memory and hashes it in chunks. The board streams it at `/api/attachment?key=<key>&i=<n>` with `Content-Disposition: attachment`, byte ranges, and its type (an `.apk` is `application/vnd.android.package-archive`, an unknown one `application/octet-stream`), only while its size still matches. A read-only export lists the file but does not carry it.
- `post --kind evidence` ([contract.md](contract.md) section 5) writes the same item: it keeps `contract`, `kind` and `schema`, takes `key` from the message or `update-<number>`, and stores the message's `run` as `evidence`.
- `options` defaults to **Pass** (`pass`), **Fail** (`fail`) and **Needs work** (`needs-work`); the verdict and its note are saved as an answer.

**Answers**, written by sign-off next to the questions (`decisions.answers.jsonl`, mode 600, one line per click, the latest line per key wins):

```json
{"key":"dark-default","answer":"yes","label":"Yes","close":"done","at":"2026-10-11T09:14:03Z"}
{"key":"release-window","answer":"friday","label":"Friday","close":"done","at":"2026-10-12T04:50:32Z","note":"After the Friday stand-up."}
```

- `answer` is the picked option's `value`, `label` its label at the time of the click. An own answer (**Send as my own answer**, or **Send reply** on a reply item) is saved as
  `"answer":"text","label":"Reply"` with the typed words as its `note`.
- An **Undo** (offered for a few seconds after each tap) is saved as one more line: the answer before the tap, or, when there
  was none, an empty `answer` and `label` (`{"key":"dark-default","answer":"","label":"","close":"done","at":"..."}`), which
  leaves the key unanswered, so the item waits again. An `on_answer:` command gets that line too.
- `note`: present only when the person typed one. Optional free text, trimmed, up to 500 characters, sent with the click. Picking the same answer again with a changed note adds a new line; clearing the note and clicking again removes it. Lines without `note` (all lines written before notes existed) read as before.
- `taken` and `reason`: present only on an answer the leash took for the person: `default` (the board took `default_if_silent` at `silent_by`) or `agent` (the agent's `recommend_value`, on Act, then tell me), and why in one line.
- `replaces`: present only on a changed answer: the answer this line replaces (`answer`, `label`, `at`, `note` and `taken`), or, when an Undo had left the key with no answer, the last one its filer took with `wait --filer`. Every earlier line stays in the file.
- `comments`: present only when the answer carried comments on mock elements (below): each as `id`, `mock`, `hash`, `ref`, `tag`, `words` and `text`, as it was sent.
- `sign-off-axi answers --json` prints the same fields per key, without `key`, and adds `note` only when the latest line has one; `comments` holds every comment sent with any answer line for the key, so a later pick or Undo does not hide them. The default output lists every sent comment in one `comments` table with its `key`.

`*.answers.jsonl` is git-ignored here so an answer is never committed by accident.

**Another-round asks**, written by sign-off next to the questions
(`decisions.rounds.jsonl`, mode 600, one line per ask, oldest first):

```json
{"key":"sign-in-layout","note":"Show B with the A header.","at":"2026-10-12T15:40:03Z"}
```

- Asking wakes a waiting agent the same way an answer does. `answers --json`
  adds a `rounds` list per answered key only when that key has asks.
- An ask carries the card's comments on mock elements not sent yet in `comments`, as an answer does; with any, its `note` may be empty.

**Dismissed items**, written by sign-off next to the questions (`decisions.dismissed.jsonl`, mode 600, one line
per item per tap, the latest line per key wins). **Discard** (the × or the Discard button on an item, on every card, a plan included, and **Select** then Discard N in Decide and Designs) saves the person's `reason` (`not-relevant`, `replaced` or `done-elsewhere`) with the line; **Select** then Dismiss N and **Clear all** on Evidence, Reports and Answered save none. Both hide
items from the page; **Undo**, or **Restore** under **Archived**, saves `"dismissed": false`. A discard is a send on the feedback trail (below): the board's state carries it in `trail` (`kind: "discard"`, `reason`) and in `discarded` (`{key: {reason, at}}` while it holds), and the filer's `wait` hands it over once Undo's 10 seconds are over (a restore inside them drops it from the trail, so the agent never hears of it); `answers` and `list --full` show it as `discarded`. `list` does not count a dismissed item as waiting or answered, and `answers` does not count it as waiting either (`list --full` says `dismissed` for an unanswered one and still its answer for an answered one, `list --json` adds `"dismissed": true`; an evidence update, which is never waiting, says `shown`); a plain dismiss tells the agent nothing, so an ask it waits on keeps waiting, and `answers` still returns a dismissed answer.
A new answer or another round after the line brings the item back. Reports and other items that ask nothing (no options, reply, sign-in, plan or design) are archived the same way a day after their `filed` time, with no line written: they show under **Archived** on Reports and nothing is deleted. Evidence is never archived this way: only a line hides a proof. Any line for the key, such as Restore, ends the rule for that item. A read-only or answers-only board archives nothing. `sign-off-axi dismiss --filer <id>` writes a line for every card of that filer still waiting. Read-only boards refuse it; answers-only boards take it. The `sign-off-axi dismiss` and `restore` commands write the same line without checking read-only, as other CLI writes such as `signin done` do.
`*.dismissed.jsonl` is git-ignored here like `*.answers.jsonl`.

**Promoted designs**, written only by `sign-off-axi promote <key>` (`decisions.promoted.jsonl`, mode 600, one line `{"key","promoted","at"}` per change, the latest line per key wins; `--undo` saves `"promoted": false`). A design review (`kind: "design"`) shows under **Designs** only: it is not in Decide, Answered, Today's tiles or Up next, and sends no notice, until its key is promoted here; it then counts and notifies like any ask. No post, feed or board request writes this file, and a design item that carries `area` is refused. `list` counts a design as waiting on the user only once it is promoted (`list --full` says `in review` until then), while its poster's `wait` still waits for the verdict; `list --json` adds `"promoted": true`. `*.promoted.jsonl` is git-ignored.

```json
{"key":"keep-the-weekly-digest","dismissed":true,"at":"2026-10-12T15:41:10Z"}
{"key":"fleet-dashboard-first-look","dismissed":true,"at":"2026-10-12T15:42:03Z","reason":"replaced"}
```

**Tickets**, written only by `sign-off-axi ticket --id <id> ...` (`decisions.tickets.jsonl`, mode 600, one line per write, the latest line per `id` wins). A ticket stands alone:
no item needs one, a board without the file has none, and every card and command works the same. Another program may append lines in the same shape (one JSON object and a newline per write).

```json
{"id":"T-9","title":"The new settings page","progress":0,"priority":"P1","project":"Settings","asked":true,"at":"2026-10-23T09:10:00Z"}
{"id":"T-29","title":"Ship the new settings page","progress":60,"parent":"T-9","priority":"P0","at":"2026-10-23T09:12:00Z"}
{"id":"T-31","title":"Publish to npm","progress":0,"parent":"T-29","hold":true,"at":"2026-10-23T09:14:00Z"}
```

- `id`: 1-128 of `A-Z a-z 0-9 . _ -`, what items name in `ticket`. `title`: text, 160 characters or fewer. `progress`: a whole number from 0 to 100, the percent done.
  `parent`: optional, the id of the ticket it sits under, never its own; that ticket need not be on the board. `at`: when the line was written.
- Optional, each left out when not set: `priority`, one of `P0` to `P3`; `project`, a project name (text of 40 characters or fewer, as **Projects** below names one), whose icon its rows show;
  `hold`, `true` while the work is on hold; `asked`, `true` when the board's owner asked for the work (the Tickets screen's "Who asked" filter says From you for it, Fleet upkeep for the rest).
  `by`, optional: who wrote that line, from `ticket --filer <id>` or `SIGN_OFF_FILER` (1-128 of `A-Z a-z 0-9 . _ -`); a later line does not inherit it, a bare session id names nobody and is not kept, and a line written with none shows no "Made by" in Activity, and one written with an old product prefix (`firstmate-`, `juggernaut-`) shows it without the prefix, `crew` as `worker`.
- A new ticket needs a title; its progress starts at 0. A later write with the same `id` changes only the fields it gives (an empty value takes an optional one off); a write that changes nothing adds no line.
- A line that breaks a rule, or a torn line, is skipped with a warning; the other tickets still show.
- **The tree and the roll-up.** An epic is a ticket with tickets under it, and those may have sub-tasks under them, each by its `parent`. A ticket with tickets under it on the board is as far along as
  they are on average (each of them worked out the same way), so its own `progress` counts only while nothing is under it. The roll-up is worked out on reading, never written: `/api/state`
  and `ticket --json` carry it as `progress`, and the file keeps what was written. A loop of parents stops where it would come back round.
- Optional `stage`: `queued`, `building`, `review`, `merging` or `done`, published by sync independently of progress. `last_event_at`: nonnegative whole epoch seconds. `--stage` and `--last-event-at` preserve when omitted and clear on an empty value; the latter also accepts ISO UTC (`YYYY-MM-DDTHH:mm:ssZ`, optional `.000`). Invalid values are refused before writing. Both read back in `ticket --json` and `/api/state`. Leaf rows and pages show the stage beside their bar; epics keep their average bar without a stage. After six hours without an event, a ticket whose stage is not `done` shows `stuck Nh` (whole days after 24 hours); no timestamp means no warning.
- Optional `release`: nonblank text, at most 40 characters (for example `0.6.1`); `state`: `queued`, `in progress`, `on hold` or `done`; `prs`: an array of full HTTP(S) URLs. `--release`, `--state` and repeatable or comma-separated `--pr` replace these fields; an empty value clears one. Omitted flags preserve existing values. Release appears as a chip on rows and pages; PRs appear as links under Linked.
- When `state` is present, the existing groups use it: `queued` → **To do**, `in progress` → **In progress**, `on hold` → **On hold**, `done` → **Done**. It does not rewrite progress, hold or parent roll-up. Without it, where a ticket stands follows from it: **Done** at 100%, else **On hold** while `hold` is set, else **To do** at 0% and **In progress** past it.
- The board's state (`/api/state`) carries `tickets`, each id's latest line with its roll-up. The **Tickets** screen has two tabs, **All tickets** (`#tickets`) and **Activity** (`#activity`). All tickets lists the tickets that sit under no ticket on the board: how many are done of how many, one square each, then In progress, On hold and To do (and Done on a phone),
  with a filter by who asked (From you or Fleet upkeep, shown only while the board has both) and by project. A ticket, `#ticket/<id>`, opens over the list on a phone and beside it on a desk: its project and where it stands, its title, priority, progress, the ticket it sits under
  and when it last changed; the tickets or sub-tasks under it; the items that name it (not dismissed), newest first by `filed`, each opening where it lives; and their Activity, newest first.
  The Activity tab is a board-wide timeline, newest first and grouped by day, for ticket creation, stage, progress and state changes, merges, holds and releases; on a phone the All tickets screen keeps a short Activity card that links to it. Each event is a row with the same tags as the In progress cards (project, P0-P3 priority, stage) and carries `project`, `priority`, `stage`, `state`, `prs`, `from` and `to` (and `by` when a writer is known) beside `kind`, `text`, `title`, `ticket` and `at`; changes of one ticket within 2 minutes of each other are one row with the newest change's headline, and its `earlier` lists the others (each a full event, oldest first); an `asked` ticket also carries `ask`, the `title` and `filed` time of the earliest ask card whose `ticket` names it (nothing when there is none); tapping a row, or Enter or Space on it, opens an expanded view with the full title, the change in plain words (every change of a burst), the ask's words quoted with their date, who made it, the ticket and each pull request as links, and the exact time. Filters narrow it by project, priority and type. A ticket's Activity combines those events with its linked cards' updates. Activity is derived from successive ticket records and included in board refreshes while the Tickets tab or a ticket is open, so updates appear without a manual page refresh. A ticket-comment reply or an answer to a linked ask releases an on-hold ticket in that action, sets its state to **In progress** when rolled-up progress is nonzero or **To do** otherwise, updates `last_event_at`, and records **Hold released** in Activity.
  `ticket --id <id> --json` prints the ticket and its `cards` (`key`, `kind`, `status`, `title`, `filed`); `ticket --json` lists every ticket with its card keys.

**Projects**, written only by `sign-off-axi project --name <name> ...` (`decisions.projects.jsonl`, mode 600, one line per write, the latest line per name wins, names matched without regard to case).
A project here only carries its own icon: no item needs one, a board without the file has none, and every project then shows a monogram tile, its initials.

```json
{"name":"Beacon","icon":{"path":"icons/beacon.png","sha256":"9f2c…","bytes":4120},"at":"2026-10-23T09:10:00Z"}
{"name":"Tern","at":"2026-10-23T09:12:00Z"}
```

- `name`: text of 40 characters or fewer, the project as items give it. `at`: when the line was written.
- `icon`: optional. `path` is a file in the board file's folder, as a path from it with no `..`, `?`, `#` or `\`, ending in `.png`, `.jpg`, `.jpeg`, `.webp` or `.svg`; `sha256` and `bytes` (1 to 500,000) pin its content.
  `project --icon` refuses a path whose real path leads outside the folder, a file over 500,000 bytes, one whose content is not the type its name gives, and an SVG with a script, `foreignObject` or event attribute. `--clear-icon` writes a line with no icon.
- A line that breaks a rule, or a torn line, is skipped with a warning; the other projects still show.
- The board's state (`/api/decisions`) carries `projects`, each name's latest line. `GET /api/project-icon?name=<name>` (any case) serves the pinned file with its picture type, `nosniff` and the sandbox policy of every served file; it answers 404 for a project with no icon, a name not on the board and a file that changed or moved out of the folder since it was set, and the page then draws the initials. With `&h=<the first 16 characters of sha256>` the browser keeps it for good.
  `project --json` prints every project.

**Taken answers**, written by `wait --filer` next to the questions (`decisions.seen.jsonl`, mode 600):
one line per answer the item's filer took, so the card shows **Seen by agent**. A changed answer is new
again until the filer takes it too.

```json
{"key":"keep-the-weekly-digest","answer":"yes","at":"2026-10-12T15:40:03Z","seen":"2026-10-12T15:40:04Z"}
```

**The feedback trail**, next to the questions (`decisions.trail.jsonl`, mode 600, oldest first): how far each thing the person sent on a card got.
What they sent is in its own file (an answer with its note, a design's notes or a plan's send-back, a new round, a comment, a discard with its reason); this file holds the steps after it, one line each:
`delivered` (a wait that is not the filer's own handed the answer over, or the `on_answer` hook ran and exited 0), `read` (the filer's own `wait --filer`, or `feedback <key> --read`),
`reply` (`feedback <key> --reply <text>` or `--acted`, with an optional `link`) and `seen` (the person opened the card with the reply). A line names the card's `key` and covers
everything sent on it up to its time (to the second). `feedback <key> --delivered|--read|--reply|--acted --at <epoch seconds>` writes a step that happened earlier, with that time (never before the send or in the future; a step the card already shows is not written again). A send taken by the filer's `wait` (a `decisions.seen.jsonl` line) is read, a comment `poll` handed over is delivered, and
a card posted again after a send counts as acted on. The board's state (`/api/decisions`) carries `trail`: one entry per send with `at`, and `delivered`, `read`, `reply`
(`at`, `text`, `link` or `acted`) and `seen` once reached. The page marks a reply seen with `POST /api/trail` (`{"key"}`), which an answers-only board takes too.

```json
{"op":"read","key":"keep-the-weekly-digest","at":"2026-10-12T15:41:00Z"}
{"op":"reply","key":"keep-the-weekly-digest","text":"It keeps going out; the next one is Monday.","link":"https://github.com/owner/repo/pull/12","at":"2026-10-12T16:02:10Z"}
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

**Comments on mock elements** (`decisions.annotations.jsonl`, mode 600, oldest first).
Each names its item's `key`, the option's `mock`, the sha256 `hash` of that mock file when the comment was saved,
and the element as `ref`, `tag` and `words` (see the pointing script above). A later line with the same `id` edits it,
and a `deleted` line removes it. A save sends the `hash` the page showed; when the file has changed since, the server answers 409 and nothing is written. An edit sends the `id` of its comment; when that comment is no longer live, the server answers 404 and writes nothing. The board shows an unsent comment only while its mock file still has that hash,
and under the list it counts the unsent comments on an earlier version of each mock as hidden; a sent one is always listed.
A read-only or answers-only board returns none of them from its state, so its page shows none (comments on a part of a guided page, in the same file, an answers-only board keeps):

```json
{"key":"sign-in-layout","mock":"a","hash":"1ca1060e…","ref":"#sign-in > button:nth-of-type(1)","tag":"button","words":"Sign in","text":"Make it green.","id":"b61d84c0f9b3","at":"2026-10-13T21:50:02Z"}
{"id":"b61d84c0f9b3","deleted":true,"at":"2026-10-13T21:51:40Z"}
```

- `text`: 1 to 500 characters, trimmed; `ref`, `tag` and `words` 300 or fewer. One comment per element:
  a second one on the same element of the same file edits the first.
- The next answer or another-round ask on the card sends its comments shown on the current mock files (not the hidden ones) in that line's `comments`.
  A comment whose `id` is in an answer or ask line is sent: the state marks it `"sent": true`, an edit or delete of it answers 409 and writes nothing,
  and a new comment on the same element is a new one, sent with the next answer. An Undo sends none and leaves sent comments sent; after an Undo back to no answer, sent comments come with the next answer.

**Local owner delivery**, separate from posted documents and existing Go deeper events: `<board-stem>.owners.json` (0600) maps filer ids to `{host:"claude",session:<UUID>,cwd:<absolute folder>,model?:<id>}`. The canonical board path scopes the file; no route is accepted from document JSON. `<board-stem>.delivery.jsonl` (0600) records `{id,state,at,error?}`, keyed by the unchanged Go deeper request id, with latest state `queued`, `delivered` or `owner-read`. The dispatcher retries unfinished requests regardless of a previous read/handoff, but never completed ones. `owner` shows the latest state and actual error. Registration uses an atomic rename under `<board.json>.owners.lock`; one dispatcher holds `<board.json>.dispatch.lock`. A dead dispatcher's PID lock requires deliberate cleanup after its child has stopped. `init` git-ignores owner bindings and delivery logs. No credentials are stored in either sidecar.

**Read receipts and Go deeper** of a guided plan or report (`decisions.reads.jsonl` and `decisions.deeper.jsonl`, mode 600, oldest first). A read line is `{"key","part","by":"captain","at"}`: the person had that part on screen for a moment; the first line for a key and part is its read time. A Go deeper file holds one line per step of an ask, by `id`: `{"op":"ask","id","key","part","about","q"?,"at"}` when the person taps, `{"op":"read","id","at"}` when the agent takes it (`wait --filer` or `deeper`), and `{"op":"say","id","text","more"?,"at"}` for each piece of the answer; a `say` with no `more` ends it. Text is 1 to 2000 characters, a question 500 or fewer. `init` git-ignores both.

**Access token** (`decisions.token`, mode 600): made the first time the board is served beyond `127.0.0.1`
and reused after that. The board reads it on every request, so deleting it shuts old links out at once.
Deleting it, then `stop` and `open` again, makes a new one (`stop` and `open` alone reuse it). `open` prints
it in the link; the server log never holds it. `init` git-ignores `*.messages.jsonl`, `*.annotations.jsonl`, `*.token` and
`*.export.html` with the other files sign-off writes.

**Board isolation for tests.** The default board and the walk to a project board are in the README's
[Test runs never touch your board](../README.md#test-runs-never-touch-your-board).
