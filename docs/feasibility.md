# Feasibility: integration points per host

Research date: **2026-10-30**. These CLIs change monthly. In the last few months `codex mcp-server`,
`codex --full-auto` and Codex `wire_api="chat"` were removed, pi gained MCP, and Claude `-p` changed
its default permission mode. Re-check before building, and pin host versions.
Items marked ⚠ could not be confirmed from primary docs.

## Verdict

**Feasible.** Every target host has (a) a way to receive a tool from subzero as a parent and (b) a
headless, streaming, model-selectable mode with skill restriction as a child. The hard parts are not
protocols. They are **isolating skills while keeping the user's real home** (login and session history;
codex is the hardest), **long-running tool calls on the parent side**, and **non-Anthropic models under
Claude Code** (works, but not officially supported).

**Checked on this machine (2026-10-30):** claude 2.1.285, codex-cli 0.161.0, pi 0.87.0.
- **claude:** `--bare` "skips … keychain reads", so subscription logins fail under it.
  `--disable-slash-commands` turns off all skills. `--session-id`, `--resume` and `--setting-sources`
  are present.
- **codex:** `exec --ignore-user-config` documents *"auth still uses CODEX_HOME"*.
  `resume`, `fork`, `archive` and `delete` exist at the top level.
- **pi:** `--no-skills`, `--skill`, `--session-dir`, `--session-id`, `--fork` and `--export` are present.

| | as **parent** | as **child** | skill isolation | non-default model | overall |
|---|---|---|---|---|---|
| **pi** | ✅ native TS extension (best); MCP since v0.99 | ✅ `--mode rpc` / `json`, SDK | ✅ `--no-skills --skill …` | ✅ any OpenAI-compatible endpoint (`models.json`) | Best fit; start here |
| **Codex** | ✅ MCP (`tool_timeout_sec` must be raised); plugins; hooks | ✅ `codex exec --json`, TS SDK; app-server (experimental) | 🟡 several skill roots: `CODEX_HOME`, `HOME`, repo, bundled | 🟡 Responses API only (Chat-only servers need a proxy) | Feasible, fiddly isolation |
| **Claude Code** | ✅ plugin + MCP; hooks; proxy skills | ✅ `-p --output-format stream-json`, Agent SDK | 🟡 `--disable-slash-commands` + inlined skills + `--add-dir` overlay (keeps subscription login; CLAUDE.md loading ⚠). `--bare` + `--plugin-dir` and SDK `skills:` work with an API key only. | 🟥 Anthropic models only, officially (gateways unsupported) | Feasible; Claude children = Claude models |
| **ACP agents** | n/a (ACP is a client→agent protocol) | ✅ JSON-RPC stdio, TS SDK 1.0 | ❌ no skill concept in ACP; needs provisioner per agent | ✅ standard `configOptions` (category `model`, `thought_level`) | Good generic transport, not a complete solution |

## Claude Code

### As parent
- **Plugins** bundle `skills/`, `agents/`, `commands/`, `hooks/hooks.json`, `.mcp.json`, LSP, `bin/`
  and output styles. The manifest at `.claude-plugin/plugin.json` is optional (only `name` is
  required). Load with `--plugin-dir` for development. Names may not start with `claude-` or
  `anthropic-`. https://code.claude.com/docs/en/plugins-reference
