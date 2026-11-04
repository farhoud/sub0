// @sigil implements design/spike-harness.sigil SpikeHarness
//
// One pass: stage a fresh pass directory, run the arm with claude -p from it, run
// sigilc check on the pass itself, score the planted problems from that report,
// read usage and interpreter writes, and build one measurement row. A run without
// an evaluator report still yields a row, marked failed.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentsJson, allowList, ARM_SPECS, MAIN_PROMPT, SUBZERO_ROOT } from "./arms.ts";
import { checkPass, preflight } from "./check.ts";
import { scoreLinked, unscored } from "./score.ts";
import { sigil } from "./sigil.ts";
import { stagePass } from "./stage.ts";
import { type Arm, isUnavailable, type Measure, type MeasurementRow, unavailableTokens } from "./types.ts";
import {
  claudeInterpreter,
  EVALUATOR_TYPE,
  INTERPRETER_TYPES,
  type InterpreterRun,
  messageUsage,
  modelsOf,
  parseJsonl,
  readTranscripts,
  strayWrites,
  subzeroInterpreters,
  sumUsage,
  summarizeStream,
  type Transcript,
} from "./usage.ts";

export interface PassOptions {
  arm: Arm;
  passId: string;
  outDir: string;
  claudeModel: string;
  effort: string | null;
  sigilc: string;
  timeoutMs: number;
  claude?: string;
  /** Where Claude Code keeps session transcripts. */
  projectsDir?: string;
}

export function projectsDir(): string {
  const config = Deno.env.get("CLAUDE_CONFIG_DIR") ?? join(Deno.env.get("HOME") ?? "", ".claude");
  return join(config, "projects");
}

interface ClaudeRun {
  exitCode: number | null;
  timedOut: boolean;
  wallTimeMs: number;
}

async function runClaude(options: PassOptions, cwd: string, bin: string, streamFile: string, stderrFile: string): Promise<ClaudeRun> {
  const spec = ARM_SPECS[options.arm];
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    options.claudeModel,
    ...(options.effort ? ["--effort", options.effort] : []),
    // Never --no-session-persistence (it drops the subagent transcripts) nor
    // --strict-mcp-config (it drops the plugin's MCP server in B).
    // No user settings: the user's enabled plugins (an installed sigil plugin
    // among them) would otherwise load beside the staged skills. --bare is no
    // substitute: it drops OAuth login and plugin hooks.
    "--setting-sources",
    "project,local",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    ...allowList(spec),
    "--agents",
    JSON.stringify(agentsJson(spec, options.effort)),
    ...(spec.delegates ? ["--plugin-dir", SUBZERO_ROOT] : []),
    "--",
    MAIN_PROMPT,
  ];
  writeFileSync(join(cwd, "..", "evidence", "claude-args.json"), JSON.stringify(args, null, 2));
  const started = Date.now();
  const child = new Deno.Command(options.claude ?? "claude", {
    args,
    cwd,
    env: { PATH: `${bin}:${Deno.env.get("PATH") ?? ""}` },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGTERM");
    } catch { /* already gone */ }
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch { /* already gone */ }
    }, 10_000);
  }, options.timeoutMs);
  const stream = await Deno.open(streamFile, { write: true, create: true, truncate: true });
  const errors = await Deno.open(stderrFile, { write: true, create: true, truncate: true });
  await Promise.all([child.stdout.pipeTo(stream.writable), child.stderr.pipeTo(errors.writable)]);
  const status = await child.status;
  clearTimeout(timer);
  return { exitCode: status.code, timedOut, wallTimeMs: Date.now() - started };
}

function lastAssistantText(t: Transcript | undefined): string | null {
  if (!t) return null;
  for (const line of [...t.lines].reverse()) {
    if (line?.type !== "assistant") continue;
    const text = (line.message?.content ?? []).filter((c: { type?: string }) => c?.type === "text")
      .map((c: { text: string }) => c.text).join("\n");
    if (text.trim() !== "") return text;
  }
  return null;
}

export async function runPass(options: PassOptions): Promise<MeasurementRow> {
  const startedAt = new Date().toISOString();
  const layout = await stagePass(options.outDir, options.claudeModel, options.sigilc);
  const pre = await preflight(options.sigilc, layout.root, join(layout.evidence, "preflight"));
  if (ARM_SPECS[options.arm].delegates && !existsSync(join(SUBZERO_ROOT, "dist", "server.js"))) {
    throw new Error("arm B needs the subzero plugin built: run npm run build in the subzero repository");
  }

  const streamFile = join(layout.evidence, "stream.jsonl");
  const claude = await runClaude(options, layout.passDir, layout.bin, streamFile, join(layout.evidence, "stderr.txt"));
  return await measurePass(options, startedAt, layout.passDir, layout.root, layout.store, pre, claude, streamFile);
}

