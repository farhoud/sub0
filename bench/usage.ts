// @sigil implements design/spike-harness.sigil SpikeHarness (usage and writes)
//
// Usage comes from the claude -p stream (main conversation), the subagent
// transcripts (evaluator, and A's interpreters), and the session usage in the
// subzero task records (B's interpreters). Writes come from each interpreter's
// own transcript or pi session, never from a before-and-after listing: the
// evaluator writes many files in the same directory at the same time.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isUnavailable, type Measure, type StrayWrite, type TokenUsage, type Unavailable, unavailableTokens } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Line = any;

export const EVALUATOR_TYPE = "sigil-evaluator";
export const INTERPRETER_TYPES = ["interpreter", "interpreter-cheap"];

export function parseJsonl(text: string): Line[] {
  const lines: Line[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      // a torn trailing line of a killed run
    }
  }
  return lines;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Sum the usage of assistant messages. One API message appears on several lines
 * with the same id and the same usage, so each id is counted once.
 */
export function messageUsage(lines: Line[], reasonIfNone: string): TokenUsage {
  const seen = new Map<string, Line>();
  lines.forEach((line, i) => {
    const message = line?.message;
    if (line?.type !== "assistant" || !message?.usage) return;
    seen.set(typeof message.id === "string" ? message.id : `line-${i}`, message.usage);
  });
  if (seen.size === 0) return unavailableTokens(reasonIfNone);
  let input = 0, cacheRead = 0, cacheWrite = 0, output = 0;
  for (const usage of seen.values()) {
    input += num(usage.input_tokens);
    cacheRead += num(usage.cache_read_input_tokens);
    cacheWrite += num(usage.cache_creation_input_tokens);
    output += num(usage.output_tokens);
  }
  return { input, cacheRead, cacheWrite, output, total: input + cacheRead + cacheWrite + output };
}

/** The context in use at the last model call of a transcript: at settle, not a peak. */
export function contextAtSettle(lines: Line[]): Measure {
  const last = [...lines].reverse().find((l) => l?.type === "assistant" && l.message?.usage);
  if (!last) return { unavailable: "no assistant message in the transcript" };
  const u = last.message.usage;
  return num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens) + num(u.output_tokens);
}

export interface StreamSummary {
  sessionId: string | null;
  mainModels: string[];
  mainUsage: TokenUsage;
  resultText: string | null;
  isError: boolean;
  /** Read or Skill calls of the main conversation that touch a sigil skill. */
  mainSigilLoads: string[];
}

/** The main conversation is every assistant event with no parent tool use. */
export function summarizeStream(lines: Line[]): StreamSummary {
  const init = lines.find((l) => l?.type === "system" && l.subtype === "init");
  const result = [...lines].reverse().find((l) => l?.type === "result");
  const main = lines.filter((l) => l?.type === "assistant" && (l.parent_tool_use_id ?? null) === null);
  const loads: string[] = [];
  for (const line of main) {
    for (const part of line.message?.content ?? []) {
      if (part?.type !== "tool_use") continue;
      const input = JSON.stringify(part.input ?? {});
      if (part.name === "Skill" || /sigil-(understand|egglog|evaluate|compute-design)|skills\//.test(input)) {
        if (part.name === "Skill" || part.name === "Read" || part.name === "Bash" || part.name === "Grep" || part.name === "Glob") {
          loads.push(`${part.name} ${input.slice(0, 160)}`);
        }
      }
    }
  }
  return {
    sessionId: init?.session_id ?? result?.session_id ?? null,
    mainModels: modelsOf(main),
    mainUsage: messageUsage(main, "the stream holds no main-conversation message"),
    resultText: typeof result?.result === "string" ? result.result : null,
    isError: result?.is_error === true || result === undefined,
    mainSigilLoads: loads,
  };
}

/** The distinct models of the assistant messages in some lines. */
export function modelsOf(lines: Line[]): string[] {
  return [...new Set(lines.filter((l) => l?.type === "assistant" && typeof l.message?.model === "string").map((l) => l.message.model as string))];
}

export interface Transcript {
  agentId: string;
  agentType: string;
  lines: Line[];
}

