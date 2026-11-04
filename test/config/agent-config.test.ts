import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  getAgent,
  LoadError,
  loadAgentFile,
  resolveProjectRoot,
  UnknownAgentError,
  UnresolvedRootError,
} from '../../src/config/agent-config.js';
import { makeProject, tempDir } from '../helpers.js';

function project(agents: string, extra = ''): string {
  return makeProject(`skills:\n  alpha: ./skills/alpha\n${extra}agents:\n${agents}`);
}

const VALID = `  a:
    description: d
    host: pi
    model: local/m
    thinking: high
    skills: [alpha]
    tools: [read]
    timeout: 10
`;

describe('AgentConfig load', () => {
  it('loads a valid pi agent with absolute skill folders', () => {
    const root = project(VALID);
    const agent = getAgent(root, 'a');
    expect(agent.host).toBe('pi');
    expect(agent.thinking).toBe('high');
    expect(agent.tools).toEqual(['read']);
    expect(agent.timeout).toBe(10);
    expect(agent.skills[0]!.folder).toBe(path.join(root, '.agents', 'skills', 'alpha'));
    expect(path.isAbsolute(agent.skills[0]!.folder)).toBe(true);
  });

  it('rejects an unknown host, naming the agent definition', () => {
    const root = project(VALID.replace('host: pi', 'host: codex'));
    expect(() => loadAgentFile(root)).toThrow(/agent "a": host must be pi/);
  });

  it('rejects a pi agent with no model', () => {
    const root = project(VALID.replace('    model: local/m\n', ''));
    expect(() => loadAgentFile(root)).toThrow(/agent "a".*model/);
  });

  it('rejects a missing or non-positive timeout', () => {
    expect(() => loadAgentFile(project(VALID.replace('    timeout: 10\n', '')))).toThrow(/agent "a": timeout is required/);
    expect(() => loadAgentFile(project(VALID.replace('timeout: 10', 'timeout: 0')))).toThrow(/agent "a": timeout must be a positive/);
  });

  it('rejects a skill missing from the skills map, naming agent and skill', () => {
    const root = project(VALID.replace('[alpha]', '[alpha, gamma]'));
    expect(() => loadAgentFile(root)).toThrow(/agent "a": skill "gamma"/);
  });

  it('still loads a skill folder that does not exist on disk', () => {
    const root = makeProject(`skills:\n  ghost: ./nowhere\nagents:\n${VALID.replace('[alpha]', '[ghost]')}`);
    expect(getAgent(root, 'a').skills[0]!.folder).toBe(path.join(root, '.agents', 'nowhere'));
  });

  it('gives an unknown agent error that lists every configured agent definition', () => {
    const root = project(VALID + VALID.replace('  a:', '  b:'));
    try {
      getAgent(root, 'zed');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownAgentError);
      expect((err as UnknownAgentError).configured).toEqual(['a', 'b']);
      expect((err as Error).message).toMatch(/zed.*a, b/);
    }
  });

  it('fails the whole load on one invalid agent definition', () => {
    const root = project(VALID + VALID.replace('  a:', '  b:').replace('host: pi', 'host: x'));
    expect(() => getAgent(root, 'a')).toThrow(/agent "b"/);
  });

  it('reports a missing or malformed agent file', () => {
    const root = tempDir();
    expect(() => loadAgentFile(root)).toThrow(LoadError);
    expect(() => loadAgentFile(root)).toThrow(/missing/);
    mkdirSync(path.join(root, '.agents'));
    writeFileSync(path.join(root, '.agents', 'subzero.yaml'), 'agents: [unclosed');
    expect(() => loadAgentFile(root)).toThrow(/malformed/);
  });

  it('reads the agent file again on each call', () => {
    const root = project(VALID);
    expect(getAgent(root, 'a').thinking).toBe('high');
    writeFileSync(path.join(root, '.agents', 'subzero.yaml'), `skills:\n  alpha: ./skills/alpha\nagents:\n${VALID.replace('high', 'low')}`);
    expect(getAgent(root, 'a').thinking).toBe('low');
  });

  it('gives agents on one endpoint its parallel limit, and none without an entry', () => {
    const agents =
      VALID.replace('local/m', 'r9700/Qwen3.8') +
      VALID.replace('  a:', '  b:').replace('local/m', 'r9700/Qwen3.8-small') +
      VALID.replace('  a:', '  c:').replace('local/m', 'anthropic/claude');
    const root = project(agents, 'endpoints:\n  r9700:\n    parallel: 1\n');
    const { agents: loaded } = loadAgentFile(root);
    expect(loaded.get('a')).toMatchObject({ endpoint: 'r9700', parallel: 1 });
    expect(loaded.get('b')).toMatchObject({ endpoint: 'r9700', parallel: 1 });
    expect(loaded.get('c')).toMatchObject({ endpoint: 'anthropic', parallel: null });
  });

  it('rejects an endpoint entry that no agent belongs to, naming it', () => {
    const root = project(VALID, 'endpoints:\n  r9770:\n    parallel: 1\n');
    expect(() => loadAgentFile(root)).toThrow(/endpoint "r9770"/);
  });

  it('rejects a parallel limit that is not a positive whole number', () => {
    for (const bad of ['0', '1.5', '"two"']) {
      const root = project(VALID, `endpoints:\n  local:\n    parallel: ${bad}\n`);
      expect(() => loadAgentFile(root)).toThrow(/endpoint "local": parallel/);
    }
  });
});

describe('AgentConfig project root', () => {
  it('prefers SUBZERO_PROJECT_DIR, resolving symbolic links', async () => {
    const real = tempDir();
    const link = path.join(tempDir(), 'link');
    symlinkSync(real, link);
    const other = tempDir();
    expect(await resolveProjectRoot({ env: { SUBZERO_PROJECT_DIR: link }, roots: () => [other], cwd: other })).toBe(real);
  });

  it('treats an empty SUBZERO_PROJECT_DIR as unset and takes the first reported root', async () => {
    const first = tempDir();
    const second = tempDir();
    const root = await resolveProjectRoot({ env: { SUBZERO_PROJECT_DIR: '' }, roots: () => [pathToFileURL(first).href, second] });
    expect(root).toBe(first);
  });

  it('falls back to the command line working directory', async () => {
    const cwd = tempDir();
    expect(await resolveProjectRoot({ env: {}, cwd })).toBe(cwd);
  });

  it('returns the unresolved root error naming SUBZERO_PROJECT_DIR when no source gives one', async () => {
    const root = await resolveProjectRoot({ env: {}, roots: () => [] });
    expect(root).toBeInstanceOf(UnresolvedRootError);
    expect((root as Error).message).toMatch(/SUBZERO_PROJECT_DIR/);
  });
});
