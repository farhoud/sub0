import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../helpers.js';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'update-marketplace.mjs');
const SHA_A = 'a'.repeat(64);
const SHA_B = '0123456789abcdef'.repeat(4);
const VERSION = '0.1.0-preview.1';

const json = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;

/** A repository-shaped root with only what the script reads. */
function rootWith(repository: unknown = { type: 'git', url: 'https://github.com/qoherent/sub0.git' }): string {
  const root = tempDir('subzero-mkt-');
  mkdirSync(path.join(root, '.claude-plugin'));
  cpManifest(root);
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'subzero', version: VERSION, repository })}\n`);
  return root;
}

function cpManifest(root: string): void {
  writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), readFileSync(path.join(REPO, '.claude-plugin', 'plugin.json')));
}

const marketplaceFile = (dir: string) => path.join(dir, '.claude-plugin', 'marketplace.json');

function run(args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: tempDir() });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function generate(root: string, version = VERSION, sha256 = SHA_A, extra: string[] = []) {
  return run(['--root', root, '--version', version, '--sha256', sha256, ...extra]);
}

describe('scripts/update-marketplace.mjs', () => {
  it('writes a qoherent marketplace with one subzero entry, an https archive source for the tag, and no version key', () => {
    const root = rootWith();
    const result = generate(root);
    expect(result.status, result.stderr).toBe(0);
    const file = json(marketplaceFile(root));
    expect(file.name).toBe('qoherent');
    expect(file.owner).toEqual({ name: 'Qoherent' });
    expect(typeof file.description).toBe('string');
    expect(file.plugins).toHaveLength(1);
    const entry = file.plugins[0];
    expect(entry.name).toBe('subzero');
    // The exact archive shape from the Claude Code marketplace reference: { source, url, sha256 }.
    expect(entry.source).toEqual({
      source: 'archive',
      url: `https://github.com/qoherent/sub0/releases/download/v${VERSION}/subzero-${VERSION}.zip`,
      sha256: SHA_A,
    });
    // KTD1: the version lives only in the manifest inside the zip.
    expect(JSON.stringify(file)).not.toMatch(/"version"/);
    expect('version' in file).toBe(false);
    expect('version' in entry).toBe(false);
    expect('version' in entry.source).toBe(false);
  });

  it('works against the real package.json: the URL sits under qoherent/sub0 releases for the tag', () => {
    const out = tempDir('subzero-mkt-out-');
    const result = run(['--root', REPO, '--out', out, '--version', VERSION, '--sha256', SHA_A]);
    expect(result.status, result.stderr).toBe(0);
    const source = json(marketplaceFile(out)).plugins[0].source;
    expect(source.url.startsWith(`https://github.com/qoherent/sub0/releases/download/v${VERSION}/`)).toBe(true);
    expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
    // --out is where the file goes; the real tree is untouched.
    expect(existsSync(marketplaceFile(REPO))).toBe(false);
  });

  it('follows package.json repository: changing the slug changes the URL and nothing else', () => {
    const original = rootWith();
    expect(generate(original).status).toBe(0);
    const before = json(marketplaceFile(original));
    const moved = rootWith({ type: 'git', url: 'git+https://github.com/acme/widgets.git' });
    expect(generate(moved).status).toBe(0);
    const after = json(marketplaceFile(moved));
    expect(after.plugins[0].source.url).toBe(`https://github.com/acme/widgets/releases/download/v${VERSION}/subzero-${VERSION}.zip`);
    const normalise = (file: Record<string, any>) => {
      const copy = structuredClone(file);
      copy.plugins[0].source.url = '<url>';
      return copy;
    };
    expect(normalise(after)).toEqual(normalise(before));
  });

  it('accepts the string form of repository too', () => {
    const root = rootWith('github:acme/widgets');
    expect(generate(root).status).toBe(0);
    expect(json(marketplaceFile(root)).plugins[0].source.url).toContain('https://github.com/acme/widgets/releases/download/');
  });

  it('is idempotent: the same inputs leave the file byte-identical', () => {
    const root = rootWith();
    expect(generate(root).status).toBe(0);
    const first = readFileSync(marketplaceFile(root));
    expect(generate(root).status).toBe(0);
    expect(readFileSync(marketplaceFile(root)).equals(first)).toBe(true);
  });

  it('replaces the previous release url and sha256 when a later release runs', () => {
    const root = rootWith();
    expect(generate(root, VERSION, SHA_A).status).toBe(0);
    expect(generate(root, '0.1.0-preview.2', SHA_B).status).toBe(0);
    const file = json(marketplaceFile(root));
    expect(file.plugins).toHaveLength(1);
    expect(file.plugins[0].source).toEqual({
      source: 'archive',
      url: 'https://github.com/qoherent/sub0/releases/download/v0.1.0-preview.2/subzero-0.1.0-preview.2.zip',
      sha256: SHA_B,
    });
    expect(JSON.stringify(file)).not.toContain('preview.1');
    expect(JSON.stringify(file)).not.toContain(SHA_A);
  });

  it('exits non-zero, and writes nothing, for a checksum that is not 64 hexadecimal characters', () => {
    for (const bad of ['', 'abc', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), `${'a'.repeat(63)} `]) {
      const root = rootWith();
      const result = generate(root, VERSION, bad);
      expect(result.status, JSON.stringify(bad)).not.toBe(0);
      expect(result.stderr).toMatch(/sha256/);
      expect(existsSync(marketplaceFile(root)), JSON.stringify(bad)).toBe(false);
    }
  });

  it('exits non-zero when --version or --sha256 is missing, or the version is not a plain version string', () => {
    const root = rootWith();
    expect(run(['--root', root, '--sha256', SHA_A]).status).not.toBe(0);
    expect(run(['--root', root, '--version', VERSION]).status).not.toBe(0);
    for (const bad of ['', 'v0.1.0', '0.1.0/../x', '0.1.0 preview']) {
      expect(generate(root, bad).status, JSON.stringify(bad)).not.toBe(0);
    }
    expect(existsSync(marketplaceFile(root))).toBe(false);
  });

  it('exits non-zero when package.json names no GitHub repository', () => {
    const root = rootWith('https://example.com/not-github');
    const result = generate(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/repository/);
  });
});
