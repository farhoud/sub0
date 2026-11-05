#!/usr/bin/env bash
# subzero demo: Claude Code orchestrates, pi reviewers on a local model do the work.
#
#   ./demo.sh setup [dir]   copy the demo to dir (default ~/subzero-demo); run every other command there
#   ./demo.sh               open Claude Code here with the subzero plugin; then type /subzero:review
#   ./demo.sh tasks         list the subzero tasks of this folder
#   ./demo.sh attach <id>   follow one pi reviewer live
#   ./demo.sh show <id>     export one pi reviewer's session to <id>.html
#   ./demo.sh pi <file>     run the same pi reviewer skill directly in pi, without Claude (add -p to print)
#   ./demo.sh reset         remove REVIEW.md and the task records, to record again
set -euo pipefail
cd "$(dirname "$0")"
DEMO="$(pwd -P)"
# A copy made by setup records where subzero is; the demo inside the repository finds it two levels up.
SUBZERO_ROOT="${SUBZERO_ROOT:-$(cat .subzero-root 2>/dev/null || (cd ../.. && pwd -P))}"
subzero() { SUBZERO_PROJECT_DIR="$DEMO" node "$SUBZERO_ROOT/dist/cli.js" "$@"; }

[ -f "$SUBZERO_ROOT/dist/server.js" ] || { echo "build subzero first: (cd $SUBZERO_ROOT && npm run build)" >&2; exit 1; }

case "${1:-claude}" in
  setup)
    dest="${2:-$HOME/subzero-demo}"
    mkdir -p "$dest/.agents"
    cp -R src pi-skills .claude .gitignore README.md demo.sh "$dest/"
    cp .agents/subzero.yaml "$dest/.agents/"
    echo "$SUBZERO_ROOT" > "$dest/.subzero-root"
    echo "demo copied to $dest; cd there and run ./demo.sh" ;;
  claude)
    # Claude Code refuses to write files inside a folder loaded with --plugin-dir,
    # so REVIEW.md cannot be written by a demo that lives inside the repository.
    case "$DEMO/" in "$SUBZERO_ROOT"/*)
      echo "run the demo from a copy outside the subzero repository: ./demo.sh setup [dir]" >&2; exit 1 ;;
    esac
    # --setting-sources keeps your own plugins out; the allow rules are also in
    # .claude/settings.json, which Claude Code applies once the folder is trusted.
    exec claude --setting-sources project,local --plugin-dir "$SUBZERO_ROOT" \
      --allowedTools 'mcp__plugin_subzero_subzero__*' 'Edit(REVIEW.md)' ;;
  tasks) subzero tasks ;;
  attach) subzero attach "$2" ;;
  show) subzero show "$2" ;;
  pi)
    file="${2:?usage: ./demo.sh pi <file>}"
    PI_OFFLINE=1 exec pi --offline -na -ne -nc -np -ns --skill pi-skills/code-review \
      --model r9700/Qwen3.8 --thinking low --tools read,grep,find,ls "${@:3}" \
      "Review $file using your code-review skill." ;;
  reset) rm -rf REVIEW.md .agents/subzero *.html ;;
  *) sed -n '2,11p' "$0"; exit 2 ;;
esac
