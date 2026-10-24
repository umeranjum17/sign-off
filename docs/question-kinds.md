# Question kinds: reference

What each `sign-off-axi post --type ...` asks, in full. The README shows
one line and one screenshot per kind; this page keeps every fact.

Contract kinds behind the types: most questions are `ask` (schema 1),
proof updates are `evidence` (schema 1), holds are `gate` (schema 1),
retro proposals are `finding` (schema 1), read-only pages are `report`
(schema 2), and an agent's plan is `plan` (schema 1). The rules are in
[contract.md](contract.md); the file layout is in [file-formats.md](file-formats.md).

## Decision (yes/no and pick-one)

With no `--option` a question is Yes/No; 2 to 6 `--option` flags make it
pick-one (`--option friday=Friday --option next-week="Next week"`).
The question standard ([contract.md](contract.md) section 5) decides what each
new question needs and when it is refused. Its flags:

- `--why <text>`: what it is about and why it needs an answer now.
- `--outcome <value>=<text>`: what happens next if that option is picked, one
  for every option (yes and no too).
- `--recommend <value>` with `--recommend-reason <text>`: the option you would
  pick, and why.
- `--default <value>`: what happens if the user stays silent. The board shows
  it and never applies it; the asking agent takes it after `--silent-by`.
- `--silent-by <ISO UTC time>`: optional, when that happens, such as
  `2026-10-19T09:00Z`.
- `--merge <key>`: up to 10 other cards that ask the same thing. They are
  hidden while this one waits, and its answer closes them too.

Each answer is one tap, with an Undo for a few seconds after it (an Undo is
saved as an answer change). Typing is optional: every question with options has
a text box folded behind a quiet **Add a comment** right under its choices.
Words typed there go with the answer picked next as its `note` (the comment the
agent reads in `answers` and `wait`), so the answer is still one tap and the
card keeps one answer button. **More…** holds the other ways to send
the words: **Send as my own answer** saves them as the answer `text` (not
offered when an option is valued `text`), with the same Undo.
`post --type decision` (the default) is exactly `raise`, and `raise` stays
as its alias.

## Design pick

`post --type design` asks for a pick between up to 6 mock options, each with
an optional `--mock <value>=<path>` file (`.html`, `.svg`, `.png`, `.jpg`,
`.jpeg`, `.webp`, 5 MB or less) shown as a tall phone frame above its button
(the recommended one first; on a phone the frames swipe sideways, the next
one peeking in, and a tap opens one full screen), plus a `--tradeoff` line and
a `--recommend` badge. **Open full screen** (under the frames, and on an
interactive page's card) shows the mock over the whole screen in the same
sandboxed frame, taking every tap, so the prototype's own links, tabs and
pages beside it work. Its bar holds Close, the option shown, **Phone** (390)
or **Desktop** (1280), which draws the prototype at that width, centred and
scaled down only when the screen is narrower, and **Reference**, which shows
another option's mock beside it (over it where the two do not fit), with an
Open live link for an option's `--link` (a live site opens in its own tab;
the frame loads no remote files). An interactive page has no other option, so
no Reference. A click with Cmd, Ctrl or Shift still opens the mock file in a tab. Mock paths are relative to the board file's folder
and never escape it. One `.html` page can hold every variant:
`--mock a=mocks/<key>/index.html?variant=a` loads the page with `?variant=a`.
An `.html` mock or view loads the css, scripts, images and fonts beside it
by relative name (`style.css`, `img/dot.png`), from its own folder only,
never anything above it. The board adds a small pointing script to each
`.html` mock: once the board turns it on for that frame, a tap on a part of
the mock is kept from the mock and named back to the board as a path to that
element, its tag and its words; it passes only text and gives the mock no
reach into the board. With **Comment on the mocks** on, a tap opens a
comment on that element: one per element, listed under the mocks with Edit
and Delete (words typed but not yet saved stay with their element while the
page is open, so tapping another element and back keeps them; a reload drops
them), kept on the board and shown, until it is sent, only on the exact mock
file it was made on. The comments go to the agent with the next answer on
that card (a pick, an own answer or **Ask for another round**, which may then have no
note), each with its element, in `wait` and `answers` (`comments`); once
sent they are listed as sent and can no longer change. An option with no
mock, or whose file is gone, says "No mock for this option".

