/**
 * Tests for animation MCP tools: create_animation, create_animation_library,
 * add_keyframes, assign_animation_library.
 *
 * Uses vi.mock() to isolate tool logic from filesystem and Godot process.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../src/types.js';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

// Mock godot module
vi.mock('../src/godot.js', () => ({
  validatePath: vi.fn(),
  // Pure-path stand-in for the real resolveWithinProject: rejects null bytes,
  // ".." traversal, and absolute paths; strips res:// and joins to the root.
  resolveWithinProject: vi.fn((projectRoot: string, relPath: string) => {
    if (typeof relPath !== 'string' || relPath.length === 0 || relPath.includes('\0')) return null;
    const stripped = relPath.startsWith('res://') ? relPath.slice('res://'.length) : relPath;
    if (stripped.startsWith('/') || stripped.split('/').includes('..')) return null;
    return `${projectRoot}/${stripped}`;
  }),
  executeOperation: vi.fn(),
  runOperation: vi.fn(),
}));

// Mock errors module
vi.mock('../src/errors.js', () => ({
  toolError: vi.fn((message: string, suggestions: string[] = []) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, suggestions }) }],
    isError: true,
  })),
}));

import { existsSync } from 'fs';
import { validatePath, runOperation } from '../src/godot.js';
import { registerAnimationTools } from '../src/tools/animation.js';

// Helper to extract registered tool handlers from McpServer
function getToolHandlers(server: McpServer): Map<string, (params: Record<string, unknown>) => Promise<unknown>> {
  const handlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();
  const originalRegisterTool = server.registerTool.bind(server);

  server.registerTool = function (name: string, _config: unknown, handler: unknown) {
    handlers.set(name, handler as (params: Record<string, unknown>) => Promise<unknown>);
    return originalRegisterTool(name, _config, handler);
  } as typeof server.registerTool;

  return handlers;
}

function createTestContext(): ServerContext {
  return {
    godotPath: '/usr/bin/godot',
    operationsScriptPath: '/path/to/godot_operations.gd',
    activeProcess: null,
    trackedProcesses: new Set(),
    validatedPaths: new Map(),
  };
}

describe('Animation MCP Tools', () => {
  let server: McpServer;
  let ctx: ServerContext;
  let handlers: Map<string, (params: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer(
      { name: 'test', version: '0.0.1' },
      { capabilities: { tools: {} } },
    );
    ctx = createTestContext();
    handlers = getToolHandlers(server);
    registerAnimationTools(server, ctx);
  });

  // ── create_animation ─────────────────────────────────────────────────

  describe('create_animation', () => {
    it('registers the create_animation tool', () => {
      expect(handlers.has('create_animation')).toBe(true);
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('create_animation')!;
      const result = await handler({
        project_path: '/bad/../path',
        output_path: 'animations/walk.tres',
        tracks: [],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('create_animation')!;
      const result = await handler({
        project_path: '/not/a/project',
        output_path: 'animations/walk.tres',
        tracks: [],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('passes correct params to runOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({ ok: true, data: { success: true }, stdout: '', stderr: '', exitCode: 0 });

      const tracks = [
        {
          path: 'Sprite2D:position',
          keyframes: [
            { time: 0.0, value: { x: 0, y: 0 }, type: 'Vector2' },
            { time: 1.0, value: { x: 100, y: 0 }, type: 'Vector2' },
          ],
        },
      ];

      const handler = handlers.get('create_animation')!;
      await handler({
        project_path: '/my/project',
        output_path: 'animations/walk.tres',
        length: 2.0,
        loop_mode: 'linear',
        step: 0.05,
        tracks,
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'create_animation',
        {
          outputPath: 'animations/walk.tres',
          length: 2.0,
          loopMode: 'linear',
          step: 0.05,
          tracks,
        },
      );
    });

    it('returns success payload on ok:true', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, path: 'res://animations/walk.tres', track_count: 1 },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('create_animation')!;
      const result = await handler({
        project_path: '/my/project',
        output_path: 'animations/walk.tres',
        tracks: [],
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('animations/walk.tres');
      expect(result.content[0].text).toContain('track_count');
    });

    it('returns toolError on runOperation failure', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('create_animation')!;
      const result = await handler({
        project_path: '/my/project',
        output_path: 'animations/walk.tres',
        tracks: [],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Missing required parameter: output_path',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('create_animation')!;
      const result = await handler({
        project_path: '/my/project',
        output_path: 'animations/walk.tres',
        tracks: [],
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required parameter: output_path');
    });
  });

  // ── create_animation_library ─────────────────────────────────────────

  describe('create_animation_library', () => {
    it('registers the create_animation_library tool', () => {
      expect(handlers.has('create_animation_library')).toBe(true);
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('create_animation_library')!;
      const result = await handler({
        project_path: '/bad/../path',
        output_path: 'animations/library.tres',
        animations: { walk: 'animations/walk.tres' },
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('create_animation_library')!;
      const result = await handler({
        project_path: '/not/a/project',
        output_path: 'animations/library.tres',
        animations: { walk: 'animations/walk.tres' },
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('passes correct params to runOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({ ok: true, data: { success: true }, stdout: '', stderr: '', exitCode: 0 });

      const animations = {
        walk: 'animations/walk.tres',
        run: 'animations/run.tres',
      };

      const handler = handlers.get('create_animation_library')!;
      await handler({
        project_path: '/my/project',
        output_path: 'animations/library.tres',
        animations,
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'create_animation_library',
        {
          outputPath: 'animations/library.tres',
          animations,
        },
      );
    });

    it('returns success payload on ok:true', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, path: 'res://animations/library.tres', animation_count: 1 },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('create_animation_library')!;
      const result = await handler({
        project_path: '/my/project',
        output_path: 'animations/library.tres',
        animations: { walk: 'animations/walk.tres' },
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('animations/library.tres');
      expect(result.content[0].text).toContain('animation_count');
    });

    it('returns toolError on runOperation failure', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('create_animation_library')!;
      const result = await handler({
        project_path: '/my/project',
        output_path: 'animations/library.tres',
        animations: { walk: 'animations/walk.tres' },
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Failed to load animation: res://animations/walk.tres',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('create_animation_library')!;
      const result = await handler({
        project_path: '/my/project',
        output_path: 'animations/library.tres',
        animations: { walk: 'animations/walk.tres' },
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to load animation');
    });
  });

  // ── add_keyframes ────────────────────────────────────────────────────

  describe('add_keyframes', () => {
    it('registers the add_keyframes tool', () => {
      expect(handlers.has('add_keyframes')).toBe(true);
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('add_keyframes')!;
      const result = await handler({
        project_path: '/bad/../path',
        animation_path: 'animations/walk.tres',
        track_index: 0,
        keyframes: [{ time: 0.5, value: 42 }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('add_keyframes')!;
      const result = await handler({
        project_path: '/not/a/project',
        animation_path: 'animations/walk.tres',
        track_index: 0,
        keyframes: [{ time: 0.5, value: 42 }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('passes correct params with track_index to runOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({ ok: true, data: { success: true }, stdout: '', stderr: '', exitCode: 0 });

      const keyframes = [
        { time: 0.0, value: 0 },
        { time: 0.5, value: 50 },
        { time: 1.0, value: 100 },
      ];

      const handler = handlers.get('add_keyframes')!;
      await handler({
        project_path: '/my/project',
        animation_path: 'animations/walk.tres',
        track_index: 0,
        keyframes,
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'add_keyframes',
        {
          animationPath: 'animations/walk.tres',
          trackIndex: 0,
          keyframes,
        },
      );
    });

    it('passes correct params with track_path to runOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({ ok: true, data: { success: true }, stdout: '', stderr: '', exitCode: 0 });

      const keyframes = [{ time: 0.0, value: { x: 0, y: 0 } }];

      const handler = handlers.get('add_keyframes')!;
      await handler({
        project_path: '/my/project',
        animation_path: 'animations/walk.tres',
        track_path: 'Sprite2D:position',
        keyframes,
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'add_keyframes',
        {
          animationPath: 'animations/walk.tres',
          trackPath: 'Sprite2D:position',
          keyframes,
        },
      );
    });

    it('returns success payload on ok:true', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, path: 'res://animations/walk.tres', keyframes_added: 3 },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('add_keyframes')!;
      const result = await handler({
        project_path: '/my/project',
        animation_path: 'animations/walk.tres',
        track_index: 0,
        keyframes: [{ time: 0.5, value: 42 }],
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('keyframes_added');
    });

    it('returns toolError on runOperation failure', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('add_keyframes')!;
      const result = await handler({
        project_path: '/my/project',
        animation_path: 'animations/walk.tres',
        track_index: 0,
        keyframes: [{ time: 0.5, value: 42 }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Track not found. Index: 5, Path: ',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('add_keyframes')!;
      const result = await handler({
        project_path: '/my/project',
        animation_path: 'animations/walk.tres',
        track_index: 5,
        keyframes: [{ time: 0.5, value: 42 }],
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Track not found');
    });
  });

  // ── assign_animation_library ─────────────────────────────────────────

  describe('assign_animation_library', () => {
    it('registers the assign_animation_library tool', () => {
      expect(handlers.has('assign_animation_library')).toBe(true);
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('assign_animation_library')!;
      const result = await handler({
        project_path: '/bad/../path',
        scene_path: 'scenes/player.tscn',
        node_path: 'root/AnimationPlayer',
        library_name: 'default',
        library_path: 'animations/library.tres',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('assign_animation_library')!;
      const result = await handler({
        project_path: '/not/a/project',
        scene_path: 'scenes/player.tscn',
        node_path: 'root/AnimationPlayer',
        library_name: 'default',
        library_path: 'animations/library.tres',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('passes correct params to runOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({ ok: true, data: { success: true }, stdout: '', stderr: '', exitCode: 0 });

      const handler = handlers.get('assign_animation_library')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/player.tscn',
        node_path: 'root/AnimationPlayer',
        library_name: 'default',
        library_path: 'animations/library.tres',
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'assign_animation_library',
        {
          scenePath: 'scenes/player.tscn',
          nodePath: 'root/AnimationPlayer',
          libraryName: 'default',
          libraryPath: 'animations/library.tres',
        },
      );
    });

    it('returns success payload on ok:true', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, library_name: 'default', scene_path: 'res://scenes/player.tscn' },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('assign_animation_library')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/player.tscn',
        node_path: 'root/AnimationPlayer',
        library_name: 'default',
        library_path: 'animations/library.tres',
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('default');
    });

    it('returns toolError on runOperation failure', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('assign_animation_library')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/player.tscn',
        node_path: 'root/AnimationPlayer',
        library_name: 'default',
        library_path: 'animations/library.tres',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Target node is not an AnimationPlayer: root/Sprite2D',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('assign_animation_library')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/player.tscn',
        node_path: 'root/Sprite2D',
        library_name: 'default',
        library_path: 'animations/library.tres',
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not an AnimationPlayer');
    });
  });

  // ── path hardening rollout (resolveWithinProject) ───────────────────

  describe('path hardening', () => {
    beforeEach(() => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
    });

    async function expectPathRejected(
      tool: string,
      params: Record<string, unknown>,
      paramName: string,
    ): Promise<void> {
      const handler = handlers.get(tool)!;
      const result = (await handler(params)) as {
        isError?: boolean;
        content?: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      expect(result.content?.[0].text).toContain(paramName);
    }

    it('create_animation rejects output_path traversal outside the project', async () => {
      await expectPathRejected('create_animation', { project_path: '/proj', output_path: '../../evil.tres', tracks: [] }, 'output_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('create_animation_library rejects output_path traversal', async () => {
      await expectPathRejected('create_animation_library', { project_path: '/proj', output_path: '../../evil.tres', animations: {} }, 'output_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('add_keyframes rejects animation_path traversal', async () => {
      await expectPathRejected('add_keyframes', { project_path: '/proj', animation_path: '../../evil.tres', keyframes: [] }, 'animation_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('assign_animation_library rejects library_path traversal', async () => {
      await expectPathRejected('assign_animation_library', { project_path: '/proj', scene_path: 'scenes/p.tscn', node_path: 'root/AnimationPlayer', library_name: 'default', library_path: '../../evil.tres' }, 'library_path');
      expect(runOperation).not.toHaveBeenCalled();
    });
  });
});
