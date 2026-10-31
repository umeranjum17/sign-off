---
name: sign-off-axi
description: "Ask the user yes/no, pick-one or A/B/C design questions on a local review board and read back their answers, using the sign-off-axi CLI. Use when you need a yes/no decision, a choice between a few options, a design pick between mocks, or approval from the user before going on, want the user to review or sign off on a plan or on proof of finished work (screenshots or a recording), need to read back the answers the user already gave, must explain a concept, design or trade-off to the user as an interactive report, want to track work as tickets the user can follow, or need the user to sign in to a service."
license: MIT
metadata:
  author: umeranjum17
  argument-hint: <the question to ask>
  hermes:
    tags:
      - decisions
      - approval
      - review
      - yes-no
      - multiple-choice
      - design
      - mocks
      - human-in-the-loop
      - cli
    category: productivity
---

# sign-off-axi

sign-off-axi puts your questions on one local page (127.0.0.1) where the user answers each with one click, and saves the answers for you to read back.
Every question is an item: post it, wait, read the answer back.
The board has five places: Today (what needs the user, what was proven today and your replies), Decide (every ask that waits, and Designs to review; Show more on a phone reveals the next rows without changing the counts), Evidence (proof, never an ask), Reports (explainers) and Tickets (the work, as epics, tickets and tasks).
Every card opens to its own screen with one action bar (the answer, or Agree, Disagree, Comment and Ask on a report), one Activity (who posted it, each answer, note, comment and reply, and how far each got) and Previous and Next through the list it was opened from. The board names its own version (`--version`, the sidebar's foot, Today's More), and it installs as an app: More, then Install app, on HTTPS or localhost.

With no board file named, a command uses the nearest `.sign-off/` board that `npx -y sign-off-axi init` set up in the project (looking up to the repo root), else `~/.sign-off/decisions.json`. Name a board file after the command only to use another one. Tests and scratch runs must never reach the user's own board: set `SIGN_OFF_HOME` to a temporary folder.
When you start a throwaway server with `open <board>` or foreground `serve <board>`, stop it before finishing with `npx -y sign-off-axi stop <board>` (the same board file). Do not shell-kill the printed PID or leave the server running for a timeout: stop checks that the recorded server serves that board and leaves other boards alone.

## Current guidance lives in the CLI

Do not trust this file for commands, flags or output - installed copies go stale. Get the current source of truth from the CLI:

- `npx -y sign-off-axi --help` for commands, the board and examples
- `npx -y sign-off-axi <command> --help` for one command's flags

You do not need sign-off-axi installed globally - invoke it with `npx -y sign-off-axi`.
If sign-off-axi output shows a follow-up command starting with `sign-off-axi`, run it as `npx -y sign-off-axi ...` instead.
Each ordinary sign-off command calls no model. The opt-in standalone owner dispatcher resumes the registered installed Claude Code session with its normal credentials and optional registered model. On a machine with an account pool it first asks that pool's shared model helper for the account with the most room, applies only that pick's named folders and dropped credential names, and moves a usage-limited request to the next pick; with no pool file it runs exactly as above.

## Get the answer back as an event

The answer comes to you; nobody has to notice it for you.

1. Pick one filer id for yourself: your agent session id, or any short name (1-128 of `A-Z a-z 0-9 . _ -`). With none given, a post saves the Claude Code session id when there is one. The card's Activity shows a short name as who posted it and picked up the answer; a bare session id reads Agent there.
2. Post every item with `--filer <id>`, or export `SIGN_OFF_FILER=<id>` once for every command.
3. Right after posting an ask, a plan or a guided report (an evidence post never waits), run `npx -y sign-off-axi wait --filer <id>` (same board file as the post). It returns every answer to your items you have not taken yet, even one given before you started waiting, and the board then shows it **Read** on that card. It also returns a **Go deeper** tap on your guided plan or report (answer it as the report section below says). Run it again after each reply and after a plan is sent back; guided pages keep listening even when nothing needs an answer. The person can change an answer later: it comes back as a new answer with `replaces` (the answer it replaces, which you may have acted on); act on the new one in its place. `TIMEOUT` means run it again, `NOT_FOUND` means none of your items wait or supports Go deeper. Only a filer-bound wait takes Go deeper; a board-wide answer wait leaves it queued. This needs a running listener: it does not wake a dormant agent session.
4. Once you act on an answer, a note, design change notes, a new round or a comment, tell the person: `npx -y sign-off-axi feedback <key> --reply "<what you did, one or two lines>" --link <the pull request or new version>` (or `--acted --link <url>` with no words). Whatever the person sends on a card (an answer, a note, a new round, a comment) shows its trail: **Sent**, **Delivered** (your wait or `on_answer` hook got it), **Read** and **Replied** with your words and the link; the reply waits in their Today. Read it but not acting yet: `feedback <key> --read`; handed over only: `--delivered`. `--at <epoch seconds>` records a step that happened earlier (a replay): a step the card already shows is left alone, so run it twice safely. Posting the card again marks what they sent as acted on.
5. For standalone Go deeper while your Claude Code session is idle, register its **actual** UUID when authoring: run `npx -y sign-off-axi owner <board> --filer <id> --host claude --session <actual UUID> --cwd <absolute project folder>` (optional `--model <model id>`). Use the host-provided session identity, never invent an id or register another session. If the host has not supplied your UUID, say registration is unavailable. A separate local process runs `npx -y sign-off-axi owner <board> --dispatch --timeout 3600`; restart it when it exits. Do not also consume that owner's requests with wait. Only a registered Claude Code session is woken; no Firstmate is needed, and an account pool, when this machine has one, only chooses the account or the pool's own fallover route. On wake, inspect the request and original document, acknowledge the exact id with `owner <board> --ack <id>`, then send one final `deeper <board> --id <id> --text "<answer>"` without --more. Retries preserve the request and never append to a completed answer. `owner <board>` shows queued failures separately from delivered and owner-read; never supply a substitute answer. Existing active listeners still support streamed pieces.
6. If you cannot block, the board owner can set `on_answer: <command>` in the `config.yaml` beside the board: it runs for each answer with the answer as JSON on its stdin, with no shell (so `|` and `>` do nothing; name a script instead), and `npx -y sign-off-axi doctor` checks it can run.

