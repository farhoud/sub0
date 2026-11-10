import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const json = (file: string) => JSON.parse(readFileSync(path.join(REPO, file), 'utf8')) as Record<string, unknown>;

describe('release metadata', () => {
  const manifest = json('.claude-plugin/plugin.json');
  const pkg = json('package.json');

  it('gives the plugin manifest and package.json the same version', () => {
    expect(manifest.version).toBe(pkg.version);
  });

  it('keeps the first public release a preview', () => {
    expect(String(manifest.version)).toMatch(/-preview\.\d+$/);
  });

  it('names the license Apache-2.0 in both files and ships the license text', () => {
    expect(manifest.license).toBe('Apache-2.0');
    expect(pkg.license).toBe('Apache-2.0');
    const text = readFileSync(path.join(REPO, 'LICENSE'), 'utf8');
    expect(text).toMatch(/Apache License\s+Version 2\.0, January 2004/);
  });

  it('names the repository as qoherent/sub0 in package.json', () => {
    const repository = pkg.repository as { url?: string } | string;
    const url = typeof repository === 'string' ? repository : (repository.url ?? '');
    expect(url).toMatch(/github\.com[/:]qoherent\/sub0(\.git)?$/);
  });
});
