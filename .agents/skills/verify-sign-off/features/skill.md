# Agent skill

Covers `skills/sign-off-axi/SKILL.md`, its generator `src/skill.ts` and `npm run build:skill`. The skill handles discovery plus one fixed recipe, the A/B/C design flow; a pass means an agent that has nothing but the skill installed finds and drives the CLI from a plain-language ask. Follow Isolation in `SKILL.md` first. Evidence and recordings stay outside the repo.

## Setup

- Push the branch, then install from it: `npx skills add umeranjum17/sign-off#<branch> --skill sign-off-axi -a <agent> -y` (add `-g` for a global install in a throwaway HOME). Run `npx skills add umeranjum17/sign-off#<branch> --list` too: it must list only `sign-off-axi`.
- Until `sign-off-axi` is on npm, stand in for the publish: `npm pack --pack-destination "$SCR"`, then `npm i -g` the tarball with `npm_config_prefix="$SCR/prefix"` and pass that same `npm_config_prefix` to the agent. The skill's own `npx -y sign-off-axi` then resolves to the tarball. Say so in the evidence.
- Put the agent's project outside your home directory (for example `/tmp/<task>-proj`): agents walk up from the project for `.agents/skills` and `.claude/skills` and would load the host's.
- Clean session: a throwaway HOME (`env -i HOME=...`). Claude Code needs a login: link only the lab credential (see the fleet rules) and run under the credential lock. If that credential is signed out, use the host `claude` with `--setting-sources project,local --strict-mcp-config`, a fresh project and a project-level install, and label the host's user skills as not clean. opencode runs with no login on a free `opencode/*` model.
- Record each session: `script -q --log-timing "$EVIDENCE/<name>.timing" "$EVIDENCE/<name>.log" -c <setup-and-agent script>` inside a detached `tmux` session; type the ask with `tmux send-keys -l`. Replay with `scriptreplay -t <name>.timing <name>.log`.

## Steps

| # | Step | Pass when |
|---|---|---|
| 1 | `npm run build:skill -- --check`; hand-edit `skills/sign-off-axi/SKILL.md` and run it again; `npm run build:skill` | Exit 0, then exit 1 naming the stale file, then the file is restored |
| 2 | Plain ask in a clean session: `ask me whether to keep the weekly digest and wait for my answer` | The agent loads the skill by itself, runs `npx -y sign-off-axi --help`, raises the question and runs `open` |
| 3 | Open the printed URL (Drive in `SKILL.md`), click Yes | The agent's own wait sees the answer and it reports Yes back in the session |
| 4 | Same session: `/sign-off-axi should we turn on the beta banner for everyone? wait for my answer`, click No | The slash form raises and opens, and the agent reports No |
| 4b | Design ask in a fresh session with only the skill installed, from the local checkout (`npx skills add <checkout> --skill sign-off-axi`), on a cheap model: `I need to pick a layout for the settings page. Show me options and wait for my pick.` | The agent builds 3 mocks under `.sign-off/mocks/<key>/` that differ in layout (not only colour), runs `init` when `.sign-off/` is missing, posts `--type design` with `--tradeoff` and `--recommend`, opens the board and waits |
| 4c | Open the URL at phone 390px and desktop, light and dark; shot each; click a mock button that is not the recommended one, with a note | The agent's wait returns, it reads the pick back with `answers --json` and reports that letter and the note; it then folds the winner in and deletes the other mocks. Save the session log and `answers --json` |
| 5 | The same ask inside a scratch Firstmate home (a `--no-hardlinks` clone of Firstmate with a scratch `FM_HOME`, never a live home) | Record what Firstmate does; its own contract decides whether the skill fires there |
| 6 | Stop each board the agent opened; delete the board folder it created (`~/.sign-off` when the agent ran with the host HOME) | Nothing is left listening on the port |
