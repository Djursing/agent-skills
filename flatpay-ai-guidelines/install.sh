#!/usr/bin/env bash
#
# install.sh — Install the flatpay-ai-guidelines always-on rules file.
#
# Symlinks the always-load-guidelines template into the matching .claude/rules/
# directory so Claude Code loads the Flatpay AI guidelines at the start of
# every session, before any work begins.
#
# Modes:
#   --project      Per-project install (default). Links into ./.claude/rules/.
#   --global       Personal install. Links into ~/.claude/rules/.
#
# Usage:
#   bash install.sh                 # per-project install (current directory)
#   bash install.sh --global        # personal install (all projects)
#   bash install.sh --help

set -euo pipefail

MODE="project"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --global)
      MODE="global"
      shift
      ;;
    --project)
      MODE="project"
      shift
      ;;
    -h|--help)
      sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# *//;s/^#//'
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      echo "run with --help to see usage" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$SCRIPT_DIR"
TEMPLATE="$SKILL_DIR/templates/always-load-guidelines.template.md"

case "$MODE" in
  global)
    CLAUDE_DIR="$HOME/.claude"
    ;;
  project)
    CLAUDE_DIR="$(pwd)/.claude"
    ;;
esac

if [[ ! -f "$TEMPLATE" ]]; then
  echo "error: missing $TEMPLATE" >&2
  echo "the skill directory appears incomplete" >&2
  exit 1
fi

mkdir -p "$CLAUDE_DIR/rules"

ln -sf "$TEMPLATE" "$CLAUDE_DIR/rules/flatpay-ai-guidelines.md"
echo "✓ Rules file: $CLAUDE_DIR/rules/flatpay-ai-guidelines.md"

echo ""
echo "done. flatpay-ai-guidelines is active ($MODE mode)."
echo "Claude Code will read ~/.agents/skills/ai-guidelines/CLAUDE.md"
echo "at the start of every session before doing any work."
