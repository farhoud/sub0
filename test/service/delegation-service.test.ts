import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LoadError, TierError, UnknownAgentError, UnresolvedRootError } from '../../src/config/agent-config.js';
import { unavailableUsage, type ChildOutcome, type ChildPort } from '../../src/core/types.js';
import { DelegationService, EmptyBriefError, renderBrief } from '../../src/service/delegation-service.js';
import { TaskStore } from '../../src/store/task-store.js';
import { Kernel } from '../../src/kernel/kernel.js';
import { DEFAULT_YAML, FAKE_PI_COMMAND, fakePiEnv, isAlive, kernelWithPort, makeProject, piKernel, tempDir, until } from '../helpers.js';

/** A child port that the test settles by hand, recording each start. */
function manualPort() {
  const started: { taskId: string; settle: (o?: Partial<ChildOutcome>) => void }[] = [];
  const port: ChildPort = {
    start(request) {
      let resolve!: (o: ChildOutcome) => void;
      const outcome = new Promise<ChildOutcome>((r) => (resolve = r));
      const settle = (o: Partial<ChildOutcome> = {}) =>
        resolve({ lastAssistantText: 'ok', status: 'completed', usage: unavailableUsage('n/a'), ...o });
      started.push({ taskId: request.taskId, settle });
      return { outcome, cancel: () => settle({ status: 'cancelled' }) };
    },
  };
  return { port, started };
}

function service(root: string, port: ChildPort) {
  return new DelegationService({
    env: { SUBZERO_PROJECT_DIR: root },
    warn: () => {},
    kernel: kernelWithPort(port),
  });
}

