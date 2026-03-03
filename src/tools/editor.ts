/**
 * Editor tool domain: launch_editor, run_project, stop_project, get_debug_output
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import type { ServerContext } from '../types.js';
import { validatePath, trackProcess } from '../godot.js';
import { toolError } from '../errors.js';

const DEBUG_MODE: boolean = process.env.DEBUG === 'true';

function logDebug(message: string): void {
  if (DEBUG_MODE) {
    console.error(`[DEBUG] ${message}`);
  }
}

export function registerEditorTools(server: McpServer, ctx: ServerContext): void {
  // Tool 1: launch_editor
  server.registerTool(
    'launch_editor',
    {
      title: 'Launch Editor',
      description: 'Launch Godot editor for a specific project',
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

        logDebug(`Launching Godot editor for project: ${project_path}`);
        const proc = trackProcess(
          ctx,
          spawn(ctx.godotPath, ['-e', '--path', project_path], {
            stdio: 'pipe',
          }),
        );

        proc.on('error', (err: Error) => {
          console.error('Failed to start Godot editor:', err);
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `Godot editor launched successfully for project at ${project_path}.`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to launch Godot editor: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool 2: run_project
  server.registerTool(
    'run_project',
    {
      title: 'Run Project',
      description: 'Run the Godot project and capture output',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene: z.string().optional().describe('Optional: Specific scene to run'),
      },
    },
    async ({ project_path, scene }) => {
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

        // Kill any existing active process
        if (ctx.activeProcess) {
          logDebug('Killing existing Godot process before starting a new one');
          ctx.activeProcess.process.kill();
        }

        const cmdArgs = ['-d', '--path', project_path];
        if (scene && validatePath(scene)) {
          logDebug(`Adding scene parameter: ${scene}`);
          cmdArgs.push(scene);
        }

        logDebug(`Running Godot project: ${project_path}`);
        const proc = trackProcess(
          ctx,
          spawn(ctx.godotPath, cmdArgs, { stdio: 'pipe' }),
        );
        const output: string[] = [];
        const errors: string[] = [];

        proc.stdout?.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n');
          output.push(...lines);
          lines.forEach((line: string) => {
            if (line.trim()) logDebug(`[Godot stdout] ${line}`);
          });
        });

        proc.stderr?.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n');
          errors.push(...lines);
          lines.forEach((line: string) => {
            if (line.trim()) logDebug(`[Godot stderr] ${line}`);
          });
        });

        proc.on('exit', (code: number | null) => {
          logDebug(`Godot process exited with code ${code}`);
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

        return {
          content: [
            {
              type: 'text' as const,
              text: `Godot project started in debug mode. Use get_debug_output to see output.`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to run Godot project: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool 3: get_debug_output
  server.registerTool(
    'get_debug_output',
    {
      title: 'Get Debug Output',
      description: 'Get the current debug output and errors',
    },
    async () => {
      if (!ctx.activeProcess) {
        return toolError('No active Godot process.', [
          'Use run_project to start a Godot project first',
          'Check if the Godot process crashed unexpectedly',
        ]);
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                output: ctx.activeProcess.output,
                errors: ctx.activeProcess.errors,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Tool 4: stop_project
  server.registerTool(
    'stop_project',
    {
      title: 'Stop Project',
      description: 'Stop the currently running Godot project',
    },
    async () => {
      if (!ctx.activeProcess) {
        return toolError('No active Godot process to stop.', [
          'Use run_project to start a Godot project first',
          'The process may have already terminated',
        ]);
      }

      logDebug('Stopping active Godot process');
      ctx.activeProcess.process.kill();
      const output = ctx.activeProcess.output;
      const errors = ctx.activeProcess.errors;
      ctx.activeProcess = null;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                message: 'Godot project stopped',
                finalOutput: output,
                finalErrors: errors,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
