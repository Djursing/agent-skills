/**
 * Pure session-filter helper. No VS Code imports — vitest-safe.
 *
 * Inclusion model: each filter flag enables a single, mutually exclusive
 * session category. A session is visible iff its category is enabled.
 *
 * The categories cover every (status × pr-state) combo exactly once, which
 * keeps the QuickPick UI honest — every checkbox controls one specific kind
 * of row, never compound semantics. Even the `active` bucket (running,
 * needs-input, unread) is a togglable category so the user has full control;
 * it just defaults on because hiding it is rarely what anyone wants.
 */

import type { SessionStatus } from '../parsers/session-jsonl-parser';
import type { PrEnrichment } from './pr-status-cache';

export interface SessionFilter {
  /** Show running, needs-input, and unread sessions. */
  showActive: boolean;
  /** Show idle sessions whose branch has an open or draft PR. */
  showOpenPr: boolean;
  /** Show idle sessions whose PR has been merged or closed. */
  showMergedClosedPr: boolean;
  /** Show idle sessions whose branch has no PR. */
  showIdleNoPr: boolean;
  /** Show stalled sessions (mid-turn but no recent writes). */
  showStalled: boolean;
}

/**
 * Defaults — tuned via /ux: a fresh user sees active work, idle sessions
 * with an open PR, and stalled sessions (so a stuck agent isn't silently
 * hidden). Merged/closed PRs and bare idle sessions are opt-in.
 */
export const DEFAULT_SESSION_FILTER: SessionFilter = {
  showActive: true,
  showOpenPr: true,
  showMergedClosedPr: false,
  showIdleNoPr: false,
  showStalled: true,
};

export interface FilterableSession {
  status: SessionStatus;
  mtime: number;
  /** Optional — undefined if PR linkage is disabled or no enrichment cached. */
  prEnrichment?: PrEnrichment;
}

export type Category =
  | 'active'
  | 'open-pr'
  | 'merged-closed-pr'
  | 'idle-no-pr'
  | 'stalled';

export interface FilterResult<T extends FilterableSession> {
  visible: T[];
  hiddenCount: number;
  /** Per-category counts for whatever was suppressed. */
  hiddenByCategory: Record<Category, number>;
}

const ACTIVE_STATUSES: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  'running',
  'needs-input',
  'unread',
]);

/**
 * Categorise a session. Each session resolves to exactly one category. The
 * `active` bucket covers running/needs-input/unread; otherwise PR state
 * determines the bucket, falling through to `stalled` or `idle-no-pr`.
 */
export function categorise(session: FilterableSession): Category {
  if (ACTIVE_STATUSES.has(session.status)) return 'active';
  if (session.status === 'stalled') return 'stalled';

  // status is now 'idle' (the only remaining SessionStatus).
  const pr = session.prEnrichment;
  if (pr?.status === 'pr') {
    const state = pr.info.state;
    if (state === 'open' || state === 'draft') return 'open-pr';
    if (state === 'merged' || state === 'closed') return 'merged-closed-pr';
  }
  return 'idle-no-pr';
}

function isCategoryEnabled(category: Category, filter: SessionFilter): boolean {
  switch (category) {
    case 'active':
      return filter.showActive;
    case 'open-pr':
      return filter.showOpenPr;
    case 'merged-closed-pr':
      return filter.showMergedClosedPr;
    case 'idle-no-pr':
      return filter.showIdleNoPr;
    case 'stalled':
      return filter.showStalled;
  }
}

/**
 * Apply a `SessionFilter` to a list of sessions. Inclusion model: a session
 * is visible iff its category is enabled. The `active` category is always
 * enabled and covers running/needs-input/unread.
 */
export function applySessionFilter<T extends FilterableSession>(
  sessions: T[],
  filter: SessionFilter
): FilterResult<T> {
  const visible: T[] = [];
  const hiddenByCategory: Record<Category, number> = {
    active: 0,
    'open-pr': 0,
    'merged-closed-pr': 0,
    'idle-no-pr': 0,
    stalled: 0,
  };

  for (const session of sessions) {
    const cat = categorise(session);
    if (isCategoryEnabled(cat, filter)) {
      visible.push(session);
    } else {
      hiddenByCategory[cat]++;
    }
  }

  const hiddenCount =
    hiddenByCategory.active +
    hiddenByCategory['open-pr'] +
    hiddenByCategory['merged-closed-pr'] +
    hiddenByCategory['idle-no-pr'] +
    hiddenByCategory.stalled;

  return { visible, hiddenCount, hiddenByCategory };
}

/** True when the filter differs from the documented defaults. */
export function isFilterActive(filter: SessionFilter): boolean {
  return (
    filter.showActive !== DEFAULT_SESSION_FILTER.showActive ||
    filter.showOpenPr !== DEFAULT_SESSION_FILTER.showOpenPr ||
    filter.showMergedClosedPr !== DEFAULT_SESSION_FILTER.showMergedClosedPr ||
    filter.showIdleNoPr !== DEFAULT_SESSION_FILTER.showIdleNoPr ||
    filter.showStalled !== DEFAULT_SESSION_FILTER.showStalled
  );
}

/**
 * True when at least one category that defaults to OFF is currently ON. This
 * means the user has loosened the filter beyond defaults — used to drive the
 * "Show fewer / Collapse sessions" footer affordance so they can return to
 * the default view in one click. Categories that default ON contribute
 * nothing here; turning them off makes the filter STRICTER, not looser.
 */
export function isFilterMoreInclusiveThanDefault(filter: SessionFilter): boolean {
  return (
    (filter.showMergedClosedPr && !DEFAULT_SESSION_FILTER.showMergedClosedPr) ||
    (filter.showIdleNoPr && !DEFAULT_SESSION_FILTER.showIdleNoPr)
  );
}

/**
 * Build a one-line summary phrased as a direct call-to-action ("Show 69 more
 * sessions") so the footer reads as the button it is. Returns undefined when
 * nothing is suppressed.
 */
export function describeFilter<T extends FilterableSession>(
  result: FilterResult<T>
): string | undefined {
  if (result.hiddenCount === 0) return undefined;
  const sessionWord = result.hiddenCount === 1 ? 'session' : 'sessions';
  return `Show ${result.hiddenCount} more ${sessionWord}`;
}
