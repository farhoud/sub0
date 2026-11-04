import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAgent, type AgentDefinition } from '../../src/config/agent-config.js';
import type { ChildOutcome, DomainEvent } from '../../src/core/types.js';
import { PiDriver } from '../../src/pi/driver.js';
import { DEFAULT_YAML, FAKE_PI_COMMAND, fakePiEnv, isAlive, makeProject, tempDir, until } from '../helpers.js';

function setup(scenario: Record<string, unknown> = {}, agentName = 'helper', patch: Partial<AgentDefinition> = {}) {
  const root = makeProject();
  const fake = fakePiEnv(scenario);
  const logs: string[] = [];
  const driver = new PiDriver({
    projectRoot: root,
    sessionsFolder: path.join(root, '.agents', 'subzero', 'sessions'),
    piCommand: FAKE_PI_COMMAND,
    env: fake.env,
    piAgentDir: tempDir(),
    abortWaitMs: 300,
    killWaitMs: 300,
    log: (m) => logs.push(m),
  });
  const agent = { ...getAgent(root, agentName), ...patch };
  const events: DomainEvent[] = [];
  const start = (brief = 'the brief') => driver.start({ taskId: 'sz-abcdef', agent, brief }, (e) => events.push(e));
  return { root, fake, driver, agent, events, logs, start };
}

const commandsSent = (log: any[]) => log.filter((l) => l.command).map((l) => l.command);

