---
name: context-hierarchy-manager
description: Organize and maintain a hierarchical context tree of goals and subtopics during a conversation, allowing the user to explore detours without losing the main thread. Use when troubleshooting, building, debugging, refactoring, or designing something non-trivial, when the conversation contains multiple topics or interruptions, or when the agent introduces unfamiliar concepts that may prompt learning detours.
---

# Context Hierarchy Manager (CHM)

Maintain a **hierarchical context tree** of goals and subtopics so the user can safely explore detours without losing the main thread.

## When to Use

Use CHM when:

- The user is troubleshooting, building, debugging, refactoring, or designing something non-trivial.
- The conversation contains multiple topics, interruptions, or "by the way" questions.
- The agent introduces unfamiliar concepts that may prompt learning detours.

CHM can be lightweight for small tasks (breadcrumb only) and more structured for large ones (full tree + statuses).

## Core Concepts

### Node

A node represents a goal, question, detour, or subtask.

| Field | Description |
|---|---|
| `id` | Stable identifier (e.g., `A`, `A.1`, `B`) |
| `title` | Short label |
| `type` | `main`, `subtask`, `detour`, `concept`, or `decision` |
| `status` | `in_progress`, `parked`, `done`, or `blocked` |
| `definition_of_done` | One line |
| `summary` | 3-7 bullet rolling summary |
| `artifacts` | Optional pointers (files, functions, code blocks) |
| `parent_id` / `children_ids` | Tree relationships |

### Focus Path

The current chain of active nodes from root to leaf:

- **Root/main node** (usually A)
- **Active focus path** (e.g., `A > B > C`)

### Parking Lot

A short list (max 5 items) of intentionally deferred items, e.g.:

- "Return to A step 3: verify race condition"
- "Follow-up question about goroutine scheduling"

## Required Behaviors

### 1. Maintain an internal context tree silently

State tracking is part of the runtime, but it should stay invisible to the user during normal conversation.

- Execute state-changing operations such as `--add-node` and `--update-node` silently in the background.
- Do not narrate the update process.
- Do not confirm that a background update happened unless the user explicitly asks about the state mechanism.
- Only trigger background updates for significant milestones, task transitions, branch changes, or decisions that materially move the project forward.
- Do not trigger updates for simple Q&A or brief conceptual explanations unless they clearly change the active plan.

### 2. Make focus changes explicit

When shifting focus (e.g., A to B):

- State the switch and the return point.
- Example: "Switching focus to **B (goroutines)** to answer your question. After that, we'll return to **A** at 'integrate the fix into `worker.go`.'"

### 3. Keep outputs minimally intrusive

Default display is the **breadcrumb + next step** (1-2 lines).

- Never display the full context tree automatically.
- Only render the tree when the user explicitly invokes `/context` or directly asks to see the tree/map.
- Prefer token-efficient continuity over verbose context dumps during normal conversation.

### 4. Support merge/split/reframe

The agent must be able to:

- **Merge** node B into A when it's not a true detour.
- **Split** A into multiple root-level objectives when needed.
- **Reframe** the root objective if the user's real goal changes.

### 5. Keep node summaries updated and compact

- Update only the relevant node(s) each turn.
- Prefer bullets, avoid copying large code blocks into summaries.
- Store code references in "artifacts" instead.

## Display Spec

### Breadcrumb (always shown)

Append at the end of each response:

```
Focus: A (Fix crash) > B (What are goroutines?)
Next: Answer goroutines basics, then return to implementing the worker fix in A
```

### Full ToC (shown only on `/context` or explicit request)

Render as a professional terminal-style Git graph / ASCII tree with clean hierarchy and minimal visual noise.

Visualization rules:

- Use standard tree connectors consistently: `├──`, `└──`, and `│`.
- Only top-level branches may carry category icons.
- Use one consistent icon style at the top level, such as `📂` for the root plus category icons like `🛠️`, `🔍`, and `🚀` for first-level branches.
- Do not mix unrelated icon styles within the same hierarchy level.
- Do not place miscellaneous emojis at the start of every nested item.
- For non-top-level task lines, use status markers only:
  - `[ ]` for todo
  - `[>]` for in progress
  - `[x]` for completed
- Keep the structure visually led by the tree itself, not by per-line decoration.
- Maintain the silent-update rule: never show this tree unless the user explicitly calls `/context` or directly asks for the tree.

```text
📂 Project: Chrome Extension
├── 🛠️ Core Development
│   ├── [x] manifest.json
│   └── [>] background.js
├── 🔍 Research & Detours
│   └── [ ] SidePanel API vs Popup
└── 🚀 Deployment
    └── [ ] Chrome Web Store Upload
```

This should read like `git log --graph` translated into a project map: structured, sparse, and easy to scan.

### Export View

If the user asks to `export`, `save map`, or requests a diagram:

- Generate a clean Mermaid.js code block representing the current tree.
- Use node ids and short titles.
- Preserve parent/child relationships.
- Include status in labels when useful.
- After the Mermaid block, add one brief tip telling the user they can paste it into a Mermaid editor or Markdown viewer with Mermaid support for a graphical view.

## Detour Detection Heuristics

**Create a detour node** when:

- User asks "what is X?", "explain X", "why did you use X?"
- User requests a deep dive into a concept introduced during solving A
- The agent proposes a technique requiring explanation (e.g., goroutines, async/await, RAII)
- Discussion shifts to alternative approaches unrelated to finishing A immediately

**Do NOT create a detour** when:

- The question is necessary to proceed with A immediately (keep it as a subtask within A)
- The user asks for a quick clarification (~2 sentences) that doesn't need extended focus

## Step-by-Step Algorithm

On each user message:

1. **Parse intent**: continue current work, concept question, new bug, new requirement, or meta request.
2. **Decide node action**: continue current, create child, create sibling, or reframe root.
3. **Update tree**: add node if needed (assign id, title, type, DoD), update status, append bullet to summary.
4. **Set focus path**: push on detour, pop on "back to main."
5. **Generate response**: answer aligned to the current focus node without mentioning background state writes.
6. **Render context UI**: always breadcrumb + next; render the full tree only on `/context` or explicit request; render Mermaid only on export/save-map request.

## Commands

Support these as natural language or shorthand:

| Command | Effect |
|---|---|
| `/context` or "show me the tree" | Show full Git-graph style tree |
| `focus <node>` or "let's work on B" | Switch focus |
| `park <node>` or "let's park that" | Mark node parked |
| `done <node>` or "that's resolved" | Mark node done |
| `back` or "back to the main issue" | Pop focus to parent |
| `merge <node> into <node>` | Merge nodes |
| `split <node>` | Split into children |
| `summarize <node>` | Print node summary |
| `export` or "save map" | Output a Mermaid.js representation of the current tree |

## Configuration Defaults

| Setting | Default |
|---|---|
| Show full ToC | `/context` only |
| Max tree depth | 4 |
| Node summary length | 7 bullets max |
| Parking lot length | 5 items max |
| Breadcrumb | Always on |

## Edge Cases

For detailed edge cases (reframing when B becomes the main goal, handling multiple simultaneous detours, collapsing large trees), see [reference.md](reference.md).
