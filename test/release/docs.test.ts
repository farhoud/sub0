import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(import.meta.dirname, '..', '..');
// A missing page reads as empty, so the tests fail on what it lacks instead of on the import.
const read = (file: string) => (existsSync(path.join(REPO, file)) ? readFileSync(path.join(REPO, file), 'utf8') : '');

// The owner and name the repository had before the move to qoherent/sub0, and the folder
// the spike was developed in. They may appear in docs/releasing.md only in the bullet of the
// "After the transfer" section that tells a maintainer to search for them.
const OLD_NAMES = ['farhoud', 'spike-with-sigil'];

// Pages are wrapped at about 80 columns, so phrases are matched with whitespace collapsed.
const flat = (text: string) => text.replace(/\s+/g, ' ');

const README_RAW = read('README.md');
const RELEASING_RAW = read('docs/releasing.md');
const README = flat(README_RAW);
const RELEASING = flat(RELEASING_RAW);
const pkg = JSON.parse(read('package.json')) as { version: string; scripts: Record<string, string> };

const SECTION_TITLE = 'After the transfer to qoherent/sub0';

/** The text of one `## ` section, up to the next `## ` heading or the end. */
function sectionRaw(text: string, title: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (start === -1) return '';
  const end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

const section = (text: string, title: string) => flat(sectionRaw(text, title));

/** The list item (and its continuation lines) that holds a match, or '' when none does. */
function bulletWith(text: string, pattern: RegExp): string {
  const items = text.split(/\n(?=- )/);
  return items.find((item) => pattern.test(flat(item))) ?? '';
}

describe('README.md', () => {
  it('exists', () => {
    expect(README_RAW).not.toBe('');
  });

  it('has the two install commands, the init command and the commands it points at', () => {
    expect(README).toContain('/plugin marketplace add qoherent/sub0');
    expect(README).toContain('/plugin install subzero@qoherent');
    expect(README).toMatch(/\/subzero:init <model>/);
    expect(README).toContain('/subzero:tasks');
    for (const skill of ['init', 'tasks']) expect(existsSync(path.join(REPO, 'skills', skill, 'SKILL.md'))).toBe(true);
  });

  it('says this is an experimental preview and names the version', () => {
    expect(README).toMatch(/experimental preview/i);
    expect(README).toContain(pkg.version);
  });

  it('lists the four known limits of the install page', () => {
    expect(README).toMatch(/plan mode is not respected/i);
    expect(README).toMatch(/pi is the only (child )?host/i);
    expect(README).toMatch(/general agent[^.]*write files[^.]*run shell commands[^.]*outside Claude Code's permission prompts/is);
    expect(README).toMatch(/queue is per (Claude Code )?session/i);
  });

  it('lists the two limits of the demo README and the hook on every Agent call', () => {
    expect(README).toMatch(/server fails to start[^.]*(still says|says) routing is on[^.]*every subagent runs on Claude/is);
    expect(README).toMatch(/worktree[^.]*fork[^.]*(stay|stays) on Claude/is);
    expect(README).toMatch(/every (Agent|subagent) (call|spawn)/i);
    expect(README).toMatch(/does nothing[^.]*no agent file|no agent file[^.]*does nothing/is);
  });

  it('adds the fifth limit: the agent file is executable-grade configuration', () => {
    expect(README).toContain('.agents/subzero.yaml');
    expect(README).toMatch(/executable-grade configuration/i);
    expect(README).toMatch(/chooses models, tools[^.]*general agent with shell access/is);
    expect(README).toMatch(/only in repositories you trust/i);
  });

  it('names Node 22, pi, a model and macOS or Linux as prerequisites, and says Windows is not supported', () => {
    const prerequisites = section(README_RAW, 'Prerequisites');
    expect(prerequisites).toMatch(/Node(\.js)? 22/);
    expect(prerequisites).toMatch(/\bpi\b/);
    expect(prerequisites).toMatch(/model/i);
    expect(prerequisites).toMatch(/macOS/);
    expect(prerequisites).toMatch(/Linux/);
    expect(prerequisites).toMatch(/Windows[^.]*not supported/i);
    expect(prerequisites).toMatch(/current Claude Code/);
  });

  it('tells the steps in the order of R8', () => {
    const order = [
      /^## .*(preview|limits)/im,
      /^## Prerequisites/m,
      /\/plugin marketplace add qoherent\/sub0/,
      /\/plugin install subzero@qoherent/,
      /\/subzero:init <model>/,
      /^## .*(Confirm|Test)/im,
      /^## Update/m,
      /^## License/m,
    ];
    const positions = order.map((pattern) => README_RAW.search(pattern));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('says how to update with the commands the Claude Code documentation gives', () => {
    const update = section(README_RAW, 'Update');
    expect(update).toContain('/plugin marketplace update qoherent');
    expect(update).toContain('claude plugin update subzero@qoherent');
    expect(update).toMatch(/\/reload-plugins|restart/i);
  });

  it('names the license', () => {
    expect(section(README_RAW, 'License')).toContain('Apache-2.0');
    expect(existsSync(path.join(REPO, 'LICENSE'))).toBe(true);
  });
});

describe('docs/releasing.md', () => {
  const transfer = section(RELEASING_RAW, SECTION_TITLE);

  it('exists', () => {
    expect(RELEASING_RAW).not.toBe('');
  });

  it('has the three parts: local testing, cutting a release, and the transfer checklist', () => {
    expect(RELEASING_RAW).toMatch(/^## Test locally/m);
    expect(RELEASING_RAW).toMatch(/^## Cut a release/m);
    expect(transfer).not.toBe('');
  });

  it('tests locally with the commands the build and the Claude Code documentation give', () => {
    expect(Object.keys(pkg.scripts)).toContain('release:build');
    expect(RELEASING).toContain('npm run release:build');
    expect(RELEASING).toContain('claude plugin validate dist-release/local-marketplace');
    expect(RELEASING).toContain('claude plugin marketplace add ./dist-release/local-marketplace');
    expect(RELEASING).toContain('claude plugin install subzero@qoherent');
    expect(RELEASING).toContain('claude plugin marketplace remove qoherent');
  });

  it('describes cutting a release from a tag', () => {
    expect(RELEASING).toMatch(/\.claude-plugin\/plugin\.json/);
    expect(RELEASING).toMatch(/package\.json/);
    expect(RELEASING).toMatch(/git tag v<version>/);
    expect(RELEASING).toContain('.github/workflows/release.yml');
    expect(RELEASING).toMatch(/\.claude-plugin\/marketplace\.json/);
    expect(RELEASING).toMatch(/sha256/i);
  });

  it('lists every step of the transfer checklist', () => {
    expect(transfer).toMatch(/transfer the repository[^.]*(update|set)[^.]*(local )?remote/i);
    expect(transfer).toMatch(/scan[^.]*tracked files[^.]*history[^.]*credentials[^.]*local paths[^.]*private endpoints/is);
    expect(transfer).toMatch(/bench\//);
    expect(transfer).toMatch(/before anything is made public/i);
    expect(transfer).toMatch(/make the repository and its releases public/i);
    expect(transfer).toMatch(/enable Actions/i);
    expect(transfer).toMatch(/write permission/i);
    expect(transfer).toMatch(/pull request/i);
    expect(transfer).toMatch(/protect the `v\*` tags/i);
    expect(transfer).toMatch(/required review[^.]*`\.claude-plugin\/marketplace\.json`/is);
    expect(transfer).toMatch(/`package\.json` `repository`[^.]*`qoherent\/sub0`/i);
    expect(transfer).toMatch(/search the docs and the demo/i);
    expect(transfer).toMatch(/marketplace name `qoherent`[^.]*free/i);
    expect(transfer).toContain('claude plugin validate .');
    expect(transfer).toMatch(/push the first tag/i);
    expect(transfer).toMatch(/clean profile/i);
    expect(transfer).toContain('docs/distribution-results.md');
    expect(transfer).toMatch(/second preview[^.]*AE3/is);
  });

  it('also reminds the maintainer to remove the local marketplace before adding the real one', () => {
    expect(transfer).toMatch(/claude plugin marketplace remove qoherent/);
  });
});

describe('both pages', () => {
  it('never name the old owner or the old folder, except in the search item of the transfer checklist', () => {
    const transfer = sectionRaw(RELEASING_RAW, SECTION_TITLE);
    const search = bulletWith(transfer, /search the docs and the demo/i);
    expect(search).not.toBe('');
    // The search item names the old owner and name so the maintainer knows what to look for.
    expect(flat(search)).toContain('farhoud/subzero');

    const outside = RELEASING_RAW.replace(search, '');
    for (const old of OLD_NAMES) {
      expect(README_RAW.toLowerCase()).not.toContain(old);
      expect(outside.toLowerCase()).not.toContain(old);
    }
  });

  it('point only at files that exist in the repository', () => {
    for (const [file, text] of [
      ['README.md', README_RAW],
      ['docs/releasing.md', RELEASING_RAW],
    ] as const) {
      const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]!);
      for (const link of links) {
        if (/^[a-z]+:/i.test(link) || link.startsWith('#')) continue;
        const target = path.resolve(REPO, path.dirname(file), link.split('#')[0]!);
        expect(existsSync(target), `${file} links to ${link}`).toBe(true);
      }
    }
  });

  it('carry no dash pileups and none of the marketing words the style rule bans', () => {
    for (const text of [README_RAW, RELEASING_RAW]) {
      expect(text).not.toContain('—');
      expect(text).not.toMatch(/\b(seamless(ly)?|powerful|robust|leverage|supercharge|effortless(ly)?|cutting-edge)\b/i);
    }
  });
});