/** Find the subagent transcripts of one session under the Claude projects folder. */
export function readTranscripts(projectsDir: string, sessionId: string): Transcript[] {
  const out: Transcript[] = [];
  let projects: string[] = [];
  try {
    projects = readdirSync(projectsDir);
  } catch {
    return out;
  }
  for (const project of projects) {
    const dir = join(projectsDir, project, sessionId, "subagents");
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const agentId = basename(name, ".jsonl");
      let agentType = "unknown";
      try {
        agentType = JSON.parse(readFileSync(join(dir, `${agentId}.meta.json`), "utf8")).agentType ?? "unknown";
      } catch {
        // no meta file: the type stays unknown
      }
      out.push({ agentId, agentType, lines: parseJsonl(readFileSync(join(dir, name), "utf8")) });
    }
  }
  return out;
}

export function sumUsage(parts: TokenUsage[], reasonIfNone: string): TokenUsage {
  if (parts.length === 0) return unavailableTokens(reasonIfNone);
  const field = (key: keyof TokenUsage): Measure => {
    let sum = 0;
    for (const part of parts) {
      const value = part[key];
      if (isUnavailable(value)) return value;
      sum += value;
    }
    return sum;
  };
  return { input: field("input"), cacheRead: field("cacheRead"), cacheWrite: field("cacheWrite"), output: field("output"), total: field("total") };
}

// ---- interpreters --------------------------------------------------------

export interface InterpreterRun {
  id: string;
  via: "subzero" | "agent-tool";
  usage: TokenUsage;
  contextAtSettle: Measure;
  /** The level its launch spec declares; null for a Claude interpreter. */
  thinkingLevel: string | Unavailable | null;
  models: string[];
  answerFile: string | null;
  round: number | null;
  /** Paths named by the run's write calls, relative to the pass directory, or why they could not be read. */
  writes: string[] | Unavailable;
}

