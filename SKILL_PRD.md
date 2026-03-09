# Context Hierarchy Manager - Core Logic PRD

## Overview

This document defines the core logic for managing a hierarchical context tree of goals and subtopics. It focuses on node management, branch identification, and state handling, while excluding Chrome extension DOM injection, native UI layout, and other presentation-layer concerns.

## Workflow

The operating workflow for CHM is:

`User talks -> AI updates Tree (Silent) -> AI responds -> AI appends Breadcrumb (Visible)`

Operational implications:
- The tree update is part of the answering process, not an optional follow-up.
- The agent should silently classify the turn, update focus and summaries, and persist `state.json` before or during response generation.
- The visible answer should remain concise, while the breadcrumb exposes only the minimum context needed for continuity.
- The system should treat `ContextManager` as the runtime bridge between conversation and project state.

## Manifesto

CHM is not only a documentation style or UI convention. It is the state-management layer for the project itself.

Principles:
- The agent does not merely write code; it manages project state.
- Each meaningful user turn should be reflected in the tree through intent analysis, focus management, summary updates, and artifact capture.
- `state.json` is the living record of the conversation's working structure.
- Breadcrumbs are the visible trace of an already-updated internal state, not a substitute for it.

## Core Concepts

### Node Structure

A node represents a goal, question, detour, or subtask in the context tree.

Fields:
- `id`: Stable identifier such as `A`, `A.1`, or `B`
- `title`: Short descriptive label
- `type`: `main`, `subtask`, `detour`, `concept`, or `decision`
- `status`: `in_progress`, `parked`, `done`, or `blocked`
- `definition_of_done`: One-line completion criteria
- `summary`: Rolling summary with 3-7 concise bullets
- `artifacts`: Optional references to files, functions, or code blocks
- `parent_id`: Parent node reference, or `null` for root
- `children_ids`: Ordered child node references

### Focus Path

The focus path is the active chain from the root node to the current working node.

Properties:
- Starts from the root/main node
- Ends at the active node
- Represents the current conversation context
- Example: `A > B > C`

### Parking Lot

The parking lot is a bounded list of deferred items that should not be lost while focus remains elsewhere.

Defaults:
- Maximum length: 5 items
- Each item should include a short resume hint

## Core Logic: Node Management

### 1. Node Creation

Create a node when:
- The initial task or objective is introduced
- The user starts a true detour
- The current work naturally decomposes into subtasks
- A new independent goal appears

Creation algorithm:
1. Determine the node type from message intent.
2. Assign a stable ID.
3. Set initial status to `in_progress`.
4. Infer `title` and `definition_of_done`.
5. Initialize `summary` and `artifacts`.
6. Attach the node to the correct parent.
7. Update the parent's `children_ids`.

### 2. Node Update

Update a node when:
- Progress is made
- New facts are learned
- Relevant artifacts are produced
- Completion or blocking conditions change

Update algorithm:
1. Identify the relevant node from the focus path.
2. Append a concise summary bullet.
3. Update `artifacts` if concrete references were produced.
4. Update `status` if the node is completed, deferred, or blocked.
5. Trim summaries to the configured length.

### 3. Node Status Transitions

Allowed transitions:
- `in_progress -> done`
- `in_progress -> parked`
- `in_progress -> blocked`
- `parked -> in_progress`
- `blocked -> in_progress`

Rules:
- `done` is terminal unless the system explicitly reopens the node.
- Parking a focused node usually returns focus to its parent.
- Blocking a node should record the dependency or missing condition.

### 4. Node Merging

Merge nodes when:
- Two nodes represent effectively the same work
- A detour is later recognized as part of the main flow
- The user explicitly asks for consolidation

Merge algorithm:
1. Select source node `B` and target node `A`.
2. Merge summaries, removing obvious duplicates.
3. Merge artifacts.
4. Reattach children of `B` under `A`.
5. Replace references to `B` with `A`.
6. Remove `B`.
7. Repair the focus path if needed.

### 5. Node Splitting

Split a node when:
- A single objective is actually multiple independent objectives
- The user asks to separate the work into parallel branches

Split algorithm:
1. Identify the node to split.
2. Define the new child or root objectives.
3. Redistribute summary bullets and artifacts.
4. Move existing children to the most appropriate new branch.
5. Create new nodes with stable IDs.
6. Mark the original node as reframed or done, depending on intent.
7. Update the focus path.

### 6. Node Reframing

Reframe when:
- The user's real goal changes
- A former detour becomes the main objective
- The original root objective no longer reflects the conversation

Reframing algorithm:
1. Identify the node or subtree to promote.
2. Update `title` and `definition_of_done`.
3. Promote or restructure the tree as needed.
4. Park or subordinate the previous root if it still matters.
5. Update the focus path and related references.

## Core Logic: Branch Identification

### 1. Intent Parsing

Classify each user message as one of:
- `continue_current`
- `concept_question`
- `detour_request`
- `new_goal`
- `meta_request`

Intent parsing algorithm:
1. Read the message for explicit asks and implicit shifts.
2. Check whether it references current work or starts a new topic.
3. Determine whether it is required to finish the current node.
4. Classify the message using detour heuristics.

### 2. Detour Detection

Create a detour node when:
- The user asks "what is X?", "explain X", or "why did you use X?"
- The user wants a deeper conceptual explanation
- The discussion shifts to optional alternatives
- The answer will likely require extended focus or multiple turns

