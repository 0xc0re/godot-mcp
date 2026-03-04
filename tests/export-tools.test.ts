/**
 * Tests for export MCP tools: export_project, list_export_presets.
 *
 * Uses vi.mock() to isolate tool logic from filesystem and Godot process.
 * NOTE: Export tools use execGodot directly (not executeOperation) since
 * export is a CLI operation, not a GDScript dispatch.
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

// Mock godot module — export tools use execGodot directly, NOT executeOperation
vi.mock('../src/godot.js', () => ({
  validatePath: vi.fn(),
  execGodot: vi.fn(),
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
import { validatePath, execGodot } from '../src/godot.js';
import { parseProjectSettings } from '../src/parsers/project-parser.js';
import { registerExportTools } from '../src/tools/export.js';

// Sample export_presets.cfg fixture content
const SAMPLE_EXPORT_PRESETS = `[preset.0]

name="Web"
platform="Web"
runnable=true
dedicated_server=false
export_filter="all_resources"
export_path="build/web/index.html"

[preset.0.options]

html/export_icon=true

[preset.1]

name="Linux"
platform="Linux"
runnable=true
dedicated_server=false
export_filter="all_resources"
export_path="build/linux/game.x86_64"

[preset.1.options]

binary_format/embed_pck=true
`;

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

describe('Export MCP Tools', () => {
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
    registerExportTools(server, ctx);
  });

  // ── export_project ──────────────────────────────────────────────────

  describe('export_project', () => {
    it('registers the export_project tool', () => {
      expect(handlers.has('export_project')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('export_project')!;
      const result = await handler({
        project_path: '/bad/../path',
        preset_name: 'Web',
        output_path: 'build/web/index.html',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('export_project')!;
      const result = await handler({
        project_path: '/not/a/project',
        preset_name: 'Web',
        output_path: 'build/web/index.html',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when export_presets.cfg missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p) => {
        // project.godot exists, export_presets.cfg does not
        if (String(p).endsWith('project.godot')) return true;
        return false;
      });

      const handler = handlers.get('export_project')!;
      const result = await handler({
        project_path: '/my/project',
        preset_name: 'Web',
        output_path: 'build/web/index.html',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when preset_name not found in export_presets.cfg', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(SAMPLE_EXPORT_PRESETS);
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          'preset.0': { name: '"Web"', platform: '"Web"', runnable: 'true' },
          'preset.0.options': { 'html/export_icon': 'true' },
          'preset.1': { name: '"Linux"', platform: '"Linux"', runnable: 'true' },
          'preset.1.options': { 'binary_format/embed_pck': 'true' },
        },
        configVersion: 0,
      });

      const handler = handlers.get('export_project')!;
      const result = await handler({
        project_path: '/my/project',
        preset_name: 'Windows',
        output_path: 'build/win/game.exe',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('calls execGodot with correct args and 180s timeout for release mode', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(SAMPLE_EXPORT_PRESETS);
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          'preset.0': { name: '"Web"', platform: '"Web"', runnable: 'true' },
          'preset.0.options': { 'html/export_icon': 'true' },
          'preset.1': { name: '"Linux"', platform: '"Linux"', runnable: 'true' },
          'preset.1.options': { 'binary_format/embed_pck': 'true' },
        },
        configVersion: 0,
      });
      vi.mocked(execGodot).mockResolvedValue({ stdout: '', stderr: '' });

      const handler = handlers.get('export_project')!;
      await handler({
        project_path: '/my/project',
        preset_name: 'Web',
        output_path: 'build/web/index.html',
      });

      expect(execGodot).toHaveBeenCalledWith(
        '/usr/bin/godot',
        ['--headless', '--path', '/my/project', '--export-release', 'Web', '/my/project/build/web/index.html'],
        { timeout: 180_000 },
      );
    });

    it('uses --export-debug when mode is debug', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(SAMPLE_EXPORT_PRESETS);
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          'preset.0': { name: '"Web"', platform: '"Web"', runnable: 'true' },
          'preset.0.options': {},
          'preset.1': { name: '"Linux"', platform: '"Linux"', runnable: 'true' },
          'preset.1.options': {},
        },
        configVersion: 0,
      });
      vi.mocked(execGodot).mockResolvedValue({ stdout: '', stderr: '' });

      const handler = handlers.get('export_project')!;
      await handler({
        project_path: '/my/project',
        preset_name: 'Linux',
        output_path: 'build/linux/game.x86_64',
        mode: 'debug',
      });

      expect(execGodot).toHaveBeenCalledWith(
        '/usr/bin/godot',
        ['--headless', '--path', '/my/project', '--export-debug', 'Linux', '/my/project/build/linux/game.x86_64'],
        { timeout: 180_000 },
      );
    });

    it('returns toolError when stdout contains "No export template found"', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(SAMPLE_EXPORT_PRESETS);
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          'preset.0': { name: '"Web"', platform: '"Web"', runnable: 'true' },
          'preset.0.options': {},
        },
        configVersion: 0,
      });
      vi.mocked(execGodot).mockResolvedValue({
        stdout: 'No export template found at expected path',
        stderr: '',
      });

      const handler = handlers.get('export_project')!;
      const result = await handler({
        project_path: '/my/project',
        preset_name: 'Web',
        output_path: 'build/web/index.html',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when stdout contains "Preset not found"', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(SAMPLE_EXPORT_PRESETS);
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          'preset.0': { name: '"Web"', platform: '"Web"', runnable: 'true' },
          'preset.0.options': {},
        },
        configVersion: 0,
      });
      vi.mocked(execGodot).mockResolvedValue({
        stdout: 'Preset not found: Web',
        stderr: '',
      });

      const handler = handlers.get('export_project')!;
      const result = await handler({
        project_path: '/my/project',
        preset_name: 'Web',
        output_path: 'build/web/index.html',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when stdout contains "Failed to"', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(SAMPLE_EXPORT_PRESETS);
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          'preset.0': { name: '"Web"', platform: '"Web"', runnable: 'true' },
          'preset.0.options': {},
        },
        configVersion: 0,
      });
      vi.mocked(execGodot).mockResolvedValue({
        stdout: 'Failed to export project',
        stderr: '',
      });

      const handler = handlers.get('export_project')!;
      const result = await handler({
        project_path: '/my/project',
        preset_name: 'Web',
        output_path: 'build/web/index.html',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns success JSON with output_path on success', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(SAMPLE_EXPORT_PRESETS);
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          'preset.0': { name: '"Web"', platform: '"Web"', runnable: 'true' },
          'preset.0.options': {},
        },
        configVersion: 0,
      });
      vi.mocked(execGodot).mockResolvedValue({ stdout: 'Export complete', stderr: '' });

      const handler = handlers.get('export_project')!;
      const result = await handler({
        project_path: '/my/project',
        preset_name: 'Web',
        output_path: 'build/web/index.html',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.preset).toBe('Web');
      expect(parsed.output_path).toBe('build/web/index.html');
      expect(parsed.mode).toBe('release');
    });

    it('returns toolError on execGodot exception', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(SAMPLE_EXPORT_PRESETS);
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          'preset.0': { name: '"Web"', platform: '"Web"', runnable: 'true' },
          'preset.0.options': {},
        },
        configVersion: 0,
      });
      vi.mocked(execGodot).mockRejectedValue(new Error('Godot process timed out'));

      const handler = handlers.get('export_project')!;
      const result = await handler({
        project_path: '/my/project',
        preset_name: 'Web',
        output_path: 'build/web/index.html',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  // ── list_export_presets ─────────────────────────────────────────────

  describe('list_export_presets', () => {
    it('registers the list_export_presets tool', () => {
      expect(handlers.has('list_export_presets')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('list_export_presets')!;
      const result = await handler({
        project_path: '/bad/../path',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when export_presets.cfg missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p) => {
        if (String(p).endsWith('project.godot')) return true;
        return false;
      });

      const handler = handlers.get('list_export_presets')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('reads and parses export_presets.cfg with parseProjectSettings', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(SAMPLE_EXPORT_PRESETS);
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          'preset.0': { name: '"Web"', platform: '"Web"', runnable: 'true' },
          'preset.0.options': { 'html/export_icon': 'true' },
          'preset.1': { name: '"Linux"', platform: '"Linux"', runnable: 'true' },
          'preset.1.options': { 'binary_format/embed_pck': 'true' },
        },
        configVersion: 0,
      });

      const handler = handlers.get('list_export_presets')!;
      await handler({ project_path: '/my/project' });

      expect(readFileSync).toHaveBeenCalled();
      expect(parseProjectSettings).toHaveBeenCalled();
    });

    it('extracts preset names with quotes stripped, platforms, and runnable status', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(SAMPLE_EXPORT_PRESETS);
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          'preset.0': { name: '"Web"', platform: '"Web"', runnable: 'true' },
          'preset.0.options': { 'html/export_icon': 'true' },
          'preset.1': { name: '"Linux"', platform: '"Linux"', runnable: 'true' },
          'preset.1.options': { 'binary_format/embed_pck': 'true' },
        },
        configVersion: 0,
      });

      const handler = handlers.get('list_export_presets')!;
      const result = await handler({ project_path: '/my/project' }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.presets).toHaveLength(2);
      // Quotes should be stripped from name and platform
      expect(parsed.presets[0].name).toBe('Web');
      expect(parsed.presets[0].platform).toBe('Web');
      expect(parsed.presets[0].runnable).toBe(true);
      expect(parsed.presets[1].name).toBe('Linux');
      expect(parsed.presets[1].platform).toBe('Linux');
      expect(parsed.presets[1].runnable).toBe(true);
    });

    it('returns empty array when no presets exist', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {},
        configVersion: 0,
      });

      const handler = handlers.get('list_export_presets')!;
      const result = await handler({ project_path: '/my/project' }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.presets).toEqual([]);
    });

    it('returns toolError on readFileSync exception', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const handler = handlers.get('list_export_presets')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });
});
