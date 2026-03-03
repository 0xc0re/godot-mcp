/**
 * Script tool domain: validate_scripts
 *
 * Batch-validates all GDScript files in a project via Godot headless.
 * Returns structured results with per-file validation status and error details.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ServerContext } from '../types.js';
import { executeOperation, validatePath } from '../godot.js';
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
          pathFilter: path_filter || '',
        };

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path,
          'validate_scripts',
          params,
        );

        // Parse the JSON line from Godot's mixed output
        const lines = stdout.split('\n');
        const jsonLine = lines.find((line) => line.trim().startsWith('{'));

        if (!jsonLine) {
          return toolError('Failed to parse validation results from Godot output', [
            'Godot may have encountered an error during validation',
            stderr ? `Stderr: ${stderr}` : 'No stderr output',
          ]);
        }

        const result = JSON.parse(jsonLine) as {
          results: Array<{ file: string; valid: boolean; error?: string }>;
          total: number;
          errors: number;
          valid: number;
        };

        // Format the output
        let text = `Validated ${result.total} files: ${result.valid} valid, ${result.errors} error${result.errors !== 1 ? 's' : ''}`;

        if (result.errors > 0) {
          text += '\n\nErrors:';
          for (const entry of result.results) {
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
}
