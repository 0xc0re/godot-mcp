/**
 * Tests for scaffold MCP tools: scaffold_event_bus.
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
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
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
  runOperation: vi.fn(),
}));

// Mock errors module
vi.mock('../src/errors.js', () => ({
  toolError: vi.fn((message: string, suggestions: string[] = []) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, suggestions }) }],
    isError: true,
  })),
}));

import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { validatePath, runOperation } from '../src/godot.js';
import { toolError } from '../src/errors.js';
import { registerScaffoldTools } from '../src/tools/scaffold.js';

/** Success stub for runOperation with a full OperationResult shape. */
const OP_OK = {
  ok: true as const,
  data: { success: true },
  stdout: '{"success": true}',
  stderr: '',
  exitCode: 0,
};

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

describe('Scaffold MCP Tools', () => {
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
    registerScaffoldTools(server, ctx);
  });

  // ── scaffold_event_bus ──────────────────────────────────────────────

  describe('scaffold_event_bus', () => {
    it('registers the scaffold_event_bus tool', () => {
      expect(handlers.has('scaffold_event_bus')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('scaffold_event_bus')!;
      const result = await handler({
        project_path: '/bad/../path',
        script_path: 'scripts/event_bus.gd',
        signals: [{ name: 'player_died', params: [] }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('scaffold_event_bus')!;
      const result = await handler({
        project_path: '/not/a/project',
        script_path: 'scripts/event_bus.gd',
        signals: [{ name: 'player_died', params: [] }],
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('generates correct GDScript for signals without params', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        // project.godot exists; the scaffold target does not (fresh write)
        if (String(p).endsWith('project.godot')) return true;
        return false;
      });

      const handler = handlers.get('scaffold_event_bus')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/event_bus.gd',
        signals: [{ name: 'player_died', params: [] }],
      });

      expect(writeFileSync).toHaveBeenCalledTimes(1);
      const writtenContent = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(writtenContent).toContain('signal player_died');
      // Should NOT contain parentheses for parameterless signals
      expect(writtenContent).not.toContain('signal player_died(');
    });

    it('generates correct GDScript for signals with typed params', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        // project.godot exists; the scaffold target does not (fresh write)
        if (String(p).endsWith('project.godot')) return true;
        return false;
      });

      const handler = handlers.get('scaffold_event_bus')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/event_bus.gd',
        signals: [{ name: 'score_updated', params: [{ name: 'score', type: 'int' }] }],
      });

      expect(writeFileSync).toHaveBeenCalledTimes(1);
      const writtenContent = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(writtenContent).toContain('signal score_updated(score: int)');
    });

    it('creates parent directories when they do not exist', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const path = String(p);
        if (path.endsWith('project.godot')) return true;
        // Parent directory does not exist
        return false;
      });

      const handler = handlers.get('scaffold_event_bus')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/autoloads/event_bus.gd',
        signals: [{ name: 'player_died', params: [] }],
      });

      expect(mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true },
      );
    });

    it('does NOT register autoload when register_autoload is false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        // project.godot exists; the scaffold target does not (fresh write)
        if (String(p).endsWith('project.godot')) return true;
        return false;
      });

      const handler = handlers.get('scaffold_event_bus')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/event_bus.gd',
        signals: [{ name: 'player_died', params: [] }],
        register_autoload: false,
      });

      expect(runOperation).not.toHaveBeenCalled();
    });

    it('registers autoload when register_autoload is true', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        // project.godot exists; the scaffold target does not (fresh write)
        if (String(p).endsWith('project.godot')) return true;
        return false;
      });
      vi.mocked(runOperation).mockResolvedValue(OP_OK);

      const handler = handlers.get('scaffold_event_bus')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/event_bus.gd',
        signals: [{ name: 'player_died', params: [] }],
        register_autoload: true,
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'modify_project_setting',
        expect.objectContaining({
          section: 'autoload',
          value: expect.stringMatching(/^\*res:\/\//),
        }),
      );
    });

    it('derives PascalCase autoload name from filename', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        // project.godot exists; the scaffold target does not (fresh write)
        if (String(p).endsWith('project.godot')) return true;
        return false;
      });
      vi.mocked(runOperation).mockResolvedValue(OP_OK);

      const handler = handlers.get('scaffold_event_bus')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/autoloads/event_bus.gd',
        signals: [{ name: 'player_died', params: [] }],
        register_autoload: true,
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'modify_project_setting',
        expect.objectContaining({
          key: 'EventBus',
        }),
      );
    });

    it('uses provided autoload_name when given', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        // project.godot exists; the scaffold target does not (fresh write)
        if (String(p).endsWith('project.godot')) return true;
        return false;
      });
      vi.mocked(runOperation).mockResolvedValue(OP_OK);

      const handler = handlers.get('scaffold_event_bus')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/autoloads/event_bus.gd',
        signals: [{ name: 'player_died', params: [] }],
        register_autoload: true,
        autoload_name: 'MyCustomBus',
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'modify_project_setting',
        expect.objectContaining({
          key: 'MyCustomBus',
        }),
      );
    });

    it('returns toolError when autoload registration yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      // project.godot exists; the scaffold target does not (fresh write)
      vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('project.godot'));
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Failed to save project.godot: error code 7',
        stdout: '{"success": false, "error": "Failed to save project.godot: error code 7"}',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('scaffold_event_bus')!;
      const result = await handler({
        project_path: '/my/project',
        script_path: 'scripts/event_bus.gd',
        signals: [{ name: 'player_died', params: [] }],
        register_autoload: true,
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save project.godot: error code 7'),
        expect.any(Array),
      );
    });

    it('returns success JSON with signal count', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        // project.godot exists; the scaffold target does not (fresh write)
        if (String(p).endsWith('project.godot')) return true;
        return false;
      });

      const handler = handlers.get('scaffold_event_bus')!;
      const result = await handler({
        project_path: '/my/project',
        script_path: 'scripts/event_bus.gd',
        signals: [
          { name: 'player_died', params: [] },
          { name: 'score_updated', params: [{ name: 'score', type: 'int' }] },
        ],
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.signal_count).toBe(2);
    });
  });

  // ── scaffold_config_manager ─────────────────────────────────────────

  describe('scaffold_config_manager', () => {
    it('registers the scaffold_config_manager tool', () => {
      expect(handlers.has('scaffold_config_manager')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);
      const handler = handlers.get('scaffold_config_manager')!;
      const result = await handler({
        project_path: '/bad/../path',
        script_path: 'scripts/score_manager.gd',
        save_path: 'user://scores.cfg',
        sections: [{ name: 'scores', fields: [{ name: 'best', type: 'int', default: '0' }] }],
      }) as { isError?: boolean };
      expect(result.isError).toBe(true);
    });

    it('generates ConfigFile load/save with typed vars and setters', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      // project.godot exists; the scaffold target does not (fresh write)
      vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('project.godot'));
      const handler = handlers.get('scaffold_config_manager')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/settings_manager.gd',
        save_path: 'user://settings.cfg',
        sections: [
          { name: 'audio', fields: [
            { name: 'sfx_enabled', type: 'bool', default: 'true' },
            { name: 'music_enabled', type: 'bool', default: 'false' },
          ]},
        ],
      });

      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain('const SAVE_PATH := "user://settings.cfg"');
      expect(written).toContain('var sfx_enabled: bool = true');
      expect(written).toContain('var music_enabled: bool = false');
      expect(written).toContain('func set_sfx_enabled(value: bool)');
      expect(written).toContain('func load_data()');
      expect(written).toContain('func save_data()');
      expect(written).toContain('config.get_value("audio", "sfx_enabled", true)');
      expect(written).toContain('config.set_value("audio", "sfx_enabled", sfx_enabled)');
    });

    it('supports multiple sections', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      // project.godot exists; the scaffold target does not (fresh write)
      vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('project.godot'));
      const handler = handlers.get('scaffold_config_manager')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/settings.gd',
        save_path: 'user://settings.cfg',
        sections: [
          { name: 'audio', fields: [{ name: 'volume', type: 'float', default: '1.0' }] },
          { name: 'display', fields: [{ name: 'fullscreen', type: 'bool', default: 'false' }] },
        ],
      });

      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain('config.get_value("audio", "volume", 1.0)');
      expect(written).toContain('config.get_value("display", "fullscreen", false)');
    });

    it('registers autoload when requested', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      // project.godot exists; the scaffold target does not (fresh write)
      vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('project.godot'));
      vi.mocked(runOperation).mockResolvedValue(OP_OK);
      const handler = handlers.get('scaffold_config_manager')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/autoloads/score_manager.gd',
        save_path: 'user://scores.cfg',
        sections: [{ name: 'scores', fields: [{ name: 'best', type: 'int', default: '0' }] }],
        register_autoload: true,
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx, '/my/project', 'modify_project_setting',
        expect.objectContaining({ section: 'autoload', key: 'ScoreManager' }),
      );
    });

    it('returns toolError when autoload registration yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      // project.godot exists; the scaffold target does not (fresh write)
      vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('project.godot'));
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Failed to load project.godot: error code 12',
        stdout: '{"success": false, "error": "Failed to load project.godot: error code 12"}',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('scaffold_config_manager')!;
      const result = await handler({
        project_path: '/my/project',
        script_path: 'scripts/autoloads/score_manager.gd',
        save_path: 'user://scores.cfg',
        sections: [{ name: 'scores', fields: [{ name: 'best', type: 'int', default: '0' }] }],
        register_autoload: true,
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load project.godot: error code 12'),
        expect.any(Array),
      );
    });
  });

  // ── scaffold_resource_class ─────────────────────────────────────────

  describe('scaffold_resource_class', () => {
    it('registers the scaffold_resource_class tool', () => {
      expect(handlers.has('scaffold_resource_class')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);
      const handler = handlers.get('scaffold_resource_class')!;
      const result = await handler({
        project_path: '/bad/../path',
        script_path: 'scripts/avatar_data.gd',
        class_name: 'AvatarData',
        fields: [{ name: 'id', type: 'String' }],
      }) as { isError?: boolean };
      expect(result.isError).toBe(true);
    });

    it('generates class_name Resource with @export fields', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      // project.godot exists; the scaffold target does not (fresh write)
      vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('project.godot'));
      const handler = handlers.get('scaffold_resource_class')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/avatar_data.gd',
        class_name: 'AvatarData',
        fields: [
          { name: 'id', type: 'String' },
          { name: 'display_name', type: 'String' },
          { name: 'icon', type: 'Texture2D' },
          { name: 'ability_id', type: 'String', default: '""' },
        ],
      });

      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain('class_name AvatarData');
      expect(written).toContain('extends Resource');
      expect(written).toContain('@export var id: String');
      expect(written).toContain('@export var display_name: String');
      expect(written).toContain('@export var ability_id: String = ""');
    });

    it('returns success JSON with field count', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      // project.godot exists; the scaffold target does not (fresh write)
      vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('project.godot'));
      const handler = handlers.get('scaffold_resource_class')!;
      const result = await handler({
        project_path: '/my/project',
        script_path: 'scripts/data.gd',
        class_name: 'MyData',
        fields: [{ name: 'a', type: 'int' }, { name: 'b', type: 'float' }],
      }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.field_count).toBe(2);
      expect(parsed.class_name).toBe('MyData');
    });
  });

  // ── scaffold_tests ──────────────────────────────────────────────────

  describe('scaffold_tests', () => {
    it('registers the scaffold_tests tool', () => {
      expect(handlers.has('scaffold_tests')).toBe(true);
    });

    it('returns toolError when source script does not exist', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p) => {
        if (String(p).endsWith('project.godot')) return true;
        return false;
      });
      const handler = handlers.get('scaffold_tests')!;
      const result = await handler({
        project_path: '/my/project',
        script_path: 'scripts/missing.gd',
      }) as { isError?: boolean };
      expect(result.isError).toBe(true);
    });

    it('generates test stubs for public methods', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      // project.godot and the source script exist; the target test file does not
      vi.mocked(existsSync).mockImplementation((p) => !String(p).includes('/tests/'));
      vi.mocked(readFileSync).mockReturnValue(
        'extends Node\n\nfunc check_best_score(score: int) -> void:\n\tpass\n\nfunc reset() -> void:\n\tpass\n\nfunc _private_method() -> void:\n\tpass\n',
      );

      const handler = handlers.get('scaffold_tests')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/score_manager.gd',
      });

      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain('extends GutTest');
      expect(written).toContain('func test_check_best_score()');
      expect(written).toContain('func test_reset()');
      expect(written).not.toContain('test__private_method');
    });

    it('generates signal assertions', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      // project.godot and the source script exist; the target test file does not
      vi.mocked(existsSync).mockImplementation((p) => !String(p).includes('/tests/'));
      vi.mocked(readFileSync).mockReturnValue(
        'extends Node\n\nsignal player_died\nsignal score_updated(score: int)\n\nfunc do_thing() -> void:\n\tpass\n',
      );

      const handler = handlers.get('scaffold_tests')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/game_manager.gd',
      });

      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain('test_has_signal_player_died');
      expect(written).toContain('test_has_signal_score_updated');
      expect(written).toContain('has_signal("player_died")');
    });

    it('defaults test_path to tests/test_<filename>.gd', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      // project.godot and the source script exist; the target test file does not
      vi.mocked(existsSync).mockImplementation((p) => !String(p).includes('/tests/'));
      vi.mocked(readFileSync).mockReturnValue('extends Node\nfunc do_thing() -> void:\n\tpass\n');

      const handler = handlers.get('scaffold_tests')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/autoloads/event_bus.gd',
      });

      const writePath = vi.mocked(writeFileSync).mock.calls[0][0] as string;
      expect(writePath).toContain('tests/test_event_bus.gd');
    });
  });

  // ── scaffold_health_component ───────────────────────────────────────

  describe('scaffold_health_component', () => {
    it('registers the scaffold_health_component tool', () => {
      expect(handlers.has('scaffold_health_component')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);
      const handler = handlers.get('scaffold_health_component')!;
      const result = await handler({
        project_path: '/bad/../path',
        script_path: 'scripts/health.gd',
      }) as { isError?: boolean };
      expect(result.isError).toBe(true);
    });

    it('generates health component with signals and methods', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      // project.godot exists; the scaffold target does not (fresh write)
      vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('project.godot'));
      const handler = handlers.get('scaffold_health_component')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/components/health_component.gd',
      });

      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain('signal health_changed(current: int, maximum: int)');
      expect(written).toContain('signal damage_taken(amount: int)');
      expect(written).toContain('signal healed(amount: int)');
      expect(written).toContain('signal died');
      expect(written).toContain('func take_damage(amount: int)');
      expect(written).toContain('func heal(amount: int)');
      expect(written).toContain('@export var max_health: int = 100');
      expect(written).toContain('is_invincible');
    });

    it('uses custom max_health and invincibility_duration', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      // project.godot exists; the scaffold target does not (fresh write)
      vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('project.godot'));
      const handler = handlers.get('scaffold_health_component')!;
      await handler({
        project_path: '/my/project',
        script_path: 'scripts/health.gd',
        max_health: 50,
        invincibility_duration: 0.5,
      });

      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain('@export var max_health: int = 50');
      expect(written).toContain('@export var invincibility_duration: float = 0.5');
    });
  });

  // ── overwrite flag (default false: refuse to clobber) ───────────────

  describe('overwrite flag', () => {
    beforeEach(() => {
      vi.mocked(validatePath).mockReturnValue(true);
    });

    it('scaffold_event_bus refuses to overwrite an existing target by default', async () => {
      // project.godot AND the target file exist
      vi.mocked(existsSync).mockReturnValue(true);

      const handler = handlers.get('scaffold_event_bus')!;
      const result = await handler({
        project_path: '/my/project',
        script_path: 'scripts/event_bus.gd',
        signals: [{ name: 'player_died', params: [] }],
      }) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('scripts/event_bus.gd');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('scaffold_event_bus overwrites when overwrite: true', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const handler = handlers.get('scaffold_event_bus')!;
      const result = await handler({
        project_path: '/my/project',
        script_path: 'scripts/event_bus.gd',
        signals: [{ name: 'player_died', params: [] }],
        overwrite: true,
      }) as { isError?: boolean };

      expect(result.isError).toBeUndefined();
      expect(writeFileSync).toHaveBeenCalledTimes(1);
    });

    it('scaffold_config_manager refuses to overwrite by default', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const handler = handlers.get('scaffold_config_manager')!;
      const result = await handler({
        project_path: '/my/project',
        script_path: 'scripts/settings.gd',
        save_path: 'user://settings.cfg',
        sections: [{ name: 'audio', fields: [{ name: 'volume', type: 'float', default: '1.0' }] }],
      }) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toContain('scripts/settings.gd');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('scaffold_resource_class refuses to overwrite by default', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const handler = handlers.get('scaffold_resource_class')!;
      const result = await handler({
        project_path: '/my/project',
        script_path: 'scripts/data.gd',
        class_name: 'MyData',
        fields: [{ name: 'a', type: 'int' }],
      }) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toContain('scripts/data.gd');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('scaffold_tests refuses to overwrite an existing test file by default', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('extends Node\nfunc do_thing() -> void:\n\tpass\n');

      const handler = handlers.get('scaffold_tests')!;
      const result = await handler({
        project_path: '/my/project',
        script_path: 'scripts/event_bus.gd',
      }) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toContain('tests/test_event_bus.gd');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('scaffold_health_component refuses to overwrite by default', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const handler = handlers.get('scaffold_health_component')!;
      const result = await handler({
        project_path: '/my/project',
        script_path: 'scripts/health.gd',
      }) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toContain('scripts/health.gd');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('scaffold_health_component overwrites when overwrite: true', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const handler = handlers.get('scaffold_health_component')!;
      const result = await handler({
        project_path: '/my/project',
        script_path: 'scripts/health.gd',
        overwrite: true,
      }) as { isError?: boolean };

      expect(result.isError).toBeUndefined();
      expect(writeFileSync).toHaveBeenCalledTimes(1);
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

    it('scaffold_event_bus rejects script_path traversal before writing', async () => {
      await expectPathRejected('scaffold_event_bus', { project_path: '/proj', script_path: '../../evil.gd', signals: [{ name: 'ping', params: [] }] }, 'script_path');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('scaffold_config_manager rejects script_path traversal before writing', async () => {
      await expectPathRejected('scaffold_config_manager', { project_path: '/proj', script_path: '../../evil.gd', save_path: 'user://settings.cfg', sections: [{ name: 'audio', fields: [{ name: 'volume', type: 'float', default: '1.0' }] }] }, 'script_path');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('scaffold_resource_class rejects script_path traversal before writing', async () => {
      await expectPathRejected('scaffold_resource_class', { project_path: '/proj', script_path: '../../evil.gd', class_name: 'AvatarData', fields: [{ name: 'hp', type: 'int' }] }, 'script_path');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('scaffold_tests rejects script_path traversal before reading the source', async () => {
      await expectPathRejected('scaffold_tests', { project_path: '/proj', script_path: '../../evil.gd' }, 'script_path');
      expect(readFileSync).not.toHaveBeenCalled();
    });

    it('scaffold_tests rejects test_path traversal before writing', async () => {
      vi.mocked(readFileSync).mockReturnValue('func foo():\n\tpass\n');
      await expectPathRejected('scaffold_tests', { project_path: '/proj', script_path: 'scripts/a.gd', test_path: '../../evil_test.gd' }, 'test_path');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('scaffold_health_component rejects script_path traversal before writing', async () => {
      await expectPathRejected('scaffold_health_component', { project_path: '/proj', script_path: '../../evil.gd' }, 'script_path');
      expect(writeFileSync).not.toHaveBeenCalled();
    });
  });
});
