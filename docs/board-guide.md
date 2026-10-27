# Board guide

[Quick start and overview](../README.md)

## The board

Five places, in the dock at the bottom of a phone and the sidebar on a desk: **Today**, **Decide**, **Evidence**, **Reports** and **Tickets**.

<table>
  <tr>
    <td align="center" width="25"><picture><source media="(prefers-color-scheme: dark)" srcset="media/phone-today-dark.webp"><img src="media/phone-today.webp" alt="Today: the next ask with its answer buttons, what waits, designs to review and what was cleared and proven"></picture><br><b>Today</b><br>What needs you, what was proven.</td>
    <td align="center" width="25"><picture><source media="(prefers-color-scheme: dark)" srcset="media/phone-decide-dark.webp"><img src="media/phone-decide.webp" alt="Decide: asks with their priority and ticket progress, and Taken without you with Change"></picture><br><b>Decide</b><br>Every ask that waits, one tap each.</td>
    <td align="center" width="25"><picture><source media="(prefers-color-scheme: dark)" srcset="media/phone-reader-dark.webp"><img src="media/phone-reader.webp" alt="A report in the reader: its answer first, and the one action bar with Agree, Disagree, Comment and Ask"></picture><br><b>Reader</b><br>One action bar on the part in view.</td>
    <td align="center" width="25"><picture><source media="(prefers-color-scheme: dark)" srcset="media/phone-evidence-dark.webp"><img src="media/phone-evidence.webp" alt="Evidence with Previews on: each proof with its first capture and the check's result"></picture><br><b>Evidence</b><br>Proof, with its first capture inline.</td>
  </tr>
</table>

<table>
  <tr>
    <td align="center" width="33"><picture><source media="(prefers-color-scheme: dark)" srcset="media/phone-tickets-dark.webp"><img src="media/phone-tickets.webp" alt="A ticket: its progress, the epic it is part of, its sub-tasks and a linked pull request"></picture><br><b>Tickets</b><br>Epics, tickets and tasks that roll up.</td>
    <td align="center" width="33"><picture><source media="(prefers-color-scheme: dark)" srcset="media/phone-designs-dark.webp"><img src="media/phone-designs.webp" alt="Designs: the design waiting for review, with a thumbnail of its first screen"></picture><br><b>Designs</b><br>Frames to review, one question each.</td>
    <td align="center" width="33"><picture><source media="(prefers-color-scheme: dark)" srcset="media/phone-install-dark.webp"><img src="media/phone-install.webp" alt="Today's More: the leash, Install app and the version the board runs"></picture><br><b>Install</b><br>An app on your home screen.</td>
  </tr>
</table>

Every card opens to its own screen with the same parts: one **action bar** (the answer, or Agree, Disagree, Comment and Ask on a report), one **Activity** (who posted it, each answer, note, comment and reply, and how far each got), and **Previous** and **Next** through the list you opened it from (swipe on a phone, `J` and `K` on a desk). The board names its own version (`--version`, the sidebar's foot, Today's More), and a reply links the new version of the work.

The board installs as an app (More, then Install app; on an iPad, Share, then Add to Home Screen) and, once opened, reads offline: with the board unreachable it shows the last update under "Offline, showing the last update", and sends fail rather than queue. A phone needs the board on HTTPS or localhost to install it.

On a phone, larger Decide lists open quickly and **Show more** brings in the next asks, Later items or answers. The counts always include the whole board.

### Evidence is not a decision

**Decide** holds only real asks: things an agent cannot do without your answer. **Evidence** holds proof (screenshots or a short recording of the running product) with the result of the check that made it: Passed, Not run, Failed, Did not finish or Could not check. Each row shows its first capture and the check's word; tap one and it opens in place with every capture in a strip, and **Previews** shows every row large. A proof update is never counted as something that needs you; you can give it a verdict (Pass, Fail or Needs work) or dismiss it. **Today** counts the two separately: what needs you, and what was proven today.

### You see how far each word got

