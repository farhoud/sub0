import { describe, expect, it } from 'vitest';
import { formatElapsed } from '../../src/service/status-text.js';

describe('status text', () => {
  it('formats elapsed time', () => {
    expect(formatElapsed(65_000)).toBe('1m05s');
  });
});
