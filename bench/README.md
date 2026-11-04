<!-- @sigil implements design/spike-harness.sigil SpikeHarness (README) -->
# subzero spike harness

Runs one experiment arm on a fresh copy of sigil's planted Slotted design, scores
it, and appends one measurement row. The rows become the table in
[docs/spike-results.md](../docs/spike-results.md), where the user writes the
decision. No threshold applies.

| Arm | Interpreters run as |
| --- | --- |
| A | Claude subagents on the evaluator's model |
| A-cheap | Claude subagents on Haiku |
| B | subzero → pi → `r9700/Qwen3.8`, thinking high |
| B-control | subzero → pi → the evaluator's Claude model |
| B-low | subzero → pi → `r9700/Qwen3.8`, thinking low |

## Before a run

- Build sigilc in the sigil checkout (`deno task build:sigilc` there), or set `SIGILC`.
  Set `SIGIL_REPO` if sigil is not at `~/Workspace/sigil`. The sigil repository is
  only read.
- For a B arm: run `npm run build` in this repository, so the plugin's
  `dist/server.js` exists. pi must be installed with the `r9700` endpoint in
  `~/.pi/agent/models.json`. For B-control, pi must also be logged into Anthropic.
- Run with the endpoint otherwise idle and no second Claude session: the
  parallel limit holds only among the child runs of one process.

## Commands

From `bench/`:

```sh
deno task run run --arm B --model claude-sonnet-5-5 --effort high   # one pass
deno task run matrix --model claude-sonnet-5-5 --effort high        # 3 A, 3 B, B-low, A-cheap, B-control
deno task run table                                                 # re-render the table
deno task run score <dir with root/ and store/>                     # re-score a stored pass
deno task test
```

Every arm in a comparison must use the same `--model` and `--effort`; the table
warns when rows differ, or when they ran on different design revisions. Passes are
kept under `~/.subzero-bench/<pass>/` (`--out` to change), with `pass/` (Claude's
working directory) and `evidence/` (the stream, stderr, the claude arguments and
the row).

## What a pass does

1. **Stage** `pass/`: `root/` is the planted fixture without a claims store, plus an
   empty private `store/`, `run/`, the staged sigil skills in `skills/` (outside
   every Claude discovery path), `bin/sigilc`, and `.agents/subzero.yaml` from
   `examples/sigil`. B-control's interpreter model is set to the evaluator's model
   in that copy.
2. **Run** `claude -p --output-format stream-json` from `pass/` with
   `--permission-mode dontAsk` and an explicit allow-list, so an unlisted tool is
   denied and never prompted. The allow-list carries the allow rule
   `mcp__plugin_subzero_subzero__*` for B arms. It never uses
   `--no-session-persistence`, which drops the subagent transcripts, or
   `--strict-mcp-config`, which drops the plugin's MCP server. It passes
   `--setting-sources project,local`, so the user's enabled plugins (an installed
   sigil plugin among them) stay out of the pass; login is unaffected.
3. **Check and score**: `sigilc check --root pass/root --store pass/store`, validated
   with sigil's `validateLinkedEvidence`. The planted problems are scored from that
   report by a re-implementation of sigil's unexported issue matcher
   ([score.ts](score.ts); `score_test.ts` compares it with sigil's own report):
   - A problem whose anchor Facet was not read is N/A, not missed.
   - The right class and law with the wrong subject is an extra finding.
4. **Measure**:
   - The main conversation comes from the stream.
   - The evaluator and A's interpreters come from the subagent transcripts. Each
     message id is counted once, because one message spans several lines.
   - B's interpreters come from the session usage and launch spec in each subzero
     task record. The thinking level is the one the launch spec declares, not the
     one the server applied.
   - Context use is the value at settle, not the peak.
   - An unavailable measure stays unavailable with its reason.
5. **Writes**: each interpreter's writes are read from its own transcript or pi
   session and compared with the answer file its brief names. A pass with another
   write is kept and flagged. A write into `store/` marks the score untrustworthy.
6. **Row**: appended to `results/rows.jsonl` and rendered into `results/table.md`
   and the results document. A run without the evaluator's report is a failed row,
   never dropped.

The review quality of the evaluator stays a manual record in the results
document.
