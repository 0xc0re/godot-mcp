/**
 * Tests for scene MCP tools: read_scene, modify_node_property, remove_node, attach_script.
 *
 * Uses vi.mock() to isolate tool logic from filesystem and Godot process.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../src/types.js';
import { registerSceneTools } from '../src/tools/scene.js';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// Mock godot module
vi.mock('../src/godot.js', () => ({
  validatePath: vi.fn(),
  executeOperation: vi.fn(),
}));

// Mock tscn-parser module
vi.mock('../src/parsers/tscn-parser.js', () => ({
  parseScene: vi.fn(),
}));

// Mock errors module
vi.mock('../src/errors.js', () => ({
  toolError: vi.fn((message: string, suggestions: string[] = []) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, suggestions }) }],
    isError: true,
  })),
}));

import { existsSync, readFileSync } from 'fs';
import { validatePath, executeOperation } from '../src/godot.js';
import { parseScene } from '../src/parsers/tscn-parser.js';
import { toolError } from '../src/errors.js';

// Helper to extract registered tool handlers from McpServer
function getToolHandlers(server: McpServer): Map<string, (params: Record<string, unknown>) => Promise<unknown>> {
  // McpServer stores tools internally; we intercept registerTool calls
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

describe('Scene MCP Tools', () => {
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
    registerSceneTools(server, ctx);
  });

  describe('read_scene', () => {
    it('registers the read_scene tool', () => {
      expect(handlers.has('read_scene')).toBe(true);
    });

    it('reads file and returns parsed scene JSON', async () => {
      const mockParsed = {
        format: 3,
        extResources: [],
        subResources: [],
        nodes: [{ name: 'root', type: 'Node2D', properties: {} }],
        connections: [],
      };

      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('[gd_scene format=3]');
      vi.mocked(parseScene).mockReturnValue(mockParsed);

      const handler = handlers.get('read_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
      }) as { content: Array<{ type: string; text: string }> };

      expect(readFileSync).toHaveBeenCalled();
      expect(parseScene).toHaveBeenCalledWith('[gd_scene format=3]');
      expect(result.content[0].text).toContain('Node2D');
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('read_scene')!;
      const result = await handler({
        project_path: '/my/../project',
        scene_path: 'scenes/main.tscn',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('read_scene')!;
      const result = await handler({
        project_path: '/not/a/project',
        scene_path: 'scenes/main.tscn',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe('modify_node_property', () => {
    it('registers the modify_node_property tool', () => {
      expect(handlers.has('modify_node_property')).toBe(true);
    });

    it('passes correct params to executeOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const handler = handlers.get('modify_node_property')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        property_name: 'position',
        value: { x: 100, y: 200 },
        value_type: 'Vector2',
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'modify_node_property',
        expect.objectContaining({
          scenePath: 'scenes/main.tscn',
          nodePath: 'root/Player',
          propertyName: 'position',
          value: { x: 100, y: 200 },
          valueType: 'Vector2',
        }),
      );
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('modify_node_property')!;
      const result = await handler({
        project_path: '/bad/../path',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        property_name: 'position',
        value: 42,
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe('remove_node', () => {
    it('registers the remove_node tool', () => {
      expect(handlers.has('remove_node')).toBe(true);
    });

    it('passes correct params to executeOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const handler = handlers.get('remove_node')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/EnemySpawner',
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'remove_node',
        expect.objectContaining({
          scenePath: 'scenes/main.tscn',
          nodePath: 'root/EnemySpawner',
        }),
      );
    });

    it('returns toolError for missing project.godot', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('remove_node')!;
      const result = await handler({
        project_path: '/not/a/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/SomeNode',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe('attach_script', () => {
    it('registers the attach_script tool', () => {
      expect(handlers.has('attach_script')).toBe(true);
    });

    it('passes correct params to executeOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const handler = handlers.get('attach_script')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        script_path: 'scripts/player.gd',
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'attach_script',
        expect.objectContaining({
          scenePath: 'scenes/main.tscn',
          nodePath: 'root/Player',
          scriptPath: 'scripts/player.gd',
        }),
      );
    });

    it('returns toolError for invalid paths containing ".."', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('attach_script')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/../../../etc/passwd',
        node_path: 'root/Player',
        script_path: 'scripts/player.gd',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError for missing project.godot', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('attach_script')!;
      const result = await handler({
        project_path: '/not/a/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        script_path: 'scripts/player.gd',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });
});
