#!/usr/bin/env sh

set -eu

TARGET_DIR="${1:-$(pwd)}"

echo "Initializing ContextFlow Skill in: ${TARGET_DIR}"

mkdir -p "${TARGET_DIR}/bin"
mkdir -p "${TARGET_DIR}/src/core"
mkdir -p "${TARGET_DIR}/src/services"
mkdir -p "${TARGET_DIR}/src/types"
mkdir -p "${TARGET_DIR}/src/utils"
mkdir -p "${TARGET_DIR}/tests"

touch "${TARGET_DIR}/state.json"

if [ ! -f "${TARGET_DIR}/.cursorrules" ]; then
  cp "$(dirname "$0")/../.cursorrules" "${TARGET_DIR}/.cursorrules"
fi

if [ ! -f "${TARGET_DIR}/SKILL_PRD.md" ]; then
  cp "$(dirname "$0")/../SKILL_PRD.md" "${TARGET_DIR}/SKILL_PRD.md"
fi

if [ ! -f "${TARGET_DIR}/README.md" ]; then
  cp "$(dirname "$0")/../README.md" "${TARGET_DIR}/README.md"
fi

echo "{}" > "${TARGET_DIR}/state.json"

echo "Scaffolded:"
echo "- .cursorrules"
echo "- SKILL_PRD.md"
echo "- README.md"
echo "- state.json"
echo "- src/{core,services,types,utils}"
echo "- tests/"
echo ""
echo "Next:"
echo "1. Copy or implement the runtime files into src/"
echo "2. Run: node bin/context.ts"
