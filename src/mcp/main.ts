// @sigil implements design/mcp-server.sigil McpServer (process entry)
//
// node dist/server.js, started by Claude Code from the plugin's .mcp.json. The
// project root comes from SUBZERO_PROJECT_DIR or the roots Claude Code reports,
// never from this process's working directory.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DelegationService } from '../service/delegation-service.js';
import { dataDir, readParentSessionId, setting } from './parent-session.js';
import { createSubzeroServer } from './server.js';

const env = { ...process.env };
if (setting(env.SUBZERO_PROJECT_DIR) === undefined) delete env.SUBZERO_PROJECT_DIR;

let server: ReturnType<typeof createSubzeroServer>;
const pi = setting(env.SUBZERO_PI);
const service = new DelegationService({
  env,
  ...(pi !== undefined ? { driver: { piCommand: [pi] } } : {}),
  roots: async () => {
    if (!server.getClientCapabilities()?.roots) return [];
    const { roots } = await server.listRoots();
    return roots.map((root) => root.uri);
  },
});
const data = dataDir(env);
server = createSubzeroServer({
  service,
  parentSessionId: () => readParentSessionId(data, service.projectRoot),
});

// Start-up goes through the service so the start-up sweep runs; when no root
// resolves yet, each later call tries again and reports the error.
server.oninitialized = () => void service.start().catch(() => undefined);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  // Leave no child run behind: past the deadline the service kills what is left.
  // If this process is killed first, pi still sees EOF on its stdin and exits.
  await service.shutdown(8000);
  process.exit(0);
}
process.stdin.on('end', () => void shutdown());
process.stdin.on('close', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await server.connect(new StdioServerTransport());
