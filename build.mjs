// Bundles each entry into one file under dist/, so the plugin runs with no install step.
import { build } from 'esbuild';

const entries = {
  server: 'src/mcp/main.ts',
  hook: 'src/mcp/session-hook.ts',
  cli: 'src/cli/main.ts',
};

for (const [name, entry] of Object.entries(entries)) {
  await build({
    entryPoints: [entry],
    outfile: `dist/${name}.js`,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    banner: {
      js: [
        name === 'cli' ? '#!/usr/bin/env node' : '',
        "import { createRequire as __subzeroCreateRequire } from 'node:module';",
        'const require = __subzeroCreateRequire(import.meta.url);',
      ].filter(Boolean).join('\n'),
    },
    logLevel: 'warning',
  });
}
