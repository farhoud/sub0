// @sigil implements design/spike-harness.sigil SpikeHarness (measurement row)

/** A measure that could not be taken. It stays unavailable with its reason, never zero. */
export interface Unavailable {
  unavailable: string;
}
export type Measure = number | Unavailable;

export function isUnavailable(value: unknown): value is Unavailable {
  return typeof value === "object" && value !== null && "unavailable" in value;
}

export interface TokenUsage {
  input: Measure;
  cacheRead: Measure;
  cacheWrite: Measure;
  output: Measure;
  total: Measure;
}

export function unavailableTokens(reason: string): TokenUsage {
  const u = { unavailable: reason };
  return { input: u, cacheRead: u, cacheWrite: u, output: u, total: u };
}

export const ARMS = ["A", "A-cheap", "B", "B-control", "B-low"] as const;
export type Arm = (typeof ARMS)[number];

export type PlantedOutcome = "found" | "missed" | "n/a" | "unscored";

export interface StrayWrite {
  interpreter: string;
  path: string;
  intoClaimsStore: boolean;
}

/** One row per pass, kept whether the pass completed or failed. */
export interface MeasurementRow {
  pass: string;
  arm: Arm;
  startedAt: string;
  status: "completed" | "failed";
  failure: string | null;
  /** The workspace digest of the planted fixture the pass ran on. */
  designRevision: string;
  claudeModel: string;
  effort: string | null;
  planted: Record<string, PlantedOutcome>;
  extraFindings: Measure;
  ingestState: string | Unavailable;
  checkErrors: string[];
  handbackState: string | null;
  reAsks: Measure;
  unreadUnits: Measure;
  tokens: { main: TokenUsage; evaluator: TokenUsage; interpreters: TokenUsage };
  wallTimeMs: number;
  /** Per interpreter run, at settle; not a peak. */
  interpreterContextAtSettle: Measure[];
  /** The thinking level each pi interpreter's launch spec declares. */
  thinkingLevels: (string | Unavailable)[];
  interpreterRuns: { viaSubzero: number; viaAgentTool: number };
  /** The models each part actually ran on, as Claude Code and pi recorded them. */
  observedModels: { main: string[]; evaluator: string[]; interpreters: string[] };
  /** Subagents of another type than the evaluator and interpreters, kept apart and flagged. */
  otherSubagents: { agentType: string; tokens: TokenUsage }[];
  strayWrites: StrayWrite[];
  /** Interpreters whose writes could not be read, each with the reason. */
  writesUnchecked: string[];
  /** A write into the pass's claims store makes the score untrustworthy. */
  untrustworthy: boolean;
  mainConversationClean: boolean | Unavailable;
  passDir: string;
}
