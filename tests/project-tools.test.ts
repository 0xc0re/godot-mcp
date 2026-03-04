/**
 * Tests for project MCP tools: read_project_settings, modify_project_setting.
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
  execGodot: vi.fn(),
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
import { registerProjectTools } from '../src/tools/project.js';

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

const SAMPLE_PROJECT_CONTENT = `config_version=5

[application]

config/name="My Game"
run/main_scene="res://main.tscn"

[autoload]

GameManager="*res://scripts/game_manager.gd"

[rendering]

renderer/rendering_method="forward_plus"
`;

describe('Project MCP Tools', () => {
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
    registerProjectTools(server, ctx);
  });

  describe('read_project_settings', () => {
    it('registers the read_project_settings tool', () => {
      expect(handlers.has('read_project_settings')).toBe(true);
    });

    it('reads project.godot and returns parsed JSON via parseProjectSettings', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(SAMPLE_PROJECT_CONTENT);

      const handler = handlers.get('read_project_settings')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { content: Array<{ type: string; text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.configVersion).toBe(5);
      expect(parsed.sections.application['config/name']).toBe('"My Game"');
      expect(parsed.sections.autoload['GameManager']).toBe('"*res://scripts/game_manager.gd"');
      expect(parsed.sections.rendering['renderer/rendering_method']).toBe('"forward_plus"');
    });

    it('returns only the requested section when section filter is provided', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(SAMPLE_PROJECT_CONTENT);

      const handler = handlers.get('read_project_settings')!;
      const result = await handler({
        project_path: '/my/project',
        section: 'autoload',
      }) as { content: Array<{ type: string; text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed['GameManager']).toBe('"*res://scripts/game_manager.gd"');
      // Should NOT contain other sections
      expect(parsed['application']).toBeUndefined();
    });

    it('returns toolError for invalid path', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('read_project_settings')!;
      const result = await handler({
        project_path: '/bad/../path',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError for missing project.godot', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('read_project_settings')!;
      const result = await handler({
        project_path: '/not/a/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe('modify_project_setting', () => {
    it('registers the modify_project_setting tool', () => {
      expect(handlers.has('modify_project_setting')).toBe(true);
    });

    it('passes correct params to executeOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '{"success": true, "section": "application", "key": "config/name", "action": "set"}',
        stderr: '',
      });

      const handler = handlers.get('modify_project_setting')!;
      await handler({
        project_path: '/my/project',
        section: 'application',
        key: 'config/name',
        value: '"New Name"',
        action: 'set',
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'modify_project_setting',
        expect.objectContaining({
          section: 'application',
          key: 'config/name',
          value: '"New Name"',
          action: 'set',
        }),
      );
    });

    it('returns toolError for invalid path', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('modify_project_setting')!;
      const result = await handler({
        project_path: '/bad/../path',
        section: 'application',
        key: 'config/name',
        value: '"Test"',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });
});
