// @sigil implements design/agent-config.sigil AgentConfig
//
// Loads .agents/subzero.yaml under a project root that the caller hands over, and
// resolves that project root for DelegationService. Nothing here is cached: every
// call reads the agent file again.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const AGENT_FILE = path.join('.agents', 'subzero.yaml');

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface SkillRef {
  name: string;
  /** Absolute path, resolved against the directory of the agent file. May not exist. */
  folder: string;
}

export interface AgentDefinition {
  name: string;
  description: string;
  host: 'pi';
  model: string;
  thinking: ThinkingLevel;
  skills: SkillRef[];
  tools: string[];
  /** Seconds from spawn to settlement; time spent Pending does not count. */
  timeout: number;
  /** The part of the model before its first slash. */
  endpoint: string;
  /** Most child runs one process runs at once on the endpoint, or null for no limit. */
  parallel: number | null;
}

export interface AgentCatalog {
  agentFile: string;
  agents: Map<string, AgentDefinition>;
}

export class LoadError extends Error {
  readonly code = 'load_error';
  constructor(message: string) {
    super(message);
    this.name = 'LoadError';
  }
}

export class UnknownAgentError extends Error {
  readonly code = 'unknown_agent';
  constructor(
    readonly agent: string,
    readonly configured: string[],
  ) {
    const list = configured.length > 0 ? configured.join(', ') : '(none)';
    super(`unknown agent "${agent}"; configured agents: ${list}`);
    this.name = 'UnknownAgentError';
  }
}

export class UnresolvedRootError extends Error {
  readonly code = 'unresolved_root';
  constructor(detail?: string) {
    super(
      `subzero could not resolve the project root${detail ? ` (${detail})` : ''}. ` +
        'Set SUBZERO_PROJECT_DIR to the absolute path of the project.',
    );
    this.name = 'UnresolvedRootError';
  }
}

export function modelEndpoint(model: string): string {
  const slash = model.indexOf('/');
  return slash === -1 ? model : model.slice(0, slash);
}

const agentSchema = z.object({
  description: z.string().min(1, 'needs a description'),
  host: z.literal('pi'),
  model: z.string().min(1),
  thinking: z.enum(THINKING_LEVELS),
  skills: z.array(z.string().min(1)).default([]),
  tools: z.array(z.string().min(1)).min(1, 'needs at least one tool'),
  timeout: z.number().positive(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read and validate the agent file. One invalid entry fails the whole load. */
export function loadAgentFile(projectRoot: string): AgentCatalog {
  const agentFile = path.join(projectRoot, AGENT_FILE);
  let text: string;
  try {
    text = readFileSync(agentFile, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new LoadError(`agent file is missing: ${agentFile}`);
    throw new LoadError(`agent file is unreadable: ${agentFile} (${code ?? String(err)})`);
  }

  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    throw new LoadError(`agent file is malformed: ${agentFile}: ${(err as Error).message}`);
  }
  if (!isRecord(doc) || !isRecord(doc.agents)) {
    throw new LoadError(`agent file is malformed: ${agentFile}: expected an "agents" map`);
  }
  const skillsMap = doc.skills ?? {};
  const endpointsMap = doc.endpoints ?? {};
  if (!isRecord(skillsMap)) throw new LoadError(`agent file is malformed: ${agentFile}: "skills" must be a map`);
  if (!isRecord(endpointsMap)) throw new LoadError(`agent file is malformed: ${agentFile}: "endpoints" must be a map`);

  const baseDir = path.dirname(agentFile);
  const skillFolders = new Map<string, string>();
  for (const [name, value] of Object.entries(skillsMap)) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new LoadError(`skill "${name}" must map to a folder path`);
    }
    skillFolders.set(name, path.resolve(baseDir, value));
  }

  const limits = new Map<string, number>();
  for (const [endpoint, entry] of Object.entries(endpointsMap)) {
    const parallel = isRecord(entry) ? entry.parallel : undefined;
    if (typeof parallel !== 'number' || !Number.isInteger(parallel) || parallel < 1) {
      throw new LoadError(`endpoint "${endpoint}": parallel must be a positive whole number`);
    }
    limits.set(endpoint, parallel);
  }

  const agents = new Map<string, AgentDefinition>();
  for (const [name, raw] of Object.entries(doc.agents)) {
    agents.set(name, validateAgent(name, raw, skillFolders, limits));
  }

  const used = new Set([...agents.values()].map((a) => a.endpoint));
  for (const endpoint of limits.keys()) {
    if (!used.has(endpoint)) {
      throw new LoadError(`endpoint "${endpoint}": no agent definition belongs to it`);
    }
  }

  return { agentFile, agents };
}

function validateAgent(
  name: string,
  raw: unknown,
  skillFolders: Map<string, string>,
  limits: Map<string, number>,
): AgentDefinition {
  if (!isRecord(raw)) throw new LoadError(`agent "${name}": must be a map`);
  if (raw.host !== 'pi') {
    throw new LoadError(`agent "${name}": host must be pi (got ${JSON.stringify(raw.host ?? null)})`);
  }
  if (raw.model === undefined || raw.model === null || raw.model === '') {
    throw new LoadError(`agent "${name}": host pi requires a model`);
  }
  if (raw.timeout === undefined || raw.timeout === null) {
    throw new LoadError(`agent "${name}": timeout is required (seconds)`);
  }
  if (typeof raw.timeout !== 'number' || !(raw.timeout > 0)) {
    throw new LoadError(`agent "${name}": timeout must be a positive number of seconds`);
  }

  const parsed = agentSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') || 'entry';
    throw new LoadError(`agent "${name}": ${where}: ${issue?.message ?? 'invalid'}`);
  }
  const def = parsed.data;

  const skills: SkillRef[] = def.skills.map((skill) => {
    const folder = skillFolders.get(skill);
    if (folder === undefined) {
      throw new LoadError(`agent "${name}": skill "${skill}" is not in the skills map`);
    }
    return { name: skill, folder };
  });

  const endpoint = modelEndpoint(def.model);
  return {
    name,
    description: def.description,
    host: 'pi',
    model: def.model,
    thinking: def.thinking,
    skills,
    tools: def.tools,
    timeout: def.timeout,
    endpoint,
    parallel: limits.get(endpoint) ?? null,
  };
}

