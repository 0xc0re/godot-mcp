/**
 * Tests for project configuration MCP tools: add_input_action,
 * remove_input_action, list_input_actions, get_collision_layer_names,
 * set_collision_layer_names, set_node_collision, list_autoloads,
 * add_autoload, remove_autoload.
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
    readFileSync: vi.fn(),
  };
});

// Mock godot module
vi.mock('../src/godot.js', () => ({
  validatePath: vi.fn(),
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

// Mock project-parser module
vi.mock('../src/parsers/project-parser.js', () => ({
  parseProjectSettings: vi.fn(),
}));

import { existsSync, readFileSync } from 'fs';
import { validatePath, runOperation } from '../src/godot.js';
import { toolError } from '../src/errors.js';
import { parseProjectSettings } from '../src/parsers/project-parser.js';
import { registerConfigTools } from '../src/tools/config.js';

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

describe('Config MCP Tools', () => {
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
    registerConfigTools(server, ctx);
  });

  // ── add_input_action ─────────────────────────────────────────────────

  describe('add_input_action', () => {
    it('registers the add_input_action tool', () => {
      expect(handlers.has('add_input_action')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('add_input_action')!;
      const result = await handler({
        project_path: '/bad/../path',
        action_name: 'jump',
        events: [{ type: 'key', key: 'space' }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('add_input_action')!;
      const result = await handler({
        project_path: '/not/a/project',
        action_name: 'jump',
        events: [{ type: 'key', key: 'space' }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('calls runOperation with camelCase params including key events', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('add_input_action')!;
      await handler({
        project_path: '/my/project',
        action_name: 'jump',
        events: [{ type: 'key', key: 'space' }],
        deadzone: 0.5,
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'add_input_action',
        {
          actionName: 'jump',
          events: [{ type: 'key', key: 'space' }],
          deadzone: 0.5,
        },
      );
    });

    it('passes joypad_button events with button_index', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('add_input_action')!;
      await handler({
        project_path: '/my/project',
        action_name: 'fire',
        events: [{ type: 'joypad_button', button_index: 0 }],
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'add_input_action',
        expect.objectContaining({
          actionName: 'fire',
          events: [{ type: 'joypad_button', button_index: 0 }],
        }),
      );
    });

    it('passes joypad_motion events with axis and axis_value', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('add_input_action')!;
      await handler({
        project_path: '/my/project',
        action_name: 'move_right',
        events: [{ type: 'joypad_motion', axis: 0, axis_value: 1.0 }],
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'add_input_action',
        expect.objectContaining({
          actionName: 'move_right',
          events: [{ type: 'joypad_motion', axis: 0, axis_value: 1.0 }],
        }),
      );
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Unknown event type: bogus',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('add_input_action')!;
      const result = await handler({
        project_path: '/my/project',
        action_name: 'jump',
        events: [{ type: 'key', key: 'space' }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Unknown event type: bogus'),
        expect.any(Array),
      );
    });

    it('returns success output with operation data', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, action: 'jump', event_count: 1 },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('add_input_action')!;
      const result = await handler({
        project_path: '/my/project',
        action_name: 'jump',
        events: [{ type: 'key', key: 'space' }],
      }) as { content: Array<{ text: string }> };

      expect(result.content[0].text).toContain('jump');
    });

    it('returns toolError when runOperation rejects unexpectedly', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('add_input_action')!;
      const result = await handler({
        project_path: '/my/project',
        action_name: 'jump',
        events: [{ type: 'key', key: 'space' }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('uses default deadzone of 0.5 when not provided', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('add_input_action')!;
      await handler({
        project_path: '/my/project',
        action_name: 'jump',
        events: [{ type: 'key', key: 'space' }],
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'add_input_action',
        expect.objectContaining({
          deadzone: 0.5,
        }),
      );
    });
  });

  // ── remove_input_action ──────────────────────────────────────────────

  describe('remove_input_action', () => {
    it('registers the remove_input_action tool', () => {
      expect(handlers.has('remove_input_action')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('remove_input_action')!;
      const result = await handler({
        project_path: '/bad/../path',
        action_name: 'jump',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('remove_input_action')!;
      const result = await handler({
        project_path: '/not/a/project',
        action_name: 'jump',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('calls runOperation with actionName param', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('remove_input_action')!;
      await handler({
        project_path: '/my/project',
        action_name: 'jump',
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'remove_input_action',
        {
          actionName: 'jump',
        },
      );
    });

    it('returns success output with operation data', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, action: 'jump' },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('remove_input_action')!;
      const result = await handler({
        project_path: '/my/project',
        action_name: 'jump',
      }) as { content: Array<{ text: string }> };

      expect(result.content[0].text).toContain('jump');
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Input action not found: jump',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('remove_input_action')!;
      const result = await handler({
        project_path: '/my/project',
        action_name: 'jump',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Input action not found: jump'),
        expect.any(Array),
      );
    });

    it('returns toolError when runOperation rejects unexpectedly', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('remove_input_action')!;
      const result = await handler({
        project_path: '/my/project',
        action_name: 'jump',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  // ── list_input_actions ───────────────────────────────────────────────

  describe('list_input_actions', () => {
    it('registers the list_input_actions tool', () => {
      expect(handlers.has('list_input_actions')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('list_input_actions')!;
      const result = await handler({
        project_path: '/bad/../path',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('list_input_actions')!;
      const result = await handler({
        project_path: '/not/a/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('reads project.godot and parses with parseProjectSettings', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('[input]\nmove_left={"deadzone":0.5}');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          input: {
            move_left: '{\n"deadzone": 0.5,\n"events": []\n}',
          },
        },
        configVersion: 5,
      });

      const handler = handlers.get('list_input_actions')!;
      await handler({ project_path: '/my/project' });

      expect(readFileSync).toHaveBeenCalled();
      expect(parseProjectSettings).toHaveBeenCalled();
    });

    it('returns JSON with action names and raw event data', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('file content');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          input: {
            move_left: '{\n"deadzone": 0.5,\n"events": [Object(InputEventKey)]\n}',
            jump: '{\n"deadzone": 0.5,\n"events": [Object(InputEventKey)]\n}',
          },
        },
        configVersion: 5,
      });

      const handler = handlers.get('list_input_actions')!;
      const result = await handler({ project_path: '/my/project' }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.actions).toHaveLength(2);
      expect(parsed.actions[0].name).toBe('move_left');
      expect(parsed.actions[1].name).toBe('jump');
      expect(parsed.actions[0].raw_value).toBeDefined();
    });

    it('returns empty actions array when no input section exists', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('file content');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          application: { 'config/name': '"MyGame"' },
        },
        configVersion: 5,
      });

      const handler = handlers.get('list_input_actions')!;
      const result = await handler({ project_path: '/my/project' }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.actions).toEqual([]);
    });

    it('returns toolError on readFileSync exception', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const handler = handlers.get('list_input_actions')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  // ── get_collision_layer_names ────────────────────────────────────────

  describe('get_collision_layer_names', () => {
    it('registers the get_collision_layer_names tool', () => {
      expect(handlers.has('get_collision_layer_names')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('get_collision_layer_names')!;
      const result = await handler({
        project_path: '/bad/../path',
        physics_type: '3d',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('get_collision_layer_names')!;
      const result = await handler({
        project_path: '/not/a/project',
        physics_type: '3d',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('reads project.godot and returns layer names from [layer_names] section', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('file content');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          layer_names: {
            '3d_physics/layer_1': '"Player"',
            '3d_physics/layer_2': '"Environment"',
            '3d_physics/layer_3': '"Enemy"',
          },
        },
        configVersion: 5,
      });

      const handler = handlers.get('get_collision_layer_names')!;
      const result = await handler({
        project_path: '/my/project',
        physics_type: '3d',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.physics_type).toBe('3d');
      expect(parsed.layers).toEqual({
        '1': 'Player',
        '2': 'Environment',
        '3': 'Enemy',
      });
    });

    it('returns empty layers when no layer_names section exists', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('file content');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          application: { 'config/name': '"MyGame"' },
        },
        configVersion: 5,
      });

      const handler = handlers.get('get_collision_layer_names')!;
      const result = await handler({
        project_path: '/my/project',
        physics_type: '3d',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.layers).toEqual({});
    });

    it('filters by physics_type prefix (2d vs 3d)', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('file content');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          layer_names: {
            '3d_physics/layer_1': '"Player3D"',
            '2d_physics/layer_1': '"Player2D"',
            '2d_physics/layer_2': '"Terrain2D"',
          },
        },
        configVersion: 5,
      });

      const handler = handlers.get('get_collision_layer_names')!;
      const result = await handler({
        project_path: '/my/project',
        physics_type: '2d',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.physics_type).toBe('2d');
      expect(parsed.layers).toEqual({
        '1': 'Player2D',
        '2': 'Terrain2D',
      });
      // Should NOT include 3d layers
      expect(parsed.layers).not.toHaveProperty('Player3D');
    });

    it('returns toolError on readFileSync exception', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const handler = handlers.get('get_collision_layer_names')!;
      const result = await handler({
        project_path: '/my/project',
        physics_type: '3d',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  // ── set_collision_layer_names ────────────────────────────────────────

  describe('set_collision_layer_names', () => {
    it('registers the set_collision_layer_names tool', () => {
      expect(handlers.has('set_collision_layer_names')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('set_collision_layer_names')!;
      const result = await handler({
        project_path: '/bad/../path',
        physics_type: '3d',
        layers: [{ layer: 1, name: 'Player' }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('set_collision_layer_names')!;
      const result = await handler({
        project_path: '/not/a/project',
        physics_type: '3d',
        layers: [{ layer: 1, name: 'Player' }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('calls runOperation with modify_project_setting for each layer', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('set_collision_layer_names')!;
      await handler({
        project_path: '/my/project',
        physics_type: '3d',
        layers: [
          { layer: 1, name: 'Player' },
          { layer: 2, name: 'Environment' },
        ],
      });

      expect(runOperation).toHaveBeenCalledTimes(2);
      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'modify_project_setting',
        { section: 'layer_names', key: '3d_physics/layer_1', value: 'Player', action: 'set' },
      );
      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'modify_project_setting',
        { section: 'layer_names', key: '3d_physics/layer_2', value: 'Environment', action: 'set' },
      );
    });

    it('returns success with layers_set array', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('set_collision_layer_names')!;
      const result = await handler({
        project_path: '/my/project',
        physics_type: '3d',
        layers: [
          { layer: 1, name: 'Player' },
          { layer: 3, name: 'Enemy' },
        ],
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.physics_type).toBe('3d');
      expect(parsed.layers_set).toEqual([
        { layer: 1, name: 'Player', success: true },
        { layer: 3, name: 'Enemy', success: true },
      ]);
    });

    it('marks individual layers as failed when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation)
        .mockResolvedValueOnce({
          ok: true,
          data: { success: true },
          stdout: '',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          ok: false,
          error: 'Failed to save project.godot: error code 1',
          stdout: '',
          stderr: '',
          exitCode: 1,
        });

      const handler = handlers.get('set_collision_layer_names')!;
      const result = await handler({
        project_path: '/my/project',
        physics_type: '3d',
        layers: [
          { layer: 1, name: 'Player' },
          { layer: 2, name: 'Environment' },
        ],
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.layers_set[0].success).toBe(true);
      expect(parsed.layers_set[1].success).toBe(false);
    });

    it('returns toolError when runOperation rejects unexpectedly', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('set_collision_layer_names')!;
      const result = await handler({
        project_path: '/my/project',
        physics_type: '3d',
        layers: [{ layer: 1, name: 'Player' }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  // ── set_node_collision ───────────────────────────────────────────────

  describe('set_node_collision', () => {
    it('registers the set_node_collision tool', () => {
      expect(handlers.has('set_node_collision')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('set_node_collision')!;
      const result = await handler({
        project_path: '/bad/../path',
        scene_path: 'scenes/player.tscn',
        node_path: '.',
        collision_layer: ['Player'],
        physics_type: '3d',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('set_node_collision')!;
      const result = await handler({
        project_path: '/not/a/project',
        scene_path: 'scenes/player.tscn',
        node_path: '.',
        collision_layer: ['Player'],
        physics_type: '3d',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when neither collision_layer nor collision_mask provided', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);

      const handler = handlers.get('set_node_collision')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/player.tscn',
        node_path: '.',
        physics_type: '3d',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('resolves layer names to bitmask correctly (layer 1 = 1, layer 3 = 4, combined = 5)', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('file content');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          layer_names: {
            '3d_physics/layer_1': '"Player"',
            '3d_physics/layer_2': '"Environment"',
            '3d_physics/layer_3': '"Enemy"',
          },
        },
        configVersion: 5,
      });
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('set_node_collision')!;
      await handler({
        project_path: '/my/project',
        scene_path: 'scenes/player.tscn',
        node_path: '.',
        collision_layer: ['Player', 'Enemy'],
        physics_type: '3d',
      });

      // layer 1 (Player) = bit 0 = 1, layer 3 (Enemy) = bit 2 = 4, combined = 5
      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'modify_node_property',
        {
          scenePath: 'scenes/player.tscn',
          nodePath: '.',
          propertyName: 'collision_layer',
          value: 5,
        },
      );
    });

    it('returns toolError for unknown layer names', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('file content');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          layer_names: {
            '3d_physics/layer_1': '"Player"',
            '3d_physics/layer_2': '"Environment"',
            '3d_physics/layer_3': '"Enemy"',
          },
        },
        configVersion: 5,
      });

      const handler = handlers.get('set_node_collision')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/player.tscn',
        node_path: '.',
        collision_layer: ['Player', 'NonExistent'],
        physics_type: '3d',
      }) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('NonExistent');
    });

    it('calls runOperation with modify_node_property for both collision_layer and collision_mask', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('file content');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          layer_names: {
            '3d_physics/layer_1': '"Player"',
            '3d_physics/layer_2': '"Environment"',
            '3d_physics/layer_3': '"Enemy"',
          },
        },
        configVersion: 5,
      });
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('set_node_collision')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/player.tscn',
        node_path: 'Player/CollisionShape3D',
        collision_layer: ['Player'],
        collision_mask: ['Environment', 'Enemy'],
        physics_type: '3d',
      }) as { content: Array<{ text: string }> };

      expect(runOperation).toHaveBeenCalledTimes(2);
      // collision_layer: Player = layer 1 = bit 0 = 1
      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'modify_node_property',
        {
          scenePath: 'scenes/player.tscn',
          nodePath: 'Player/CollisionShape3D',
          propertyName: 'collision_layer',
          value: 1,
        },
      );
      // collision_mask: Environment = layer 2 = bit 1 = 2, Enemy = layer 3 = bit 2 = 4, combined = 6
      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'modify_node_property',
        {
          scenePath: 'scenes/player.tscn',
          nodePath: 'Player/CollisionShape3D',
          propertyName: 'collision_mask',
          value: 6,
        },
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.results).toHaveLength(2);
    });

    it('returns toolError when runOperation rejects unexpectedly', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('file content');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          layer_names: {
            '3d_physics/layer_1': '"Player"',
          },
        },
        configVersion: 5,
      });
      vi.mocked(runOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('set_node_collision')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/player.tscn',
        node_path: '.',
        collision_layer: ['Player'],
        physics_type: '3d',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  // ── list_autoloads ───────────────────────────────────────────────────

  describe('list_autoloads', () => {
    it('registers the list_autoloads tool', () => {
      expect(handlers.has('list_autoloads')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('list_autoloads')!;
      const result = await handler({
        project_path: '/bad/../path',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('list_autoloads')!;
      const result = await handler({
        project_path: '/not/a/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('parses [autoload] section correctly and strips * prefix with enabled status', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('file content');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          autoload: {
            EventBus: '"*res://scripts/autoloads/event_bus.gd"',
            GameManager: '"*res://scripts/autoloads/game_manager.gd"',
          },
        },
        configVersion: 5,
      });

      const handler = handlers.get('list_autoloads')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.autoloads).toHaveLength(2);
      expect(parsed.autoloads[0]).toEqual({
        name: 'EventBus',
        script_path: 'res://scripts/autoloads/event_bus.gd',
        enabled: true,
      });
      expect(parsed.autoloads[1]).toEqual({
        name: 'GameManager',
        script_path: 'res://scripts/autoloads/game_manager.gd',
        enabled: true,
      });
    });

    it('reports disabled status when * prefix is missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('file content');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          autoload: {
            DisabledLoader: '"res://scripts/autoloads/disabled.gd"',
          },
        },
        configVersion: 5,
      });

      const handler = handlers.get('list_autoloads')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.autoloads).toHaveLength(1);
      expect(parsed.autoloads[0]).toEqual({
        name: 'DisabledLoader',
        script_path: 'res://scripts/autoloads/disabled.gd',
        enabled: false,
      });
    });

    it('returns empty array when no autoloads section exists', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('file content');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          application: { 'config/name': '"MyGame"' },
        },
        configVersion: 5,
      });

      const handler = handlers.get('list_autoloads')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.autoloads).toEqual([]);
    });

    it('returns toolError on readFileSync exception', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const handler = handlers.get('list_autoloads')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  // ── add_autoload ─────────────────────────────────────────────────────

  describe('add_autoload', () => {
    it('registers the add_autoload tool', () => {
      expect(handlers.has('add_autoload')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('add_autoload')!;
      const result = await handler({
        project_path: '/bad/../path',
        name: 'EventBus',
        script_path: 'scripts/autoloads/event_bus.gd',
        enabled: true,
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('add_autoload')!;
      const result = await handler({
        project_path: '/not/a/project',
        name: 'EventBus',
        script_path: 'scripts/autoloads/event_bus.gd',
        enabled: true,
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when script file not found', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((path: unknown) => {
        const p = path as string;
        // project.godot exists, but the script file does not
        if (p.endsWith('project.godot')) return true;
        return false;
      });

      const handler = handlers.get('add_autoload')!;
      const result = await handler({
        project_path: '/my/project',
        name: 'EventBus',
        script_path: 'scripts/autoloads/event_bus.gd',
        enabled: true,
      }) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('Script file not found');
    });

    it('calls runOperation with correct *res:// prefix format for enabled autoload', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((path: unknown) => {
        // Both project.godot and script file exist
        return true;
      });
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('add_autoload')!;
      await handler({
        project_path: '/my/project',
        name: 'EventBus',
        script_path: 'scripts/autoloads/event_bus.gd',
        enabled: true,
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'modify_project_setting',
        {
          section: 'autoload',
          key: 'EventBus',
          value: '*res://scripts/autoloads/event_bus.gd',
          action: 'set',
        },
      );
    });

    it('calls runOperation with res:// prefix (no *) for disabled autoload', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('add_autoload')!;
      await handler({
        project_path: '/my/project',
        name: 'EventBus',
        script_path: 'scripts/autoloads/event_bus.gd',
        enabled: false,
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'modify_project_setting',
        {
          section: 'autoload',
          key: 'EventBus',
          value: 'res://scripts/autoloads/event_bus.gd',
          action: 'set',
        },
      );
    });

    it('returns success JSON on successful add', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('add_autoload')!;
      const result = await handler({
        project_path: '/my/project',
        name: 'EventBus',
        script_path: 'scripts/autoloads/event_bus.gd',
        enabled: true,
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.name).toBe('EventBus');
      expect(parsed.script_path).toBe('scripts/autoloads/event_bus.gd');
      expect(parsed.enabled).toBe(true);
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Failed to save project.godot: error code 1',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('add_autoload')!;
      const result = await handler({
        project_path: '/my/project',
        name: 'EventBus',
        script_path: 'scripts/autoloads/event_bus.gd',
        enabled: true,
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation rejects unexpectedly', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('add_autoload')!;
      const result = await handler({
        project_path: '/my/project',
        name: 'EventBus',
        script_path: 'scripts/autoloads/event_bus.gd',
        enabled: true,
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  // ── remove_autoload ──────────────────────────────────────────────────

  describe('remove_autoload', () => {
    it('registers the remove_autoload tool', () => {
      expect(handlers.has('remove_autoload')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('remove_autoload')!;
      const result = await handler({
        project_path: '/bad/../path',
        name: 'EventBus',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('remove_autoload')!;
      const result = await handler({
        project_path: '/not/a/project',
        name: 'EventBus',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('calls runOperation with delete action', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('remove_autoload')!;
      await handler({
        project_path: '/my/project',
        name: 'EventBus',
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'modify_project_setting',
        { section: 'autoload', key: 'EventBus', action: 'delete' },
      );
    });

    it('returns success JSON on successful removal', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('remove_autoload')!;
      const result = await handler({
        project_path: '/my/project',
        name: 'EventBus',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.name).toBe('EventBus');
      expect(parsed.action).toBe('removed');
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Failed to load project.godot: error code 1',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('remove_autoload')!;
      const result = await handler({
        project_path: '/my/project',
        name: 'EventBus',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when runOperation rejects unexpectedly', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('remove_autoload')!;
      const result = await handler({
        project_path: '/my/project',
        name: 'EventBus',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });
});
