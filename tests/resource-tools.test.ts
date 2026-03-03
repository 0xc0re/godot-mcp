/**
 * Tests for resource MCP tools: read_resource, create_resource.
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

// Mock tscn-parser module
vi.mock('../src/parsers/tscn-parser.js', () => ({
  parseResource: vi.fn(),
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
import { parseResource } from '../src/parsers/tscn-parser.js';
import { registerResourceTools } from '../src/tools/resource.js';

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

describe('Resource MCP Tools', () => {
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
    registerResourceTools(server, ctx);
  });

  describe('read_resource', () => {
    it('registers the read_resource tool', () => {
      expect(handlers.has('read_resource')).toBe(true);
    });

    it('reads file and returns parsed resource JSON', async () => {
      const mockParsed = {
        type: 'StandardMaterial3D',
        format: 3,
        extResources: [],
        subResources: [],
        properties: { albedo_color: 'Color(1, 0, 0, 1)' },
      };

      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('[gd_resource type="StandardMaterial3D" format=3]');
      vi.mocked(parseResource).mockReturnValue(mockParsed);

      const handler = handlers.get('read_resource')!;
      const result = await handler({
        project_path: '/my/project',
        resource_path: 'materials/ground.tres',
      }) as { content: Array<{ type: string; text: string }> };

      expect(readFileSync).toHaveBeenCalled();
      expect(parseResource).toHaveBeenCalledWith('[gd_resource type="StandardMaterial3D" format=3]');
      expect(result.content[0].text).toContain('StandardMaterial3D');
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('read_resource')!;
      const result = await handler({
        project_path: '/my/../project',
        resource_path: 'materials/ground.tres',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('read_resource')!;
      const result = await handler({
        project_path: '/not/a/project',
        resource_path: 'materials/ground.tres',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe('create_resource', () => {
    it('registers the create_resource tool', () => {
      expect(handlers.has('create_resource')).toBe(true);
    });

    it('passes correct params to executeOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '{"success":true,"path":"res://materials/ground.tres","type":"StandardMaterial3D"}',
        stderr: '',
      });

      const handler = handlers.get('create_resource')!;
      await handler({
        project_path: '/my/project',
        output_path: 'materials/ground.tres',
        resource_type: 'StandardMaterial3D',
        properties: { albedo_color: { r: 1, g: 0, b: 0 } },
        property_types: { albedo_color: 'Color' },
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'create_resource',
        expect.objectContaining({
          outputPath: 'materials/ground.tres',
          resourceType: 'StandardMaterial3D',
          properties: { albedo_color: { r: 1, g: 0, b: 0 } },
          propertyTypes: { albedo_color: 'Color' },
        }),
      );
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('create_resource')!;
      const result = await handler({
        project_path: '/bad/../path',
        output_path: 'materials/ground.tres',
        resource_type: 'StandardMaterial3D',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('create_resource')!;
      const result = await handler({
        project_path: '/not/a/project',
        output_path: 'materials/ground.tres',
        resource_type: 'StandardMaterial3D',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns success message with output path and type', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '{"success":true,"path":"res://materials/ground.tres","type":"StandardMaterial3D"}',
        stderr: '',
      });

      const handler = handlers.get('create_resource')!;
      const result = await handler({
        project_path: '/my/project',
        output_path: 'materials/ground.tres',
        resource_type: 'StandardMaterial3D',
      }) as { content: Array<{ type: string; text: string }> };

      expect(result.content[0].text).toContain('materials/ground.tres');
      expect(result.content[0].text).toContain('StandardMaterial3D');
    });
  });
});
