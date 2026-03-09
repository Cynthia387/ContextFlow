# ContextFlow Skill

ContextFlow Skill is a Context Hierarchy Manager (CHM) runtime for preserving conversation structure as a live project state.

It tracks:
- active focus
- subtasks and detours
- summaries and artifacts
- manual corrections
- injected context for future answers

## Reading The Tree

The rendered context tree uses:
- `🎯` main goal
- `🖇️` subtask
- `🔀` detour
- `💡` concept
- `🧭` decision
- `✅` done
- `⏳` in progress
- `🅿️` parked
- `⛔` blocked

Only the current focus node expands to show summary bullets. Other nodes stay compact so the tree remains readable.

## Example Output

```text
# Context Tree

[##--------] 2/8

🎯 ⏳ A Project Start
    • Build the login page.
    • Track audit logging requirements for authentication failures.
    ├── 🔀 ✅ A.1 JWT work
    └── 🔀 ⏳ A.2 OAuth hardening
        └── 💡 ⏳ A.2.1 PKCE exchange
            ├── 🔀 ✅ A.2.1.1 Legacy callback cleanup
            ├── 🔀 ✅ A.2.1.2 Session cookie fallback
            ├── 🔀 ✅ A.2.1.3 Token introspection note
            └── 🧭 ⏳ A.2.1.4 Refresh token rotation

## Breadcrumb

Focus: A > A.2 > A.2.1 > A.2.1.4 (Refresh token rotation)
Next: Refresh rotation should reduce replay risk without breaking the sign-in flow.

## Quick Actions

[Merge] [Done] [Park]

## Suggested Commands

- `back`
- `done`
- `park`
- `merge`
- `rename_node <new_title>`
```

## CLI

Render the current context state:

```bash
node bin/context.ts
```

Bootstrap a new project with the basic CHM files and folder structure:

```bash
sh bin/init.sh /path/to/new-project
```

## How To Use

### Trigger a Detour

Use a side-question or concept question that is not necessary to finish the current step immediately.

Examples:
- `"Wait, how does JWT work?"`
- `"Why do people use Tailwind instead of CSS modules?"`

In the rendered UI, low-confidence detours surface a footer like:

```text
User Action Required: I've placed this in a detour. Type 'merge' if you'd rather keep this in the main flow.
```

### Read `context.ts` Output

The CLI shows:
- a progress bar for `done / total nodes`
- a Markdown tree with emoji type/status markers
- summary bullets only for the active focus node
- quick actions for the current node
- suggested commands for the next correction or navigation step

Typical reading order:
1. Check the progress bar.
2. Read the current focus in the breadcrumb.
3. Inspect the expanded node summary.
4. Use quick actions or suggested commands to correct the tree if needed.

### Use Manual Commands

The manager supports manual correction commands when the AI places something incorrectly:

- `merge_up`
  - Merge the current node back into its parent.
- `move_to <nodeId>`
  - Re-parent a node into a different branch.
- `rename_node <new_title>`
  - Fix an AI-generated title.
- `done`
  - Mark the current node complete.
- `park`
  - Defer the current node.
- `back`
  - Return to the parent branch.

### Savepoints

At the end of each major milestone, the CHM skill should suggest a savepoint message derived from the current tree state.

Example:

```text
Savepoint: feat(chm): add context injection, summary consolidation, and manual override flow
```

## Core Runtime

The main runtime pieces are:
- `src/core/manager.ts`
- `src/services/classifier.ts`
- `src/services/summarizer.ts`
- `state.json`

This project does not just document context. It maintains context as persistent runtime state.