const ANSWER = /[^\s`'"()<>]*-answer-(\d+)\.egg/g;

/**
 * The answer file a brief names, relative to the pass directory, and its round.
 * A re-ask brief also names earlier rounds' files; the highest round is this one's.
 */
export function answerFileOf(brief: string, cwd: string, passDir: string): { path: string; round: number } | null {
  let best: RegExpExecArray | null = null;
  for (const match of brief.matchAll(ANSWER)) if (best === null || Number(match[1]) > Number(best[1])) best = match;
  if (!best) return null;
  return { path: passRelative(best[0], cwd, passDir), round: Number(best[1]) };
}

/** Resolve symbolic links through the nearest existing parent; the file may be gone. */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(real(parent), basename(path));
  }
}

/** Normalize a written path against the pass directory. */
export function passRelative(path: string, cwd: string, passDir: string): string {
  const absolute = isAbsolute(path) ? path : resolve(cwd, path);
  return relative(real(passDir), real(absolute));
}

const CLAUDE_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** A's interpreters: Claude subagents started with the Agent tool. */
export function claudeInterpreter(t: Transcript, passDir: string): InterpreterRun {
  const firstUser = t.lines.find((l) => l?.type === "user");
  const content = firstUser?.message?.content;
  const prompt = typeof content === "string"
    ? content
    : (content ?? []).map((c: Line) => (typeof c?.text === "string" ? c.text : "")).join("\n");
  const cwd = t.lines.find((l) => typeof l?.cwd === "string")?.cwd ?? passDir;
  const answer = answerFileOf(prompt, cwd, passDir);
  const writes: string[] = [];
  for (const line of t.lines) {
    if (line?.type !== "assistant") continue;
    for (const part of line.message?.content ?? []) {
      if (part?.type === "tool_use" && CLAUDE_WRITE_TOOLS.has(part.name)) {
        const target = part.input?.file_path ?? part.input?.notebook_path;
        if (typeof target === "string") writes.push(passRelative(target, cwd, passDir));
      }
    }
  }
  return {
    id: t.agentId,
    via: "agent-tool",
    usage: messageUsage(t.lines, `transcript ${t.agentId} holds no assistant message`),
    contextAtSettle: contextAtSettle(t.lines),
    thinkingLevel: null,
    models: modelsOf(t.lines),
    answerFile: answer?.path ?? null,
    round: answer?.round ?? null,
    writes,
  };
}

function measure(value: unknown, reason: string): Measure {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isUnavailable(value)) return value;
  return { unavailable: reason };
}

/** B's interpreters: subzero tasks in the pass directory's store folder. */
export function subzeroInterpreters(passDir: string): InterpreterRun[] {
  const store = join(passDir, ".agents", "subzero");
  const tasksDir = join(store, "tasks");
  if (!existsSync(tasksDir)) return [];
  const sessions = existsSync(join(store, "sessions")) ? readdirSync(join(store, "sessions")) : [];
  // TaskStore records the session file on the task's index lines; the latest wins.
  const indexed = new Map<string, string>();
  if (existsSync(join(store, "index.jsonl"))) {
    for (const line of parseJsonl(readFileSync(join(store, "index.jsonl"), "utf8"))) {
      if (typeof line?.taskId === "string" && typeof line.sessionFile === "string") indexed.set(line.taskId, line.sessionFile);
    }
  }
  return readdirSync(tasksDir).sort().map((taskId): InterpreterRun => {
    const read = (file: string): Line => {
      try {
        return JSON.parse(readFileSync(join(tasksDir, taskId, file), "utf8"));
      } catch {
        return null;
      }
    };
    const task = read("task.json");
    const result = read(join("turns", "1.json"));
    const spec = task?.launchSpec;
    const cwd = typeof spec?.cwd === "string" ? spec.cwd : passDir;
    const answer = typeof task?.brief === "string" ? answerFileOf(task.brief, cwd, passDir) : null;

    const u = result?.usage;
    const missing = result === null ? `task ${taskId} has no result` : `task ${taskId} reported no session usage`;
    const usage: TokenUsage = u
      ? {
        input: measure(u.inputTokens, missing),
        cacheRead: measure(u.cacheReadTokens, missing),
        cacheWrite: measure(u.cacheWriteTokens, missing),
        output: measure(u.outputTokens, missing),
        total: measure(u.totalTokens, missing),
      }
      : unavailableTokens(missing);

    let writes: string[] | Unavailable;
    let models: string[] = [];
    const sessionName = sessions.find((f) => f.endsWith(`_${taskId}.jsonl`));
    const sessionFile = indexed.get(taskId) ?? (sessionName ? join(store, "sessions", sessionName) : undefined);
    if (sessionFile === undefined || !existsSync(sessionFile)) {
      writes = { unavailable: `no pi session found for task ${taskId}` };
    } else {
      writes = [];
      const lines = parseJsonl(readFileSync(sessionFile, "utf8"));
      const sessionCwd = lines.find((l) => l?.type === "session")?.cwd ?? cwd;
      models = [...new Set(lines.map((l) => l?.message?.role === "assistant" ? l.message.model : undefined).filter((m): m is string => typeof m === "string"))];
      for (const line of lines) {
        if (line?.message?.role !== "assistant") continue;
        for (const part of line.message.content ?? []) {
          if (part?.type === "toolCall" && (part.name === "write" || part.name === "edit") && typeof part.arguments?.path === "string") {
            (writes as string[]).push(passRelative(part.arguments.path, sessionCwd, passDir));
          }
        }
      }
    }
    const thinking = spec?.thinkingLevel;
    return {
      id: taskId,
      via: "subzero",
      usage,
      contextAtSettle: u ? measure(u.contextTokens, `task ${taskId} reported no context use`) : { unavailable: missing },
      thinkingLevel: typeof thinking === "string" || isUnavailable(thinking)
        ? thinking
        : { unavailable: `task ${taskId} recorded no launch spec` },
      models,
      answerFile: answer?.path ?? null,
      round: answer?.round ?? null,
      writes,
    };
  });
}

/** Writes other than the answer file; a write into the claims store is called out. */
export function strayWrites(runs: InterpreterRun[]): StrayWrite[] {
  const stray: StrayWrite[] = [];
  for (const run of runs) {
    if (isUnavailable(run.writes)) continue;
    for (const path of new Set(run.writes)) {
      if (run.answerFile !== null && path === run.answerFile) continue;
      stray.push({ interpreter: run.id, path, intoClaimsStore: path === "store" || path.startsWith("store/") });
    }
  }
  return stray;
}
