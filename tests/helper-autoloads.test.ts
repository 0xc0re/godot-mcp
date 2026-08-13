/**
 * Tests for ensureRuntimeHelperAutoloads: copies runtime_helper.gd /
 * screenshot_helper.gd into the project and registers them as autoloads
 * via modify_project_setting (T7-hardened res:// convention).
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
import { ensureRuntimeHelperAutoloads } from '../src/helper-autoloads.js';

const OP_OK = {
  ok: true as const,
  data: { success: true },
  stdout: '{"success": true}',
  stderr: '',
  exitCode: 0,
};

function createTestContext(): ServerContext {
  return {
    godotPath: '/usr/bin/godot',
    operationsScriptPath: '/srv/mcp/scripts/godot_operations.gd',
    activeProcess: null,
    trackedProcesses: new Set(),
    validatedPaths: new Map(),
  };
}

describe('ensureRuntimeHelperAutoloads', () => {
  let ctx: ServerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createTestContext();
  });

  it('copies both helper scripts into addons/godot_mcp and registers autoloads', async () => {
    // Helper sources exist next to godot_operations.gd; nothing exists in the project yet
    vi.mocked(existsSync).mockImplementation((p) => String(p).startsWith('/srv/mcp/scripts/'));
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('project.godot')) return '[autoload]\n';
      return '## helper source\n';
    });
    vi.mocked(runOperation).mockResolvedValue(OP_OK);

    const result = await ensureRuntimeHelperAutoloads(ctx, '/my/project');

    expect(result.registered).toEqual(['RuntimeHelper', 'ScreenshotHelper']);
    expect(result.failed).toEqual([]);

    // Scripts copied into the project
    expect(mkdirSync).toHaveBeenCalledWith('/my/project/addons/godot_mcp', { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      '/my/project/addons/godot_mcp/runtime_helper.gd',
      '## helper source\n',
      'utf-8',
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      '/my/project/addons/godot_mcp/screenshot_helper.gd',
      '## helper source\n',
      'utf-8',
    );

    // Registered via modify_project_setting with the *res:// convention
    // (built from a clean relative path — no res://res:// possible)
    expect(runOperation).toHaveBeenCalledWith(ctx, '/my/project', 'modify_project_setting', {
      section: 'autoload',
      key: 'RuntimeHelper',
      value: '*res://addons/godot_mcp/runtime_helper.gd',
      action: 'set',
    });
    expect(runOperation).toHaveBeenCalledWith(ctx, '/my/project', 'modify_project_setting', {
      section: 'autoload',
      key: 'ScreenshotHelper',
      value: '*res://addons/godot_mcp/screenshot_helper.gd',
      action: 'set',
    });
  });

  it('spawns no Godot process when both autoloads are already registered', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('project.godot')) {
        return [
          '[autoload]',
          'RuntimeHelper="*res://addons/godot_mcp/runtime_helper.gd"',
          'ScreenshotHelper="*res://addons/godot_mcp/screenshot_helper.gd"',
        ].join('\n');
      }
      return '## helper source\n';
    });

    const result = await ensureRuntimeHelperAutoloads(ctx, '/my/project');

    expect(result.alreadyRegistered).toEqual(['RuntimeHelper', 'ScreenshotHelper']);
    expect(result.registered).toEqual([]);
    expect(runOperation).not.toHaveBeenCalled();
    // Content identical -> no re-copy either
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('re-copies a stale helper script when project copy differs from source', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith('project.godot')) {
        return [
          '[autoload]',
          'RuntimeHelper="*res://addons/godot_mcp/runtime_helper.gd"',
          'ScreenshotHelper="*res://addons/godot_mcp/screenshot_helper.gd"',
        ].join('\n');
      }
      if (path.startsWith('/srv/mcp/scripts/')) return '## new helper version\n';
      return '## old helper version\n';
    });

    await ensureRuntimeHelperAutoloads(ctx, '/my/project');

    expect(writeFileSync).toHaveBeenCalledWith(
      '/my/project/addons/godot_mcp/runtime_helper.gd',
      '## new helper version\n',
      'utf-8',
    );
  });

  it('reports failed when the helper source script is missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReturnValue('');

    const result = await ensureRuntimeHelperAutoloads(ctx, '/my/project');

    expect(result.registered).toEqual([]);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]).toContain('RuntimeHelper');
    expect(result.failed[1]).toContain('ScreenshotHelper');
    expect(runOperation).not.toHaveBeenCalled();
  });

  it('reports failed (never throws) when registration yields ok:false', async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p).startsWith('/srv/mcp/scripts/'));
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('project.godot')) return '';
      return '## helper source\n';
    });
    vi.mocked(runOperation).mockResolvedValue({
      ok: false,
      error: 'Failed to save project.godot: error code 7',
      stdout: '',
      stderr: '',
      exitCode: 1,
    });

    const result = await ensureRuntimeHelperAutoloads(ctx, '/my/project');

    expect(result.registered).toEqual([]);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]).toContain('Failed to save project.godot');
  });

  it('re-registers when the autoload points somewhere else', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('project.godot')) {
        return '[autoload]\nRuntimeHelper="*res://somewhere/else.gd"\n';
      }
      return '## helper source\n';
    });
    vi.mocked(runOperation).mockResolvedValue(OP_OK);

    const result = await ensureRuntimeHelperAutoloads(ctx, '/my/project');

    expect(result.registered).toContain('RuntimeHelper');
  });
});
