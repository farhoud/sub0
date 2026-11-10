import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const WORKFLOW = path.resolve(import.meta.dirname, '..', '..', '.github', 'workflows', 'release.yml');
const text = readFileSync(WORKFLOW, 'utf8');

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps: Step[];
}
const workflow = parse(text) as { on: { push: { tags: string[]; branches?: string[] } }; jobs: Record<string, Job> };
const build = workflow.jobs.build!;
const release = workflow.jobs.release!;

const runs = (job: Job) => job.steps.flatMap((step) => (step.run === undefined ? [] : [step.run]));
const indexOfRun = (job: Job, needle: string) => job.steps.findIndex((step) => step.run?.includes(needle));
const indexOfUses = (job: Job, needle: string) => job.steps.findIndex((step) => step.uses?.startsWith(needle));

describe('.github/workflows/release.yml', () => {
  it('triggers on tags matching v* only', () => {
    expect(workflow.on.push.tags).toEqual(['v*']);
    expect(workflow.on.push.branches).toBeUndefined();
    expect(Object.keys(workflow.on)).toEqual(['push']);
  });

  it('has exactly a build job and a release job', () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual(['build', 'release']);
  });

  it('runs the build job read-only: npm ci, the build, the zip with the tag check, and an artifact upload', () => {
    expect(build.permissions).toEqual({ contents: 'read' });
    const scripts = runs(build);
    expect(scripts.some((script) => script.includes('npm ci'))).toBe(true);
    expect(scripts.some((script) => script.includes('npm run build'))).toBe(true);
    // The workflow calls the script directly: `npm run release:build` prints banners on stdout.
    expect(scripts.join('\n')).not.toContain('release:build');
    expect(scripts.some((script) => /node scripts\/build-plugin\.mjs --tag "\$GITHUB_REF_NAME"/.test(script))).toBe(true);
    expect(indexOfUses(build, 'actions/upload-artifact@')).toBeGreaterThan(indexOfRun(build, 'build-plugin.mjs'));
    const setup = build.steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
    expect(String(setup?.with?.['node-version'])).toBe('22');
  });

  it('runs the release job with contents: write, after the build job, without any npm command', () => {
    expect(release.permissions).toEqual({ contents: 'write' });
    expect([release.needs].flat()).toEqual(['build']);
    expect(indexOfUses(release, 'actions/download-artifact@')).toBeGreaterThanOrEqual(0);
    for (const script of runs(release)) expect(script, script).not.toMatch(/\bnpm\b|\bnpx\b|\bpnpm\b|\byarn\b/);
    // The only project code the write token runs is the marketplace script.
    const nodeCalls = runs(release).flatMap((script) => script.match(/\bnode\s+\S+/g) ?? []);
    expect(nodeCalls).toEqual(['node scripts/update-marketplace.mjs']);
  });

  it('creates the release with the zip, a prerelease for a -preview version, before it points the marketplace at it', () => {
    const create = indexOfRun(release, 'gh release create');
    const update = indexOfRun(release, 'scripts/update-marketplace.mjs');
    expect(create).toBeGreaterThanOrEqual(0);
    expect(update).toBeGreaterThan(create);
    const script = release.steps[create]!.run!;
    expect(script).toContain('--prerelease');
    expect(script).toMatch(/-preview/);
    expect(script).toContain('--verify-tag');
    expect(script).toMatch(/sha256sum -c/);
  });

  it('commits only .claude-plugin/marketplace.json to the default branch as the workflow identity', () => {
    const script = release.steps[indexOfRun(release, 'scripts/update-marketplace.mjs')]!.run!;
    expect(script).toMatch(/git add \.claude-plugin\/marketplace\.json/);
    expect(script).toMatch(/git commit/);
    expect(script).toMatch(/github-actions\[bot\]/);
    expect(script).toMatch(/git push origin "HEAD:refs\/heads\/\$\{DEFAULT_BRANCH\}"/);
    const checkout = release.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.ref).toBe('${{ github.event.repository.default_branch }}');
  });

  it('pins every action to a 40-character commit SHA with the version in a trailing comment', () => {
    const lines = text.split('\n').filter((line) => /^\s*(?:-\s+)?uses:/.test(line));
    expect(lines.length).toBeGreaterThanOrEqual(6);
    for (const line of lines) {
      expect(line, line).toMatch(/uses:\s+[\w.-]+\/[\w.-]+@[0-9a-f]{40}\s+#\s+v\d+(\.\d+)*\s*$/);
    }
    const used = [...build.steps, ...release.steps].flatMap((step) => (step.uses === undefined ? [] : [step.uses]));
    for (const action of used) expect(action, action).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it('fails the build job when the tagged commit is not an ancestor of the default branch, before any project code runs', () => {
    const index = indexOfRun(build, 'merge-base --is-ancestor');
    expect(index).toBeGreaterThanOrEqual(0);
    const step = build.steps[index]!;
    expect(step.run).toContain('"$GITHUB_SHA"');
    expect(step.run).toMatch(/exit 1/);
    expect(step.env?.DEFAULT_BRANCH).toBe('${{ github.event.repository.default_branch }}');
    expect(index).toBeLessThan(indexOfRun(build, 'npm ci'));
    // The check needs the branch history, not a one-commit clone.
    const checkout = build.steps.find((candidate) => candidate.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['fetch-depth']).toBe(0);
  });

  it('keeps expressions out of run scripts, so no event value is interpolated into a shell', () => {
    for (const script of [...runs(build), ...runs(release)]) expect(script, script).not.toContain('${{');
  });
});
