// @sigil implements design/spike-harness.sigil SpikeHarness (experiment arms)
//
// Each arm's agents come from the SigilWiring files in examples/sigil/agents, so
// the harness runs exactly what a person would copy into .claude/agents.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "npm:yaml@2.9.1";
import type { Arm } from "./types.ts";

export const SUBZERO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
export const WIRING = join(SUBZERO_ROOT, "examples", "sigil");

export interface ArmSpec {
  arm: Arm;
  evaluator: string;
  /** The Claude interpreter subagent of an A arm. */
  interpreter: string | null;
  /** B arms delegate interpreters to subzero and load its plugin. */
  delegates: boolean;
}

export const ARM_SPECS: Record<Arm, ArmSpec> = {
  "A": { arm: "A", evaluator: "evaluator-a.md", interpreter: "interpreter-a.md", delegates: false },
  "A-cheap": { arm: "A-cheap", evaluator: "evaluator-a-cheap.md", interpreter: "interpreter-a-cheap.md", delegates: false },
  "B": { arm: "B", evaluator: "evaluator-b.md", interpreter: null, delegates: true },
  "B-control": { arm: "B-control", evaluator: "evaluator-b-control.md", interpreter: null, delegates: true },
  "B-low": { arm: "B-low", evaluator: "evaluator-b-low.md", interpreter: null, delegates: true },
};

/** Three matched passes of A and B, then one each of B-low, A-cheap and B-control. */
export const MATRIX: Arm[] = ["A", "B", "A", "B", "A", "B", "B-low", "A-cheap", "B-control"];

interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  effort?: string;
}

function list(value: unknown): string[] | undefined {
  if (typeof value !== "string") return Array.isArray(value) ? value.map(String) : undefined;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Read a Claude agent file: YAML frontmatter, then the prompt. */
export function readAgentFile(file: string): { name: string; definition: AgentDefinition } {
  const text = readFileSync(join(WIRING, "agents", file), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${file} has no frontmatter`);
  const front = parseYaml(match[1]) as Record<string, unknown>;
  const tools = list(front.tools);
  const disallowed = list(front.disallowedTools);
  return {
    name: String(front.name),
    definition: {
      description: String(front.description),
      prompt: match[2].trim(),
      ...(tools ? { tools } : {}),
      ...(disallowed ? { disallowedTools: disallowed } : {}),
      ...(typeof front.model === "string" ? { model: front.model } : {}),
    },
  };
}

/**
 * The --agents JSON of an arm. The evaluator runs at the same effort in every
 * arm, and so do A's interpreters, as sigil's own Claude host sets it per child.
 */
export function agentsJson(spec: ArmSpec, effort: string | null): Record<string, AgentDefinition> {
  const evaluator = readAgentFile(spec.evaluator);
  const agents: Record<string, AgentDefinition> = {
    [evaluator.name]: { ...evaluator.definition, ...(effort ? { effort } : {}) },
  };
  if (spec.interpreter) {
    const interpreter = readAgentFile(spec.interpreter);
    agents[interpreter.name] = { ...interpreter.definition, ...(effort ? { effort } : {}) };
  }
  return agents;
}

const SHELL = ["sigilc", "sigil", "mkdir", "cp", "mv", "ls", "cat", "test", "cmp"];

/**
 * dontAsk with an explicit allow-list: anything unlisted is denied, never prompted.
 * The sigil tools are allowed by bare name, ./bin and the pass's absolute bin
 * folder: an evaluator denied one spelling may give up rather than try another.
 */
export function allowList(spec: ArmSpec, bin: string): string[] {
  const shell = SHELL.flatMap((p) =>
    p === "ls"
      ? ["Bash(ls)", "Bash(ls *)"]
      : p === "sigilc" || p === "sigil"
      ? [`Bash(${p} *)`, `Bash(./bin/${p} *)`, `Bash(${bin}/${p} *)`]
      : [`Bash(${p} *)`]
  );
  // The main conversation starts the evaluator with the Agent tool in every arm;
  // the B evaluators disallow it for themselves in their own definitions.
  return [
    ...shell,
    "Read",
    "Write",
    "Glob",
    "Grep",
    "Agent",
    ...(spec.delegates ? ["mcp__plugin_subzero_subzero__*"] : []),
  ];
}

export const MAIN_PROMPT = [
  "Have the sigil-evaluator subagent review the Sigil design in this directory.",
  "Do not read the design, the skills or any sigil reference yourself, and do not load any skill.",
  "When the subagent finishes, repeat its final report verbatim, including its last line.",
].join(" ");