describe('PiDriver', () => {
  it('verifies exactly the declared skills, sends the brief and settles with the last assistant text', async () => {
    const { start, events, fake, root } = setup();
    const outcome = await start().outcome;
    expect(outcome).toMatchObject({ status: 'completed', lastAssistantText: 'Done: wrote the answer.' });
    expect(outcome.usage.totalTokens).toBe(1500);
    expect(commandsSent(fake.log())).toEqual(['get_state', 'get_commands', 'prompt', 'get_last_assistant_text', 'get_session_stats']);
    expect(fake.log().find((l) => l.command === 'prompt').message).toBe('the brief');
    expect(events.map((e) => e.kind)).toEqual(['run_started', 'skills_verified', 'agent_message', 'turn_settled']);
    const spec = (events[0] as Extract<DomainEvent, { kind: 'run_started' }>).launchSpec;
    expect(spec.cwd).toBe(root);
    expect(spec.envNames).toEqual(['PI_OFFLINE', 'PI_TELEMETRY']);
    expect(spec.thinkingLevel).toBe('high');
    expect(spec.version).toBe('0.87.0');
    expect(spec.skillFolders).toEqual([
      path.join(root, '.agents', 'subzero', 'tasks', 'sz-abcdef', 'skills', 'alpha'),
      path.join(root, '.agents', 'subzero', 'tasks', 'sz-abcdef', 'skills', 'beta'),
    ]);
    expect(JSON.stringify(spec)).not.toContain('the brief');
    const argv = fake.log()[0];
    expect(argv.env).toEqual({ PI_OFFLINE: '1', PI_TELEMETRY: '0' });
  });

  it('buffers message deltas into one agent message', async () => {
    const { start, events } = setup();
    await start().outcome;
    expect(events.filter((e) => e.kind === 'agent_message')).toEqual([{ kind: 'agent_message', text: 'Done: wrote the answer.' }]);
  });

  it('fails as skill_mismatch naming an extra skill, sends no prompt and kills the process', async () => {
    const { start, fake } = setup({ extraSkills: ['brave-search'] });
    const outcome = await start().outcome;
    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'skill_mismatch' });
    expect(outcome.message).toMatch(/extra skill brave-search/);
    expect(commandsSent(fake.log())).not.toContain('prompt');
    expect(isAlive(fake.log()[0].pid)).toBe(false);
  });

  it('fails as skill_mismatch naming a skill pi did not load', async () => {
    const { start } = setup({ dropSkills: ['beta'] });
    expect((await start().outcome).message).toMatch(/missing skill beta/);
  });

  it('fails as skill_mismatch before spawn when a skill folder is missing', async () => {
    const { start, fake, root, events } = setup();
    rmSync(path.join(root, '.agents', 'skills', 'beta'), { recursive: true });
    const outcome = await start().outcome;
    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'skill_mismatch' });
    expect(outcome.message).toMatch(/missing skill folder: beta/);
    expect(fake.log()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('settles only at agent_settled, not at agent_end', async () => {
    const turn = [
      { emit: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'first' }], stopReason: 'stop' } } },
      { emit: { type: 'agent_end', messages: [], willRetry: true } },
      { sleep: 100 },
      { emit: { type: 'auto_retry_start', attempt: 1 } },
      { emit: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'second' }], stopReason: 'length' } } },
      { emit: { type: 'agent_end', messages: [], willRetry: false } },
      { emit: { type: 'agent_settled' } },
    ];
    const { start, events } = setup({ turn, lastText: 'second' });
    const outcome = await start().outcome;
    expect(outcome).toMatchObject({ status: 'truncated', lastAssistantText: 'second' });
    expect(events.map((e) => e.kind)).toContain('retrying');
  });

  it('maps the stop reasons error and aborted', async () => {
    const errorTurn = [
      { emit: { type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'rate limited' } } },
      { emit: { type: 'agent_settled' } },
    ];
    expect(await setup({ turn: errorTurn }).start().outcome).toMatchObject({ status: 'failed', failureKind: 'error', message: 'rate limited' });
    const abortedTurn = [
      { emit: { type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'aborted' } } },
      { emit: { type: 'agent_settled' } },
    ];
    const aborted = await setup({ turn: abortedTurn }).start().outcome;
    expect(aborted.status).toBe('cancelled');
    expect(aborted.failureKind).toBeUndefined();
  });

  it('fails with error "no assistant message" when the run settles without one', async () => {
    const outcome = await setup({ turn: [{ emit: { type: 'agent_settled' } }] }).start().outcome;
    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'error', message: 'no assistant message' });
  });

  it('ends as timeout and leaves no process of the group, including a grandchild', async () => {
    const { start, fake } = setup({ turn: [{ grandchild: true }, { hang: true }], ignoreAbort: true, ignoreStdinEnd: true }, 'helper', { timeout: 0.6 });
    const outcome = await start().outcome;
    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'timeout' });
    const log = fake.log();
    expect(commandsSent(log)).toEqual(expect.arrayContaining(['clear_queue', 'abort']));
    const pi = log[0].pid;
    const grandchild = log.find((l) => l.grandchild).grandchild;
    await until(() => !isAlive(pi) && !isAlive(grandchild));
  });

  it('ends as crashed with the stderr tail when pi exits non-zero mid-turn', async () => {
    const { start, events } = setup({ turn: [{ exit: 3, stderr: 'segfault in model loader\n' }] });
    const outcome = await start().outcome;
    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'crashed' });
    expect(events).toContainEqual({ kind: 'stderr_tail', text: 'segfault in model loader' });
  });

  it('ends as error naming the model when pi does not know it', async () => {
    const { start } = setup({ exitBeforeReady: { code: 1, stderr: 'Model "local/qwen" not found\n' } });
    expect(await start().outcome).toMatchObject({ status: 'failed', failureKind: 'error', message: 'unknown model: local/qwen' });
  });

  it('cancels a live turn with clear_queue then abort, and the status comes from the cancel', async () => {
    const { start, fake } = setup({ turn: [{ hang: true }] });
    const run = start();
    await until(() => commandsSent(fake.log()).includes('prompt'));
    run.cancel();
    const outcome = await run.outcome;
    expect(outcome.status).toBe('cancelled');
    expect(outcome.failureKind).toBeUndefined();
    const sent = commandsSent(fake.log());
    expect(sent.indexOf('clear_queue')).toBeLessThan(sent.indexOf('abort'));
    await until(() => !isAlive(fake.log()[0].pid));
  });

  it('kills the group when pi ignores abort, stdin EOF and SIGTERM', async () => {
    const { start, fake } = setup({ turn: [{ hang: true }], ignoreAbort: true, ignoreStdinEnd: true, ignoreSigterm: true });
    const run = start();
    await until(() => commandsSent(fake.log()).includes('prompt'));
    run.cancel();
    expect((await run.outcome).status).toBe('cancelled');
    await until(() => !isAlive(fake.log()[0].pid));
  });

  it('lets the first termination win and ignores a cancel after settlement', async () => {
    const { start } = setup();
    const run = start();
    const outcome: ChildOutcome = await run.outcome;
    run.cancel();
    expect(outcome.status).toBe('completed');
  });

  it('logs and ignores an unrecognized pi event, and carries the tool and its path', async () => {
    const turn = [
      { emit: { type: 'brand_new_event', x: 1 } },
      { emit: { type: 'entry_appended', entry: {} } },
      { emit: { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'write', args: { path: 'run/answer.json', content: 'SECRET' } } },
      { emit: { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'write', result: { content: [{ type: 'text', text: 'ok' }] }, isError: false } },
      { emit: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' } } },
      { emit: { type: 'agent_settled' } },
    ];
    const { start, logs, events } = setup({ turn });
    expect((await start().outcome).status).toBe('completed');
    expect(logs.some((l) => l.includes('brand_new_event'))).toBe(true);
    expect(logs.some((l) => l.includes('entry_appended'))).toBe(false);
    expect(events).toContainEqual({ kind: 'tool_activity', phase: 'start', tool: 'write', path: 'run/answer.json' });
    // pi sends no args on the end event; the path is carried over from the start.
    expect(events).toContainEqual({ kind: 'tool_activity', phase: 'end', tool: 'write', path: 'run/answer.json', isError: false });
    expect(JSON.stringify(events)).not.toContain('SECRET');
  });

  it('records a warning and still starts when SYSTEM.md exists', async () => {
    const agentDir = tempDir();
    writeFileSync(path.join(agentDir, 'SYSTEM.md'), 'be someone else');
    const root = makeProject();
    const fake = fakePiEnv();
    const driver = new PiDriver({ projectRoot: root, sessionsFolder: path.join(root, 's'), piCommand: FAKE_PI_COMMAND, env: fake.env, piAgentDir: agentDir });
    const events: DomainEvent[] = [];
    const outcome = await driver.start({ taskId: 'sz-abcdef', agent: getAgent(root, 'helper'), brief: 'b' }, (e) => events.push(e)).outcome;
    expect(events[0]).toMatchObject({ kind: 'warning' });
    expect(outcome.status).toBe('completed');
  });

  it('decodes a message with U+2028 and a split multi-byte character from pi', async () => {
    const message = { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'a b ✓' }], stopReason: 'stop' } };
    const raw = JSON.stringify(message) + '\n';
    const splitAt = Buffer.from(raw).indexOf(0xe2) + 1;
    const { start, events } = setup({ turn: [{ raw, splitAt }, { emit: { type: 'agent_settled' } }], lastText: 'a b ✓' });
    expect((await start().outcome).lastAssistantText).toBe('a b ✓');
    expect(events).toContainEqual({ kind: 'agent_message', text: 'a b ✓' });
  });

  it('compares by the frontmatter name pi uses, not the skills-map key', async () => {
    const yaml = DEFAULT_YAML.replace('alpha: ./skills/alpha', 'web: ./skills/alpha').replace('skills: [alpha, beta]', 'skills: [web, beta]').replace('skills: [alpha]', 'skills: [web]');
    const root = makeProject(yaml);
    const fake = fakePiEnv();
    const driver = new PiDriver({ projectRoot: root, sessionsFolder: path.join(root, 's'), piCommand: FAKE_PI_COMMAND, env: fake.env, piAgentDir: tempDir() });
    const outcome = await driver.start({ taskId: 'sz-abcdef', agent: getAgent(root, 'helper'), brief: 'b' }, () => {}).outcome;
    expect(outcome.status).toBe('completed');
  });

  it('kills the detached shells of pi on timeout, as pi bash spawns them', async () => {
    const { start, fake } = setup(
      { turn: [{ grandchild: 'detached' }, { hang: true }], ignoreAbort: true, ignoreStdinEnd: true, ignoreSigterm: true },
      'helper',
      { timeout: 0.6 },
    );
    expect((await start().outcome).failureKind).toBe('timeout');
    const grandchild = fake.log().find((l) => l.grandchild).grandchild;
    await until(() => !isAlive(grandchild) && !isAlive(fake.log()[0].pid));
  });

  it('stops the detached shells of pi on cancel when pi itself exits on stdin EOF', async () => {
    const { start, fake } = setup({ turn: [{ grandchild: 'detached' }, { hang: true }], ignoreAbort: true });
    const run = start();
    await until(() => fake.log().some((l) => l.grandchild));
    run.cancel();
    expect((await run.outcome).status).toBe('cancelled');
    const grandchild = fake.log().find((l) => l.grandchild).grandchild;
    await until(() => !isAlive(grandchild) && !isAlive(fake.log()[0].pid));
  });

  it('reports a lost pipe as crashed even when pi then exits cleanly', async () => {
    const outcome = await setup({ turn: [{ closeStdout: true }, { hang: true }] }).start().outcome;
    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'crashed', message: 'lost the pipe to pi' });
  });

  it('fails as skill_mismatch when two declared folders share one frontmatter name', async () => {
    const root = makeProject();
    writeFileSync(path.join(root, '.agents', 'skills', 'beta', 'SKILL.md'), '---\nname: alpha\n---\nB.\n');
    const fake = fakePiEnv({ dropSkills: ['beta'] });
    const driver = new PiDriver({ projectRoot: root, sessionsFolder: path.join(root, 's'), piCommand: FAKE_PI_COMMAND, env: fake.env, piAgentDir: tempDir() });
    const outcome = await driver.start({ taskId: 'sz-abcdef', agent: getAgent(root, 'helper'), brief: 'b' }, () => {}).outcome;
    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'skill_mismatch' });
  });

  it('does not hang when pi closes its stdout but keeps running', async () => {
    const { start, fake } = setup({ turn: [{ closeStdout: true }, { hang: true }], ignoreStdinEnd: true });
    const outcome = await start().outcome;
    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'crashed' });
    await until(() => !isAlive(fake.log()[0].pid));
  });

  it('fails with error "no assistant message" when pi exits cleanly before settling with none', async () => {
    expect(await setup({ turn: [{ exit: 0 }] }).start().outcome).toMatchObject({ status: 'failed', failureKind: 'error', message: 'no assistant message' });
  });

  it('names the model when pi started on an unknown id and the run errors', async () => {
    const turn = [
      { emit: { type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: '404 model' } } },
      { emit: { type: 'agent_settled' } },
    ];
    const outcome = await setup({ turn, stderrAtStart: 'Warning: Model "qwen" not found for provider "local". Using custom model id.\n' }).start().outcome;
    expect(outcome.message).toBe('unknown model: local/qwen: 404 model');
  });

  it('keeps the skill overlay after the run', async () => {
    const { start, root } = setup();
    await start().outcome;
    const overlay = path.join(root, '.agents', 'subzero', 'tasks', 'sz-abcdef', 'skills', 'alpha', 'SKILL.md');
    expect(existsSync(overlay)).toBe(true);
  });
});
