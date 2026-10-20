# Commands: reference

Every command takes `--help`. Output is compact, with next-step hints.
The CLI is driven from a shell with no setup. Ordinary commands call no model;
the opt-in `owner --dispatch` resumes an installed Claude Code author session.
Guided plan 3 / report 4 add **Simplify this**. Inspect version-1 action/target fields with `deeper --json --all`; active replies require the matching `--filer`, while registered owners acknowledge before answering. Keep listening after reports and sent plans. See [the engagement contract](contract.md#report-schema-4-and-plan-schema-3-engagement-v1).

| Command | In a few words |
|---|---|
| `list` | show what is waiting on you |
| `raise` | ask a yes/no or pick-one question |
| `post` | ask any kind, or post a contract message |
| `answers` | read the saved answers |
| `wait` | block until the user answers |
| `poll` | block until a comment or prompt arrives |
| `open` | start the board in the background |
| `status` | is this board's server running? |
| `stop` | stop this board's server |
| `serve` | run the board in the foreground |
| `export` | freeze the board as one HTML file |
| `init` | set up a repo and install agent skills |
| `report` | write a plan or report to fill and post |
| `deeper` | answer a Go deeper tap on a plan or report |
| `owner` | register a Claude author session, dispatch Go deeper or inspect delivery |
| `signin` | close a sign-in card as done |
| `dismiss` | hide a card, like its Dismiss button; `--filer <id>` hides every card of a finished task |
| `restore` | bring a dismissed card back |
| `doctor` | check the setup; each failure names its fix |
| `notify` | check device notifications, or send a test notice |
| `validate` | check messages against the contract |
| `help` | show the commands and flags |

```
$ sign-off-axi raise --title "Keep the weekly digest?" --why "Open rate held steady." --outcome yes="It keeps going out." --outcome no="It stops this week." --recommend yes --recommend-reason "Readers still open it." --default yes
board: ~/.sign-off/decisions.json
raised[1]{key,status,title}:
  keep-the-weekly-digest,raised,Keep the weekly digest?
help[2]:
  Run `sign-off-axi open` so the user can answer
  Run `sign-off-axi answers --key keep-the-weekly-digest` to read the answer
```

Exit codes: `0` ok, including no-ops; `1` the request cannot be done;
`2` usage or input error. Errors print on stdout as `error:`, `code:` and
`help:` lines.

## Agent setup

In a project folder, one command writes `.sign-off/` (config, board,
`mocks/` and `evidence/` folders) and installs the sign-off skill for each
coding agent on your `PATH`:

```sh
npx -y sign-off-axi init
```

It installs the skill for these agents, each under its own folder:

- Claude Code (`--agent claude-code`, found as `claude`): `.claude/skills/`
- Codex (`--agent codex`, found as `codex`): `.agents/skills/`
- OpenCode (`--agent opencode`, found as `opencode`): `.agents/skills/`
- Pi (`--agent pi`, found as `pi`): `.agents/skills/`
- Gemini CLI (`--agent gemini-cli`, found as `gemini`): `.agents/skills/`

The skill teaches the agent to ask through `npx -y sign-off-axi` and stays a
short stub pointing at `--help`, so it cannot go stale. `doctor` checks the
setup; `open` and `serve` use the config's `port:` unless `--port` is given.

Every item records who filed it, and that agent gets the answer as an event,
by itself:

```sh
sign-off-axi raise \
  --title "Keep the weekly digest?" \
  --filer my-agent
sign-off-axi wait \
  --filer my-agent
```

`wait --filer` returns only that filer's answers, each once, and the card
shows **Seen by agent**. An agent that cannot block can be woken instead:
an `on_answer:` line in the `config.yaml` beside the board names a command
the board runs for every answer. A `notify:` block in that config can send
an HTTP POST when a card enters Waiting on you; `receiver: muxr` there sends
it to the muxr host, and `sign-off-axi notify [check|test]` checks the setup
or sends a test notice. Detail is in
[question-kinds.md](question-kinds.md).

## Standalone Go deeper owner

Only Claude Code session resumption is supported. The author registers its **actual**
session UUID at authoring time; a filer alone is not a connected session. Use the
same explicit board file on every command:

```sh
sign-off-axi owner <board.json> --filer <author-id> --host claude \
  --session <actual-session-UUID> --cwd <absolute-project-folder>
sign-off-axi owner <board.json> --dispatch --filer <author-id> --timeout 3600
sign-off-axi owner <board.json>   # queued failures, delivered or owner-read by request id
```

`--model <model-id>` on registration optionally selects the model for resume.
The separate dispatcher polls for that many seconds (once without `--timeout`),
so start it before leaving the author idle and restart it after it exits. Do not
run an active `wait` consumer for that owner at the same time. It uses installed
`claude --resume <UUID> -p`, normal HOME/credentials, and argv without a shell.
There is no Firstmate dependency, callback script or substitute answering session.

The dispatcher records process handoff as `delivered`, not read. The resumed
owner inspects `deeper <board.json> --json --all` and the original document with
`list <board.json> --full`, then acknowledges the exact request using
`owner <board.json> --ack <request-id>`. Only this explicit acknowledgement marks
owner-read. The dispatcher supplies its registered identity to that child process.
Then it answers via `deeper <board.json> --id <request-id> --text "<explanation>"`.
This wake path sends **one final answer**, without `--more`: completed replies are
idempotent on retry. Ordinary active listeners can still stream pieces.

A failed launch or an owner that exits without answering remains queued with its
real failure in `owner` output. Fix the local registration or host availability,
then rerun the dispatcher; unfinished requests survive its restart. `--verbose`
retains the native host result on stderr for local proof. Delivery status is a CLI
surface in this slice, not a new board status control. A dispatcher killed while
holding `<board.json>.dispatch.lock` leaves that PID lock; remove that exact file
only after confirming the dispatcher and its child have stopped. Never reassign a
request silently or put executable routes in posted JSON.

The npm package includes `skills/sign-off-axi/SKILL.md` with the matching recipe.
An installed author can read that copy directly; `init` still uses its existing
GitHub skill installer (a follow-up, not changed here).
