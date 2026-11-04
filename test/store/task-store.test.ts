import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAgent } from '../../src/config/agent-config.js';
import type { Result } from '../../src/core/types.js';
import { TaskStore, type ProcessProbe } from '../../src/store/task-store.js';
import { makeProject } from '../helpers.js';

const DEAD = 999_999;

function probe(alive: Record<number, string>, unknown = false): ProcessProbe {
  return { startTime: (pid) => (unknown ? undefined : alive[pid] ?? null) };
}

function setup(options: { owner?: { pid: number; startTime: string }; alive?: Record<number, string> } = {}) {
  const root = makeProject();
  const warnings: string[] = [];
  const store = new TaskStore(root, {
    warn: (m) => warnings.push(m),
    probe: probe(options.alive ?? { [process.pid]: 'now' }),
    owner: options.owner ?? { pid: process.pid, startTime: 'now' },
  });
  const agent = getAgent(root, 'helper');
  const create = (taskId: string, parentSessionId?: string) =>
    store.createTaskRecord({ taskId, agent, brief: 'b', createdAt: new Date().toISOString(), ...(parentSessionId ? { parentSessionId } : {}) });
  return { root, store, warnings, create };
}

const result = (taskId: string, status: Result['status'] = 'completed'): Result => ({ taskId, agent: 'helper', status, summary: 's' });

