/**
 * Tests for project configuration MCP tools: add_input_action,
 * remove_input_action, list_input_actions.
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
import { validatePath, executeOperation } from '../src/godot.js';
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

    it('calls executeOperation with camelCase params including key events', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const handler = handlers.get('add_input_action')!;
      await handler({
        project_path: '/my/project',
        action_name: 'jump',
        events: [{ type: 'key', key: 'space' }],
        deadzone: 0.5,
      });

      expect(executeOperation).toHaveBeenCalledWith(
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
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const handler = handlers.get('add_input_action')!;
      await handler({
        project_path: '/my/project',
        action_name: 'fire',
        events: [{ type: 'joypad_button', button_index: 0 }],
      });

      expect(executeOperation).toHaveBeenCalledWith(
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
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const handler = handlers.get('add_input_action')!;
      await handler({
        project_path: '/my/project',
        action_name: 'move_right',
        events: [{ type: 'joypad_motion', axis: 0, axis_value: 1.0 }],
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'add_input_action',
        expect.objectContaining({
          actionName: 'move_right',
          events: [{ type: 'joypad_motion', axis: 0, axis_value: 1.0 }],
        }),
      );
    });

    it('returns toolError when stderr contains "Failed to"', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '',
        stderr: 'Failed to add input action',
      });

      const handler = handlers.get('add_input_action')!;
      const result = await handler({
        project_path: '/my/project',
        action_name: 'jump',
        events: [{ type: 'key', key: 'space' }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns stdout on success', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '{"success":true,"action":"jump"}',
        stderr: '',
      });

      const handler = handlers.get('add_input_action')!;
      const result = await handler({
        project_path: '/my/project',
        action_name: 'jump',
        events: [{ type: 'key', key: 'space' }],
      }) as { content: Array<{ text: string }> };

      expect(result.content[0].text).toContain('jump');
    });

    it('returns toolError on executeOperation exception', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockRejectedValue(new Error('Process failed'));

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
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const handler = handlers.get('add_input_action')!;
      await handler({
        project_path: '/my/project',
        action_name: 'jump',
        events: [{ type: 'key', key: 'space' }],
      });

      expect(executeOperation).toHaveBeenCalledWith(
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

    it('calls executeOperation with actionName param', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const handler = handlers.get('remove_input_action')!;
      await handler({
        project_path: '/my/project',
        action_name: 'jump',
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'remove_input_action',
        {
          actionName: 'jump',
        },
      );
    });

    it('returns stdout on success', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '{"success":true,"removed":"jump"}',
        stderr: '',
      });

      const handler = handlers.get('remove_input_action')!;
      const result = await handler({
        project_path: '/my/project',
        action_name: 'jump',
      }) as { content: Array<{ text: string }> };

      expect(result.content[0].text).toContain('jump');
    });

    it('returns toolError on stderr error', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '',
        stderr: 'Failed to remove input action',
      });

      const handler = handlers.get('remove_input_action')!;
      const result = await handler({
        project_path: '/my/project',
        action_name: 'jump',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError on executeOperation exception', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockRejectedValue(new Error('Process failed'));

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
});
