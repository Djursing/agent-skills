---
title: Phase 5 — Fix-validation gate (selector existence + code confidence)
impact: HIGH
tags:
  - fix-validation
  - selector-evidence
  - confidence-gate
  - anti-hallucination
---

# Phase 5 — Fix-validation gate

The single most common way an automated E2E fix makes things **worse** is by inventing a selector that does not exist.
The trace shows `getByRole('button', { name: 'Save' })` timed out; the skill confidently rewrites the test to use `getByTestId('save-button')`; the production component never emits `data-testid="save-button"`; now the test fails harder than before.

This phase exists to refuse that class of error before a commit ever lands.

The gate runs **after the diff is drafted** (per Phase 5 in [`root-cause-and-fix.md`](./root-cause-and-fix.md)) and **before the commit**.
A fix that fails this gate is not "tried again with a worse selector" — it is discarded and the dossier re-enters Phase 4 with the failed-validation evidence attached.

---

## When this gate runs

| Trigger | Action |
|---------|--------|
| Phase 5 has produced a draft diff for a single test | Run the full gate (Steps 1–4 below). |
| Phase 6 broke a streak with a "selector did not resolve" failure | Run only Steps 2–3 (the selectors changed, not the analysis). |
| Multiple fixes in the working tree | Run the gate per fix, in the same order Phase 6 will run them. |

This gate is local-only.
It never modifies the diff under review; it accepts or rejects it whole.

---

## Step 1 — Score the diff with `Skill('confidence', 'code')`

```text
Skill('confidence', 'code')
```

The `code` mode of the confidence skill judges the *diff*, not the analysis.
It looks at things like:

- Does the change match a known fix pattern (P1–P6) cleanly?
- Are the new locators idiomatic for this repo (does `tests/e2e/src/lib/` use the same shape)?
- Is the assertion strength preserved (or strengthened) compared to the pre-fix code?
- Does the change touch only the test file(s) and not adjacent product code?

Apply this gate:

| Score | Action |
|-------|--------|
| ≥ 90 % | Continue to Step 2. |
| 70–89 % | Continue to Step 2 anyway — Steps 2–3 will either rescue the fix (selector confirmed) or reveal why the score was low (selector hallucinated). Re-score after Step 3 and re-apply the gate. |
| < 70 % | **Discard the diff.** Re-enter Phase 4 with the score and the confidence skill's rationale attached as evidence. Do not "try again with a different selector" — the diagnosis itself is suspect. |

Two confidence calls — one on analysis (Phase 4), one on code (here) — exist because the diagnosis and the diff are independently wrong-able.
A correct diagnosis can produce a wrong diff; a great-looking diff can rest on a wrong diagnosis.

---

## Step 2 — Static selector existence check

For every new locator the diff introduces, verify the selector resolves against the repo source code.

### Extract the new locators

Diff the old and new versions of each touched file, collecting every locator call:

```bash
git diff --unified=0 -- 'tests/e2e/**/*.spec.ts' 'tests/e2e/**/*.ts' \
  | grep -E '^\+' \
  | grep -oE 'getBy(Role|TestId|Text|Label|Placeholder|AltText|Title)\([^)]*\)|page\.locator\([^)]*\)|\[data-testid=[^]]+\]'
```

For each result, identify the *discriminator* — the string that uniquely names the element:

| Locator shape | Discriminator |
|---------------|---------------|
| `getByTestId('save-button')` | `save-button` (testid) |
| `getByRole('button', { name: 'Save changes' })` | `'Save changes'` (accessible name) + `button` (role) |
| `getByText('Welcome back')` | `Welcome back` (visible text) |
| `getByLabel('Email')` | `Email` (label text) |
| `page.locator('[data-testid="save-button"]')` | `save-button` (testid) |
| `page.locator('.save-btn')` | CSS class — **demote**, see below |

### Verify against source

For each discriminator, grep the product source for evidence the element actually exists:

```bash
# Testid discriminator — look for data-testid attribute in JSX / TSX / HTML.
rg -n --type-add 'jsx:*.{tsx,jsx}' \
  -tjsx -ttsx -thtml \
  "(data-testid|data-test-id)=[\"']<discriminator>[\"']" \
  src/ components/ apps/

# Accessible-name discriminator — match strings inside JSX text nodes or aria-label.
rg -n -ttsx -thtml -e "<discriminator>" -e "aria-label=[\"']<discriminator>[\"']" \
  src/ components/ apps/

# Localised text — also check i18n catalogues.
rg -n -tjson "<discriminator>" locales/ public/locales/ messages/ 2>/dev/null
```

Outcomes:

| grep result | Verdict |
|-------------|---------|
| One or more matches in a file the test actually navigates to | **Verified.** Continue to Step 3 to confirm rendering (or skip Step 3 if the match is unambiguous). |
| Matches only in another product surface (different page, different feature) | **Ambiguous.** Run Step 3 against the live app to confirm the actual page renders it. |
| Zero matches in product code | **Hallucinated.** Refuse the diff. Go to Step 4. |
| Match is in a comment, string literal, or storybook file but never reaches the rendered DOM | **Hallucinated** (the test will not see it). Refuse the diff. Go to Step 4. |

### Special cases

