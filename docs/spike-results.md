<!-- @sigil implements design/spike-harness.sigil SpikeHarness (spike results document) -->
# subzero spike: results

This document holds the measurements of the spike and the decision on whether to
build subzero v0.1. Plan: [docs/plans/2026-11-02-1109-feat-subzero-spike-plan.md](plans/2026-11-02-1109-feat-subzero-spike-plan.md).
Harness: [bench/README.md](../bench/README.md).

## Measurements

One row per pass. Four failed passes were dropped, their evidence kept under
`~/.subzero-bench`: a B pass that hit the earlier 120-minute limit, two A passes
whose evaluator did not wait for its background interpreters, and an A-cheap pass
whose evaluator was denied `sigilc` by its absolute path and stopped. The harness
since fixes the last three. The harness scores each planted
problem from a `sigilc check` it runs itself on the pass, so a score reflects what
the interpreters read. "N/A" means the problem's anchor Facets were not read in
that pass. "unscored" means the check did not validate. A measure that could not
be taken is shown as unavailable with its reason, never as zero. No threshold
applies.

The planned comparison is three matched passes each of A and B, plus one pass
each of B-low, A-cheap and B-control, all on the same design revision with the
same Claude model and effort (`deno task run matrix` in `bench/`).

<!-- spike-table:start -->

Design revision `52ebee356c4c2efb93cec157ca609ba9caabc83219481875d494ebc951fb4fa9`; Claude model and effort claude-sonnet-5-5 / high.

| Pass | Arm | Status | `booking-pending-range-contradiction` | `booking-rooms-archived-mark-ownership` | `calendar-display-name-unmet-obligation` | `calendar-owner-digest-unreached-step` | Extra findings | Ingest state | Re-asks | Unread units | Main tokens | Evaluator tokens | Interpreter tokens | Wall time | Interpreter context at settle | Thinking (launch spec) | Stray writes | Notes |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- | ---: | ---: | --- | --- | --- | ---: | --- | --- | --- | --- |
| 2026-11-04T09-07-17-899Z-B-low | B-low | completed | N/A | N/A | found | found | 96 | disjoint | 7 | 80 | 64,934 (in 4, cache 0+64,911, out 19) | 2,299,958 (in 78, cache 1,453,274+821,827, out 24,779) | 3,808,800 (in 3,616,177, cache 0+0, out 192,623) | 7844 s | max 67,331 of 14 | low | none | handed back disjoint; Claude models seen: claude-sonnet-5-5; interpreter models seen: Qwen3.8 |
| 2026-11-04T12-59-56-526Z-B | B | completed | found | found | found | found | 100 | disjoint | 3 | 0 | 65,011 (in 4, cache 0+64,988, out 19) | 2,499,659 (in 82, cache 1,973,628+505,304, out 20,645) | 2,797,740 (in 2,469,852, cache 0+0, out 327,888) | 8602 s | max 105,684 of 10 (1 unavailable) | high | none | handed back disjoint; Claude models seen: claude-sonnet-5-5; interpreter models seen: Qwen3.8 |
| 2026-11-04T15-26-11-231Z-B | B | completed | N/A | N/A | found | found | 48 | disjoint | 5 | 84 | 65,217 (in 4, cache 24,370+40,823, out 20) | 2,543,449 (in 84, cache 1,721,231+796,803, out 25,331) | unavailable (task sz-4r67qr reported no session usage) | 10335 s | max 89,044 of 12 (1 unavailable) | unavailable (task sz-4r67qr recorded no launch spec), high | none | handed back disjoint; writes unchecked: sz-4r67qr: no pi session found for task sz-4r67qr; Claude models seen: claude-sonnet-5-5; interpreter models seen: Qwen3.8 |
| 2026-11-04T18-18-26-612Z-A | A | completed | found | found | found | found | 50 | disjoint | 1 | 0 | 64,170 (in 4, cache 54,542+9,602, out 22) | 1,184,962 (in 42, cache 1,095,074+74,879, out 14,967) | 871,290 (in 50, cache 444,995+364,892, out 61,353) | 267 s | max 84,619 of 8 | — | none | handed back disjoint; Claude models seen: claude-sonnet-5-5; interpreter models seen: claude-sonnet-5-5 |
| 2026-11-04T18-22-53-983Z-B | B | completed | found | found | found | found | 120 | disjoint | 7 | 9 | 66,455 (in 4, cache 24,370+41,239, out 842) | 3,578,105 (in 98, cache 2,210,718+1,336,513, out 30,776) | 2,867,320 (in 2,493,537, cache 0+0, out 373,783) | 12262 s | max 90,492 of 14 | high | none | handed back disjoint; Claude models seen: claude-sonnet-5-5; interpreter models seen: Qwen3.8 |
| 2026-11-04T21-49-24-397Z-A-cheap | A-cheap | completed | found | found | found | missed | 50 | disjoint | 7 | 0 | 64,781 (in 4, cache 54,472+9,464, out 841) | 1,562,653 (in 46, cache 1,452,327+84,470, out 25,810) | 3,460,302 (in 804, cache 2,416,871+777,635, out 264,992) | 957 s | max 77,369 of 14 | — | none | handed back disjoint; Claude models seen: claude-sonnet-5-5; interpreter models seen: claude-haiku-4-5-20251001 |