Do not create a detour when:
- The clarification is required to finish the current task immediately
- The answer is short and can be absorbed inline
- The discussion is a necessary implementation step rather than a branch

Practical heuristics:
1. Longer, multi-turn conceptual answers usually become detours.
2. Blocking implementation questions usually stay inside the current branch as subtasks.
3. Optional exploration becomes `detour`, `concept`, or `decision` depending on intent.

### 3. Node Relationship Decision

Decision model:

```text
IF intent == new_goal:
    create sibling or new root

ELSE IF intent == concept_question OR detour_request:
    IF it directly relates to the current node:
        create child under current focus
    ELSE IF it relates to an ancestor:
        create child under that ancestor
    ELSE:
        create sibling branch

ELSE IF intent == continue_current:
    update current node

ELSE IF intent == meta_request:
    execute tree operation without creating a normal content node
```

### 4. Branch Type Classification

Assign types with these rules:
- `main`: primary root objective
- `subtask`: required step needed to finish the parent
- `detour`: optional side exploration
- `concept`: learning or explanation request
- `decision`: comparison or choice between alternatives

## Core Logic: State Handling

### 1. Focus Path Management

Push into detour:
1. Create a child node under the current focus.
2. Extend the focus path.
3. Record the intended return point in the parent summary.

Pop back to parent:
1. Mark the current node as `done` or `parked`.
2. Remove it from the active focus path.
3. Restore focus to the parent node.

Switch focus:
1. Identify the target node.
2. Move focus to that node.
3. Reactivate it if its status is `parked`.
4. Keep the switch explicit in the response.

Validation rules:
- Every node in the focus path must exist.
- The leaf node should normally be `in_progress`.
- Deletions or merges must repair the focus path immediately.

### 2. Status State Machine

```text
in_progress:
  -> done
  -> parked
  -> blocked

parked:
  -> in_progress
  -> done

blocked:
  -> in_progress
  -> parked

done:
  terminal by default
```

Status triggers:
- `done`: completion criteria met or user confirms completion
- `parked`: intentional deferral or focus shift
- `blocked`: external dependency or missing prerequisite
- `in_progress`: active focus resumes or blockage clears

### 3. Parking Lot Management

Add to parking lot:
1. Capture the deferred item.
2. Store a short resume hint.
3. Reference the node ID when applicable.
4. Drop the oldest item when the list exceeds its limit.

Remove from parking lot:
1. Remove the entry when the item is resumed.
2. Remove the entry when the item is marked done.
3. Remove stale entries when they are no longer relevant.

### 4. Tree Consistency Maintenance

Consistency rules:
1. Every non-root node must have a valid parent.
2. Every parent must correctly reference its children.
3. Node IDs must remain unique and stable.
4. The focus path must contain only valid nodes.
5. Status transitions should follow the defined state model.

Consistency check after each tree mutation:
1. Verify all `parent_id` references.
2. Verify all `children_ids` references.
3. Verify the active focus path.
4. Detect orphans and dangling references.
5. Repair structural inconsistencies immediately.

Cleanup operations:
- Remove orphaned nodes
- Repair parent/child mismatches
- Collapse large completed subtrees into summarized history
- Discard stale completed branches only when safe

## Step-by-Step Processing Algorithm

On each user message:
1. Parse intent.
2. Decide the node action.
3. Update the tree structure.
4. Update the focus path.
5. Transition statuses as needed.
6. Run consistency checks.
7. Generate the response aligned with the active node.

## Edge Cases

### A detour becomes the main goal

If the user keeps focusing on a detour and the original root loses priority:
- Promote the detour to the new root
- Park or subordinate the old root
- Make the reframe explicit

### Multiple detours appear at once

Rules:
- Keep only one active focus path
- Move other detours into the parking lot or keep them parked
- Let the user explicitly choose which branch to resume

### The tree becomes large

Strategies:
- Collapse older completed nodes into summarized history
- Preserve details in summaries and artifacts
- Keep navigation shallow by default

### Quick clarification vs true detour

Guideline:
- If the answer is about two sentences and does not require extended focus, keep it inside the current node
- Otherwise, create a detour node

## Configuration Defaults

| Parameter | Default | Description |
|---|---|---|
| Max tree depth | 4 | Maximum recommended nesting level |
| Node summary length | 7 bullets | Maximum rolling summary length |
| Parking lot length | 5 items | Maximum deferred items stored |
| Auto-collapse threshold | 10 done siblings | Collapse completed branches beyond this size |
| Breadcrumb display | Always when CHM is surfaced | Minimal context shown to user |

## Commands (Logical Interface)

| Command | Effect |
|---|---|
| `toc` / "show tree" | Return the current tree |
| `focus <node>` | Switch active focus |
| `park <node>` | Mark a node as parked |
| `done <node>` | Mark a node as done |
| `back` | Return focus to the parent |
| `merge <B> into <A>` | Merge two nodes |
| `split <node>` | Split a node into branches |
| `summarize <node>` | Return node summary and artifacts |

## Exclusions

This PRD intentionally excludes:
- Chrome extension DOM injection logic
- Native UI layout
- Two-panel visual layout specifications
- UI rendering behavior beyond minimal conceptual breadcrumb usage
