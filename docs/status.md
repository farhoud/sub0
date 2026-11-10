# subzero: implementation status

Status as of 2026-11-10, on branch `feat/subzero-claude-midtire` at commit `a20b3b0`.

This page compares what is built with what the design asks for. It has two
sources that do different jobs:

- **The contract** is the Sigil designs in [design/](../design/). They describe
  the spike and the work since then, and where they differ from the prose
  documents they win.
- **The target** is [design.md](design.md), [decisions.md](decisions.md) (its
  "Suggested phasing" section) and [problem.md](problem.md). They describe the
  whole product, most of which is planned for v0.2 and later.

**Versions.** v0.1 is the preview release (`0.1.0-preview.N`): the spike, tiered
routing and the plugin distribution, which is what this repository builds
today. v0.2 starts the task model with `continue` and `ask`, and the later
milestones follow the phasing in decisions.md.

The three plans in [plans/](plans/) record what each piece of work set out to
do, what it deferred, and how it was checked.

## At a glance

| Area | State |
|---|---|
| Sigil contract (11 components) | Every component has implementing code. `sigilc tree --root .` reports no diagnostics. |
| Claude Code parent, pi child | Built and checked live with Claude Code 2.1.318 and pi 0.87. |
| Tiered subagent routing for compound-engineering | Built and accepted in the R17 live run and its probes. |
| Plugin distribution (`subzero@qoherent`) | Built and tested locally. Not yet released: the repository transfer, the first tag and the walkthroughs are still to do. |
| Spike experiment (A/B on sigil-evaluate) | Partly run. Planned passes are missing and no go/no-go decision has been written. |
| v0.2 and later (task model, config layering, other hosts) | Not started. |

Tests: 23 files, 367 tests pass (`npm test`), with typecheck and build clean.

## What is implemented

### By Sigil component

| Component | Design | Code | What it covers |
|---|---|---|---|
| Kernel | [kernel.sigil](../design/kernel.sigil) | `src/kernel/` | Child drivers registered by host, parent adapter names; the child port, attach command, session export, starter tools and prerequisites check of a host. |
| TaskCore | [task-core.sigil](../design/task-core.sigil) | `src/core/` | Task, run and result shapes, the launch spec, task ids, result shaping (whole, never cut). |
| AgentConfig | [agent-config.sigil](../design/agent-config.sigil) | `src/config/` | `.agents/subzero.yaml`: `models.tiers`, `general` and `fallback` agents, `endpoints` with `parallel`, `routing`, load and unknown-agent errors, `init`'s starter entries. |
| DelegationService | [delegation-service.sigil](../design/delegation-service.sigil) | `src/service/` | Project root, start-up sweep, agent lookup per delegation, live task registry, per-endpoint parallel limit (queued vs started), status and result wording. |
| TaskStore | [task-store.sigil](../design/task-store.sigil) | `src/store/` | `.agents/subzero/` (owner-only, self-ignoring), `index.jsonl`, task records, `abandoned` status. |
| PiDriver | [pi-driver.sigil](../design/pi-driver.sigil) | `src/pi/` | `pi --mode rpc` with skill isolation (`--no-skills --skill`, `-ne`, `-nc`), skill verification, timeouts, typed failures, cancel, attach, HTML export, `pi --version` prerequisite check. |
| McpServer | [mcp-server.sigil](../design/mcp-server.sigil) | `src/mcp/` | Four MCP tools (`delegate`, `tasks`, `await`, `cancel`), progress notifications, the 48,000-character reply budget, parent session id per session. It reports the `package.json` version, which the build stamps into the bundle. |
| RoutingHooks | [routing-hooks.sigil](../design/routing-hooks.sigil) | `src/routing/` | SessionStart routing text; PreToolUse redirect on `Agent\|Task` with readiness marker, deny memory, pass-back, fork and `isolation` exemptions. |
| Cli | [cli.sigil](../design/cli.sigil) | `src/cli/` | `subzero init`, `run`, `tasks`, `attach`, `show`. |
| SigilWiring | [sigil-wiring.sigil](../design/sigil-wiring.sigil) | `examples/sigil/` | The agent file and README of the sigil experiment. |
| SpikeHarness | [spike-harness.sigil](../design/spike-harness.sigil) | `bench/`, [spike-results.md](spike-results.md) | The measurement harness, scorer and results table. |

Each source file names the component it implements in an `@sigil implements`
line. A conformance review (the `sigil-align` skill) was last run on Kernel,
PiDriver, TaskCore and Cli for the prerequisites check (2026-11-10). The other
components were last reviewed during the tiered routing work.

### By plan

| Plan | Units | State |
|---|---|---|
| [Spike](plans/2026-11-02-1109-feat-subzero-spike-plan.md) | U1–U8 | U1–U7 done. U8 (the comparison and the decision) is partly done; see below. |
| [Tiered subagent routing](plans/2026-11-06-0953-feat-tiered-subagent-routing-plan.md) | U0–U6 | Done. The R17 acceptance run and its probes are in [spike-results.md](spike-results.md). Decision 24 (results are never cut) replaced the plan's `await` share. |
| [Plugin distribution](plans/2026-11-10-1355-feat-claude-plugin-distribution-plan.md) | U1–U7 | U1–U6 done. U7 (the acceptance walkthroughs) is not run. |

The distribution work added:
- the Apache-2.0 license and version `0.1.0-preview.1`;
- the `bin/subzero` launcher, which checks for Node 22;
- the `/subzero:init` and `/subzero:tasks` commands;
- the release zip and local marketplace build (`npm run release:build`);
- the marketplace generator and the tag-triggered release workflow;
- the [README](../README.md) and [releasing.md](releasing.md).