| Arm | Passes (completed) | `booking-pending-range-contradiction` | `booking-rooms-archived-mark-ownership` | `calendar-display-name-unmet-obligation` | `calendar-owner-digest-unreached-step` |
| --- | --- | --- | --- | --- | --- |
| A | 1 (1) | 1/1 | 1/1 | 1/1 | 1/1 |
| A-cheap | 1 (1) | 1/1 | 1/1 | 1/1 | 0/1 |
| B | 3 (3) | 2/2 (1 N/A) | 2/2 (1 N/A) | 3/3 | 3/3 |
| B-low | 1 (1) | 0/0 (1 N/A) | 0/0 (1 N/A) | 1/1 | 1/1 |

<!-- spike-table:end -->

### Review quality (manual)

For each pass, which planted problems the evaluator's final report names, following
sigil's claims review fixture (`sigil:skills/sigil-evaluate/evals/claims-review-fixture.md`).

| Pass | Planted problems named in the evaluator's report | Notes |
| --- | --- | --- |

## Plumbing checks

Each delegation requirement of the plan, with where its evidence lives. "Test"
evidence runs against the scripted fake pi in `npm test`; "live" evidence needs a
real run and is filled in when it happens.

| Req | What it requires | Evidence | Status |
| --- | --- | --- | --- |
| R1 | One bounded result per call, task id first, summary within 2000 tokens | `test/core/task-core.test.ts`, `test/core/result.test.ts`, `test/mcp/server.test.ts` | tests pass; live: pending |
| R2 | Exactly the declared skills; a missing folder or a difference fails as `skill_mismatch` before the brief | `test/pi/driver.test.ts` (skill verification cases); live pi 0.87 `get_commands` check | tests pass; live verification passed on a smoke agent |
| R3 | Declared model and thinking level, user's pi login, no extensions, context files, templates or other skills | `test/pi/launch.test.ts`; launch spec in each task record; the table's thinking column | tests pass; live: pending |
| R4 | Typed failures, cancel with no failure kind, no pi process outlives Esc, timeout or session end | `test/pi/driver.test.ts`, `test/mcp/server.test.ts` (stdin close), `test/service/delegation-service.test.ts` (shutdown) | tests pass; live orphan check: pending |
| R5 | Progress at least every 60 s; `wait: false` plus `await` | `test/mcp/progress.test.ts`, `test/mcp/server.test.ts` | tests pass; live: pending |
| R6 | Per-endpoint parallel limit, first come first served, per process only | `test/service/delegation-service.test.ts` | tests pass |
| R7 | Durable task records, `tasks` capped at 50, abandoned tasks, `attach`, `show` | `test/store/task-store.test.ts`, `test/cli/cli.test.ts`, `test/mcp/server.test.ts` | tests pass; live attach: pending |
| R8 | No snapshots, no write gating, no changed-file list | `test/core/task-core.test.ts`; `examples/sigil/README.md` | tests pass |
| R9 | In B every interpreter goes through `delegate` and none through the Agent tool; the main conversation loads no sigil skill | Table: interpreter runs via subzero / Agent tool, main conversation clean | pending (U8) |
| R10 | Each interpreter writes its claim rows to the exact answer file its brief names | Table: stray writes; the ingest state | pending (U8) |