## Write each card for a 10-second read on a phone

The user often reads the board on a phone. Each card must make sense in 10 seconds to a person who does not write code.

- Title: the result or the question, in one short sentence: "You can now sign in with a passkey", "Ship the new sign-in this week?". Never a tool name, run id, version label, file path or error code.
- `--about`: what changed for the user, in 1 or 2 short sentences. Write in ASD-STE100 Simplified Technical English: short sentences, active voice, common words.
- Show the proof on the card: post a result to check as `--type evidence` with a screenshot or recording (`--media`); the user picks Pass, Fail or Needs work. Evidence rows show the first capture and the check's result (Passed, Failed, Not run) beside the title, and a tap opens the row in place with every capture in a swipeable strip: put the capture that proves the claim first, and write the title as the result. When a picture explains more than words, add a diagram or an interactive page (see below).
- Give the user a file to download from the card, such as an Android build to install: add `--attach <file>` (up to 5 files, any type, 1 GB each by default; `SIGN_OFF_ATTACH_MAX_MB` changes the limit). The user taps Download on the card, on a phone or tablet. The file is copied beside the board and streamed, never read into memory; the card needs a `--media` capture or only the file.
- Ask for one decision per card, and recommend the answer you would pick (see the question standard below).
- Put the pull request or page in `--link`. In a contract evidence message with a `run`, the `outcome` line heads the card: write it as the result the user can see.

## Link each card to its ticket

When the work belongs to a ticket and you know its id, pass `--ticket <id>` on every `raise` and `post` for it (any `--type` or `--kind`, or `"ticket"` in the message or `--from` item). The card then shows a Ticket row, the ticket's title and progress, that opens the ticket with every card on it.

- It is optional and only a reference: leave it out when you know no ticket, and never invent an id. A card whose ticket is not on the board shows no row, and works as before.
- A ticket stands alone: `npx -y sign-off-axi ticket --id <id> --title "<the work>" --progress <0-100>` makes it, and `--progress` again as the work moves. Tickets nest as epics > tickets > tasks: `--parent <id>` puts one under another, and one with others under it is as far along as their average, so move the progress of the ones with nothing under them. Add `--priority P0-P3` and `--project <name>` when you know them, `--hold yes` while the work waits (`--hold no` when it moves again), `--asked yes` when the user asked for the work, `--release <label>` for the release it ships in, `--state queued|"in progress"|"on hold"|done` to set where it is listed (it wins over progress and hold) and `--pr <url>` (repeat or comma-separate) for its pull requests: the ticket's page shows the release, the state and each linked PR, and `--pr` replaces the list, so send them all. An empty value clears a field. Write only your own tickets. `ticket --id <id>` shows a ticket and its cards; `ticket` lists them all.

## Say how urgent a card is, and give your project its icon

