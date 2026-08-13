/**
 * Resource tool domain: read_resource, create_resource, modify_resource
 *
 * read_resource uses the TypeScript parser for fast, zero-latency reads.
 * create_resource delegates to Godot headless for correct type serialization.
 * modify_resource loads an existing .tres, sets properties, and saves it back.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import type { ServerContext } from '../types.js';
import { resolveWithinProject, runOperation } from '../godot.js';
import { toolError } from '../errors.js';
import { withProject, outsideProjectError, opSuccess, textResult } from './common.js';
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
    withProject(
      {
        catchPrefix: 'Failed to read resource',
        catchSuggestions: [
          'Ensure the resource file is a valid .tres file',
          'Check if the file is not corrupted',
          'Verify the resource path is correct',
        ],
        extraPaths: (a) => [a.resource_path],
      },
      async ({ project_path, resource_path }) => {
        const resourceFilePath = resolveWithinProject(project_path, resource_path);
        if (resourceFilePath === null) {
          return outsideProjectError('resource_path');
        }
        if (!existsSync(resourceFilePath)) {
          return toolError(`Resource file does not exist: ${resource_path}`, [
            'Ensure the resource path is correct',
            'Check if the .tres file exists in the project',
          ]);
        }

        const content = readFileSync(resourceFilePath, 'utf-8');
        const parsed = parseResource(content);

        return textResult(JSON.stringify(parsed, null, 2));
      },
    ),
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
    withProject(
      {
        catchPrefix: 'Failed to create resource',
        extraPaths: (a) => [a.output_path],
      },
      async ({ project_path, output_path, resource_type, properties, property_types }) => {
        if (resolveWithinProject(project_path, output_path) === null) {
          return outsideProjectError('output_path');
        }

        const params: Record<string, unknown> = {
          output_path: output_path,
          resource_type: resource_type,
        };

        if (properties) {
          params.properties = properties;
        }
        if (property_types) {
          params.property_types = property_types;
        }

        const result = await runOperation(ctx, project_path, 'create_resource', params);

        if (!result.ok) {
          return toolError(`Failed to create resource: ${result.error}`, [
            'Check if the resource type is a valid Godot Resource class',
            'Ensure you have write permissions to the output path',
            'Verify the properties match the resource type',
          ]);
        }

        return opSuccess(
          `Resource created successfully at: ${output_path}\nType: ${resource_type}`,
          result.data,
        );
      },
    ),
  );

  // modify_resource tool
  server.registerTool(
    'modify_resource',
    {
      title: 'Modify Resource',
      description:
        'Modify properties on an existing Godot resource file (.tres). Loads the resource, sets specified properties, and saves it back.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        resource_path: z
          .string()
          .describe(
            'Path to the resource file relative to project (e.g. "materials/ground.tres")',
          ),
        properties: z
          .record(z.any())
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
    withProject(
      {
        catchPrefix: 'Failed to modify resource',
        extraPaths: (a) => [a.resource_path],
      },
      async ({ project_path, resource_path, properties, property_types }) => {
        const resourceFilePath = resolveWithinProject(project_path, resource_path);
        if (resourceFilePath === null) {
          return outsideProjectError('resource_path');
        }
        if (!existsSync(resourceFilePath)) {
          return toolError(`Resource file does not exist: ${resource_path}`, [
            'Ensure the resource path is correct',
            'Use create_resource to create a new resource first',
          ]);
        }

        const params: Record<string, unknown> = {
          resource_path: resource_path,
          properties: properties,
        };

        if (property_types) {
          params.property_types = property_types;
        }

        const result = await runOperation(ctx, project_path, 'modify_resource', params);

        if (!result.ok) {
          return toolError(`Failed to modify resource: ${result.error}`, [
            'Check that the resource file exists and is valid',
            'Verify the property names match the resource type',
            'Ensure property types are correct',
          ]);
        }

        return opSuccess(`Resource modified successfully: ${resource_path}`, result.data);
      },
    ),
  );
}