- **MCP** (https://code.claude.com/docs/en/mcp):
  - Transports: stdio and http.
  - `MCP_TOOL_TIMEOUT` defaults to about 28h. A per-server `timeout` is a hard wall-clock limit that
    progress notifications do not extend.
  - **Idle timeout** (`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`): 5 min for http and 30 min for stdio.
    Progress notifications reset it.
  - Output: a warning at 10k tokens and a cap at 25k (`MAX_MCP_OUTPUT_TOKENS`).
  - Calls that last more than 2 min are **auto-backgrounded** in interactive sessions, so the parent is
    not blocked. In `-p` mode, backgrounded results are lost.
- **Native overlap.** Skills with `context: fork`, `agent:`, `model:` and `effort:` run in a forked
  subagent. Subagent `skills:` preloads up to 32 skills. `disable-model-invocation: true` and
  `skillOverrides` hide skills from the main agent. https://code.claude.com/docs/en/skills ·
  https://code.claude.com/docs/en/sub-agents
- **Invoked skill content survives compaction** (5k tokens per skill, 25k total). This is direct
  evidence for the problem subzero targets.
- **Hooks**: 33 events, including `PreToolUse` (allow, deny, ask, or rewrite input), `SubagentStart`
  and `SubagentStop`. There is no event specific to skills. ⚠ The input schema of the `Skill` tool is
  undocumented. https://code.claude.com/docs/en/hooks

### As child
- Headless mode (https://code.claude.com/docs/en/cli-reference, https://code.claude.com/docs/en/headless):
  - Run: `claude -p --output-format stream-json [--input-format stream-json]`
  - Model and limits: `--model`, `--effort`, `--max-turns`, `--max-budget-usd`
  - Tools and prompt: `--tools`, `--allowedTools`, `--append-system-prompt-file`
  - Config: `--settings`, `--setting-sources`, `--plugin-dir`, `--add-dir`, `--mcp-config`,
    `--strict-mcp-config`
  - Sessions: `--session-id`, `--resume`, `--no-session-persistence`
  - Output and permissions: `--json-schema`, `--permission-mode`
  - Since v2.1.302, `-p` defaults to a mode that denies anything needing approval.
- **`--bare`** turns off discovery of skills, plugins, hooks, MCP, CLAUDE.md and memory. Explicit
  `--plugin-dir`, `--settings`, `--mcp-config` and `--add-dir` still apply. Two caveats:
  - It requires API-key auth (`ANTHROPIC_API_KEY` or `apiKeyHelper`), so OAuth and subscription logins
    don't work.
  - The model is not given the skill list, so name the skills in the appended system prompt.
  - Because of the first caveat, subzero does not use `--bare` (D18, design §6.1).
- `system/init` in stream-json lists `skills`, `plugins` and `mcp_servers`, which is enough to verify
  isolation. The `result` event carries `total_cost_usd` and `session_id`.
- Agent SDK: `skills: [...]` (unlisted skills are invisible), `settingSources: []`, `plugins`,
  `model`, `effort`. https://code.claude.com/docs/en/agent-sdk/skills
- ACP adapter: `@agentclientprotocol/claude-agent-acp`, which wraps the Agent SDK and passes options
  through `_meta.claudeCode.options`. ⚠ Whether it accepts skills or settingSources there.
- **Models:** "doesn't support routing Claude Code to non-Claude models through any gateway"
  (https://code.claude.com/docs/en/llm-gateway). LiteLLM or claude-code-router can technically do it,
  but you can't rely on that.

## Codex CLI

Docs moved from developers.openai.com/codex to learn.chatgpt.com/docs.

### As parent
- **MCP** (https://learn.chatgpt.com/docs/extend/mcp):
  - Servers are declared under `[mcp_servers.<name>]`, over stdio or streamable HTTP.
  - `startup_timeout_sec` defaults to 10 and **`tool_timeout_sec` defaults to 60**, so subzero must
    raise it or use the background + `await` pattern.
  - Output budget: `tools.<tool>.output_token_limit`.
- **Plugins** bundle skills, MCP servers and hooks, and are distributed through marketplaces
  (`codex plugin`). ⚠ The manifest filename. https://learn.chatgpt.com/docs/plugins
- **Hooks**: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest,
  SubagentStart and SubagentStop, Stop, and Pre/PostCompact. Outputs are Claude-style. Hooks must be
  trusted first. https://learn.chatgpt.com/docs/hooks
- **Skills** (https://learn.chatgpt.com/docs/build-skills):
  - Discovered in `.agents/skills` (from the cwd up to the repo root), `~/.agents/skills`,
    `/etc/codex/skills` and bundled skills.
  - The catalog budget is 2% of the context window.
  - Disable a skill with `[[skills.config]] path=… enabled=false`.
- **Native subagents** are generally available and on by default. They are TOML files in
  `.codex/agents/` with `model`, `model_reasoning_effort` and skill disabling. They **cannot** add
  skills or override provider, sandbox or MCP.
  https://learn.chatgpt.com/docs/agent-configuration/subagents

### As child
- **`codex exec`** is the supported path (https://learn.chatgpt.com/docs/non-interactive-mode).
  - Flags:
    - Model and config: `-m`, `-c model_reasoning_effort="high"`, `--ignore-user-config`
    - Sandbox and approval: `-s read-only|workspace-write|danger-full-access`, `--approve-for-me`
    - Output: `--json`, `-o`, `--output-schema`
    - Session: `--ephemeral`, `--skip-git-repo-check`
  - JSONL events: `thread.started`, `turn.*`, `item.*` and `error`.
  - Resume with `codex exec resume <id>`.
- **`codex mcp-server` was removed** in 0.154.0 (2026-09-09).
  https://github.com/openai/codex/releases/tag/rust-v0.154.0
- **App server** (JSON-RPC: threads, turns, `skills/list`, approval requests) is documented but marked
  **experimental and not for production**. https://learn.chatgpt.com/docs/app-server
- TS SDK `@openai/codex-sdk` wraps the CLI and exposes `startThread`, `runStreamed` and
  `resumeThread`.
- ACP: `@agentclientprotocol/codex-acp`, which replaces the archived zed-industries/codex-acp. It is
  built on the app server.
- **Models:** `model_providers.<id>` with `base_url`, but `wire_api = "responses"` is the only option.
  A local Qwen server must support `/v1/responses` or sit behind LiteLLM.
- **Isolation:** `CODEX_HOME=<tmp>` alone is not enough, because `~/.agents/skills` follows `HOME` and
  repo skills follow the cwd. Override `HOME` as well, and disable repo and bundled skills by config.
  ⚠ Whether `$CODEX_HOME/skills` is still scanned.

## pi

pi is now maintained by Earendil. The npm package is `@earendil-works/pi-coding-agent`, the repo is
github.com/earendil-works/pi and the site is pi.dev. 1.0 shipped on 2026-10-01.

### As parent
- **Extensions** are TypeScript, loaded without a build step. They are discovered from
  `~/.pi/agent/extensions/` and from a project's `.pi/extensions/` once the project is trusted, or
  passed with `-e <path>`.
- The extension API includes `registerTool`, `registerCommand`, `sendMessage`, `setModel` and
  `ctx.ui.*`. Its events include `tool_call` (can block or change a call), `tool_result`,
  `before_agent_start` (can set the system prompt) and `context` (can rewrite messages).
  https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md
- **MCP** is built in since v0.99.0 (2026-09-29) through "Codemode" with deferred loading. This
  reverses the earlier "no MCP" stance. The pi parent adapter should still be a native extension,
  because it gives UI, progress and in-process calls.
- **Prior art:** `examples/extensions/subagent/` already spawns `pi` subprocesses from markdown agent
  definitions, in single, parallel and chain modes. Read it before writing the pi adapter.

### As child
- Restrict context with `--no-skills --skill <path>` (repeatable; tested on pi 0.87, see
  [target-claude-pi.md](target-claude-pi.md) §3.1; a missing path is ignored silently),
  `-nc` (no context files), `-ne` (no extensions), `--no-session`, `--tools`.
- Set the model with `--model provider/id[:thinking]`. Thinking levels are
  `off|minimal|low|medium|high|xhigh|max`. Local endpoints go in `models.json`, which supports both
  `api: openai-completions` and `openai-responses`.
- **RPC mode** (`--mode rpc`) uses LF-delimited JSON with commands `prompt`, `steer`, `follow_up`,
  `abort`, `get_state`, `get_last_assistant_text`, `set_model` and others.
  - Don't use Node's `readline`, because it also splits on U+2028.
  - Treat `agent_settled` as the done signal, not `agent_end`.
  - https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md
- **SDK**: `createAgentSession({ model, thinkingLevel, resourceLoader, sessionManager: inMemory() })`.
  This allows an in-process child, so the parent and child could share a process when both are pi.
- ACP: community `pi-acp` (spawns rpc mode). It is an MVP and does not pass MCP servers through.

## ACP (Agent Client Protocol)

- JSON-RPC 2.0 over stdio (https://agentclientprotocol.com/protocol/overview).
  - Agent methods: `initialize`, `session/new` (takes `cwd`, `mcpServers`, `additionalDirectories`),
    `session/prompt`, `session/load`, `session/resume`, `session/close` and `session/cancel`.
  - Agents send `session/update` notifications.
  - Client methods: `session/request_permission`, `fs/*` and `terminal/*`.
- **Model and effort:** Session Config Options (stable) let the agent advertise options of category
  `model` and `thought_level`, and the client sets them with `session/set_config_option`. The values are
  specific to each agent.
- **System prompt:** RFD #1237 (merged 2026-10-12) adds `systemPrompt` to `session/new`. The schema is
  unstable and almost no agent implements it yet.
- **Skills: no mechanism, and none proposed.** Provisioning has to happen out-of-band: the cwd, a
  config home in the environment, flags in the spawn command, or `_meta`.
- SDKs: TypeScript `@agentclientprotocol/sdk` 1.0 (use the fluent `client()` API), Rust 1.0, and
  Python 0.x.
- Agents: Gemini CLI (`--acp`), OpenCode (`opencode acp`) and goose (`goose acp`) speak it natively.
  Claude, Codex and pi need adapters. The registry lists about 48 agents.

## What this means for the "ACP or CLI" question

| | Native CLI drivers | ACP driver |
|---|---|---|
| Skill isolation | Full control through host flags | Same: still needs a provisioner per host |
| Event fidelity | Full (cost, skill list in init, structured output) | Normalized; cost and init details often missing |
| Model and effort | Flags | Standard `configOptions`, values specific to each agent |
| Coverage | 3 hosts, 3 drivers | Long tail from one driver |
| Extra moving parts | None | An adapter process per host (claude-agent-acp, codex-acp, pi-acp), each with its own release cycle |
| Permission round-trip | Weak (headless means policy only) | Good (`session/request_permission`) |

**Recommendation:** use ACP's *semantics* as the core's internal `ChildPort` model (session, prompt,
update, permission, cancel). Ship **native drivers** for pi, Codex and Claude first, because that is
where skill isolation can be enforced, plus **one generic ACP driver** for the long tail with
best-effort isolation. Recorded as D5 in [decisions.md](decisions.md).
