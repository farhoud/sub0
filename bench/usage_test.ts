import { deepEqual, equal } from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderTable } from "./table.ts";
import type { MeasurementRow } from "./types.ts";
import {
  answerFileOf,
  claudeInterpreter,
  messageUsage,
  readTranscripts,
  strayWrites,
  subzeroInterpreters,
  sumUsage,
  summarizeStream,
} from "./usage.ts";

const usage = (input: number, output: number) => ({
  input_tokens: input,
  cache_read_input_tokens: 10,
  cache_creation_input_tokens: 5,
  output_tokens: output,
});
const assistant = (id: string, u: object, extra: object = {}) => ({ type: "assistant", message: { id, usage: u, content: [] }, ...extra });
const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

Deno.test("counts a cumulative counter once per message, not once per event", () => {
  // One API message is written on one line per content block, with the same usage.
  const lines = [assistant("m1", usage(100, 20)), assistant("m1", usage(100, 20)), assistant("m2", usage(50, 5))];
  deepEqual(messageUsage(lines, "none"), { input: 150, cacheRead: 20, cacheWrite: 10, output: 25, total: 205 });
});

Deno.test("takes the main conversation from the stream, without subagent messages", () => {
  const stream = [
    { type: "system", subtype: "init", session_id: "s1" },
    assistant("m1", usage(100, 10), { parent_tool_use_id: null }),
    assistant("sub", usage(9999, 999), { parent_tool_use_id: "toolu_1" }),
    { type: "result", result: "done\nHand-back state: incomplete", session_id: "s1" },
  ];
  const summary = summarizeStream(stream);
  equal(summary.sessionId, "s1");
  equal(summary.mainUsage.total, 125);
  equal(summary.mainSigilLoads.length, 0);
});

Deno.test("flags a main conversation that reads a sigil skill", () => {
  const stream = [{
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: "m", usage: usage(1, 1), content: [{ type: "tool_use", name: "Read", input: { file_path: "skills/sigil-understand/SKILL.md" } }] },
  }];
  equal(summarizeStream(stream).mainSigilLoads.length, 1);
});

function transcripts(passDir: string) {
  const projects = Deno.makeTempDirSync({ prefix: "bench-projects-" });
  const dir = join(projects, "-pass", "s1", "subagents");
  mkdirSync(dir, { recursive: true });
  const write = (id: string, type: string, lines: object[]) => {
    writeFileSync(join(dir, `${id}.jsonl`), jsonl(lines));
    writeFileSync(join(dir, `${id}.meta.json`), JSON.stringify({ agentType: type }));
  };
  write("agent-eval", "sigil-evaluator", [assistant("e1", usage(1000, 100)), assistant("e1", usage(1000, 100))]);
  write("agent-int", "interpreter", [
    { type: "user", cwd: passDir, message: { content: "Read run/prep/request.json. Write your claim rows to run/booking-answer-2.egg." } },
    {
      type: "assistant",
      message: {
        id: "i1",
        usage: usage(300, 30),
        content: [
          { type: "tool_use", name: "Write", input: { file_path: `${passDir}/run/booking-answer-2.egg` } },
          { type: "tool_use", name: "Write", input: { file_path: "run/notes.txt" } },
        ],
      },
    },
  ]);
  return projects;
}

Deno.test("splits usage per subagent from two transcripts", () => {
  const passDir = Deno.makeTempDirSync({ prefix: "bench-pass-" });
  const found = readTranscripts(transcripts(passDir), "s1");
  const evaluator = found.find((t) => t.agentType === "sigil-evaluator")!;
  const interpreter = found.find((t) => t.agentType === "interpreter")!;
  equal(messageUsage(evaluator.lines, "none").total, 1115);
  equal(messageUsage(interpreter.lines, "none").total, 345);
});

Deno.test("keeps and flags an interpreter's write of a second file, with its path", () => {
  const passDir = Deno.makeTempDirSync({ prefix: "bench-pass-" });
  const interpreter = readTranscripts(transcripts(passDir), "s1").find((t) => t.agentType === "interpreter")!;
  const run = claudeInterpreter(interpreter, passDir);
  equal(run.answerFile, "run/booking-answer-2.egg");
  equal(run.round, 2);
  deepEqual(strayWrites([run]), [{ interpreter: "agent-int", path: "run/notes.txt", intoClaimsStore: false }]);
});

function subzeroPass(sessionWrites: string[] | null, usageOverride?: object, sessionName = "2026-11-03T00_sz-aaaaaa.jsonl", launchSpec: object | null = null) {
  const passDir = Deno.makeTempDirSync({ prefix: "bench-pass-" });
  const store = join(passDir, ".agents", "subzero");
  mkdirSync(join(store, "tasks", "sz-aaaaaa", "turns"), { recursive: true });
  mkdirSync(join(store, "sessions"), { recursive: true });
  writeFileSync(join(store, "tasks", "sz-aaaaaa", "task.json"), JSON.stringify({
    brief: "Read run/prep/request.json and write `run/rooms-answer-1.egg`.",
    launchSpec: launchSpec ?? { cwd: passDir, thinkingLevel: "low", command: ["pi"] },
  }));
  writeFileSync(join(store, "tasks", "sz-aaaaaa", "turns", "1.json"), JSON.stringify({
    taskId: "sz-aaaaaa",
    status: "completed",
    usage: usageOverride ?? {
      inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 1000,
      cost: 0, contextTokens: 1200, contextWindow: 131072, contextPercent: 1,
    },
  }));
  if (sessionWrites !== null) {
    const file = join(store, "sessions", sessionName);
    writeFileSync(file, jsonl([
      { type: "session", cwd: passDir },
      {
        type: "message",
        message: { role: "assistant", model: "Qwen3.8", content: sessionWrites.map((p) => ({ type: "toolCall", name: "write", arguments: { path: p } })) },
      },
    ]));
    writeFileSync(join(store, "index.jsonl"), jsonl([{ taskId: "sz-aaaaaa", status: "completed", sessionFile: file }]));
  }
  return passDir;
}