## What is left

### 1. To finish the current work

**Release (distribution plan U7 and the transfer)**
- Stage 1 walkthrough: install from `dist-release/local-marketplace` on a clean
  profile and run `init`, `tasks` and a routed task. It needs a logged-in
  profile and a reachable model endpoint.
- The repository transfer to `qoherent/sub0` and every step of the
  [after-the-transfer checklist](releasing.md). That includes the scan of
  tracked files and history before anything is made public.
- The first tag. The release workflow has never run, so its push of
  `.claude-plugin/marketplace.json` to the default branch is untested.
- Stage 2 walkthrough: a newcomer follows the README alone, then updates from
  one preview to the next (AE1, AE3).
- A code review of the distribution changes, which has not been run.

**Decisions waiting on the user**
- `subzero init` writes only a `default` tier, but routing keys on `small`,
  `medium` and `large`. After `init` alone, nothing routes, and the README tells
  users to add a `medium` tier by hand. Should `init` write one?
- The README lists a fifth known limit: a cloned project's agent file is
  executable-grade configuration. It was added as the conservative default and
  needs the user's confirmation.

**Open problems**
- A newcomer cannot easily run `subzero show` or `subzero attach`. The plugin
  puts no `subzero` command on the user's PATH, and the distribution plan
  deferred slash commands for both (`attach` follows a live child and suits a
  terminal; `show` opens an exported page). For now the README says to run them
  as `node <checkout>/dist/cli.js show <task id>` (or `attach`) from a built
  checkout of this repository, and gives plain `pi` commands for reading a child
  session.

**Spike experiment (spike plan U8)**
- Not all planned passes were run. The plan asked for three passes each of A and
  B and one each of B-low, A-cheap and B-control. The table holds one A pass,
  three B passes, one B-low pass, one A-cheap pass and no B-control pass.
- The manual review-quality table is empty.
- In the plumbing checks, several live checks are still "pending": R3, the
  orphan check of R4, R5, the attach check of R7, and R9 and R10.
- The go/no-go paragraph for v0.2 is empty. The user writes it.

**Small loose end**
- The demo files name the `r9700` endpoint on purpose. The R17 run used a
  `local` provider in its copy because `r9700` was down, and spike-results.md
  records that.

### 2. Known limits of what is built

These are listed on the install page and are not fixed:
- The routing hook ignores plan mode. A generic spawn in plan mode still goes to
  the `general` agent, which can write files and run commands inside pi.
- The general agent works outside Claude Code's permission prompts; git is the
  only record of what it changed.
- The parallel limit and the queue are per Claude Code session.
- If the MCP server fails to start, the session-start text still says routing is
  on, and every subagent runs on Claude.
- Worktree-isolated and fork spawns always stay on Claude.
- The agent file is not gated by a trust step (design.md §4.2 asks for one).
- pi is the only child host, Claude Code the only parent, and Windows is not
  supported.

### 3. Deferred by the plans

From the tiered routing plan:
- a worktree mode for `delegate`, so worktree-isolated spawns can route;
- a plain model id on `delegate` beside tiers;
- cancelling several tasks in one call;
- an endpoint queue shared across Claude sessions;
- per-host tool lists, to decide when a second host exists;
- a use for parent adapter names beyond refusing a duplicate;
- a server-verified pass-back permit;
- a hook-side host check;
- tiers in a user-level config file.

From the distribution plan:
- a guided `/subzero:setup` and automatic installation of pi;
- a preview channel beside a stable one;
- an npm package and a CLI usable outside Claude Code;
- a central directory listing;
- an automated install check of the release zip;
- slash commands for `show` and `attach`.

### 4. The rest of the design (v0.2 and later)

The spike plan left these out on purpose. They come from design.md and the
phasing in decisions.md, and none of them is built.

**v0.2**
- The rest of the task model: `continue` (with respawn), `ask` (read-only probe
  fork), `fork`, `rerun` and the report (design.md §3.5, §6.3). The MCP server
  has four of the six tools in §5.1 (`continue` and `ask` are missing), and
  `delegate` has no `from` input.
- The other CLI commands of §6.3: `report`, `ask`, `continue`, `fork`, `rerun`,
  `logs` and `prune`, plus `subzero validate` and `subzero config`.
- Config layering (§4.1): `subzero.local.yaml`, `~/.agents/subzero.yaml`, skill
  manifests (`agents/subzero.yaml` in a skill, D17), `enabled: false`.
- Skill sources and pinning: git sources and `subzero.lock` (D13).
- Endpoint fields `base_url`, `api` and `api_key`; today pi's own `models.json`
  holds the server.
- The repo trust step for `.agents/subzero.yaml` (§4.2).
- Permissions mapped to the host (`read-only`, `workspace-write`, `full`, D8)
  and `needs_input` results for questions and permissions (D9).
- `record: none`, `process: keep`, `retention`, an idle timeout, and
  `result.report_file`.
- Structured output (`output.schema`).
- Proxy skills (§5.2), generated `host: native` subagents (D12), and
  `host: inline` agents.
- Nested delegation with `delegates:` and `maxDepth` (D14).
- sigil-write as the second workload.
- A Codex child driver.

**v0.3**
- A Claude child driver.
- The pi parent extension and the Codex parent plugin.

**v0.4**
- A generic ACP child driver.
- Worktree mode.
- Structured outputs on every host.
- Compiling to native features where it pays (D12).

**Product goals not yet met** ([problem.md](problem.md)): a parent in Codex and
in pi (G3 and the first success criterion); a definition shipped with a skill
(G1); follow-up, rerun, resume and fork of a task (G4). G2 and G5 hold for the
Claude Code to pi pair.