/** Look up one agent definition, reading the agent file again. */
export function getAgent(projectRoot: string, name: string): AgentDefinition {
  const { agents } = loadAgentFile(projectRoot);
  const agent = agents.get(name);
  if (agent === undefined) throw new UnknownAgentError(name, [...agents.keys()]);
  return agent;
}

export function listAgentNames(projectRoot: string): string[] {
  return [...loadAgentFile(projectRoot).agents.keys()];
}

export interface RootSources {
  env?: NodeJS.ProcessEnv;
  /** Roots the parent adapter reports, as file URIs or absolute paths. */
  roots?: () => Promise<string[]> | string[];
  /** Working directory of a command line process. The server never passes one. */
  cwd?: string;
}

/**
 * Resolve the project root from SUBZERO_PROJECT_DIR, then the first reported root,
 * then the command line working directory. Returns an UnresolvedRootError instead
 * of throwing so that the caller can keep trying on later calls.
 */
export async function resolveProjectRoot(sources: RootSources): Promise<string | UnresolvedRootError> {
  const fromEnv = sources.env?.SUBZERO_PROJECT_DIR;
  if (fromEnv !== undefined && fromEnv !== '') {
    return canonicalDir(fromEnv, 'SUBZERO_PROJECT_DIR');
  }

  if (sources.roots) {
    let reported: string[] = [];
    try {
      reported = await sources.roots();
    } catch {
      reported = [];
    }
    const first = reported[0];
    if (first !== undefined) {
      const dir = first.startsWith('file:') ? fileURLToPath(first) : first;
      return canonicalDir(dir, 'the first root reported by the parent');
    }
  }

  if (sources.cwd !== undefined) return canonicalDir(sources.cwd, 'the working directory');
  return new UnresolvedRootError('SUBZERO_PROJECT_DIR is unset and the parent reported no root');
}

function canonicalDir(dir: string, source: string): string | UnresolvedRootError {
  if (!path.isAbsolute(dir)) return new UnresolvedRootError(`${source} is not absolute: ${dir}`);
  try {
    const real = realpathSync(dir);
    if (!statSync(real).isDirectory()) return new UnresolvedRootError(`${source} is not a directory: ${dir}`);
    return real;
  } catch {
    return new UnresolvedRootError(`${source} does not exist: ${dir}`);
  }
}
