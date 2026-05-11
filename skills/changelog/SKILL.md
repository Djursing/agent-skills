---
name: changelog
description: >
  Generates a personal markdown changelog of merged or closed pull requests
  authored by the current user and Linear tickets the user closed or worked
  on, over a configurable window (default 7 days), grouped by feature area
  (e.g. Dashboards, Agent0). Inputs sourced from `gh search prs --author=@me`
  and the Linear MCP. Use for weekly recaps, status updates, performance
  reviews, or end-of-sprint summaries. Triggers on "changelog",
  "what have I done", "weekly summary", "my recent work", "recap my week",
  "/changelog".
disable-model-invocation: true
argument-hint: "[days]"
allowed-tools: Bash(gh *) Bash(date *) Read Write
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: slash-command
  tags:
    - changelog
    - weekly-recap
    - github
    - linear
    - status-update
    - personal
---

# Changelog

Generate a markdown changelog of the current user's recent work — merged
or closed pull requests, plus Linear tickets they closed or worked on —
grouped by feature area. Render the result against the template in
[`templates/changelog.md`](./templates/changelog.md) and print it to the
chat.

## Argument

A single optional positional argument controls the window in days.

| Input            | Resolved window                                  |
| ---------------- | ------------------------------------------------ |
| (none)           | 7 days, ending today (UTC)                       |
| `14`             | 14 days, ending today                            |
| `30`             | 30 days, ending today                            |
| Any non-integer  | Reject with an error; do not assume a value      |

Compute the window once at start with:

```bash
DAYS="${1:-7}"
[[ "$DAYS" =~ ^[1-9][0-9]*$ ]] || {
  echo "Argument must be a positive integer number of days (got \"$DAYS\")." >&2
  exit 1
}
SINCE="$(date -u -v-"${DAYS}"d +%Y-%m-%d 2>/dev/null \
         || date -u --date="${DAYS} days ago" +%Y-%m-%d)"   # BSD then GNU
UNTIL="$(date -u +%Y-%m-%d)"
```

`gh search` treats `--merged-at` and `--closed` date ranges as **inclusive**
on both ends. Document the inclusive semantics in the rendered output so
back-to-back invocations on consecutive weeks do not silently double-count
the boundary day.

## Workflow

