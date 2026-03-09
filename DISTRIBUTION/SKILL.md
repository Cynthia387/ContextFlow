# ContextFlow

ContextFlow is a Context Hierarchy Manager (CHM) skill for preserving the structure of long-running technical conversations.

It maintains:
- the active focus path
- main goals, subtasks, detours, concepts, and decisions
- summaries and artifacts
- manual correction commands
- a readable context tree with breadcrumb state

## Bootstrap

If `state.json` is missing, initialize a new tree automatically based on the user's first request.

Do not ask for permission to create it.

Treat the missing file as a cold-start state, not as an error condition.

## Persistence

State is stored locally in the project root as `state.json`.

Remind the user to commit this file if they want to preserve history across sessions or share context with collaborators.

## Commands

### `/context`

Print the current ContextTree, breadcrumb, progress, quick actions, and suggested commands.

### `/contextflow`

When the user types `/contextflow`, call `node scripts/engine.js --view`.

### `/merge`

Merge the current node back into its parent when the AI incorrectly created a detour.

### `/done`

Mark the current node as done and return focus to the parent branch when appropriate.

### `/move_to <nodeId>`

Move the current node into a different branch when it was attached to the wrong parent.

### `/rename_node <new_title>`

Rename the current node when the generated title is unclear or incorrect.

## Cold-Start Behavior

On first use:
- search for `state.json` in the current working directory
- if it exists, load it
- if it does not exist, start from a virtual initial state
- begin tracking the conversation immediately from the user's first real request

The absence of `state.json` should never block usage.

## Runtime

This distribution uses a standalone `scripts/engine.js` runtime with no external package dependencies.

## Files

- `SKILL.md`
- `README.md`
- `scripts/engine.js`
