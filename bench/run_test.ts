import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runPass, runPassOrFail } from "./run.ts";
import { sigilcPath } from "./sigil.ts";
import type { Arm } from "./types.ts";

const FAKE = new URL("./testdata/fake-claude.mjs", import.meta.url).pathname;

async function pass(arm: Arm, mode: "report" | "no-report" | "failed" | "crash", claude = FAKE) {
  const out = Deno.makeTempDirSync({ prefix: "bench-run-" });
  const log = Deno.makeTempDirSync({ prefix: "bench-claude-" });
  const projects = Deno.makeTempDirSync({ prefix: "bench-projects-" });
  Deno.env.set("FAKE_CLAUDE_MODE", mode);
  Deno.env.set("FAKE_CLAUDE_LOG", log);
  Deno.env.set("FAKE_CLAUDE_PROJECTS", projects);
  const row = await runPassOrFail({
    arm,
    passId: `p-${arm}`,
    outDir: out,
    claudeModel: "claude-sonnet-5-5",
    effort: "high",
    sigilc: sigilcPath(),
    timeoutMs: 60_000,
    claude,
    projectsDir: projects,
  });
  const argsFile = join(log, "args.json");
  const claudeArgs = existsSync(argsFile) ? JSON.parse(readFileSync(argsFile, "utf8")) : null;
  return { row, claude: claudeArgs, out };
}

Deno.test("a B pass: stages a fresh pass, runs the arm, checks and scores it itself, and reads its interpreters", async () => {
  const { row, claude, out } = await pass("B", "report");
  const passDir = join(out, "pass");
  equal(claude.cwd, Deno.realPathSync(passDir));
  for (const dir of ["root", "store", "run", "skills/sigil-understand", "skills/sigil-egglog", ".agents/subzero.yaml"]) {
    ok(existsSync(join(passDir, dir)), dir);
  }
  ok(!existsSync(join(passDir, "root", ".sigil", "claims")));
  ok(claude.path.startsWith(join(passDir, "bin")));
  const args: string[] = claude.args;
  ok(args.includes("--plugin-dir"));
  ok(args.includes("mcp__plugin_subzero_subzero__*"));
  equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
  ok(!args.includes("--no-session-persistence") && !args.includes("--strict-mcp-config"));
  equal(args[args.indexOf("--setting-sources") + 1], "project,local");
  const agents = JSON.parse(args[args.indexOf("--agents") + 1]);
  deepEqual(agents["sigil-evaluator"].disallowedTools, ["Agent"]);

  equal(row.status, "completed");
  equal(row.ingestState, "incomplete");
  equal(row.handbackState, "incomplete");
  deepEqual(Object.values(row.planted), ["n/a", "n/a", "n/a", "n/a"]);
  equal(row.tokens.main.total, 550);
  equal(row.tokens.evaluator.total, 4400);
  equal(row.tokens.interpreters.total, 770);
  deepEqual(row.thinkingLevels, ["high"]);
  deepEqual(row.interpreterRuns, { viaSubzero: 1, viaAgentTool: 0 });
  deepEqual(row.strayWrites, [{ interpreter: "sz-bbbbbb", path: "run/scratch.md", intoClaimsStore: false }]);
  equal(row.untrustworthy, false);
  equal(row.mainConversationClean, true);
});

Deno.test("an A pass loads no plugin and keeps the Agent tool for the evaluator", async () => {
  const { claude, row, out } = await pass("A", "report");
  const args: string[] = claude.args;
  ok(!args.includes("--plugin-dir"));
  // An evaluator denied one spelling of sigilc may stop instead of trying another.
  for (const rule of ["Bash(sigilc *)", "Bash(./bin/sigilc *)", `Bash(${join(out, "pass", "bin")}/sigilc *)`]) {
    ok(args.includes(rule), rule);
  }
  ok(!args.some((a) => a.startsWith("mcp__")));
  const agents = JSON.parse(args[args.indexOf("--agents") + 1]);
  equal(agents["sigil-evaluator"].disallowedTools, undefined);
  ok(agents.interpreter);
  deepEqual(row.thinkingLevels, []);
  // One interpreter message on two transcript lines counts once.
  equal(row.tokens.interpreters.total, 330);
  deepEqual(row.interpreterRuns, { viaSubzero: 0, viaAgentTool: 1 });
  deepEqual(row.strayWrites, []);
  equal(row.reAsks, 0);
  deepEqual(row.observedModels.interpreters, ["claude-sonnet-5-5"]);
  equal(agents.interpreter.effort, "high");
});

Deno.test("a crashed claude run is a failed row whose measures stay unavailable", async () => {
  const { row } = await pass("B", "crash");
  equal(row.status, "failed");
  ok(row.failure!.includes("claude -p exited 1"));
  deepEqual(row.reAsks, { unavailable: "no session id in the stream, so no transcript was found" });
  deepEqual(row.tokens.main.total, { unavailable: "the stream holds no main-conversation message" });
});

Deno.test("a harness error still yields a failed row instead of dropping the pass", async () => {
  const { row } = await pass("A", "report", "/nonexistent/claude");
  equal(row.status, "failed");
  ok(row.failure!.startsWith("harness error:"));
  ok("unavailable" in (row.ingestState as object));
});

Deno.test("stages B-control on the evaluator's Claude model", async () => {
  const { out } = await pass("B-control", "report");
  const yaml = readFileSync(join(out, "pass", ".agents", "subzero.yaml"), "utf8");
  ok(/sigil-interpreter-control:[\s\S]*?model: anthropic\/claude-sonnet-5-5/.test(yaml));
});

Deno.test("a run without the evaluator's report is kept as a failed row, never dropped", async () => {
  const { row } = await pass("B", "no-report");
  equal(row.status, "failed");
  equal(row.failure, "the run ended without the evaluator's report");
  // The harness's own check still ran and is recorded.
  equal(row.ingestState, "incomplete");
});

Deno.test("an evaluator that hands back failed makes a failed row", async () => {
  const { row } = await pass("B", "failed");
  equal(row.status, "failed");
  equal(row.handbackState, "failed");
  equal(row.failure, "the evaluator handed back failed");
});
