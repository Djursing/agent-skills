/**
 * Shared types for hook events emitted by the agent-tasks-hooks Claude Code plugin.
 *
 * The plugin writes NDJSON lines of HookEvent to per-session files under
 * ${CLAUDE_PLUGIN_DATA}/events/<sessionId>.ndjson. These types are shared
 * between HookEventWatcher (consumer) and the unit tests for emit-event.js.
 */

export type HookEventName =
  | 'UserPromptSubmit'
  | 'Stop'
  | 'Notification'
  | 'SessionStart'
  | 'SessionEnd'
  | 'WorktreeSpawned';

/** Base fields present on every hook event. */
interface HookEventBase {
  /**
   * Schema version of the emitted event. Present from plugin v0.2.0.
   * Optional for backwards compatibility with old events already on disk.
   * Extension rejects events with a schemaVersion present and !== 1.
   */
  schemaVersion?: number;
  /** The Claude Code session ID. */
  sessionId: string;
  /** The working directory of the Claude Code session at the time the event fired. */
  cwd: string;
  /** Unix millisecond timestamp written by the hook script. */
  ts: number;
}

/**
 * Standard lifecycle events (UserPromptSubmit, Stop, Notification,
 * SessionStart, SessionEnd). No extra fields beyond the base.
 */
export interface LifecycleHookEvent extends HookEventBase {
  event: Exclude<HookEventName, 'WorktreeSpawned'>;
}

/**
 * Emitted when a PostToolUse Bash call contains `git worktree add` or
 * `gw add`. The extension resolves the actual worktree path by running
 * `git worktree list --porcelain` from `cwd` (the `creatorCwd`).
 *
 * Note: `cwd` on this event type is the creator's working directory — the
 * originating worktree from which the subagent spawned the new worktree.
 */
export interface WorktreeSpawnedEvent extends HookEventBase {
  event: 'WorktreeSpawned';
  /**
   * The raw Bash command string that triggered detection
   * (e.g. "gw add feat/ai-1178-connectors").
   * Path resolution is deferred to the extension via `git worktree list`.
   */
  commandLine: string;
}

/** Discriminated union of all hook event shapes. Narrow via `event` field. */
export type HookEvent = LifecycleHookEvent | WorktreeSpawnedEvent;
