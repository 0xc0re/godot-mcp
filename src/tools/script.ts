/**
 * Script tool domain: validate_scripts, list_scripts, query_class
 *
 * Batch-validates all GDScript files in a project via Godot headless.
 * Lists project scripts with introspection data (methods, properties, signals).
 * Queries Godot ClassDB for engine class metadata.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ServerContext } from '../types.js';
import { runOperation, validatePath } from '../godot.js';
import { toolError } from '../errors.js';

export function registerScriptTools(server: McpServer, ctx: ServerContext): void {
  // validate_scripts tool (SCRI-01)
  server.registerTool(
    'validate_scripts',
    {
      title: 'Validate Scripts',
      description:
        'Batch-validate all GDScript files in a project for parse errors. Returns a list of files with their validation status.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        path_filter: z
          .string()
          .optional()
          .describe(
            'Optional subdirectory to limit validation (e.g. "scripts/" to only check scripts/ folder). Defaults to entire project.',
          ),
      },
    },
    async ({ project_path, path_filter }) => {
      if (!validatePath(project_path)) {
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
          path_filter: path_filter || '',
        };

        const result = await runOperation(ctx, project_path, 'validate_scripts', params);

        if (!result.ok) {
          return toolError(`Failed to validate scripts: ${result.error}`, [
            'Godot may have encountered an error during validation',
            result.stderr ? `Stderr: ${result.stderr}` : 'No stderr output',
          ]);
        }

        // validate_scripts doesn't emit a success/error envelope, so parse the JSON
        // summary line out of stdout directly rather than relying on result.data.
        const lines = result.stdout.split('\n');
        const jsonLine = lines.find((line) => line.trim().startsWith('{'));

        if (!jsonLine) {
          return toolError('Failed to parse validation results from Godot output', [
            'Godot may have encountered an error during validation',
            result.stderr ? `Stderr: ${result.stderr}` : 'No stderr output',
          ]);
        }

        const parsed = JSON.parse(jsonLine) as {
          results: Array<{ file: string; valid: boolean; error?: string }>;
          total: number;
          errors: number;
          valid: number;
        };

        // Format the output
        let text = `Validated ${parsed.total} files: ${parsed.valid} valid, ${parsed.errors} error${parsed.errors !== 1 ? 's' : ''}`;

        if (parsed.errors > 0) {
          text += '\n\nErrors:';
          for (const entry of parsed.results) {
            if (!entry.valid) {
              text += `\n- ${entry.file}: ${entry.error || 'Unknown error'}`;
            }
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to validate scripts: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // list_scripts tool (SCRI-02)
  server.registerTool(
    'list_scripts',
    {
      title: 'List Scripts',
      description:
        'List all GDScript files in a project with introspection data: class name, methods, properties, and signals for each script.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        path_filter: z
          .string()
          .optional()
          .describe(
            'Subdirectory to limit search, e.g. "scripts/" (default: entire project)',
          ),
      },
    },
    async ({ project_path, path_filter }) => {
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
          path_filter: (path_filter as string) || '',
        };

        const result = await runOperation(ctx, project_path as string, 'list_scripts', params);

        if (!result.ok) {
          return toolError(`Failed to list scripts: ${result.error}`, [
            'Godot may have encountered an error during script listing',
            result.stderr ? `Stderr: ${result.stderr}` : 'No stderr output',
          ]);
        }

        // list_scripts doesn't emit a success/error envelope, so parse the JSON
        // summary line out of stdout directly rather than relying on result.data.
        const lines = result.stdout.split('\n');
        const jsonLine = lines.find((line) => line.trim().startsWith('{'));

        if (!jsonLine) {
          return toolError('Failed to parse script list from Godot output', [
            'Godot may have encountered an error during script listing',
            result.stderr ? `Stderr: ${result.stderr}` : 'No stderr output',
          ]);
        }

        const parsed = JSON.parse(jsonLine) as {
          scripts: Array<{
            path: string;
            class_name: string;
            methods: Array<{ name: string; args: number }>;
            properties: Array<{ name: string; type: number }>;
            signals: Array<{ name: string; args: number }>;
          }>;
          total: number;
        };

        // Format the output
        let text = `Found ${parsed.total} script${parsed.total !== 1 ? 's' : ''}`;

        for (const script of parsed.scripts) {
          text += `\n\n${script.path}`;
          if (script.class_name) {
            text += ` (class: ${script.class_name})`;
          }
          text += `\n  ${script.methods.length} method${script.methods.length !== 1 ? 's' : ''}`;
          text += `, ${script.properties.length} propert${script.properties.length !== 1 ? 'ies' : 'y'}`;
          text += `, ${script.signals.length} signal${script.signals.length !== 1 ? 's' : ''}`;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to list scripts: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // query_class tool (SCRI-04)
  server.registerTool(
    'query_class',
    {
      title: 'Query Class',
      description:
        'Query Godot ClassDB for a class\'s properties, methods, and signals. Use this to verify API correctness before generating code.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        class_name: z
          .string()
          .describe('Godot class name to query (e.g. Node2D, CharacterBody3D)'),
        no_inheritance: z
          .boolean()
          .optional()
          .describe(
            'If true, only return class-own members, not inherited (default: false)',
          ),
      },
    },
    async ({ project_path, class_name, no_inheritance }) => {
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
          class_name: class_name as string,
          no_inheritance: (no_inheritance as boolean) || false,
        };

        const result = await runOperation(ctx, project_path as string, 'query_class', params);

        if (!result.ok) {
          return toolError(`Failed to query class: ${result.error}`, [
            'Check that the class name is spelled correctly',
            'Use a built-in Godot class name like Node2D, CharacterBody3D, etc.',
          ]);
        }

        // query_class's success path doesn't emit a success envelope, so parse the
        // JSON line out of stdout directly rather than relying on result.data.
        const lines = result.stdout.split('\n');
        const jsonLine = lines.find((line) => line.trim().startsWith('{'));

        if (!jsonLine) {
          return toolError('Failed to parse class info from Godot output', [
            'Godot may have encountered an error during class query',
            result.stderr ? `Stderr: ${result.stderr}` : 'No stderr output',
          ]);
        }

        const parsed = JSON.parse(jsonLine) as Record<string, unknown>;

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
        return toolError(`Failed to query class: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );
}
