# Open decisions and pitfalls

Each decision has a **recommendation** so work can start. Change the recommendation if you disagree, but
make each choice explicitly.

## Decisions

| # | Decision | Options | Recommendation | Why |
|---|---|---|---|---|
| D1 | **What problem is primary?** | (a) context hygiene; (b) heterogeneous models and hosts; (c) one portable config | (b) + (c), with (a) as the shared benefit | Native `context: fork` (Claude) and Codex subagents already give (a) within a single host. subzero's real reason to exist is cross-host and cross-model use. |
| D2 | Implementation language | TS / Rust / Go / Python | **TypeScript** | The pi extension, ACP SDK 1.0, Claude Agent SDK, Codex SDK and MCP SDK are all native TS. A pi parent can import the core in-process. |
| D3 | Where the core runs | (a) per parent session (inside MCP server / extension); (b) shared local daemon; (c) remote | **(a)** in v1, with state mirrored to the task store `.agents/subzero/tasks/` (design §3.6) | No daemon lifecycle to manage. Live processes die with the parent, which matches "clean up after the task". The task store keeps auditing, `subzero logs` and later `continue` possible. |
| D4 | Parent tool shape | one `delegate` tool with an agent enum / **one tool per agent** | One generic tool + a catalog in its description; optional per-agent tools later | Per-agent tools route better but cost context per agent, which is the problem we're solving. Claude's tool search softens this, but not on every host. |
| D5 | Child transport | native CLI / ACP / both | **Both, behind one ChildPort.** Native drivers first (pi → codex → claude), generic ACP driver next | ACP has no skills concept, so provisioning is per host either way. ACP gives the long tail cheaply. See [feasibility.md](feasibility.md#what-this-means-for-the-acp-or-cli-question). |
| D6 | How skills reach the child | (a) host-native discovery from an isolated dir; (b) inline the skill bodies into the system prompt; (c) both | **(a)**; add (b) only where the host can't load skills from an overlay dir without losing the user's login (Claude: `--disable-slash-commands` turns off all skills, so the declared ones are inlined and `--add-dir` keeps their files readable; design §6.1) | (a) keeps `scripts/` and `references/` with their relative paths working. A single-purpose child can safely be told "you have skills X, Y; use them". |
| D7 | Process vs session lifetime | throw everything away / keep the process alive / **end the process, keep the session** | `process: exit` + `record: keep` by default; `process: keep` (ttl) for chatty follow-ups; `record: none` for sensitive work | The *context* is what must be cleaned, and it dies with the process. The *session record* is what makes runs inspectable, rerunnable and resumable (design §6.3). |
| D8 | Workspace and write policy | two settings: `workspace` (where: shared cwd / git worktree) and `permissions` (what: read-only / workspace-write / full) | **`workspace: shared` + `permissions: read-only` by default**; `workspace-write` on the shared cwd as an opt-in; `workspace: worktree` for parallel writers. subzero enforces nothing beyond the host's own sandbox or tool list. No snapshots or copies of workspace files: git is the record, subzero records no changed files, and the user reviews and reverts with git (the README warns) | Two agents writing the same tree at the same time is the most common way this goes wrong (P6). |
| D9 | Permissions in a headless child | (a) static policy only; (b) forward to parent / user; (c) auto-approve | **(a)** in v1: the YAML `permissions` maps to the host sandbox. Anything outside it gives `InputRequested` → result `needs_input` (kind `permission`) | Parents can't reliably show a dialog from inside a tool call (Claude elicitation works only in interactive sessions; Codex has none). pi and ACP can do (b) later. |
| D10 | Model reference format | free string / `provider/model` + named endpoints | `provider/model` + an `endpoints:` block (named endpoints defined once and reused, each holding its `parallel` limit and, in v0.1, its `base_url`, `api` and `api_key`); validate host × provider when the config is resolved | `qwen-23` alone is ambiguous: which server, which API format? Codex needs the Responses API and Claude needs the Anthropic API. |
| D11 | Reasoning scale | per-host values / one normalized enum | Normalized enum `off…max`, mapped per host, with the value actually applied reported back | Users write it once; any loss in the mapping is visible instead of silent. |
| D12 | Compile to native when possible? | always spawn / compile (e.g. Claude parent + Claude child → a `context: fork` skill) | Not in v1, with one exception: `host: native` agents (a parent-host subagent that reaches its `delegates:` through subzero) are hand-written in the spike and generated in v0.1 | It is cheaper and faster when it applies, but it is a second code path. Keep it in mind so subzero doesn't fight native features. The sigil spike shows the two combine: a native Claude subagent keeps the main conversation clean, and subzero gives it the sub-agents Claude can't nest. |
| D13 | Skill sources | local only / + git / + npm / + registry | Local + git (pinned in `subzero.lock`) | It matches compose's `build:` and image usage. A registry is out of scope. |
| D14 | Recursion | allow children to use subzero / forbid | Allow, but only to the agents listed in the child's `delegates:`, with `maxDepth: 2` passed down via env (`SUBZERO_DEPTH`). Nested children share the parent's parallel limit; a waiting run lends its place under that limit to its child. | Real skills need it once they are delegated whole: sigil-evaluate on pi would start its own interpreter children, and sigil-write starts a fresh evaluator. The spike avoids it by running sigil-evaluate as a native Claude subagent (target-claude-pi.md §6.1); it lands in v0.1. The allow-list and depth limit stop fork bombs and cycles; lending a place under the parallel limit stops a depth-2 deadlock on a single local GPU. |
| D15 | Trigger mechanism | explicit tool / proxy skill / host interception hooks | Explicit tool + **proxy skills** (work on all hosts); hooks are optional extras | Interception depends on undocumented schemas (Claude `Skill` tool input). A proxy `SKILL.md` is portable and cheap. |
| D16 | Result contract | free text / text + structured / full transcript | Bounded summary (default 2k tokens) + optional JSON (via `--json-schema`, `--output-schema`, or validated by the core for pi) + `runId`. No changed-file list: the user reviews the tree with git | The transcript stays in the run log. Returning it would recreate the problem. |
| D17 | Where agent definitions come from | workspace `.agents/subzero.yaml` only / skill manifest only / **both, layered** | **Both.** A skill ships a recommended `agents/subzero.yaml`; the workspace and user config override it or turn it off. Skill manifests use model tiers, can't grant permissions and can't add skill sources. | Skill authors know how their skill should run, and the workspace owns endpoints, permissions and trust. This is the same split as a Dockerfile (author) and a compose file (operator). See design §4.1. |
| D18 | Isolation boundary | (a) throwaway config home per run; (b) **real home + launch flags + skill overlay**; (c) persistent per-agent home | **(b)**; (c) only as a fallback for a host whose flags can't isolate skills; never (a) | (b) keeps the user's login (no API keys needed), keeps sessions where the host's own resume/fork tools find them, and never copies credentials. pi can do (b) today (tested); claude has the flags but CLAUDE.md loading is unverified; codex needs a spike for *adding* overlay skills. |
| D19 | Identity the parent holds | run id (one process) / child session id / **task id 1:1 with a child session** | **Task id** (`sz-xxxxxx`), also used as the child's session id where the host accepts one (pi); claude (UUID only) and codex (assigns its own) are mapped in the task index. Runs (processes) and turns sit under it. A new session always means a new task with lineage. | The parent needs one handle that survives the child exiting, respawning, compaction and `/clear`. A 1:1 task–session mapping keeps "continue X" unambiguous. Fork and rerun stay traceable. |
| D20 | How the parent learns what a child did | return the transcript / a summarized transcript / **result + report + ask** | Result per turn (bounded); `tasks(detail: report)` built from events with **no LLM**; `ask` answers from a **read-only probe fork** of the child session | The child already holds the context, so asking it is the best and cheapest way to analyse its work. Forking keeps the main session clean. The parent only ever pays for the answer. |

## Pitfalls and risks

### Product
- **P1. Overlap with native features.** Claude Code `context: fork` skills and Codex subagents cover
  same-host delegation. If the pitch is "clean context", users will ask why not use the native feature.
  Lead with cross-host, cross-model, and one config.
- **P2. Delegation overhead.** Each run pays for process start-up, a cold prompt cache, a fresh system
  prompt and skill loading: seconds of time and thousands of tokens. For small tasks, delegating costs
  more than loading the skill. Guide this through agent descriptions, and measure it.
- **P3. Context starvation.** The child knows nothing the parent knew. Thin briefs give confident but
  wrong results. Mitigate with tool description guidance, a `Brief` with `files` and `expectedOutput`
  fields, and letting the child return `questions` instead of guessing.
- **P4. The result pollutes the parent anyway.** Unbounded results defeat the purpose. The core
  enforces the budget, not the child.
- **P5. Trusting the child's result.** The parent can't see the child's work. Return the task id, so the
  parent can `ask` about the work or read its report, and the user can `subzero show` or `attach` it.
  subzero does not return a changed-file list: git is the record, and the README warns the user to review
  the tree with git (decision made while writing the spike contracts, below).

### Technical
- **P6. Concurrent writes.** Parent and child, or two children, editing the same files at once. Use the
  default read-only mode (D8) or worktrees for parallel writers.
- **P6b. "Read-only" is rarely true.** Skills write caches, run directories and answer files (sigil's
  compute skill writes a claims store and starts interpreter children that each write one file).
  Declaring them read-only breaks them. Give them the tools they need, and rely on git, which is the
  record of what changed.
- **P7. Parent tool timeouts.**
  - Codex: `tool_timeout_sec` defaults to 60s.
  - Claude: idle timeout of 5 min (http) or 30 min (stdio). Calls are auto-backgrounded after 2 min,
    and backgrounded results are lost under `-p`.
  - Send progress notifications always, and support `background` + `await`.
- **P8. Shared login means shared quota.** Children run under the user's own login (D18), so no API
  keys are needed. But they draw on the same subscription limits as the parent: five parallel children
  can use up the plan and stall the parent too. Set concurrency limits per host account.
  - Never copy auth files. OAuth refresh tokens rotate, so a copy that refreshes can log out the original.
  - Don't use Claude `--bare` for children: it skips keychain reads, so subscription logins fail.
- **P9. Skill leakage.** Hosts discover skills from many roots: user home, repo `.agents/skills`,
  `.claude/skills`, bundled system skills, plugins, and AGENTS.md / CLAUDE.md context files. Isolation
  must be **checked at start-up** (§6.2 of the design) rather than assumed.
- **P10. Skill portability.** Skills written for one host refer to its tools ("use the Task tool",
  `allowed-tools`, `$skill` syntax). A skill bound to a pi + Qwen agent may not work there.
  `subzero validate` should lint for host-specific references, and agents should be tested per host.
- **P11. Model and host mismatch.** Claude children are Anthropic models only (gateways to other models
  are unsupported). Codex needs Responses-API servers. pi is the flexible host for local and other
  models. Reject invalid combinations when resolving the config.
- **P12. Small models and agent loops.** Local models (e.g. Qwen) handle long tool-use loops and large
  skill instructions less reliably. Pair them with narrow skills, tool allow-lists and `maxTurns`.
- **P13. Host CLI churn.** Within months, `codex mcp-server`, `--full-auto` and Codex `wire_api=chat`
  were removed, pi gained MCP, and the Claude `-p` default permission mode changed.
  - Pin host versions in `subzero.lock`.
  - Probe capabilities at start (`--version`, init events).
  - Keep **contract tests with recorded event fixtures** for each driver.
- **P14. Headless permission dead-ends.** A child that hits an approval prompt either hangs or is
  denied silently. Every driver must run with an explicit permission mode. Detect denials and report
  `needs_input` (kind `permission`); never hang.
- **P15. Process hygiene.**
  - Kill the child's whole process group on cancel or timeout. Children start MCP servers and shells.
  - Clean up skill overlays on crash, using a start-up sweep of stale `.agents/subzero/tasks/*/skills`.
  - Cap parallel children per model endpoint with an optional `parallel` limit in `endpoints:`. It counts
    only one process's children, so a terminal run or a second window is not counted. A single local GPU
    serializes requests anyway.

- **P19. The parent bypasses subzero.** A skill managed by subzero that also sits in the parent's
  own skill directories gets loaded directly into the parent context. Keep managed skills outside host
  discovery paths, or turn them off in the parent (design §4.1).
- **P20. Agent name collisions.** Two skill manifests that declare the same agent name, or a manifest
  that collides with a workspace agent, must fail loudly. Silently letting the last one win would
  change behaviour whenever a skill is updated.

- **P21. Resuming outside subzero breaks isolation.** A plain `claude --resume <id>` or `codex resume`
  on a child session loads the user's full skill set into it. Always go through `subzero continue` or
  `subzero attach`, which reuse the task's recorded launch spec.
- **P22. Child sessions clutter the user's history.** Claude and codex children land in the user's
  normal `/resume` picker. Name them `subzero:<agent>:<task-id>`, archive them when the task is archived (`codex
  archive`), and give pi its own `--session-dir`.

### Security
- **P16. Config is code.** `.agents/subzero.yaml` in a cloned repo can start agents with write permissions and
  pull git skills. Require trust per repo and config hash, as pi and Codex do for project config.
- **P17. Skill supply chain.** Git skills carry scripts that the child executes. Pin to commit SHAs,
  show a diff when the lock changes, and never auto-update.
- **P18. Secret leakage through run logs and kept sessions.** Run logs *and* host transcripts record
  tool outputs, which may contain secrets from `.env` files and similar. Store logs under `.agents/subzero/tasks/`
  (gitignored by default) and support redaction. `retention`/`prune` must also delete the host-side
  sessions, not only subzero's run records.

## Missing from the original sketch

1. `description` per agent. Without it the parent cannot route. It is the single most important field.
2. The result contract and its size budget (D16).
3. Workspace and permission policy (D8, D9).
4. Session lifetime and follow-ups (D7).
5. What a model name means: endpoint, API format and credentials (D10).
6. Skill sources and pinning (D13).
7. Timeouts, budgets, concurrency and recursion limits.
8. Trust model for repo configs (P16).
9. Task identity and observability: a task id mapped to the child session, so a task can be continued,
   respawned, forked, asked about or attached (D19, D20). Plus `subzero tasks`, `report`, `logs` and the
   task store.

## Suggested phasing

1. **Spike (~5 days):** core + pi child driver (rpc) + MCP parent server + sub-agent routing. Prove
   with Claude Code running sigil-evaluate in a native Claude subagent whose interpreter children are
   delegated to pi + local Qwen: routing works, the main conversation grows by only the evaluator's
   report, and the planted-problem scores are usable next to an all-Claude run. The prototype is subzero in its smallest form. The
   detailed plan is in [target-claude-pi.md](target-claude-pi.md) §6.
2. **v0.1:** YAML schema + `validate`/`lock`, the rest of the task model (`continue`, `ask`, `fork`,
   `rerun`, `report`), nested delegation (D14), `record: none` runs, read-only and workspace-write,
   proxy skills, generated `host: native` subagents (D12), skill manifests (`agents/subzero.yaml`,
   D17), `result.report_file`, sigil-write as the second workload (writer → evaluator → interpreters),
   Codex child driver.
3. **v0.2:** Claude child driver (bare and non-bare auth paths), persistent sessions and follow-ups,
   pi parent extension, Codex parent plugin.
4. **v0.3:** generic ACP driver, worktree mode, structured outputs everywhere, plus D12 (compile to
   native) if it is worth it.

## Decisions made while writing the spike's Sigil contracts (2026-11)

These were decided one at a time with the user while the contracts in `design/*.sigil` were written. They
apply to the spike; the contracts win where they differ from the rest of these documents.

1. The plugin's allow rule stays a stated assumption: the README and each delegating experiment arm's
   allow-list supply it. A setup command is left to a later version.
2. The driver hands the launch spec to its caller in the run-started event; the core writes it into the
   task record. Attach on a task with no recorded launch spec is refused. The skill overlay is kept as
   long as the record. The launch spec is a neutral shape defined by the core.
3. A swept task gets its own status `abandoned`; `parent_gone` is not a failure kind. The owner process
   (pid and start time) is recorded on the task's first index line, and the sweep never signals a process.
   It runs at every start-up and again before a collect, a cancel and a listing. A stored result
   outranks a later `abandoned` line, and the result is written in one step before its index line.
4. A new component, the **Delegation service**, owns the delegation, the live task registry, the start-up
   sequence, the agent lookup and the connection of the parts. The core takes an agent definition, not a
   name, and does not depend on a child driver. The agent file is read on each delegation. An unknown
   agent or a load error makes no task.
5. The project root is resolved once per process and handed to every part. It is absolute with symbolic
   links resolved; an empty `SUBZERO_PROJECT_DIR` counts as unset; the first reported root wins; with no
   root every call returns an error that names `SUBZERO_PROJECT_DIR`.
6. Files and expected output are rendered after the brief text, only when present. An empty brief text is
   refused. Progress is one line from the latest event, at most once a second, with a 30 s heartbeat.
7. No git status recording and no changed-file list. The user is warned in the README and reviews the tree
   with git.
8. `cancelled` is a status only; failure kinds are timeout, crashed, error and skill_mismatch. A budget cut
   does not set `truncated`, which means only the stop reason `length`.
9. The store folder `.agents/subzero/` is owner-only and holds its own `.gitignore` containing `*`; the
   user's own `.gitignore` is never edited.
10. `timeout` is required, in seconds, from spawn to settlement, and does not count time spent `Pending`.
11. Endpoint slots with lock files were removed: other agents or hosts may use the same server, and
    nothing outside one process can be controlled. Instead an optional `parallel` limit per model endpoint
    (`endpoints:`) is counted from one process's own `Starting` or `Live` children; further delegations
    stay `Pending`, first come first served. An endpoint entry that no agent uses is a load error.
12. A task listing shows task id, agent, status and creation time, at most 50 tasks, running first.
13. A collect or cancel of a running task owned by another process says so and changes nothing.
14. The experiment has five arms; B-low runs the interpreter at thinking `low` with its own agent
    definition. The measurement row records context use at settle (not a peak), the declared thinking
    level and any interpreter write outside its answer file.