- **CSS-class locators (`.save-btn`)**: the static grep will find the class, but Playwright resolution depends on visibility and DOM placement. Always require a Step 3 live check for CSS locators.
- **i18n strings**: if the discriminator is a UI string and the app uses i18n, the JSX shows `{t('save.button')}` rather than the literal. Grep the i18n catalogue for the discriminator string; if found, treat the JSX `t('save.button')` call as the match.
- **Generated DOM (codegen, mdx)**: if the discriminator only appears in a generator, run Step 3 — the generated output is what Playwright sees, not the input.

---

## Step 3 — Live selector existence check

For locators that the static check flagged as **ambiguous**, or for CSS-class locators, verify against the running app.

### Setup

The app must already be running on the baseURL Playwright targets (see [`local-iteration.md`](./local-iteration.md) for resolution).
If `playwright.config.ts` defines `webServer.command`, Playwright will start it on demand.

### One-shot probe via Playwright eval

Create a temporary probe script (keep it on disk only for the duration of the gate):

```typescript
// tests/e2e/.tmp/selector-probe.spec.ts — created and deleted by the skill
import { test, expect } from '@playwright/test';

test('selector probe', async ({ page }) => {
  await page.goto('<URL the test navigates to before the failing action>');
  // Replicate any necessary setup from the original test (login, fixture
  // load) — copy verbatim from the spec being verified.

  const count = await page.locator('<the new locator under review>').count();
  console.log('LOCATOR_COUNT', count);
});
```

Run it:

```bash
$PLAYWRIGHT_CMD --grep 'selector probe' --workers 1 --retries 0
```

Then delete the probe file (Phase 5 must leave no `.tmp/` artefacts behind).

### Interpretation

| `LOCATOR_COUNT` | Verdict |
|-----------------|---------|
| ≥ 1 | **Verified live.** The selector resolves. Continue. |
| 0 | **Hallucinated** at runtime. Refuse the diff. Go to Step 4. |
| ≥ 2 and the diff uses `.first()` to dedupe | **Refuse** — `.first()` is forbidden as a disambiguation strategy ([`guard-rails.md`](./guard-rails.md)). Rewrite the locator and re-run Step 2. |
| ≥ 2 and the diff uses `.and(...)` or accessible-name disambiguation | **Verified** — multiple matches are acceptable when the diff narrows on a property the matches do not share. |

### Live-check fallback when probe is impossible

Some fixes target a state the test reaches only after several interactions (login + navigate + open a modal).
If a probe is too expensive to replicate, run the actual fixed test once (it is already part of Phase 6) and inspect the trace:

```bash
# After one local run, the trace shows whether the new locator resolved.
node <skill_dir>/scripts/trace-summary.mjs \
  .artifacts/<PR_NUMBER>/local/<run_id>/<attempt>/trace.zip \
  | jq '.actions[] | select(.kind == "locator")'
```

Look for the new locator in the action timeline.
If it appears with `count > 0` and dur < 1000 ms, it resolves cleanly.
If it shows the locator timing out, treat as hallucinated and go to Step 4.

In this path, Step 3 and Phase 6 share a run — the probe is the first Phase 6 attempt.
That is acceptable; Phase 6 just rolls one attempt forward.

---

## Step 4 — Refuse the diff

A diff that fails Step 1 (< 70 %), Step 2 (zero static matches), or Step 3 (zero live matches) is refused.

Refusal procedure:

1. **Do not commit** the diff. Run `git restore --staged` and `git restore` on the touched files to undo it cleanly. If the files were already modified pre-skill (worktree dirty), use `git stash` / `git stash pop` around the discard instead.
2. **Record the failure** in the dossier:
   ```text
   fix-validation: refused
     reason: <static | live | confidence-code>
     refused locator: <the new locator>
     evidence: <grep output | LOCATOR_COUNT | confidence score>
   ```
3. **Re-enter Phase 4** with the new evidence attached.
   The previous root-cause hypothesis is now demonstrably linked to a wrong fix; the confidence-analysis score may need to drop, or a different fix pattern may apply.
4. If two consecutive Phase 4 → Phase 5 cycles end in refusal for the same test, mark the test `requires-human-judgment` and stop iterating on it.
   Continue with the next test in the queue.

A refusal is not a failure of the skill — it is the skill working as designed.
It prevents the worst class of "automated test heal" outcome.

---

## Recording the gate outcome

For every fix that reaches a commit, record the gate's evidence in the commit message body (extends the format in [`root-cause-and-fix.md`](./root-cause-and-fix.md)):

```text
fix(e2e): <test.name>

Pattern: P<N> — <name>
Span signature: failure_rate=<X>%, attempts=<N>, error=<class>
Trace hotspot:  <action> dur=<ms> @ <file>:<line>
Confidence (analysis): <score>%
Confidence (code):     <score>%
Selector check:        static=<verified|n/a> live=<verified|n/a>

<one-sentence reason>.
```

---

## What this gate is **not**

- It is not a substitute for Phase 6. The 3-consecutive-pass gate still runs, because static + live selector existence does not prove the *timing* of the fix is right.
- It is not a code review. It does not opine on style, naming, or maintainability — that is what `Skill('confidence', 'code')` already considers, weighted by what would actually break the test.
- It is not a product-code reviewer. If the trace evidence points at product code, [`root-cause-and-fix.md`](./root-cause-and-fix.md) Rule 3 already routes that to a recommendation rather than an autonomous edit — this gate never even sees that diff.