- When you know how urgent a card is, pass `--priority P0` (most urgent) to `P3` (least) on `raise` and `post` (any `--type` or `--kind`, or `"priority"` in the message or `--from` item). The card shows it as a chip, and the board can sort by it. Leave it out when you do not know: a card without one shows no chip.
- When your project has its own icon, put the picture in the board's folder and run `npx -y sign-off-axi project --name <project> --icon <path from the board's folder>` once (.png, .jpg, .webp or .svg with no script, 500 KB or less). The name is the project as your cards give it. A project with no icon shows its initials; never draw or invent an icon for it.

## Ask a good question

sign-off refuses a question that breaks these rules, naming the field and one fix; `raise --help` has the current flags.

- A new Decide question needs `--ask-ref <captain-message-id-or-hold-id>` (`ask_ref` in a message or feed): the captain message or real hold that needs this answer. Use the actual id, not a made-up reference. The CLI checks its shape, not its existence in another tool. Follow-ups belong in the backlog, not the board. Plans, reports, evidence, engagement records and already-posted cards keep working.
- One decision is one card. Before you post, run `npx -y sign-off-axi list --full` and look at the open cards. If the same decision is already there, do not ask it again: wait on that card, or, to ask it better, post one card with `--merge <its key>`: the old card must offer every option of the new one, and it is hidden and closed by the answer too. Never post a second card for one decision: an ask that repeats an open one (the same answers, titles that share at least 80% of their words) is not posted, and the refusal names the card to wait on. When one card is answered, every open ask on the same decision takes the answer too. A card is named by one ask until that ask is answered; a merged card merges nothing itself, and an answered or dismissed card is never merged.
- Title: one plain question of 12 words or fewer, ending in "?", that the buttons answer. No "Say yes or no:", "Captain hold:" or "Captain:" prefix, no task names or ids.
- `--why`: 1 or 2 short lines on what it is about and why it needs an answer now.
- The buttons are the choices in the text: Yes and No for a yes/no question; for a pick, one `--option` per choice, each label starting with its letter (A, B, C). Never A/B/C in the text with Yes/No buttons, and never Done or Not now buttons on a question.
- `--outcome <value>=<text>`: what happens next if that answer is picked, one line each, on every option.
- `--recommend` the answer you would pick, with `--recommend-reason` in one line.
- `--default`: what happens if the user stays quiet, and `--silent-by <ISO UTC time>` when. The user's leash decides what happens then: on When it matters (the default) the open board takes `--default` at `--silent-by`; on Act, then tell me your `raise` takes your `--recommend` at once and says `picked <value>`; on Ask me first nothing is taken. An answer taken this way reaches your `wait` with `taken: default` or `taken: agent`: go ahead with it, and keep waiting, because the user can still change it (the change comes with `replaces`). Never pick for the user yourself.
- `--guard destructive|irreversible|money|credential|security` on an ask that deletes or overwrites, can't be undone, spends money, touches a password or key, or changes who can get in: no default or pick is ever taken for it, whatever the leash. The board also guards an ask whose words say so, but name the guard whenever it applies.
- To ask again on a card the user already answered, run `npx -y sign-off-axi reopen <key>`: it waits again (Decide, or Designs for a design review) and the user's answer stays in its thread. Then post a changed question or round under the same key, or just `wait` for the user to answer once more. It refuses an open card, an unknown key and a card that is gone from the board. Never delete an answer to do this.
- A card you posted by mistake: `npx -y sign-off-axi dismiss <key>` hides it, `restore <key>` brings it back. When the user taps **Discard** on a card and picks a reason (Not relevant, Replaced by newer or Done elsewhere), it moves to **Archived**; **Undo** brings it back for 10 seconds, and then your `wait --filer` hands it over under `discarded` with the reason (an `--events` line `"event":"discarded"`): stop the work it asked for. `answers` lists it under `discarded` too. To discard one yourself with the same effect: `dismiss <key> --reason not-relevant|replaced|done-elsewhere`.
- When your task ends (merged, dropped, or answered some other way), run `npx -y sign-off-axi dismiss --filer <id>`: every card you posted that still waits leaves Decide. Reports leave the main view by themselves a day after they were filed; they wait under Archived on their screen and `restore <key>` brings one back. Evidence stays on the Evidence screen until dismissed, and posting it again under the same key with a changed proof replaces the card. Nothing is deleted.

A good yes/no question:

```
npx -y sign-off-axi raise --ask-ref <captain-message-id-or-hold-id> --title "Ship the new sign-in screen this week?" \
  --why "The screen is ready and the release goes out Friday." \
  --outcome yes="It ships to everyone on Friday." --outcome no="It waits for next week's release." \
  --recommend yes --recommend-reason "Every check passed on 3 phones." \
  --default no --silent-by 2026-10-19T16:00Z
```

A good A/B/C pick:

```
npx -y sign-off-axi raise --ask-ref <captain-message-id-or-hold-id> --title "Which day should the release ship?" \
  --why "Two fixes are still in review." \
  --option a="A: Today" --option b="B: Friday" --option c="C: Next week" \
  --outcome a="It ships now, without the 2 fixes." --outcome b="It ships with both fixes." --outcome c="It waits for the redesign too." \
  --recommend b --recommend-reason "Both fixes land by Thursday." --default b
