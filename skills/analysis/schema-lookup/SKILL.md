---
name: schema-lookup
description: >
  Answers questions about MySQL table structure by reading cached DDL snapshots
  from `~/db-schemas/<database>/<table>.sql`, resolving a fuzzy table name to a
  `<database>.<table>`, and presenting columns, keys, indexes, and one hop of
  foreign-key relationships. Reads local files only — no database connection, no
  network. Asks which table is meant when a name matches more than one, and
  reports a miss as unknown rather than absent. Use when a question depends on
  what a table actually looks like rather than what a migration or an entity
  class claims. Triggers on "what is the table structure for", "what columns
  does X have", "show me the schema for", "describe the table", "what tables are
  in", "/schema-lookup".
argument-hint: '[<db>.]<table>'
allowed-tools: Read Grep Glob
license: MIT
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: advisory
  tags:
    - mysql
    - schema
    - ddl
    - foreign-keys
    - database
    - table-structure
    - offline
---

# DB Schema

Answers table-structure questions from a local directory of DDL snapshots.

This skill reads files.
It opens no database connection, issues no query, and runs no command.
`Read`, `Grep`, and `Glob` are the only tools it needs, so a normal run never asks for permission.

Everything it can say is bounded by what is on disk.
The snapshots are produced outside this skill by tooling the user owns; refreshing them is the user's action, never the agent's.

## Cache contract

```text
~/db-schemas/
├── <database>/
│   └── <table>.sql        one CREATE TABLE statement, as MySQL reported it
```

| Property | Consequence |
| --- | --- |
| Point-in-time snapshot, no invalidation | A file's content may predate the current schema by any amount. |
| Per-database directories are populated independently | One database can be complete while another holds a handful of tables. |
| Absence is not evidence | A missing file means "not captured", never "does not exist". |
| Dotfiles in the root are not tables | Ignore anything not matching `<database>/<table>.sql`. |

If `~/db-schemas/` is empty or missing, stop and ask the user where the snapshots live.
Do not fall back to migrations or entity classes.

## Workflow

### 1. Resolve the target

Collect every plausible `<database>.<table>` the phrasing could mean.
Take **all** matches, not the first — narrowing happens in step 2, with the user.

1. **Explicit** — the user wrote `<db>.<table>`. `Glob` `~/db-schemas/<db>/<table>.sql` to confirm it is captured.
2. **Fragment** — `Glob` `~/db-schemas/*/*<fragment>*.sql`.
3. **Widen** — `Glob` `~/db-schemas/*/*.sql` and match on meaning rather than substring when the fragment is a synonym rather than a prefix.

Map the domain word to a database first, so a broad fragment does not sprawl:

| Domain word in the question | Database to weight first |
| --- | --- |
| CRM, booking, onboarding, sale, lead | `crm_db`, then `Fi_db` |
| ecom, payment link, merchant terms, store ref | `ecom_db` |
| core, POS, terminal, merchant, transaction | `Fi_db` |

**Never substitute a repo migration file or a JPA entity for a snapshot.**
Migrations record intent; a snapshot records what the database reported.
They diverge on hand-applied changes, on branches that never shipped, and on tables that predate the migration baseline.

### 2. Disambiguate — ask, never guess

Count the candidates, then branch.
This gate is mandatory; do not skip it because one candidate "looks like the obvious one".

| Candidates | Action |
| --- | --- |
| Exactly 1 | Proceed to step 3. |
| 2 or more | **Stop and ask.** Never pick on the agent's own judgment. |
| 0 | **Stop.** Report the closest captured names and say the table is not in the cache — which is not the same as saying it does not exist. Offer a refresh as the user's next action. |

Ask with `AskUserQuestion`. Build the options like this:

- One option per candidate, up to three, ordered by closeness to the user's phrasing.
- A final option that **declines to choose** — "none of these; refresh the snapshots for `<db>` and ask again".
- List every candidate in the question text when there are more than three, so the ones that did not become options stay visible. The tool's automatic "Other" entry takes an exact name.

Give each option enough signal to choose without opening the file: its database, its primary key, and what distinguishes it from its siblings.

