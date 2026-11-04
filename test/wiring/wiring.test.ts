import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAgentFile } from '../../src/config/agent-config.js';
import { readParentSessionId } from '../../src/mcp/parent-session.js';
import { tempDir } from '../helpers.js';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const EXAMPLE = path.join(REPO, 'examples', 'sigil');
const agentFile = (name: string) => readFileSync(path.join(EXAMPLE, 'agents', name), 'utf8');

/** Remove the one routing name so two definitions can be compared. */
const unroute = (text: string, name: string) => text.replace(`\`${name}\``, '`<route>`');

describe('SigilWiring', () => {
  it('defines the three interpreter agents on the staged skills, sharing the r9700 limit', () => {
    const { agents } = loadAgentFile(EXAMPLE);
    expect([...agents.keys()].sort()).toEqual(['sigil-interpreter', 'sigil-interpreter-control', 'sigil-interpreter-low']);
    const qwen = agents.get('sigil-interpreter')!;
    expect(qwen).toMatchObject({ model: 'r9700/Qwen3.8', thinking: 'high', endpoint: 'r9700', parallel: 1 });
    expect(qwen.tools).toEqual(['read', 'grep', 'find', 'ls', 'write']);
    expect(qwen.skills.map((s) => s.folder)).toEqual([path.join(EXAMPLE, 'skills', 'sigil-understand'), path.join(EXAMPLE, 'skills', 'sigil-egglog')]);
    expect(agents.get('sigil-interpreter-low')).toMatchObject({ thinking: 'low', parallel: 1 });
    expect(agents.get('sigil-interpreter-control')).toMatchObject({ thinking: 'high', parallel: null });
  });

  it('keeps the B evaluators identical except for the interpreter they route to, and disallows Agent', () => {
    const b = unroute(agentFile('evaluator-b.md'), 'sigil-interpreter');
    expect(unroute(agentFile('evaluator-b-control.md'), 'sigil-interpreter-control')).toBe(b);
    expect(unroute(agentFile('evaluator-b-low.md'), 'sigil-interpreter-low')).toBe(b);
    expect(b).toMatch(/^disallowedTools: Agent$/m);
    expect(b).toContain('mcp__plugin_subzero_subzero__delegate');
  });

  it('keeps the A evaluators identical except for the interpreter subagent, with the Agent tool', () => {
    const a = unroute(agentFile('evaluator-a.md'), 'interpreter');
    expect(unroute(agentFile('evaluator-a-cheap.md'), 'interpreter-cheap')).toBe(a);
    expect(a).not.toMatch(/disallowedTools/);
    expect(agentFile('interpreter-a-cheap.md')).toMatch(/^model: haiku$/m);
  });

  it('puts the answer-file rule and the brief fields in every evaluator', () => {
    for (const file of ['evaluator-a.md', 'evaluator-b.md']) {
      const text = agentFile(file);
      expect(text).toContain('Write your claim rows to exactly that answer file');
      expect(text).toMatch(/request path, the binding path and every guidance path/);
      expect(text).toMatch(/exact answer file path, and the round/);
    }
  });
});

describe('SessionStart hook', () => {
  it('records the session id that the server reads for the project', () => {
    execFileSync(process.execPath, ['build.mjs'], { cwd: REPO });
    const data = tempDir();
    const project = tempDir();
    execFileSync(process.execPath, [path.join(REPO, 'dist', 'hook.js')], {
      input: JSON.stringify({ session_id: 'abc-123', cwd: project, source: 'startup' }),
      env: { ...process.env, CLAUDE_PLUGIN_DATA: data, CLAUDE_PROJECT_DIR: project },
    });
    expect(readParentSessionId(data, project)).toBe('abc-123');
  });
});