```

## Evidence proves; a report explains; a plan asks for a go-ahead

- Evidence: proof that a thing works, screens or a clip of the real product (`--type evidence`). It lives in Evidence and is never an ask, so never post proof as a question; a text-only or placeholder picture is refused.
- Plan: what you mean to do, for the user to approve before you start (`post --kind plan --from plan.json`; `post --help` and the contract in the package docs give the shape). The user approves or changes each section, answers each decision and sends it all back once: wait for it like an ask and read it with `answers --json` (a note per section, a value per decision).
- Design review: `post --kind design` (schema 2) goes under Designs (on a phone, Decide's second list) for the person who triages designs to review, never straight to the user's Decide; that person's `promote <key>` puts the card in Decide. Never run `promote` yourself. A design card is one plain question the reader answers with Yes or Change:
  - The title is that question, in 12 words or fewer, such as "Approve this new phone end-of-list for Reports?". Never a task or branch name, a PR, a slice, an agent's message id or a file name, there or in `about`, a screen title or a caption: post refuses them.
  - One screen per state that changed (8 at most; not the same state at three widths), each with its own picture per frame: `today` (what ships now), `built` or `proposed` (the new look) and `target` (the approved design) only when it differs. Drop a frame that looks like another: post refuses two frames that are under 0.1% apart. Never one picture holding several columns: the board labels and lines up the frames itself.
  - On every frame, outline what changed with `area` (fractions of the picture) and say it in a one-line `caption`. Capture the state that shows the change: a fade or a moved line that does not show at rest needs the scrolled state.
  - `accepts` names the frame Yes approves. The triager's verdict goes in `reviewed`. `post --help` gives the shape, and the package's fixtures/contract/design.v2 has examples.
- Report: an in-depth explainer, only when the user asked for an explanation, or a concept, design or trade-off must be understood. A merge, a PR outcome, a receipt, a verdict or a status note is never a report.
- A report is fields the board draws as one scroll, never a text card and never a page you build. Run `npx -y sign-off-axi report init .sign-off/reports/<key> --purpose <kind>`, replace every `FILL:` line in `report.json`, then `npx -y sign-off-axi post --kind report --from .sign-off/reports/<key>/report.json --filer <id>`. Text you leave as `FILL:` is refused.
- Every report says what it is for in `purpose`, its kind, and `report init` and post refuse a report without it; a report posted before that is named once with `report kind <key> <kind> --by <your id>`. Pick the one that fits: `research` (research and discovery: a question, the options, sources), `plan` (implementation plan: how the work gets built, step by step), `decision` (decision and recommendation: one choice weighed), `audit` (what was checked against a standard, and what to fix), `incident` (incident and retro: what went wrong, why, what changes), `status` (where the work stands), or `other` when none fits. The board shows the kind on the report's row and head, with a line on what it is for, and the user filters Reports by it.
- Every report ends on its **Actions block**, and a report 5 without one is refused: `"actions": {"role": "<the role that does the work>", "owner": "<their name, or leave it out>", "first_pull_request": "YYYY-MM-DD", "recommended": "approve|refine|reject"}`. The board draws Approve, Refine and Reject from it with a plain result line each, naming the owner (or the role) and the day the first pull request lands. If the person **refines**, they send a note and you redo the report and post it again under the same key with `"version": 2` and `"changes": [{"kind":"added|rewritten|removed","text":"…","was":"…"}]` — the same report, never a new key — and the board shows version 2 with what changed. A **reject** closes it and records their reason as your rule; do not build it. **Approve** queues the build as a ticket.
- A plan is the same, with the questions the person decides: `report init .sign-off/plans/<key> --plan`, fill `plan.json`, `post --kind plan --from <file> --filer <id>`, then `wait --filer <id>`. The person can press **Go ahead** and accept every pick you recommended, so recommend what you would do and say in `quiet` what happens if they stay quiet.
- Write each part for the reader, in the order the board shows it: *What this is* (the answer and one picture: bars, steps or tiles, or the diagram a design, architecture or plan report needs), *What I understood* (the request in your words, so they can say it is off), *What I found*, *What I recommend* (plans), *What you decide* (plans, at most five questions, each with your pick and why), *Next step*.
  - Answer first: the heading of the picture is the answer, one plain sentence.
  - One picture per point; the numbers go in `details`, behind a tap, never in the sentence.
  - Short lines: `text` one line, `more` the part that opens in place, with a line break between points; never a paragraph the reader must scroll.
  - Plain words for a person who does not write code; no ids, no file paths, no tool names.
  - Name the date the facts were true if they will go stale.
- A research report (a comparison, an option study, a "should we use X?" question) must clear a higher bar than an explainer. A few options backed only by your own numbers is rejected.
  - Name the must-haves first. Survey the whole real field, then short-list against them. Say in one line why each option was cut.
  - Give every short-listed option the same axes and its full pros and cons, as one comparable table: one `found` item per option, pros and cons in `text`, and in `more` each axis on its own line as "Axis: value.", the same axes in the same order. The board then draws the section as one table; an older board shows the same lines as text.
  - Back each claim with outside proof and its link: GitHub issues (open bugs, regressions, upgrade breaks, how the maintainers answered), Reddit, Hacker News, X, forums and blogs. If a site blocks fetching, say what you could not read. Vendor marketing, star counts and your own team's work-log numbers are not proof.
  - Keep what you checked yourself apart from what others claim: a separate section, or each line starting "Checked:" or "Reported:".
  - End with one clear recommendation and a runner-up, each with its reasons.
- A plan clears the same research bar for every choice in it, then gives what a go-ahead needs: the options with their pros and cons, your recommendation, the scope (what is in and what is out), the steps in order, each risk with what you do about it, and how done is proven (`Done when` in `understood`, and where the proof lands in `next`).
- New guided defaults are plan schema 3 and report schema 5 (contract 1), with your required filer. Older schemas still load. On a plan every part, and on a report its one bar for the part in view, offers **Ask a question**, **Go deeper**, **Simplify this**, **Show an example**, **Why?**, plus free text and follow-ups. Ask a question focuses the section composer; text and Send are required. Other presets send immediately. Question/custom need nonblank text (at most 500 code points); free text and follow-ups use custom. Answer the exact action and question in its section: explain, give detail, use simpler words, give an example, or explain why. All use one engagement path: version 1 carries action, immutable owner, document revision and target, with an optional selection (authored field, code-point start/end, exact quote): when present, answer about those quoted words in their place in the document. Read these fields with `deeper --json --all`; answer the requested action from the original document, never rewrite text or change plan decisions. Active replies need `--filer <your id>`; registered sessions acknowledge the exact id first. Stale targets and other owners are refused. The answer expands in place and stays New across reload until visibly read. Keep the owner dispatcher/listener alive after reports and sent plans, and after every reply.
- The board shows who read each part and when, and the supported presets under every part. When the person taps one, `wait --filer <id>` returns the ask (including action, part and any question), or run `npx -y sign-off-axi deeper <board> --filer <id>` to list the open ones. Active listeners answer in plain words, a few lines at a time: `npx -y sign-off-axi deeper <board> --filer <id> --id <id> --text "<what you found>" --more` for each piece, then once without `--more` to finish. Registered dormant owners instead acknowledge and send one final answer as described above. The board streams each piece into the spot they tapped. A person's Agree, Disagree or Comment on a part reaches the same wait as an event with the part and the words; reply to it with the same `deeper --id <id> --text` and change the page if they are right. Never answer with a long essay: say less, they can ask a follow-up.
- Open the board at 390 px wide and look before you tell the person it is there: the first screen must give the answer and the picture.
- A report about design output (screens, mocks or options a model made) always carries a gallery, never a pasted picture: run `report init <folder> --purpose <kind> --gallery`, save each option's screenshots under the board file's folder (a phone frame 390 wide, a desktop frame 1280 wide, light copies not needed), and fill the gallery on the first section: per option its `label`, the `model` that made it and `ran` (UTC), and per frame its `device` (`phone` or `desktop`), `src` and a `caption` saying what it shows. Post refuses a frame with no caption or device. The board draws the options as a strip to swipe (a row on a desk) with both frames side by side and a tap to open full size.
- Show a report's parts with the board's own blocks, never your own HTML or CSS: add `blocks` to a section: `callout` (a note, warning or question set apart), `beats` (a stepper of pictures, each with a time, title and words), `video` (a film with its poster), `table`, `compare` (before and after) and `evidence` rows (a status of `fixed`, `progress` or `waiting`). Name the files next to the board file; post pins them. Post warns when your first paragraph repeats `about`: say something new there.
- Write a report with the board's kit (next chapter), never as a page of your own. A page is only for a demo the reader must tap that no block can show (see `report init <folder> --page --purpose <kind>`).

## Write a report with the board's kit

You hand the board words, files and rows; the board draws them in its own type and colours, light and dark, full width in one gutter. Never write HTML, CSS, a colour or a card for a report: a page of your own will not match the board, and a plan or report you want read has to look like the rest of it.

1. `npx -y sign-off-axi report init .sign-off/reports/<key> --purpose <kind>` (add `--gallery` for design output), then fill every `FILL:` line. A report with nothing in it to show needs no blocks.
2. Show a part with a block instead of a paragraph: add `blocks` (1 to 12, in the order given) to the section. Save each picture or film next to `report.json` and name it by path; post pins the files.
3. Post: `post --kind report --from .sign-off/reports/<key>/report.json --filer <id>`. Open the board at 390 px wide, light and dark, and look before you say it is there.

For a filed document whose exact words and order must stay, use `layout: "document"` on a guided report: omit `understood`, `visual` and `next`, and keep the original flow in its sections (up to 80). A section may have empty heading/body when its ordered blocks carry those words. A `text` block holds original markdown; optional `level` 1–6 makes it a heading. Local markdown links in text or table cells pin their named files and download them. Never add or rewrite an owner's words to fill a workflow. Keep its original visual content; a document still needs a picture, diagram or structured block. A beat may omit its image or description when the original sequence has none, and an image or video may omit a caption that was not authored.

Pick the block by what the reader must see:

| Block | Use it for | Fields |
| --- | --- | --- |
| `callout` | one thing set apart: a caveat, a warning, a question | `tone` (`note`, `warn` or `ask`), `title` (60), `text` (280) |
| `beats` | a sequence the reader steps through: a film's scenes, a flow | `beats`, 2 to 12, each `image`, `time`, `title` (80), `text` (280) |
| `video` | a short film | `src` (.mp4 or .webm, 50 MB), `poster`, `length`, `caption` |
| `image` | a neutral reference image, without a verdict | `src`, `caption` (280), optional `alt` (280) and `full` (the original full-resolution local image, opened by tapping); the whole image keeps its aspect ratio |
| `file` | a local file to download | `src` (any file up to 5 MB), `caption` (280), pinned like media; downloaded as an attachment |
| `table` | original measures, including irregular tables | `columns` (1 to 20), `rows` (up to 30); cells are text (120) or `{text, colspan, rowspan}`; keep empty cells and ragged rows as authored. Wide or irregular tables scroll inside the block on a phone |
| `compare` | before and after | `before` and `after`, each `image` and `caption` (80) |
| `evidence` | captures with a state for each | `rows`, each `image`, `title`, `note`, `status` (`fixed`, `progress` or `waiting`) |

- One idea per block, one block per point; a table beats three paragraphs of numbers, and a stepper beats a numbered list of screens.
- Say something new in each part. Post warns, and does not refuse, when a section's first paragraph repeats `about`.
- Options a model made are a gallery, not a row of pictures: see the design-output rule above. `gallery` and `blocks` can share a section, the gallery first.
- File paths stay inside the board folder, with no `..`, `?`, `#` or backslash. Posting pins their bytes; a changed file is unavailable until re-posted.
- Images are .png, .jpg, .jpeg or .webp; a path has no `..`, `?`, `#` or backslash.
- Sentence case in every heading and label; no capitals shouted, no colour words, no markup in any field.
- A page of your own (`report init --page`) is held to the board's look at its first post: post refuses one that writes out three or more colours of its own or draws a card inside a card, and says to use blocks. The scaffold already draws neither; keep to the system colours (Canvas, CanvasText, GrayText). A report already on the board stays as it was filed.

