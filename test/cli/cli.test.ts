import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/cli.js';
import { unavailableUsage } from '../../src/core/types.js';
import { Kernel } from '../../src/kernel/kernel.js';
import { TaskStore } from '../../src/store/task-store.js';
import { FAKE_PI_COMMAND, fakePiEnv, kernelWithPort, makeProject, piKernel, tempDir } from '../helpers.js';

function cli(root: string, scenario: Record<string, unknown> = {}) {
  const fake = fakePiEnv(scenario);
  const out: string[] = [];
  const err: string[] = [];
  const run = (...argv: string[]) =>
    runCli(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, {
      env: { SUBZERO_PROJECT_DIR: root },
      warn: () => {},
      interactive: false,
      kernel: piKernel({ piCommand: FAKE_PI_COMMAND, env: fake.env, piAgentDir: tempDir() }).kernel,
    });
  return { run, out, err, fake };
}

describe('Cli', () => {
  it('subzero run writes task.json, events.jsonl, turns/1.json and an index line, and prints the result', async () => {
    const root = makeProject();
    const { run, out } = cli(root);
    expect(await run('run', 'helper', 'do', 'the', 'thing')).toBe(0);
    expect(out.join('\n')).toMatch(/^task: (sz-[a-z2-7]{6}) · helper · status: completed/);
    const taskId = /sz-[a-z2-7]{6}/.exec(out[0]!)![0];
    const dir = path.join(root, '.agents', 'subzero', 'tasks', taskId);
    for (const file of ['task.json', 'events.jsonl', path.join('turns', '1.json')]) expect(existsSync(path.join(dir, file))).toBe(true);
    const index = readFileSync(path.join(root, '.agents', 'subzero', 'index.jsonl'), 'utf8').split('\n').filter(Boolean);
    expect(index.map((l) => JSON.parse(l).status)).toEqual(['running', 'completed']);
    expect(JSON.parse(index[0]!).parentSessionId).toBeUndefined();
    expect(JSON.parse(readFileSync(path.join(dir, 'task.json'), 'utf8')).brief).toBe('do the thing');
  });

  it('prints the unknown agent error and exits non-zero without making a task', async () => {
    const root = makeProject();
    const { run, err } = cli(root);
    expect(await run('run', 'nobody', 'x')).toBe(1);
    expect(err.join('\n')).toMatch(/unknown agent "nobody"; configured agents: helper, other, free/);
    expect(existsSync(path.join(root, '.agents', 'subzero'))).toBe(false);
  });

  it('lists tasks with id, agent, status and creation time', async () => {
    const root = makeProject();
    const { run, out } = cli(root);
    await run('run', 'helper', 'x');
    out.length = 0;
    expect(await run('tasks')).toBe(0);
    expect(out[0]).toMatch(/^sz-[a-z2-7]{6} {2}helper {2}completed {2}\d{4}-/);
  });

  it('builds the attach command from the launch spec of a settled task', async () => {
    const root = makeProject();
    const { run, out } = cli(root);
    await run('run', 'helper', 'x');
    const taskId = /sz-[a-z2-7]{6}/.exec(out[0]!)![0];
    out.length = 0;
    expect(await run('attach', taskId)).toBe(0);
    expect(out[0]).toContain(`--session-id ${taskId}`);
    expect(out[0]).not.toMatch(/--mode rpc|--session /);
  });

  it('refuses attach while the task is running, and when no launch spec was recorded', async () => {
    const root = makeProject();
    const store = new TaskStore(root);
    store.createTaskRecord({ taskId: 'sz-runnin', agent: { name: 'helper' } as never, brief: 'b', createdAt: new Date().toISOString() });
    const { run, err } = cli(root);
    expect(await run('attach', 'sz-runnin')).toBe(1);
    expect(err.at(-1)).toMatch(/is running/);

    store.writeResult('sz-runnin', { taskId: 'sz-runnin', agent: 'helper', status: 'failed', failureKind: 'skill_mismatch' });
    expect(await run('attach', 'sz-runnin')).toBe(1);
    expect(err.at(-1)).toMatch(/no launch spec was recorded/);
  });

  it('exports the child session with pi --export', async () => {
    const root = makeProject();
    const { run, out } = cli(root);
    await run('run', 'helper', 'x');
    const taskId = /sz-[a-z2-7]{6}/.exec(out[0]!)![0];
    const html = path.join(tempDir(), 'out.html');
    expect(await run('show', taskId, '-o', html)).toBe(0);
    expect(readFileSync(html, 'utf8')).toContain(`${taskId}.jsonl`);
  });

  it('says that an abandoned task has no result', async () => {
    const root = makeProject();
    new TaskStore(root, { owner: { pid: 999_999, startTime: 'then' } }).createTaskRecord({
      taskId: 'sz-abandd',
      agent: { name: 'helper' } as never,
      brief: 'b',
      createdAt: new Date().toISOString(),
    });
    const { run, out } = cli(root);
    await run('show', 'sz-abandd');
    expect(out[0]).toMatch(/abandoned.*no result/);
  });

  describe('through the driver registry', () => {
    /** A settled task of the host pi, with a launch spec and a child session, written by hand. */
    function settledTask(root: string) {
      const store = new TaskStore(root);
      const agent = { name: 'helper', host: 'pi' } as never;
      store.createTaskRecord({ taskId: 'sz-settle', agent, brief: 'b', createdAt: new Date().toISOString() });
      store.writeLaunchSpec('sz-settle', { command: ['x', '--mode', 'rpc'], cwd: root, envNames: [], version: '1', skillFolders: [], thinkingLevel: 'low' });
      store.writeResult('sz-settle', { taskId: 'sz-settle', agent: 'helper', status: 'completed', usage: unavailableUsage('n/a') }, { sessionFile: '/s/sz-settle.jsonl' });
    }
    const bare = (root: string) => {
      const out: string[] = [];
      const err: string[] = [];
      const run = (...argv: string[]) =>
        runCli(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, {
          env: { SUBZERO_PROJECT_DIR: root },
          warn: () => {},
          interactive: false,
          kernel: kernelWithPort({ start: () => { throw new Error('no child is started here'); } }),
        });
      return { run, out, err };
    };

    it('refuses attach and show naming the host when its driver offers neither', async () => {
      const root = makeProject();
      settledTask(root);
      const { run, err } = bare(root);
      expect(await run('attach', 'sz-settle')).toBe(1);
      expect(err.at(-1)).toMatch(/host pi offers no attach command/);
      expect(await run('show', 'sz-settle')).toBe(1);
      expect(err.at(-1)).toMatch(/host pi offers no session export/);
    });

    it('refuses attach and show naming the host and the supported hosts when no driver is registered for it', async () => {
      const root = makeProject();
      settledTask(root);
      const err: string[] = [];
      const run = (...argv: string[]) =>
        runCli(argv, { out: () => {}, err: (t) => err.push(t) }, { env: { SUBZERO_PROJECT_DIR: root }, warn: () => {}, interactive: false, kernel: new Kernel() });
      expect(await run('attach', 'sz-settle')).toBe(1);
      expect(err.at(-1)).toMatch(/"pi".*supported hosts: \(none\)/);
      expect(await run('show', 'sz-settle')).toBe(1);
      expect(err.at(-1)).toMatch(/"pi".*supported hosts: \(none\)/);
    });
  });
});
