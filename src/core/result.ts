// @sigil implements design/task-core.sigil TaskCore (result budget)

/** The result budget is fixed: an agent definition has no field for another value. */
export const RESULT_BUDGET_TOKENS = 2000;

/** Estimate, not a tokenizer: about four characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Room kept for the closing fence and the marker so the cut summary stays in budget.
const MARKER_RESERVE_TOKENS = 60;
const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Cut a summary over the budget: keep its head at a line boundary, close an open
 * code fence, and end with a marker that names the omitted amount and points to
 * subzero show. A summary within the budget, including an empty one, is unchanged.
 */
export function cutSummary(text: string, taskId: string, budget = RESULT_BUDGET_TOKENS): string {
  if (estimateTokens(text) <= budget) return text;

  const limit = Math.max(0, (budget - MARKER_RESERVE_TOKENS) * 4);
  let head = text.slice(0, limit);
  const lastBreak = head.lastIndexOf('\n');
  if (lastBreak > 0) head = head.slice(0, lastBreak);

  let fence: string | null = null;
  for (const line of head.split('\n')) {
    const match = FENCE.exec(line);
    if (!match) continue;
    const [, run, rest] = match as unknown as [string, string, string];
    if (fence === null) fence = run;
    // A bare run of the same character, at least as long, closes the fence.
    else if (run[0] === fence[0] && run.length >= fence.length && rest.trim() === '') fence = null;
  }
  if (fence !== null) head += `\n${fence}`;

  const omitted = Math.max(1, estimateTokens(text) - estimateTokens(head));
  return (
    `${head}\n\n[subzero: summary cut, about ${omitted} tokens omitted; ` +
    `run "subzero show ${taskId}" for the full text]`
  );
}