## Evidence update

`post --type evidence` posts the next numbered update (`update-1`,
`update-2`, ...) with 1 to 12 screenshots or recordings (`.png`, `.jpg`,
`.jpeg`, `.webp`, `.mp4`, `.webm`, up to 50 MB each), a short note and an
optional commit or PR link. The files are copied into `evidence/<number>/`
next to the board, so the board is the store: no hosted service. Each
still also gets a lighter copy, a thumbnail and a small tile beside it, which the page
shows and loads as they near the screen; the original stays as posted and
opens full size. The page
shows the updates newest first; each file is served only while its size and
SHA-256 still match what was posted, and recordings play inline on a phone.
The person gives a verdict, **Pass**, **Fail** or **Needs work**, with an
optional note, read back with `answers` or `wait --key update-<number>`.

## Explainer video

`post --type explainer` shows a question with a narrated video the agent made
itself (stills plus speech from a free local engine such as piper or
espeak-ng, joined with ffmpeg; the skill has the recipe). `--media` names
one `.mp4` or `.webm`, copied into `evidence/<number>/` and served
hash-checked like evidence media; it plays on the card with its own
controls, at phone width too. `--about` is a short summary and each
`--chapter m:ss=<title>` is a button that plays the video from there.
sign-off itself never makes the video: it calls no speech engine, no ffmpeg
and no network service.

## Diagram and interactive

`post --type diagram` and `post --type interactive` show a question with a
picture: `--view <path>` names one board-relative file, an image (`.svg`,
`.png`, `.jpg`, `.jpeg`, `.webp`) drawn at card width for a diagram, or one
self-contained `.html` page that runs in a sandboxed frame for interactive.
Every mock and view is served under a Content-Security-Policy with no
`fetch`, no remote files and no access to the dashboard or its tab. They
answer like a decision.

## Report page

