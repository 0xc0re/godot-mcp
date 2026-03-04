/**
 * Tests for get_diagnostics MCP tool.
 *
 * Uses vi.mock() to isolate tool logic from filesystem, LSP client, and Godot process.
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
  trackProcess: vi.fn((_ctx: unknown, proc: unknown) => proc),
}));

// Mock errors module
vi.mock('../src/errors.js', () => ({
  toolError: vi.fn((message: string, suggestions: string[] = []) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, suggestions }) }],
    isError: true,
  })),
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock net module for port probing
vi.mock('net', () => {
  const { EventEmitter } = require('events');
  return {
    Socket: class MockSocket extends EventEmitter {
      connect = vi.fn();
      destroy = vi.fn();
      end = vi.fn();
    },
    createConnection: vi.fn(),
  };
});

// Mock LspClient
const mockGetDiagnostics = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockIsConnected = vi.fn().mockReturnValue(false);

vi.mock('../src/lsp/client.js', () => ({
  LspClient: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    getDiagnostics: mockGetDiagnostics,
    disconnect: mockDisconnect,
    get isConnected() {
      return mockIsConnected();
    },
  })),
}));

import { existsSync, readFileSync } from 'fs';
import { validatePath } from '../src/godot.js';
import { registerDiagnosticsTools } from '../src/tools/diagnostics.js';

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

describe('Diagnostics MCP Tools', () => {
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
    registerDiagnosticsTools(server, ctx);
  });

  describe('get_diagnostics', () => {
    it('registers the get_diagnostics tool', () => {
      expect(handlers.has('get_diagnostics')).toBe(true);
    });

    it('returns toolError for invalid file path', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('get_diagnostics')!;
      const result = await handler({
        file_path: '/bad/../path/test.gd',
        project_path: '/my/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError for non-existent file', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('get_diagnostics')!;
      const result = await handler({
        file_path: '/my/project/nonexistent.gd',
        project_path: '/my/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError for non-.gd file', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);

      const handler = handlers.get('get_diagnostics')!;
      const result = await handler({
        file_path: '/my/project/readme.txt',
        project_path: '/my/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns diagnostics array for a file with errors', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('var x = ;');

      // Simulate existing connected LSP client
      mockIsConnected.mockReturnValue(true);
      ctx.lspClient = {
        connect: mockConnect,
        getDiagnostics: mockGetDiagnostics,
        disconnect: mockDisconnect,
        get isConnected() { return mockIsConnected(); },
      } as unknown as import('../src/lsp/client.js').LspClient;

      mockGetDiagnostics.mockResolvedValue([
        {
          range: { start: { line: 0, character: 8 }, end: { line: 0, character: 9 } },
          severity: 1,
          message: 'Expected expression',
          source: 'gdscript',
        },
      ]);

      const handler = handlers.get('get_diagnostics')!;
      const result = await handler({
        file_path: '/my/project/test.gd',
        project_path: '/my/project',
      }) as { content: Array<{ type: string; text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.diagnostics).toHaveLength(1);
      expect(parsed.diagnostics[0].message).toBe('Expected expression');
      expect(parsed.count).toBe(1);
      expect(parsed.file).toBe('/my/project/test.gd');
    });

    it('returns empty diagnostics array for a clean file', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('extends Node\n\nfunc _ready():\n\tpass\n');

      mockIsConnected.mockReturnValue(true);
      ctx.lspClient = {
        connect: mockConnect,
        getDiagnostics: mockGetDiagnostics,
        disconnect: mockDisconnect,
        get isConnected() { return mockIsConnected(); },
      } as unknown as import('../src/lsp/client.js').LspClient;

      mockGetDiagnostics.mockResolvedValue([]);

      const handler = handlers.get('get_diagnostics')!;
      const result = await handler({
        file_path: '/my/project/clean.gd',
        project_path: '/my/project',
      }) as { content: Array<{ type: string; text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.diagnostics).toEqual([]);
      expect(parsed.count).toBe(0);
    });
  });
});
