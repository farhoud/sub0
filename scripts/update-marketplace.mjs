// Writes .claude-plugin/marketplace.json for one release: the `qoherent` marketplace with one
// `subzero` entry whose archive source is that release's zip. The file is regenerated whole from
// its inputs, so running it twice for a release changes nothing and a later release replaces the
// entry's url and sha256. The entry has no `version`: the version lives only in the manifest
// inside the zip (KTD1).
//
//   node scripts/update-marketplace.mjs --version <version> --sha256 <64 hex> [--root <repo>] [--out <dir>]
//
// --root is the repository to read package.json and the manifest from; --out is the marketplace
// root to write .claude-plugin/marketplace.json under (default: --root).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositorySlug } from './repository.mjs';

const MARKETPLACE_NAME = 'qoherent';
const PLUGIN_NAME = 'subzero';

function fail(message) {
  console.error(`update-marketplace: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { version: undefined, sha256: undefined, root: undefined, out: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!['--version', '--sha256', '--root', '--out'].includes(flag)) fail(`unknown argument "${flag}" (expected --version, --sha256, --root or --out)`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) fail(`${flag} needs a value`);
    options[flag.slice(2)] = value;
    i += 1;
  }
  return options;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return fail(`cannot read ${file}: ${error.message}`);
  }
}

const options = parseArgs(process.argv.slice(2));
const root = path.resolve(options.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const out = path.resolve(options.out ?? root);

const { version, sha256 } = options;
if (version === undefined) fail('--version is required');
// A bare version, as in the tag `v<version>`; nothing that could change the shape of the URL.
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) fail(`--version "${version}" is not a version such as 0.1.0-preview.1 (no leading "v")`);
if (sha256 === undefined) fail('--sha256 is required');
if (!/^[0-9a-fA-F]{64}$/.test(sha256)) fail(`--sha256 must be 64 hexadecimal characters, got "${sha256}"`);

const pkg = readJson(path.join(root, 'package.json'));
let slug;
try {
  slug = repositorySlug(pkg.repository);
} catch (error) {
  fail(error.message);
}
const manifest = readJson(path.join(root, '.claude-plugin', 'plugin.json'));

const marketplace = {
  name: MARKETPLACE_NAME,
  owner: manifest.author ?? { name: 'Qoherent' },
  description: 'Plugins from Qoherent. Each release of a plugin is a zip attached to a tagged GitHub release.',
  plugins: [
    {
      name: PLUGIN_NAME,
      source: {
        source: 'archive',
        url: `https://github.com/${slug}/releases/download/v${version}/subzero-${version}.zip`,
        sha256: sha256.toLowerCase(),
      },
      description: manifest.description,
    },
  ],
};

const file = path.join(out, '.claude-plugin', 'marketplace.json');
mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(file, `${JSON.stringify(marketplace, null, 2)}\n`);
console.log(`update-marketplace: ${path.relative(process.cwd(), file) || file} now points at v${version}`);
