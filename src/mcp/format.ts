// @sigil implements design/mcp-server.sigil McpServer (bounded tool results)
import { isUnavailable, type Measure, type Result, type SessionUsage } from '../core/types.js';
import type { TaskView } from '../store/task-store.js';

/** No tool result may exceed this, whatever it holds. */
export const TOOL_RESULT_LIMIT = 12_000;
export const LISTING_CAP = 50;

export function bound(text: string): string {
  return text.length <= TOOL_RESULT_LIMIT ? text : `${text.slice(0, TOOL_RESULT_LIMIT - 40)}\n[subzero: output bounded]`;
}

function show(value: Measure, digits = 0): string {
  if (isUnavailable(value)) return 'unavailable';
  return digits > 0 ? value.toFixed(digits) : String(value);
}

export function formatUsage(usage: SessionUsage): string {
  return [
    `tokens ${show(usage.totalTokens)} (in ${show(usage.inputTokens)}, out ${show(usage.outputTokens)})`,
    `cost ${show(usage.cost, 4)}`,
    `context at settle ${show(usage.contextTokens)}/${show(usage.contextWindow)}`,
  ].join(' · ');
}

/** The task id comes first so it survives compaction of the parent's history. */
export function formatResult(result: Result): string {
  const head = [`task: ${result.taskId}`, result.agent, `status: ${result.status}`];
  if (result.failureKind !== undefined) head.push(`failure: ${result.failureKind}`);
  const lines = [head.join(' · ')];
  if (result.message !== undefined) lines.push(`message: ${result.message}`);
  if (result.summary !== undefined) lines.push('summary:', result.summary === '' ? '(empty)' : result.summary);
  if (result.usage !== undefined) {
    const duration = result.durationMs !== undefined ? ` · duration ${Math.round(result.durationMs / 1000)}s` : '';
    lines.push(`usage: ${formatUsage(result.usage)}${duration}`);
  }
  return bound(lines.join('\n'));
}

/** At most 50 tasks, running first and then newest first, with a closing notice. */
export function formatListing(tasks: TaskView[], conversationKnown: boolean): string {
  const ordered = [...tasks].sort((a, b) => {
    const running = Number(b.status === 'running') - Number(a.status === 'running');
    return running !== 0 ? running : b.createdAt.localeCompare(a.createdAt);
  });
  const shown = ordered.slice(0, LISTING_CAP);
  const left = ordered.length - shown.length;
  const lines: string[] = [];
  if (!conversationKnown) lines.push('subzero could not identify this conversation, so this lists every task.');
  if (shown.length === 0) lines.push('no tasks');
  for (const t of shown) lines.push(`${t.taskId} · ${t.agent} · ${t.status} · created ${t.createdAt}`);
  lines.push(`${left} ${left === 1 ? 'task was' : 'tasks were'} left out; any task can still be read by its task id with tasks(task).`);
  return bound(lines.join('\n'));
}
