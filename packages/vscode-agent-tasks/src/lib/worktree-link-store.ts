/**
 * Persistence layer for the spawned-worktree correlation index.
 *
 * The hook script (`emit-event.js`) appends one JSON line per `gw add` /
 * `git worktree add` Bash call to a durable sidecar NDJSON file:
 *
 *   ${CLAUDE_PLUGIN_DATA}/worktree-links.ndjson
 *
 * Each line is a `SidecarRecord`: `{ creatorCwd, commandLine, addedAt }`.
 *
 * This module reads that sidecar at extension startup, resolves each record's
 * worktree path via `git worktree list --porcelain`, and builds an in-memory
 * `Map<creatorCwd, WorktreeLink[]>` used by `SessionsProvider` to supplement
 * artifact correlation for sessions whose artifacts live in a child worktree.
 *
 * Design constraints:
 *   - **Single writer** (hook script via `appendFileSync`) → no race.
 *   - **Single reader** (extension) → in-memory deduplication, no disk rewrite.
 *   - Startup pruning: sidecar lines beyond 500 are silently dropped from
 *     the in-memory index. The file itself is never truncated.
 *   - `resolveWorktreePath` is async (spawns a child process); callers must
 *     await before updating the in-memory index.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';

// Maximum number of sidecar lines kept in the in-memory index on startup.
// At ~150 bytes/line, 500 lines ≈ 75 KB — negligible.
const MAX_IN_MEMORY_ENTRIES = 500;

/** A persisted link between a creator worktree and a spawned worktree. */
export interface WorktreeLink {
  /** The cwd of the session (and subagent) that ran `gw add` / `git worktree add`. */
  creatorCwd: string;
  /** Absolute path to the spawned worktree directory. */
  worktreePath: string;
  /** Git branch name for the spawned worktree. */
  branch: string;
  /** Unix millisecond timestamp when the event was emitted. */
  addedAt: number;
}

/** The raw record written to `worktree-links.ndjson` by the hook script. */
interface SidecarRecord {
  creatorCwd: string;
  commandLine: string;
  addedAt: number;
}

function isSidecarRecord(v: unknown): v is SidecarRecord {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj['creatorCwd'] === 'string' &&
    typeof obj['commandLine'] === 'string' &&
    typeof obj['addedAt'] === 'number'
  );
}

/**
 * Parse `git worktree list --porcelain` output into an array of
 * `{ worktreePath, branch }` objects. Returns the last-listed worktree
 * (git lists in creation order, so last = newest).
 */
function parseWorktreePorcelain(
  output: string
): Array<{ worktreePath: string; branch: string }> {
  const entries: Array<{ worktreePath: string; branch: string }> = [];
  let currentPath: string | undefined;
  let currentBranch: string | undefined;

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('worktree ')) {
      // Start of a new entry — flush previous if complete
      if (currentPath && currentBranch) {
        entries.push({ worktreePath: currentPath, branch: currentBranch });
      }
      currentPath = line.slice('worktree '.length);
      currentBranch = undefined;
    } else if (line.startsWith('branch ')) {
      // "branch refs/heads/<name>" or "branch refs/heads/<name>"
      const ref = line.slice('branch '.length);
      currentBranch = ref.replace(/^refs\/heads\//, '');
    } else if (line === '') {
      // Blank line separates entries — flush current
      if (currentPath && currentBranch) {
        entries.push({ worktreePath: currentPath, branch: currentBranch });
        currentPath = undefined;
        currentBranch = undefined;
      }
    }
    // "HEAD", "bare", "detached" lines are ignored
  }

  // Flush final entry if output did not end with a blank line
  if (currentPath && currentBranch) {
    entries.push({ worktreePath: currentPath, branch: currentBranch });
  }

  return entries;
}

/**
 * Call `git worktree list --porcelain` from `creatorCwd` and return the
 * newest worktree path+branch not already in `knownPaths`.
 *
 * "Newest" = the last entry in the porcelain output (git appends in creation
 * order). If no new worktree is found, returns `undefined`.
 *
 * Async — uses `child_process.execFile` to avoid blocking the extension's
 * main thread. Called only when a `WorktreeSpawned` event arrives (rare).
 */
export async function resolveWorktreePath(
  creatorCwd: string,
  knownPaths: Set<string>
): Promise<{ worktreePath: string; branch: string } | undefined> {
  return new Promise<{ worktreePath: string; branch: string } | undefined>((resolve) => {
    child_process.execFile(
      'git',
      ['worktree', 'list', '--porcelain'],
      { cwd: creatorCwd, encoding: 'utf8', timeout: 5000 },
      (err, stdout) => {
        if (err) {
          resolve(undefined);
          return;
        }

        const entries = parseWorktreePorcelain(stdout);

        // Walk from the end (newest) and pick the first unknown path
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          if (entry && !knownPaths.has(entry.worktreePath)) {
            resolve(entry);
            return;
          }
        }

        resolve(undefined);
      }
    );
  });
}

