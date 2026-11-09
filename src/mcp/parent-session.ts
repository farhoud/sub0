// @sigil implements design/mcp-server.sigil McpServer (parent session id, readiness marker)
//
// The SessionStart hook records the Claude session id per project, and the server
// reads it on each call, so a listing stays with this conversation after /clear.
// Two sessions started in one project at once share the file and may mix listings.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** A ${VAR} that the host left unsubstituted counts as unset. */
export function setting(value: string | undefined): string | undefined {
  if (value === undefined || value === '' || /^\$\{[^}]*\}$/.test(value)) return undefined;
  return value;
}

export function dataDir(env: NodeJS.ProcessEnv): string {
  return setting(env.SUBZERO_DATA) ?? setting(env.CLAUDE_PLUGIN_DATA) ?? path.join(homedir(), '.subzero');
}

/** The name of a project's files and folders under the plugin data folder. */
function projectKey(projectRoot: string): string {
  return createHash('sha256').update(projectRoot).digest('hex').slice(0, 16);
}

function sessionFile(dir: string, projectRoot: string): string {
  return path.join(dir, 'sessions', `${projectKey(projectRoot)}.json`);
}

export function readParentSessionId(dir: string, projectRoot: string | undefined): string | undefined {
  if (projectRoot === undefined) return undefined;
  try {
    const value = JSON.parse(readFileSync(sessionFile(dir, projectRoot), 'utf8')) as { sessionId?: unknown };
    return typeof value.sessionId === 'string' && value.sessionId !== '' ? value.sessionId : undefined;
  } catch {
    return undefined;
  }
}

export function writeParentSessionId(dir: string, projectRoot: string, sessionId: string): void {
  const file = sessionFile(dir, projectRoot);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ sessionId, projectRoot, updatedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
}

// The readiness marker: while a server runs for a project, its folder under the plugin
// data folder holds one file named by the server's pid, with that pid and its parent's
// pid (the Claude Code process that started it). The PreToolUse hook denies only while
// a marker names a live process whose parent is one of the hook's own ancestors.

function readinessDir(dir: string, projectRoot: string): string {
  return path.join(dir, 'ready', projectKey(projectRoot));
}

export interface ReadinessMarker {
  pid: number;
  ppid: number;
}

export function writeReadinessMarker(dir: string, projectRoot: string, pid: number, ppid: number): void {
  const folder = readinessDir(dir, projectRoot);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = path.join(folder, `${pid}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ pid, ppid, projectRoot, startedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
}

export function removeReadinessMarker(dir: string, projectRoot: string, pid: number): void {
  rmSync(path.join(readinessDir(dir, projectRoot), `${pid}.json`), { force: true });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: unknown }).code === 'EPERM';
  }
}

/** The markers of a project whose process is alive; a dead one counts as absent. */
export function liveReadinessMarkers(dir: string, projectRoot: string): ReadinessMarker[] {
  const folder = readinessDir(dir, projectRoot);
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return [];
  }
  const live: ReadinessMarker[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const value = JSON.parse(readFileSync(path.join(folder, name), 'utf8')) as { pid?: unknown; ppid?: unknown };
      if (Number.isInteger(value.pid) && Number.isInteger(value.ppid) && isAlive(value.pid as number)) {
        live.push({ pid: value.pid as number, ppid: value.ppid as number });
      }
    } catch {
      // An unreadable marker counts as absent.
    }
  }
  return live;
}
