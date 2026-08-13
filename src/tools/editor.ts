/**
 * Editor tool domain: launch_editor, run_project, stop_project, get_debug_output, capture_screenshot
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join, dirname } from 'path';
import { existsSync, readFileSync, unlinkSync, statSync } from 'fs';
import { spawn } from 'child_process';
import type { ServerContext } from '../types.js';
import { validatePath, trackProcess, parseOperationOutput } from '../godot.js';
import { toolError } from '../errors.js';
import { withProject, textResult, appendCapped } from './common.js';
import { injectRuntimeHelper, restoreHelperInjection } from '../helper-autoloads.js';
import { triggerAndPoll } from './runtime.js';
import { logger } from '../logger.js';

/** 800KB threshold for screenshot resize (conservative limit under Claude Desktop's 1MB) */
const SCREENSHOT_SIZE_THRESHOLD = 800 * 1024;

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
    withProject(
      {
        catchPrefix: 'Failed to launch Godot editor',
      },
      async ({ project_path }) => {
        logger.debug(`Launching Godot editor for project: ${project_path}`);
        const proc = trackProcess(
          ctx,
          spawn(ctx.godotPath, ['-e', '--path', project_path], {
            stdio: 'pipe',
          }),
        );

        proc.on('error', (err: Error) => {
          console.error('Failed to start Godot editor:', err);
        });

        return textResult(
          `Godot editor launched successfully for project at ${project_path}.`,
        );
      },
    ),
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
        inject_helpers: z
          .boolean()
          .optional()
          .describe(
            'Temporarily inject the RuntimeHelper autoload so inspect_* and capture_screenshot ' +
              'work without manual setup (default true). The project.godot change is reverted on ' +
              'stop_project / process exit. Set false to run the project completely untouched.',
          ),
      },
    },
    withProject(
      {
        catchPrefix: 'Failed to run Godot project',
      },
      async ({ project_path, scene, inject_helpers }) => {
        // Claim any leftover injection record synchronously BEFORE killing,
        // so the outgoing process's exit handler no-ops and the restore is
        // fully awaited before we inject again (no delete-vs-set race).
        const restorePromise = restoreHelperInjection(ctx, ctx.helperInjection);

        // Kill any existing active process
        if (ctx.activeProcess) {
          logger.debug('Killing existing Godot process before starting a new one');
          ctx.activeProcess.process.kill();
        }
        await restorePromise;

        // Temporarily inject the RuntimeHelper autoload so inspect_* and
        // capture_screenshot work without manual setup. The previous
        // project.godot state is restored on stop_project / process exit.
        // Best-effort: a failure is surfaced in the response but never
        // blocks the run.
        const helpers =
          inject_helpers !== false ? await injectRuntimeHelper(ctx, project_path) : null;
        const injection = helpers?.injection ?? null;

        const cmdArgs = ['-d', '--path', project_path];
        if (scene && validatePath(scene)) {
          logger.debug(`Adding scene parameter: ${scene}`);
          cmdArgs.push(scene);
        }

        logger.debug(`Running Godot project: ${project_path}`);
        const proc = trackProcess(
          ctx,
          spawn(ctx.godotPath, cmdArgs, { stdio: 'pipe' }),
        );
        const output: string[] = [];
        const errors: string[] = [];

        // Output/error buffers are bounded windows (see MAX_PROCESS_OUTPUT_LINES
        // in common.ts): the oldest lines are dropped once the cap is reached.
        proc.stdout?.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n');
          appendCapped(output, lines);
          lines.forEach((line: string) => {
            if (line.trim()) logger.debug(`[Godot stdout] ${line}`);
          });
        });

        proc.stderr?.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n');
          appendCapped(errors, lines);
          lines.forEach((line: string) => {
            if (line.trim()) logger.debug(`[Godot stderr] ${line}`);
          });
        });

        proc.on('exit', (code: number | null) => {
          logger.debug(`Godot process exited with code ${code}`);
          if (ctx.activeProcess && ctx.activeProcess.process === proc) {
            ctx.activeProcess = null;
          }
          // Restore the injected autoload state (guarded — no-op if
          // stop_project or a newer run already claimed the record).
          void restoreHelperInjection(ctx, injection);
        });

        proc.on('error', (err: Error) => {
          console.error('Failed to start Godot process:', err);
          if (ctx.activeProcess && ctx.activeProcess.process === proc) {
            ctx.activeProcess = null;
          }
          void restoreHelperInjection(ctx, injection);
        });

        ctx.activeProcess = { process: proc, output, errors };

        let message = 'Godot project started in debug mode. Use get_debug_output to see output.';
        if (helpers === null) {
          message += ' Helper injection skipped (inject_helpers: false).';
        } else if (helpers.injected) {
          message += ' RuntimeHelper autoload injected (reverted on stop).';
        }
        if (helpers?.failed) {
          message += ` Warning: failed to inject RuntimeHelper autoload: ${helpers.failed}.`;
        }

        return textResult(message);
      },
    ),
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

      logger.debug('Stopping active Godot process');
      // Claim the injection record synchronously (the kill's exit handler
      // then no-ops) and restore the previous project.godot autoload state.
      const restorePromise = restoreHelperInjection(ctx, ctx.helperInjection);
      ctx.activeProcess.process.kill();
      const output = ctx.activeProcess.output;
      const errors = ctx.activeProcess.errors;
      ctx.activeProcess = null;
      const helpersRestored = await restorePromise;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                message: 'Godot project stopped',
                finalOutput: output,
                finalErrors: errors,
                helpersRestored,
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
        'Uses the RuntimeHelper autoload injected automatically by run_project (inject_helpers, ' +
        'default true). Not available for headless runs (no rendering surface).',
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
          'Do not pass inject_helpers: false — capture_screenshot needs the RuntimeHelper autoload',
        ]);
      }

      const outputPath = join(project_path, '.godot', 'screenshot.png');

      try {
        // Route through the shared RuntimeHelper IPC channel (screenshot is
        // one more command in runtime_helper.gd's dispatcher).
        logger.debug(`Requesting screenshot via RuntimeHelper IPC`);
        const ipcResult = await triggerAndPoll(project_path, 'screenshot', {});

        if (typeof ipcResult.error === 'string') {
          return toolError(`Failed to capture screenshot: ${ipcResult.error}`, [
            'Screenshots require a rendering surface — headless runs cannot capture the viewport',
            'Verify the game is running and rendering frames',
          ]);
        }

        if (!existsSync(outputPath)) {
          return toolError('Screenshot helper responded but no PNG file was produced.', [
            'Verify the game is running and rendering frames',
            'Check that the .godot/ directory exists in the project',
          ]);
        }

        // Check file size and resize if needed
        let fileSize = statSync(outputPath).size;
        if (fileSize > SCREENSHOT_SIZE_THRESHOLD) {
          logger.debug(`Screenshot is ${fileSize} bytes, resizing to 960x540`);
          await resizeScreenshot(ctx, outputPath);
          fileSize = statSync(outputPath).size;
          logger.debug(`Resized screenshot is ${fileSize} bytes`);
        }

        // Read and encode the screenshot
        const pngData = readFileSync(outputPath);
        const base64 = pngData.toString('base64');

        // Cleanup (the IPC trigger/result files are cleaned by triggerAndPoll)
        try {
          unlinkSync(outputPath);
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
            'Screenshot capture timed out. The RuntimeHelper did not respond within 5 seconds.',
            [
              'Ensure the project was started via run_project without inject_helpers: false',
              'Verify the game is running and rendering frames',
              'Check that the .godot/ directory exists in the project',
            ],
          );
        }

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to capture screenshot: ${errorMessage}`, [
          'Ensure the game is running via run_project',
          'Screenshots require a rendering surface — headless runs cannot capture the viewport',
        ]);
      }
    },
  );
}

/** Target dimensions for screenshot resize (keeps images under Claude Desktop's 1MB limit). */
const RESIZE_WIDTH = 960;
const RESIZE_HEIGHT = 540;

/** Timeout for the headless resize spawn — a hung Godot must not wedge capture_screenshot. */
const RESIZE_TIMEOUT_MS = 30_000;

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

    // Kill the spawn if it hangs; spawn() has no built-in timeout option
    // equivalent to execFile's, so enforce one manually.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, RESIZE_TIMEOUT_MS);

    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(`Screenshot resize timed out after ${RESIZE_TIMEOUT_MS / 1000} seconds`),
        );
        return;
      }
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
      clearTimeout(timer);
      reject(err);
    });
  });
}
