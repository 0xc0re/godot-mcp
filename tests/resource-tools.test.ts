/**
 * Tests for resource MCP tools: read_resource, create_resource, modify_resource.
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
  // Pure-path stand-in for the real resolveWithinProject: rejects null bytes,
  // ".." traversal, and absolute paths; strips res:// and joins to the root.
  resolveWithinProject: vi.fn((projectRoot: string, relPath: string) => {
    if (typeof relPath !== 'string' || relPath.length === 0 || relPath.includes('\0')) return null;
    const stripped = relPath.startsWith('res://') ? relPath.slice('res://'.length) : relPath;
    if (stripped.startsWith('/') || stripped.split('/').includes('..')) return null;
    return `${projectRoot}/${stripped}`;
  }),
  executeOperation: vi.fn(),
  runOperation: vi.fn(),
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
import { validatePath, executeOperation, runOperation } from '../src/godot.js';
import { parseResource } from '../src/parsers/tscn-parser.js';
import { toolError } from '../src/errors.js';
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

    it('passes correct params to runOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, path: 'res://materials/ground.tres', type: 'StandardMaterial3D' },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('create_resource')!;
      await handler({
        project_path: '/my/project',
        output_path: 'materials/ground.tres',
        resource_type: 'StandardMaterial3D',
        properties: { albedo_color: { r: 1, g: 0, b: 0 } },
        property_types: { albedo_color: 'Color' },
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'create_resource',
        expect.objectContaining({
          output_path: 'materials/ground.tres',
          resource_type: 'StandardMaterial3D',
          properties: { albedo_color: { r: 1, g: 0, b: 0 } },
          property_types: { albedo_color: 'Color' },
        }),
      );
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Unknown resource type: BogusResource',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('create_resource')!;
      const result = await handler({
        project_path: '/my/project',
        output_path: 'materials/ground.tres',
        resource_type: 'BogusResource',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Unknown resource type: BogusResource'),
        expect.any(Array),
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
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, path: 'res://materials/ground.tres', type: 'StandardMaterial3D' },
        stdout: '',
        stderr: '',
        exitCode: 0,
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

  describe('modify_resource', () => {
    it('registers the modify_resource tool', () => {
      expect(handlers.has('modify_resource')).toBe(true);
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('modify_resource')!;
      const result = await handler({
        project_path: '/bad/../path',
        resource_path: 'materials/ground.tres',
        properties: { albedo_color: { r: 1, g: 0, b: 0 } },
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('modify_resource')!;
      const result = await handler({
        project_path: '/not/a/project',
        resource_path: 'materials/ground.tres',
        properties: { albedo_color: { r: 1, g: 0, b: 0 } },
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when .tres file does not exist', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      // project.godot exists, but .tres file does not
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        return String(p).endsWith('project.godot');
      });

      const handler = handlers.get('modify_resource')!;
      const result = await handler({
        project_path: '/my/project',
        resource_path: 'materials/missing.tres',
        properties: { albedo_color: { r: 1, g: 0, b: 0 } },
      }) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('create_resource');
    });

    it('passes correct params to runOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: {
          success: true,
          path: 'res://materials/ground.tres',
          type: 'StandardMaterial3D',
          properties_set: 1,
        },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('modify_resource')!;
      await handler({
        project_path: '/my/project',
        resource_path: 'materials/ground.tres',
        properties: { albedo_color: { r: 1, g: 0, b: 0 } },
        property_types: { albedo_color: 'Color' },
      });

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'modify_resource',
        expect.objectContaining({
          resource_path: 'materials/ground.tres',
          properties: { albedo_color: { r: 1, g: 0, b: 0 } },
          property_types: { albedo_color: 'Color' },
        }),
      );
    });

    it('omits property_types when not provided', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: {
          success: true,
          path: 'res://materials/ground.tres',
          type: 'StandardMaterial3D',
          properties_set: 1,
        },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('modify_resource')!;
      await handler({
        project_path: '/my/project',
        resource_path: 'materials/ground.tres',
        properties: { roughness: 0.5 },
      });

      const callArgs = vi.mocked(runOperation).mock.calls[0][3] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty('property_types');
    });

    it('returns success message with resource path', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: {
          success: true,
          path: 'res://materials/ground.tres',
          type: 'StandardMaterial3D',
          properties_set: 1,
        },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('modify_resource')!;
      const result = await handler({
        project_path: '/my/project',
        resource_path: 'materials/ground.tres',
        properties: { roughness: 0.5 },
      }) as { content: Array<{ type: string; text: string }> };

      expect(result.content[0].text).toContain('materials/ground.tres');
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Failed to load resource: res://materials/ground.tres',
        stdout: '',
        stderr: '[ERROR] Failed to load resource',
        exitCode: 1,
      });

      const handler = handlers.get('modify_resource')!;
      const result = await handler({
        project_path: '/my/project',
        resource_path: 'materials/ground.tres',
        properties: { roughness: 0.5 },
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load resource: res://materials/ground.tres'),
        expect.any(Array),
      );
    });

    it('returns toolError on exception', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockRejectedValue(new Error('Godot crashed'));

      const handler = handlers.get('modify_resource')!;
      const result = await handler({
        project_path: '/my/project',
        resource_path: 'materials/ground.tres',
        properties: { roughness: 0.5 },
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
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

    it('read_resource rejects resource_path traversal before reading the file', async () => {
      await expectPathRejected('read_resource', { project_path: '/proj', resource_path: '../../../etc/passwd' }, 'resource_path');
      expect(readFileSync).not.toHaveBeenCalled();
    });

    it('create_resource rejects output_path traversal', async () => {
      await expectPathRejected('create_resource', { project_path: '/proj', output_path: '../../evil.tres', resource_type: 'Curve2D' }, 'output_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('modify_resource rejects resource_path traversal', async () => {
      await expectPathRejected('modify_resource', { project_path: '/proj', resource_path: '../../evil.tres', properties: { a: 1 } }, 'resource_path');
      expect(runOperation).not.toHaveBeenCalled();
    });
  });
});
