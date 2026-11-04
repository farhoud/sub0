import { describe, expect, it } from 'vitest';
import { getAgent } from '../../src/config/agent-config.js';
import { TaskCore } from '../../src/core/task-core.js';
import { unavailableUsage, type ChildOutcome, type ChildPort, type DomainEvent } from '../../src/core/types.js';
import { TaskStore } from '../../src/store/task-store.js';
import { makeProject } from '../helpers.js';

/** A child port whose runs the test settles by hand. */
function scriptedPort() {
  const runs: { emit: (e: DomainEvent) => void; settle: (o: ChildOutcome) => void; cancelled: boolean; brief: string }[] = [];
  const port: ChildPort = {
    start(request, onEvent) {
      let settle!: (o: ChildOutcome) => void;
      const outcome = new Promise<ChildOutcome>((r) => (settle = r));
      const run = { emit: onEvent, settle, cancelled: false, brief: request.brief };
      runs.push(run);
      return {
        outcome,
        cancel: () => {
          run.cancelled = true;
          settle({ lastAssistantText: null, status: 'cancelled', usage: unavailableUsage('stopped') });
        },
      };
    },
  };
  return { port, runs };
}

function setup() {
  const root = makeProject();
  const store = new TaskStore(root, { warn: () => {} });
  const { port, runs } = scriptedPort();
  const core = new TaskCore({ port, store });
  return { root, store, core, runs, agent: getAgent(root, 'helper') };
}

const usage = unavailableUsage('n/a');

describe('TaskCore', () => {
  it('keeps the child run Pending until released, then passes the brief to the port', () => {
    const { core, runs, agent } = setup();
    const task = core.start({ agent, brief: 'do it' });
    expect(task.state).toBe('Pending');
    expect(runs.length).toBe(0);
    task.release();
    expect(task.state).toBe('Starting');
    expect(runs[0]!.brief).toBe('do it');
  });

  it('cuts a long summary with a marker, keeps the status and puts the task id first', async () => {
    const { core, runs, agent } = setup();
    const task = core.start({ agent, brief: 'b' });
    task.release();
    runs[0]!.settle({ lastAssistantText: 'line\n'.repeat(3000), status: 'completed', usage });
    const result = await task.result;
    expect(Object.keys(result)[0]).toBe('taskId');
    expect(result.status).toBe('completed');
    expect(result.summary).toContain(`subzero show ${task.taskId}`);
  });

  it('gives a failed run its failure kind and a cancelled run none', async () => {
    const { core, runs, agent } = setup();
    const a = core.start({ agent, brief: 'b' });
    a.release();
    runs[0]!.settle({ lastAssistantText: 'x', status: 'failed', failureKind: 'error', message: 'boom', usage });
    expect(await a.result).toMatchObject({ status: 'failed', failureKind: 'error', message: 'boom' });
    expect(a.state).toBe('Failed');

    const b = core.start({ agent, brief: 'b' });
    b.release();
    const cancelled = await b.cancel();
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.failureKind).toBeUndefined();
    expect(b.state).toBe('Cancelled');
  });

  it('never starts a child for a task cancelled while Pending', async () => {
    const { core, runs, agent, store } = setup();
    const task = core.start({ agent, brief: 'b' });
    const result = await task.cancel();
    task.release();
    expect(runs.length).toBe(0);
    expect(result).toEqual({ taskId: task.taskId, agent: 'helper', status: 'cancelled' });
    expect(store.readTask(task.taskId)!.status).toBe('cancelled');
  });

  it('writes the launch spec of the run started event before the run settles', async () => {
    const { core, runs, agent, store } = setup();
    const task = core.start({ agent, brief: 'b' });
    task.release();
    const launchSpec = { command: ['pi', '--mode', 'rpc'], cwd: '/p', envNames: ['PI_OFFLINE'], version: '0.87.0', skillFolders: [], thinkingLevel: 'high' };
    runs[0]!.emit({ kind: 'run_started', launchSpec });
    expect(store.readTaskJson(task.taskId)!.launchSpec).toEqual(launchSpec);
    expect(store.readTask(task.taskId)!.status).toBe('running');
    runs[0]!.emit({ kind: 'skills_verified', skills: ['alpha'] });
    expect(task.state).toBe('Live');
  });

  it('produces exactly one result and writes it to the task record', async () => {
    const { core, runs, agent, store } = setup();
    const task = core.start({ agent, brief: 'b' });
    task.release();
    runs[0]!.settle({ lastAssistantText: 'ok', status: 'completed', usage });
    await task.result;
    await task.cancel();
    expect(store.readResult(task.taskId)!.status).toBe('completed');
    expect((await task.result).status).toBe('completed');
  });

  it('fills an unavailable usage and an empty summary when the driver fails', async () => {
    const root = makeProject();
    const port: ChildPort = { start: () => ({ outcome: Promise.reject(new Error('boom')), cancel: () => {} }) };
    const core = new TaskCore({ port, store: new TaskStore(root, { warn: () => {} }), warn: () => {} });
    const task = core.start({ agent: getAgent(root, 'helper'), brief: 'b' });
    task.release();
    const result = await task.result;
    expect(result).toMatchObject({ status: 'failed', failureKind: 'crashed', summary: '' });
    expect(result.usage!.totalTokens).toMatchObject({ unavailable: expect.any(String) });
  });

  it('carries no changed-files field in the result', async () => {
    const { core, runs, agent } = setup();
    const task = core.start({ agent, brief: 'b' });
    task.release();
    runs[0]!.settle({ lastAssistantText: 'ok', status: 'completed', usage });
    const result = await task.result;
    expect(Object.keys(result).sort()).toEqual(['agent', 'durationMs', 'status', 'summary', 'taskId', 'usage']);
  });
});
