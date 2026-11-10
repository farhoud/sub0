# Distribution results

Record of what was checked on the real install route. Newest first.

## 2026-11-10: first publish of the `plugin` branch

Claude Code 2.1.322, pi 0.87.0, macOS. The repository was transferred to
`qoherent/sub0` the same day.

**Pre-publication scan.** Tracked files and full history searched for key and
token patterns, private keys, private addresses, local paths and email addresses.
No credentials. Two private addresses in current docs were replaced with
placeholders (PR #4). The old addresses remain in git history. The benchmark rows
in `bench/results/rows.jsonl` record the author's home folder; left as measurement
data.

**Publish.** `npm run release:branch -- --push` from `main` at `339296c` created
the `plugin` branch at `6573499` with 13 files: the plugin manifest and
marketplace file, `.mcp.json`, hooks, two skills, `bin/subzero`, four bundles,
`LICENSE` and `package.json`.

**Install from GitHub, clean profile** (temporary `CLAUDE_CONFIG_DIR`):

| Step | Result |
|---|---|
| `claude plugin marketplace add qoherent/sub0@plugin` | Added marketplace `qoherent`. |
| `claude plugin install subzero@qoherent` | Installed `0.1.0-preview.1`, user scope. |
| `claude plugin list --json` | Plugin enabled; MCP server entry present. |
| `claude plugin validate <install path>` | Passed. |
| `bin/subzero` mode | `rwxr-xr-x` after install. |
| MCP `initialize` through `bin/subzero --bundle server` | Replied, version `0.1.0-preview.1`. |
| `dist/cli.js init` with no arguments | Prints usage. |

**Not run.** The profile is not logged in and no model endpoint was used, so these
are still open: `/subzero:init <model>`, `/subzero:tasks` and a routed task in a
live session (plan U7 stage 1 and 2), the update check from one preview to the
next (AE3), and the release-archive route (workflow never run).
