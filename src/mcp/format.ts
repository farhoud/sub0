// @sigil implements design/mcp-server.sigil McpServer (bounded tool results, listing)
//
// What is specific to the MCP tool replies: the bound, the equal share of an await
// reply and the listing cap. The wording of a task's state comes from the service.
import type { CollectReply, DelegateReply, TaskListing } from '../service/delegation-service.js';
import { formatResult, formatStatusLine, listingStatus, statusFacts, withNotice } from '../service/status-text.js';

/** No tool result may exceed this, whatever it holds. */
export const TOOL_RESULT_LIMIT = 12_000;
export const LISTING_CAP = 50;

export function bound(text: string): string {
  return text.length <= TOOL_RESULT_LIMIT ? text : `${text.slice(0, TOOL_RESULT_LIMIT - 40)}\n[subzero: output bounded]`;
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
  return withNotice(describeOne(reply, view, now), 'notice' in reply ? reply.notice : undefined);
}

/**
 * One section of an await reply, cut to its share of the tool result limit. A cut
 * section ends with the way to read the whole result.
 */
export function describeShare(reply: CollectReply, share: number, now = Date.now()): string {
  const full = describeReply(reply, undefined, now);
  if (full.length <= share) return full;
  const id = reply.kind === 'result' ? reply.result.taskId : reply.taskId;
  const pointer = `\n[cut; whole result: tasks(${id})]`;
  return full.slice(0, Math.max(0, share - pointer.length)) + pointer;
}

/** The equal share of the tool result limit of each of `count` sections joined by a blank line. */
export function sectionShare(count: number): number {
  return Math.floor((TOOL_RESULT_LIMIT - 2 * (count - 1)) / count);
}

function describeOne(reply: DelegateReply | CollectReply, view: { agent: string; createdAt: string } | undefined, now: number): string {
  if (reply.kind === 'result') return bound(formatResult(reply.result));
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
