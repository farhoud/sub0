// @sigil implements design/cli.sigil Cli
//
//   subzero run <agent> <brief...>   delegate, wait and print the result
//   subzero tasks                    list every task
//   subzero attach <task id>         reopen the child session in the pi terminal interface
//   subzero show <task id> [-o file] export the child session as HTML
//
// Every command starts through the delegation service, so the start-up sweep runs
// first. A delegation from here carries no parent session id. This file names no
// child driver and no host: the entry point (main.ts) registers the drivers with the
// Kernel it passes in, and attach and show ask that registry.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { LoadError, UnknownAgentError, UnresolvedRootError } from '../config/agent-config.js';
import { isTaskId } from '../core/ids.js';
import { formatResult } from '../mcp/format.js';
import { describeEvent } from '../mcp/progress.js';
import { UnsupportedHostError } from '../kernel/kernel.js';
import { DelegationService, EmptyBriefError, type DelegationServiceOptions } from '../service/delegation-service.js';

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

const USAGE = `usage:
  subzero run <agent> <brief...>
  subzero tasks
  subzero attach <task id>
  subzero show <task id> [-o <file.html>]`;

function knownError(err: unknown): boolean {
  return (
    err instanceof UnknownAgentError ||
    err instanceof LoadError ||
    err instanceof UnresolvedRootError ||
    err instanceof EmptyBriefError ||
    err instanceof UnsupportedHostError
  );
}

export type CliOptions = DelegationServiceOptions & { interactive?: boolean };

export async function runCli(argv: string[], io: CliIo, options: CliOptions): Promise<number> {
  const [command, ...rest] = argv;
  // The working directory is only the fallback; SUBZERO_PROJECT_DIR comes first.
  const service = new DelegationService({ env: process.env, cwd: process.cwd(), ...options });

  try {
    await service.start();
    switch (command) {
      case 'run':
        return await run(service, rest, io);
      case 'tasks':
        return await tasks(service, io);
      case 'attach':
        return await attach(service, rest, io, options);
      case 'show':
        return await show(service, rest, io, options);
      default:
        io.err(USAGE);
        return 2;
    }
  } catch (err) {
    if (knownError(err)) {
      io.err(`subzero: ${(err as Error).message}`);
      return 1;
    }
    throw err;
  }
}

async function run(service: DelegationService, args: string[], io: CliIo): Promise<number> {
  const [agent, ...words] = args;
  if (agent === undefined || words.length === 0) {
    io.err(USAGE);
    return 2;
  }
  // Ctrl-C cancels the child run; the command line has no other cancel.
  const abort = new AbortController();
  const onSigint = () => abort.abort();
  process.on('SIGINT', onSigint);
  try {
    const reply = await service.delegate(
      { agent, briefText: words.join(' ') },
      {
        wait: true,
        signal: abort.signal,
        onEvent: (event) => {
          if (event.kind === 'tool_activity' && event.phase === 'start') io.err(`· ${describeEvent(event)}`);
        },
        onState: (state) => {
          if (state === 'Pending') io.err('· waiting for the endpoint');
        },
      },
    );
    if (reply.kind !== 'result') return 1;
    io.out(formatResult(reply.result));
    return reply.result.status === 'completed' || reply.result.status === 'truncated' ? 0 : 1;
  } finally {
    process.off('SIGINT', onSigint);
  }
}

async function tasks(service: DelegationService, io: CliIo): Promise<number> {
  const views = await service.list();
  views.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (views.length === 0) io.out('no tasks');
  for (const v of views) io.out(`${v.taskId}  ${v.agent}  ${v.status}  ${v.createdAt}`);
  return 0;
}

function taskArg(args: string[], io: CliIo): string | null {
  const id = args[0];
  if (id === undefined || !isTaskId(id)) {
    io.err(USAGE);
    return null;
  }
  return id;
}

async function attach(
  service: DelegationService,
  args: string[],
  io: CliIo,
  options: CliOptions,
): Promise<number> {
  const id = taskArg(args, io);
  if (id === null) return 2;
  await service.list(); // runs the sweep again before reading the status
  const record = service.store.readTask(id);
  if (record === null) {
    io.err(`subzero: no task ${id}`);
    return 1;
  }
  if (record.status === 'running') {
    io.err(`subzero: task ${id} is running; attach once its child run has ended`);
    return 1;
  }
  const spec = record.task?.launchSpec;
  if (spec === undefined) {
    io.err(`subzero: no launch spec was recorded for task ${id}, so it cannot be attached`);
    return 1;
  }
  const host = recordedHost(record.task?.agent);
  const attachCommand = options.kernel.attachCommand(host);
  if (attachCommand === undefined) {
    io.err(`subzero: the child driver of the host ${host} offers no attach command, so task ${id} cannot be attached`);
    return 1;
  }
  const [program, ...rest] = attachCommand(spec);
  if (options.interactive === false) {
    io.out([program, ...rest].join(' '));
    return 0;
  }
  return new Promise((resolve) => {
    const child = spawn(program!, rest, { cwd: spec.cwd, stdio: 'inherit' });
    child.once('error', (err) => {
      io.err(`subzero: could not start ${program}: ${err.message}`);
      resolve(1);
    });
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

/** The host of a recorded agent definition; a record without one has no child driver to ask. */
function recordedHost(agent: { host?: string } | undefined): string {
  return agent?.host ?? '(not recorded)';
}

async function show(
  service: DelegationService,
  args: string[],
  io: CliIo,
  options: CliOptions,
): Promise<number> {
  const id = taskArg(args, io);
  if (id === null) return 2;
  await service.list(); // runs the sweep again before reading the status
  const record = service.store.readTask(id);
  if (record === null) {
    io.err(`subzero: no task ${id}`);
    return 1;
  }
  if (record.status === 'abandoned') io.out(`task ${id} was abandoned: its owner process died, so it has no result.`);

  const sessionFile = record.sessionFile;
  if (sessionFile === undefined) {
    io.err(`subzero: task ${id} has no child session to export`);
    return 1;
  }
  const host = recordedHost(record.task?.agent);
  const sessionExport = options.kernel.sessionExport(host);
  if (sessionExport === undefined) {
    io.err(`subzero: the child driver of the host ${host} offers no session export, so task ${id} cannot be exported`);
    return 1;
  }
  const flag = args.indexOf('-o');
  const output = flag !== -1 && args[flag + 1] ? path.resolve(args[flag + 1]!) : path.resolve(`${id}.html`);
  try {
    await sessionExport(sessionFile, output);
  } catch (err) {
    io.err(`subzero: could not export the child session of ${id}: ${(err as Error).message}`);
    return 1;
  }
  io.out(`exported the child session of ${id} to ${output}`);
  return 0;
}