/** Build the row of a pass that has run. Separate from runPass so a stored pass can be re-measured. */
export async function measurePass(
  options: Pick<PassOptions, "arm" | "passId" | "claudeModel" | "effort" | "sigilc" | "projectsDir">,
  startedAt: string,
  passDir: string,
  root: string,
  store: string,
  pre: Awaited<ReturnType<typeof preflight>>,
  claude: ClaudeRun,
  streamFile: string,
): Promise<MeasurementRow> {
  const stream = summarizeStream(existsSync(streamFile) ? parseJsonl(await Deno.readTextFile(streamFile)) : []);
  const transcripts = stream.sessionId ? readTranscripts(options.projectsDir ?? projectsDir(), stream.sessionId) : [];
  const evaluators = transcripts.filter((t) => t.agentType === EVALUATOR_TYPE);
  const others = transcripts.filter((t) => t.agentType !== EVALUATOR_TYPE && !INTERPRETER_TYPES.includes(t.agentType));

  const check = await checkPass(options.sigilc, root, store, pre.expected);
  const valid = check.validation?.valid === true && check.report !== null && check.context !== null;
  const score = valid ? scoreLinked({ report: check.report!, context: check.context! }, pre.issues) : unscored(pre.issues);

  const runs: InterpreterRun[] = [
    ...transcripts.filter((t) => INTERPRETER_TYPES.includes(t.agentType)).map((t) => claudeInterpreter(t, passDir)),
    ...subzeroInterpreters(passDir),
  ];
  const stray = strayWrites(runs);

  const { parseHandbackState } = await sigil();
  const evaluatorText = lastAssistantText(evaluators.at(-1)) ?? stream.resultText;
  const handbackState = evaluatorText ? parseHandbackState(evaluatorText) : null;

  const failures: string[] = [];
  if (claude.timedOut) failures.push("claude -p timed out");
  else if (claude.exitCode !== 0) failures.push(`claude -p exited ${claude.exitCode}`);
  if (evaluators.length === 0) failures.push("no evaluator subagent transcript");
  if (handbackState === null) failures.push("the run ended without the evaluator's report");

  const unread = check.result?.unreadUnits;
  const rounds = runs.filter((r) => r.round !== null);
  const reAsks: Measure = stream.sessionId === null
    ? { unavailable: "no session id in the stream, so no transcript was found" }
    : runs.length === 0
    ? { unavailable: "no interpreter run was found" }
    : rounds.length === 0
    ? { unavailable: "no interpreter brief named an answer file" }
    : rounds.filter((r) => r.round! > 1).length;

  return {
    pass: options.passId,
    arm: options.arm,
    startedAt,
    status: failures.length === 0 ? "completed" : "failed",
    failure: failures.length === 0 ? null : failures.join("; "),
    designRevision: pre.expected.workspaceDigest,
    claudeModel: options.claudeModel,
    effort: options.effort,
    planted: score.planted,
    extraFindings: valid ? score.extra.length : { unavailable: "the check did not validate" },
    ingestState: typeof check.result?.state === "string"
      ? check.result.state
      : { unavailable: check.error ?? "the check did not run" },
    checkErrors: check.error ? [check.error] : [...(check.validation?.errors ?? [])],
    handbackState,
    reAsks,
    unreadUnits: typeof unread === "number" ? unread : { unavailable: check.error ?? "the check reported no unread count" },
    tokens: {
      main: stream.mainUsage,
      evaluator: evaluators.length > 0
        ? sumUsage(evaluators.map((t) => usageOf(t)), "no evaluator usage")
        : unavailableTokens("no evaluator subagent transcript"),
      interpreters: sumUsage(runs.map((r) => r.usage), "no interpreter ran"),
    },
    wallTimeMs: claude.wallTimeMs,
    interpreterContextAtSettle: runs.map((r) => r.contextAtSettle),
    thinkingLevels: runs.filter((r) => r.via === "subzero").map((r) => r.thinkingLevel ?? { unavailable: "not recorded" }),
    interpreterRuns: {
      viaSubzero: runs.filter((r) => r.via === "subzero").length,
      viaAgentTool: runs.filter((r) => r.via === "agent-tool").length,
    },
    observedModels: {
      main: stream.mainModels,
      evaluator: [...new Set(evaluators.flatMap((t) => modelsOf(t.lines)))],
      interpreters: [...new Set(runs.flatMap((r) => r.models))],
    },
    otherSubagents: others.map((t) => ({ agentType: t.agentType, tokens: usageOf(t) })),
    strayWrites: stray,
    writesUnchecked: runs.flatMap((r) => (isUnavailable(r.writes) ? [`${r.id}: ${r.writes.unavailable}`] : [])),
    untrustworthy: stray.some((w) => w.intoClaimsStore),
    mainConversationClean: stream.sessionId === null
      ? { unavailable: "no stream from claude -p" }
      : stream.mainSigilLoads.length === 0,
    passDir,
  };
}

/** Run a pass; a pass that breaks is still a row, so a matrix goes on. */
export async function runPassOrFail(options: PassOptions): Promise<MeasurementRow> {
  const startedAt = new Date().toISOString();
  try {
    return await runPass(options);
  } catch (err) {
    return failedRow(options, startedAt, `harness error: ${(err as Error).message}`, join(options.outDir, "pass"));
  }
}

/**
 * The row of a pass that broke before it could be measured. It is appended like
 * any other, so no pass is ever dropped.
 */
export function failedRow(
  options: Pick<PassOptions, "arm" | "passId" | "claudeModel" | "effort">,
  startedAt: string,
  error: string,
  passDir: string,
  designRevision = "unavailable",
): MeasurementRow {
  const u = { unavailable: error };
  return {
    pass: options.passId,
    arm: options.arm,
    startedAt,
    status: "failed",
    failure: error,
    designRevision,
    claudeModel: options.claudeModel,
    effort: options.effort,
    planted: {},
    extraFindings: u,
    ingestState: u,
    checkErrors: [],
    handbackState: null,
    reAsks: u,
    unreadUnits: u,
    tokens: { main: unavailableTokens(error), evaluator: unavailableTokens(error), interpreters: unavailableTokens(error) },
    wallTimeMs: 0,
    interpreterContextAtSettle: [],
    thinkingLevels: [],
    interpreterRuns: { viaSubzero: 0, viaAgentTool: 0 },
    observedModels: { main: [], evaluator: [], interpreters: [] },
    otherSubagents: [],
    strayWrites: [],
    writesUnchecked: [],
    untrustworthy: false,
    mainConversationClean: u,
    passDir,
  };
}

function usageOf(t: Transcript) {
  return messageUsage(t.lines, `transcript ${t.agentId} holds no assistant message`);
}
