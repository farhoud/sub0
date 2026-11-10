# subzero

subzero is a Claude Code plugin that hands subagent work to a pi agent running on
a model you choose, such as a local model or a cheaper hosted one. Claude keeps
the conversation and gets back only the child's final reply. The child's reading,
thinking and tool calls stay in a separate pi session.

It is built for the compound-engineering plugin. That plugin asks for subagents by
tier ("cheapest capable", "mid-tier", "session model"). When your project has a
matching tier in its agent file, subzero sends those subagents to your model
instead of Claude's. Tiers you do not configure stay on Claude.

## Preview and known limits

This is an experimental preview, version 0.1.0-preview.1. It makes no
compatibility promise, and what it does may change between previews. Know these
limits before you use it:

- **Plan mode is not respected.** The routing hook does not read the session's
  permission mode, so a generic subagent spawned in plan mode is still sent to the
  general agent, which can write files and run shell commands inside pi.
- **pi is the only child host.** There is no Codex or Claude child yet.
- **The general agent can write files and run shell commands inside pi, outside
  Claude Code's permission prompts.** Review what a routed subagent did with git.
- **The queue is per session.** The `parallel` limit of an endpoint counts only the
  children of one Claude Code session, so two sessions do not wait for each other.
- **A cloned project's agent file (.agents/subzero.yaml) is executable-grade
  configuration (it chooses models, tools and can enable a general agent with
  shell access); use routing only in repositories you trust.**
- If the subzero server fails to start, the session-start text still says routing
  is on, but the hook denies nothing and every subagent runs on Claude.
- Worktree-isolated and fork spawns always stay on Claude, because a subzero child
  works in the shared checkout.

The plugin's hooks run in every project where it is installed: one when a session
starts and one on every Agent call. Each costs a short Node process. In a project
with no agent file the hook does nothing: it prints no message, adds no routing
text and lets every subagent run on Claude.

## Prerequisites

- A current Claude Code, and `git` (Claude Code uses it to add the marketplace).
- Node 22 or later.
- pi, with a model you can reach. Install it with
  `npm install -g @earendil-works/pi-coding-agent` (see [pi.dev](https://pi.dev)),
  then set up a provider or a local endpoint and check that `pi --version` runs and
  `pi --list-models` shows your model. subzero installs nothing and does not edit
  your pi configuration.
- macOS or Linux. Windows is not supported in this preview.

If Node or pi is missing, `/subzero:init` and the plugin's hooks print one line
saying what to install.

## Install

In Claude Code, add the marketplace and install the plugin:

```text
/plugin marketplace add qoherent/sub0
/plugin install subzero@qoherent
```

The install command opens the plugin's details. Choose a scope, and run
`/reload-plugins` if Claude Code asks for it. The plugin is downloaded as a built
release; there is nothing to build or install in your project. Typing `/subzero:`
should now list `init` and `tasks`.

## Set up a model

Open Claude Code in the project where you want routing, then run the init command
with the model name that pi lists, as `provider/model`:

```text
/subzero:init <model>
```

For example `/subzero:init local/qwen`. Claude Code may ask you to allow the
command once. It writes `.agents/subzero.yaml` with a `default` tier on that model,
a `general` agent that can read, write and run commands, and a read-only `fallback`
agent. Optional arguments are `--timeout <seconds>` (default 1200) and
`--thinking <level>` (default medium). If pi is not installed, it says so and
writes nothing.

Compound-engineering asks for the tiers `small`, `medium` and `large`, and `init`
writes none of them. To route its mid-tier subagents, open `.agents/subzero.yaml`
and add a `medium` tier next to `default`, on the same host and model or another:

```yaml
models:
  tiers:
    default: { host: pi, model: local/qwen, thinking: medium }
    medium: { host: pi, model: local/qwen, thinking: medium }
```

Start a new Claude Code session in the project, so the session-start hook reads
the file. Add `small` or `large` the same way to route those tiers too.

## Confirm it works

Ask Claude to send a small task to subzero:

```text
Use subzero's delegate tool with tier "medium" to list the files in this folder
and reply with their names. Wait for the result.
```

Then run `/subzero:tasks`. The task shows as `general:medium`, with its status.
The reply came from your model, not from Claude.

To see routing without asking for it, install the compound-engineering plugin and
run one of its reviews, such as `/ce-code-review`, on a project with changes.
Its mid-tier subagents appear as subzero tasks in `/subzero:tasks`.

## Update

A release reaches you only when you update. Changes on the main branch never do.
Refresh the marketplace, then update the plugin, in a session:

```text
/plugin marketplace update qoherent
```

and in your shell:

```sh
claude plugin update subzero@qoherent
```

You can also open `/plugin`, choose the **Marketplaces** tab, select `qoherent`
and choose **Update marketplace**, which does both. Third-party marketplaces
do not update on their own unless you turn on auto-update there. A running session
keeps the version it loaded: run `/reload-plugins` or restart Claude Code to use
the new one.

## License

Apache-2.0, see [LICENSE](LICENSE). How the routing works is in
[docs/design.md](docs/design.md), section 5.4. Maintainers: see
[docs/releasing.md](docs/releasing.md).
