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
import { join, dirname } from 'path';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import type { ServerContext } from '../types.js';
import { executeOperation, validatePath } from '../godot.js';
import { toolError } from '../errors.js';

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
    async ({ project_path, shader_path, shader_type, shader_code }) => {
      if (!validatePath(project_path as string)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path as string, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        const shaderPathStr = shader_path as string;
        if (!shaderPathStr.endsWith('.gdshader')) {
          return toolError('Shader path must end with .gdshader', [
            "Use a .gdshader extension (e.g., 'shaders/my_shader.gdshader')",
          ]);
        }

        const shaderSource = `shader_type ${shader_type};\n\n${shader_code}`;
        const fullPath = join(project_path as string, shaderPathStr);

        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, shaderSource, 'utf-8');

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: true, path: shaderPathStr }),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to create shader: ${errorMessage}`, [
          'Check that the project path is writable',
          'Verify the shader path is valid',
        ]);
      }
    },
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
    async ({ project_path, shader_path, output_path, shader_params, param_types }) => {
      if (!validatePath(project_path as string)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path as string, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
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

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path as string,
          'create_shader_material',
          params,
        );

        if (stderr && (stderr.includes('Failed to') || stderr.includes('[ERROR]'))) {
          return toolError(`Failed to create shader material: ${stderr}`, [
            'Check that the .gdshader file exists at the specified path',
            'Verify the output path is valid',
            'Ensure shader parameter types match the shader uniforms',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Shader material created at '${output_path}'\n\nOutput: ${stdout}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to create shader material: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
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
    async ({ project_path, material_path, shader_params, param_types }) => {
      if (!validatePath(project_path as string)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path as string, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        const params: Record<string, unknown> = {
          materialPath: material_path,
          shaderParams: shader_params,
        };

        if (param_types) {
          params.paramTypes = param_types;
        }

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path as string,
          'set_shader_params',
          params,
        );

        if (stderr && (stderr.includes('Failed to') || stderr.includes('[ERROR]'))) {
          return toolError(`Failed to set shader params: ${stderr}`, [
            'Check that the material file exists',
            'Verify parameter names match the shader uniforms',
            'Ensure parameter types are correct',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Shader parameters updated on '${material_path}'\n\nOutput: ${stdout}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to set shader params: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );
}
