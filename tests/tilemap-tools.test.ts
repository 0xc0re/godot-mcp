/**
 * Tests for tilemap MCP tools: create_tileset, paint_tilemap.
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
  executeOperation: vi.fn(),
}));

// Mock errors module
vi.mock('../src/errors.js', () => ({
  toolError: vi.fn((message: string, suggestions: string[] = []) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, suggestions }) }],
    isError: true,
  })),
}));

import { existsSync } from 'fs';
import { validatePath, executeOperation } from '../src/godot.js';
import { registerTileMapTools } from '../src/tools/tilemap.js';

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

describe('TileMap MCP Tools', () => {
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
    registerTileMapTools(server, ctx);
  });

  // ── create_tileset ──────────────────────────────────────────────────

  describe('create_tileset', () => {
    it('registers the create_tileset tool', () => {
      expect(handlers.has('create_tileset')).toBe(true);
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('create_tileset')!;
      const result = await handler({
        project_path: '/bad/../path',
        output_path: 'tilesets/ground.tres',
        texture_path: 'textures/ground.png',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('create_tileset')!;
      const result = await handler({
        project_path: '/not/a/project',
        output_path: 'tilesets/ground.tres',
        texture_path: 'textures/ground.png',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('passes correct params to executeOperation with all optional params', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const handler = handlers.get('create_tileset')!;
      await handler({
        project_path: '/my/project',
        output_path: 'tilesets/ground.tres',
        texture_path: 'textures/ground.png',
        tile_width: 32,
        tile_height: 32,
        separation_x: 2,
        separation_y: 2,
        margin_x: 1,
        margin_y: 1,
        columns: 8,
        rows: 4,
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'create_tileset',
        {
          outputPath: 'tilesets/ground.tres',
          texturePath: 'textures/ground.png',
          tileWidth: 32,
          tileHeight: 32,
          separationX: 2,
          separationY: 2,
          marginX: 1,
          marginY: 1,
          columns: 8,
          rows: 4,
        },
      );
    });

    it('passes default params when optional params omitted', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const handler = handlers.get('create_tileset')!;
      await handler({
        project_path: '/my/project',
        output_path: 'tilesets/ground.tres',
        texture_path: 'textures/ground.png',
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'create_tileset',
        expect.objectContaining({
          outputPath: 'tilesets/ground.tres',
          texturePath: 'textures/ground.png',
          tileWidth: 16,
          tileHeight: 16,
          separationX: 0,
          separationY: 0,
          marginX: 0,
          marginY: 0,
        }),
      );
    });

    it('returns stdout on success', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '{"success":true,"path":"tilesets/ground.tres"}',
        stderr: '',
      });

      const handler = handlers.get('create_tileset')!;
      const result = await handler({
        project_path: '/my/project',
        output_path: 'tilesets/ground.tres',
        texture_path: 'textures/ground.png',
      }) as { content: Array<{ text: string }> };

      expect(result.content[0].text).toContain('tilesets/ground.tres');
    });

    it('returns toolError on executeOperation failure', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('create_tileset')!;
      const result = await handler({
        project_path: '/my/project',
        output_path: 'tilesets/ground.tres',
        texture_path: 'textures/ground.png',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError on stderr error', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '',
        stderr: '[ERROR] Failed to create tileset',
      });

      const handler = handlers.get('create_tileset')!;
      const result = await handler({
        project_path: '/my/project',
        output_path: 'tilesets/ground.tres',
        texture_path: 'textures/ground.png',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  // ── paint_tilemap ───────────────────────────────────────────────────

  describe('paint_tilemap', () => {
    it('registers the paint_tilemap tool', () => {
      expect(handlers.has('paint_tilemap')).toBe(true);
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('paint_tilemap')!;
      const result = await handler({
        project_path: '/bad/../path',
        scene_path: 'scenes/level.tscn',
        node_path: 'root/TileMapLayer',
        mode: 'paint',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('paint_tilemap')!;
      const result = await handler({
        project_path: '/not/a/project',
        scene_path: 'scenes/level.tscn',
        node_path: 'root/TileMapLayer',
        mode: 'paint',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('passes correct params for mode=paint with cells', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const cells = [
        { x: 0, y: 0, source_id: 0, atlas_x: 0, atlas_y: 0 },
        { x: 1, y: 0, source_id: 0, atlas_x: 1, atlas_y: 0 },
      ];

      const handler = handlers.get('paint_tilemap')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/level.tscn',
        node_path: 'root/TileMapLayer',
        mode: 'paint',
        cells,
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'paint_tilemap',
        {
          scenePath: 'scenes/level.tscn',
          nodePath: 'root/TileMapLayer',
          mode: 'paint',
          cells,
        },
      );
    });

    it('passes correct params for mode=fill with region bounds', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const handler = handlers.get('paint_tilemap')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/level.tscn',
        node_path: 'root/TileMapLayer',
        mode: 'fill',
        x_start: 0,
        y_start: 0,
        x_end: 10,
        y_end: 5,
        source_id: 1,
        atlas_x: 2,
        atlas_y: 3,
        alternative_tile: 0,
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'paint_tilemap',
        {
          scenePath: 'scenes/level.tscn',
          nodePath: 'root/TileMapLayer',
          mode: 'fill',
          xStart: 0,
          yStart: 0,
          xEnd: 10,
          yEnd: 5,
          sourceId: 1,
          atlasX: 2,
          atlasY: 3,
          alternativeTile: 0,
        },
      );
    });

    it('passes correct params for mode=clear with specific cells', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const cells = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ];

      const handler = handlers.get('paint_tilemap')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/level.tscn',
        node_path: 'root/TileMapLayer',
        mode: 'clear',
        cells,
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'paint_tilemap',
        {
          scenePath: 'scenes/level.tscn',
          nodePath: 'root/TileMapLayer',
          mode: 'clear',
          cells,
        },
      );
    });

    it('passes correct params for mode=clear without cells (clear all)', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const handler = handlers.get('paint_tilemap')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/level.tscn',
        node_path: 'root/TileMapLayer',
        mode: 'clear',
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'paint_tilemap',
        {
          scenePath: 'scenes/level.tscn',
          nodePath: 'root/TileMapLayer',
          mode: 'clear',
        },
      );
    });

    it('returns stdout on success for paint mode', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '{"success":true,"cells_painted":2}',
        stderr: '',
      });

      const handler = handlers.get('paint_tilemap')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/level.tscn',
        node_path: 'root/TileMapLayer',
        mode: 'paint',
        cells: [{ x: 0, y: 0, source_id: 0, atlas_x: 0, atlas_y: 0 }],
      }) as { content: Array<{ text: string }> };

      expect(result.content[0].text).toContain('cells_painted');
    });

    it('returns stdout on success for fill mode', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '{"success":true,"mode":"fill"}',
        stderr: '',
      });

      const handler = handlers.get('paint_tilemap')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/level.tscn',
        node_path: 'root/TileMapLayer',
        mode: 'fill',
        x_start: 0,
        y_start: 0,
        x_end: 5,
        y_end: 5,
      }) as { content: Array<{ text: string }> };

      expect(result.content[0].text).toContain('fill');
    });

    it('returns stdout on success for clear mode', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '{"success":true,"mode":"clear"}',
        stderr: '',
      });

      const handler = handlers.get('paint_tilemap')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/level.tscn',
        node_path: 'root/TileMapLayer',
        mode: 'clear',
      }) as { content: Array<{ text: string }> };

      expect(result.content[0].text).toContain('clear');
    });

    it('returns toolError on executeOperation failure', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('paint_tilemap')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/level.tscn',
        node_path: 'root/TileMapLayer',
        mode: 'paint',
        cells: [{ x: 0, y: 0 }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError on stderr error', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '',
        stderr: '[ERROR] Failed to paint tilemap',
      });

      const handler = handlers.get('paint_tilemap')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/level.tscn',
        node_path: 'root/TileMapLayer',
        mode: 'fill',
        x_start: 0,
        y_start: 0,
        x_end: 5,
        y_end: 5,
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });
});
