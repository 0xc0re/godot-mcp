/**
 * Tests for shader MCP tools: create_shader, create_shader_material,
 * set_shader_params.
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
  };
});

// Mock godot module
vi.mock('../src/godot.js', () => ({
  validatePath: vi.fn(),
  executeOperation: vi.fn(),
}));

// Mock errors module
vi.mock('../src/errors.js', () => ({
  toolError: vi.fn((message: string, suggestions: string[] = []) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, suggestions }) }],
    isError: true,
  })),
}));

import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { validatePath, executeOperation } from '../src/godot.js';
import { registerShaderTools } from '../src/tools/shader.js';

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

describe('Shader MCP Tools', () => {
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
    registerShaderTools(server, ctx);
  });

  // ── create_shader ────────────────────────────────────────────────────

  describe('create_shader', () => {
    it('registers the create_shader tool', () => {
      expect(handlers.has('create_shader')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('create_shader')!;
      const result = await handler({
        project_path: '/bad/../path',
        shader_path: 'shaders/test.gdshader',
        shader_type: 'spatial',
        shader_code: 'void fragment() { ALBEDO = vec3(1.0); }',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('create_shader')!;
      const result = await handler({
        project_path: '/not/a/project',
        shader_path: 'shaders/test.gdshader',
        shader_type: 'spatial',
        shader_code: 'void fragment() { ALBEDO = vec3(1.0); }',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError if shader_path does not end with .gdshader', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);

      const handler = handlers.get('create_shader')!;
      const result = await handler({
        project_path: '/my/project',
        shader_path: 'shaders/test.shader',
        shader_type: 'spatial',
        shader_code: 'void fragment() { ALBEDO = vec3(1.0); }',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('writes .gdshader file to disk with correct content', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);

      const handler = handlers.get('create_shader')!;
      await handler({
        project_path: '/my/project',
        shader_path: 'shaders/test.gdshader',
        shader_type: 'spatial',
        shader_code: 'void fragment() {\n  ALBEDO = vec3(1.0);\n}',
      });

      expect(writeFileSync).toHaveBeenCalledWith(
        '/my/project/shaders/test.gdshader',
        'shader_type spatial;\n\nvoid fragment() {\n  ALBEDO = vec3(1.0);\n}',
        'utf-8',
      );
    });

    it('creates parent directories if they do not exist', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);

      const handler = handlers.get('create_shader')!;
      await handler({
        project_path: '/my/project',
        shader_path: 'shaders/effects/glow.gdshader',
        shader_type: 'canvas_item',
        shader_code: 'void fragment() { COLOR = vec4(1.0); }',
      });

      expect(mkdirSync).toHaveBeenCalledWith(
        '/my/project/shaders/effects',
        { recursive: true },
      );
    });

    it('returns success JSON with the shader path', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);

      const handler = handlers.get('create_shader')!;
      const result = await handler({
        project_path: '/my/project',
        shader_path: 'shaders/test.gdshader',
        shader_type: 'spatial',
        shader_code: 'void fragment() { ALBEDO = vec3(1.0); }',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.path).toBe('shaders/test.gdshader');
    });

    it('returns toolError on writeFileSync exception', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(writeFileSync).mockImplementation(() => {
        throw new Error('Disk full');
      });

      const handler = handlers.get('create_shader')!;
      const result = await handler({
        project_path: '/my/project',
        shader_path: 'shaders/test.gdshader',
        shader_type: 'spatial',
        shader_code: 'void fragment() { ALBEDO = vec3(1.0); }',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  // ── create_shader_material ───────────────────────────────────────────

  describe('create_shader_material', () => {
    it('registers the create_shader_material tool', () => {
      expect(handlers.has('create_shader_material')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('create_shader_material')!;
      const result = await handler({
        project_path: '/bad/../path',
        shader_path: 'shaders/test.gdshader',
        output_path: 'materials/test.tres',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('create_shader_material')!;
      const result = await handler({
        project_path: '/not/a/project',
        shader_path: 'shaders/test.gdshader',
        output_path: 'materials/test.tres',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('calls executeOperation with correct camelCase params', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const handler = handlers.get('create_shader_material')!;
      await handler({
        project_path: '/my/project',
        shader_path: 'shaders/test.gdshader',
        output_path: 'materials/test.tres',
        shader_params: { color: [1.0, 0.0, 0.0, 1.0], speed: 2.5 },
        param_types: { color: 'Color', speed: 'float' },
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'create_shader_material',
        {
          shaderPath: 'shaders/test.gdshader',
          outputPath: 'materials/test.tres',
          shaderParams: { color: [1.0, 0.0, 0.0, 1.0], speed: 2.5 },
          paramTypes: { color: 'Color', speed: 'float' },
        },
      );
    });

    it('handles optional params when not provided', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const handler = handlers.get('create_shader_material')!;
      await handler({
        project_path: '/my/project',
        shader_path: 'shaders/test.gdshader',
        output_path: 'materials/test.tres',
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'create_shader_material',
        expect.objectContaining({
          shaderPath: 'shaders/test.gdshader',
          outputPath: 'materials/test.tres',
        }),
      );
    });

    it('returns toolError when stderr contains error indicators', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '',
        stderr: '[ERROR] Failed to create shader material',
      });

      const handler = handlers.get('create_shader_material')!;
      const result = await handler({
        project_path: '/my/project',
        shader_path: 'shaders/test.gdshader',
        output_path: 'materials/test.tres',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns stdout on success', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '{"success":true,"path":"materials/test.tres"}',
        stderr: '',
      });

      const handler = handlers.get('create_shader_material')!;
      const result = await handler({
        project_path: '/my/project',
        shader_path: 'shaders/test.gdshader',
        output_path: 'materials/test.tres',
      }) as { content: Array<{ text: string }> };

      expect(result.content[0].text).toContain('materials/test.tres');
    });

    it('returns toolError on executeOperation exception', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('create_shader_material')!;
      const result = await handler({
        project_path: '/my/project',
        shader_path: 'shaders/test.gdshader',
        output_path: 'materials/test.tres',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  // ── set_shader_params ────────────────────────────────────────────────

  describe('set_shader_params', () => {
    it('registers the set_shader_params tool', () => {
      expect(handlers.has('set_shader_params')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('set_shader_params')!;
      const result = await handler({
        project_path: '/bad/../path',
        material_path: 'materials/test.tres',
        shader_params: { speed: 3.0 },
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('set_shader_params')!;
      const result = await handler({
        project_path: '/not/a/project',
        material_path: 'materials/test.tres',
        shader_params: { speed: 3.0 },
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('calls executeOperation with correct camelCase params', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

      const handler = handlers.get('set_shader_params')!;
      await handler({
        project_path: '/my/project',
        material_path: 'materials/test.tres',
        shader_params: { speed: 3.0, intensity: 0.8 },
        param_types: { speed: 'float', intensity: 'float' },
      });

      expect(executeOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'set_shader_params',
        {
          materialPath: 'materials/test.tres',
          shaderParams: { speed: 3.0, intensity: 0.8 },
          paramTypes: { speed: 'float', intensity: 'float' },
        },
      );
    });

    it('returns stdout on success', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '{"success":true,"updated_params":["speed"]}',
        stderr: '',
      });

      const handler = handlers.get('set_shader_params')!;
      const result = await handler({
        project_path: '/my/project',
        material_path: 'materials/test.tres',
        shader_params: { speed: 3.0 },
      }) as { content: Array<{ text: string }> };

      expect(result.content[0].text).toContain('speed');
    });

    it('returns toolError on stderr error', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockResolvedValue({
        stdout: '',
        stderr: 'Failed to set shader params',
      });

      const handler = handlers.get('set_shader_params')!;
      const result = await handler({
        project_path: '/my/project',
        material_path: 'materials/test.tres',
        shader_params: { speed: 3.0 },
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError on executeOperation exception', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(executeOperation).mockRejectedValue(new Error('Process failed'));

      const handler = handlers.get('set_shader_params')!;
      const result = await handler({
        project_path: '/my/project',
        material_path: 'materials/test.tres',
        shader_params: { speed: 3.0 },
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });
});
