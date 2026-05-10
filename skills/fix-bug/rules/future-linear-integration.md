---
title: Future — Linear Integration Shape
impact: LOW
tags:
  - linear
  - integration
  - roadmap
  - documentation-only
---

# Future: Linear integration

The current `linear-ticket-investigator` agent and `/batch-linear-tickets` skill cover Linear
investigation end-to-end, but they own their own planner-and-executor handoff. The intended
end-state for `/fix-bug` is to become **the single bug-fixing engine**, with Linear as one of
several input adapters.

This rule is documentation-only. It exists so the migration target is unambiguous when the work is
picked up. The `/fix-bug` v1 does not implement any of this.

## Contents

- [Target shape](#target-shape)
- [What `/fix-bug` gains](#what-fix-bug-gains)
- [What `linear-ticket-investigator` loses](#what-linear-ticket-investigator-loses)
- [What `/batch-linear-tickets` becomes](#what-batch-linear-tickets-becomes)
- [Tradeoff to preserve](#tradeoff-to-preserve)

---

## Target shape

```text
/fix-bug <Linear URL>
  → linear-ticket-investigator  (refactored: returns an Evidence Record, not a Decision Pack)
  → /fix-bug Phase 2 (source mapping)
  → /fix-bug Phase 3 (holistic analysis)
  → /fix-bug Phases 4 / 5 / 6 as today
```

`/batch-linear-tickets` becomes a thin batching wrapper:

```text
/batch-linear-tickets SUP-1 SUP-2 SUP-3
  → for each ticket: linear-ticket-investigator → Evidence Record
  → cross-ticket correlation (today's logic, unchanged)
  → user approval gate (today's logic, unchanged)
  → fan out /fix-bug Phases 3–6 in parallel
  → for each successful PR: post comment + status to the Linear ticket
```

## What `/fix-bug` gains

A **Linear** input route in Phase 0's classification table:

```markdown
| Linear ticket URL | Matches `https?://linear\.app/.+/issue/` | Invoke `linear-ticket-investigator` (refactored) → continue at Phase 2 with the returned Evidence Record |
```

Roughly 20 lines of new code in the classification table and a thin call-out.

## What `linear-ticket-investigator` loses

All analysis-side responsibilities. After the refactor it does only:

1. Read the ticket via Linear MCP.
2. Use the project's domain-navigator skill to map ticket terminology to component directories.
3. Extract evidence: video attachments, Dash0 links, stack traces in description / comments,
   code pointers, screenshots.
4. Return an **Evidence Record** (the same shape `/fix-bug` Phase 2 produces).

Removed: root-cause analysis, fix proposal, certainty markers, confidence scoring. Those move to
`/fix-bug` Phases 3–4.

Estimated reduction: roughly half of the current agent definition.

## What `/batch-linear-tickets` becomes

Drops Phases 4–6 of its current orchestration (the planner/executor dispatching). Keeps:

- Phase 1 — Parallel investigation (now returns Evidence Records).
- Phase 2 — Cross-ticket correlation (unchanged).
- Phase 3 — User approval gate (unchanged).
- A new thin Phase 4 that fans out `/fix-bug` Phases 3–6 in parallel — one call per approved
  ticket / correlated group.
- Phase 7 — Linear writeback (unchanged).

Estimated reduction: roughly 80 lines of orchestration code.

## Tradeoff to preserve

Today `linear-ticket-investigator` can be invoked standalone for **read-only** Linear analysis —
the user gets findings without ever touching `aw-planner` / `aw-executor`. After the refactor, the
"investigate one ticket" entrypoint becomes `/fix-bug <linear-url>`, which by default proceeds
through Phases 3–6.

To preserve standalone analysis, `/fix-bug` should accept an `--analyse-only` flag that stops at
Phase 4 (after the confidence gate) and returns the proposal without spawning `aw-planner`. This
flag is not part of v1 — add it as part of the Linear refactor.
