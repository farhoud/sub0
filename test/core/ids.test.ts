import { describe, expect, it } from 'vitest';
import { isTaskId, newTaskId } from '../../src/core/ids.js';

describe('task id', () => {
  it('is sz- followed by six base32 characters', () => {
    for (let i = 0; i < 50; i++) expect(isTaskId(newTaskId())).toBe(true);
  });
});