```markdown
Question: "Which onboarding table do you mean?"
Header:   "Table"
Options:
  - `crm_db.onboarding_view` — main onboarding record, PK `binary(16)`, FKs into `Fi_db`
  - `crm_db.onboarding_additional_data` — typed key-value rows keyed by `helloflow_customer_id`
  - `crm_db.onboarding_additional_data_types` — lookup table for the `type` column above
  - None of these — refresh the `crm_db` snapshots; only 22 tables are captured
```

Two failure modes this gate exists to prevent:

- **Sibling collision** — a prefix matches several tables and the agent describes the wrong one confidently.
- **False absence** — a sparsely-captured database yields no match and the agent reports the table does not exist.

State the resolved `<database>.<table>` back before reading it.

### 3. Read the snapshot

`Read` `~/db-schemas/<db>/<table>.sql`.

That file is the sole source for the answer.
If it contradicts a migration in the repo, say so and present both — do not silently reconcile them.

### 4. Present the structure

Lead with a column table read off the DDL, then keys, then relationships.

```markdown
**`<db>.<table>`** — <one line on what the table holds>

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `bigint unsigned` | no | — | PK, auto-increment |

**Keys** — PK `(id)`; unique `uq_x (a, b)`; index `idx_y (c)`.
**Foreign keys** — `merchant_id` → `Fi_db.merchant (id)` (`ON DELETE CASCADE`).
**Engine** — InnoDB, `utf8mb4_unicode_ci`.
```

Rules for the presentation:

- Copy types verbatim from the DDL, including width and signedness.
- Call out `ON DELETE` / `ON UPDATE` actions — they change how a caller must clean up.
- Flag columns whose name implies a reference but that carry no FK constraint; that is a real finding, not an omission.
- Show the raw DDL block only when the user asks for it, or when the structure is small enough that the table adds nothing.
- Snapshots hold structure only. There is no row data to report.

### 5. Expand one hop of relationships

Do this by default; it is what makes the answer usable.
Go exactly one hop — no transitive walk.

**Outbound** — parse every `FOREIGN KEY (...) REFERENCES ...` clause out of the DDL, then `Read` each referenced table's snapshot.
Summarise each in one line (what it holds, its PK). Do not print a full column table for the neighbours.
A referenced table with no snapshot is reported by name, marked uncaptured.

**Inbound** — find the tables pointing at this one with `Grep`:

- Pattern: `` REFERENCES `<table>` ``
- Path: `~/db-schemas/<db>/`
- Output mode: `files_with_matches`

Inbound results are **never provably complete**, because the cache cannot be compared against a live table list.
Always qualify them with the capture count:

> Inbound references, limited to the 22 captured tables in `crm_db`: …

## Provenance — state it every time

Every answer carries three facts, unprompted:

1. It came from a snapshot in `~/db-schemas/`, not from a live database.
2. The snapshot's age is unknown unless the file's modification time says otherwise.
   Snapshots normally refresh on weekday mornings, so a file more than a couple of days old means refreshes have been failing or skipping — say so rather than treating the age as merely unknown.
3. Inbound relationships cover only the captured tables in that database.

Escalate the caveat to a leading warning, not a footnote, when the answer will drive a migration, a schema change, or a query written against exact column names.
In that case recommend the user refresh the snapshot before acting on it.

## Anti-patterns

- Reporting a table as non-existent when it is merely uncaptured.
- Picking one table out of several prefix siblings without asking.
- Presenting inbound foreign keys as a complete list.
- Answering from `src/main/resources/db/migration/*.sql` or a JPA entity because the snapshot was missing.
- Guessing a column's type from its name when the DDL is one `Read` away.
- Serving a snapshot for a migration-driving question without flagging its age.
- Offering candidates to choose from with no distinguishing detail, so the user has to guess too.
- Walking the FK graph past one hop and burying the answer.

## Definition of done

- [ ] Every candidate the resolution step produced was counted, not silently narrowed.
- [ ] Two or more candidates, or zero, went to `AskUserQuestion` rather than a guess.
- [ ] The resolved `<database>.<table>` was stated back before the file was read.
- [ ] The answer came from `~/db-schemas/`, not from a migration file or an entity class.
- [ ] Columns, keys, and indexes presented; types copied verbatim.
- [ ] One hop of foreign keys covered in both directions, inbound qualified by capture count.
- [ ] Snapshot provenance and unknown age stated in the answer.
