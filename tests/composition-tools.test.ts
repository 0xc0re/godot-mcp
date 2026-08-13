/**
 * Tests for scene composition MCP tools: connect_signal, disconnect_signal,
 * instance_scene, batch_set_properties, manage_groups.
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
import { toolError } from '../src/errors.js';
import { registerCompositionTools } from '../src/tools/composition.js';

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

describe('Composition MCP Tools', () => {
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
    registerCompositionTools(server, ctx);
  });

  // ── connect_signal ──────────────────────────────────────────────────

  describe('connect_signal', () => {
    it('registers the connect_signal tool', () => {
      expect(handlers.has('connect_signal')).toBe(true);
    });

    it('passes correct params to runOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('connect_signal')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        source_node_path: 'root/Button',
        signal_name: 'pressed',
        target_node_path: 'root',
        method_name: '_on_button_pressed',
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'connect_signal',
        {
          scenePath: 'scenes/main.tscn',
          sourceNodePath: 'root/Button',
          signalName: 'pressed',
          targetNodePath: 'root',
          methodName: '_on_button_pressed',
        },
      );
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('connect_signal')!;
      const result = await handler({
        project_path: '/bad/../path',
        scene_path: 'scenes/main.tscn',
        source_node_path: 'root/Button',
        signal_name: 'pressed',
        target_node_path: 'root',
        method_name: '_on_button_pressed',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('connect_signal')!;
      const result = await handler({
        project_path: '/not/a/project',
        scene_path: 'scenes/main.tscn',
        source_node_path: 'root/Button',
        signal_name: 'pressed',
        target_node_path: 'root',
        method_name: '_on_button_pressed',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation rejects unexpectedly', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('connect_signal')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        source_node_path: 'root/Button',
        signal_name: 'pressed',
        target_node_path: 'root',
        method_name: '_on_button_pressed',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: "Signal 'pressed' does not exist on node",
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('connect_signal')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        source_node_path: 'root/Button',
        signal_name: 'pressed',
        target_node_path: 'root',
        method_name: '_on_button_pressed',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining("Signal 'pressed' does not exist on node"),
        expect.any(Array),
      );
    });
  });

  // ── disconnect_signal ───────────────────────────────────────────────

  describe('disconnect_signal', () => {
    it('registers the disconnect_signal tool', () => {
      expect(handlers.has('disconnect_signal')).toBe(true);
    });

    it('passes correct params to runOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('disconnect_signal')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        source_node_path: 'root/Button',
        signal_name: 'pressed',
        target_node_path: 'root',
        method_name: '_on_button_pressed',
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'disconnect_signal',
        {
          scenePath: 'scenes/main.tscn',
          sourceNodePath: 'root/Button',
          signalName: 'pressed',
          targetNodePath: 'root',
          methodName: '_on_button_pressed',
        },
      );
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('disconnect_signal')!;
      const result = await handler({
        project_path: '/bad/../path',
        scene_path: 'scenes/main.tscn',
        source_node_path: 'root/Button',
        signal_name: 'pressed',
        target_node_path: 'root',
        method_name: '_on_button_pressed',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('disconnect_signal')!;
      const result = await handler({
        project_path: '/not/a/project',
        scene_path: 'scenes/main.tscn',
        source_node_path: 'root/Button',
        signal_name: 'pressed',
        target_node_path: 'root',
        method_name: '_on_button_pressed',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation rejects unexpectedly', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('disconnect_signal')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        source_node_path: 'root/Button',
        signal_name: 'pressed',
        target_node_path: 'root',
        method_name: '_on_button_pressed',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Signal not connected: pressed',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('disconnect_signal')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        source_node_path: 'root/Button',
        signal_name: 'pressed',
        target_node_path: 'root',
        method_name: '_on_button_pressed',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Signal not connected: pressed'),
        expect.any(Array),
      );
    });
  });

  // ── instance_scene ──────────────────────────────────────────────────

  describe('instance_scene', () => {
    it('registers the instance_scene tool', () => {
      expect(handlers.has('instance_scene')).toBe(true);
    });

    it('passes correct params to runOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('instance_scene')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        child_scene_path: 'scenes/enemy.tscn',
        parent_node_path: 'root/Enemies',
        node_name: 'Enemy1',
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'instance_scene',
        {
          scenePath: 'scenes/main.tscn',
          childScenePath: 'scenes/enemy.tscn',
          parentNodePath: 'root/Enemies',
          nodeName: 'Enemy1',
        },
      );
    });

    it('works without optional node_name param', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('instance_scene')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        child_scene_path: 'scenes/enemy.tscn',
        parent_node_path: 'root/Enemies',
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'instance_scene',
        {
          scenePath: 'scenes/main.tscn',
          childScenePath: 'scenes/enemy.tscn',
          parentNodePath: 'root/Enemies',
        },
      );
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('instance_scene')!;
      const result = await handler({
        project_path: '/bad/../path',
        scene_path: 'scenes/main.tscn',
        child_scene_path: 'scenes/enemy.tscn',
        parent_node_path: 'root/Enemies',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('instance_scene')!;
      const result = await handler({
        project_path: '/not/a/project',
        scene_path: 'scenes/main.tscn',
        child_scene_path: 'scenes/enemy.tscn',
        parent_node_path: 'root/Enemies',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation rejects unexpectedly', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('instance_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        child_scene_path: 'scenes/enemy.tscn',
        parent_node_path: 'root/Enemies',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Failed to load child scene: scenes/enemy.tscn',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('instance_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        child_scene_path: 'scenes/enemy.tscn',
        parent_node_path: 'root/Enemies',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load child scene: scenes/enemy.tscn'),
        expect.any(Array),
      );
    });
  });

  // ── batch_set_properties ────────────────────────────────────────────

  describe('batch_set_properties', () => {
    it('registers the batch_set_properties tool', () => {
      expect(handlers.has('batch_set_properties')).toBe(true);
    });

    it('passes operations array to runOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const ops = [
        { node_path: 'root/Player', property_name: 'position', value: { x: 100, y: 200 }, value_type: 'Vector2' },
        { node_path: 'root/Enemy', property_name: 'visible', value: false },
      ];

      const handler = handlers.get('batch_set_properties')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        operations: ops,
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'batch_set_properties',
        {
          scenePath: 'scenes/main.tscn',
          operations: ops,
        },
      );
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('batch_set_properties')!;
      const result = await handler({
        project_path: '/bad/../path',
        scene_path: 'scenes/main.tscn',
        operations: [{ node_path: 'root', property_name: 'visible', value: true }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('batch_set_properties')!;
      const result = await handler({
        project_path: '/not/a/project',
        scene_path: 'scenes/main.tscn',
        operations: [{ node_path: 'root', property_name: 'visible', value: true }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation rejects unexpectedly', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('batch_set_properties')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        operations: [{ node_path: 'root', property_name: 'visible', value: true }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Node not found during validation: root/Missing',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('batch_set_properties')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        operations: [{ node_path: 'root', property_name: 'visible', value: true }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Node not found during validation: root/Missing'),
        expect.any(Array),
      );
    });
  });

  // ── manage_groups ───────────────────────────────────────────────────

  describe('manage_groups', () => {
    it('registers the manage_groups tool', () => {
      expect(handlers.has('manage_groups')).toBe(true);
    });

    it('passes correct params with both add and remove groups', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('manage_groups')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        add_groups: ['enemies', 'damageable'],
        remove_groups: ['allies'],
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'manage_groups',
        {
          scenePath: 'scenes/main.tscn',
          nodePath: 'root/Player',
          addGroups: ['enemies', 'damageable'],
          removeGroups: ['allies'],
        },
      );
    });

    it('works with only add_groups (no remove_groups)', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('manage_groups')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        add_groups: ['enemies'],
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'manage_groups',
        expect.objectContaining({
          scenePath: 'scenes/main.tscn',
          nodePath: 'root/Player',
          addGroups: ['enemies'],
        }),
      );
    });

    it('works with only remove_groups (no add_groups)', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('manage_groups')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        remove_groups: ['allies'],
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'manage_groups',
        expect.objectContaining({
          scenePath: 'scenes/main.tscn',
          nodePath: 'root/Player',
          removeGroups: ['allies'],
        }),
      );
    });

    it('returns toolError when neither add_groups nor remove_groups provided', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);

      const handler = handlers.get('manage_groups')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('manage_groups')!;
      const result = await handler({
        project_path: '/bad/../path',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        add_groups: ['enemies'],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('manage_groups')!;
      const result = await handler({
        project_path: '/not/a/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        add_groups: ['enemies'],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation rejects unexpectedly', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('manage_groups')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        add_groups: ['enemies'],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Node not found: root/Player',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('manage_groups')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        add_groups: ['enemies'],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Node not found: root/Player'),
        expect.any(Array),
      );
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

    it('connect_signal rejects scene_path traversal outside the project', async () => {
      await expectPathRejected('connect_signal', { project_path: '/proj', scene_path: '../../evil.tscn', source_node_path: 'root/Button', signal_name: 'pressed', target_node_path: 'root', method_name: '_on' }, 'scene_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('disconnect_signal rejects scene_path traversal', async () => {
      await expectPathRejected('disconnect_signal', { project_path: '/proj', scene_path: '../../evil.tscn', source_node_path: 'root/Button', signal_name: 'pressed', target_node_path: 'root', method_name: '_on' }, 'scene_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('instance_scene rejects child_scene_path traversal', async () => {
      await expectPathRejected('instance_scene', { project_path: '/proj', scene_path: 'scenes/main.tscn', child_scene_path: '../../outside/enemy.tscn', parent_node_path: 'root' }, 'child_scene_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('batch_set_properties rejects scene_path traversal', async () => {
      await expectPathRejected('batch_set_properties', { project_path: '/proj', scene_path: '../../evil.tscn', operations: [{ node_path: 'root', property_name: 'visible', value: true }] }, 'scene_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('manage_groups rejects scene_path traversal', async () => {
      await expectPathRejected('manage_groups', { project_path: '/proj', scene_path: '../../evil.tscn', node_path: 'root/Player', add_groups: ['g'] }, 'scene_path');
      expect(runOperation).not.toHaveBeenCalled();
    });
  });
});
