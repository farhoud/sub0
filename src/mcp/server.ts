// @sigil implements design/mcp-server.sigil McpServer
//
// The plugin's MCP server: four tools backed by DelegationService. Claude Code
// names them mcp__plugin_subzero_subzero__<tool>.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { LoadError, TierError, UnknownAgentError, UnresolvedRootError } from '../config/agent-config.js';
import { isTaskId } from '../core/ids.js';
import { EmptyBriefError, type DelegationService } from '../service/delegation-service.js';
import { bound, describeReply, formatListing } from './format.js';
import { ProgressReporter, type ProgressOptions } from './progress.js';

export const SERVER_INSTRUCTIONS = [
  'Use the delegate tool to hand a task to a configured subzero agent.',
  'Write a self-contained brief: the goal, the relevant file paths, the constraints and the output you expect.',
  'The child cannot see this conversation; it sees only the brief.',
].join(' ');

export const MAX_AWAIT_SECONDS = 600;

const TOOLS = [
  {
    name: 'delegate',
    description:
      'Delegate a task to a subzero agent running on another model. Returns the result with the task id first, or the task id at once when wait is false.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Name of an agent in .agents/subzero.yaml' },
        brief: { type: 'string', description: 'A self-contained brief; the child cannot see this conversation' },
        files: { type: 'array', items: { type: 'string' }, description: 'Paths the child should read' },
        expected_output: { type: 'string', description: 'What the result should contain' },
        wait: { type: 'boolean', description: 'Wait for the result (default true)' },
      },
      required: ['agent', 'brief'],
    },
    _meta: { 'anthropic/alwaysLoad': true },
  },
  {
    name: 'tasks',
    description: 'List the tasks of this conversation (at most 50), or show one task by its task id.',
    inputSchema: { type: 'object', properties: { task: { type: 'string' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'await',
    description: 'Collect the results of tasks started with wait: false, waiting up to timeout_s seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        tasks: { type: 'array', items: { type: 'string' } },
        timeout_s: { type: 'number', description: `Seconds to wait, at most ${MAX_AWAIT_SECONDS}` },
      },
      required: ['tasks'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'cancel',
    description: 'Cancel a task; it ends with the status cancelled.',
    inputSchema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
  },
];

export interface SubzeroServerOptions {
  service: DelegationService;
  /** The parent session id of the current conversation, when the hook recorded it. */
  parentSessionId: () => string | undefined;
  progress?: ProgressOptions;
  version?: string;
}

function text(body: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: bound(body) }], ...(isError ? { isError: true } : {}) };
}

function toolError(err: unknown): CallToolResult {
  if (err instanceof UnresolvedRootError) {
    return text(
      `${err.message} This is a configuration problem the user must fix; do not retry this call.`,
      true,
    );
  }
  if (err instanceof UnknownAgentError || err instanceof TierError || err instanceof LoadError || err instanceof EmptyBriefError) {
    return text(err.message, true);
  }
  return text(`subzero failed: ${(err as Error)?.message ?? String(err)}`, true);
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === 'string' ? (args[key] as string) : undefined;
}

export function createSubzeroServer(options: SubzeroServerOptions): Server {
  const { service } = options;
  const server = new Server(
    { name: 'subzero', version: options.version ?? '0.0.1-spike' },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      switch (request.params.name) {
        case 'delegate': {
          const agent = stringArg(args, 'agent');
          const brief = stringArg(args, 'brief');
          if (agent === undefined || brief === undefined) return text('delegate needs an agent and a brief', true);
          const files = Array.isArray(args.files) ? args.files.filter((f): f is string => typeof f === 'string') : undefined;
          const expectedOutput = stringArg(args, 'expected_output');
          const wait = args.wait !== false;
          // Connect first, so the parent session id is read for the resolved root.
          await service.start();
          const parentSessionId = options.parentSessionId();

          const progressToken = request.params._meta?.progressToken;
          const reporter =
            wait && progressToken !== undefined
              ? new ProgressReporter(
                  agent,
                  (progress, message) =>
                    void extra
                      .sendNotification({ method: 'notifications/progress', params: { progressToken, progress, message } })
                      .catch(() => undefined),
                  options.progress,
                )
              : null;
          try {
            const reply = await service.delegate(
              {
                agent,
                briefText: brief,
                ...(files !== undefined ? { files } : {}),
                ...(expectedOutput !== undefined ? { expectedOutput } : {}),
                ...(parentSessionId !== undefined ? { parentSessionId } : {}),
              },
              {
                wait,
                ...(reporter ? { onEvent: (e) => reporter.onEvent(e), onState: (s) => reporter.onState(s) } : {}),
                // notifications/cancelled for a waited call cancels its task.
                ...(wait ? { signal: extra.signal } : {}),
              },
            );
            return text(describeReply(reply));
          } finally {
            reporter?.stop();
          }
        }

        case 'tasks': {
          const task = stringArg(args, 'task');
          if (task !== undefined) {
            if (!isTaskId(task)) return text(`"${task}" is not a task id`, true);
            const views = await service.list();
            const view = views.find((v) => v.taskId === task);
            if (view === undefined) return text(`task: ${task} · no such task`);
            return text(describeReply(await service.collect(task), view));
          }
          await service.start();
          const parentSessionId = options.parentSessionId();
          const views = await service.list(parentSessionId);
          return text(formatListing(views, parentSessionId !== undefined));
        }

        case 'await': {
          const ids = Array.isArray(args.tasks) ? args.tasks.filter((t): t is string => typeof t === 'string') : [];
          if (ids.length === 0) return text('await needs at least one task id', true);
          const seconds = typeof args.timeout_s === 'number' && args.timeout_s >= 0 ? Math.min(args.timeout_s, MAX_AWAIT_SECONDS) : 30;
          const replies = await Promise.all(ids.map((id) => service.waitFor(id, seconds * 1000)));
          return text(replies.map((r) => describeReply(r)).join('\n\n'));
        }

        case 'cancel': {
          const task = stringArg(args, 'task');
          if (task === undefined) return text('cancel needs a task id', true);
          return text(describeReply(await service.cancel(task)));
        }

        default:
          return text(`unknown tool ${request.params.name}`, true);
      }
    } catch (err) {
      return toolError(err);
    }
  });

  return server;
}
