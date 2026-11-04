// @sigil implements design/mcp-server.sigil McpServer (SessionStart hook)
//
// Records the Claude session id for the project, so the tasks tool can list the
// tasks of this conversation, including after /clear. It never blocks a session.
import { realpathSync } from 'node:fs';
import { dataDir, setting, writeParentSessionId } from './parent-session.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

try {
  const input = JSON.parse(await readStdin()) as { session_id?: string; cwd?: string };
  // The plugin's .mcp.json sets the server's SUBZERO_PROJECT_DIR from
  // CLAUDE_PROJECT_DIR, so that is the key both sides share.
  const project = setting(process.env.CLAUDE_PROJECT_DIR) ?? input.cwd;
  if (typeof input.session_id === 'string' && project) {
    writeParentSessionId(dataDir(process.env), realpathSync(project), input.session_id);
  }
} catch {
  // A missing session id only widens the listing; it must not fail the session.
}
process.exit(0);
