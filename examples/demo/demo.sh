#!/usr/bin/env bash
# subzero demo: Claude Code orchestrates, pi reviewers on a local model do the work.
#
#   ./demo.sh               open Claude Code here with the subzero plugin; then type /subzero:review
#   ./demo.sh tasks         list the subzero tasks of this folder
#   ./demo.sh attach <id>   follow one pi reviewer live
#   ./demo.sh show <id>     export one pi reviewer's session to <id>.html
#   ./demo.sh pi <file>     run the same pi reviewer skill directly in pi, without Claude (add -p to print)
#   ./demo.sh reset         remove the reviews, REVIEW.md and the task records, to record again
set -euo pipefail
cd "$(dirname "$0")"
DEMO="$PWD"
SUBZERO_ROOT="${SUBZERO_ROOT:-$(cd ../.. && pwd)}"
subzero() { SUBZERO_PROJECT_DIR="$DEMO" node "$SUBZERO_ROOT/dist/cli.js" "$@"; }

[ -f "$SUBZERO_ROOT/dist/server.js" ] || { echo "build subzero first: (cd $SUBZERO_ROOT && npm run build)" >&2; exit 1; }

case "${1:-claude}" in
  claude)
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
      --model r9700/Qwen3.8 --thinking low --tools read,grep,find,ls,write "${@:3}" \
      "Review $file using your code-review skill. Write the review to reviews/${file//\//__}.md. Write no other file." ;;
  reset) rm -rf reviews REVIEW.md .agents/subzero *.html ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
