/**
 * Runtime inspection tool domain: inspect_scene_tree, inspect_node, inspect_group
 *
 * Uses file-polling IPC with runtime_helper.gd autoload to inspect a running
 * Godot game's live scene tree, node properties, and group membership.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import type { ServerContext } from '../types.js';
import { validatePath, trackProcess } from '../godot.js';
import { toolError } from '../errors.js';
import { withProject, textResult } from './common.js';

/** Relative path within project to the trigger file */
const TRIGGER_PATH_SUFFIX = '.godot/runtime_trigger';

/** Relative path within project to the result file */
const OUTPUT_PATH_SUFFIX = '.godot/runtime_result.json';

/** Timeout in ms waiting for the runtime helper to respond */
const POLL_TIMEOUT_MS = 5000;

/** Polling interval in ms to check for result file */
const POLL_INTERVAL_MS = 100;

/**
 * Send a command to the runtime_helper.gd autoload and wait for its result.
 *
 * Deletes any stale output file FIRST, then writes the trigger file. This
 * ordering matters: deleting after the trigger is written races the helper's
 * response — a leftover result from a previous command could be read as this
 * command's response, or the fresh response could be deleted before reading.
 *
 * After the trigger is written, polls for the output file. On success, reads
 * and parses the JSON, then cleans up both files.
 */
async function triggerAndPoll(
  projectPath: string,
  command: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const outputPath = join(projectPath, OUTPUT_PATH_SUFFIX);
  const triggerPath = join(projectPath, TRIGGER_PATH_SUFFIX);

  // Delete stale output file BEFORE writing the trigger so an old result
  // can never be mistaken for (or clobber) this command's response.
  try {
    if (existsSync(outputPath)) {
      unlinkSync(outputPath);
    }
  } catch {
    // Ignore cleanup errors
  }

  // Write the trigger file to request the command
  writeFileSync(triggerPath, JSON.stringify({ command, params }));

  // Poll for the response file
  const startTime = Date.now();
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (existsSync(outputPath)) {
        resolve();
        return;
      }
      if (Date.now() - startTime >= POLL_TIMEOUT_MS) {
        reject(new Error('timeout'));
        return;
      }
      setTimeout(check, POLL_INTERVAL_MS);
    };
    setTimeout(check, POLL_INTERVAL_MS);
  });

  // Read and parse the result
  const resultJson = readFileSync(outputPath, 'utf-8');
  const result = JSON.parse(resultJson) as Record<string, unknown>;

  // Cleanup both files
  try {
    unlinkSync(outputPath);
  } catch {
    // Ignore cleanup errors
  }
  try {
    unlinkSync(triggerPath);
  } catch {
    // Ignore cleanup errors
  }

  return result;
}

/**
 * Register runtime inspection tools on the MCP server.
 */