`post --type report` posts an explainer page the user reads, with no answer:
something they asked to have explained, or a concept, design or trade-off
they must understand. `sign-off-axi report init <folder> --page` writes the older HTML page to
fill (the default `report init` writes a guided `report.json` the board draws itself: see the contract's report schema 3), one self-contained `.html` file, phone first, light and dark: the
answer in one plain sentence with a picture and an as-of line naming the
date the facts were true, then a diagram, then steps the reader taps
through, then the detail folded. Reports lists each one as a row of a
grouped list: its picture, title, what it says, kind and date, with a dot
when it was filed today. A tap opens the page under its title and what it
says, over the whole board on a phone and beside the sidebar on a desk, with
**‹ Reports** (or Escape) to go back. A report of
text only is refused with the command that makes the page; one stored before
reports had pages still loads, folded under **Notes**. Proof that something
works is evidence, and a merge or a status note is neither.

## Sign-in

`post --type signin` asks the person to sign in, for example with the link
`npm login` prints. The card sits on top of Waiting on you, because someone
waits on it now: the service, one big **Open** for the link (a new tab),
what it unlocks, who waits, and the time left until `--expires` (an ISO
date-time, or `90s`, `15m`, `2h`, `1d` from now), counting down on the open
page. When the time is past, the card leaves Waiting on you and Decide on
its own, as it has nothing left to open. Post again with the same `--key` and a new
`--link` or `--expires` to put a new link on the same card; it waits again,
also after it was done. The poster runs `signin done --key <key>` once it
sees the sign-in worked: the card leaves Waiting on you and shows as
**Signed in** under Answered; the open page picks that up within 20 seconds,
with no reload. For a card posted with a link, the board runs no check of
its own. The link must be `http(s)` with no user name or password in it, and
no output prints it, because it can hold a one-time code. When links expire
fast (an `npm login --auth-type=web` link lasts about 5 minutes), post
`--start '["npm", "login", "--auth-type=web"]'` in place of `--link` and
`--expires`: each tap on **Open** runs that command on the computer that
serves the board (as a list, with no shell, in the board file's folder),
opens a new tab at the first `https` link it prints on stdout (on stderr
only when stdout has none within 2 seconds, since tools such as npm print
other links there first), and keeps it running so the sign-in can finish; a
second tap while it runs opens the same link. Its exit 0 closes the card as
done by itself; a failure, or no link within 20 seconds, shows on the card in
plain words and **Open** tries again. It is stopped after 10 minutes, when
the card closes, or when the board stops. The page only learns that a tap
makes a new link, never the command, and the link is kept in memory only
while the command runs: never stored, printed or logged.

## Gate and finding

`post --kind gate --from <file>` holds a done-done run for the user: it
waits like an ask. `post --kind finding --from <file>` asks the user to
apply or skip a retro's proposed change: it waits like an ask. Both are
contract messages ([contract.md](contract.md)); `validate` checks them
without posting.

## The person can also

- See every ask on **Decide**, grouped **Sign in**, **Answer**, **Review**
  (plans and designs, looked over before they are answered) and **Later**.
  Each row names the answer it recommends, or its type when it recommends
  none (Yes/No, Pick one, Reply, Info, Design pick, Approval, Sign-in, Plan).
  Swipe a row right to answer with the recommended pick, or left to move it
  to **Later** (kept in this browser; the agent still waits). Decide reads
  newest first, a sign-in first. **More** (···) holds **Answer all
  recommended** and **Move all to later**. Every change shows a toast with
  **Undo**.
- Tap a row to open the ask: its picture or page, what it is and why, the
  proof it rests on, then its answers as cards. Nothing is picked until you
  pick: **Recommended** is only a tag, and the one button stays off
  (**Pick an answer**) until a pick, then names it (**Answer Friday**). The
  last card is **Your own answer**: it opens one box, and the button becomes
  **Send answer**, which sends the words as the answer. One **Note**, open
  under the cards, goes with any pick. **More** over the ask holds **Ask me
  later** and **Discard**. The button turns into a check and opens the next
  ask, or the list after the last; on a phone that ask's bar reads **Back**,
  which (as a swipe right does) returns to the ask just answered. An answered
  ask opens with its answer, its note and when, and **Change answer**: a new
  pick goes to the agent as an answer that `replaces` the earlier one, with
  **Undo**. Decide lists every answer under **Answered**, and the arrows in a
  phone ask's bar step through answered asks and open ones.
  **1**–**9** picks an option and answers it, **E** skips to the next ask,
  **Z** undoes the last answer, and a swipe right takes the recommended answer
  while a swipe left skips. A plan opens its own page instead, and a design
  review its screens.
- Tap **Ask for another round** under **More…** (with the typed note), which
  wakes a waiting agent the same way an answer does; the agent reads it back
  in `answers --json` under `rounds`, with any comments on mock elements it
  carried.
- Comment on any item without answering it (**Send without answering**, also under **More…**
  on a card in a list: every card but a sign-in has that one place to type) and queue a free-text
  prompt for the agent (**Ask the agent**). `poll` blocks until one arrives
  and prints every new one once (`--json` prints
  `{"messages":[{"id","kind","key"?,"text","at"}]}`); the page then shows it
  as read by the agent. Typed notes that are not sent yet stay in the
  browser across reloads; everything sent is saved next to the board and
  survives a restart.
- **Discard** (the × on an item in a list, **Discard** on a card's own screen or in an ask's **More**,
  or **Select** then **Discard N** in Decide and Designs) asks for one reason, one tap each:
  **Not relevant**, **Replaced by newer** or **Done elsewhere**. The items leave the board, Today
  included, and wait under **Archived** (one line at the end of the list, opening a sheet of them with
  their reasons and **Restore**); **Undo** in the toast brings them back for 10 seconds. Once those
  10 seconds are over the agent's `wait --filer` hands each discard over with its reason, and the card's
  badge and Activity show how far it got (Sent, Delivered, Read). **Select** and **Clear all** on Evidence,
  Reports and Answered dismiss without a reason, as before.
  `list` counts a dismissed item as neither
  waiting nor answered, as the board does (`list --full` says `dismissed`
  for an unanswered one and still its answer for an answered one), and
  `answers` does not count it as waiting; the agent is not told, so an ask it
  waits on keeps waiting, and `answers` still returns a dismissed answer.
  The storage is in [file-formats.md](file-formats.md).
  Reports leave the main view by themselves a day after they were filed (nothing is deleted): they wait under **Archived** at the end of Reports, and **Restore** brings one back for good. Evidence is never archived by age: every proof stays on Evidence, in one list, newest first, until it is dismissed. `sign-off-axi dismiss --filer <id>` hides every card of a finished task that still waits.

## Board, answers, and errors

- The board is the one you name right after the command
  (`sign-off-axi answers ./decisions.json`). With none, it is the nearest
  `.sign-off/` board that `init` set up, found by the walk described in the
  README under "Test runs never touch your board"; otherwise the default
  board (`~/.sign-off/decisions.json`, or under `SIGN_OFF_HOME`). Answers are
  saved next to it.
- Next-step commands in the output name paths under the working folder
  relative to it, and say `npx -y sign-off-axi` when sign-off-axi runs
  through `npx`.
- `list` and `answers` take `--full` for every field and `--json` for JSON
  (`answers --json` prints
  `{"<key>":{"answer","label","close","at"}}`, plus `"note"` when the user
  wrote one). `answers` adds a note column when any shown answer has a note.
- Raising a question that is already on the board is a no-op that reports its
  status, so an agent can re-run it safely. `--key` defaults to a slug of
  the title.
- Each raised or posted item records when it was filed (`filed`), so Waiting
  on you shows `waiting since 09:15` and the Waiting on you tile `Oldest 09:15`;
  `post --replace` keeps an item's first time.
- `open` is a no-op when the same board is already open on the same address,
  and fails with `CONFLICT` when it runs on another one. `--evidence-root`
  is the folder holding `.done-done/`, for decisions that link run evidence.
- `--filer <id>` on `post` and `raise` saves who filed the item (an agent
  session id or any 1-128 of `A-Z a-z 0-9 . _ -`; `SIGN_OFF_FILER` sets it
  for every command, and a post with neither saves `CLAUDE_CODE_SESSION_ID`
  when it is set). `wait --filer <id>` then returns only answers to that
  filer's items it has not taken yet (with `--key`, that key's answer even if
  taken), marks each taken (`decisions.seen.jsonl`) and the card shows
  **Seen by agent**; it fails with `NOT_FOUND` when none of that filer's
  items still needs an answer. The page never shows the filer id.
  `wait --filer --events` prints one JSON event line per answer and round
  ([contract.md](contract.md) section 7).
- `on_answer: <command> [args]` in the `config.yaml` beside the board runs
  that command for every saved answer, read when the board starts. It runs
  with no shell, in the board's folder, and gets the answer as one JSON line
  on stdin (`{"event":"answer","contract":1,"kind","schema","key","answer",
  "label","close","at","note"?,"replaces"?,"title"?,"filer"?,"comments"?}`,
  where `kind` and `schema` are the item's contract kind, or `ask` and 1 for
  a board-format item, `replaces`, present on a changed answer, names the
  answer it replaces, and `comments`, present when the answer carried comments
  on mock elements, lists each as `id`, `mock`, `hash`, `ref`, `tag`,
  `words` and `text`); the answer is never put into its arguments, so a
  typed note cannot inject a command. A failure is logged and never blocks
  the answer. With no shell, `|`, `>` and `&&` are passed as plain
  arguments, so put a pipeline in a script and name the script; a relative
  path such as `./hook.sh` is found from the board's folder. `doctor` checks
  that the command can run.
- `notify:` in the `config.yaml` beside the board sends a notice when a write
  (`post`, `raise`, `replace` or a sign-in link) leaves a card waiting on you
  that was not waiting before, or files a new evidence card. Each card is
  announced once: the card keeps the record, so a card that leaves Waiting and
  comes back (a new sign-in link, an undone answer) is not announced again.
  It takes indented `url:` (`https://`, or `http://` on this machine) and
  `link_base:` (the address people open the board at) lines, and an optional
  `token_env:` line naming the environment variable that holds a bearer token. Each notice is one JSON
  POST, `{"v":1,"source":"sign-off","id","kind","title","text","url","at"}`,
  where `kind` is `ask`, `plan`, `design`, `evidence` or `report`, and `url`
  is `link_base` with `#waiting/<key>` added. The sender runs detached, so
  the card is stored whether or not the notice arrives. A failed notice is
  retried a few times, then logged to `notify.log` beside the board. The
  token is read only from the named variable; when that variable is unset,
  nothing is sent and `doctor` says so.
  Notifications are off until this block is there. For the muxr receiver on
  the same machine, give `receiver: muxr` and a `link_base:` that is https or
  a tailnet address (a `.ts.net` name or a `100.x` address), so the link opens
  on the iPad; `url:` defaults to `http://127.0.0.1:8793/v1/notify`. The notice
  is then `{"title","body","url","id"}` (title cut to 80 characters), and the
  bearer token is read at send time from the file `<MUXR_HOME>/notify-token`
  (default `~/.muxr/notify-token`), never stored in the config or printed. A
  missing token file sends nothing and `doctor` and `notify` say so in plain
  words. `sign-off-axi notify` checks the setup and `notify test` sends one
  real notice.
- `post --from <file> --replace --filer <id>` lets several programs feed one
  board: it replaces only that filer's items (and items with no filer that
  the file names by key), keeps every other item, the board's other
  top-level fields and all answers, and an empty items list removes that
  filer's items. A contract message that changed is checked against its
  kind's rules again, so one that no longer matches is refused with the board
  left as it was; an answered contract key the feed dropped cannot come
  back, so post it under a new key (a design, diagram, interactive or
  explainer item that comes back keeps its answer).
