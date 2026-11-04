// @sigil implements design/spike-harness.sigil SpikeHarness (command line)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { MATRIX } from "./arms.ts";
import { checkPass, preflight } from "./check.ts";
import { runPassOrFail } from "./run.ts";
import { scoreLinked } from "./score.ts";
import { sigilcPath } from "./sigil.ts";
import { appendRow, readRows, renderTable, updateResultsDocument } from "./table.ts";
import { type Arm, ARMS } from "./types.ts";

const HERE = new URL(".", import.meta.url).pathname;
const RESULTS = join(HERE, "results");
const ROWS = join(RESULTS, "rows.jsonl");
const TABLE = join(RESULTS, "table.md");
const DOC = resolve(HERE, "..", "docs", "spike-results.md");

const USAGE = `usage (from bench/):
  deno task run run --arm <A|A-cheap|B|B-control|B-low> --model <claude model id> [--effort <level>]
  deno task run matrix --model <claude model id> [--effort <level>]
  deno task run table
  deno task run score <pass directory holding root/ and store/>

options: --out <dir> (default ~/.subzero-bench), --timeout-min <minutes> (default 120)`;

function refresh(): void {
  const table = renderTable(readRows(ROWS));
  writeFileSync(TABLE, table);
  if (existsSync(DOC)) updateResultsDocument(DOC, table);
}

async function onePass(arm: Arm, values: Record<string, string | undefined>): Promise<void> {
  if (!values.model) throw new Error("--model is required: every arm must use the same Claude model");
  const passId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${arm}`;
  const outRoot = resolve(values.out ?? join(Deno.env.get("HOME") ?? ".", ".subzero-bench"));
  const outDir = join(outRoot, passId);
  mkdirSync(outDir, { recursive: true });
  console.error(`subzero-bench: ${arm} pass ${passId} in ${outDir}`);
  const row = await runPassOrFail({
    arm,
    passId,
    outDir,
    claudeModel: values.model,
    effort: values.effort ?? null,
    sigilc: sigilcPath(),
    timeoutMs: Number(values["timeout-min"] ?? 120) * 60_000,
  });
  mkdirSync(join(outDir, "evidence"), { recursive: true });
  writeFileSync(join(outDir, "evidence", "row.json"), JSON.stringify(row, null, 2));
  appendRow(ROWS, row);
  refresh();
  console.log(`${row.pass} ${row.arm} ${row.status}${row.failure ? ` (${row.failure})` : ""}: ${JSON.stringify(row.planted)}`);
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      arm: { type: "string" },
      model: { type: "string" },
      effort: { type: "string" },
      out: { type: "string" },
      "timeout-min": { type: "string" },
    },
  });
  mkdirSync(RESULTS, { recursive: true });
  switch (positionals[0]) {
    case "run": {
      const arm = values.arm as Arm;
      if (!ARMS.includes(arm)) throw new Error(`--arm must be one of ${ARMS.join(", ")}`);
      await onePass(arm, values);
      return 0;
    }
    case "matrix":
      for (const arm of MATRIX) await onePass(arm, values);
      return 0;
    case "table":
      refresh();
      console.log(TABLE);
      return 0;
    case "score": {
      const passDir = positionals[1];
      if (!passDir) throw new Error("score needs a pass directory");
      const sigilc = sigilcPath();
      const scratch = Deno.makeTempDirSync({ prefix: "subzero-bench-score-" });
      const pre = await preflight(sigilc, join(passDir, "root"), scratch);
      const check = await checkPass(sigilc, join(passDir, "root"), join(passDir, "store"), pre.expected);
      if (!check.validation?.valid || !check.report || !check.context) {
        console.log(JSON.stringify({ state: check.result?.state ?? null, errors: check.validation?.errors ?? [check.error] }, null, 2));
        return 1;
      }
      const score = scoreLinked({ report: check.report, context: check.context }, pre.issues);
      console.log(JSON.stringify({ state: check.result?.state, planted: score.planted, extra: score.extra.length }, null, 2));
      return 0;
    }
    default:
      console.error(USAGE);
      return 2;
  }
}

if (import.meta.main) {
  try {
    Deno.exit(await main(Deno.args));
  } catch (err) {
    console.error(`subzero-bench: ${(err as Error).message}`);
    Deno.exit(1);
  }
}