export function registerRuntimeTools(server: McpServer, ctx: ServerContext): void {
  // Tool 1: inspect_scene_tree
  server.registerTool(
    'inspect_scene_tree',
    {
      title: 'Inspect Scene Tree',
      description:
        'Get a snapshot of the live scene tree from a running Godot project. ' +
        'Returns node names, types, paths, and hierarchy as JSON. ' +
        'The RuntimeHelper autoload (src/scripts/runtime_helper.gd) must be added to the Godot project.',
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

      if (!ctx.activeProcess) {
        return toolError('No active Godot process. Cannot inspect scene tree.', [
          'Use run_project to start a Godot project first',
          'Ensure the RuntimeHelper autoload is added to the project',
        ]);
      }

      try {
        const result = await triggerAndPoll(project_path, 'scene_tree', {});

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        if (error instanceof Error && error.message === 'timeout') {
          return toolError(
            'Scene tree inspection timed out. The result was not produced within 5 seconds.',
            [
              'Ensure the RuntimeHelper autoload is added to the Godot project',
              'Verify the game is running and processing frames',
              'Check that the .godot/ directory exists in the project',
            ],
          );
        }

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to inspect scene tree: ${errorMessage}`, [
          'Ensure the game is running via run_project',
          'Verify the RuntimeHelper autoload is configured',
        ]);
      }
    },
  );

  // Tool 2: inspect_node
  server.registerTool(
    'inspect_node',
    {
      title: 'Inspect Node',
      description:
        'Inspect property values for a specific node in the running scene tree. ' +
        'Returns the node name, type, path, and a dictionary of property values. ' +
        'The RuntimeHelper autoload (src/scripts/runtime_helper.gd) must be added to the Godot project.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        node_path: z.string().describe('Path to the node, e.g. /root/Main/Player'),
      },
    },
    async ({ project_path, node_path }) => {
      if (!validatePath(project_path)) {
        return toolError('Invalid project path', [
          'Provide a valid path without ".." or other potentially unsafe characters',
        ]);
      }

      if (!ctx.activeProcess) {
        return toolError('No active Godot process. Cannot inspect node.', [
          'Use run_project to start a Godot project first',
          'Ensure the RuntimeHelper autoload is added to the project',
        ]);
      }

      try {
        const result = await triggerAndPoll(project_path, 'inspect_node', {
          node_path,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        if (error instanceof Error && error.message === 'timeout') {
          return toolError(
            'Node inspection timed out. The result was not produced within 5 seconds.',
            [
              'Ensure the RuntimeHelper autoload is added to the Godot project',
              'Verify the game is running and processing frames',
              'Check that the node path is correct',
            ],
          );
        }

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to inspect node: ${errorMessage}`, [
          'Ensure the game is running via run_project',
          'Verify the RuntimeHelper autoload is configured',
        ]);
      }
    },
  );

  // Tool 3: inspect_group
  server.registerTool(
    'inspect_group',
    {
      title: 'Inspect Group',
      description:
        'List all nodes in a specific group in the running scene tree. ' +
        'Returns the group name, node count, and array of nodes with name, type, and path. ' +
        'The RuntimeHelper autoload (src/scripts/runtime_helper.gd) must be added to the Godot project.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        group: z.string().describe('Group name to query'),
      },
    },
    async ({ project_path, group }) => {
      if (!validatePath(project_path)) {
        return toolError('Invalid project path', [
          'Provide a valid path without ".." or other potentially unsafe characters',
        ]);
      }

      if (!ctx.activeProcess) {
        return toolError('No active Godot process. Cannot inspect group.', [
          'Use run_project to start a Godot project first',
          'Ensure the RuntimeHelper autoload is added to the project',
        ]);
      }

      try {
        const result = await triggerAndPoll(project_path, 'get_group', {
          group,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        if (error instanceof Error && error.message === 'timeout') {
          return toolError(
            'Group inspection timed out. The result was not produced within 5 seconds.',
            [
              'Ensure the RuntimeHelper autoload is added to the Godot project',
              'Verify the game is running and processing frames',
              'Check that the group name is correct',
            ],
          );
        }

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to inspect group: ${errorMessage}`, [
          'Ensure the game is running via run_project',
          'Verify the RuntimeHelper autoload is configured',
        ]);
      }
    },
  );

  // Tool 4: restart_project
  server.registerTool(
    'restart_project',
    {
      title: 'Restart Project',
      description:
        'Stop the running Godot project and relaunch it. ' +
        'Use after making script changes to apply them. ' +
        'Returns confirmation with PID when the restarted project is running.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene: z.string().optional().describe('Optional: Specific scene to run after restart'),
      },
    },
    withProject(
      {
        catchPrefix: 'Failed to restart Godot project',
      },
      async ({ project_path, scene }) => {
        if (!ctx.activeProcess) {
          return toolError('No active Godot process to restart', [
            'Use run_project to start a Godot project first',
          ]);
        }

        // Kill existing process
        ctx.activeProcess.process.kill();

        // Wait for exit with 3s timeout
        await new Promise<void>((resolve) => {
          const proc = ctx.activeProcess!.process;
          proc.once('exit', () => resolve());
          setTimeout(() => resolve(), 3000);
        });

        // Clear old process state
        ctx.activeProcess = null;

        // Build args for new process
        const args = ['-d', '--path', project_path];
        if (scene && validatePath(scene)) {
          args.push(scene);
        }

        // Spawn new process
        const proc = trackProcess(
          ctx,
          spawn(ctx.godotPath, args, { stdio: 'pipe' }),
        );
        const output: string[] = [];
        const errors: string[] = [];

        proc.stdout?.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n');
          output.push(...lines);
        });

        proc.stderr?.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n');
          errors.push(...lines);
        });

        // Mirror run_project: clear activeProcess when the process dies so
        // later tools don't act on a dead handle.
        proc.on('exit', () => {
          if (ctx.activeProcess && ctx.activeProcess.process === proc) {
            ctx.activeProcess = null;
          }
        });

        proc.on('error', (err: Error) => {
          console.error('Failed to start Godot process:', err);
          if (ctx.activeProcess && ctx.activeProcess.process === proc) {
            ctx.activeProcess = null;
          }
        });

        ctx.activeProcess = { process: proc, output, errors };

        // Wait for first stdout data with 5s timeout (confirms engine is running)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => resolve(), 5000);
          proc.stdout?.once('data', () => {
            clearTimeout(timer);
            resolve();
          });
          proc.once('error', () => {
            clearTimeout(timer);
            resolve();
          });
        });

        return textResult(
          JSON.stringify({
            message: 'Project restarted successfully',
            pid: proc.pid,
            running: !proc.killed,
          }),
        );
      },
    ),
  );
}
