/**
 * Unit tests for plugins/agent-tasks-hooks/bin/emit-event.js
 *
 * Tests validate the four AC4/AC5 acceptance criteria:
 *   AC4a: exits 0 when sentinel is absent (orphaned plugin safety)
 *   AC4b: exits 0 on malformed stdin JSON
 *   AC4c: exits 0 when CLAUDE_PLUGIN_DATA env var is missing
 *   AC5:  emitted event contains only {event, sessionId, cwd, ts}
 *
 * Strategy: the script reads CLAUDE_PLUGIN_DATA from the environment and
 * uses synchronous fs calls. We test it by spawning it as a child process
 * with a controlled environment and filesystem, then asserting on exit code
 * and file contents.
 *
 * Note: emit-event.js has no VS Code dependency and can be tested directly
 * with vitest + Node.js child_process.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';

const SCRIPT_PATH = path.resolve(
  __dirname,
  '../../../../plugins/agent-tasks-hooks/bin/emit-event.js'
);

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawn emit-event.js with the given environment and stdin payload.
 * Returns exit code and stdio output.
 */
function runScript(
  pluginDataDir: string | undefined,
  stdinPayload: string,
  env: Record<string, string> = {}
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const fullEnv: Record<string, string> = {
      PATH: process.env['PATH'] ?? '',
      ...env,
    };
    if (pluginDataDir !== undefined) {
      fullEnv['CLAUDE_PLUGIN_DATA'] = pluginDataDir;
    }

    const child = child_process.spawn(process.execPath, [SCRIPT_PATH], {
      env: fullEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });

    // Write payload to stdin and close it
    child.stdin.write(stdinPayload, () => {
      child.stdin.end();
    });
  });
}

/** Build a valid hook payload JSON string. */
function makePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'test-session-abc123',
    cwd: '/home/user/project',
    ...overrides,
  });
}

/** Build a valid PostToolUse Bash payload. */
function makePostToolUsePayload(command: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    session_id: 'test-session-ptu',
    cwd: '/home/user/repo/main',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { stdout: '', stderr: '', exit_code: 0 },
    ...overrides,
  });
}