## Follow your report kind's workflow

Each kind of report has the parts strong teams write for that kind of document, in order. Give each part one section with `"part": "<id>"` (up to 10 sections); post refuses a report 5 with a part missing, repeated or not of its kind, and names the fix. `report init <folder> --purpose <kind>` writes every part for you to fill. The board draws the parts as the report's strip, filled as the person reads each one.

- **research** (research and discovery; after discovery briefs such as GOV.UK's discovery phase, https://www.gov.uk/service-manual/agile-delivery/how-the-discovery-phase-works, and Teresa Torres's opportunity solution trees, https://www.producttalk.org/opportunity-solution-trees/): `question` (the question, and why it matters now), `scope` (what is in and out), `method` (how you looked), `sources` (at least 3 items, each with its `link` and `"source": "primary"` or `"user"`, and at least one user report: an issue, a forum, Reddit, Hacker News or X), `options` (at least 2 items on the same axes, so the board draws one table), `findings` (each item with `"confidence": "high" | "medium" | "low"`), `not-checked` (what you did not check or could not read), `recommendation` (your pick and the runner-up), `open-questions`. The board counts the linked sources and user reports on the report's head.
- **plan** (implementation plan; after Google's design docs, https://www.industrialempathy.com/posts/design-docs-at-google/, the Rust RFC template, https://github.com/rust-lang/rfcs/blob/master/0000-template.md, and Shape Up's pitch, https://basecamp.com/shapeup/1.5-chapter-06): `goal` (the goal and the non-goals), `current` (how it works today), `design` (with a real diagram on the section, an item or the visual), `slices` (in order, each item with its `size`, such as "S, half a day"), `tests` (the test and the proof for each slice), `risks` (each risk and how you roll back), `rollout`, `estimate` (the time, as a range), `owner-calls` (what the user must decide). A plan the user answers section by section is still `post --kind plan`; a plan report is for reading.
- **decision** (decision and recommendation; after Michael Nygard's architecture decision records, https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions): `context` (the forces, said plainly), `options`, `recommendation`, `consequences` (what follows, good and bad).
- **audit** (after the elements of an audit finding, criteria, condition, cause and effect, in the Yellow Book, https://www.gao.gov/yellowbook): `scope`, `standard` (the rule checked against, with its link), `findings` (each: what is there, against the rule, why, and what it costs), `fixes` (most urgent first).
- **incident** (incident and retro; after the blameless postmortem in Google's SRE book, https://sre.google/sre-book/postmortem-culture/): `impact` (who, how much, how long), `timeline` (an item per event, with its time), `root-cause` (the system, never a person), `actions` (what changes so it does not happen again).
- **status**: `done`, `in-progress`, `blocked` (held up, and on what), `up-next`.
- **other**: no fixed parts; use it only when no kind fits.

## Draw a real diagram in every design, architecture or plan report

A plan, and a report that explains a design or an architecture, needs at least one real diagram: a drawing of the thing itself, as an architecture diagram (the parts and what talks to what) or a flow (the steps in order, with their arrows). Bars, tiles or a numbered list are not a diagram. Other reports add one only where structure, order or dependency is the point; when the point is a number, keep the bars or tiles.

- Draw it as inline `<svg>` in an `.html` page next to the plan or report file (by hand, or with the separately installed Archify skill: `npx skills add tt-a1i/archify -g`, then `ARCHIFY_UPDATE_CHECK_DISABLED=1 archify finalize --quality showcase`). Never a picture of a diagram, an `<img>` or a page that loads from the web.
- Add `"diagram": [{"label": "Flow", "src": "diagrams/flow.html"}]` (1 to 3 views, shown as tabs) to the `visual`, a section or an item; the rows beside it stay as the same answer in a list. Put the main one on the `visual`, so it is the first picture the reader sees.
- Make it read on a phone: a `viewBox` 320 to 340 wide, at most two columns, labels under about 16 characters, text 12 px or larger in the drawing, no legend. Wide sequence or compare drawings do not fit: draw the same flow down the page, and Today and After as two views.
- Make it read in light and dark: every colour a CSS variable, with a `@media (prefers-color-scheme: dark)` block that swaps them (ink on a light ground, light ink on a dark ground). The board tells the page its own light or dark and turns those rules on or off, so the drawing follows the board. Never draw with black or white fixed in place.
- Post refuses a diagram whose smallest text is under 12 px on a 390 px phone, one with brand marks (never set `brand`), or one with no `<svg>` drawing. Post pins each page (its `sha256` and `bytes`, written for you): a page changed after posting is not shown, so post the plan or report again after a change.
- On a report a tap on the picture opens it full size (alone on a phone); on a plan, a phone shows the drawing at the column's full width and **Full size**, and a desk **Show me** opens it in place. Open it at 390 px in light and in dark before you say it is posted.

## Ask the user to sign in

When your work needs the user to sign in (for example a login link from `npm login`), post one sign-in card. It goes to the top of what waits.

1. Post it: `npx -y sign-off-axi post --type signin --key <key> --service "<service>" --link <sign-in URL> --unlocks "<what it unlocks>" --waits "<who waits>" --expires 15m`. `--expires` is when the link stops working: an ISO date-time, or a time from now such as 15m. The card shows that end time in the user's own clock, counts the time left down while it is under an hour, and stops opening the link once it passes. Post only an http(s) link, never a password or a token.
2. When you see the sign-in worked, close the card: `npx -y sign-off-axi signin done --key <key>`. `wait --key <key>` returns once it is done. Until then the card reads Opened, waiting for approval: opening the link never closes it.
3. Get a new link before or after the old one dies and post again with the same `--key`: the card shows the new link and waits again. The user asks for one with **Ask for a new link** on the card, which reaches you as a comment on that card: `wait` or `poll` hands it over.
4. When links expire fast (an `npm login --auth-type=web` link lasts about 5 minutes), post `--start '["npm", "login", "--auth-type=web"]'` in place of `--link` and `--expires`: each tap on Open runs that command on the board's computer and opens the new link it prints. When the command ends with exit 0, the card closes by itself.

## Design decisions: show A/B/C mocks, not words

When the user must choose how something looks or works, do this:

1. State the design question in one line.
2. Build exactly 3 variants that differ in structure: layout, hierarchy or affordance. Variants that differ only in colour do not count.
3. Put them under `.sign-off/mocks/<key>/` in the project (run `npx -y sign-off-axi init` once if `.sign-off/` is missing): 3 files (`a.html`, `b.html`, `c.html`, or screenshots), or one `index.html` that shows the variant named by `?variant=a`, `b` or `c`.
4. Write a short trade-off in plain words (5 lines or fewer: what each variant does well and badly) and recommend one.
5. Post it on the project board with `npx -y sign-off-axi post .sign-off/decisions.json --type design --key <key>`, one `--option` and one `--mock` per variant, `--tradeoff` and `--recommend` (see `post --help`). Each mock is the running prototype page (links, buttons or script that move between its screens): it opens full screen from the card, and post refuses a page that is only a sheet of pictures. The card is listed under Designs as well as Decide, and a second card for the same pick is refused. Mock paths are relative to `.sign-off/`: `--mock a=mocks/<key>/a.html`, or `--mock a=mocks/<key>/index.html?variant=a` for the one-page form. When a TakeOne (or any) demo recording of a variant exists, add `--video a=<file>.mp4` (or `.webm`, 50 MB or less, a real recording that sign-off copies as it is and never converts) with its round score `--score a=<0 to 100>` (needs the `--video` and a `--mock` for that variant): the card plays it muted in place on a tap and opens it full screen with the score, and the Designs row shows its first frame. Each page mock carries an Open live link that opens that variant's own prototype in a new tab. When a variant borrows from a live site or design, add `--link a=<http or https URL>` for it (one per variant): the card shows it under that mock as a Reference link, labelled as the reference, never as the prototype. Then run `npx -y sign-off-axi open .sign-off/decisions.json` and give the user the URL.
6. Wait with `npx -y sign-off-axi wait .sign-off/decisions.json --key <key>`.
7. Read the answer with `npx -y sign-off-axi answers .sign-off/decisions.json --key <key> --json`. A pick holds `answer` and maybe a `note`, the comment the user sent with it; `"answer": "text"` is the user's own answer (Send as my own answer, or Send reply), in its `note`. A `rounds` entry with no `answer`, or newer than the `answer`'s `at`, means the user wants another round: read its note, build 3 new variants and post them under a new key. A `comments` list on the answer or the round holds the user's comments on parts of a mock: `mock` is the option, `ref`, `tag` and `words` name the element, `text` is the comment; apply them to that variant.
8. Build the winner into the real code, then delete `.sign-off/mocks/<key>/`.

Build mocks with a fast, cheap model: a mock is throwaway work. If first-draft is installed, it can build the mocks and write its `Open in first-draft: <label> <url>` links at the end of `--tradeoff`; the board shows them as real links.

## Show it when words are not enough

Use the simplest view that explains the item: plain text, then a diagram, then an interactive page, then a narrated video.

- Diagram: draw an SVG (or save a PNG) under `.sign-off/mocks/<key>/`, then post with `--type diagram --view mocks/<key>/flow.svg`.
- Interactive page: write one self-contained `.html` file (inline CSS and JS, no network) under `.sign-off/mocks/<key>/`, then post with `--type interactive --view mocks/<key>/demo.html`. It runs sandboxed: no fetch, no remote files, no access to the dashboard.
- Narrated video (an explainer): make it yourself with free local tools only, never a paid or online voice service:
  1. Write a short script in ASD-STE100 Simplified Technical English: 3 to 5 parts, 1 or 2 short sentences each, about 20 to 40 seconds in total.
  2. Make one still per part (a screenshot or a simple slide), all the same size, for example 1280x720 PNG.
  3. Turn each part into speech with a free local engine, for example piper (`pip install piper-tts`) or espeak-ng: `piper -m <voice>.onnx -f 1.wav < 1.txt`.
  4. Join each still with its speech, then join the parts: `ffmpeg -loop 1 -i 1.png -i 1.wav -c:v libx264 -tune stillimage -pix_fmt yuv420p -c:a aac -shortest 1.mp4`, then `ffmpeg -f concat -i parts.txt -c copy -movflags +faststart explainer.mp4` (`parts.txt` lists `file '1.mp4'` and so on).
  5. Post it with `--type explainer --media explainer.mp4 --about "<one-line summary>"` and one `--chapter <m:ss>=<title>` per part (`ffprobe -show_entries format=duration` gives each part's length). The video plays on the card; the chapters jump to each part.

All of these answer like a decision (Yes/No, or your own `--option`s with `--recommend`, the one you would pick); wait and read the answer the same way.

## Request

$ARGUMENTS

If the line above holds a question, the user invoked this skill by name with it - fetch the current CLI guidance, then ask that question.
If it is empty or only a placeholder, infer the question from the conversation.