## Tiered subagent routing: acceptance run (R17)

Plan: [docs/plans/2026-11-06-0953-feat-tiered-subagent-routing-plan.md](plans/2026-11-06-0953-feat-tiered-subagent-routing-plan.md), unit U6. Run on 2026-11-10 from a copy made by `examples/demo/demo.sh setup` (git repo: an empty baseline commit, then `src/`), headless with `claude -p "/ce-code-review base:c00afd7 depth:full"`, Claude Code 2.1.318 (model claude-opus-5-5), the subzero plugin at commit 90b8f24 and compound-engineering 3.26.3. The review ran 53 turns in 13.7 minutes. Its transcript is the stream-json file `r17/transcript.jsonl` in the session scratchpad, not kept in the repository.

**Deviation from the plan.** The `r9700` endpoint was down, so the tiers (`default` and `medium`, thinking low and medium) ran on a llama.cpp server at `http://192.168.0.12:8080/v1` through a second pi provider, `local`, serving `qwen3.6-35b-a3b-reggie`, with the endpoint named `local` (`parallel: 1`). The task records therefore show `local/qwen3.6-35b-a3b-reggie`, not `r9700/Qwen3.8`. The demo files in the repository still name `r9700`; only the demo copy was edited.

| Success criterion | Result | Evidence |
|---|---|---|
| Every CE dispatch for a configured tier appears as a subzero task with that tier's model | Met, for one dispatch | CE selected one mid-tier reviewer, `testing`. `delegate` was called with `tier: "medium"` and `wait: false`, then `await` with `timeout_s: 600`. Task `sz-iziigu` records agent `general:medium` and a launch with `--model local/qwen3.6-35b-a3b-reggie --thinking medium --tools read,bash,edit,write,grep,find,ls`. Its `startedAt` is set, and its `parentSessionId` is the session's id from the per-session file. |
| Every CE dispatch for an unconfigured tier ran natively | Met | `correctness`, `security` and `adversarial` (session tier) went to the Agent tool, as did the merge leaf, the validator and the report leaf. No `large` or `small` tier is configured, and the hook denied none of them. |
| No Agent call was allowed with a prompt the hook had denied earlier, except a pass-back | Met, vacuously | The hook denied no spawn in the review, because Claude followed the SessionStart text and called `delegate` itself. There were no pass-backs. |
| CE's final report lists no failed reviewer and has findings from every selected reviewer | Met | Reviewers: correctness, security, testing, adversarial. The report lists 13 primary findings; the validator confirmed 8 of 8 in its batch and the testing reviewer's findings are among them. Coverage lists no failed reviewer. |

**Probe of the PreToolUse hook.** Because the review never needed a denial, a second headless run asked Claude for one generic Agent spawn with `model: "sonnet"` and the description `probe hook`. The hook denied it with the instruction to call `delegate` with `tier: "medium"`, the prompt unchanged as `brief` and `wait: false`; Claude did so, and task `sz-wksvtm` (`general:medium`) completed in 6 seconds with the reply `ok`. This confirms in Claude Code 2.1.318 that the hook fires on the Agent tool, that the readiness marker and the ancestor-process check work in a real process tree, and that a denial reaches Claude as a routing instruction. The hook input's `description` field (the pass-back marker) was not exercised, because no pass-back was needed.

**Not covered by this run**
- AE4 (queued tasks): only one reviewer was routed, so no task waited for the endpoint. The queued and started wording is covered by the unit tests, not by CE.
- AE12 (pass-back), AE8 (alias switch after a deny) and the `fork` and `isolation` field names were not run live.
- The three further scenarios the plan lists were not run: `/compact` mid-review, the subzero server command broken, and a tier whose host has no driver.
- CE tried to start its cross-model peer review (a Codex command). The non-interactive session had no permission to run it, so it was denied, nothing was sent, and the adversarial lens ran in-process.
- CE chose four reviewers for a 75-line diff, so the run shows routing for one mid-tier reviewer, not a six-reviewer batch.

## Decision

_Written by the user, citing the table above: build subzero v0.1 or not, and why._
