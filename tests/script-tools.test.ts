/**
 * Tests for script MCP tools: validate_scripts, list_scripts, query_class.
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
import { registerScriptTools } from '../src/tools/script.js';

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

describe('Script MCP Tools', () => {
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
    registerScriptTools(server, ctx);
  });

  describe('validate_scripts', () => {
    it('registers the validate_scripts tool', () => {
      expect(handlers.has('validate_scripts')).toBe(true);
    });

    it('passes correct params to runOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        stdout: '{"results":[],"total":0,"errors":0,"valid":0}',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('validate_scripts')!;
      await handler({
        project_path: '/my/project',
        path_filter: 'scripts/',
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'validate_scripts',
        expect.objectContaining({
          path_filter: 'scripts/',
        }),
      );
    });

    it('parses JSON stdout result correctly', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        stdout: '{"results":[{"file":"res://player.gd","valid":true},{"file":"res://enemy.gd","valid":false,"error":"Parse error (code: 1)"}],"total":2,"errors":1,"valid":1}',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('validate_scripts')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { content: Array<{ type: string; text: string }> };

      expect(result.content[0].text).toContain('2');
      expect(result.content[0].text).toContain('1 error');
    });

    it('handles mixed Godot output with JSON line among INFO lines', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        stdout: '[INFO] Operation: validate_scripts\n[INFO] Validating scripts in: res://\n{"results":[{"file":"res://main.gd","valid":true}],"total":1,"errors":0,"valid":1}\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('validate_scripts')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { content: Array<{ type: string; text: string }> };

      expect(result.content[0].text).toContain('1');
      expect(result.content[0].text).toContain('0 errors');
    });

    it('returns the per-file summary when ok:false but stdout contains the summary JSON (broken script in project)', async () => {
      // Regression: a broken script makes the Godot engine itself write
      // `ERROR: Failed to load script ...` to stderr even though the op completes
      // with exit 0 and prints its per-file summary. parseOperationOutput flips
      // ok to false on that stderr noise — the tool must still return the summary,
      // because reporting invalid scripts is its primary purpose.
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'ERROR: Failed to load script "res://broken_test.gd" with error "Parse error".',
        stdout: '[INFO] Operation: validate_scripts\n[INFO] Validating scripts in: res://\n{"errors":1,"results":[{"file":"res://broken_test.gd","valid":false,"error":"Parse error (code: 1)"},{"file":"res://main.gd","valid":true}],"total":2,"valid":1}\n',
        stderr: 'ERROR: Failed to load script "res://broken_test.gd" with error "Parse error".',
        exitCode: 0,
      });

      const handler = handlers.get('validate_scripts')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { isError?: boolean; content: Array<{ type: string; text: string }> };

      expect(result.isError).toBeUndefined();
      expect(toolError).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('1 error');
      expect(result.content[0].text).toContain('res://broken_test.gd');
      expect(result.content[0].text).toContain('Parse error');
    });

    it('returns toolError when runOperation yields ok:false and stdout has no summary JSON', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Godot exited with code 1',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('validate_scripts')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Godot exited with code 1'),
        expect.any(Array),
      );
    });

    it('does not mistake a {"success":false} failure envelope for the summary', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Something went wrong',
        stdout: '[INFO] Operation: validate_scripts\n{"success":false,"error":"Something went wrong"}\n',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('validate_scripts')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Something went wrong'),
        expect.any(Array),
      );
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('validate_scripts')!;
      const result = await handler({
        project_path: '/bad/../path',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError for missing project.godot', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('validate_scripts')!;
      const result = await handler({
        project_path: '/not/a/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe('list_scripts', () => {
    it('registers the list_scripts tool', () => {
      expect(handlers.has('list_scripts')).toBe(true);
    });

    it('passes correct params to runOperation with operation "list_scripts"', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        stdout: '{"scripts":[],"total":0}',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('list_scripts')!;
      await handler({
        project_path: '/my/project',
        path_filter: 'scripts/',
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'list_scripts',
        expect.objectContaining({
          path_filter: 'scripts/',
        }),
      );
    });

    it('parses JSON result and returns structured script info', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        stdout: '[INFO] Operation: list_scripts\n{"scripts":[{"path":"res://player.gd","class_name":"Player","methods":[{"name":"move","args":1}],"properties":[{"name":"speed","type":3}],"signals":[{"name":"died","args":0}]}],"total":1}',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('list_scripts')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { content: Array<{ type: string; text: string }> };

      expect(result.content[0].text).toContain('1 script');
      expect(result.content[0].text).toContain('res://player.gd');
      expect(result.content[0].text).toContain('Player');
      expect(result.content[0].text).toContain('1 method');
      expect(result.content[0].text).toContain('1 property');
      expect(result.content[0].text).toContain('1 signal');
    });

    it('returns the script summary when ok:false but stdout contains the summary JSON (broken script in project)', async () => {
      // Regression: same failure shape as validate_scripts — a broken script in
      // the project produces engine stderr noise (`ERROR: Failed to load script`)
      // with exit 0, flipping ok to false while the summary JSON is still printed.
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'ERROR: Failed to load script "res://broken_test.gd" with error "Parse error".',
        stdout: '[INFO] Operation: list_scripts\n{"scripts":[{"path":"res://player.gd","class_name":"Player","methods":[],"properties":[],"signals":[]}],"total":1}\n',
        stderr: 'ERROR: Failed to load script "res://broken_test.gd" with error "Parse error".',
        exitCode: 0,
      });

      const handler = handlers.get('list_scripts')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { isError?: boolean; content: Array<{ type: string; text: string }> };

      expect(result.isError).toBeUndefined();
      expect(toolError).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('1 script');
      expect(result.content[0].text).toContain('res://player.gd');
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Godot exited with code 1',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('list_scripts')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Godot exited with code 1'),
        expect.any(Array),
      );
    });

    it('returns toolError for invalid path', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('list_scripts')!;
      const result = await handler({
        project_path: '/bad/../path',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError for missing project.godot', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('list_scripts')!;
      const result = await handler({
        project_path: '/not/a/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe('query_class', () => {
    it('registers the query_class tool', () => {
      expect(handlers.has('query_class')).toBe(true);
    });

    it('passes correct params to runOperation with operation "query_class"', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        stdout: '{"class_name":"Node2D","parent_class":"CanvasItem","properties":[],"methods":[],"signals":[]}',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('query_class')!;
      await handler({
        project_path: '/my/project',
        class_name: 'Node2D',
        no_inheritance: true,
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'query_class',
        expect.objectContaining({
          class_name: 'Node2D',
          no_inheritance: true,
        }),
      );
    });

    it('parses JSON result and returns class info', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        stdout: '[INFO] Operation: query_class\n{"class_name":"Node2D","parent_class":"CanvasItem","properties":[{"name":"position","type":5,"usage":4102}],"methods":[{"name":"get_position","return_type":5,"args":[]}],"signals":[{"name":"visibility_changed","args":[]}]}',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('query_class')!;
      const result = await handler({
        project_path: '/my/project',
        class_name: 'Node2D',
      }) as { content: Array<{ type: string; text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.class_name).toBe('Node2D');
      expect(parsed.parent_class).toBe('CanvasItem');
      expect(parsed.properties).toHaveLength(1);
      expect(parsed.methods).toHaveLength(1);
      expect(parsed.signals).toHaveLength(1);
    });

    it('returns toolError when runOperation yields ok:false (e.g. unknown class)', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Class does not exist: BogusClass',
        data: { error: 'Class does not exist: BogusClass' },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('query_class')!;
      const result = await handler({
        project_path: '/my/project',
        class_name: 'BogusClass',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Class does not exist: BogusClass'),
        expect.any(Array),
      );
    });

    it('returns toolError for invalid path', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('query_class')!;
      const result = await handler({
        project_path: '/bad/../path',
        class_name: 'Node2D',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });
});
