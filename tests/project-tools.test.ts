/**
 * Tests for project MCP tools: get_godot_version, list_projects,
 * get_project_info, read_project_settings, modify_project_setting.
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
    readdirSync: vi.fn(),
  };
});

// Mock godot module
vi.mock('../src/godot.js', () => ({
  validatePath: vi.fn(),
  runOperation: vi.fn(),
  execGodot: vi.fn(),
}));

// Mock errors module
vi.mock('../src/errors.js', () => ({
  toolError: vi.fn((message: string, suggestions: string[] = []) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, suggestions }) }],
    isError: true,
  })),
}));

import { existsSync, readFileSync, readdirSync } from 'fs';
import { validatePath, runOperation, execGodot } from '../src/godot.js';
import { toolError } from '../src/errors.js';
import { registerProjectTools } from '../src/tools/project.js';

// Helper to extract registered tool handlers from McpServer
function getToolHandlers(server: McpServer): Map<string, (params: Record<string, unknown>) => Promise<unknown>> {
  const handlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();
  const originalRegisterTool = server.registerTool.bind(server);

  server.registerTool = function (name: string, _config: unknown, handler: unknown) {
    handlers.set(name, handler as (params: Record<string, unknown>) => Promise<unknown>);
    return originalRegisterTool(
      name,
      _config as Parameters<typeof originalRegisterTool>[1],
      handler as Parameters<typeof originalRegisterTool>[2],
    );
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

    it('passes correct params to runOperation and returns the operation data', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, section: 'application', key: 'config/name', action: 'set' },
        stdout: '{"success": true, "section": "application", "key": "config/name", "action": "set"}',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('modify_project_setting')!;
      const result = await handler({
        project_path: '/my/project',
        section: 'application',
        key: 'config/name',
        value: '"New Name"',
        action: 'set',
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(runOperation).toHaveBeenCalledWith(
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
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.section).toBe('application');
      expect(parsed.key).toBe('config/name');
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Missing required parameter: section',
        stdout: '{"success": false, "error": "Missing required parameter: section"}',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('modify_project_setting')!;
      const result = await handler({
        project_path: '/my/project',
        section: 'application',
        key: 'config/name',
        value: '"New Name"',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Missing required parameter: section'),
        expect.any(Array),
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

  // ── get_godot_version ────────────────────────────────────────────────

  describe('get_godot_version', () => {
    it('registers the get_godot_version tool', () => {
      expect(handlers.has('get_godot_version')).toBe(true);
    });

    it('returns the trimmed Godot version from execGodot', async () => {
      vi.mocked(execGodot).mockResolvedValue({ stdout: '4.4.1.stable\n', stderr: '' });

      const handler = handlers.get('get_godot_version')!;
      const result = await handler({}) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };

      expect(execGodot).toHaveBeenCalledWith('/usr/bin/godot', ['--version']);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe('4.4.1.stable');
    });

    it('returns toolError when execGodot rejects', async () => {
      vi.mocked(execGodot).mockRejectedValue(new Error('godot: command not found'));

      const handler = handlers.get('get_godot_version')!;
      const result = await handler({}) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('godot: command not found'),
        expect.any(Array),
      );
    });
  });

  // ── list_projects ────────────────────────────────────────────────────

  describe('list_projects', () => {
    // Minimal fs.Dirent stand-in for readdirSync({ withFileTypes: true })
    function dirent(name: string, isDir: boolean) {
      return { name, isDirectory: () => isDir, isFile: () => !isDir };
    }

    it('registers the list_projects tool', () => {
      expect(handlers.has('list_projects')).toBe(true);
    });

    it('lists direct subdirectories containing project.godot', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const path = String(p);
        if (path === '/games') return true;
        // Only game1 and game2 are Godot projects
        return path === '/games/game1/project.godot' || path === '/games/game2/project.godot';
      });
      vi.mocked(readdirSync).mockImplementation(
        () => [dirent('game1', true), dirent('game2', true), dirent('notes', true), dirent('README.md', false)] as never,
      );

      const handler = handlers.get('list_projects')!;
      const result = await handler({ directory: '/games' }) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };

      expect(result.isError).toBeUndefined();
      const projects = JSON.parse(result.content[0].text);
      expect(projects).toEqual([
        { path: '/games/game1', name: 'game1' },
        { path: '/games/game2', name: 'game2' },
      ]);
    });

    it('includes the directory itself when it is a Godot project', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const path = String(p);
        return path === '/games/game1' || path === '/games/game1/project.godot';
      });
      vi.mocked(readdirSync).mockImplementation(() => [] as never);

      const handler = handlers.get('list_projects')!;
      const result = await handler({ directory: '/games/game1' }) as {
        content: Array<{ text: string }>;
      };

      const projects = JSON.parse(result.content[0].text);
      expect(projects).toEqual([{ path: '/games/game1', name: 'game1' }]);
    });

    it('searches nested directories when recursive is true, skipping dot-dirs', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const path = String(p);
        if (path === '/games') return true;
        return path === '/games/jam/entry/project.godot';
      });
      vi.mocked(readdirSync).mockImplementation((p: unknown) => {
        const path = String(p);
        if (path === '/games') return [dirent('jam', true), dirent('.git', true)] as never;
        if (path === '/games/jam') return [dirent('entry', true)] as never;
        return [] as never;
      });

      const handler = handlers.get('list_projects')!;
      const result = await handler({ directory: '/games', recursive: true }) as {
        content: Array<{ text: string }>;
      };

      const projects = JSON.parse(result.content[0].text);
      expect(projects).toEqual([{ path: '/games/jam/entry', name: 'entry' }]);
      // .git must never be scanned
      expect(readdirSync).not.toHaveBeenCalledWith('/games/.git', expect.anything());
    });

    it('returns toolError when the directory does not exist', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('list_projects')!;
      const result = await handler({ directory: '/missing' }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Directory does not exist'),
        expect.any(Array),
      );
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('list_projects')!;
      const result = await handler({ directory: '/bad/../dir' }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  // ── get_project_info ─────────────────────────────────────────────────

  describe('get_project_info', () => {
    function dirent(name: string, isDir: boolean) {
      return { name, isDirectory: () => isDir, isFile: () => !isDir };
    }

    it('registers the get_project_info tool', () => {
      expect(handlers.has('get_project_info')).toBe(true);
    });

    it('returns name, path, godotVersion, and file-type structure counts', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execGodot).mockResolvedValue({ stdout: '4.4.1.stable\n', stderr: '' });
      vi.mocked(readdirSync).mockImplementation(
        () =>
          [
            dirent('main.tscn', false),
            dirent('level2.tscn', false),
            dirent('player.gd', false),
            dirent('sprite.png', false),
            dirent('project.godot', false),
          ] as never,
      );
      vi.mocked(readFileSync).mockReturnValue(SAMPLE_PROJECT_CONTENT);

      const handler = handlers.get('get_project_info')!;
      const result = await handler({ project_path: '/my/project' }) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };

      expect(result.isError).toBeUndefined();
      const info = JSON.parse(result.content[0].text);
      // config/name="My Game" from project.godot wins over the basename
      expect(info.name).toBe('My Game');
      expect(info.path).toBe('/my/project');
      expect(info.godotVersion).toBe('4.4.1.stable');
      expect(info.structure).toEqual({ scenes: 2, scripts: 1, assets: 1, other: 1 });
    });

    it('falls back to the directory basename when project.godot has no config/name', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execGodot).mockResolvedValue({ stdout: '4.4.1.stable', stderr: '' });
      vi.mocked(readdirSync).mockImplementation(() => [] as never);
      vi.mocked(readFileSync).mockReturnValue('config_version=5\n');

      const handler = handlers.get('get_project_info')!;
      const result = await handler({ project_path: '/my/project' }) as {
        content: Array<{ text: string }>;
      };

      const info = JSON.parse(result.content[0].text);
      expect(info.name).toBe('project');
    });

    it('returns toolError when project.godot is missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('get_project_info')!;
      const result = await handler({ project_path: '/not/a/project' }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Not a valid Godot project'),
        expect.any(Array),
      );
    });

    it('returns toolError when execGodot rejects', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execGodot).mockRejectedValue(new Error('godot crashed'));

      const handler = handlers.get('get_project_info')!;
      const result = await handler({ project_path: '/my/project' }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('godot crashed'),
        expect.any(Array),
      );
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('get_project_info')!;
      const result = await handler({ project_path: '/bad/../path' }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });
});
