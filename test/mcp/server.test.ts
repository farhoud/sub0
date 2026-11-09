import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatListing } from '../../src/mcp/format.js';
import { createSubzeroServer } from '../../src/mcp/server.js';
import { DelegationService } from '../../src/service/delegation-service.js';
import type { TaskView } from '../../src/store/task-store.js';
import { FAKE_PI, FAKE_PI_COMMAND, fakePiEnv, isAlive, kernelWithPort, makeProject, manualPort, piKernel, tempDir, until } from '../helpers.js';

const REPO = path.resolve(import.meta.dirname, '..', '..');

async function connect(scenario: Record<string, unknown> = {}, env: NodeJS.ProcessEnv | null = null, sessionId?: string) {
  const root = makeProject();
  const fake = fakePiEnv(scenario);
  const service = new DelegationService({
    env: env ?? { SUBZERO_PROJECT_DIR: root },
    roots: () => [],
    warn: () => {},
    kernel: piKernel({ piCommand: FAKE_PI_COMMAND, env: fake.env, piAgentDir: tempDir(), abortWaitMs: 300, killWaitMs: 300 }).kernel,
  });
  const server = createSubzeroServer({ service, parentSessionId: () => sessionId, progress: { minIntervalMs: 10, heartbeatMs: 200 } });
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = (name: string, args: Record<string, unknown>, options: Parameters<Client['callTool']>[2] = {}) =>
    client.callTool({ name, arguments: args }, CallToolResultSchema, options);
  const textOf = (r: any) => r.content.map((c: any) => c.text).join('\n') as string;
  return { root, fake, service, client, call, textOf };
}

/** A server whose children the test settles by hand, on an endpoint that runs one at a time. */
async function connectManual() {
  const root = makeProject();
  const { port, started } = manualPort();
  const service = new DelegationService({ env: { SUBZERO_PROJECT_DIR: root }, roots: () => [], warn: () => {}, kernel: kernelWithPort(port) });
  const server = createSubzeroServer({ service, parentSessionId: () => undefined, progress: { minIntervalMs: 10, heartbeatMs: 200 } });
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = (name: string, args: Record<string, unknown>, options: Parameters<Client['callTool']>[2] = {}) =>
    client.callTool({ name, arguments: args }, CallToolResultSchema, options);
  const textOf = (r: any) => r.content.map((c: any) => c.text).join('\n') as string;
  const idIn = (text: string) => /sz-[a-z2-7]{6}/.exec(text)![0];
  return { root, service, started, call, textOf, idIn };
}

