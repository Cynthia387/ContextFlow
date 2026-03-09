# ContextFlow Skill Distribution

ContextFlow is a Claude Code style injectable skill for managing long-running technical conversations as a live context tree.

It is designed to be frictionless on first use:
- if `state.json` already exists, the runtime loads it
- if `state.json` is missing, the runtime starts from a virtual initial state
- the first real user request becomes the seed for the tree

## Install

To use, copy these files to your skills directory, then type `/context` in your AI terminal.

Quick install:

```bash
sh install.sh
```

Custom install target:

```bash
sh install.sh ~/.claude/skills/contextflow
```

If no Claude Code skills directory is detected, the installer falls back to:

```bash
./.contextflow
```

and prints a clear message explaining where the files were installed.

## Installed Files

- `SKILL.md`
- `README.md`
- `scripts/engine.js`

## Commands

- `/context`
  - Show the current context tree, breadcrumb, progress, quick actions, and suggested commands.
- `/merge`
  - Merge the current branch back into its parent when the AI created an unnecessary detour.
- `/done`
  - Mark the current node done and return focus to the parent branch when appropriate.

## Typical Usage

1. Install the skill into your skills directory.
2. Start your AI terminal.
3. Type `/context` to inspect the current tree.
4. If the AI created the wrong branch, use `/merge`.
5. If the current node is finished, use `/done`.

## Using Without Claude Code

You can still get most of the value without Claude Code.

For a lightweight setup:
1. Copy `SKILL.md` into your project root or prompt system.
2. Copy `scripts/engine.js` into your project.
3. Keep a local `state.json` in the project root.

This gives you roughly 80% of the benefit:
- manual JSON-backed tracking
- context rendering
- summarization
- branching
- merge/done style command handling

Even in Cursor, ChatGPT, or another AI terminal, the pattern still works if you keep the state file nearby.

## Best Practices

- Keep `state.json` in your `.gitignore` if it contains private or local-only history.
- Commit `state.json` if you want to share evolving context with your team.
- Use `/context` at the start of a session to rehydrate the current branch.
- Use `/merge` quickly when a detour should stay in the main flow.
- Let the tree stay lightweight: only the current focus needs detailed summaries.

## Notes

- The bundled runtime is contained in `scripts/engine.js`.
- It uses only built-in Node.js modules.
- No package manager install step is required for the distributed runtime.
- State is stored locally in the project root as `state.json`.
