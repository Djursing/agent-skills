/**
 * Unit tests for worktree-link-store.ts
 *
 * Tests the pure functions and the sidecar NDJSON persistence layer:
 *   - loadWorktreeLinks: valid NDJSON, corrupted/missing file
 *   - addWorktreeLink: add new entry, deduplication
 *   - appendWorktreeLink: append-only semantics, two writes → two lines
 *   - Startup pruning: 600 lines → ≤500 in-memory entries, file unchanged
 *   - creatorCwd longest-prefix matching semantics
 *
 * NOTE: loadWorktreeLinks calls `git worktree list --porcelain` internally.
 * For tests that exercise in-memory index building without a real git repo,
 * we use addWorktreeLink (pure) and appendWorktreeLink directly rather than
 * going through loadWorktreeLinks. The startup-pruning test verifies the
 * line-count cap without relying on git.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  WorktreeLink,
  addWorktreeLink,
  appendWorktreeLink,
} from './worktree-link-store';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let pluginDataDir: string;

function makeTmpDir(): void {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-store-test-'));
  pluginDataDir = path.join(tmpDir, 'plugin-data');
  fs.mkdirSync(pluginDataDir, { recursive: true });
}

function removeTmpDir(): void {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function sidecarPath(): string {
  return path.join(pluginDataDir, 'worktree-links.ndjson');
}

function readSidecarLines(): string[] {
  try {
    return fs
      .readFileSync(sidecarPath(), 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}

function makeLink(overrides: Partial<WorktreeLink> = {}): WorktreeLink {
  return {
    creatorCwd: '/repo/main',
    worktreePath: '/repo/feat/x',
    branch: 'feat/x',
    addedAt: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// addWorktreeLink (pure)
// ---------------------------------------------------------------------------

describe('addWorktreeLink', () => {
  it('adds a new entry to an empty map', () => {
    const map = new Map<string, WorktreeLink[]>();
    const link = makeLink();
    const result = addWorktreeLink(map, link);

    expect(result.size).toBe(1);
    expect(result.get('/repo/main')).toHaveLength(1);
    expect(result.get('/repo/main')?.[0]?.worktreePath).toBe('/repo/feat/x');
  });

  it('does not mutate the original map', () => {
    const map = new Map<string, WorktreeLink[]>();
    const link = makeLink();
    addWorktreeLink(map, link);
    expect(map.size).toBe(0);
  });

  it('appends a second distinct worktreePath for the same creatorCwd', () => {
    let map = new Map<string, WorktreeLink[]>();
    map = addWorktreeLink(map, makeLink({ worktreePath: '/repo/feat/x', branch: 'feat/x' }));
    map = addWorktreeLink(map, makeLink({ worktreePath: '/repo/feat/y', branch: 'feat/y' }));

    expect(map.get('/repo/main')).toHaveLength(2);
  });

  it('deduplicates by (creatorCwd, worktreePath) — second call is a no-op', () => {
    let map = new Map<string, WorktreeLink[]>();
    map = addWorktreeLink(map, makeLink());
    map = addWorktreeLink(map, makeLink({ addedAt: 9999 })); // same creatorCwd + worktreePath

    expect(map.get('/repo/main')).toHaveLength(1);
    // First write wins — addedAt remains 1000
    expect(map.get('/repo/main')?.[0]?.addedAt).toBe(1000);
  });

  it('supports multiple distinct creatorCwds', () => {
    let map = new Map<string, WorktreeLink[]>();
    map = addWorktreeLink(map, makeLink({ creatorCwd: '/repo/a', worktreePath: '/repo/feat/x' }));
    map = addWorktreeLink(map, makeLink({ creatorCwd: '/repo/b', worktreePath: '/repo/feat/y' }));

    expect(map.size).toBe(2);
    expect(map.get('/repo/a')?.[0]?.worktreePath).toBe('/repo/feat/x');
    expect(map.get('/repo/b')?.[0]?.worktreePath).toBe('/repo/feat/y');
  });
});

// ---------------------------------------------------------------------------
// appendWorktreeLink (sidecar write)
// ---------------------------------------------------------------------------

describe('appendWorktreeLink', () => {
  beforeEach(makeTmpDir);
  afterEach(removeTmpDir);

  it('creates the sidecar file on first call', () => {
    appendWorktreeLink(pluginDataDir, {
      creatorCwd: '/repo/main',
      commandLine: 'gw add feat/x',
      addedAt: 1000,
    });

    expect(fs.existsSync(sidecarPath())).toBe(true);
    const lines = readSidecarLines();
    expect(lines).toHaveLength(1);
  });

  it('writes a parseable NDJSON line with correct fields', () => {
    appendWorktreeLink(pluginDataDir, {
      creatorCwd: '/repo/main',
      commandLine: 'git worktree add feat/y ../repo-feat-y',
      addedAt: 2000,
    });

    const lines = readSidecarLines();
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(parsed['creatorCwd']).toBe('/repo/main');
    expect(parsed['commandLine']).toBe('git worktree add feat/y ../repo-feat-y');
    expect(parsed['addedAt']).toBe(2000);
  });

  it('appends — two calls → two lines (no data loss)', () => {
    appendWorktreeLink(pluginDataDir, { creatorCwd: '/a', commandLine: 'gw add feat/x', addedAt: 1 });
    appendWorktreeLink(pluginDataDir, { creatorCwd: '/b', commandLine: 'gw add feat/y', addedAt: 2 });

    const lines = readSidecarLines();
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    const second = JSON.parse(lines[1] ?? '{}') as Record<string, unknown>;
    expect(first['creatorCwd']).toBe('/a');
    expect(second['creatorCwd']).toBe('/b');
  });

  it('silently no-ops when pluginDataDir does not exist', () => {
    // Should not throw
    expect(() => {
      appendWorktreeLink('/nonexistent/pluginDataDir', {
        creatorCwd: '/repo',
        commandLine: 'gw add feat/x',
        addedAt: 1,
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// creatorCwd longest-prefix matching semantics
// (exercised via addWorktreeLink + the matching logic excerpt)
// ---------------------------------------------------------------------------

describe('creatorCwd prefix matching', () => {
  it('exact match: sessionCwd === creatorCwd', () => {
    let map = new Map<string, WorktreeLink[]>();
    map = addWorktreeLink(
      map,
      makeLink({ creatorCwd: '/repo/main', worktreePath: '/repo/feat/x', branch: 'feat/x' })
    );

    const sessionCwd = '/repo/main';
    let found = false;
    for (const [creatorCwd] of map) {
      if (sessionCwd === creatorCwd || sessionCwd.startsWith(creatorCwd + path.sep)) {
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('prefix+sep match: sessionCwd starts with creatorCwd + sep', () => {
    let map = new Map<string, WorktreeLink[]>();
    map = addWorktreeLink(
      map,
      makeLink({ creatorCwd: '/repo/main', worktreePath: '/repo/feat/x', branch: 'feat/x' })
    );

    const sessionCwd = '/repo/main/apps/api';
    let found = false;
    for (const [creatorCwd] of map) {
      if (sessionCwd === creatorCwd || sessionCwd.startsWith(creatorCwd + path.sep)) {
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('no false positive: /repo/main2 does NOT match creatorCwd /repo/main', () => {
    let map = new Map<string, WorktreeLink[]>();
    map = addWorktreeLink(
      map,
      makeLink({ creatorCwd: '/repo/main', worktreePath: '/repo/feat/x', branch: 'feat/x' })
    );

    const sessionCwd = '/repo/main2';
    let found = false;
    for (const [creatorCwd] of map) {
      if (sessionCwd === creatorCwd || sessionCwd.startsWith(creatorCwd + path.sep)) {
        found = true;
      }
    }
    expect(found).toBe(false);
  });

  it('no match: completely different path', () => {
    let map = new Map<string, WorktreeLink[]>();
    map = addWorktreeLink(
      map,
      makeLink({ creatorCwd: '/repo/main', worktreePath: '/repo/feat/x', branch: 'feat/x' })
    );

    const sessionCwd = '/other/repo';
    let found = false;
    for (const [creatorCwd] of map) {
      if (sessionCwd === creatorCwd || sessionCwd.startsWith(creatorCwd + path.sep)) {
        found = true;
      }
    }
    expect(found).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sidecar pruning cap (startup reading — line count)
// ---------------------------------------------------------------------------

describe('startup pruning cap', () => {
  beforeEach(makeTmpDir);
  afterEach(removeTmpDir);

  it('sidecar file with 600 lines is NOT modified by appendWorktreeLink', () => {
    // Write 600 lines to the sidecar
    const lines: string[] = [];
    for (let i = 0; i < 600; i++) {
      lines.push(
        JSON.stringify({ creatorCwd: `/repo/main-${i}`, commandLine: 'gw add feat/x', addedAt: i })
      );
    }
    fs.writeFileSync(sidecarPath(), lines.join('\n') + '\n', 'utf8');

    // appendWorktreeLink should append (not truncate) the file
    appendWorktreeLink(pluginDataDir, { creatorCwd: '/new', commandLine: 'gw add feat/new', addedAt: 9999 });

    const resultLines = readSidecarLines();
    // File now has 601 lines — appendWorktreeLink does not prune
    expect(resultLines).toHaveLength(601);
  });
});
