---
title: 'Error Recovery Procedures'
impact: HIGH
tags:
  - errors
  - recovery
  - troubleshooting
---

# Error Recovery Procedures

## Overview

Recovery procedures for common errors during autonomous execution. Don't give
up on errors — diagnose and recover. Where a companion skill is unavailable
or a stuck-loop trips, the workflow has explicit fallback paths so it never
gets stuck silently.

---

## Worktree Creation Failures

**Error:** `gw add` or `git worktree add` fails

| Cause                 | Fix (with `gw`)                        | Fix (native `git worktree`)                                   |
| --------------------- | -------------------------------------- | ------------------------------------------------------------- |
| Branch already exists | Use different name or `gw cd <branch>` | `git worktree list` to inspect, then `cd` into the existing path or pick a new branch name |
| Permission error      | Check directory permissions            | Check directory permissions on `../<repo>-<branch-slug>`      |
| Disk space issue      | Run `gw prune`, free space             | `git worktree prune`, free space                              |
| Path collision        | Pick a different branch name           | `git worktree list` shows occupied paths; pick a different branch slug |
| Git error             | Read message, fix underlying issue     | Read message, fix underlying issue                            |

If `gw` is not installed at all, that is **not** a failure — it's the expected
native fallback. See
[prerequisites#fallback-to-native-git-worktree](./prerequisites.md#fallback-to-native-git-worktree).

---

## Dependency Installation Failures

**Error:** `./mvnw ...` (or equivalent dependency/bootstrap step) fails

| Cause                   | Fix                                                                  |
| ----------------------- | -------------------------------------------------------------------- |
| Network / repo error    | Check connection, proxy, and repository availability; retry with `./mvnw -U` |
| Bad artifact version    | Verify dependency coordinates and versions in `pom.xml`             |
| Local cache corruption  | Remove affected artifacts under `~/.m2/repository`, rerun wrapper   |
| Toolchain mismatch      | Verify Java version (`java -version`) matches project requirements  |
| Disk space              | Free space, then retry Maven goal                                    |

---

## Test Failures During Iteration

See [phase-4-testing](./phase-4-testing.md) for the full iteration strategy.

**Quick reference (mode-aware cap):**

| Mode      | Cap | At cap action                                                   |
| --------- | --- | --------------------------------------------------------------- |
| Lite Mode | 3   | Run `Skill("confidence", "bug-analysis")`, auto-replan or escalate |
| Full Mode | 5   | Run `Skill("confidence", "bug-analysis")`, auto-replan or escalate |

After hitting the cap on the same failing area, **stop guessing**. Token spend
beyond the cap rarely converges.

---

## Stuck-Loop Cap Hit

**Detection:** Same failing test or area hit the mode cap without resolution
(3 in Lite, 5 in Full).

**Recovery (mandatory):**

1. Run `Skill("confidence", "bug-analysis")` to root-cause the failure.
2. Append to `plan.md` Progress Log: a one-line summary of each prior attempt
   plus the confidence findings.
3. Present to the user:
   - The capped attempts (what was tried, why each failed)
   - Confidence findings (root cause, blocked assumptions)
   - Three options: **continue** with new approach / **try a different angle**
     (e.g. holistic-analysis) / **stop and hand back**
4. Wait for user response. **Never auto-continue past the mode cap.**

If the user asks for a fresh analysis, invoke
`Skill("holistic-analysis")` to step back and re-trace the execution path
end-to-end before attempting again.

---

## Companion Skill Not Available

**Detection:** A companion skill is invoked but isn't installed in this
project (Claude returns an error from the Skill tool).

**Recovery:**

1. Log one line in the conversation:
   `companion: <name> — not available, continuing`
2. Append the same line to `plan.md` Progress Log (Full Mode).
3. Continue the workflow. **Never block on a missing companion.**

The only companion that cannot be skipped is `confidence` at Phase 1 (the plan
gate). If `confidence` itself is unavailable, stop and ask the user to
install it before continuing.

---

## Build Failures

| Cause                        | Fix                                                              |
| --------------------------- | ---------------------------------------------------------------- |
| Java compilation error      | Fix type/signature mismatch, imports, null handling             |
| Spring context boot failure | Inspect failing bean/config; fix wiring/profiles/properties     |
| Surefire test failure       | Isolate with `-Dtest=Class#method`, fix root cause, rerun       |
| Failsafe integration failure| Re-run targeted ITs; validate external deps (DB, containers)    |
| Missing dependency          | Add/adjust Maven dependency and scope in `pom.xml`              |
| Plugin/config error         | Review plugin config (`surefire`, `failsafe`, `checkstyle`, etc.) |

---

## CI Failures (Phase 7)

When CI runs complete with status `failure`:

1. Identify the failed checks (`gh pr checks <pr>`).
2. For each independent failure, invoke `Skill("ci-auto-fix", "<run-id|pr-url>")`.
3. Up to 2 parallel `ci-auto-fix` handoffs per PR (see
   [parallel-coordination](./parallel-coordination.md)).
4. If `ci-auto-fix` is not installed: log
   `companion: ci-auto-fix — not available, continuing` and surface the failed
   checks to the user with reproduction commands.

See [phase-7-ci-gate](./phase-7-ci-gate.md) for details.

---

## Agent-Specific Recovery

### Hallucinated Commands

| Hallucinated Command | Correct Command (with `gw`) | Correct Command (native `git worktree`)            |
| -------------------- | --------------------------- | -------------------------------------------------- |
| `gw create`          | `gw checkout` or `gw add`   | `git worktree add -b <branch> <path>`              |
| `gw switch`          | `gw cd`                     | `cd <worktree-path>` (manual)                      |
| `gw delete`          | `gw remove`                 | `git worktree remove <path>` then `git branch -d <branch>` |
| `gw new`             | `gw checkout`               | `git worktree add -b <branch> <path>`              |

### Stuck in Loop

**Detection:** Same fix attempted 3 times without progress (covered above
under "Stuck-Loop Hit at 3 Iterations").

### Context Loss

**Detection:** Agent re-does completed work or asks already-answered questions.

**Recovery:**

1. Read `.agent/{branch}/plan.md` for full context (decisions, progress,
   requirements).
2. Check Progress Log for what's been completed and which companions ran.
3. Resume from where the log left off.

---

## References

- Related rule: [phase-4-testing](./phase-4-testing.md)
- Related rule: [phase-7-ci-gate](./phase-7-ci-gate.md)
- Related rule: [companion-skills](./companion-skills.md)
- Related rule: [safety-guardrails](./safety-guardrails.md)
