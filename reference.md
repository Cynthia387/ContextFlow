# Context Hierarchy Manager -- Reference

Detailed edge cases, examples, and advanced behavior for the CHM skill.

## Edge Cases

### B becomes the new main goal

If the user keeps asking about B and stops caring about A:

- Promote B to new root, park A.
- Make the change explicit: "It looks like learning goroutines is the priority now; I'm parking A so we don't lose it."

### Multiple detours at once

Keep only one active focus. Other detours go to the parking lot with explicit labels.

### Tree becomes large

Collapse older done nodes into a single "Done (collapsed)" section with short titles. Keep full details only in node summaries/artifacts.

### Quick clarifications vs. detours

If the answer is ~2 sentences and doesn't require extended focus, fold it into the current node as inline context rather than creating a new detour.

## Example Interaction

### Setup

**User:** "Help me troubleshoot issue A: deadlock on shutdown."

**Agent:**

- Creates node **A** (`main`, `in_progress`)
- Focus: A
- Responds with debugging plan

```
Focus: A (Fix deadlock on shutdown)
Next: Reproduce the deadlock and examine goroutine dump
```

### Detour

**User:** "You used goroutines in the fix -- what are goroutines?"

**Agent:**

- Creates detour node **B** under A (`concept`, `in_progress`)
- Focus: A > B
- Explains goroutines

```
- [in progress] A Fix deadlock on shutdown
  - [in progress] B Learn: goroutines + cancellation

Focus: A (Fix deadlock) > B (What are goroutines?)
Next: Answer goroutines basics, then return to implementing the worker fix in A
```

### Return

**User:** "Ok, back to fixing the deadlock."

**Agent:**

- Marks B as done
- Focus returns to A
- Continues implementation steps

```
- [in progress] A Fix deadlock on shutdown
  - [done] B Learn: goroutines + cancellation

Focus: A (Fix deadlock on shutdown)
Next: Apply cancellation pattern to the worker shutdown path
```

### Nested detour

**User:** "Wait, should I use channels or mutexes here?"

**Agent:**

- Creates detour **C** under B (or as sibling, depending on context) (`decision`, `in_progress`)
- Focus: A > C

```
- [in progress] A Fix deadlock on shutdown
  - [done] B Learn: goroutines + cancellation
  - [in progress] C Decision: channels vs mutexes

Focus: A (Fix deadlock) > C (Channels vs mutexes?)
Next: Compare channels and mutexes for this use case, then return to A
```

## UI Implementation Notes

Ideal UX is a two-panel layout:

- **Left**: conversation
- **Right**: live tree (clickable, each node shows summary + artifacts, highlights relevant messages)

When that's not available, inline Markdown tree + breadcrumb is the fallback -- which is what the SKILL.md specifies.