const indexLines = (root: string) => {
  const file = path.join(root, '.agents', 'subzero', 'index.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
};

describe('DelegationService', () => {
  it('returns the unknown agent error and writes no task record', async () => {
    const root = makeProject();
    const svc = service(root, manualPort().port);
    await expect(svc.delegate({ agent: 'nobody', briefText: 'b' }, { wait: false })).rejects.toBeInstanceOf(UnknownAgentError);
    expect(existsSync(path.join(root, '.agents', 'subzero'))).toBe(false);
  });

  it('returns the load error while the agent file is malformed and writes no task record', async () => {
    const root = makeProject();
    writeFileSync(path.join(root, '.agents', 'subzero.yaml'), 'agents: [');
    const svc = service(root, manualPort().port);
    await expect(svc.delegate({ agent: 'helper', briefText: 'b' }, { wait: false })).rejects.toBeInstanceOf(LoadError);
    expect(existsSync(path.join(root, '.agents', 'subzero'))).toBe(false);
  });

  it('refuses an empty brief text whatever its files hold', async () => {
    const svc = service(makeProject(), manualPort().port);
    await expect(svc.delegate({ agent: 'helper', briefText: '  ', files: ['a'] }, { wait: false })).rejects.toBeInstanceOf(EmptyBriefError);
  });

  it('returns the unresolved root error until a root is known, then runs the start-up sweep', async () => {
    const env: NodeJS.ProcessEnv = {};
    const root = makeProject();
    // A task of a dead owner process, left running in the index.
    const dead = new TaskStore(root, { owner: { pid: 999_999, startTime: 'then' } });
    dead.createTaskRecord({ taskId: 'sz-dddddd', agent: { name: 'helper' } as never, brief: 'b', createdAt: new Date().toISOString() });
    const svc = new DelegationService({ env, roots: () => [], warn: () => {}, kernel: kernelWithPort(manualPort().port) });
    await expect(svc.delegate({ agent: 'helper', briefText: 'b' }, { wait: false })).rejects.toBeInstanceOf(UnresolvedRootError);
    expect(svc.projectRoot).toBeUndefined();
    env.SUBZERO_PROJECT_DIR = root;
    await svc.start();
    expect(svc.projectRoot).toBe(root);
    expect(svc.store.readTask('sz-dddddd')!.status).toBe('abandoned');
    // The root does not change once resolved.
    env.SUBZERO_PROJECT_DIR = tempDir();
    await svc.start();
    expect(svc.projectRoot).toBe(root);
  });

  it('renders files and the expected output after the unchanged brief text', () => {
    expect(renderBrief({ briefText: 'Do X.', files: ['a.ts', 'b.ts'], expectedOutput: 'A list.' })).toBe(
      'Do X.\n\n## Files\n\n- a.ts\n- b.ts\n\n## Expected output\n\nA list.',
    );
    expect(renderBrief({ briefText: 'Do X.' })).toBe('Do X.');
  });

  it('keeps the second of two runs on a limit-1 endpoint Pending until the first ends, in each way', async () => {
    for (const end of ['settle', 'fail', 'cancel'] as const) {
      const { port, started } = manualPort();
      const svc = service(makeProject(), port);
      const first = await svc.delegate({ agent: 'helper', briefText: 'one' }, { wait: false });
      const states: string[] = [];
      const second = svc.delegate({ agent: 'other', briefText: 'two' }, { wait: true, onState: (s) => states.push(s) });
      await until(() => states.length > 0);
      expect(started.length).toBe(1);
      expect(states).toEqual(['Pending']);
      if (end === 'settle') started[0]!.settle();
      if (end === 'fail') started[0]!.settle({ status: 'failed', failureKind: 'timeout' });
      if (end === 'cancel') await svc.cancel((first as { taskId: string }).taskId);
      await until(() => started.length === 2);
      started[1]!.settle();
      expect((await second).kind).toBe('result');
    }
  });

  it('does not report Pending for a run released at once', async () => {
    const { port } = manualPort();
    const svc = service(makeProject(), port);
    const states: string[] = [];
    await svc.delegate({ agent: 'free', briefText: 'one' }, { wait: false, onState: (s) => states.push(s) });
    expect(states).toEqual(['Starting']);
  });

  it('starts no child for a Pending run that is cancelled', async () => {
    const { port, started } = manualPort();
    const svc = service(makeProject(), port);
    await svc.delegate({ agent: 'helper', briefText: 'one' }, { wait: false });
    const second = (await svc.delegate({ agent: 'other', briefText: 'two' }, { wait: false })) as { taskId: string };
    const reply = await svc.cancel(second.taskId);
    expect(reply).toMatchObject({ kind: 'result', result: { status: 'cancelled' } });
    started[0]!.settle();
    await new Promise((r) => setTimeout(r, 50));
    expect(started.length).toBe(1);
  });

  it('runs agents on different endpoints, or on one with no entry, at once', async () => {
    const { port, started } = manualPort();
    const svc = service(makeProject(), port);
    await svc.delegate({ agent: 'helper', briefText: 'one' }, { wait: false });
    await svc.delegate({ agent: 'free', briefText: 'two' }, { wait: false });
    await svc.delegate({ agent: 'free', briefText: 'three' }, { wait: false });
    expect(started.length).toBe(3);
  });

  it('does not count a child run of another process', async () => {
    const root = makeProject();
    const other = service(root, manualPort().port);
    await other.delegate({ agent: 'helper', briefText: 'elsewhere' }, { wait: false });
    const { port, started } = manualPort();
    const svc = service(root, port);
    await svc.delegate({ agent: 'helper', briefText: 'here' }, { wait: false });
    expect(started.length).toBe(1);
  });

  it('says that a task whose owner died after start-up is abandoned, since the sweep runs again', async () => {
    const root = makeProject();
    const svc = service(root, manualPort().port);
    await svc.start();
    new TaskStore(root, { owner: { pid: 999_999, startTime: 'then' } }).createTaskRecord({
      taskId: 'sz-latedd',
      agent: { name: 'helper' } as never,
      brief: 'b',
      createdAt: new Date().toISOString(),
    });
    expect(await svc.collect('sz-latedd')).toEqual({ kind: 'abandoned', taskId: 'sz-latedd' });
  });

  it('collects the stored result after a restart, and says an abandoned task has none', async () => {
    const root = makeProject();
    const { port, started } = manualPort();
    const first = service(root, port);
    const { taskId } = (await first.delegate({ agent: 'free', briefText: 'b' }, { wait: false })) as { taskId: string };
    started[0]!.settle({ lastAssistantText: 'stored' });
    await until(() => indexLines(root).length === 2);
    const restarted = service(root, manualPort().port);
    expect(await restarted.collect(taskId)).toMatchObject({ kind: 'result', result: { summary: 'stored' } });
    // A cancel of a settled task returns its stored result unchanged.
    expect(await restarted.cancel(taskId)).toMatchObject({ kind: 'result', result: { status: 'completed' } });
  });

  it('reports a running task of another live process and changes nothing', async () => {
    const root = makeProject();
    const owner = service(root, manualPort().port);
    const { taskId } = (await owner.delegate({ agent: 'free', briefText: 'b' }, { wait: false })) as { taskId: string };
    const here = service(root, manualPort().port);
    const before = indexLines(root).length;
    expect(await here.cancel(taskId)).toEqual({ kind: 'other_process', taskId });
    expect(await here.collect(taskId)).toEqual({ kind: 'other_process', taskId });
    expect(indexLines(root).length).toBe(before);
    expect(here.store.readTask(taskId)!.status).toBe('running');
  });

  it('lists the tasks of one parent session id after the sweep', async () => {
    const svc = service(makeProject(), manualPort().port);
    await svc.delegate({ agent: 'free', briefText: 'a', parentSessionId: 's1' }, { wait: false });
    await svc.delegate({ agent: 'free', briefText: 'b', parentSessionId: 's2' }, { wait: false });
    expect((await svc.list('s1')).length).toBe(1);
    expect((await svc.list()).length).toBe(2);
  });

  it('kills a child run that ignores every stop once the shutdown deadline passes', async () => {
    const root = makeProject();
    const fake = fakePiEnv({ turn: [{ hang: true }], ignoreAbort: true, ignoreStdinEnd: true, ignoreSigterm: true });
    const { kernel, driver } = piKernel({ piCommand: FAKE_PI_COMMAND, env: fake.env, piAgentDir: tempDir() });
    const svc = new DelegationService({ env: { SUBZERO_PROJECT_DIR: root }, warn: () => {}, kernel });
    await svc.delegate({ agent: 'helper', briefText: 'go' }, { wait: false });
    await until(() => fake.log().some((l) => l.command === 'prompt'));
    // As the entry point does: the service reports what outlived the deadline, the driver kills it.
    expect(await svc.shutdown(300)).toBe(false);
    driver.killAll();
    await until(() => !isAlive(fake.log()[0].pid));
  });

  it('runs a delegation end to end on the fake pi', async () => {
    const root = makeProject();
    const fake = fakePiEnv();
    const svc = new DelegationService({
      env: { SUBZERO_PROJECT_DIR: root },
      warn: () => {},
      kernel: piKernel({ piCommand: FAKE_PI_COMMAND, env: fake.env, piAgentDir: tempDir() }).kernel,
    });
    const events: string[] = [];
    const reply = await svc.delegate({ agent: 'helper', briefText: 'go' }, { wait: true, onEvent: (e) => events.push(e.kind) });
    expect(reply).toMatchObject({ kind: 'result', result: { status: 'completed', summary: 'Done: wrote the answer.' } });
    expect(events).toContain('skills_verified');
  });

  it('hands the child port the folders of the project, the sessions and the driver files of the task', async () => {
    const root = makeProject();
    let request: any;
    const port: ChildPort = {
      start(r) {
        request = r;
        return { outcome: Promise.resolve({ lastAssistantText: 'ok', status: 'completed', usage: unavailableUsage('n/a') }), cancel() {} };
      },
    };
    const svc = service(root, port);
    await svc.delegate({ agent: 'helper', briefText: 'go' }, { wait: true });
    expect(request).toMatchObject({
      projectRoot: root,
      sessionsFolder: path.join(root, '.agents', 'subzero', 'sessions'),
      driverFilesFolder: path.join(root, '.agents', 'subzero', 'tasks', request.taskId),
    });
  });

  it('refuses a host with no registered driver, naming the host and the supported hosts, and makes no task', async () => {
    const root = makeProject();
    const kernel = new Kernel();
    const svc = new DelegationService({ env: { SUBZERO_PROJECT_DIR: root }, warn: () => {}, kernel });
    await expect(svc.delegate({ agent: 'helper', briefText: 'go' }, { wait: false })).rejects.toThrow(/"pi".*supported hosts: \(none\)/s);
    expect(await svc.list()).toEqual([]);
    expect(indexLines(root)).toEqual([]);
  });
  it('freezes the definition resolved at the tier of the agent, with its host from the tier', async () => {
    const root = makeProject();
    const { port } = manualPort();
    const frozen: any[] = [];
    const svc = service(root, { start: (request, onEvent) => (frozen.push(request.agent), port.start(request, onEvent)) });
    await svc.delegate({ agent: 'other', briefText: 'go' }, { wait: false });
    expect(frozen[0]).toMatchObject({ name: 'other', host: 'pi', model: 'local/qwen-small', thinking: 'low', endpoint: 'local', parallel: 1 });
  });

  it('runs general when no agent is named, and returns the unknown agent error without a general entry', async () => {
    const withGeneral = makeProject(DEFAULT_YAML + '  general:\n    tools: [read, write]\n    timeout: 9\n');
    const frozen: any[] = [];
    const { port } = manualPort();
    const svc = service(withGeneral, { start: (request, onEvent) => (frozen.push(request.agent), port.start(request, onEvent)) });
    await svc.delegate({ briefText: 'go' }, { wait: false });
    expect(frozen[0]).toMatchObject({ name: 'general', model: 'local/qwen', tools: ['read', 'write'], timeout: 9 });

    const bare = service(makeProject(), manualPort().port);
    await expect(bare.delegate({ briefText: 'go' }, { wait: false })).rejects.toThrow(/no agent was named/);
  });

  it('returns the tier error, naming the host and the supported hosts, when the tier host has no driver, and makes no task', async () => {
    const root = makeProject(DEFAULT_YAML.replace('cloud: { host: pi,', 'cloud: { host: claude,'));
    const svc = service(root, manualPort().port);
    const err = await svc.delegate({ agent: 'free', briefText: 'go' }, { wait: false }).catch((e) => e);
    expect(err).toBeInstanceOf(TierError);
    expect(err.message).toMatch(/"cloud".*"claude".*supported hosts: pi/s);
    expect(indexLines(root)).toEqual([]);
  });
});