Deno.test("reads B interpreters from the task records: usage, context at settle, declared thinking level", () => {
  const [run] = subzeroInterpreters(subzeroPass(["run/rooms-answer-1.egg"]));
  equal(run!.usage.total, 1000);
  equal(run!.contextAtSettle, 1200);
  equal(run!.thinkingLevel, "low");
  deepEqual(strayWrites([run!]), []);
});

Deno.test("marks the writes unchecked, with the reason, when no pi session is found", () => {
  const [run] = subzeroInterpreters(subzeroPass(null));
  deepEqual(run!.writes, { unavailable: "no pi session found for task sz-aaaaaa" });
  deepEqual(strayWrites([run!]), []);
});

Deno.test("finds the pi session through the index line, whatever its file name", () => {
  const [run] = subzeroInterpreters(subzeroPass(["run/rooms-answer-1.egg", "run/x.md"], undefined, "unusual-name.jsonl"));
  deepEqual(run!.writes, ["run/rooms-answer-1.egg", "run/x.md"]);
  deepEqual(run!.models, ["Qwen3.8"]);
});

Deno.test("keeps a launch spec's unavailable thinking level, and a missing launch spec, as unavailable", () => {
  const passDir = subzeroPass([], undefined, undefined, { thinkingLevel: { unavailable: "pi did not echo it" } });
  deepEqual(subzeroInterpreters(passDir)[0]!.thinkingLevel, { unavailable: "pi did not echo it" });
});

Deno.test("takes the highest round a re-ask brief names as its answer file", () => {
  const brief = "Round 2. Last round run/booking-answer-1.egg was refused for unit u3. Write run/booking-answer-2.egg.";
  deepEqual(answerFileOf(brief, "/p", "/p"), { path: "run/booking-answer-2.egg", round: 2 });
});

Deno.test("calls out a write into the claims store", () => {
  const [run] = subzeroInterpreters(subzeroPass(["run/rooms-answer-1.egg", "store/claims/x.json"]));
  deepEqual(strayWrites([run!]), [{ interpreter: "sz-aaaaaa", path: "store/claims/x.json", intoClaimsStore: true }]);
});

Deno.test("keeps a measure the session usage marks unavailable, with its reason, never zero", () => {
  const u = { unavailable: "pi did not report cost" };
  const [run] = subzeroInterpreters(subzeroPass([], {
    inputTokens: u, outputTokens: u, cacheReadTokens: u, cacheWriteTokens: u, totalTokens: u,
    cost: u, contextTokens: u, contextWindow: u, contextPercent: u,
  }));
  deepEqual(run!.usage.total, u);
  deepEqual(sumUsage([run!.usage, { input: 1, cacheRead: 1, cacheWrite: 1, output: 1, total: 4 }], "none").total, u);
  deepEqual(run!.contextAtSettle, u);
});

Deno.test("the table keeps failed passes, shows unavailable with its reason and flags stray writes", () => {
  const tokens = { input: 1, cacheRead: 0, cacheWrite: 0, output: 1, total: 2 };
  const row = (pass: string, status: "completed" | "failed"): MeasurementRow => ({
    pass, arm: "B", startedAt: "t", status, failure: status === "failed" ? "the run ended without the evaluator's report" : null,
    designRevision: "rev", claudeModel: "claude-sonnet-5-5", effort: "high",
    planted: { a: "found", b: "n/a" }, extraFindings: 0, ingestState: "incomplete", checkErrors: [], handbackState: null,
    reAsks: 1, unreadUnits: { unavailable: "check did not run" },
    tokens: { main: tokens, evaluator: tokens, interpreters: { ...tokens, total: { unavailable: "pi did not report" } } },
    wallTimeMs: 1000, interpreterContextAtSettle: [500], thinkingLevels: ["high"],
    interpreterRuns: { viaSubzero: 1, viaAgentTool: 0 },
    observedModels: { main: ["claude-sonnet-5-5"], evaluator: ["claude-sonnet-5-5"], interpreters: ["Qwen3.8"] },
    otherSubagents: [],
    writesUnchecked: [],
    strayWrites: [{ interpreter: "sz-aaaaaa", path: "run/notes.txt", intoClaimsStore: false }], untrustworthy: false,
    mainConversationClean: true, passDir: "/p",
  });
  const table = renderTable([row("p1", "completed"), row("p2", "failed")]);
  equal(table.split("\n").filter((l) => l.startsWith("| p")).length, 2);
  equal(table.includes("the run ended without the evaluator's report"), true);
  equal(table.includes("unavailable (pi did not report)"), true);
  equal(table.includes("`run/notes.txt`"), true);
  equal(table.includes("| B | 2 (1) | 2/2 | 0/0 (2 N/A) |"), true);
});
