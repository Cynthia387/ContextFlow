#!/usr/bin/env sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
OS_NAME="$(uname -s 2>/dev/null || echo unknown)"
USER_HOME="${HOME:-${USERPROFILE:-$(pwd)}}"

case "$OS_NAME" in
  Darwin|Linux)
    DEFAULT_CLAUDE_DIR="${CLAUDE_CODE_SKILLS_DIR:-$USER_HOME/.claude/skills/contextflow}"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    DEFAULT_CLAUDE_DIR="${CLAUDE_CODE_SKILLS_DIR:-$USER_HOME/.claude/skills/contextflow}"
    ;;
  *)
    DEFAULT_CLAUDE_DIR="${CLAUDE_CODE_SKILLS_DIR:-$USER_HOME/.claude/skills/contextflow}"
    ;;
esac

FALLBACK_DIR="$(pwd)/.contextflow"

if [ "${1:-}" != "" ]; then
  TARGET_DIR="$1"
  INSTALL_MODE="custom"
elif [ -d "$(dirname "$DEFAULT_CLAUDE_DIR")" ] || [ -d "$HOME/.claude" ]; then
  TARGET_DIR="$DEFAULT_CLAUDE_DIR"
  INSTALL_MODE="claude"
else
  TARGET_DIR="$FALLBACK_DIR"
  INSTALL_MODE="fallback"
fi

echo "Installing ContextFlow into: ${TARGET_DIR}"

mkdir -p "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}/scripts"

cp "${SCRIPT_DIR}/DISTRIBUTION/SKILL.md" "${TARGET_DIR}/SKILL.md"
cp "${SCRIPT_DIR}/DISTRIBUTION/skill.json" "${TARGET_DIR}/skill.json"
cp "${SCRIPT_DIR}/README_DIST.md" "${TARGET_DIR}/README.md"
cp "${SCRIPT_DIR}/scripts/engine.js" "${TARGET_DIR}/scripts/engine.js"

echo "Installed files:"
echo "- ${TARGET_DIR}/SKILL.md"
echo "- ${TARGET_DIR}/skill.json"
echo "- ${TARGET_DIR}/README.md"
echo "- ${TARGET_DIR}/scripts/engine.js"
echo ""

if [ "$INSTALL_MODE" = "fallback" ]; then
  echo "Claude Code skills directory was not found."
  echo "Installed ContextFlow into a local fallback directory instead:"
  echo "${TARGET_DIR}"
  echo ""
fi

echo "To use:"
echo "1. Restart or refresh your AI terminal if needed."
echo "2. Type /context to inspect the live tree."
echo "3. If you are not using Claude Code, copy or source these files from ${TARGET_DIR} in your project root."
