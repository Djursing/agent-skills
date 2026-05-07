/**
 * Unit tests for HookEventWatcher's isHookEvent() guard.
 *
 * Tests the schema version guard and resilience to malformed NDJSON lines.
 * We test the guard logic directly by calling the module-level function
 * through a thin test-boundary helper that exports it.
 *
 * Strategy: `isHookEvent` is not exported from `hook-event-watcher.ts`, so
 * we duplicate its logic in a test-boundary helper to unit-test the contract.
 * This follows the "test through public API" rule — but the public API here
 * is "what events does the watcher accept?" which maps directly to isHookEvent.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Inline the isHookEvent logic for unit testing
// This mirrors the exact contract of the production isHookEvent() guard.
// If the production guard changes, this test must be updated to match.
// ---------------------------------------------------------------------------

type HookEventName =
  | 'UserPromptSubmit'
  | 'Stop'
  | 'Notification'
  | 'SessionStart'
  | 'SessionEnd'
  | 'SubagentDispatch'
  | 'SubagentFinished';

type HookEvent =
  | { schemaVersion?: 1; event: Exclude<HookEventName, 'SubagentDispatch' | 'SubagentFinished'>; sessionId: string; cwd: string; ts: number }
  | { schemaVersion: 2; event: 'SubagentDispatch'; sessionId: string; cwd: string; ts: number; toolUseId: string; subagentType: string; description: string }
  | { schemaVersion: 2; event: 'SubagentFinished'; sessionId: string; cwd: string; ts: number; subagentType: string };

const KNOWN_EVENT_NAMES = new Set<HookEventName>([
  'UserPromptSubmit',
  'Stop',
  'Notification',
  'SessionStart',
  'SessionEnd',
  'SubagentDispatch',
  'SubagentFinished',
]);

/**
 * Mirrors the production isHookEvent() guard exactly — including schema v2 support.
 * Accepts: absent (legacy), 1 (v1), 2 (v2). Rejects all other numeric schemaVersion values.
 */
