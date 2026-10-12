# Coding agents: `init --agent`, per-agent doctor lines, one journey on several agents

Covers `sign-off-axi init [dir] --agent auto|<name>[,<name>]`, the `agent:` line in `.sign-off/config.yaml`, the one `doctor` line per agent, and the same post + pick + answer-back journey driven by different coding agents. sign-off itself names no vendor, model or account and calls no model; each agent runs on its own login and a cheap model. Follow Isolation in `SKILL.md` first, and Setup in [skill.md](skill.md) for the tarball stand-in (`npm_config_prefix`) and session recording.

## Agent notes

Never add, change, copy or link an agent's login for this proof; an agent that is signed out or rate-limited is a recorded limitation, and you use another one.

| Agent | `--agent` | One-shot run (cheap model) | Login used | Home skills folder |
|---|---|---|---|---|
| OpenCode | `opencode` | `opencode run -m opencode-go/<model> "<ask>"` | Its own, in the host HOME | `$XDG_CONFIG_HOME/opencode/skills` (default `~/.config/...`) |
| Codex | `codex` | `codex exec --dangerously-bypass-approvals-and-sandbox -C <repo> "<ask>"` | Its own, in the host HOME | `~/.agents/skills` |
| Claude Code | `claude-code` | `claude -p "<ask>" --model <cheap> --dangerously-skip-permissions` | The lab credential only, linked into a throwaway HOME under the credential lock (fleet rules) | `$CLAUDE_CONFIG_DIR/skills` (default `~/.claude/skills`) |
| Pi | `pi` | `pi -p "<ask>" --model <cheap>` | Its own, in the host HOME | `~/.agents/skills` |
| Gemini CLI | `gemini-cli` | `gemini -y -p "<ask>" -m <cheap>` | Its own, in the host HOME | `~/.gemini/skills` |

With the host HOME, first check that no `sign-off-axi` skill sits in the agent's home skills folder (last column above), so the agent can only find the one `init` installed in the project. Put the project outside your home directory.

## Steps

| # | Step | Pass when |
|---|---|---|
| 1 | `init` with a PATH holding only node | `skills: no agent found on PATH (...)`, a help line naming `--agent`, config has `agent: auto`; `doctor` exits 0 with `agent,auto: no agent found on PATH` |
| 2 | `init --agent nope` | Exit 2, `unknown agent nope`, the valid names in `help:` |
| 3 | Fresh `git init` repo per agent: `sign-off-axi init --agent <name>` with the real PATH, then `doctor` | `skills[1]{agent,skill}: <name>,installed`; the skill is in that agent's project skills folder; doctor prints `<name> skill,installed` and exits 0; a second `init` says `already installed` |
| 4 | Delete the project skill folder, `doctor` | Exit 1; `help:` line `<name> skill: Run \`npx -y skills add umeranjum17/sign-off --skill sign-off-axi -y -a <name>\` in <dir>`; run it, `doctor` exits 0 |
| 5 | In each repo, record the agent one-shot with the ask `I need to pick a layout for the settings page. Show me options and wait for my pick, then tell me which one I picked and my note.` | The agent finds the skill by itself, builds 3 mocks under `.sign-off/mocks/<key>/`, posts `--type design` with `--tradeoff` and `--recommend`, runs `open` and blocks in `wait` |
| 6 | Open the printed URL (Drive in `SKILL.md`), shoot phone 390px and desktop in light and dark, then pick a mock that is not the recommended one with the note `Umer: <agent> picked this` | The agent's `wait` returns; its final message names that letter and the note; `answers --json` saved as `<agent>-answers.json` |
| 6b | On a config.yaml without an `agent:` line, `init --agent <name>` | config.yaml gains `agent: <name>`; doctor then checks that agent, not the ones on PATH |
| 7 | Repeat 3 to 6 on at least 3 agents, one of them OpenCode on a Go Muse model | Each agent's transcript, doctor output and answers JSON are in the evidence folder; stop each board and delete each scratch repo |
