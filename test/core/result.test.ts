import { describe, expect, it } from 'vitest';
import { isTaskId, newTaskId } from '../../src/core/ids.js';
import { cutSummary, estimateTokens, RESULT_BUDGET_TOKENS } from '../../src/core/result.js';

describe('task id', () => {
  it('is sz- followed by six base32 characters', () => {
    for (let i = 0; i < 50; i++) expect(isTaskId(newTaskId())).toBe(true);
  });
});

describe('result budget', () => {
  const line = 'x'.repeat(79) + '\n';

  it('leaves a summary within the budget, and an empty one, unchanged', () => {
    expect(cutSummary('short', 'sz-aaaaaa')).toBe('short');
    expect(cutSummary('', 'sz-aaaaaa')).toBe('');
  });

  it('cuts at a line boundary with a marker that names the omitted amount and subzero show', () => {
    const text = line.repeat(400);
    const cut = cutSummary(text, 'sz-aaaaaa');
    expect(estimateTokens(cut)).toBeLessThanOrEqual(RESULT_BUDGET_TOKENS);
    const body = cut.slice(0, cut.indexOf('\n\n[subzero'));
    expect(body.split('\n').every((l) => l === 'x'.repeat(79))).toBe(true);
    expect(cut).toMatch(/about \d+ tokens omitted/);
    expect(cut).toContain('subzero show sz-aaaaaa');
  });

  it('does not let a ~~~ line close a ``` fence', () => {
    const text = '```md\n~~~\n' + line.repeat(400);
    const cut = cutSummary(text, 'sz-aaaaaa');
    expect(cut).toMatch(/\n```\n\n\[subzero/);
  });

  it('keeps a four-backtick fence open across an inner ```js line and closes it with four', () => {
    const text = '````md\n```js\n' + line.repeat(400);
    const cut = cutSummary(text, 'sz-aaaaaa');
    expect(cut).toMatch(/\n````\n\n\[subzero/);
  });

  it('closes an open code fence', () => {
    const text = 'intro\n```ts\n' + line.repeat(400) + '```\n';
    const cut = cutSummary(text, 'sz-aaaaaa');
    const fences = cut.split('\n').filter((l) => l.startsWith('```')).length;
    expect(fences % 2).toBe(0);
  });
});
