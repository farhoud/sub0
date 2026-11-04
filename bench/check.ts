// @sigil implements design/spike-harness.sigil SpikeHarness (the harness's own check)
//
// The score comes from a sigilc check the harness runs itself on the pass, so it
// reflects what the interpreters read and not whether a write-back succeeded.
import { join } from "node:path";
import { type IssuePreflight, type JsonObject, type LinkedValidation, sigil } from "./sigil.ts";

export interface Expected {
  workspaceDigest: string;
  guidanceFingerprint: string;
  vocabularyGeneration: unknown;
}

export interface Preflight {
  issues: IssuePreflight[];
  expected: Expected;
}

export interface CheckOutcome {
  exitCode: number | null;
  result: JsonObject | null;
  report: JsonObject | null;
  context: JsonObject | null;
  validation: LinkedValidation | null;
  error: string | null;
}

async function run(sigilc: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const out = await new Deno.Command(sigilc, { args, stdout: "piped", stderr: "piped" }).output();
  const decode = (b: Uint8Array) => new TextDecoder().decode(b);
  return { code: out.code, stdout: decode(out.stdout), stderr: decode(out.stderr) };
}

/**
 * Resolve the answer key against the staged root, and learn the identities the
 * pass's check must report from a cold check on a throwaway store. Nothing here
 * writes into the pass's own store.
 */
export async function preflight(sigilc: string, root: string, scratch: string): Promise<Preflight> {
  const { designViewFromTrees, preflightSlottedFixture } = await sigil();
  const tree = await run(sigilc, ["tree", "--root", root, "--store", join(scratch, "tree-store")]);
  if (tree.code !== 0) throw new Error(`sigilc tree failed: ${tree.stderr}`);
  const trees = JSON.parse(tree.stdout) as { trees: { parse: { path: string } }[] };
  const texts: Record<string, string> = {};
  for (const t of trees.trees) texts[t.parse.path] = await Deno.readTextFile(join(root, t.parse.path));
  const fixture = preflightSlottedFixture(designViewFromTrees(trees, texts));
  if (!fixture.canSchedule) throw new Error(`Slotted source drift: ${fixture.sourceDrift.join("; ")}`);

  const cold = await run(sigilc, ["check", "--root", root, "--store", join(scratch, "cold-store")]);
  if (cold.code !== 0 && cold.code !== 1) throw new Error(`cold sigilc check failed: ${cold.stderr}`);
  const summary = JSON.parse(cold.stdout) as JsonObject;
  return {
    issues: [...fixture.issues],
    expected: {
      workspaceDigest: String(summary.workspaceDigest),
      guidanceFingerprint: String(summary.guidanceFingerprint),
      vocabularyGeneration: summary.vocabularyGeneration,
    },
  };
}

/** Run sigilc check on the pass's root and private store, and validate its evidence. */
export async function checkPass(sigilc: string, root: string, store: string, expected: Expected): Promise<CheckOutcome> {
  const none = (error: string, exitCode: number | null = null): CheckOutcome => ({
    exitCode,
    result: null,
    report: null,
    context: null,
    validation: null,
    error,
  });
  const checked = await run(sigilc, ["check", "--root", root, "--store", store]);
  if (checked.code !== 0 && checked.code !== 1) return none(checked.stderr.trim() || "check failed", checked.code);
  let result: JsonObject;
  try {
    result = JSON.parse(checked.stdout);
  } catch {
    return none("check returned no structured result", checked.code);
  }
  let report: JsonObject;
  let context: JsonObject;
  try {
    report = JSON.parse(await Deno.readTextFile(String(result.report)));
    context = JSON.parse(await Deno.readTextFile(String(result.judgmentContext)));
  } catch {
    return none("missing linked report or context", checked.code);
  }
  const memoKeys: string[] = [];
  try {
    for await (const entry of Deno.readDir(join(store, "claims", "interpretations"))) {
      if (entry.isFile && entry.name.endsWith(".json")) memoKeys.push(entry.name.slice(0, -5));
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  const { validateLinkedEvidence } = await sigil();
  const validation = validateLinkedEvidence({
    privateStore: store,
    exitCode: checked.code,
    workspaceDigest: expected.workspaceDigest,
    guidanceFingerprint: expected.guidanceFingerprint,
    vocabularyGeneration: expected.vocabularyGeneration,
    memoKeys: memoKeys.sort(),
    result,
    report,
    context,
  });
  return { exitCode: checked.code, result, report, context, validation, error: null };
}
