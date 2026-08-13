/**
 * UID tool domain: get_uid, update_project_uids
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ServerContext } from '../types.js';
import { execGodot, runOperation, isGodot44OrLater, resolveWithinProject, validatePath } from '../godot.js';
import { toolError } from '../errors.js';

export function registerUidTools(server: McpServer, ctx: ServerContext): void {
  // Tool 13: get_uid
  server.registerTool(
    'get_uid',
    {
      title: 'Get UID',
      description:
        'Get the UID for a specific file in a Godot project (for Godot 4.4+)',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        file_path: z
          .string()
          .describe(
            'Path to the file (relative to project) for which to get the UID',
          ),
      },
    },
    async ({ project_path, file_path }) => {
      if (!validatePath(project_path) || !validatePath(file_path)) {
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

        const filePath = resolveWithinProject(project_path, file_path);
        if (filePath === null) {
          return toolError('Invalid file_path: path resolves outside the project directory', [
            'Use a path relative to the project root',
            'Do not use "..", absolute paths, or symlinks that escape the project',
          ]);
        }
        if (!existsSync(filePath)) {
          return toolError(`File does not exist: ${file_path}`, [
            'Ensure the file path is correct',
          ]);
        }

        // Check Godot version for UID support
        const { stdout: versionOutput } = await execGodot(ctx.godotPath, [
          '--version',
        ]);
        const version = versionOutput.trim();

        if (!isGodot44OrLater(version)) {
          return toolError(
            `UIDs are only supported in Godot 4.4 or later. Current version: ${version}`,
            [
              'Upgrade to Godot 4.4 or later to use UIDs',
              'Use resource paths instead of UIDs for this version of Godot',
            ],
          );
        }

        const params = { file_path: file_path };
        const result = await runOperation(ctx, project_path, 'get_uid', params);

        if (!result.ok) {
          return toolError(`Failed to get UID: ${result.error}`, [
            'Check if the file is a valid Godot resource',
            'Ensure the file path is correct',
          ]);
        }

        const data = result.data as { uid?: string; exists?: boolean; message?: string } | undefined;
        const text =
          data?.exists && data.uid
            ? `UID for ${file_path}: ${data.uid}`
            : `UID for ${file_path}: ${data?.message ?? 'UID not found'}`;

        return {
          content: [
            {
              type: 'text' as const,
              text,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to get UID: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool 14: update_project_uids
  server.registerTool(
    'update_project_uids',
    {
      title: 'Update Project UIDs',
      description:
        'Update UID references in a Godot project by resaving resources (for Godot 4.4+)',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
      },
    },
    async ({ project_path }) => {
      if (!validatePath(project_path)) {
        return toolError('Invalid project path', [
          'Provide a valid path without ".." or other potentially unsafe characters',
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

        // Check Godot version for UID support
        const { stdout: versionOutput } = await execGodot(ctx.godotPath, [
          '--version',
        ]);
        const version = versionOutput.trim();

        if (!isGodot44OrLater(version)) {
          return toolError(
            `UIDs are only supported in Godot 4.4 or later. Current version: ${version}`,
            [
              'Upgrade to Godot 4.4 or later to use UIDs',
              'Use resource paths instead of UIDs for this version of Godot',
            ],
          );
        }

        const params = { project_path: project_path };
        const result = await runOperation(ctx, project_path, 'resave_resources', params);

        if (!result.ok) {
          return toolError(`Failed to update project UIDs: ${result.error}`, [
            'Check if the project is valid',
            'Ensure you have write permissions to the project directory',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Project UIDs updated successfully.\n\nOutput: ${JSON.stringify(result.data ?? {}, null, 2)}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to update project UIDs: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );
}