describe('emit-event.js', () => {
  let tmpDir: string;
  let pluginDataDir: string;
  let sentinelPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-event-test-'));
    pluginDataDir = path.join(tmpDir, 'plugin-data');
    sentinelPath = path.join(pluginDataDir, 'sentinel');
    fs.mkdirSync(pluginDataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---- AC4a: exits 0 when sentinel is absent ----

  it('exits 0 when sentinel file is absent (orphaned plugin)', async () => {
    // Sentinel does NOT exist
    const result = await runScript(pluginDataDir, makePayload());
    expect(result.exitCode).toBe(0);
  });

  it('writes nothing when sentinel is absent', async () => {
    await runScript(pluginDataDir, makePayload());
    const eventsDir = path.join(pluginDataDir, 'events');
    const exists = fs.existsSync(eventsDir);
    // Either the dir doesn't exist or it's empty
    if (exists) {
      const files = fs.readdirSync(eventsDir);
      expect(files).toHaveLength(0);
    } else {
      expect(exists).toBe(false);
    }
  });

  // ---- AC4b: exits 0 on malformed stdin JSON ----

  it('exits 0 on malformed stdin JSON', async () => {
    fs.writeFileSync(sentinelPath, '');
    const result = await runScript(pluginDataDir, 'not valid json {{{');
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 on empty stdin', async () => {
    fs.writeFileSync(sentinelPath, '');
    const result = await runScript(pluginDataDir, '');
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 when session_id is missing from payload', async () => {
    fs.writeFileSync(sentinelPath, '');
    const result = await runScript(pluginDataDir, JSON.stringify({ hook_event_name: 'Stop' }));
    expect(result.exitCode).toBe(0);
  });

  // ---- AC4c: exits 0 when CLAUDE_PLUGIN_DATA is missing ----

  it('exits 0 when CLAUDE_PLUGIN_DATA env var is missing', async () => {
    const result = await runScript(undefined, makePayload());
    expect(result.exitCode).toBe(0);
  });

  // ---- Normal write path ----

  it('writes a NDJSON line when sentinel exists and payload is valid', async () => {
    fs.writeFileSync(sentinelPath, '');
    const payload = makePayload({
      hook_event_name: 'Stop',
      session_id: 'my-session-id',
      cwd: '/workspace/myproject',
    });
    const result = await runScript(pluginDataDir, payload);
    expect(result.exitCode).toBe(0);

    const eventsDir = path.join(pluginDataDir, 'events');
    const files = fs.readdirSync(eventsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('my-session-id.ndjson');

    const content = fs.readFileSync(path.join(eventsDir, 'my-session-id.ndjson'), 'utf8');
    const line = content.trim();
    const parsed = JSON.parse(line) as Record<string, unknown>;

    // AC5: only allowed fields present (including schemaVersion)
    const keys = Object.keys(parsed);
    expect(keys.sort()).toEqual(['cwd', 'event', 'schemaVersion', 'sessionId', 'ts'].sort());
    expect(parsed['event']).toBe('Stop');
    expect(parsed['sessionId']).toBe('my-session-id');
    expect(parsed['cwd']).toBe('/workspace/myproject');
    expect(typeof parsed['ts']).toBe('number');
  });

  // ---- AC5: privacy — no extra fields ----

  it('emits only {event, sessionId, cwd, ts} — never prompt content', async () => {
    fs.writeFileSync(sentinelPath, '');
    const payloadWithExtras = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session-priv-test',
      cwd: '/workspace',
      // These must NOT appear in the output
      prompt: 'secret user message',
      transcript_path: '/home/user/.claude/projects/...',
      response: 'claude response text',
    });
    const result = await runScript(pluginDataDir, payloadWithExtras);
    expect(result.exitCode).toBe(0);

    const eventsDir = path.join(pluginDataDir, 'events');
    const content = fs.readFileSync(
      path.join(eventsDir, 'session-priv-test.ndjson'),
      'utf8'
    );
    const parsed = JSON.parse(content.trim()) as Record<string, unknown>;

    // Only five allowed fields (including schemaVersion)
    const keys = Object.keys(parsed);
    expect(keys.sort()).toEqual(['cwd', 'event', 'schemaVersion', 'sessionId', 'ts'].sort());
    // Privacy fields must not be present
    expect(parsed['prompt']).toBeUndefined();
    expect(parsed['transcript_path']).toBeUndefined();
    expect(parsed['response']).toBeUndefined();
  });

  // ---- schemaVersion field ----

  it('emits schemaVersion: 1 field in the event object', async () => {
    fs.writeFileSync(sentinelPath, '');
    const result = await runScript(
      pluginDataDir,
      makePayload({ hook_event_name: 'UserPromptSubmit', session_id: 'session-schema-test' })
    );
    expect(result.exitCode).toBe(0);

    const eventsDir = path.join(pluginDataDir, 'events');
    const content = fs.readFileSync(path.join(eventsDir, 'session-schema-test.ndjson'), 'utf8');
    const parsed = JSON.parse(content.trim()) as Record<string, unknown>;
    expect(parsed['schemaVersion']).toBe(1);
  });

  it('schemaVersion is a number (not a string)', async () => {
    fs.writeFileSync(sentinelPath, '');
    const result = await runScript(
      pluginDataDir,
      makePayload({ hook_event_name: 'Stop', session_id: 'session-schema-type-test' })
    );
    expect(result.exitCode).toBe(0);

    const eventsDir = path.join(pluginDataDir, 'events');
    const content = fs.readFileSync(
      path.join(eventsDir, 'session-schema-type-test.ndjson'),
      'utf8'
    );
    const parsed = JSON.parse(content.trim()) as Record<string, unknown>;
    expect(typeof parsed['schemaVersion']).toBe('number');
    expect(parsed['schemaVersion']).toBe(1);
  });

  // ---- All five event names ----

  it.each([
    'UserPromptSubmit',
    'Stop',
    'SessionStart',
    'SessionEnd',
    'Notification',
  ])('correctly emits event name %s', async (eventName) => {
    fs.writeFileSync(sentinelPath, '');
    const result = await runScript(
      pluginDataDir,
      makePayload({ hook_event_name: eventName, session_id: `session-${eventName}` })
    );
    expect(result.exitCode).toBe(0);

    const eventsDir = path.join(pluginDataDir, 'events');
    const content = fs.readFileSync(
      path.join(eventsDir, `session-${eventName}.ndjson`),
      'utf8'
    );
    const parsed = JSON.parse(content.trim()) as Record<string, unknown>;
    expect(parsed['event']).toBe(eventName);
  });

  // ---- PostToolUse: WorktreeSpawned detection ----

  it('emits WorktreeSpawned event for "git worktree add" command', async () => {
    fs.writeFileSync(sentinelPath, '');
    const result = await runScript(
      pluginDataDir,
      makePostToolUsePayload('git worktree add ../repo-feat-x', {
        session_id: 'session-ptu-1',
      })
    );
    expect(result.exitCode).toBe(0);

    const eventsDir = path.join(pluginDataDir, 'events');
    const files = fs.readdirSync(eventsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('session-ptu-1.ndjson');

    const content = fs.readFileSync(path.join(eventsDir, 'session-ptu-1.ndjson'), 'utf8');
    const parsed = JSON.parse(content.trim()) as Record<string, unknown>;
    expect(parsed['event']).toBe('WorktreeSpawned');
    expect(parsed['schemaVersion']).toBe(1);
    expect(parsed['sessionId']).toBe('session-ptu-1');
    expect(parsed['cwd']).toBe('/home/user/repo/main');
    expect(parsed['commandLine']).toBe('git worktree add ../repo-feat-x');
  });

  it('emits WorktreeSpawned event for "git worktree add -b feat/x" command', async () => {
    fs.writeFileSync(sentinelPath, '');
    const result = await runScript(
      pluginDataDir,
      makePostToolUsePayload('git worktree add -b feat/x ../repo-feat-x', {
        session_id: 'session-ptu-2',
      })
    );
    expect(result.exitCode).toBe(0);

    const eventsDir = path.join(pluginDataDir, 'events');
    const content = fs.readFileSync(path.join(eventsDir, 'session-ptu-2.ndjson'), 'utf8');
    const parsed = JSON.parse(content.trim()) as Record<string, unknown>;
    expect(parsed['event']).toBe('WorktreeSpawned');
    expect(parsed['commandLine']).toBe('git worktree add -b feat/x ../repo-feat-x');
  });

  it('emits WorktreeSpawned event for "gw add feat/x" command', async () => {
    fs.writeFileSync(sentinelPath, '');
    const result = await runScript(
      pluginDataDir,
      makePostToolUsePayload('gw add feat/x', {
        session_id: 'session-ptu-gw',
      })
    );
    expect(result.exitCode).toBe(0);

    const eventsDir = path.join(pluginDataDir, 'events');
    const content = fs.readFileSync(path.join(eventsDir, 'session-ptu-gw.ndjson'), 'utf8');
    const parsed = JSON.parse(content.trim()) as Record<string, unknown>;
    expect(parsed['event']).toBe('WorktreeSpawned');
    expect(parsed['commandLine']).toBe('gw add feat/x');
  });

  it('does NOT emit WorktreeSpawned for "git worktree list"', async () => {
    fs.writeFileSync(sentinelPath, '');
    const result = await runScript(
      pluginDataDir,
      makePostToolUsePayload('git worktree list --porcelain', {
        session_id: 'session-ptu-list',
      })
    );
    expect(result.exitCode).toBe(0);

    const eventsDir = path.join(pluginDataDir, 'events');
    const exists = fs.existsSync(eventsDir);
    if (exists) {
      const files = fs.readdirSync(eventsDir);
      expect(files).toHaveLength(0);
    } else {
      expect(exists).toBe(false);
    }
  });

  it('does NOT emit WorktreeSpawned for a plain "ls" command', async () => {
    fs.writeFileSync(sentinelPath, '');
    const result = await runScript(
      pluginDataDir,
      makePostToolUsePayload('ls -la', {
        session_id: 'session-ptu-ls',
      })
    );
    expect(result.exitCode).toBe(0);

    const eventsDir = path.join(pluginDataDir, 'events');
    const exists = fs.existsSync(eventsDir);
    if (exists) {
      const files = fs.readdirSync(eventsDir);
      expect(files).toHaveLength(0);
    }
  });

  it('does NOT emit WorktreeSpawned for "git branch" command', async () => {
    fs.writeFileSync(sentinelPath, '');
    await runScript(
      pluginDataDir,
      makePostToolUsePayload('git branch -a', { session_id: 'session-ptu-branch' })
    );

    const eventsDir = path.join(pluginDataDir, 'events');
    const exists = fs.existsSync(eventsDir);
    if (exists) {
      expect(fs.readdirSync(eventsDir)).toHaveLength(0);
    }
  });

  it('writes sidecar line to worktree-links.ndjson on WorktreeSpawned detection', async () => {
    fs.writeFileSync(sentinelPath, '');
    await runScript(
      pluginDataDir,
      makePostToolUsePayload('gw add feat/sidecar-test', {
        session_id: 'session-ptu-sidecar',
        cwd: '/home/user/repo/main',
      })
    );

    const sidecarPath = path.join(pluginDataDir, 'worktree-links.ndjson');
    expect(fs.existsSync(sidecarPath)).toBe(true);

    const content = fs.readFileSync(sidecarPath, 'utf8').trim();
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed['creatorCwd']).toBe('/home/user/repo/main');
    expect(parsed['commandLine']).toBe('gw add feat/sidecar-test');
    expect(typeof parsed['addedAt']).toBe('number');
  });

  it('two detected commands → two sidecar lines (append-only confirmed)', async () => {
    fs.writeFileSync(sentinelPath, '');

    await runScript(
      pluginDataDir,
      makePostToolUsePayload('gw add feat/first', { session_id: 'session-ptu-append-1', cwd: '/home/user/a' })
    );
    await runScript(
      pluginDataDir,
      makePostToolUsePayload('gw add feat/second', { session_id: 'session-ptu-append-2', cwd: '/home/user/b' })
    );

    const sidecarPath = path.join(pluginDataDir, 'worktree-links.ndjson');
    const lines = fs
      .readFileSync(sidecarPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    const second = JSON.parse(lines[1] ?? '{}') as Record<string, unknown>;
    expect(first['creatorCwd']).toBe('/home/user/a');
    expect(second['creatorCwd']).toBe('/home/user/b');
  });

  it('PostToolUse without worktree-add does NOT write any sidecar', async () => {
    fs.writeFileSync(sentinelPath, '');
    await runScript(
      pluginDataDir,
      makePostToolUsePayload('npm install', { session_id: 'session-ptu-npm' })
    );

    const sidecarPath = path.join(pluginDataDir, 'worktree-links.ndjson');
    expect(fs.existsSync(sidecarPath)).toBe(false);
  });

  // ---- Multiple writes (append) ----

  it('appends to existing NDJSON file', async () => {
    fs.writeFileSync(sentinelPath, '');
    const sessionId = 'session-append-test';
    const payload = makePayload({ session_id: sessionId, hook_event_name: 'UserPromptSubmit' });

    await runScript(pluginDataDir, payload);
    await runScript(pluginDataDir, makePayload({ session_id: sessionId, hook_event_name: 'Stop' }));

    const eventsDir = path.join(pluginDataDir, 'events');
    const content = fs.readFileSync(path.join(eventsDir, `${sessionId}.ndjson`), 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]) as Record<string, unknown>;
    const second = JSON.parse(lines[1]) as Record<string, unknown>;
    expect(first['event']).toBe('UserPromptSubmit');
    expect(second['event']).toBe('Stop');
  });
});
