#!/usr/bin/env bash
# check-subagent-prompts.sh
#
# Verifies that every file in rules/ and templates/ that contains a sub-agent
# dispatch block also embeds the Sub-Agent Resource Discipline sentinel line.
#
# Usage:
#   bin/check-subagent-prompts.sh [skill-root]
#
# Arguments:
#   skill-root  Path to the autonomous-workflow skill root directory.
#               Defaults to the parent of the directory containing this script.
#
# Exit codes:
#   0  All dispatch files contain the sentinel.
#   1  One or more dispatch files are missing the sentinel (violations listed).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="${1:-"$(dirname "$SCRIPT_DIR")"}"

RULES_DIR="$SKILL_ROOT/rules"
TEMPLATES_DIR="$SKILL_ROOT/templates"

SENTINEL="Sub-Agent Resource Discipline"

if [ ! -d "$RULES_DIR" ]; then
  echo "ERROR: rules/ directory not found at $RULES_DIR" >&2
  exit 1
fi

if [ ! -d "$TEMPLATES_DIR" ]; then
  echo "ERROR: templates/ directory not found at $TEMPLATES_DIR" >&2
  exit 1
fi

# Find all files in rules/ and templates/ that contain sub-agent dispatch blocks.
# A file is a "dispatch file" if it contains "subagent_type" (the literal dispatch
# syntax field) — this is more precise than matching "sub-agent" as a string, which
# appears throughout the documentation descriptively without being a dispatch block.
# Phase 1 Explore sub-agents use a pseudo-code comment pattern, not the
# subagent_type field, so they fall outside this script's scope intentionally.
# They are read-only (Read/Grep/Glob) and exempt from the resource discipline.
DISPATCH_FILES=()
while IFS= read -r file; do
  DISPATCH_FILES+=("$file")
done < <(grep -ril "subagent_type" "$RULES_DIR" "$TEMPLATES_DIR" 2>/dev/null || true)

if [ "${#DISPATCH_FILES[@]}" -eq 0 ]; then
  echo "INFO: No dispatch files found in rules/ or templates/ — nothing to check."
  exit 0
fi

VIOLATIONS=()
for file in "${DISPATCH_FILES[@]}"; do
  if ! grep -qF "$SENTINEL" "$file"; then
    VIOLATIONS+=("$file")
  fi
done

if [ "${#VIOLATIONS[@]}" -eq 0 ]; then
  echo "OK: All ${#DISPATCH_FILES[@]} dispatch file(s) contain the sentinel."
  exit 0
else
  echo "FAIL: ${#VIOLATIONS[@]} dispatch file(s) missing the sentinel '${SENTINEL}':" >&2
  for v in "${VIOLATIONS[@]}"; do
    echo "  - $v" >&2
  done
  exit 1
fi
