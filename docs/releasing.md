# Releasing the subzero plugin

For the maintainers (Qoherent). Users install a built, plugin-only zip that a
tagged release attaches, through a marketplace named `qoherent` whose catalog is
`.claude-plugin/marketplace.json` in this repository. Three parts follow: testing
locally before the repository is at `qoherent/sub0`, cutting a release, and what to
do after the transfer.

How the pieces fit:

- `scripts/build-plugin.mjs` copies an allowlist of files into
  `dist-release/subzero-<version>/`, zips it as `subzero-<version>.zip`, writes the
  zip's SHA-256 beside it, and builds `dist-release/local-marketplace/`.
- `scripts/update-marketplace.mjs` writes `.claude-plugin/marketplace.json` for one
  release: an `archive` entry with the release asset URL and the `sha256`, and no
  `version`. The version lives only in the manifest inside the zip.
- `.github/workflows/release.yml` runs both on a `v*` tag.
- The repository slug comes from `package.json` `repository`. The scripts derive
  the zip URL and the manifest's `repository` and `homepage` from it.

## Test locally before the transfer

Nothing here needs the final URLs. You need Node 22, `zip` and Claude Code.

1. Build the plugin and the local marketplace. The last line printed is a JSON
   object with the zip path, its checksum and the version.

   ```sh
   npm ci
   npm run release:build
   ```

2. Validate both:

   ```sh
   claude plugin validate dist-release/local-marketplace
   claude plugin validate .
   ```

   Both should end with `Validation passed`. The second one checks the repository
   root, which has no marketplace file until the first release, so it validates the
   plugin manifest alone.

3. Add the local marketplace and install from it:

   ```sh
   claude plugin marketplace add ./dist-release/local-marketplace
   claude plugin install subzero@qoherent
   ```

   Start Claude Code in a throwaway project without `--plugin-dir`: a development
   copy loaded with that flag shadows the installed plugin. Run `/subzero:init
   <model>` and `/subzero:tasks`, then check that a routed task completes, as in the
   README.

   Claude Code reads a relative-path plugin of a local marketplace in place, so this
   tests the manifest, the commands, the hooks and the MCP server. It does not test
   the `archive` download. That needs the final URLs and is part of the checklist
   below.

4. Remove it afterwards. The marketplace is named `qoherent`, the same as the
   published one, so a leftover local copy blocks adding the real one:

   ```sh
   claude plugin marketplace remove qoherent
   ```

   This also uninstalls `subzero@qoherent`. The user data of a marketplace install
   lives in its own folder (`subzero-qoherent`), apart from the one a `--plugin-dir`
   run uses.

## Cut a release

1. Set the same new version in `.claude-plugin/plugin.json` and `package.json`
   (keep a `-preview.N` label while the plugin is a preview; the manifest tests
   fail without it), and update the version the README names. The build refuses to
   run when the two files, or the tag, disagree. Each release must change the
   version: Claude Code updates a user's copy only when the version changes.
2. Run `npm run typecheck`, `npm test` and `npm run release:build`, and commit.
3. Merge to the default branch. The workflow refuses a tag whose commit is not an
   ancestor of it.
4. Tag the merged commit and push the tag:

   ```sh
   git tag v<version>
   git push origin v<version>
   ```

5. The workflow in `.github/workflows/release.yml` then runs two jobs. The build
   job has read-only access: it checks the tag is on the default branch, runs
   `npm ci`, `npm test` and `npm run build`, builds the zip with the tag check, and
   uploads the zip as a workflow artifact. The release job has write access and
   runs no project code beyond `scripts/update-marketplace.mjs`: it creates the
   GitHub release (a prerelease while the version has a `-preview` label) with the
   zip and its `.sha256` attached, then commits `.claude-plugin/marketplace.json`
   to the default branch with that release's URL and `sha256`.
6. Check the result: the release lists the zip and its checksum file; the
   committed `.claude-plugin/marketplace.json` has a `url` ending in
   `/releases/download/v<version>/subzero-<version>.zip` and a `sha256` equal to
   the one in the checksum file; `claude plugin validate .` passes after you pull.
   If the default branch refused the marketplace commit, see the first item below.

The catalog file changes only in that release commit. Do not edit it by hand, and
do not move a tag after pushing it.

## After the transfer to qoherent/sub0

Do these in order. Until the first release commits
`.claude-plugin/marketplace.json`, `/plugin marketplace add qoherent/sub0` finds no
catalog, so nobody can install yet.

- Transfer the repository to `qoherent/sub0`, then update the local remote with
  `git remote set-url origin https://github.com/qoherent/sub0.git`.
- Scan the tracked files and the full history for credentials, local paths and
  private endpoints, and remove or move what should not be public, before anything
  is made public. The benchmark results under `bench/` record local paths and model
  names; check those and the docs, the examples and the plans too. Publishing is
  irreversible, and history stays visible.
- Make the repository and its releases public, enable Actions, give workflows write
  permission (Settings, Actions, General, Workflow permissions), and let the
  default branch accept the release commit from the workflow. If branch protection
  stops that push, choose the pull-request route instead: change the last step of
  the release job to open a pull request, and merge it by hand for each release.
- Protect the `v*` tags, so only maintainers create them, and protect the default
  branch with a required review on `.claude-plugin/marketplace.json`, since that
  file decides what every installer downloads and the `sha256` only guards the
  release asset.
- Confirm `package.json` `repository` names `qoherent/sub0`, and search the docs
  and the demo for the old owner and name, `farhoud/subzero`, and for the folder
  name `spike-with-sigil`. Change what you find.
- Confirm the marketplace name `qoherent` is free, that no local test copy is still
  added (`claude plugin marketplace remove qoherent`), and run
  `claude plugin validate .`.
- Push the first tag as in the section above, and check the release, the zip and
  the committed marketplace file.
- Install from a clean profile with the README commands, run `init` and a routed
  task, and record the result, the Claude Code version and any failure in
  `docs/distribution-results.md`.
- Cut a second preview and update from the first, to verify AE3: the install
  moves to the second preview only when it is tagged, and an unreleased change on
  the default branch does not reach the installer before that. The update commands
  are in the README.