describe('TaskStore', () => {
  it('keeps the latest line after three status updates and skips a corrupt last line', () => {
    const { store, warnings, create } = setup();
    create('sz-aaaaaa');
    appendFileSync(store.indexPath, JSON.stringify({ taskId: 'sz-aaaaaa', agent: 'helper', status: 'running', childSession: 'sz-aaaaaa', createdAt: 'x', updatedAt: 'y' }) + '\n');
    store.writeResult('sz-aaaaaa', result('sz-aaaaaa', 'truncated'));
    appendFileSync(store.indexPath, '{"taskId": "sz-aaaa');
    expect(store.readLatest().get('sz-aaaaaa')!.status).toBe('truncated');
    expect(store.readTask('sz-aaaaaa')!.status).toBe('truncated');
    expect(warnings.some((w) => w.includes('corrupt line 4'))).toBe(true);
  });

  it('marks a running task of a dead owner abandoned, and leaves a live owner running', () => {
    const dead = setup({ owner: { pid: DEAD, startTime: 'then' } });
    dead.create('sz-dddddd');
    const liveStore = new TaskStore(dead.root, { probe: probe({ [process.pid]: 'now' }), owner: { pid: process.pid, startTime: 'now' } });
    liveStore.createTaskRecord({ taskId: 'sz-llllll', agent: getAgent(dead.root, 'helper'), brief: 'b', createdAt: new Date().toISOString() });

    expect(liveStore.sweep()).toEqual(['sz-dddddd']);
    expect(liveStore.readTask('sz-dddddd')!.status).toBe('abandoned');
    expect(liveStore.readTask('sz-llllll')!.status).toBe('running');
    // A second sweep appends nothing and changes nothing.
    const lines = readFileSync(liveStore.indexPath, 'utf8').split('\n').filter(Boolean).length;
    expect(liveStore.sweep()).toEqual([]);
    expect(readFileSync(liveStore.indexPath, 'utf8').split('\n').filter(Boolean).length).toBe(lines);
  });

  it('treats an owner alive with another start time as gone', () => {
    const { store, create } = setup({ owner: { pid: process.pid, startTime: 'earlier' }, alive: { [process.pid]: 'now' } });
    create('sz-rrrrrr');
    expect(store.sweep()).toEqual(['sz-rrrrrr']);
  });

  it('never marks a task when the probe cannot tell, or when the owner start time was unknown', () => {
    const { root, create } = setup({ owner: { pid: DEAD, startTime: 'then' } });
    create('sz-uuuuua');
    expect(new TaskStore(root, { probe: probe({}, true) }).sweep()).toEqual([]);
    const unknownOwner = new TaskStore(root, { probe: probe({ [process.pid]: 'now' }), owner: { pid: process.pid, startTime: 'unknown' } });
    unknownOwner.createTaskRecord({ taskId: 'sz-uuuuub', agent: getAgent(root, 'helper'), brief: 'b', createdAt: new Date().toISOString() });
    expect(unknownOwner.sweep()).toEqual(['sz-uuuuua']);
  });

  it('marks nothing when the probe cannot read this process', () => {
    const { root, create } = setup({ owner: { pid: DEAD, startTime: 'then' } });
    create('sz-selfnn');
    const blind: ProcessProbe = { startTime: (pid) => (pid === process.pid ? undefined : null) };
    expect(new TaskStore(root, { probe: blind }).sweep()).toEqual([]);
  });

  it('records the session file of an abandoned task, so it can still be attached', () => {
    const { store, create } = setup({ owner: { pid: DEAD, startTime: 'then' } });
    create('sz-sessnn');
    mkdirSync(store.sessionsFolder, { recursive: true });
    writeFileSync(path.join(store.sessionsFolder, '2026-11-03T00-00-00Z_sz-sessnn.jsonl'), '{}\n');
    store.sweep();
    const line = store.readLatest().get('sz-sessnn')!;
    expect(line.status).toBe('abandoned');
    expect(line.sessionFile).toBe(path.join(store.sessionsFolder, '2026-11-03T00-00-00Z_sz-sessnn.jsonl'));
  });

  it('reads a task whose result was written before its settled line as settled', () => {
    const { store, create } = setup({ owner: { pid: DEAD, startTime: 'then' } });
    create('sz-ssssss');
    // The owner died after writing turns/1.json but before appending its line.
    writeFileSync(path.join(store.taskDir('sz-ssssss'), 'turns', '1.json'), JSON.stringify(result('sz-ssssss')));
    expect(store.sweep()).toEqual([]);
    expect(store.readTask('sz-ssssss')!.status).toBe('completed');
    // An abandoned line after a stored result is ignored by every reader.
    appendFileSync(store.indexPath, JSON.stringify({ taskId: 'sz-ssssss', agent: 'helper', status: 'abandoned', childSession: 'sz-ssssss', createdAt: 'x', updatedAt: 'y' }) + '\n');
    expect(store.readTask('sz-ssssss')!.status).toBe('completed');
    expect(store.list().find((t) => t.taskId === 'sz-ssssss')!.status).toBe('completed');
  });

  it('creates the store folder owner-only with its own .gitignore, leaving the user .gitignore unchanged', () => {
    const { root, store, create } = setup();
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
    create('sz-gggggg');
    store.appendEvent('sz-gggggg', { kind: 'turn_settled' });
    expect(statSync(store.storeFolder).mode & 0o777).toBe(0o700);
    expect(readFileSync(path.join(store.storeFolder, '.gitignore'), 'utf8')).toBe('*\n');
    expect(readFileSync(path.join(root, '.gitignore'), 'utf8')).toBe('node_modules/\n');
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
    expect(status).not.toMatch(/\.agents\/subzero\//);
  });

  it('leaves an existing .gitignore in the store folder unchanged', () => {
    const { store, create } = setup();
    create('sz-hhhhhh');
    writeFileSync(path.join(store.storeFolder, '.gitignore'), 'custom\n');
    create('sz-iiiiii');
    expect(readFileSync(path.join(store.storeFolder, '.gitignore'), 'utf8')).toBe('custom\n');
  });

  it('lists the tasks of one parent session id, or of every one', () => {
    const { store, create } = setup();
    create('sz-pppppa', 'session-1');
    create('sz-pppppb', 'session-2');
    create('sz-pppppc');
    expect(store.list('session-1').map((t) => t.taskId)).toEqual(['sz-pppppa']);
    expect(store.list().length).toBe(3);
  });

  it('writes the launch spec and the event log into the task record', () => {
    const { store, create } = setup();
    create('sz-eeeeee');
    store.writeLaunchSpec('sz-eeeeee', { command: ['pi'], cwd: '/', envNames: ['PI_OFFLINE'], version: '0.87.0', skillFolders: [], thinkingLevel: 'high' });
    store.appendEvent('sz-eeeeee', { kind: 'agent_message', text: 'hi' });
    expect(store.readTaskJson('sz-eeeeee')!.launchSpec!.command).toEqual(['pi']);
    expect(existsSync(path.join(store.taskDir('sz-eeeeee'), 'events.jsonl'))).toBe(true);
  });
});
