// @sigil implements design/spike-harness.sigil SpikeHarness (read-only sigil imports)
//
// The sigil repository is read-only. Its fixture, preflight, design view and
// evidence validation are imported by path from $SIGIL_REPO; nothing here writes
// into it.
import { existsSync } from "node:fs";
import { join } from "node:path";

export const SIGIL_REPO = Deno.env.get("SIGIL_REPO") ?? join(Deno.env.get("HOME") ?? "", "Workspace", "sigil");

export const FIXTURE_ROOT = join(SIGIL_REPO, "scripts/slotted-benchmark/fixtures/slotted-planted");

/** The skills a pass stages side by side under skills/. */
export const STAGED_SKILLS = ["sigil-evaluate", "sigil-compute-design", "sigil-understand", "sigil-egglog"];

/** The pinned sigilc: $SIGILC, else the release build, else the debug build of the repository. */
export function sigilcPath(): string {
  const pinned = Deno.env.get("SIGILC");
  if (pinned) return pinned;
  for (const build of ["release", "debug"]) {
    const candidate = join(SIGIL_REPO, `packages/sigilc/target/${build}/sigilc`);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`no built sigilc under ${SIGIL_REPO}; build it or set SIGILC`);
}

export type JsonObject = Record<string, unknown>;

/** One planted problem resolved against this design view (sigil's IssuePreflight). */
export interface IssuePreflight {
  readonly id: string;
  readonly status: "scorable" | "drift";
  readonly reason: string | null;
  readonly facets: readonly string[];
  readonly findingClass: string;
  readonly laws: readonly string[];
  readonly findingEvidence: {
    readonly subject: string;
    readonly object: string;
    readonly eitherDirection?: true;
  };
  readonly anchors: readonly { readonly source: string; readonly section: string; readonly text: string }[];
  readonly implementation?: unknown;
}

export interface LinkedValidation {
  readonly valid: boolean;
  readonly state: string | null;
  readonly errors: readonly string[];
}

interface SigilModules {
  SLOTTED_FIXTURE: { version: number; issues: readonly { id: string }[] };
  designViewFromTrees(output: unknown, texts: Record<string, string>): unknown;
  preflightSlottedFixture(design: unknown): {
    canSchedule: boolean;
    sourceDrift: readonly string[];
    issues: readonly IssuePreflight[];
  };
  validateLinkedEvidence(input: {
    privateStore: string;
    exitCode: number;
    workspaceDigest: string | null;
    guidanceFingerprint: string;
    vocabularyGeneration: unknown;
    memoKeys: readonly string[];
    result: JsonObject;
    report: JsonObject;
    context: JsonObject;
  }): LinkedValidation;
  parseHandbackState(text: string): string | null;
  copyTree(from: string, to: string, skip: Set<string>): Promise<void>;
  copySkill(from: string, to: string): Promise<void>;
}

let loaded: SigilModules | null = null;

export async function sigil(): Promise<SigilModules> {
  if (loaded) return loaded;
  const base = `file://${SIGIL_REPO}/scripts`;
  const [fixture, claims, agents, files] = await Promise.all([
    import(`${base}/slotted-benchmark/fixture.ts`),
    import(`${base}/slotted-benchmark/claims.ts`),
    import(`${base}/slotted-benchmark/agents.ts`),
    import(`${base}/agent-runner/files.ts`),
  ]);
  loaded = {
    SLOTTED_FIXTURE: fixture.SLOTTED_FIXTURE,
    designViewFromTrees: fixture.designViewFromTrees,
    preflightSlottedFixture: fixture.preflightSlottedFixture,
    validateLinkedEvidence: claims.validateLinkedEvidence,
    parseHandbackState: agents.parseHandbackState,
    copyTree: files.copyTree,
    copySkill: files.copySkill,
  };
  return loaded;
}
