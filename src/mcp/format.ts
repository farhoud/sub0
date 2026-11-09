// @sigil implements design/mcp-server.sigil McpServer (bounded tool results, status line)
//
// The one owner of the wording of a task's state: every reply that tells a parent
// whether a child has started comes through formatStatusLine.
import { isUnavailable, type Measure, type Result, type SessionUsage } from '../core/types.js';
import type { CollectReply, DelegateReply, TaskListing } from '../service/delegation-service.js';
import { formatElapsed } from './progress.js';

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

/** What a reader knows of a task that has no result yet. */
export type StatusFacts =
  | { state: 'queued'; endpoint?: string; place?: number; enqueuedAt: string }
  | { state: 'running'; startedAt: string };

/** A task with a start time is running; a task without one has not launched, whatever its stored status says. */
export function statusFacts(task: { startedAt?: string; endpoint?: string; queuePlace?: number; createdAt: string }): StatusFacts {
  if (task.startedAt !== undefined) return { state: 'running', startedAt: task.startedAt };
  return {
    state: 'queued',
    ...(task.endpoint !== undefined ? { endpoint: task.endpoint } : {}),
    ...(task.queuePlace !== undefined ? { place: task.queuePlace } : {}),
    enqueuedAt: task.createdAt,
  };
}

/** The status line of a task with no result: queued with its place and wait, or running with its start time. */
export function formatStatusLine(facts: StatusFacts, now = Date.now()): string {
  if (facts.state === 'running') {
    return `running, started ${facts.startedAt} (${formatElapsed(now - Date.parse(facts.startedAt))} ago)`;
  }
  const waiting = formatElapsed(now - Date.parse(facts.enqueuedAt));
  const endpoint = facts.endpoint ?? 'unknown';
  const where =
    facts.place !== undefined
      ? `place ${facts.place} in this session's queue, waiting ${waiting}`
      : `in another session's queue, waiting ${waiting}`;
  return `queued, not launched yet: no child is running; it starts when endpoint ${endpoint} has room (${where})`;
}

/** The status line of a reply that carries no result, or undefined for the other kinds of reply. */
function replyStatusLine(reply: DelegateReply | CollectReply, now: number): string | undefined {
  switch (reply.kind) {
    case 'started':
    case 'running':
      return formatStatusLine({ state: 'running', startedAt: reply.startedAt }, now);
    case 'queued':
      return formatStatusLine(
        { state: 'queued', endpoint: reply.endpoint, ...(reply.place !== undefined ? { place: reply.place } : {}), enqueuedAt: reply.enqueuedAt },
        now,
      );
    case 'other_process':
      return formatStatusLine(
        statusFacts({
          ...(reply.startedAt !== undefined ? { startedAt: reply.startedAt } : {}),
          ...(reply.endpoint !== undefined ? { endpoint: reply.endpoint } : {}),
          createdAt: reply.enqueuedAt,
        }),
        now,
      );
    default:
      return undefined;
  }
}

/** One reply of delegate, tasks, await or cancel about one task, with the task id first. */
export function describeReply(reply: DelegateReply | CollectReply, view?: { agent: string; createdAt: string }, now = Date.now()): string {
  if (reply.kind === 'result') return formatResult(reply.result);
  const id = `task: ${reply.taskId}`;
  const lead = view !== undefined ? `${id} · ${view.agent}` : id;
  const line = replyStatusLine(reply, now);
  switch (reply.kind) {
    case 'started':
    case 'queued':
      return `${lead} · ${line}; collect it with await or cancel it with cancel`;
    case 'running':
      return `${lead} · ${line}`;
    case 'other_process':
      return `${lead} · ${line}; it belongs to another process, so it cannot be collected or cancelled here`;
    case 'abandoned':
      return `${lead} · abandoned: its owner process died, so it has no result`;
    case 'not_found':
      return `${id} · no such task`;
  }
}

/** The row of a listing: queued or running by its status line, anything else by its stored status. */
function listingStatus(t: TaskListing, now: number): string {
  return t.status === 'running' ? formatStatusLine(statusFacts(t), now) : t.status;
}

/**
 * At most 50 tasks: those with a start time and no result first, then each queued
 * task, then the rest, newest first, with a closing notice.
 */
export function formatListing(tasks: TaskListing[], conversationKnown: boolean, now = Date.now()): string {
  const rank = (t: TaskListing) => (t.status !== 'running' ? 2 : t.startedAt !== undefined ? 0 : 1);
  const ordered = [...tasks].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    // Queued tasks keep their order of arrival; the others read newest first.
    return rank(a) === 1 ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt);
  });
  const shown = ordered.slice(0, LISTING_CAP);
  const left = ordered.length - shown.length;
  const lines: string[] = [];
  if (!conversationKnown) lines.push('subzero could not identify this conversation, so this lists every task.');
  if (shown.length === 0) lines.push('no tasks');
  for (const t of shown) lines.push(`${t.taskId} · ${t.agent} · ${listingStatus(t, now)} · created ${t.createdAt}`);
  lines.push(`${left} ${left === 1 ? 'task was' : 'tasks were'} left out; any task can still be read by its task id with tasks(task).`);
  return bound(lines.join('\n'));
}
