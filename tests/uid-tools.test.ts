/**
 * Tests for UID MCP tools: get_uid, update_project_uids.
 *
 * Uses vi.mock() to isolate tool logic from filesystem and Godot process.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../src/types.js';
import { registerUidTools } from '../src/tools/uid.js';

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
  isGodot44OrLater: vi.fn(),
}));

// Mock errors module
vi.mock('../src/errors.js', () => ({
  toolError: vi.fn((message: string, suggestions: string[] = []) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, suggestions }) }],
    isError: true,
  })),
}));

import { existsSync } from 'fs';
import { validatePath, execGodot, runOperation, isGodot44OrLater } from '../src/godot.js';

// Helper to extract registered tool handlers from McpServer
function getToolHandlers(
  server: McpServer,
): Map<string, (params: Record<string, unknown>) => Promise<unknown>> {
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

describe('UID MCP Tools', () => {
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
    registerUidTools(server, ctx);
  });

  describe('get_uid', () => {
    it('registers the get_uid tool', () => {
      expect(handlers.has('get_uid')).toBe(true);
    });

    it('returns the UID for a valid in-project file', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execGodot).mockResolvedValue({ stdout: '4.4.stable', stderr: '' });
      vi.mocked(isGodot44OrLater).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { exists: true, uid: 'uid://abc123' },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('get_uid')!;
      const result = (await handler({
        project_path: '/proj',
        file_path: 'scenes/main.tscn',
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('uid://abc123');
      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/proj',
        'get_uid',
        { file_path: 'scenes/main.tscn' },
      );
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

    it('get_uid rejects file_path traversal before touching the filesystem', async () => {
      await expectPathRejected(
        'get_uid',
        { project_path: '/proj', file_path: '../../../etc/passwd' },
        'file_path',
      );
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('get_uid rejects an absolute out-of-project file_path', async () => {
      await expectPathRejected(
        'get_uid',
        { project_path: '/proj', file_path: '/etc/passwd' },
        'file_path',
      );
      expect(runOperation).not.toHaveBeenCalled();
    });
  });
});