describe('McpServer', () => {
  it('exposes four tools and only delegate is always loaded', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['await', 'cancel', 'delegate', 'tasks']);
    for (const tool of tools) expect(Boolean(tool._meta?.['anthropic/alwaysLoad'])).toBe(tool.name === 'delegate');
    expect(client.getInstructions()).toMatch(/self-contained brief/);
    expect(client.getInstructions()).toMatch(/cannot see this conversation/);
  });

  it('sends progress for domain events and heartbeats, without agent text, then returns the result', async () => {
    const turn = [
      { emit: { type: 'tool_execution_start', toolName: 'read', args: { path: 'src/a.ts' } } },
      { sleep: 60 },
      { emit: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'PRIVATE THOUGHT' }], stopReason: 'stop' } } },
      { sleep: 500 },
      { emit: { type: 'agent_settled' } },
    ];
    const { call, textOf } = await connect({ turn, lastText: 'summary here' });
    const messages: string[] = [];
    const result = await call('delegate', { agent: 'helper', brief: 'go' }, { onprogress: (p) => messages.push(p.message ?? '') });
    const text = textOf(result);
    expect(text.split('\n')[0]).toMatch(/^task: sz-[a-z2-7]{6} · helper · status: completed/);
    expect(text).toContain('summary here');
    expect(messages.some((m) => m.startsWith('helper · tool_activity read src/a.ts · '))).toBe(true);
    expect(messages.filter((m) => m.includes('agent_message')).length).toBeGreaterThan(1); // heartbeat repeats it
    expect(messages.join('\n')).not.toContain('PRIVATE');
  });

  it('returns the task id at once with wait false, and await returns nothing while it is live', async () => {
    const { call, textOf } = await connect({ turn: [{ sleep: 800 }, { emit: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }], stopReason: 'stop' } } }, { emit: { type: 'agent_settled' } }] });
    const started = textOf(await call('delegate', { agent: 'helper', brief: 'go', wait: false }));
    const taskId = /sz-[a-z2-7]{6}/.exec(started)![0];
    expect(started).toMatch(/running, started \d{4}-\d{2}-\d{2}T[\d:.]+Z \(\d+s ago\)/);
    expect(textOf(await call('await', { tasks: [taskId], timeout_s: 0.05 }))).toMatch(/running, started \d{4}-/);
    expect(textOf(await call('await', { tasks: [taskId], timeout_s: 10 }))).toMatch(/status: completed/);
  });

  it('cancels the task of a waited call on notifications/cancelled', async () => {
    const { call, fake, service } = await connect({ turn: [{ hang: true }] });
    const abort = new AbortController();
    const pending = call('delegate', { agent: 'helper', brief: 'go' }, { signal: abort.signal }).catch(() => 'aborted');
    await until(() => fake.log().some((l) => l.command === 'prompt'));
    abort.abort();
    expect(await pending).toBe('aborted');
    const [task] = await service.list();
    await until(() => service.store.readTask(task!.taskId)!.status === 'cancelled');
    await until(() => !isAlive(fake.log()[0].pid));
  });

  it('returns a tool error naming every configured agent for an unknown agent, with no task made', async () => {
    const { call, service } = await connect();
    const result: any = await call('delegate', { agent: 'nobody', brief: 'go' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/helper, other, free/);
    expect(await service.list()).toEqual([]);
  });

  it('returns the unresolved root error as a tool error that says not to retry', async () => {
    const { call } = await connect({}, {});
    const result: any = await call('delegate', { agent: 'helper', brief: 'go' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/SUBZERO_PROJECT_DIR/);
    expect(result.content[0].text).toMatch(/do not retry/);
  });

  it('lists only the tasks of the current parent session id, and every task when it is unknown', async () => {
    const known = await connect({}, null, 'session-1');
    await known.call('delegate', { agent: 'helper', brief: 'go' });
    await known.service.delegate({ agent: 'free', briefText: 'x', parentSessionId: 'session-2' }, { wait: true });
    const listing = known.textOf(await known.call('tasks', {}));
    expect(listing.split('\n').filter((l) => l.startsWith('sz-')).length).toBe(1);
    expect(listing).not.toMatch(/could not identify/);

    const unknown = await connect();
    await unknown.call('delegate', { agent: 'helper', brief: 'go' });
    expect(unknown.textOf(await unknown.call('tasks', {}))).toMatch(/could not identify this conversation/);
  });

  it('replies started to the first of three no-wait delegates and queued at places 1 and 2 to the others', async () => {
    const { call, textOf, started } = await connectManual();
    const first = textOf(await call('delegate', { agent: 'helper', brief: 'one', wait: false }));
    const second = textOf(await call('delegate', { agent: 'other', brief: 'two', wait: false }));
    const third = textOf(await call('delegate', { agent: 'other', brief: 'three', wait: false }));
    expect(first).toMatch(/^task: sz-[a-z2-7]{6} · running, started \d{4}-[\d\-T:.Z]+ \(\d+s ago\)/);
    expect(second).toContain("queued, not launched yet: no child is running; it starts when endpoint local has room (place 1 in this session's queue, waiting ");
    expect(third).toContain("place 2 in this session's queue");
    for (const reply of [second, third]) expect(reply).not.toMatch(/running, started|still running|\bstarted\b/);
    expect(started.length).toBe(1);
  });

  it('shows queued with its place and wait in tasks(task), never running, and moves the place when the first one is cancelled', async () => {
    const { call, textOf, idIn } = await connectManual();
    await call('delegate', { agent: 'helper', brief: 'one', wait: false });
    const second = idIn(textOf(await call('delegate', { agent: 'other', brief: 'two', wait: false })));
    const third = idIn(textOf(await call('delegate', { agent: 'other', brief: 'three', wait: false })));
    const shown = textOf(await call('tasks', { task: third }));
    expect(shown).toMatch(/queued, not launched yet: .* \(place 2 in this session's queue, waiting \d+s\)/);
    expect(shown).not.toMatch(/running, started|still running|\bstarted\b/);
    expect(textOf(await call('cancel', { task: second }))).toMatch(/cancelled/);
    expect(textOf(await call('tasks', { task: third }))).toContain("place 1 in this session's queue");
    const listing = textOf(await call('tasks', {}));
    expect(listing.split('\n').find((l) => l.startsWith(third))).toMatch(/queued, not launched yet/);
    expect(listing.split('\n').find((l) => l.startsWith(third))).not.toMatch(/running, started|still running|\bstarted\b/);
  });

  it('returns the queued line, not still running, from await with a short timeout on a queued task, and running with a start time after release', async () => {
    const { call, textOf, idIn, started } = await connectManual();
    await call('delegate', { agent: 'helper', brief: 'one', wait: false });
    const second = idIn(textOf(await call('delegate', { agent: 'other', brief: 'two', wait: false })));
    const waiting = textOf(await call('await', { tasks: [second], timeout_s: 0.05 }));
    expect(waiting).toContain('queued, not launched yet');
    expect(waiting).not.toMatch(/running, started|still running|\bstarted\b/);
    started[0]!.settle();
    await until(() => started.length === 2);
    expect(textOf(await call('await', { tasks: [second], timeout_s: 0.05 }))).toMatch(/running, started \d{4}-[\d\-T:.Z]+ \(\d+s ago\)/);
    started[1]!.settle();
    expect(textOf(await call('await', { tasks: [second], timeout_s: 5 }))).toMatch(/status: completed/);
  });

  it('shows a task queued in another process as queued with its wait and no place', async () => {
    const owner = await connectManual();
    await owner.call('delegate', { agent: 'helper', brief: 'one', wait: false });
    const second = owner.idIn(owner.textOf(await owner.call('delegate', { agent: 'other', brief: 'two', wait: false })));
    const { port } = manualPort();
    const service = new DelegationService({ env: { SUBZERO_PROJECT_DIR: owner.root }, roots: () => [], warn: () => {}, kernel: kernelWithPort(port) });
    const server = createSubzeroServer({ service, parentSessionId: () => undefined });
    const client = new Client({ name: 'test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const text = (r: any) => r.content.map((c: any) => c.text).join('\n') as string;
    const shown = text(await client.callTool({ name: 'tasks', arguments: { task: second } }, CallToolResultSchema));
    expect(shown).toMatch(/queued, not launched yet: .*endpoint local .*waiting \d+s/);
    expect(shown).not.toMatch(/place \d|this session's queue|running, started|still running|\bstarted\b/);
    expect(shown).toMatch(/another process/);
    const listing = text(await client.callTool({ name: 'tasks', arguments: {} }, CallToolResultSchema));
    expect(listing.split('\n').find((l) => l.startsWith(second))).toMatch(/queued, not launched yet/);
  });

  it('sends progress that says waiting while queued and stops saying it after release', async () => {
    const { call, textOf, idIn, started } = await connectManual();
    await call('delegate', { agent: 'helper', brief: 'one', wait: false });
    const messages: string[] = [];
    const pending = call('delegate', { agent: 'other', brief: 'two' }, { onprogress: (p) => messages.push(p.message ?? '') });
    await until(() => messages.some((m) => m.includes('waiting')));
    started[0]!.settle();
    await until(() => started.length === 2);
    await until(() => messages.some((m) => m.includes('running')));
    const mark = messages.length;
    await new Promise((r) => setTimeout(r, 500)); // heartbeats continue every 200 ms
    expect(messages.length).toBeGreaterThan(mark);
    expect(messages.slice(messages.findIndex((m) => m.includes('running'))).some((m) => m.includes('waiting'))).toBe(false);
    started[1]!.settle();
    expect(textOf(await pending)).toMatch(/status: completed/);
  });

  it('caps a listing of 60 tasks at 50, keeps every running task, and says 10 were left out', () => {
    const views: TaskView[] = Array.from({ length: 60 }, (_, i) => ({
      taskId: `sz-${String(i).padStart(6, 'a')}`,
      agent: 'helper',
      status: i % 20 === 0 ? 'running' : 'completed',
      ...(i % 20 === 0 ? { startedAt: new Date(2026, 0, 1, 0, i, 5).toISOString() } : {}),
      createdAt: new Date(2026, 0, 1, 0, i).toISOString(),
      updatedAt: '',
    }));
    const lines = formatListing(views, true).split('\n');
    const rows = lines.filter((l) => l.startsWith('sz-'));
    expect(rows.length).toBe(50);
    expect(rows.slice(0, 3).every((r) => r.includes('· running, started '))).toBe(true);
    expect(lines.at(-1)).toMatch(/^10 tasks were left out; any task can still be read by its task id/);
  });
});

describe('McpServer process', () => {
  beforeAll(() => {
    execFileSync(process.execPath, ['build.mjs'], { cwd: REPO });
  });

  it('leaves no process of a live child run behind when its stdin closes', async () => {
    const root = makeProject();
    const fake = fakePiEnv({ turn: [{ grandchild: true }, { hang: true }] });
    const server = spawn(process.execPath, [path.join(REPO, 'dist', 'server.js')], {
      cwd: tempDir(),
      env: { ...fake.env, SUBZERO_PROJECT_DIR: root, SUBZERO_PI: FAKE_PI, PI_CODING_AGENT_DIR: tempDir(), SUBZERO_DATA: tempDir() },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const send = (msg: object) => server.stdin.write(JSON.stringify(msg) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'delegate', arguments: { agent: 'helper', brief: 'go' } } });
    await until(() => fake.log().some((l) => l.command === 'prompt'), 10_000);
    const pi = fake.log()[0].pid;
    const grandchild = fake.log().find((l) => l.grandchild)?.grandchild;
    const exited = new Promise((r) => server.once('exit', r));
    server.stdin.end();
    await exited;
    await until(() => !isAlive(pi) && (grandchild === undefined || !isAlive(grandchild)), 10_000);
  });
});