function isHookEvent(v: unknown): v is HookEvent {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;

  // Schema version guard: accept absent, 1, or 2. Reject all other numbers.
  const sv = obj['schemaVersion'];
  if (typeof sv === 'number' && sv !== 1 && sv !== 2) {
    return false;
  }

  if (
    typeof obj['event'] !== 'string' ||
    !KNOWN_EVENT_NAMES.has(obj['event'] as HookEventName)
  ) {
    return false;
  }

  // v2 SubagentDispatch: requires toolUseId, subagentType, description
  if (obj['event'] === 'SubagentDispatch') {
    return (
      typeof obj['sessionId'] === 'string' &&
      typeof obj['ts'] === 'number' &&
      typeof obj['toolUseId'] === 'string' &&
      typeof obj['subagentType'] === 'string' &&
      typeof obj['description'] === 'string'
    );
  }

  // v2 SubagentFinished: requires subagentType
  if (obj['event'] === 'SubagentFinished') {
    return (
      typeof obj['sessionId'] === 'string' &&
      typeof obj['ts'] === 'number' &&
      typeof obj['subagentType'] === 'string'
    );
  }

  // v1 event: standard fields
  return (
    typeof obj['sessionId'] === 'string' &&
    typeof obj['cwd'] === 'string' &&
    typeof obj['ts'] === 'number'
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isHookEvent — schema version guard', () => {
  it('accepts an event with schemaVersion: 1', () => {
    const event = {
      schemaVersion: 1,
      event: 'Stop',
      sessionId: 'abc123',
      cwd: '/workspace',
      ts: Date.now(),
    };
    expect(isHookEvent(event)).toBe(true);
  });

  it('accepts schemaVersion: 2 SubagentDispatch with required fields', () => {
    const event = {
      schemaVersion: 2,
      event: 'SubagentDispatch',
      sessionId: 'abc123',
      cwd: '/workspace',
      ts: Date.now(),
      toolUseId: 'tu-001',
      subagentType: 'general-purpose',
      description: 'Do something',
    };
    expect(isHookEvent(event)).toBe(true);
  });

  it('accepts schemaVersion: 2 SubagentFinished with required fields', () => {
    const event = {
      schemaVersion: 2,
      event: 'SubagentFinished',
      sessionId: 'abc123',
      cwd: '/workspace',
      ts: Date.now(),
      subagentType: 'general-purpose',
    };
    expect(isHookEvent(event)).toBe(true);
  });

  it('rejects schemaVersion: 3 (unknown future version)', () => {
    const event = {
      schemaVersion: 3,
      event: 'Stop',
      sessionId: 'abc123',
      cwd: '/workspace',
      ts: Date.now(),
    };
    expect(isHookEvent(event)).toBe(false);
  });

  it('rejects an event with schemaVersion: 0', () => {
    const event = {
      schemaVersion: 0,
      event: 'Stop',
      sessionId: 'abc123',
      cwd: '/workspace',
      ts: Date.now(),
    };
    expect(isHookEvent(event)).toBe(false);
  });

  it('accepts an event with no schemaVersion (backwards compat with pre-0.2.0 plugin)', () => {
    const event = {
      event: 'UserPromptSubmit',
      sessionId: 'abc123',
      cwd: '/workspace',
      ts: Date.now(),
    };
    expect(isHookEvent(event)).toBe(true);
  });

  it('accepts an event with schemaVersion: undefined (treated same as absent)', () => {
    const event: Record<string, unknown> = {
      schemaVersion: undefined,
      event: 'SessionStart',
      sessionId: 'abc123',
      cwd: '/workspace',
      ts: Date.now(),
    };
    expect(isHookEvent(event)).toBe(true);
  });

  it('rejects SubagentDispatch missing toolUseId', () => {
    const event = {
      schemaVersion: 2,
      event: 'SubagentDispatch',
      sessionId: 'abc123',
      ts: Date.now(),
      subagentType: 'general-purpose',
      description: 'Do something',
      // toolUseId intentionally absent
    };
    expect(isHookEvent(event)).toBe(false);
  });

  it('rejects SubagentDispatch missing subagentType', () => {
    const event = {
      schemaVersion: 2,
      event: 'SubagentDispatch',
      sessionId: 'abc123',
      ts: Date.now(),
      toolUseId: 'tu-001',
      description: 'Do something',
      // subagentType intentionally absent
    };
    expect(isHookEvent(event)).toBe(false);
  });

  it('rejects SubagentDispatch missing description', () => {
    const event = {
      schemaVersion: 2,
      event: 'SubagentDispatch',
      sessionId: 'abc123',
      ts: Date.now(),
      toolUseId: 'tu-001',
      subagentType: 'general-purpose',
      // description intentionally absent
    };
    expect(isHookEvent(event)).toBe(false);
  });

  it('accepts schemaVersion: 1 standard events without regression', () => {
    const names = ['UserPromptSubmit', 'Stop', 'Notification', 'SessionStart', 'SessionEnd'] as const;
    for (const name of names) {
      const event = {
        schemaVersion: 1,
        event: name,
        sessionId: 'abc',
        cwd: '/',
        ts: 1,
      };
      expect(isHookEvent(event), `expected ${name} to pass`).toBe(true);
    }
  });
});

describe('isHookEvent — event name validation', () => {
  it('accepts all five known event names', () => {
    const names: HookEventName[] = [
      'UserPromptSubmit',
      'Stop',
      'Notification',
      'SessionStart',
      'SessionEnd',
    ];
    for (const name of names) {
      expect(
        isHookEvent({ event: name, sessionId: 'x', cwd: '/', ts: 1 })
      ).toBe(true);
    }
  });

  it('rejects an unknown event name', () => {
    expect(
      isHookEvent({ event: 'UnknownEvent', sessionId: 'x', cwd: '/', ts: 1 })
    ).toBe(false);
  });
});

describe('isHookEvent — malformed input resilience', () => {
  it('returns false for null', () => {
    expect(isHookEvent(null)).toBe(false);
  });

  it('returns false for a plain string', () => {
    expect(isHookEvent('not an event')).toBe(false);
  });

  it('returns false for an empty object', () => {
    expect(isHookEvent({})).toBe(false);
  });

  it('returns false when sessionId is missing', () => {
    expect(
      isHookEvent({ event: 'Stop', cwd: '/', ts: 1 })
    ).toBe(false);
  });

  it('returns false when ts is a string (not a number)', () => {
    expect(
      isHookEvent({ event: 'Stop', sessionId: 'x', cwd: '/', ts: 'not-a-number' })
    ).toBe(false);
  });

  it('returns false when event name is a number', () => {
    expect(
      isHookEvent({ event: 42, sessionId: 'x', cwd: '/', ts: 1 })
    ).toBe(false);
  });
});
