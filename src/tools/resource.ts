/**
 * Resource tool domain: read_resource, create_resource
 *
 * read_resource uses the TypeScript parser for fast, zero-latency reads.
 * create_resource delegates to Godot headless for correct type serialization.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import type { ServerContext } from '../types.js';
import { executeOperation, validatePath } from '../godot.js';
import { toolError } from '../errors.js';
import { parseResource } from '../parsers/tscn-parser.js';

export function registerResourceTools(server: McpServer, ctx: ServerContext): void {
  // read_resource tool (SCEN-06)
  server.registerTool(
    'read_resource',
    {
      title: 'Read Resource',
      description:
        'Read a Godot resource file (.tres) and return its structure as JSON',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        resource_path: z
          .string()
          .describe(
            'Path to the resource file relative to project (e.g. "materials/ground.tres")',
          ),
      },
    },
    async ({ project_path, resource_path }) => {
      if (!validatePath(project_path) || !validatePath(resource_path)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        const resourceFilePath = join(project_path, resource_path);
        if (!existsSync(resourceFilePath)) {
          return toolError(`Resource file does not exist: ${resource_path}`, [
            'Ensure the resource path is correct',
            'Check if the .tres file exists in the project',
          ]);
        }

        const content = readFileSync(resourceFilePath, 'utf-8');
        const parsed = parseResource(content);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(parsed, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to read resource: ${errorMessage}`, [
          'Ensure the resource file is a valid .tres file',
          'Check if the file is not corrupted',
          'Verify the resource path is correct',
        ]);
      }
    },
  );

  // create_resource tool (SCEN-05)
  server.registerTool(
    'create_resource',
    {
      title: 'Create Resource',
      description:
        'Create a new Godot resource file (.tres) with specified type and properties',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        output_path: z
          .string()
          .describe(
            'Path for the new resource file relative to project (e.g. "materials/ground.tres")',
          ),
        resource_type: z
          .string()
          .describe(
            'Godot resource class name (e.g. "StandardMaterial3D", "Curve2D", "AtlasTexture")',
          ),
        properties: z
          .record(z.any())
          .optional()
          .describe(
            'Properties to set on the resource (e.g. {"albedo_color": {"r": 1, "g": 0, "b": 0}})',
          ),
        property_types: z
          .record(z.string())
          .optional()
          .describe(
            'Type hints for complex property values (e.g. {"albedo_color": "Color"})',
          ),
      },
    },
    async ({ project_path, output_path, resource_type, properties, property_types }) => {
      if (!validatePath(project_path) || !validatePath(output_path)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        const params: Record<string, unknown> = {
          outputPath: output_path,
          resourceType: resource_type,
        };

        if (properties) {
          params.properties = properties;
        }
        if (property_types) {
          params.propertyTypes = property_types;
        }

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path,
          'create_resource',
          params,
        );

        if (stderr && stderr.includes('Failed to')) {
          return toolError(`Failed to create resource: ${stderr}`, [
            'Check if the resource type is a valid Godot Resource class',
            'Ensure you have write permissions to the output path',
            'Verify the properties match the resource type',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Resource created successfully at: ${output_path}\nType: ${resource_type}\n\nOutput: ${stdout}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to create resource: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );
}