- `wait` replaces a polling loop. With `--key` it returns at once if that
  decision is already answered, and waits for a key that is not raised yet;
  without it, it waits for the next answer to any decision that still needs
  an answer and fails with `NOT_FOUND` when nothing needs one. It wakes on
  each save, gives up after `--timeout` seconds (600, ten minutes, by
  default) with code `TIMEOUT` and exit 1, and takes `--full` and `--json`
  like `answers`. Ctrl-C stops it without changing anything.
- `open` records the board's pid, port and address next to the board file
  (`decisions.board.pid`). `status` and `stop` read it and only act on a pid
  that really serves that board, so no one has to guess a pid to kill.
  `open` on a board already served by `serve` records that server, so `stop`
  can close it too.
- The board runs on your own machine only: no hosted service, no recurring
  cost. It listens on `127.0.0.1` unless `--bind <address>` (or `bind:` in
  the `config.yaml` that `init` writes) names one private address of this
  machine, such as its VPN address, so a phone or tablet on your own network
  can open it. A `hosts:` line in that config names private DNS names that
  lead to the bind address, such as its mesh VPN name (commas between them),
  so the board also opens by name; `doctor` checks each one resolves to the
  bind address. All interfaces and public addresses are refused. Beyond
  `127.0.0.1` the board makes an access token once (`decisions.token`, mode
  600, next to the board), `open` prints it in the link, and every request
  without it is refused; the link sets a cookie, so the page and its media
  work after the first load. Delete the token file to shut old links out at
  once, then `stop` and `open` for a new one.
- `export` writes one self-contained HTML file (`decisions.export.html` by
  default): every item, answer, note and another-round request with its local
  mocks and media inlined; comments and queued prompts are left out. `--out`
  must end in `.html`, so a wrong path never overwrites the board. It opens
  from disk with no server, is read-only, and makes no network request. A
  mock page is inlined on its own, so the css and images beside it show only
  on the running board.
- Exit codes: `0` ok, including no-ops; `1` the request cannot be done (a key
  that already holds a different question, a busy port); `2` usage or input
  error (the message names the item, key and field). Errors print on stdout
  as `error:`, `code:` and `help:` lines.

Write your own questions using the [file-format reference](file-formats.md).