/**
 * Synchronous variant of `resolveWorktreePath` used during extension startup
 * when loading the sidecar. Acceptable at startup — called once, not on every
 * event. Returns `undefined` on any error or if no new worktree is found.
 */
function resolveWorktreePathSync(
  creatorCwd: string,
  knownPaths: Set<string>
): { worktreePath: string; branch: string } | undefined {
  try {
    const stdout = child_process.execFileSync(
      'git',
      ['worktree', 'list', '--porcelain'],
      { cwd: creatorCwd, encoding: 'utf8', timeout: 5000 }
    );
    const entries = parseWorktreePorcelain(stdout);
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry && !knownPaths.has(entry.worktreePath)) {
        return entry;
      }
    }
  } catch {
    // git not found, not a git repo, or creatorCwd does not exist — skip
  }
  return undefined;
}

/**
 * Read the append-only sidecar and build a deduped in-memory index.
 *
 * Key: `creatorCwd`. Value: array of `WorktreeLink` (deduped by worktreePath,
 * sorted by `addedAt` ascending so newer links replace older ones on conflict).
 *
 * Returns an empty Map on any error or missing file — never throws.
 *
 * Startup pruning: if the sidecar has more than `MAX_IN_MEMORY_ENTRIES` lines,
 * only the newest lines are indexed (oldest are silently dropped). The sidecar
 * file itself is not modified.
 */
export function loadWorktreeLinks(pluginDataDir: string): Map<string, WorktreeLink[]> {
  const sidecarPath = path.join(pluginDataDir, 'worktree-links.ndjson');
  const result = new Map<string, WorktreeLink[]>();

  let content: string;
  try {
    content = fs.readFileSync(sidecarPath, 'utf8');
  } catch {
    return result;
  }

  const lines = content.split('\n').filter((l) => l.trim().length > 0);

  // Apply startup pruning: keep only the newest MAX_IN_MEMORY_ENTRIES lines
  const kept = lines.length > MAX_IN_MEMORY_ENTRIES
    ? lines.slice(lines.length - MAX_IN_MEMORY_ENTRIES)
    : lines;

  // Track already-resolved paths globally so we don't add the same worktree
  // twice across different creatorCwd groups.
  const resolvedPaths = new Set<string>();

  for (const line of kept) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isSidecarRecord(record)) continue;

    const { creatorCwd, addedAt } = record;

    // Resolve the worktree path from git worktree list --porcelain
    const resolved = resolveWorktreePathSync(creatorCwd, resolvedPaths);
    if (!resolved) continue;

    resolvedPaths.add(resolved.worktreePath);

    const link: WorktreeLink = {
      creatorCwd,
      worktreePath: resolved.worktreePath,
      branch: resolved.branch,
      addedAt,
    };

    const existing = result.get(creatorCwd) ?? [];
    // Dedup by worktreePath
    if (!existing.some((l) => l.worktreePath === resolved.worktreePath)) {
      existing.push(link);
      result.set(creatorCwd, existing);
    }
  }

  return result;
}

/**
 * Append one sidecar record to `worktree-links.ndjson`.
 * Single atomic `appendFileSync` — no read-modify-write, no race.
 * Silently no-ops on any I/O error (caller already updated in-memory state).
 */
export function appendWorktreeLink(
  pluginDataDir: string,
  record: { creatorCwd: string; commandLine: string; addedAt: number }
): void {
  try {
    const sidecarPath = path.join(pluginDataDir, 'worktree-links.ndjson');
    const line = JSON.stringify({
      creatorCwd: record.creatorCwd,
      commandLine: record.commandLine,
      addedAt: record.addedAt,
    });
    fs.appendFileSync(sidecarPath, line + '\n', 'utf8');
  } catch {
    // Silently no-op — the in-memory state is already updated
  }
}

/**
 * Pure update — returns a new Map with the entry added.
 * Deduplicates by `(creatorCwd, worktreePath)`: if an entry with the same pair
 * already exists, the existing entry is retained (first write wins — the hook
 * script is append-only and the initial resolution is authoritative).
 */
export function addWorktreeLink(
  links: Map<string, WorktreeLink[]>,
  entry: WorktreeLink
): Map<string, WorktreeLink[]> {
  const next = new Map(links);
  const existing = next.get(entry.creatorCwd) ?? [];

  // Dedup: skip if we already have this worktreePath for this creatorCwd
  if (existing.some((l) => l.worktreePath === entry.worktreePath)) {
    return next;
  }

  next.set(entry.creatorCwd, [...existing, entry]);
  return next;
}
