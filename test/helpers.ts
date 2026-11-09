import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildPort } from '../src/core/types.js';
import { Kernel } from '../src/kernel/kernel.js';
import { PI_HOST, PiDriver, type PiDriverOptions } from '../src/pi/driver.js';

export const FAKE_PI = fileURLToPath(new URL('./fake-pi/fake-pi.mjs', import.meta.url));
export const FAKE_PI_COMMAND = [process.execPath, FAKE_PI];

export function tempDir(prefix = 'subzero-test-'): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
}

export const DEFAULT_YAML = `
skills:
  alpha: ./skills/alpha
  beta: ./skills/beta
endpoints:
  local:
    parallel: 1
agents:
  helper:
    description: A test helper
    host: pi
    model: local/qwen
    thinking: high
    skills: [alpha, beta]
    tools: [read, write]
    timeout: 30
  other:
    description: Another helper on the same endpoint
    host: pi
    model: local/qwen-small
    thinking: low
    skills: [alpha]
    tools: [read]
    timeout: 30
  free:
    description: An agent on an endpoint with no entry
    host: pi
    model: cloud/model
    thinking: low
    skills: []
    tools: [read]
    timeout: 30
`;

/** A project root with .agents/subzero.yaml and the skill folders it names. */
export function makeProject(yaml = DEFAULT_YAML): string {
  const root = tempDir('subzero-project-');
  mkdirSync(path.join(root, '.agents', 'skills', 'alpha'), { recursive: true });
  mkdirSync(path.join(root, '.agents', 'skills', 'beta'), { recursive: true });
  writeFileSync(path.join(root, '.agents', 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\nAlpha.\n');
  writeFileSync(path.join(root, '.agents', 'skills', 'beta', 'SKILL.md'), '---\nname: beta\n---\nBeta.\n');
  writeFileSync(path.join(root, '.agents', 'subzero.yaml'), yaml);
  return root;
}

export interface FakePiEnv {
  env: NodeJS.ProcessEnv;
  logFile: string;
  log(): any[];
}

export function fakePiEnv(scenario: Record<string, unknown> = {}): FakePiEnv {
  const logFile = path.join(tempDir('subzero-fakepi-'), 'log.jsonl');
  writeFileSync(logFile, '');
  return {
    env: { ...process.env, FAKE_PI_SCENARIO: JSON.stringify(scenario), FAKE_PI_LOG: logFile },
    logFile,
    log: () =>
      readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
  };
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** What an entry point does: a Kernel with PiDriver registered for the host pi. */
export function piKernel(options: PiDriverOptions = {}): { kernel: Kernel; driver: PiDriver } {
  const driver = new PiDriver(options);
  const kernel = new Kernel();
  kernel.registerChildDriver(PI_HOST, driver);
  return { kernel, driver };
}

/** A Kernel whose host pi runs the given child port, for tests that settle runs by hand. */
export function kernelWithPort(port: ChildPort): Kernel {
  const kernel = new Kernel();
  kernel.registerChildDriver(PI_HOST, { port });
  return kernel;
}
