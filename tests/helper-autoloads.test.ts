/**
 * Tests for the temporary RuntimeHelper injection lifecycle:
 * injectRuntimeHelper copies runtime_helper.gd into <project>/.godot/mcp/ and
 * TEMPORARILY registers the autoload via modify_project_setting (T7-hardened
 * res:// convention); restoreHelperInjection reverts project.godot to its
 * previous state (delete when absent before, set-back when it existed).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerContext } from '../src/types.js';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

// Mock godot module
vi.mock('../src/godot.js', () => ({
  runOperation: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { runOperation } from '../src/godot.js';
import {
  injectRuntimeHelper,
  restoreHelperInjection,
  HELPER_AUTOLOAD_VALUE,
} from '../src/helper-autoloads.js';

const OP_OK = {
  ok: true as const,
  data: { success: true },
  stdout: '{"success": true}',
  stderr: '',
  exitCode: 0,
};

const OP_FAIL = {
  ok: false as const,
  error: 'Failed to save project.godot: error code 7',
  stdout: '',
  stderr: '',
  exitCode: 1,
};

function createTestContext(): ServerContext {
  return {
    godotPath: '/usr/bin/godot',
    operationsScriptPath: '/srv/mcp/scripts/godot_operations.gd',
    activeProcess: null,
    trackedProcesses: new Set(),
    validatedPaths: new Map(),
    helperInjection: null,
  };
}

describe('injectRuntimeHelper', () => {
  let ctx: ServerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createTestContext();
  });

  it('copies runtime_helper.gd into .godot/mcp and temporarily registers the autoload', async () => {
    // Helper source exists next to godot_operations.gd; nothing in the project yet
    vi.mocked(existsSync).mockImplementation((p) => String(p).startsWith('/srv/mcp/scripts/'));
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('project.godot')) return '[autoload]\n';
      return '## helper source\n';
    });
    vi.mocked(runOperation).mockResolvedValue(OP_OK);

    const result = await injectRuntimeHelper(ctx, '/my/project');

    expect(result.injected).toBe(true);
    expect(result.selfHealed).toBe(false);
    expect(result.failed).toBeNull();
    // Entry was absent before -> restoration must delete it later
    expect(result.injection).toEqual({ projectPath: '/my/project', previousValue: null });
    expect(ctx.helperInjection).toBe(result.injection);

    // Script copied into .godot/mcp (NOT addons/)
    expect(mkdirSync).toHaveBeenCalledWith('/my/project/.godot/mcp', { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      '/my/project/.godot/mcp/runtime_helper.gd',
      '## helper source\n',
      'utf-8',
    );

    // Registered via modify_project_setting with the *res:// convention
    // (built from a clean relative constant — no res://res:// possible)
    expect(runOperation).toHaveBeenCalledWith(ctx, '/my/project', 'modify_project_setting', {
      section: 'autoload',
      key: 'RuntimeHelper',
      value: '*res://.godot/mcp/runtime_helper.gd',
      action: 'set',
    });
  });

  it('records a pre-existing user autoload value for later restoration', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('project.godot')) {
        return '[autoload]\nRuntimeHelper="*res://scripts/my_own_helper.gd"\n';
      }
      return '## helper source\n';
    });
    vi.mocked(runOperation).mockResolvedValue(OP_OK);

    const result = await injectRuntimeHelper(ctx, '/my/project');

    expect(result.injected).toBe(true);
    // Previous value recorded with surrounding quotes stripped
    expect(result.injection).toEqual({
      projectPath: '/my/project',
      previousValue: '*res://scripts/my_own_helper.gd',
    });
    expect(runOperation).toHaveBeenCalledWith(ctx, '/my/project', 'modify_project_setting', {
      section: 'autoload',
      key: 'RuntimeHelper',
      value: HELPER_AUTOLOAD_VALUE,
      action: 'set',
    });
  });

  it('self-heals a stale entry from a dead run: adopts it without spawning Godot', async () => {
    // kill -9 scenario: project.godot still carries our entry from a run
    // that never got cleaned up
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('project.godot')) {
        return '[autoload]\nRuntimeHelper="*res://.godot/mcp/runtime_helper.gd"\n';
      }
      return '## helper source\n';
    });

    const result = await injectRuntimeHelper(ctx, '/my/project');

    expect(result.injected).toBe(true);
    expect(result.selfHealed).toBe(true);
    // Adopted as "previously absent" so restoration removes it (no duplicate written)
    expect(result.injection).toEqual({ projectPath: '/my/project', previousValue: null });
    expect(ctx.helperInjection).toBe(result.injection);
    expect(runOperation).not.toHaveBeenCalled();
  });

  it('is idempotent on re-run: identical script content and live entry mean no writes at all', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('project.godot')) {
        return '[autoload]\nRuntimeHelper="*res://.godot/mcp/runtime_helper.gd"\n';
      }
      return '## helper source\n'; // project copy identical to source
    });

    const result = await injectRuntimeHelper(ctx, '/my/project');

    expect(result.injected).toBe(true);
    expect(runOperation).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(mkdirSync).not.toHaveBeenCalled();
  });

  it('refreshes a stale script copy when the project copy differs from source', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith('project.godot')) {
        return '[autoload]\nRuntimeHelper="*res://.godot/mcp/runtime_helper.gd"\n';
      }
      if (path.startsWith('/srv/mcp/scripts/')) return '## new helper version\n';
      return '## old helper version\n';
    });

    await injectRuntimeHelper(ctx, '/my/project');

    expect(writeFileSync).toHaveBeenCalledWith(
      '/my/project/.godot/mcp/runtime_helper.gd',
      '## new helper version\n',
      'utf-8',
    );
  });

  it('reports failed (never throws) when the helper source script is missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReturnValue('');

    const result = await injectRuntimeHelper(ctx, '/my/project');

    expect(result.injected).toBe(false);
    expect(result.failed).toContain('helper script missing');
    expect(result.injection).toBeNull();
    expect(ctx.helperInjection).toBeNull();
    expect(runOperation).not.toHaveBeenCalled();
  });

  it('reports failed (never throws) when registration yields ok:false', async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p).startsWith('/srv/mcp/scripts/'));
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('project.godot')) return '';
      return '## helper source\n';
    });
    vi.mocked(runOperation).mockResolvedValue(OP_FAIL);

    const result = await injectRuntimeHelper(ctx, '/my/project');

    expect(result.injected).toBe(false);
    expect(result.failed).toContain('Failed to save project.godot');
    // No restoration record when project.godot was not modified
    expect(result.injection).toBeNull();
    expect(ctx.helperInjection).toBeNull();
  });
});

describe('restoreHelperInjection', () => {
  let ctx: ServerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createTestContext();
  });

  it('deletes the autoload entry when it was absent before injection', async () => {
    const injection = { projectPath: '/my/project', previousValue: null };
    ctx.helperInjection = injection;
    vi.mocked(runOperation).mockResolvedValue(OP_OK);

    const restored = await restoreHelperInjection(ctx, injection);

    expect(restored).toBe(true);
    expect(ctx.helperInjection).toBeNull();
    expect(runOperation).toHaveBeenCalledWith(ctx, '/my/project', 'modify_project_setting', {
      section: 'autoload',
      key: 'RuntimeHelper',
      action: 'delete',
    });
  });

  it('restores the previous user value when the project had its own entry', async () => {
    const injection = {
      projectPath: '/my/project',
      previousValue: '*res://scripts/my_own_helper.gd',
    };
    ctx.helperInjection = injection;
    vi.mocked(runOperation).mockResolvedValue(OP_OK);

    const restored = await restoreHelperInjection(ctx, injection);

    expect(restored).toBe(true);
    expect(runOperation).toHaveBeenCalledWith(ctx, '/my/project', 'modify_project_setting', {
      section: 'autoload',
      key: 'RuntimeHelper',
      value: '*res://scripts/my_own_helper.gd',
      action: 'set',
    });
  });

  it('restores exactly once when stop_project and the exit handler race', async () => {
    const injection = { projectPath: '/my/project', previousValue: null };
    ctx.helperInjection = injection;
    vi.mocked(runOperation).mockResolvedValue(OP_OK);

    // Both callers hold the same record; the guard claims it synchronously
    const [first, second] = await Promise.all([
      restoreHelperInjection(ctx, injection),
      restoreHelperInjection(ctx, injection),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(runOperation).toHaveBeenCalledTimes(1);
  });

  it('no-ops on a null or stale record (a newer injection owns the entry)', async () => {
    const current = { projectPath: '/my/project', previousValue: null };
    const stale = { projectPath: '/my/project', previousValue: null };
    ctx.helperInjection = current;

    expect(await restoreHelperInjection(ctx, null)).toBe(false);
    expect(await restoreHelperInjection(ctx, stale)).toBe(false);
    expect(runOperation).not.toHaveBeenCalled();
    // The current record stays live for its rightful owner
    expect(ctx.helperInjection).toBe(current);
  });

  it('re-arms the record for retry when the restore operation fails', async () => {
    const injection = { projectPath: '/my/project', previousValue: null };
    ctx.helperInjection = injection;
    vi.mocked(runOperation).mockResolvedValue(OP_FAIL);

    const restored = await restoreHelperInjection(ctx, injection);

    expect(restored).toBe(false);
    // Record re-armed so a later stop/run can retry the restore
    expect(ctx.helperInjection).toBe(injection);
  });
});

describe('restore/inject race regressions', () => {
  let ctx: ServerContext;

  const OUR_ENTRY = '[autoload]\nRuntimeHelper="*res://.godot/mcp/runtime_helper.gd"\n';
  const USER_ENTRY = '[autoload]\nRuntimeHelper="*res://scripts/user_helper.gd"\n';
  const USER_VALUE = '*res://scripts/user_helper.gd';

  const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createTestContext();
  });

  it('injection waits out an in-flight spontaneous-exit restore before reading project.godot', async () => {
    // F1 regression: the game exited spontaneously; the exit handler fired
    // an unawaited restore (~1s headless Godot). A run_project arriving
    // inside that window must NOT read project.godot mid-restore and adopt
    // the entry the restore is about to overwrite.
    const injection = { projectPath: '/my/project', previousValue: USER_VALUE };
    ctx.helperInjection = injection;

    // Simulated project.godot: still holds OUR entry until the restore lands
    let projectGodot = OUR_ENTRY;
    let releaseRestore!: () => void;
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(((p: unknown) => {
      if (String(p).endsWith('project.godot')) return projectGodot;
      return '## helper source\n';
    }) as typeof readFileSync);
    vi.mocked(runOperation).mockImplementation(async (_c, _p, _op, params) => {
      if ((params as Record<string, unknown>).value === USER_VALUE) {
        // The restore write: blocks until the test releases it
        await new Promise<void>((resolve) => {
          releaseRestore = resolve;
        });
        projectGodot = USER_ENTRY;
        return OP_OK;
      }
      // The fresh injection write
      projectGodot = OUR_ENTRY;
      return OP_OK;
    });

    // Exit handler: fire-and-forget restore (claims the record, starts the write)
    const restorePromise = restoreHelperInjection(ctx, injection);
    // run_project arrives immediately after
    const injectPromise = injectRuntimeHelper(ctx, '/my/project');
    let injectSettled = false;
    void injectPromise.then(() => {
      injectSettled = true;
    });

    await flushMicrotasks();
    // Injection must be parked on ctx.helperRestoreInFlight, NOT self-healed
    expect(injectSettled).toBe(false);

    releaseRestore();
    expect(await restorePromise).toBe(true);
    const result = await injectPromise;

    // Injection saw the POST-restore state: no bogus adoption of an entry
    // that was about to be rewritten — the user's value is re-recorded so
    // the eventual stop puts it back instead of deleting it.
    expect(result.injected).toBe(true);
    expect(result.selfHealed).toBe(false);
    expect(result.injection?.previousValue).toBe(USER_VALUE);
    expect(ctx.helperRestoreInFlight).toBeNull();
  });

  it('self-heal inherits the re-armed record previousValue after repeated restore failures', async () => {
    // F2 regression: restore fails persistently -> record re-armed with the
    // user's value P -> next run's self-heal must inherit P, not adopt null
    // (which would delete the user's own entry at the eventual stop).
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(((p: unknown) => {
      if (String(p).endsWith('project.godot')) return OUR_ENTRY;
      return '## helper source\n';
    }) as typeof readFileSync);

    const injection = { projectPath: '/my/project', previousValue: USER_VALUE };
    ctx.helperInjection = injection;

    // stop_project: restore fails -> re-armed
    vi.mocked(runOperation).mockResolvedValueOnce(OP_FAIL);
    expect(await restoreHelperInjection(ctx, injection)).toBe(false);
    expect(ctx.helperInjection).toBe(injection);

    // next run_project: our entry still present -> self-heal, P preserved
    const result = await injectRuntimeHelper(ctx, '/my/project');
    expect(result.selfHealed).toBe(true);
    expect(result.injection?.previousValue).toBe(USER_VALUE);
    expect(ctx.helperInjection).toBe(result.injection);

    // eventual successful restore sets the user's value back (not a delete)
    vi.mocked(runOperation).mockResolvedValueOnce(OP_OK);
    expect(await restoreHelperInjection(ctx, ctx.helperInjection)).toBe(true);
    expect(runOperation).toHaveBeenLastCalledWith(ctx, '/my/project', 'modify_project_setting', {
      section: 'autoload',
      key: 'RuntimeHelper',
      value: USER_VALUE,
      action: 'set',
    });
  });

  it('does not inherit previousValue from a live record belonging to a different project', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(((p: unknown) => {
      if (String(p).endsWith('project.godot')) return OUR_ENTRY;
      return '## helper source\n';
    }) as typeof readFileSync);

    ctx.helperInjection = { projectPath: '/other/project', previousValue: USER_VALUE };

    const result = await injectRuntimeHelper(ctx, '/my/project');

    expect(result.selfHealed).toBe(true);
    // A different project's record proves nothing about THIS project.godot
    expect(result.injection?.previousValue).toBeNull();
  });
});
