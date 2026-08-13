/**
 * Tests for export MCP tools: export_project, list_export_presets.
 *
 * Uses vi.mock() to isolate tool logic from filesystem and Godot process.
 * NOTE: Export tools use execGodot directly (not runOperation) since
 * export is a CLI operation, not a godot_operations.gd dispatch.
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

// Mock godot module — export tools use execGodot directly, NOT runOperation
// (runOperation is stubbed for factory completeness; the --export-release
// bespoke path never calls it)
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
  execGodot: vi.fn(),
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

    it('returns toolError when stderr contains "ERROR" even if stdout is clean', async () => {
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
        stdout: 'Export complete',
        stderr: 'ERROR: something went wrong with resources',
      });

      const handler = handlers.get('export_project')!;
      const result = await handler({
        project_path: '/my/project',
        preset_name: 'Web',
        output_path: 'build/web/index.html',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when stderr contains "Cannot open file"', async () => {
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
        stdout: '',
        stderr: 'Cannot open file: res://missing_resource.png',
      });

      const handler = handlers.get('export_project')!;
      const result = await handler({
        project_path: '/my/project',
        preset_name: 'Web',
        output_path: 'build/web/index.html',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when stderr contains "Failed to"', async () => {
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
        stdout: '',
        stderr: 'Failed to load resource',
      });

      const handler = handlers.get('export_project')!;
      const result = await handler({
        project_path: '/my/project',
        preset_name: 'Web',
        output_path: 'build/web/index.html',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns success when both stdout and stderr are clean', async () => {
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
        stdout: 'Export successful',
        stderr: 'Godot Engine v4.3.stable - https://godotengine.org',
      });

      const handler = handlers.get('export_project')!;
      const result = await handler({
        project_path: '/my/project',
        preset_name: 'Web',
        output_path: 'build/web/index.html',
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
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

  // ── check_export_readiness ────────────────────────────────────────

  describe('check_export_readiness', () => {
    it('registers the check_export_readiness tool', () => {
      expect(handlers.has('check_export_readiness')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('check_export_readiness')!;
      const result = await handler({
        project_path: '/bad/../path',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('check_export_readiness')!;
      const result = await handler({
        project_path: '/not/a/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns pass for gl_compatibility renderer', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p) => {
        if (String(p).endsWith('project.godot')) return true;
        // export_presets.cfg exists
        if (String(p).endsWith('export_presets.cfg')) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          rendering: { 'renderer/rendering_method': 'gl_compatibility' },
          display: { 'window/stretch/mode': '"canvas_items"' },
          'preset.0': { name: '"Web"', platform: '"Web"', runnable: 'true' },
        },
        configVersion: 0,
      });

      const handler = handlers.get('check_export_readiness')!;
      const result = await handler({
        project_path: '/my/project',
        platform: 'web',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      const rendererCheck = parsed.checks.find((c: { check: string }) => c.check === 'Renderer');
      expect(rendererCheck).toBeDefined();
      expect(rendererCheck.status).toBe('pass');
      expect(rendererCheck.detail).toContain('gl_compatibility');
    });

    it('returns warn for forward_plus renderer', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p) => {
        if (String(p).endsWith('project.godot')) return true;
        if (String(p).endsWith('export_presets.cfg')) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          rendering: { 'renderer/rendering_method': 'forward_plus' },
          display: { 'window/stretch/mode': '"canvas_items"' },
          'preset.0': { name: '"Android"', platform: '"Android"', runnable: 'true' },
        },
        configVersion: 0,
      });

      const handler = handlers.get('check_export_readiness')!;
      const result = await handler({
        project_path: '/my/project',
        platform: 'android',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      const rendererCheck = parsed.checks.find((c: { check: string }) => c.check === 'Renderer');
      expect(rendererCheck).toBeDefined();
      expect(rendererCheck.status).toBe('warn');
      expect(rendererCheck.detail).toContain('forward_plus');
    });

    it('returns fail for missing ETC2/ASTC compression on android', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p) => {
        if (String(p).endsWith('project.godot')) return true;
        if (String(p).endsWith('export_presets.cfg')) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          rendering: { 'renderer/rendering_method': 'gl_compatibility' },
          display: {
            'window/handheld/orientation': '"portrait"',
            'window/stretch/mode': '"canvas_items"',
          },
          'preset.0': { name: '"Android"', platform: '"Android"', runnable: 'true' },
        },
        configVersion: 0,
      });

      const handler = handlers.get('check_export_readiness')!;
      const result = await handler({
        project_path: '/my/project',
        platform: 'android',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      const textureCheck = parsed.checks.find(
        (c: { check: string }) => c.check === 'Texture compression (ETC2/ASTC)',
      );
      expect(textureCheck).toBeDefined();
      expect(textureCheck.status).toBe('fail');
      expect(textureCheck.detail).toContain('ETC2/ASTC compression required');
    });

    it('returns pass for portrait orientation on android', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p) => {
        if (String(p).endsWith('project.godot')) return true;
        if (String(p).endsWith('export_presets.cfg')) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          rendering: {
            'renderer/rendering_method': 'gl_compatibility',
            'textures/vram_compression/import_etc2_astc': 'true',
          },
          display: {
            'window/handheld/orientation': '"portrait"',
            'window/stretch/mode': '"canvas_items"',
          },
          'preset.0': { name: '"Android"', platform: '"Android"', runnable: 'true' },
        },
        configVersion: 0,
      });

      const handler = handlers.get('check_export_readiness')!;
      const result = await handler({
        project_path: '/my/project',
        platform: 'android',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      const orientationCheck = parsed.checks.find(
        (c: { check: string }) => c.check === 'Display orientation',
      );
      expect(orientationCheck).toBeDefined();
      expect(orientationCheck.status).toBe('pass');
      expect(orientationCheck.detail).toContain('portrait');
    });

    it('returns warn when no orientation set', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p) => {
        if (String(p).endsWith('project.godot')) return true;
        if (String(p).endsWith('export_presets.cfg')) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          rendering: {
            'renderer/rendering_method': 'gl_compatibility',
            'textures/vram_compression/import_etc2_astc': 'true',
          },
          display: {
            'window/stretch/mode': '"canvas_items"',
          },
          'preset.0': { name: '"Android"', platform: '"Android"', runnable: 'true' },
        },
        configVersion: 0,
      });

      const handler = handlers.get('check_export_readiness')!;
      const result = await handler({
        project_path: '/my/project',
        platform: 'android',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      const orientationCheck = parsed.checks.find(
        (c: { check: string }) => c.check === 'Display orientation',
      );
      expect(orientationCheck).toBeDefined();
      expect(orientationCheck.status).toBe('warn');
      expect(orientationCheck.detail).toContain('No orientation set');
    });

    it('returns pass for canvas_items stretch mode', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p) => {
        if (String(p).endsWith('project.godot')) return true;
        if (String(p).endsWith('export_presets.cfg')) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          rendering: { 'renderer/rendering_method': 'gl_compatibility' },
          display: { 'window/stretch/mode': '"canvas_items"' },
          'preset.0': { name: '"Web"', platform: '"Web"', runnable: 'true' },
        },
        configVersion: 0,
      });

      const handler = handlers.get('check_export_readiness')!;
      const result = await handler({
        project_path: '/my/project',
        platform: 'web',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      const stretchCheck = parsed.checks.find(
        (c: { check: string }) => c.check === 'Stretch mode',
      );
      expect(stretchCheck).toBeDefined();
      expect(stretchCheck.status).toBe('pass');
      expect(stretchCheck.detail).toContain('canvas_items');
    });

    it('returns fail when no export presets exist', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p) => {
        if (String(p).endsWith('project.godot')) return true;
        // export_presets.cfg does NOT exist
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          rendering: { 'renderer/rendering_method': 'gl_compatibility' },
          display: { 'window/stretch/mode': '"canvas_items"' },
        },
        configVersion: 0,
      });

      const handler = handlers.get('check_export_readiness')!;
      const result = await handler({
        project_path: '/my/project',
        platform: 'web',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      const presetCheck = parsed.checks.find(
        (c: { check: string }) => c.check === 'Export presets',
      );
      expect(presetCheck).toBeDefined();
      expect(presetCheck.status).toBe('fail');
      expect(presetCheck.detail).toContain('No export presets found');
    });

    it('returns the audio format warning tip', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p) => {
        if (String(p).endsWith('project.godot')) return true;
        if (String(p).endsWith('export_presets.cfg')) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          rendering: { 'renderer/rendering_method': 'gl_compatibility' },
          display: { 'window/stretch/mode': '"canvas_items"' },
          'preset.0': { name: '"Web"', platform: '"Web"', runnable: 'true' },
        },
        configVersion: 0,
      });

      const handler = handlers.get('check_export_readiness')!;
      const result = await handler({
        project_path: '/my/project',
        platform: 'web',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      const audioCheck = parsed.checks.find(
        (c: { check: string }) => c.check === 'Audio format',
      );
      expect(audioCheck).toBeDefined();
      expect(audioCheck.status).toBe('warn');
      expect(audioCheck.detail).toContain('OGG Vorbis');
      expect(audioCheck.detail).toContain('never MP3');
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

    it('export_project rejects output_path traversal outside the project', async () => {
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          'preset.0': { name: '"Web"', platform: '"Web"', runnable: 'true' },
        },
        configVersion: 0,
      });
      await expectPathRejected('export_project', { project_path: '/proj', preset_name: 'Web', output_path: '../../escape/index.html' }, 'output_path');
      expect(execGodot).not.toHaveBeenCalled();
    });
  });
});
