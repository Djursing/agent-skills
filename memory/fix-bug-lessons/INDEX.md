# fix-bug-lessons — Memory Index

> Procedural lessons `/fix-bug` learns across bugs, about its **own diagnostic
> phases** (intake, triage, reproduction, analysis, branch decision, telemetry
> verification). Implementation-phase lessons live in `aw-lessons` instead
> (written by `aw-executor`). This is the **fast tier** of fix-bug's
> self-improvement loop — see
> [`skills/workflow/fix-bug/rules/self-improvement-loop.md`](../../skills/workflow/fix-bug/rules/self-improvement-loop.md).
>
> Read at Phase 0.5 (triage), keyed by `bugClass` + input shape. Written at
> Phase 7 verifier-red, Phase 8 telemetry-still-firing, triage upgrades, and
> Phase 5 stops. Managed by `/persistent-memory`.
>
> Keep ≤ 200 lines. When it exceeds 200, run
> `/persistent-memory consolidate fix-bug-lessons`.

## Lessons by phase

### Phase 0 — Intake / bugClass classification

### Phase 0.5 — Complexity triage

### Phase 2b — Reproduction lock

### Phase 3 — Root-cause analysis

### Phase 4–5 — Confidence gate / branch decision

### Phase 8 — Telemetry verification

## Promotion-eligible (seen_count ≥ 3 or `structural`)

> Candidates for `/create-skill diagnose fix-bug`. Clear once promoted.

---

<!-- Maintainer notes (stripped from context by Claude Code):
     - Cap: 200 lines. One sentence per lesson line.
     - trigger-context is keyed by bugClass + input shape.
     - Recurrence (seen_count) is the promotion signal; never promote on one run.
     - Every lesson expires (default 90 days) — consolidate prunes stale ones.
     - Do NOT record implementation-phase lessons here — those belong in aw-lessons.
-->