What you send on a card (an answer, a note, a new round, a comment) shows its trail: **Sent**, **Delivered** (the agent's wait or hook got it), **Read** and **Replied**, with the agent's words and a link to the pull request or new version. It shows on the card, in its Activity, as a badge in the lists, and a reply waits in Today until you open it. An agent closes the loop with `sign-off-axi feedback <key> --reply "..." --link <url>`; `--read`, `--delivered` and `--acted --link` mark the other steps, and `--at <epoch seconds>` replays a step that happened earlier without turning a later real one back.

### Plans and reports, on their own pages

An agent writes a report as data and the board draws it: `sign-off-axi report init <folder> --purpose <kind>` writes `report.json`, and each section takes `blocks` to show a point rather than tell it.

| Block | What it draws |
| --- | --- |
| `callout` | a note, warning or question set apart |
| `beats` | a stepper of pictures, each with a time, title and words |
| `video` | a short film with its poster |
| `table` | the same measures for each option |
| `compare` | before and after |
| `evidence` | captures, each marked Fixed, In progress or Waiting on you |

Design output (screens a model made) goes in a `gallery` on the section: `report init --gallery`. Every picture and film is a file beside `report.json`, and post pins it. A page an agent writes itself (`report init --page`) is refused when it brings its own colours, three or more, or a card inside a card; reports already on the board stay as filed.

<table>
  <tr>
    <td align="center" width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="media/phone-plan-dark.webp"><img src="media/phone-plan.webp" alt="A plan page: the idea in one picture, then each section to approve or change"></picture><br><b>Plan</b><br>Approve or change each section, answer each decision, send it all back at once.</td>
    <td align="center" width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="media/phone-report-dark.webp"><img src="media/phone-report.webp" alt="A report page: the answer first, then a diagram to tap through"></picture><br><b>Report</b><br>An explainer page: the answer first, then a diagram and steps to tap through.</td>
    <td align="center" width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="media/phone-signin-dark.webp"><img src="media/phone-signin.webp" alt="A sign-in card: the service, what it unlocks, who waits and the time left"></picture><br><b>Sign-in</b><br>An agent needs you to log in: tap Open, then it carries on.</td>
  </tr>
</table>

A plan is what an agent wants to do before it starts. A report is an explanation you asked for. Both open over the board, and the board, not the agent's page, owns the answer buttons. A **sign-in card** goes to the top of Decide with the service, what it unlocks, who is waiting and when the link ends, in your own clock, counting the time left down under the hour. Tap **Open** and the link opens in a new tab; the card then reads **Opened — waiting for approval** until the agent closes it with `sign-off-axi signin done`, which is the only thing that does. Once the link's time passes the card stays where it waits and reads **Expired**: Open is off, what it unlocks and where still read beside their copy button, and **Ask for a new link** asks the agent for a fresh one, as does the same button before the old one dies. The request reaches the agent as a comment on that card.

### It keeps only what matters

A board that fills up with noise stops being read, so the rules sit at the door.

- A question must say why it is asked, what each answer does, which one the agent recommends and what happens if you stay quiet; one that does not is refused with the fix ([the question standard](contract.md#ask-schema-1)).
- One decision is one card: raising the same question again changes nothing, and `--merge <key>` folds an older card into the better-asked one.
- Proof posted as a Pass/Fail question is refused, and proof that is mostly text, a placeholder or a test card is refused too: proof goes to Evidence, as a capture of the real product; a report must be a page to tap, not a wall of words.
- **Discard** takes a card off the board with one tap on a reason (Not relevant, Replaced by newer or Done elsewhere): it moves to **Archived**, **Undo** brings it back for 10 seconds, and its agent is told why once those 10 seconds are over. **Select** in Decide and Designs discards several at once, and **Restore** under Archived brings one back (`sign-off-axi dismiss <key> --reason replaced` and `restore <key>` do the same from a shell; without `--reason`, `dismiss` hides a card and tells no one). `sign-off-axi dismiss --filer <id>` closes a finished task: every card that id still waits on leaves the board. Reports leave the main view a day after they were filed and wait under **Archived**; nothing is deleted, and Restore brings one back. Evidence stays on its screen for good, newest first, until dismissed. Posting an evidence message again under its key, from the same filer, replaces the card. A new ask that repeats an open ask on the same decision is refused, and answering one closes its twins.

### One ticket ties a task's cards together

A ticket is one piece of work, with a title and how far along it is, and optionally its priority, its project, its release, its state and its pull requests. Tickets nest as **epics > tickets > tasks**, and each is as far along as the average of what is under it (a roll-up from the tasks up). The **Tickets** tab shows your asks (and the system's own work) done, in progress, on hold and to do; a ticket's page shows its release, its state, each linked pull request and every card on it. Post any card with `--ticket <id>` (an ask, a design, proof, a report or a plan) and its screen shows a **Ticket** row (on an ask, **Its ask** in the panel under the question) with the ticket's title and progress; tap it for the ticket, which lists the tickets under it and every card on it, newest first, with their Activity. It is optional and only a link: a card without one, or naming a ticket the board has not got, works exactly as before. See [file-formats.md](file-formats.md#tickets) for the Activity feed and hold-release details.

```sh
sign-off-axi ticket --id E-1 --title "Settings, start to finish" --release 0.6.5
sign-off-axi ticket --id T-29 --title "Ship the new settings page" --parent E-1 --progress 40 --state "in progress" --pr https://github.com/owner/repo/pull/241
sign-off-axi post --type evidence --ticket T-29 --title "Settings on a phone" --about "Umer changes the theme in one tap." --media shot.png
```

Agents pass `--ticket` whenever they know the ticket their work belongs to, and move its `--progress` as the work goes; the shipped skill tells them so.

### How urgent, and whose project

A card may say how urgent it is with `--priority P0` (most urgent) to `P3` (least), on any `raise` or `post`; it shows as a chip, and a card without one shows none. A project may have its own icon: a picture in the board's folder (.png, .jpg, .webp or a script-free .svg, 500 KB or less), set once. The board serves only that exact file, and a project with no icon shows its initials.

```sh
sign-off-axi raise --priority P1 --title "Ship the new settings page this week?" ...
sign-off-axi project --name Beacon --icon icons/beacon.png
```

Agents pass `--priority` when they know it, and set their project's icon when it ships one; the shipped skill tells them so.

Every card's screen also keeps its **Activity**, oldest first, from what the board already saved: who posted it, your answer and note (and the one a change replaced), when the agent picked it up, a new round you asked for and your comments. A ticket's page shows its cards' activity together.

### The leash: what agents may do without you

Every ask says what happens if you stay quiet (`--default`) and when (`--silent-by`). Your leash decides whether it happens. Set it in Today's More, or tap the **Leash** chip by the count on Decide. It is saved as `leash:` in the `config.yaml` beside the board.

- **Ask me first** (`ask`): nothing happens; agents wait for you on every ask.
- **When it matters** (`matters`, the default): when an ask's `--silent-by` time passes with no answer, the open board takes its default as the answer. Its card says **Taken by default at 13:00**, and the waiting agent gets it at once. A default that fell due while the board was closed is taken when it starts. An ask with no `--silent-by` waits.
- **Act, then tell me** (`act`): the agent's recommended pick is taken the moment it raises the ask. Its card says **Agent picked B: Friday, tell me if wrong**.

Both kinds wait under **Taken without you** in Decide until you open them, each with a one-tap **Change** on a phone. You can still answer or change them. The change reaches the agent as an answer that replaces the taken one, and the card's trail and Activity say what happened: Taken or Picked, then Delivered and Read.

Some asks are never answered for you, whatever the leash: an ask raised with `--guard destructive|irreversible|money|credential|security`, and an ask whose words talk of spending money, deleting, what can't be undone, passwords and keys, or access. Designs, plans and sign-ins always wait too. Such an ask says **Always waits for you** and why.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="media/desk-decide-dark.webp"><img src="media/desk-decide.webp" alt="Decide on a desk: the Leash chip by the count, the asks that wait, Taken without you, and a money ask that always waits for you"></picture></p>

## What you can ask

One line on what the agent runs per kind; the full reference is [docs/question-kinds.md](question-kinds.md) and the message rules are in [docs/contract.md](contract.md).

| Kind | The agent runs | You see |
|---|---|---|
| Yes or no, pick one | `raise --ask-ref <captain-message-id-or-hold-id> --title ... --recommend ...` | buttons, the recommended one first |
| Design pick (mocks A/B/C) | `post --type design --mock a=... --mock b=... --link a=<url>` | mocks side by side, an Open live link under each option that has a `--link`, a note on any part, and Open full screen: the prototype over the whole screen with its own navigation, Phone or Desktop width and another option as a reference |
| Design review (one plain question) | `post --kind design --from design.json` | one question answered with **Yes** (a note optional) or **Change** (a note needed): each screen's frames side by side (Before and After, or Today, New and Target design), the changed area outlined and named on each and the frame Yes approves marked; post refuses an internal title and frames that look the same. Nothing in Decide: it waits under **Designs** for Main to review, and Main's `promote <key>` puts it in Decide |
| Proof update | `post --type evidence --media shot.png` | the capture, its result, Pass / Fail / Needs work |
| Proof with a file to install | `post --type evidence --media shot.png --attach app.apk` | the capture, and the file with its size and a Download button (any type, up to 1 GB, `SIGN_OFF_ATTACH_MAX_MB` to change) |
| Explainer video | `post --type explainer --media clip.mp4 --chapter 0:00=Start` | a player with chapter buttons, then Yes or No |
| Report | `report init <folder> --purpose <kind>` (always: research, plan, decision, audit, incident, status or other), fill `report.json`, then `post --kind report --from <folder>/report.json` | one scroll: the answer and a picture, what I understood, what I found, the next step; numbers under their part, one bar (Agree, Disagree, Comment, Ask) that acts on the part in view, and one Activity of every note, ask, reply and read |
| Design output report | `report init <folder> --purpose <kind> --gallery`, put the screenshots under the board's folder, fill the gallery (label, model, run time, a caption and device per frame), then `post --kind report` | a swipeable strip of options on a phone, a row on a desk: each option's phone and desktop frame side by side, the caption with the model and run time under each, a tap to open full size with Previous and Next |
| Report kit blocks | add `blocks` to a section of `report.json`: `callout`, `beats` (a stepper), `video`, `table`, `compare` (before and after), `evidence` rows, with files under the board's folder | the board draws each in its own type and colours, light and dark: full width, one gutter, no card inside a card; a gallery and a video may run wider than the reading column on a desk |
| Diagram, interactive page | `post --type diagram --view flow.svg` | the picture on the card; interactive pages run sandboxed, and open full screen at phone or desktop width |
| Plan | `report init <folder> --plan`, fill `plan.json`, then `post --kind plan --from plan.json` | the same scroll, plus each decision with my pick and a Go ahead |
| Sign-in link | `post --type signin --service npm --link <url> --unlocks ...` | an Open button and the time left |

## How agents use it

Every item records who filed it. The agent raises with `--filer my-agent`, then blocks on `sign-off-axi wait --filer my-agent`, which returns that filer's answers, each once, and the card shows **Seen by agent**. An agent that cannot block can be woken instead: an `on_answer:` line in the `config.yaml` beside the board names a command the board runs for every answer, and a `notify:` block can send an HTTP POST when a card enters Decide. The worked examples are in [docs/commands.md](commands.md).

For Go deeper on a guided plan or report, an idle **Claude Code** author can opt in to native session resumption: register its actual UUID with `owner --filer <id> --host claude --session <UUID> --cwd <absolute project folder>`, then run a separate `owner --dispatch --timeout 3600` process for the same board. `owner` shows queued delivery failures and distinguishes delivered from owner-read. No Firstmate is needed; other hosts are not supported for this wake path. See the [standalone owner recipe](commands.md#standalone-go-deeper-owner).

Each ordinary sign-off command calls no model; the opt-in dispatcher invokes the installed Claude Code with its normal credentials and optional registered model. The shipped skill is deliberately thin: it tells the agent how to write a good card and defers to `sign-off-axi --help` for every flag, so an installed copy never goes stale.

## Works alone, or with its siblings

sign-off stands alone: the CLI and the skill need no other tool and no supervisor. They connect through one small written contract ([docs/contract.md](contract.md)):

- **done-done** (verification) posts its proof as Evidence and holds a run for your Approve or Fix first as a gate.
- **learn-from-mistakes** (retros) posts each proposed change as a finding for you to Apply or Skip.
- **first-draft** (design) writes its review links into a design card, shown as real links to open the mock-up.
- **An agent supervisor**, such as Firstmate, or a lone agent in a terminal: both post the same asks, plans and reports and read the same answers.

## Docs and reference

- [Commands](commands.md): every command, the agent setup, exit codes.
- [Question kinds](question-kinds.md): the reference for each kind.
- [Contract](contract.md): the message rules agents post by.
- [File formats](file-formats.md): board and message files.
- [Vision](../VISION.md): who sign-off is for and where it is going.

## Development

Builds first, then runs the integration journeys against the real CLI:

```sh
npm test
npm run build:skill
npm run build:demo
npm pack
```

- `npm test`: full journeys
- `npm run build:skill`: writes the skill from `src/skill.ts`
- `npm run build:demo`: the website (`site/`) and the demo board at `/demo/`, built into `demo-dist/`
- `npm pack`: tarball

A release is a merged version-bump PR: CI publishes the new version to npm.

Change what a user sees or runs, and update this README, the skill (`src/skill.ts`), the website (`site/index.html`) and any screenshot they show in the same PR.

### Test runs never touch your board

With no board named, a bare command uses the nearest `.sign-off/` that
`init` set up, looking from the working folder up to its repo root (the
folder holding `.git`) or up to HOME, but never HOME's own `.sign-off/`.
Otherwise the default board is `~/.sign-off/decisions.json`, under
`SIGN_OFF_HOME` when it is set. A test or agent run that must not reach your
own board sets HOME and every `XDG_*` folder to one fresh temporary folder,
or sets `SIGN_OFF_HOME` to one. A board file named on the command line
always wins.

```sh
tmp=$(mktemp -d)
export SIGN_OFF_HOME="$tmp"
(cd "$tmp" &&
  sign-off-axi raise --ask-ref message-example \
  --title "Probe?")
```

Proof lives in [`.done-done.yaml`](../.done-done.yaml): the `install`, `test`
and `skill` journeys re-run every check the CI gate enforces, and CI calls
them through `done-done run`.

Write your own questions using the [file-format reference](file-formats.md).
