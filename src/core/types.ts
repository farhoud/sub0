// @sigil implements design/task-core.sigil TaskCore (shapes)
//
// The host-neutral shapes of a task. Nothing here names pi: a child driver fills
// them in through the child port.
import type { AgentDefinition } from '../config/agent-config.js';

export type ChildRunState = 'Pending' | 'Starting' | 'Live' | 'Settled' | 'Failed' | 'Cancelled';
export const ENDED_STATES: ReadonlySet<ChildRunState> = new Set(['Settled', 'Failed', 'Cancelled']);

export type FailureKind = 'timeout' | 'crashed' | 'error' | 'skill_mismatch';
export type ResultStatus = 'completed' | 'truncated' | 'failed' | 'cancelled';

/** A measure the driver could not report. It is never written as zero. */
export interface Unavailable {
  unavailable: string;
}
export type Measure = number | Unavailable;

export function isUnavailable(value: unknown): value is Unavailable {
  return typeof value === 'object' && value !== null && 'unavailable' in value;
}

export interface SessionUsage {
  inputTokens: Measure;
  outputTokens: Measure;
  cacheReadTokens: Measure;
  cacheWriteTokens: Measure;
  totalTokens: Measure;
  cost: Measure;
  /** Context use at settle, not its peak. */
  contextTokens: Measure;
  contextWindow: Measure;
  contextPercent: Measure;
}

export function unavailableUsage(reason: string): SessionUsage {
  const u: Unavailable = { unavailable: reason };
  return {
    inputTokens: u,
    outputTokens: u,
    cacheReadTokens: u,
    cacheWriteTokens: u,
    totalTokens: u,
    cost: u,
    contextTokens: u,
    contextWindow: u,
    contextPercent: u,
  };
}

/** How a driver started a child run, without its prompt and never with env values. */
export interface LaunchSpec {
  /** The command as one opaque list. TaskCore never reads into it. */
  command: string[];
  cwd: string;
  envNames: string[];
  version: string | Unavailable;
  skillFolders: string[];
  thinkingLevel: string | Unavailable;
}

export type DomainEvent =
  | { kind: 'run_started'; launchSpec: LaunchSpec }
  | { kind: 'skills_verified'; skills: string[] }
  | { kind: 'tool_activity'; phase: 'start' | 'end'; tool: string; path?: string; isError?: boolean }
  | { kind: 'agent_message'; text: string }
  | { kind: 'turn_settled' }
  | { kind: 'retrying'; attempt?: number }
  | { kind: 'warning'; message: string }
  | { kind: 'stderr_tail'; text: string }
  | { kind: 'run_exited'; code: number | null; signal: string | null };

export type DomainEventKind = DomainEvent['kind'];

/** The one bounded answer a task returns. The task id always comes first. */
export interface Result {
  taskId: string;
  agent: string;
  status: ResultStatus;
  summary?: string;
  usage?: SessionUsage;
  failureKind?: FailureKind;
  message?: string;
  durationMs?: number;
}

/** What a child driver reports when a child run ends. */
export interface ChildOutcome {
  lastAssistantText: string | null;
  status: ResultStatus;
  failureKind?: FailureKind;
  message?: string;
  usage: SessionUsage;
  /** Where the driver keeps the child session, when it knows. */
  sessionFile?: string;
}

/**
 * What a child driver receives on each start. It resolves none of these itself
 * and reads no task record.
 */
export interface ChildRunRequest {
  taskId: string;
  agent: AgentDefinition;
  brief: string;
  projectRoot: string;
  /** Where TaskStore keeps child sessions. */
  sessionsFolder: string;
  /** Where the driver keeps its own files of the task, beside the task record. */
  driverFilesFolder: string;
}

export interface ChildRun {
  outcome: Promise<ChildOutcome>;
  cancel(): void;
}

/** The child port: the only way TaskCore reaches a child. */
export interface ChildPort {
  start(request: ChildRunRequest, onEvent: (event: DomainEvent) => void): ChildRun;
}

/** Builds the command that reopens a child session in its program's terminal interface. */
export type AttachCommand = (spec: LaunchSpec) => string[];

/** Writes a child session as a document a person can read; rejects with the reason. */
export type SessionExport = (sessionFile: string, outputFile: string) => Promise<void>;

/** The tool lists that suit a general agent and a read-only fallback agent on one host. */
export interface StarterTools {
  general: string[];
  fallback: string[];
}

/**
 * A child driver: its child port, and whatever else it offers. A caller asks for
 * the attach command, session export and starter tools through the driver of the
 * host, and never assumes a driver offers them.
 */
export interface ChildDriver {
  port: ChildPort;
  attachCommand?: AttachCommand;
  sessionExport?: SessionExport;
  starterTools?: () => StarterTools;
}
