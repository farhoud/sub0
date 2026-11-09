// @sigil implements design/spike-harness.sigil SpikeHarness (pass directory)
//
// A fresh pass directory per run: root (the planted fixture with no claims
// store), an empty private claims store, run, the staged sigil skills, bin and
// .agents/subzero.yaml. It is Claude's working directory and the project root.
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WIRING } from "./arms.ts";
import { FIXTURE_ROOT, SIGIL_REPO, sigil, STAGED_SKILLS } from "./sigil.ts";

export interface PassLayout {
  passDir: string;
  root: string;
  store: string;
  run: string;
  bin: string;
  evidence: string;
  /** The model the B-control interpreter was staged with. */
  controlModel: string;
}

/** The pi model of A's Claude interpreters, which inherit the evaluator's model. */
export function piClaudeModel(claudeModel: string): string {
  return claudeModel.includes("/") ? claudeModel : `anthropic/${claudeModel}`;
}

export async function stagePass(outDir: string, claudeModel: string, sigilc: string): Promise<PassLayout> {
  const { copyTree, copySkill } = await sigil();
  const passDir = join(outDir, "pass");
  const evidence = join(outDir, "evidence");
  if (existsSync(passDir)) throw new Error(`pass directory already exists: ${passDir}`);
  mkdirSync(evidence, { recursive: true });

  const root = join(passDir, "root");
  await copyTree(FIXTURE_ROOT, root, new Set([".sigil/claims"]));
  if (!existsSync(join(root, ".sigil", "config.json"))) throw new Error("staged root lacks .sigil/config.json");
  if (existsSync(join(root, ".sigil", "claims"))) throw new Error("staged root holds a claims store");
  const store = join(passDir, "store");
  const run = join(passDir, "run");
  mkdirSync(store);
  mkdirSync(run);

  for (const name of STAGED_SKILLS) await copySkill(join(SIGIL_REPO, "skills", name), join(passDir, "skills", name));

  // B-control's interpreter must run on the Claude model of A's interpreters,
  // which is this pass's evaluator model; the staged copy sets the model of the
  // control tier to it.
  const controlModel = piClaudeModel(claudeModel);
  const yaml = readFileSync(join(WIRING, ".agents", "subzero.yaml"), "utf8").replace(
    /(\n    control:[\s\S]*?model: )\S+/,
    `$1${controlModel}`,
  );
  mkdirSync(join(passDir, ".agents"));
  writeFileSync(join(passDir, ".agents", "subzero.yaml"), yaml);

  const bin = join(passDir, "bin");
  mkdirSync(bin);
  symlinkSync(sigilc, join(bin, "sigilc"));
  const sigilCli = Deno.env.get("SIGIL") ?? join(Deno.env.get("HOME") ?? "", ".deno", "bin", "sigil");
  if (existsSync(sigilCli)) symlinkSync(sigilCli, join(bin, "sigil"));

  return { passDir, root, store, run, bin, evidence, controlModel };
}