1. **Resolve window** — compute `SINCE` and `UNTIL` (UTC). Print them once.
2. **Fetch PRs** — see [Data sources](#data-sources); one `gh search prs`
   query, partitioned agent-side into `merged` and `closed` by `state`.
3. **Fetch Linear tickets** — closed or updated in the window where the
   current user is assignee or contributor.
4. **Classify each item** by feature area (see [Feature grouping](#feature-grouping)).
5. **Render** the template, sort features alphabetically (except a fixed
   `Other` bucket which always sorts last), sort items within a feature by
   `closedAt` descending.
6. **Print** the rendered markdown to the chat. Wrap it in a **4-backtick
   outer fence** (`` ```` ``) so the user can copy it cleanly without the
   inner triple-backtick blocks (links, headings, inline code in PR
   titles) breaking the fence.

Do not write the output to a file unless the user explicitly asks.

## Data sources

### Pull requests — GitHub

Use `gh search prs` (cross-repo, scoped to the current user as author).
The CLI is required.

`gh search prs` exposes `state`, `closedAt`, `createdAt`, and `updatedAt`
in its JSON output — but **not** `mergedAt`. Partition merged vs.
closed-not-merged agent-side using the `state` field (`merged` or
`closed`). Run a single query, then split:

```bash
LIMIT=100
gh search prs \
  --author=@me \
  --state=closed \
  --closed="${SINCE}..${UNTIL}" \
  --limit "${LIMIT}" \
  --json title,number,url,state,closedAt,repository,labels,body
```

In the agent:

- `state == "merged"` → "Shipped" section.
- `state == "closed"` → "Closed without merge" section.

**Truncation guard:** if the result set length equals `LIMIT`, prepend a
`> Warning: PR results truncated at ${LIMIT}. Narrow the window with
/changelog <smaller-days>.` line above the rendered output. Do not
silently drop work.

If `gh` is missing or unauthenticated, print the install / auth hint and
continue with Linear-only data — do not fail the whole skill.

### Linear tickets — MCP

Use whichever Linear MCP server is connected in the active environment.
Tool names vary by server (`mcp__claude_ai_Linear__list_issues`,
`linear__search_issues`, `mcp__linear__list_issues`, …) — resolve the
list-issues and get-issue tools at runtime from the available-tools list,
do not hard-code the namespace.

Query for issues where:

- `assignee` is the current viewer (use `me` / current user filter), and
- `updatedAt >= SINCE`, and
- state is `completed` or `canceled`, **or** the issue had activity in the
  window (comment / status change).

If no Linear MCP tool is available, print a one-line notice and proceed
with PR-only data — do not fail.

## Feature grouping

Bucket each PR and ticket into a feature area. Apply this lookup in order;
the first match wins.

| Signal                                                       | Bucket                       |
| ------------------------------------------------------------ | ---------------------------- |
| Conventional-commit scope in PR title (`feat(<scope>): ...`) | The `<scope>` (Title-cased)  |
| Linear project name                                          | The project name             |
| Linear team label that names a product area                  | The label (Title-cased)      |
| PR label matching `area:*`, `feature:*`, `scope:*`           | The suffix (Title-cased)     |
| Repository name (single-repo / monorepo apps)                | The repo or top-level path   |
| Top-level directory of changed files (monorepos)             | The directory (Title-cased)  |
| No signal                                                    | `Other`                      |

**Title-casing rule:** keep brand names verbatim (`Agent0`, `OTel`,
`Dash0`); only Title-case generic scopes (`dashboards` → `Dashboards`,
`auth` → `Auth`). Maintain a small allow-list of brand spellings inferred
from the data — do not invent capitalisation.

Two items in different sources (a PR and a Linear ticket) that describe
the same work should appear under the **same** bucket. Cross-reference by:

- Branch name embedded in the PR (often `<TICKET-ID>-...`).
- Explicit `Closes <TICKET-ID>` / `Fixes <TICKET-ID>` in the PR body.

When the PR `body` field is empty (private-repo body the authenticated
user cannot read), fall back to the branch-name heuristic only — do not
drop the entry.

When a PR closes a ticket, render the PR as the primary entry and append
the ticket ID inline (see template). Do not double-list.

**Known boundary:** `--author=@me` returns PRs the user **opened**.
Co-authored-by attributions are not captured. This is intentional for a
personal recap, but state it so the empty-looking week is not a bug.

## Output rules

- Always emit a single Markdown block — render against
  [`templates/changelog.md`](./templates/changelog.md) verbatim, wrapped
  in a 4-backtick outer fence.
- Feature buckets sort alphabetically; the `Other` bucket always sorts
  last.
- Within a bucket, sort by merged / closed date descending.
- Each line cites the PR number (`#123`), the repo if cross-repo, and the
  Linear ticket ID where applicable.
- One-line summary per item — strip emoji from titles; keep imperative
  voice; drop trailing punctuation.
- **Empty window**: render the template with `{{ONE_PARAGRAPH_SUMMARY}}`
  set to `No activity in this window.`, `{{TOTAL_PRS}}` and
  `{{TOTAL_TICKETS}}` set to `0`, and **all feature buckets omitted**. Do
  not fabricate work, and do not stretch the window.

## Template

The literal output template lives in
[`templates/changelog.md`](./templates/changelog.md). The user edits that
file to adjust shape, headings, or summary line; the skill never edits the
template itself.

## Examples

### Good — invoked with default window

```
/changelog
```

Resolves `SINCE=2026-05-04`, `UNTIL=2026-05-11`, fetches 11 merged PRs and
5 closed Linear tickets, groups into `Agent0`, `Dashboards`, `OTel`, and
`Other`, renders the template, prints inside a fenced block.

### Good — invoked with a custom window

```
/changelog 30
```

Resolves a 30-day window, otherwise identical.

### Bad — invoked with a non-integer

```
/changelog last-month
```

Reject: `Argument must be an integer number of days (got "last-month").`
Do not silently coerce to 7.

## Anti-patterns

- Fabricating items because the window is empty — print the empty-state
  message instead.
- Re-Title-casing brand names (`agent0` → `Agent 0`, `dash0` → `Dash 0`).
  Keep brand spellings verbatim.
- Listing the same work twice when a PR closes a Linear ticket — merge
  into one entry.
- Writing the output to a file by default. Print to chat unless asked.
- Stretching the window to "fill" a short list. The window is the user's
  contract.

## Definition of done

- [ ] `SINCE` and `UNTIL` resolved (UTC) and printed once.
- [ ] `gh search prs --author=@me` queried for both merged and closed sets
      (or a one-line skip notice printed if `gh` is missing).
- [ ] Linear MCP queried for the current viewer's tickets in the window
      (or a one-line skip notice printed if MCP is unavailable).
- [ ] Each item bucketed by feature using the lookup table above.
- [ ] PR / ticket pairs merged into a single entry where one closes the
      other.
- [ ] Output rendered against `templates/changelog.md` and printed inside
      a 4-backtick outer fence (so inner triple-backtick blocks don't
      escape).
- [ ] Feature buckets sorted alphabetically with `Other` last.
- [ ] Empty windows produce the empty-state message — never fabricated
      items.
