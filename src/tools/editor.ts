/**
 * Editor tool domain: launch_editor, run_project, stop_project, get_debug_output, capture_screenshot
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join, dirname } from 'path';
import { existsSync, writeFileSync, readFileSync, unlinkSync, statSync } from 'fs';
import { spawn } from 'child_process';
import type { ServerContext } from '../types.js';
import { validatePath, trackProcess, parseOperationOutput } from '../godot.js';
import { toolError } from '../errors.js';

/** 800KB threshold for screenshot resize (conservative limit under Claude Desktop's 1MB) */
const SCREENSHOT_SIZE_THRESHOLD = 800 * 1024;

/** 5 second timeout waiting for screenshot file to appear */
const SCREENSHOT_TIMEOUT_MS = 5000;

/** 100ms polling interval for screenshot file */
const SCREENSHOT_POLL_MS = 100;

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

  // Tool 5: capture_screenshot
  server.registerTool(
    'capture_screenshot',
    {
      title: 'Capture Screenshot',
      description:
        'Capture a screenshot of the running Godot game and return it as a base64-encoded PNG image. ' +
        'The ScreenshotHelper autoload (src/scripts/screenshot_helper.gd) must be added to the ' +
        'Godot project for this tool to work. It monitors a trigger file and captures the viewport on demand.',
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
        return toolError('No active Godot process. Cannot capture screenshot.', [
          'Use run_project to start a Godot project first',
          'Ensure the ScreenshotHelper autoload is added to the project',
        ]);
      }

      const triggerPath = join(project_path, '.godot', 'screenshot_trigger');
      const outputPath = join(project_path, '.godot', 'screenshot.png');

      try {
        // Write trigger file to signal the GDScript helper
        logDebug(`Writing screenshot trigger: ${triggerPath}`);
        writeFileSync(triggerPath, '');

        // Poll for the output PNG file
        const startTime = Date.now();
        await new Promise<void>((resolve, reject) => {
          const check = () => {
            if (existsSync(outputPath)) {
              resolve();
              return;
            }
            if (Date.now() - startTime >= SCREENSHOT_TIMEOUT_MS) {
              reject(new Error('timeout'));
              return;
            }
            setTimeout(check, SCREENSHOT_POLL_MS);
          };
          setTimeout(check, SCREENSHOT_POLL_MS);
        });

        // Check file size and resize if needed
        let fileSize = statSync(outputPath).size;
        if (fileSize > SCREENSHOT_SIZE_THRESHOLD) {
          logDebug(`Screenshot is ${fileSize} bytes, resizing to 960x540`);
          await resizeScreenshot(ctx, outputPath);
          fileSize = statSync(outputPath).size;
          logDebug(`Resized screenshot is ${fileSize} bytes`);
        }

        // Read and encode the screenshot
        const pngData = readFileSync(outputPath);
        const base64 = pngData.toString('base64');

        // Cleanup
        try {
          unlinkSync(outputPath);
        } catch {
          // Ignore cleanup errors
        }
        try {
          if (existsSync(triggerPath)) {
            unlinkSync(triggerPath);
          }
        } catch {
          // Ignore cleanup errors
        }

        return {
          content: [
            {
              type: 'image' as const,
              data: base64,
              mimeType: 'image/png',
            },
          ],
        };
      } catch (error: unknown) {
        if (error instanceof Error && error.message === 'timeout') {
          return toolError(
            'Screenshot capture timed out. The screenshot file was not produced within 5 seconds.',
            [
              'Ensure the ScreenshotHelper autoload is added to the Godot project',
              'Verify the game is running and rendering frames',
              'Check that the .godot/ directory exists in the project',
            ],
          );
        }

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to capture screenshot: ${errorMessage}`, [
          'Ensure the game is running via run_project',
          'Verify the ScreenshotHelper autoload is configured',
        ]);
      }
    },
  );
}

/** Target dimensions for screenshot resize (keeps images under Claude Desktop's 1MB limit). */
const RESIZE_WIDTH = 960;
const RESIZE_HEIGHT = 540;

/**
 * Resize a screenshot PNG to 960x540 using Godot headless.
 *
 * Runs the static src/scripts/resize_image.gd script, passing the image path
 * and dimensions as positional argv after --script. No script source is ever
 * generated at runtime, so a crafted image path cannot inject GDScript.
 */
function resizeScreenshot(ctx: ServerContext, imagePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Derive the script location from operationsScriptPath so this works from
    // both the src/ and build/ layouts (the scripts live side by side).
    const resizeScriptPath = join(dirname(ctx.operationsScriptPath), 'resize_image.gd');

    const proc = trackProcess(
      ctx,
      spawn(
        ctx.godotPath,
        [
          '--headless',
          '--script',
          resizeScriptPath,
          imagePath,
          String(RESIZE_WIDTH),
          String(RESIZE_HEIGHT),
        ],
        { stdio: 'pipe' },
      ),
    );

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    proc.stdout?.on('data', (data: Buffer) => stdoutChunks.push(data.toString()));
    proc.stderr?.on('data', (data: Buffer) => stderrChunks.push(data.toString()));

    proc.on('close', (code: number | null) => {
      const result = parseOperationOutput(
        stdoutChunks.join(''),
        stderrChunks.join(''),
        code,
      );
      if (result.ok) {
        resolve();
      } else {
        reject(new Error(result.error ?? `Resize process exited with code ${code}`));
      }
    });

    proc.on('error', (err: Error) => {
      reject(err);
    });
  });
}
