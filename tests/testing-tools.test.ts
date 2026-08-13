/**
 * Tests for testing MCP tools: run_tests.
 *
 * Uses vi.mock() to isolate tool logic from filesystem and Godot process.
 * NOTE: Testing tools use execGodot directly (not runOperation) since
 * GUT test execution is a CLI operation, not a godot_operations.gd dispatch.
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

// Mock godot module — testing tools use execGodot directly, NOT runOperation
// (runOperation is stubbed for factory completeness; run_tests never calls it)
vi.mock('../src/godot.js', () => ({
  validatePath: vi.fn(),
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

import { existsSync } from 'fs';
import { validatePath, execGodot } from '../src/godot.js';
import { registerTestingTools } from '../src/tools/testing.js';

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

describe('Testing MCP Tools', () => {
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
    registerTestingTools(server, ctx);
  });

  // ── run_tests ───────────────────────────────────────────────────────

  describe('run_tests', () => {
    it('registers the run_tests tool', () => {
      expect(handlers.has('run_tests')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('run_tests')!;
      const result = await handler({
        project_path: '/bad/../path',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('run_tests')!;
      const result = await handler({
        project_path: '/not/a/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when GUT not installed', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p) => {
        if (String(p).endsWith('project.godot')) return true;
        // gut_cmdln.gd does not exist
        return false;
      });

      const handler = handlers.get('run_tests')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('GUT');
    });

    it('calls execGodot with correct args including -gexit flag', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execGodot).mockResolvedValue({
        stdout: 'Passed: 5\nFailed: 0\nErrors: 0\n',
        stderr: '',
      });

      const handler = handlers.get('run_tests')!;
      await handler({ project_path: '/my/project' });

      expect(execGodot).toHaveBeenCalledWith(
        '/usr/bin/godot',
        ['--headless', '--path', '/my/project', '-s', 'addons/gut/gut_cmdln.gd', '-gexit'],
        { timeout: 120_000 },
      );
    });

    it('adds -gdir flag when test_dir provided', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execGodot).mockResolvedValue({
        stdout: 'Passed: 3\nFailed: 0\nErrors: 0\n',
        stderr: '',
      });

      const handler = handlers.get('run_tests')!;
      await handler({
        project_path: '/my/project',
        test_dir: 'res://tests/unit/',
      });

      const args = vi.mocked(execGodot).mock.calls[0][1] as string[];
      expect(args).toContain('-gdir=res://tests/unit/');
    });

    it('adds -gtest flag when test_file provided', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execGodot).mockResolvedValue({
        stdout: 'Passed: 1\nFailed: 0\nErrors: 0\n',
        stderr: '',
      });

      const handler = handlers.get('run_tests')!;
      await handler({
        project_path: '/my/project',
        test_file: 'res://tests/unit/test_player.gd',
      });

      const args = vi.mocked(execGodot).mock.calls[0][1] as string[];
      expect(args).toContain('-gtest=res://tests/unit/test_player.gd');
    });

    it('adds -gunit_test_name flag when test_name provided', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execGodot).mockResolvedValue({
        stdout: 'Passed: 1\nFailed: 0\nErrors: 0\n',
        stderr: '',
      });

      const handler = handlers.get('run_tests')!;
      await handler({
        project_path: '/my/project',
        test_name: 'test_jump_height',
      });

      const args = vi.mocked(execGodot).mock.calls[0][1] as string[];
      expect(args).toContain('-gunit_test_name=test_jump_height');
    });

    it('parses GUT stdout for pass/fail/error counts', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execGodot).mockResolvedValue({
        stdout: 'Running tests...\nPassed: 42\nFailed: 3\nErrors: 1\nDone.',
        stderr: '',
      });

      const handler = handlers.get('run_tests')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.passed).toBe(42);
      expect(parsed.failed).toBe(3);
      expect(parsed.errors).toBe(1);
    });

    it('returns warning when output cannot be parsed', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execGodot).mockResolvedValue({
        stdout: 'Some unexpected output with no counts',
        stderr: '',
      });

      const handler = handlers.get('run_tests')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.warning).toContain('Could not parse');
      expect(parsed.output).toBe('Some unexpected output with no counts');
    });

    it('returns toolError on execGodot exception', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execGodot).mockRejectedValue(new Error('Godot process timed out'));

      const handler = handlers.get('run_tests')!;
      const result = await handler({
        project_path: '/my/project',
      }) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('Godot process timed out');
    });
  });
});
