/**
 * UID tool domain: get_uid, update_project_uids
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync } from 'fs';
import type { ServerContext } from '../types.js';
import { execGodot, runOperation, isGodot44OrLater, resolveWithinProject } from '../godot.js';
import { toolError } from '../errors.js';
import { withProject, outsideProjectError, opSuccess, textResult } from './common.js';

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
    withProject(
      {
        catchPrefix: 'Failed to get UID',
        extraPaths: (a) => [a.file_path],
      },
      async ({ project_path, file_path }) => {
        const filePath = resolveWithinProject(project_path, file_path);
        if (filePath === null) {
          return outsideProjectError('file_path');
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

        return textResult(text);
      },
    ),
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
    withProject(
      {
        catchPrefix: 'Failed to update project UIDs',
      },
      async ({ project_path }) => {
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

        // The resave_resources op prints {"success": true, ...} unconditionally,
        // even when individual scenes failed to load or save — it only counts
        // those failures in scenes_errors (ledgered v2.1 handoff note). Gate
        // success on the actual per-scene verdict.
        const data = result.data as { scenes_errors?: number } | undefined;
        if (typeof data?.scenes_errors === 'number' && data.scenes_errors > 0) {
          return toolError(
            `Failed to update project UIDs: ${data.scenes_errors} scene(s) failed to resave`,
            [
              'Check the Godot output for scenes that failed to load or save',
              'Ensure you have write permissions to the project directory',
              'Fix or remove corrupted scene files, then retry',
            ],
          );
        }

        return opSuccess('Project UIDs updated successfully.', result.data);
      },
    ),
  );
}
