/**
 * resolveDisplayStatus — pure helper to combine SessionStatus + PrEnrichment
 * into the final display status for a session tree item.
 *
 * Rules:
 *   - Any non-idle SessionStatus takes precedence over PR state.
 *   - Only `idle` sessions can show PR-derived display statuses.
 *   - PR enrichment that isn't status 'pr' (loading, no-pr, error) falls
 *     through to the underlying session status.
 *
 * No VS Code imports — this module is pure and vitest-safe.
 */

import type { SessionStatus } from '../parsers/session-jsonl-parser';
import type { PrEnrichment } from './pr-status-cache';

export type DisplayStatus =
  | SessionStatus
  | 'pr-open'
  | 'pr-ci-failing'
  | 'pr-merged'
  | 'pr-closed';

/**
 * Resolves the display status for a session row.
 *
 * When the session's branch has a known PR, the PR state always wins for the
 * row's icon — that gives the user a consistent at-a-glance "this row is
 * about a PR" cue regardless of whether the agent happens to be running on
 * it right now. Activity is communicated separately via a coloured
 * FileDecoration dot, so we don't lose that signal.
 *
 * Sessions without a PR fall back to their session status icon
 * (running / needs-input / unread / stalled / idle).
 */
export function resolveDisplayStatus(
  sessionStatus: SessionStatus,
  prEnrichment: PrEnrichment | undefined
): DisplayStatus {
  if (prEnrichment?.status === 'pr') {
    const { state, ciState } = prEnrichment.info;
    if (state === 'open' || state === 'draft') {
      return ciState === 'failing' ? 'pr-ci-failing' : 'pr-open';
    }
    if (state === 'merged') return 'pr-merged';
    if (state === 'closed') return 'pr-closed';
  }

  return sessionStatus;
}
