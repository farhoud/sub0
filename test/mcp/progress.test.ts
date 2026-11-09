import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatElapsed, ProgressReporter } from '../../src/mcp/progress.js';

describe('progress notification', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends at most one notification a second, carrying the latest line, with a rising counter', () => {
    const sent: [number, string][] = [];
    const reporter = new ProgressReporter('helper', (p, m) => sent.push([p, m]), { now: () => Date.now() });
    reporter.onEvent({ kind: 'tool_activity', phase: 'start', tool: 'read', path: 'a.ts' });
    reporter.onEvent({ kind: 'agent_message', text: 'secret' });
    reporter.onEvent({ kind: 'tool_activity', phase: 'start', tool: 'write', path: 'b.ts' });
    expect(sent).toEqual([[1, 'helper · tool_activity read a.ts · 0s']]);
    vi.advanceTimersByTime(1000);
    expect(sent[1]).toEqual([2, 'helper · tool_activity write b.ts · 1s']);
    reporter.stop();
  });

  it('says the run is waiting while Pending, and repeats the line after 30 seconds of silence', () => {
    const sent: string[] = [];
    const reporter = new ProgressReporter('helper', (_, m) => sent.push(m), { now: () => Date.now() });
    reporter.onState('Pending');
    expect(sent).toEqual(['helper · waiting · 0s']);
    vi.advanceTimersByTime(30_000);
    expect(sent).toEqual(['helper · waiting · 0s', 'helper · waiting · 30s']);
    vi.advanceTimersByTime(30_000);
    expect(sent.at(-1)).toBe('helper · waiting · 1m00s');
    reporter.stop();
    vi.advanceTimersByTime(60_000);
    expect(sent.length).toBe(3);
  });

  it('leaves the waiting phase once the run is released, and no heartbeat says waiting again', () => {
    const sent: string[] = [];
    const reporter = new ProgressReporter('helper', (_, m) => sent.push(m), { now: () => Date.now() });
    reporter.onState('Pending');
    expect(sent).toEqual(['helper · waiting · 0s']);
    vi.advanceTimersByTime(5_000);
    reporter.onState('Starting');
    expect(sent.at(-1)).toBe('helper · running · 5s');
    vi.advanceTimersByTime(30_000);
    expect(sent.at(-1)).toBe('helper · running · 35s');
    expect(sent.slice(1).some((m) => m.includes('waiting'))).toBe(false);
    reporter.stop();
  });

  it('formats elapsed time', () => {
    expect(formatElapsed(65_000)).toBe('1m05s');
  });
});
