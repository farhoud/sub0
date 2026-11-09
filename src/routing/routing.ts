// @sigil implements design/routing-hooks.sigil RoutingHooks
//
// The routing logic the hook processes share: the alias table, the generic-spawn
// test and the routing text. It reaches the core only through AgentConfig and
// imports no child driver. Entry scripts stay thin; the logic is importable.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { AGENT_FILE, routableTiers, type RoutableTier } from '../config/agent-config.js';

/** The delegate tool as Claude Code names it for the plugin. */
export const DELEGATE_TOOL = 'mcp__plugin_subzero_subzero__delegate';
const AWAIT_TOOL = 'mcp__plugin_subzero_subzero__await';
/** The longest wait the await tool honours. */
const AWAIT_SECONDS = 600;
/** The description prefix that marks a pass-back (KTD17). */
export const PASSBACK_WORD = 'passback';

/** A tier word of compound-engineering, the model tier it maps to and how CE phrases it. */
interface TierWord {
  tier: 'small' | 'medium' | 'large';
  phrase: string;
}

export const TIER_WORDS: readonly TierWord[] = [
  { tier: 'small', phrase: 'cheapest capable' },
  { tier: 'medium', phrase: 'mid-tier' },
  { tier: 'large', phrase: 'session model' },
];

/** The model tier a spawn's model alias maps to; opus and fable map to none (KTD6). */
export function aliasTier(model: string | undefined): string | undefined {
  if (model === undefined) return 'large';
  if (model === 'haiku') return 'small';
  if (model === 'sonnet') return 'medium';
  return undefined;
}

export const DEFAULT_GENERIC_AGENTS: readonly string[] = ['general-purpose', 'claude'];

/** The fields of an Agent spawn that the hooks look at. */
export interface AgentSpawn {
  subagent_type?: string;
  model?: string;
  description?: string;
  prompt?: string;
  isolation?: string;
}

/** A spawn is generic when it names no agent type or one on the generic list. */
export function isGenericSpawn(spawn: AgentSpawn, genericAgents?: readonly string[]): boolean {
  const type = spawn.subagent_type;
  if (type === undefined || type === '') return true;
  return (genericAgents ?? DEFAULT_GENERIC_AGENTS).includes(type);
}

/** Keep the routable tiers that a tier word maps to, in tier-word order. */
export function wordTiers(tiers: RoutableTier[]): RoutableTier[] {
  return TIER_WORDS.flatMap(({ tier }) => tiers.filter((t) => t.tier === tier));
}

/** The text SessionStart adds to Claude's context for these routable, tier-word tiers. */
export function buildRoutingText(tiers: RoutableTier[]): string {
  const routed = new Map(tiers.map((t) => [t.tier, t]));
  const lines = [
    'subzero routing is on for this project.',
    `Some subagent work runs on other models through the ${DELEGATE_TOOL} tool instead of the Agent tool.`,
    'Compound-engineering names a model by tier word; send these tier words as follows:',
  ];
  for (const { tier, phrase } of TIER_WORDS) {
    const t = routed.get(tier);
    lines.push(
      t !== undefined
        ? `- ${phrase} (${tier}): ${DELEGATE_TOOL} with tier: "${tier}" (model ${t.model}, host ${t.host}).`
        : `- ${phrase} (${tier}): not configured here, stays on Claude with the Agent tool.`,
    );
  }
  lines.push(
    'Pass the subagent prompt unchanged as brief. A subagent spawn that asks for a fork or for worktree isolation stays on the Agent tool and is never sent to subzero.',
    `Dispatch every routed subagent with ${DELEGATE_TOOL}(tier, brief, wait: false) in one message. Then call ${AWAIT_TOOL} with tasks (every task id) and timeout_s: ${AWAIT_SECONDS}, and repeat it until every task is done.`,
    'A queued task has not launched yet: no child is running and it starts when its endpoint has room. A task\'s launch time is its `started` time; the time it waited does not count.',
    `If ${DELEGATE_TOOL} is refused or returns a tool error and made no task, pass that subagent back: call Agent with the same prompt and a short description that begins with \`${PASSBACK_WORD}\`. Once a task id came back the work stays with subzero, even if its result fails; never pass it back.`,
  );
  return lines.join('\n');
}

/** One line telling Claude that routing is off because the agent file does not load. */
export function buildWarning(detail: string): string {
  const flat = detail.replace(/\s+/g, ' ').trim().slice(0, 300);
  return `subzero routing is off: the agent file ${AGENT_FILE} does not load (${flat}). Every subagent runs on Claude until it is fixed.`;
}

/**
 * What SessionStart adds to Claude's context for a project, or undefined for nothing.
 * A missing agent file, no project root, no routable tier word and any error other
 * than a load error of an existing file all add nothing (R13, R18).
 */
export function routingContext(projectRoot: string | undefined): string | undefined {
  if (projectRoot === undefined) return undefined;
  try {
    if (!existsSync(path.join(projectRoot, AGENT_FILE))) return undefined;
    const tiers = wordTiers(routableTiers(projectRoot));
    return tiers.length === 0 ? undefined : buildRoutingText(tiers);
  } catch (err) {
    if ((err as { code?: unknown }).code === 'load_error') return buildWarning((err as Error).message);
    return undefined;
  }
}
