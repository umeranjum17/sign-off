# Commands: reference

Every command takes `--help`. Output is compact, with next-step hints.
The CLI is driven from a shell with no setup; sign-off itself calls no model
and inherits the calling agent's model routing.

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
| `report` | build an explainer page to post |
| `signin` | close a sign-in card as done |
| `doctor` | check the setup; each failure names its fix |
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
the board runs for every answer. A `notify: { url: https://..., token_env: ENV_NAME, link_base: https://... }` line optionally sends an HTTP POST when a new card enters Waiting on you; the bearer token is read only from the named environment variable. Detail is in
[question-kinds.md](question-kinds.md).
