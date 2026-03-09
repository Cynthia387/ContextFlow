# Publishing ContextFlow

This document is for developers who want to test, link, or publish the ContextFlow skill into a Claude Code environment.

## Clone The Repository

Replace `<repo-url>` with your repository URL:

```bash
git clone <repo-url> ContextFlow && cd ContextFlow
```

## Link To Claude Code

From the repository root, run this exact one-liner:

```bash
mkdir -p "$HOME/.claude/skills" && sh ./install.sh "$HOME/.claude/skills/contextflow"
```

This copies the packaged skill files into Claude Code's skill directory:
- `SKILL.md`
- `skill.json`
- `README.md`
- `scripts/engine.js`

## Verify The Runtime

Run the viewer from the project root:

```bash
node scripts/engine.js --view
```

Run it from any nested subfolder to verify upward `state.json` discovery:

```bash
mkdir -p ./tmp/context-check/nested && (cd ./tmp/context-check/nested && node ../../../scripts/engine.js --view)
```

## Slash Command Cheat Sheet

- `/context`
  Shows the live tree, breadcrumb, progress bar, quick actions, and suggested commands.
- `/contextflow`
  Alias for `/context`.
- `/done`
  Marks the active node as done and returns focus to the parent branch when possible.
- `/merge`
  Folds the current detour back into its parent.
- `/move_to <nodeId>`
  Reparents the current node into a different branch.
- `/rename_node <new_title>`
  Renames the active node.

## Release Checklist

1. Confirm `DISTRIBUTION/SKILL.md` and `DISTRIBUTION/skill.json` describe the same commands.
2. Run `node scripts/engine.js --view` from the repo root.
3. Run `node scripts/engine.js --view` from a nested subdirectory and confirm it still finds the project `state.json`.
4. Run `sh install.sh "$HOME/.claude/skills/contextflow"` and confirm the installed files exist.
5. If you changed the tree format, commit the matching `state.json` fixture or demo evidence.
