<!-- @sigil implements design/spike-harness.sigil SpikeHarness (spike results document) -->
# subzero spike: results

This document holds the measurements of the spike and the decision on whether to
build subzero v0.1. Plan: [docs/plans/2026-11-02-1109-feat-subzero-spike-plan.md](plans/2026-11-02-1109-feat-subzero-spike-plan.md).
Harness: [bench/README.md](../bench/README.md).

## Measurements

One row per pass, with every failed pass kept. The harness scores each planted
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
| 2026-11-04T06-27-47-390Z-B | B | failed | found | found | found | found | 68 | disjoint | 6 | 1 | 35,913 (in 2, cache 0+35,895, out 16) | 2,157,076 (in 64, cache 1,123,041+1,007,804, out 26,167) | 2,301,762 (in 2,021,810, cache 0+0, out 279,952) | 8159 s | max 90,051 of 13 | high | none | claude -p timed out; the run ended without the evaluator's report; Claude models seen: claude-sonnet-5-5; interpreter models seen: Qwen3.8 |
| 2026-11-04T09-07-17-899Z-B-low | B-low | completed | N/A | N/A | found | found | 96 | disjoint | 7 | 80 | 64,934 (in 4, cache 0+64,911, out 19) | 2,299,958 (in 78, cache 1,453,274+821,827, out 24,779) | 3,808,800 (in 3,616,177, cache 0+0, out 192,623) | 7844 s | max 67,331 of 14 | low | none | handed back disjoint; Claude models seen: claude-sonnet-5-5; interpreter models seen: Qwen3.8 |

| Arm | Passes (completed) | `booking-pending-range-contradiction` | `booking-rooms-archived-mark-ownership` | `calendar-display-name-unmet-obligation` | `calendar-owner-digest-unreached-step` |
| --- | --- | --- | --- | --- | --- |
| B | 1 (0) | 1/1 | 1/1 | 1/1 | 1/1 |
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

## Decision

_Written by the user, citing the table above: build subzero v0.1 or not, and why._
