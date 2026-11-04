// @sigil implements design/mcp-server.sigil McpServer (parent session id)
//
// The SessionStart hook records the Claude session id per project, and the server
// reads it on each call, so a listing stays with this conversation after /clear.
// Two sessions started in one project at once share the file and may mix listings.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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

function sessionFile(dir: string, projectRoot: string): string {
  const key = createHash('sha256').update(projectRoot).digest('hex').slice(0, 16);
  return path.join(dir, 'sessions', `${key}.json`);
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
