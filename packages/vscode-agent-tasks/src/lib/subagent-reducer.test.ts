/**
 * Unit tests for subagent-reducer.ts
 *
 * Covers:
 *  - applySubagentDispatch: appends a running record; description fallback;
 *    preserves existing records (immutable update).
 *  - applySubagentFinished: FIFO correlation; synthetic record on no match;
 *    only closes the oldest matching entry when two same-type records are pending.
 *  - computeRollupStatus: empty list, all idle, any running.
 */

import { describe, it, expect } from 'vitest';
import {
  applySubagentDispatch,
  applySubagentFinished,
  computeRollupStatus,
  type SubagentRecord,
} from './subagent-reducer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDispatch(overrides: Partial<{ toolUseId: string; subagentType: string; description: string; ts: number }> = {}): Parameters<typeof applySubagentDispatch>[1] {
  return {
    toolUseId: 'tu-001',
    subagentType: 'general-purpose',
    description: 'Implement feature X',
    ts: 1000,
    ...overrides,
  };
}

function makeFinish(overrides: Partial<{ subagentType: string; ts: number }> = {}): Parameters<typeof applySubagentFinished>[1] {
  return {
    subagentType: 'general-purpose',
    ts: 2000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// applySubagentDispatch
// ---------------------------------------------------------------------------

describe('applySubagentDispatch', () => {
  it('appends a running record to an empty list', () => {
    const result = applySubagentDispatch([], makeDispatch());
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('running');
    expect(result[0].toolUseId).toBe('tu-001');
    expect(result[0].subagentType).toBe('general-purpose');
    expect(result[0].description).toBe('Implement feature X');
    expect(result[0].spawnedAt).toBe(1000);
    expect(result[0].finishedAt).toBeUndefined();
  });

  it('appends to an existing list without mutating it', () => {
    const existing: SubagentRecord[] = [
      {
        toolUseId: 'tu-000',
        subagentType: 'general-purpose',
        description: 'Old task',
        status: 'idle',
        spawnedAt: 500,
        finishedAt: 800,
      },
    ];
    const snapshot = [...existing];
    const result = applySubagentDispatch(existing, makeDispatch({ toolUseId: 'tu-001', ts: 1000 }));
    // Original array is unchanged
    expect(existing).toEqual(snapshot);
    // Result has both records
    expect(result).toHaveLength(2);
    expect(result[0].toolUseId).toBe('tu-000');
    expect(result[1].toolUseId).toBe('tu-001');
  });

  it('uses description when non-empty', () => {
    const result = applySubagentDispatch([], makeDispatch({ description: 'My custom desc' }));
    expect(result[0].description).toBe('My custom desc');
  });

  it('falls back to subagentType when description is empty string', () => {
    const result = applySubagentDispatch([], makeDispatch({ description: '', subagentType: 'researcher' }));
    expect(result[0].description).toBe('researcher');
  });

  it('returns a new array reference (immutable update)', () => {
    const existing: SubagentRecord[] = [];
    const result = applySubagentDispatch(existing, makeDispatch());
    expect(result).not.toBe(existing);
  });
});

// ---------------------------------------------------------------------------
// applySubagentFinished
// ---------------------------------------------------------------------------

describe('applySubagentFinished', () => {
  it('marks the first running record idle (FIFO)', () => {
    const records = applySubagentDispatch([], makeDispatch({ toolUseId: 'tu-001', ts: 1000 }));
    const result = applySubagentFinished(records, makeFinish({ ts: 2000 }));
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('idle');
    expect(result[0].finishedAt).toBe(2000);
  });

  it('does not mutate the original array', () => {
    const records = applySubagentDispatch([], makeDispatch());
    const snapshot = [...records];
    applySubagentFinished(records, makeFinish());
    expect(records).toEqual(snapshot);
  });

  it('creates a synthetic finished record when there is no matching running entry', () => {
    const result = applySubagentFinished([], makeFinish({ subagentType: 'researcher', ts: 2000 }));
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('idle');
    expect(result[0].subagentType).toBe('researcher');
    expect(result[0].toolUseId).toMatch(/^synthetic-/);
    expect(result[0].spawnedAt).toBe(2000);
    expect(result[0].finishedAt).toBe(2000);
  });

  it('only closes the oldest matching entry when two same-type records are pending (FIFO)', () => {
    let records: SubagentRecord[] = [];
    records = applySubagentDispatch(records, makeDispatch({ toolUseId: 'tu-001', subagentType: 'general-purpose', ts: 1000 }));
    records = applySubagentDispatch(records, makeDispatch({ toolUseId: 'tu-002', subagentType: 'general-purpose', ts: 1100 }));

    // First finish should close tu-001 (the oldest)
    const afterFirst = applySubagentFinished(records, makeFinish({ ts: 2000 }));
    expect(afterFirst[0].toolUseId).toBe('tu-001');
    expect(afterFirst[0].status).toBe('idle');
    expect(afterFirst[1].toolUseId).toBe('tu-002');
    expect(afterFirst[1].status).toBe('running');

    // Second finish should close tu-002
    const afterSecond = applySubagentFinished(afterFirst, makeFinish({ ts: 2100 }));
    expect(afterSecond[0].status).toBe('idle');
    expect(afterSecond[1].status).toBe('idle');
    expect(afterSecond[1].toolUseId).toBe('tu-002');
  });

  it('does not close a record if subagentType does not match', () => {
    const records = applySubagentDispatch([], makeDispatch({ subagentType: 'researcher' }));
    const result = applySubagentFinished(records, makeFinish({ subagentType: 'general-purpose' }));
    // 'researcher' record stays running; synthetic 'general-purpose' is appended
    expect(result[0].subagentType).toBe('researcher');
    expect(result[0].status).toBe('running');
    expect(result[1].subagentType).toBe('general-purpose');
    expect(result[1].status).toBe('idle');
  });

  it('returns a new array reference (immutable update)', () => {
    const records = applySubagentDispatch([], makeDispatch());
    const result = applySubagentFinished(records, makeFinish());
    expect(result).not.toBe(records);
  });
});

// ---------------------------------------------------------------------------
// computeRollupStatus
// ---------------------------------------------------------------------------

describe('computeRollupStatus', () => {
  it('returns idle for an empty list', () => {
    expect(computeRollupStatus([])).toBe('idle');
  });

  it('returns idle when all records are idle', () => {
    const records: SubagentRecord[] = [
      { toolUseId: 'a', subagentType: 'gp', description: 'A', status: 'idle', spawnedAt: 1, finishedAt: 2 },
      { toolUseId: 'b', subagentType: 'gp', description: 'B', status: 'idle', spawnedAt: 3, finishedAt: 4 },
    ];
    expect(computeRollupStatus(records)).toBe('idle');
  });

  it('returns running when any record is running', () => {
    const records: SubagentRecord[] = [
      { toolUseId: 'a', subagentType: 'gp', description: 'A', status: 'idle', spawnedAt: 1, finishedAt: 2 },
      { toolUseId: 'b', subagentType: 'gp', description: 'B', status: 'running', spawnedAt: 3 },
    ];
    expect(computeRollupStatus(records)).toBe('running');
  });

  it('returns running when all records are running', () => {
    const records: SubagentRecord[] = [
      { toolUseId: 'a', subagentType: 'gp', description: 'A', status: 'running', spawnedAt: 1 },
      { toolUseId: 'b', subagentType: 'gp', description: 'B', status: 'running', spawnedAt: 2 },
    ];
    expect(computeRollupStatus(records)).toBe('running');
  });
});
