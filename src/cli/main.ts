// @sigil implements design/cli.sigil Cli
//
//   subzero run <agent> <brief...>   delegate, wait and print the result
//   subzero tasks                    list every task
//   subzero attach <task id>         reopen the child session in the pi terminal interface
//   subzero show <task id> [-o file] export the child session as HTML
//
// Every command starts through the delegation service, so the start-up sweep runs
// first. A delegation from here carries no parent session id.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { LoadError, UnknownAgentError, UnresolvedRootError } from '../config/agent-config.js';
import { isTaskId } from '../core/ids.js';
import { formatResult } from '../mcp/format.js';
import { describeEvent } from '../mcp/progress.js';
import { PiDriver } from '../pi/driver.js';
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
    err instanceof EmptyBriefError
  );
}

export async function runCli(
  argv: string[],
  io: CliIo,
  options: DelegationServiceOptions & { interactive?: boolean } = {},
): Promise<number> {
  const [command, ...rest] = argv;
  // The working directory is only the fallback; SUBZERO_PROJECT_DIR comes first.
  const pi = process.env.SUBZERO_PI;
  const service = new DelegationService({
    env: process.env,
    cwd: process.cwd(),
    ...(pi ? { driver: { piCommand: [pi] } } : {}),
    ...options,
  });

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
  options: { interactive?: boolean },
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
  const [program, ...rest] = PiDriver.attachCommand(spec);
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

async function show(
  service: DelegationService,
  args: string[],
  io: CliIo,
  options: DelegationServiceOptions,
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
  const flag = args.indexOf('-o');
  const output = flag !== -1 && args[flag + 1] ? path.resolve(args[flag + 1]!) : path.resolve(`${id}.html`);
  const [program, ...lead] = options.driver?.piCommand ?? (process.env.SUBZERO_PI ? [process.env.SUBZERO_PI] : ['pi']);
  return new Promise((resolve) => {
    const child = spawn(program!, [...lead, '--export', sessionFile, output], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', (err) => {
      io.err(`subzero: could not start ${program}: ${err.message}`);
      resolve(1);
    });
    child.once('exit', (code) => {
      if (code === 0) io.out(`exported the child session of ${id} to ${output}`);
      resolve(code ?? 1);
    });
  });
}

const isEntry = process.argv[1] !== undefined && /(?:^|[\\/])(cli\.js|main\.ts|subzero)$/.test(process.argv[1]);
if (isEntry) {
  const code = await runCli(process.argv.slice(2), {
    out: (t) => process.stdout.write(`${t}\n`),
    err: (t) => process.stderr.write(`${t}\n`),
  });
  process.exit(code);
}
