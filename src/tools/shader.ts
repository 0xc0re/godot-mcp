/**
 * Shader asset tool domain: create_shader, create_shader_material,
 * set_shader_params.
 *
 * create_shader writes .gdshader files directly to disk (plain text).
 * create_shader_material and set_shader_params use GDScript backend
 * operations for .tres resource handling.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { dirname } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import type { ServerContext } from '../types.js';
import { resolveWithinProject, runOperation } from '../godot.js';
import { toolError } from '../errors.js';
import { withProject, outsideProjectError, opSuccess, textResult } from './common.js';

export function registerShaderTools(server: McpServer, ctx: ServerContext): void {
  // Tool: create_shader
  server.registerTool(
    'create_shader',
    {
      title: 'Create Shader',
      description:
        'Create a .gdshader file with the specified shader type and source code. Writes the file directly to disk. Parent directories are created automatically.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        shader_path: z
          .string()
          .describe("Relative path for the shader file (must end in .gdshader, e.g., 'shaders/glow.gdshader')"),
        shader_type: z
          .enum(['spatial', 'canvas_item', 'particles', 'sky', 'fog'])
          .describe('Godot shader type'),
        shader_code: z
          .string()
          .describe('Shader source code body (fragment/vertex/etc functions)'),
      },
    },
    withProject(
      {
        catchPrefix: 'Failed to create shader',
        catchSuggestions: [
          'Check that the project path is writable',
          'Verify the shader path is valid',
        ],
      },
      async ({ project_path, shader_path, shader_type, shader_code }) => {
        const shaderPathStr = shader_path as string;
        if (!shaderPathStr.endsWith('.gdshader')) {
          return toolError('Shader path must end with .gdshader', [
            "Use a .gdshader extension (e.g., 'shaders/my_shader.gdshader')",
          ]);
        }

        const fullPath = resolveWithinProject(project_path, shaderPathStr);
        if (fullPath === null) {
          return outsideProjectError('shader_path');
        }

        const shaderSource = `shader_type ${shader_type};\n\n${shader_code}`;

        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, shaderSource, 'utf-8');

        return textResult(JSON.stringify({ success: true, path: shaderPathStr }));
      },
    ),
  );

  // Tool: create_shader_material
  server.registerTool(
    'create_shader_material',
    {
      title: 'Create Shader Material',
      description:
        'Create a ShaderMaterial .tres resource file referencing a .gdshader file. Optionally set initial shader parameters. Uses GDScript backend for proper Godot resource serialization.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        shader_path: z
          .string()
          .describe('Path to the .gdshader file relative to the project'),
        output_path: z
          .string()
          .describe('Path for the output .tres material file'),
        shader_params: z
          .record(z.unknown())
          .optional()
          .describe('Initial shader parameter values (e.g., {"color": [1,0,0,1], "speed": 2.5})'),
        param_types: z
          .record(z.string())
          .optional()
          .describe('Type hints for shader parameters (e.g., {"color": "Color", "speed": "float"})'),
      },
    },
    withProject(
      {
        catchPrefix: 'Failed to create shader material',
      },
      async ({ project_path, shader_path, output_path, shader_params, param_types }) => {
        if (resolveWithinProject(project_path, shader_path as string) === null) {
          return outsideProjectError('shader_path');
        }

        if (resolveWithinProject(project_path, output_path as string) === null) {
          return outsideProjectError('output_path');
        }

        const params: Record<string, unknown> = {
          shaderPath: shader_path,
          outputPath: output_path,
        };

        if (shader_params) {
          params.shaderParams = shader_params;
        }
        if (param_types) {
          params.paramTypes = param_types;
        }

        const result = await runOperation(ctx, project_path, 'create_shader_material', params);

        if (!result.ok) {
          return toolError(`Failed to create shader material: ${result.error}`, [
            'Check that the .gdshader file exists at the specified path',
            'Verify the output path is valid',
            'Ensure shader parameter types match the shader uniforms',
          ]);
        }

        return opSuccess(`Shader material created at '${output_path}'`, result.data);
      },
    ),
  );

  // Tool: set_shader_params
  server.registerTool(
    'set_shader_params',
    {
      title: 'Set Shader Parameters',
      description:
        'Set shader parameters on an existing ShaderMaterial .tres resource. Updates the material file with new parameter values via GDScript backend.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        material_path: z
          .string()
          .describe('Path to the existing .tres ShaderMaterial file'),
        shader_params: z
          .record(z.unknown())
          .describe('Shader parameter values to set (e.g., {"speed": 3.0, "intensity": 0.8})'),
        param_types: z
          .record(z.string())
          .optional()
          .describe('Type hints for shader parameters (e.g., {"speed": "float"})'),
      },
    },
    withProject(
      {
        catchPrefix: 'Failed to set shader params',
      },
      async ({ project_path, material_path, shader_params, param_types }) => {
        if (resolveWithinProject(project_path, material_path as string) === null) {
          return outsideProjectError('material_path');
        }

        const params: Record<string, unknown> = {
          materialPath: material_path,
          shaderParams: shader_params,
        };

        if (param_types) {
          params.paramTypes = param_types;
        }

        const result = await runOperation(ctx, project_path, 'set_shader_params', params);

        if (!result.ok) {
          return toolError(`Failed to set shader params: ${result.error}`, [
            'Check that the material file exists',
            'Verify parameter names match the shader uniforms',
            'Ensure parameter types are correct',
          ]);
        }

        return opSuccess(`Shader parameters updated on '${material_path}'`, result.data);
      },
    ),
  );
}
