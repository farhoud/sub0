// @sigil implements design/pi-driver.sigil PiDriver (launch spec, attach command)
import type { AgentDefinition } from '../config/agent-config.js';
import type { LaunchSpec } from '../core/types.js';

/** Environment variables the driver sets for every child run. Names only are recorded. */
export const CHILD_ENV: Readonly<Record<string, string>> = { PI_OFFLINE: '1', PI_TELEMETRY: '0' };

export interface LaunchInputs {
  taskId: string;
  agent: AgentDefinition;
  overlaySkills: string[];
  sessionsFolder: string;
}

/**
 * The exact flag set of a child run. --session is never added: pi 0.87 exits when
 * it is combined with --session-id.
 */
export function launchArgs({ taskId, agent, overlaySkills, sessionsFolder }: LaunchInputs): string[] {
  return [
    '--mode', 'rpc',
    '--offline',
    '-na', '-ne', '-nc', '-np',
    '--no-themes',
    '-ns',
    ...overlaySkills.flatMap((folder) => ['--skill', folder]),
    '--model', agent.model,
    '--thinking', agent.thinking,
    '--tools', agent.tools.join(','),
    '--session-dir', sessionsFolder,
    '--session-id', taskId,
    '--name', `subzero:${agent.name}:${taskId}`,
  ];
}

/**
 * Reopen the child session of a task in the pi terminal interface: the launch spec
 * without --mode rpc and without --session. Its --session-dir and --session-id
 * reopen the existing session.
 */
export function attachCommand(spec: LaunchSpec): string[] {
  const out: string[] = [];
  const command = spec.command;
  for (let i = 0; i < command.length; i++) {
    const arg = command[i]!;
    if (arg === '--mode' && command[i + 1] === 'rpc') {
      i++;
      continue;
    }
    if (arg === '--mode=rpc') continue;
    if (arg === '--session') {
      i++;
      continue;
    }
    if (arg.startsWith('--session=')) continue;
    out.push(arg);
  }
  return out;
}
