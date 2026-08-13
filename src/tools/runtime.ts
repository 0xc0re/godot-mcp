/**
 * Runtime interaction tool domain: inspect_scene_tree, inspect_node,
 * inspect_group, restart_project, send_input, invoke_runtime, wait_for.
 *
 * Uses file-polling IPC with runtime_helper.gd autoload to inspect and drive
 * a running Godot game: live scene tree, node properties, group membership,
 * injected input events, structured method calls / property writes, and
 * condition polling.
 *
 * SECURITY: every runtime command takes structured params only (method
 * identifiers, typed args arrays, property paths, condition specs). There is
 * deliberately NO expression-string or script-source surface anywhere here.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import type { ServerContext } from '../types.js';
import { validatePath, trackProcess } from '../godot.js';
import { toolError } from '../errors.js';
import { withProject, textResult, appendCapped } from './common.js';
import { injectRuntimeHelper, restoreHelperInjection } from '../helper-autoloads.js';

/** Relative path within project to the trigger file */
const TRIGGER_PATH_SUFFIX = '.godot/runtime_trigger';

/** Relative path within project to the result file */
const OUTPUT_PATH_SUFFIX = '.godot/runtime_result.json';

/** Timeout in ms waiting for the runtime helper to respond */
const POLL_TIMEOUT_MS = 5000;

/** Polling interval in ms to check for result file */
const POLL_INTERVAL_MS = 100;

/** Default overall timeout in ms for a wait_for condition */
const WAIT_FOR_DEFAULT_TIMEOUT_MS = 10000;

/** Default interval in ms between wait_for condition polls */
const WAIT_FOR_POLL_INTERVAL_MS = 200;

/**
 * A plain GDScript identifier: the ONLY accepted shape for method names.
 * Anything with parens, dots, spaces, or operators (i.e. anything that could
 * be an expression) is rejected — structured params only, never code.
 */
const GDSCRIPT_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A property path: identifier optionally followed by :subname segments
 * (Godot's set_indexed syntax, e.g. "position:x"). Same anti-expression
 * rationale as GDSCRIPT_IDENTIFIER_RE.
 */
const PROPERTY_PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(:[A-Za-z_][A-Za-z0-9_]*)*$/;

/** Standard suggestions when the RuntimeHelper IPC channel times out. */
const HELPER_TIMEOUT_SUGGESTIONS = [
  'Ensure the RuntimeHelper autoload is injected (run_project with inject_helpers, default true)',
  'Verify the game is running and processing frames',
  'Check that the .godot/ directory exists in the project',
];

/**
 * Send a command to the runtime_helper.gd autoload and wait for its result.
 *
 * Shared IPC channel for the inspect_* tools AND capture_screenshot (the
 * screenshot helper was merged into runtime_helper.gd as one more command).
 *
 * Deletes any stale output file FIRST, then writes the trigger file. This
 * ordering matters: deleting after the trigger is written races the helper's
 * response — a leftover result from a previous command could be read as this
 * command's response, or the fresh response could be deleted before reading.
 *
 * After the trigger is written, polls for the output file. On success, reads
 * and parses the JSON, then cleans up both files.
 */
export async function triggerAndPoll(
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
        'The RuntimeHelper autoload is injected automatically by run_project (inject_helpers, default true).',
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
        'The RuntimeHelper autoload is injected automatically by run_project (inject_helpers, default true).',
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
        'The RuntimeHelper autoload is injected automatically by run_project (inject_helpers, default true).',
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
        inject_helpers: z
          .boolean()
          .optional()
          .describe(
            'Temporarily inject the RuntimeHelper autoload for the runtime tools (default true). ' +
              'Set false to relaunch the project completely untouched.',
          ),
      },
    },
    withProject(
      {
        catchPrefix: 'Failed to restart Godot project',
      },
      async ({ project_path, scene, inject_helpers }) => {
        if (!ctx.activeProcess) {
          return toolError('No active Godot process to restart', [
            'Use run_project to start a Godot project first',
          ]);
        }

        // Claim the outgoing run's injection record synchronously BEFORE
        // killing, so the old process's exit handler no-ops and the restore
        // is fully awaited before we inject again (no delete-vs-set race).
        const restorePromise = restoreHelperInjection(ctx, ctx.helperInjection);

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
        await restorePromise;

        // Temporarily inject the RuntimeHelper autoload before relaunching
        // (best-effort, mirrors run_project).
        const helpers =
          inject_helpers !== false ? await injectRuntimeHelper(ctx, project_path) : null;
        const injection = helpers?.injection ?? null;

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

        // Bounded windows (see MAX_PROCESS_OUTPUT_LINES in common.ts):
        // oldest lines are dropped once the cap is reached.
        proc.stdout?.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n');
          appendCapped(output, lines);
        });

        proc.stderr?.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n');
          appendCapped(errors, lines);
        });

        // Mirror run_project: clear activeProcess when the process dies so
        // later tools don't act on a dead handle, and restore the injected
        // autoload state (guarded — no-op if stop/restart already did).
        proc.on('exit', () => {
          if (ctx.activeProcess && ctx.activeProcess.process === proc) {
            ctx.activeProcess = null;
          }
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

  // Tool 5: send_input
  server.registerTool(
    'send_input',
    {
      title: 'Send Input',
      description:
        'Inject a parameterized input event into the running Godot project: an InputMap ' +
        'action press/release, a key event, or a mouse button event. Structured params ' +
        'only — event type plus typed fields; no free-form event data. ' +
        'Headless note: events flow through the Input singleton (action states update, ' +
        '_input callbacks fire) even under --headless, but behavior that needs a real ' +
        'window (focus, mouse capture, on-screen position hit-testing) is inert. ' +
        'The RuntimeHelper autoload is injected automatically by run_project (inject_helpers, default true).',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        input: z
          .object({
            event_type: z
              .enum(['action', 'key', 'mouse_button'])
              .describe('Which event to construct: InputEventAction, InputEventKey, or InputEventMouseButton'),
            action: z
              .string()
              .optional()
              .describe('InputMap action name (required for event_type "action")'),
            keycode: z
              .string()
              .optional()
              .describe('Key name, e.g. "Space", "A", "Escape" (required for event_type "key")'),
            button_index: z
              .number()
              .int()
              .min(1)
              .max(9)
              .optional()
              .describe('Mouse button index, 1 = left (event_type "mouse_button"; default 1)'),
            pressed: z
              .boolean()
              .optional()
              .describe('Pressed (true, default) or released (false)'),
            strength: z
              .number()
              .min(0)
              .max(1)
              .optional()
              .describe('Action strength 0..1 for analog-style actions (event_type "action")'),
            position: z
              .object({ x: z.number(), y: z.number() })
              .optional()
              .describe('Viewport position for mouse events'),
          })
          .describe('Structured input event spec'),
      },
    },
    withProject(
      { catchPrefix: 'Failed to send input' },
      async ({ project_path, input }) => {
        if (!ctx.activeProcess) {
          return toolError('No active Godot process. Cannot send input.', [
            'Use run_project to start a Godot project first',
            'Ensure the RuntimeHelper autoload is injected (inject_helpers, default true)',
          ]);
        }

        if (input.event_type === 'action' && !input.action) {
          return toolError("send_input: 'action' is required for event_type 'action'", [
            'Provide the InputMap action name, e.g. { event_type: "action", action: "jump" }',
          ]);
        }
        if (input.event_type === 'key' && !input.keycode) {
          return toolError("send_input: 'keycode' is required for event_type 'key'", [
            'Provide a key name, e.g. { event_type: "key", keycode: "Space" }',
          ]);
        }

        try {
          const result = await triggerAndPoll(project_path, 'send_input', input);
          if (typeof result.error === 'string') {
            return toolError(result.error, [
              'Use list_input_actions to see the actions defined in the project',
              'Check the event_type and its required fields',
            ]);
          }
          return textResult(JSON.stringify(result, null, 2));
        } catch (error: unknown) {
          if (error instanceof Error && error.message === 'timeout') {
            return toolError(
              'send_input timed out. The RuntimeHelper did not respond within 5 seconds.',
              HELPER_TIMEOUT_SUGGESTIONS,
            );
          }
          throw error;
        }
      },
    ),
  );

  // Tool 6: invoke_runtime
  server.registerTool(
    'invoke_runtime',
    {
      title: 'Invoke Runtime',
      description:
        'Call a method or set a property on a node in the running Godot project. ' +
        'Structured params only: a plain-identifier method name plus a typed args array, ' +
        'or a property path (e.g. "position" or "position:x") plus a typed value. ' +
        'Expression strings and script source are rejected by design — this is not an eval surface. ' +
        'Godot types are passed as {"type": "Vector2"|"Vector2i"|"Vector3"|"Vector3i"|"Color"|"NodePath", ' +
        '"value": [...]}. set_property reads the property back and returns the value the engine accepted. ' +
        'The RuntimeHelper autoload is injected automatically by run_project (inject_helpers, default true).',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        node_path: z.string().describe('Path to the target node, e.g. /root/Main/Player'),
        operation: z
          .enum(['call_method', 'set_property'])
          .describe('Whether to call a method or set a property'),
        method: z
          .string()
          .optional()
          .describe('Method name — plain identifier only (required for call_method)'),
        args: z
          .array(z.any())
          .optional()
          .describe('Typed args array for call_method (JSON values or {"type", "value"} specs)'),
        property: z
          .string()
          .optional()
          .describe(
            'Property path — identifier or colon-separated subpath like "position:x" (required for set_property)',
          ),
        value: z
          .any()
          .optional()
          .describe('Typed value for set_property (JSON value or {"type", "value"} spec)'),
      },
    },
    withProject(
      { catchPrefix: 'Failed to invoke runtime operation' },
      async ({ project_path, node_path, operation, method, args, value, property }) => {
        if (!ctx.activeProcess) {
          return toolError('No active Godot process. Cannot invoke runtime operation.', [
            'Use run_project to start a Godot project first',
            'Ensure the RuntimeHelper autoload is injected (inject_helpers, default true)',
          ]);
        }

        let params: Record<string, unknown>;
        if (operation === 'call_method') {
          if (!method || !GDSCRIPT_IDENTIFIER_RE.test(method)) {
            return toolError(
              'invoke_runtime: method must be a plain identifier (structured params only; ' +
                'expression strings are not accepted)',
              [
                'Pass the method name alone, e.g. method: "take_damage"',
                'Pass arguments via the typed args array, not inside the method string',
              ],
            );
          }
          params = { node_path, method, args: args ?? [] };
        } else {
          if (!property || !PROPERTY_PATH_RE.test(property)) {
            return toolError(
              'invoke_runtime: property must be an identifier or colon-separated subpath ' +
                'like "position:x" (structured params only; expression strings are not accepted)',
              ['Pass the property path alone, e.g. property: "position:x"'],
            );
          }
          if (value === undefined) {
            return toolError("invoke_runtime: 'value' is required for set_property", [
              'Provide the value to assign (JSON value or {"type", "value"} spec)',
            ]);
          }
          params = { node_path, property, value };
        }

        try {
          const result = await triggerAndPoll(project_path, operation, params);
          if (typeof result.error === 'string') {
            return toolError(result.error, [
              'Use inspect_scene_tree to verify the node path',
              'Use inspect_node to see the node’s available properties',
            ]);
          }
          return textResult(JSON.stringify(result, null, 2));
        } catch (error: unknown) {
          if (error instanceof Error && error.message === 'timeout') {
            return toolError(
              'invoke_runtime timed out. The RuntimeHelper did not respond within 5 seconds.',
              HELPER_TIMEOUT_SUGGESTIONS,
            );
          }
          throw error;
        }
      },
    ),
  );

  // Tool 7: wait_for
  server.registerTool(
    'wait_for',
    {
      title: 'Wait For Condition',
      description:
        'Poll the running Godot project until a structured condition spec becomes true or a ' +
        'timeout elapses — replaces guess-timing sleeps. Condition types: node_exists ' +
        '(node_path), property (node_path + property + op eq/ne/gt/lt/ge/le + value, with ' +
        'optional float tolerance), group_count (group + op + value), elapsed_frames (frames ' +
        'since the wait started). Condition specs are structured data only — no expressions. ' +
        'Returns the observed value and poll count on success; a timeout reports the last ' +
        'observed value. ' +
        'The RuntimeHelper autoload is injected automatically by run_project (inject_helpers, default true).',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        condition: z
          .object({
            type: z
              .enum(['node_exists', 'property', 'group_count', 'elapsed_frames'])
              .describe('Condition type'),
            node_path: z
              .string()
              .optional()
              .describe('Node path (node_exists, property)'),
            property: z
              .string()
              .optional()
              .describe('Property path, identifier or "a:b" subpath (property)'),
            op: z
              .enum(['eq', 'ne', 'gt', 'lt', 'ge', 'le'])
              .optional()
              .describe('Comparison operator (property, group_count; default eq)'),
            value: z
              .any()
              .optional()
              .describe('Expected value (property, group_count; JSON value or {"type", "value"} spec)'),
            tolerance: z
              .number()
              .min(0)
              .optional()
              .describe('Absolute tolerance for float eq/ne comparisons (property)'),
            group: z.string().optional().describe('Group name (group_count)'),
            frames: z
              .number()
              .int()
              .positive()
              .optional()
              .describe('Number of engine frames to wait (elapsed_frames)'),
          })
          .describe('Structured condition spec'),
        timeout_ms: z
          .number()
          .int()
          .min(100)
          .max(120000)
          .optional()
          .describe(`Overall timeout in ms (default ${WAIT_FOR_DEFAULT_TIMEOUT_MS})`),
        poll_interval_ms: z
          .number()
          .int()
          .min(50)
          .max(5000)
          .optional()
          .describe(`Interval between condition polls in ms (default ${WAIT_FOR_POLL_INTERVAL_MS})`),
      },
    },
    withProject(
      { catchPrefix: 'Failed to wait for condition' },
      async ({ project_path, condition, timeout_ms, poll_interval_ms }) => {
        if (!ctx.activeProcess) {
          return toolError('No active Godot process. Cannot wait for condition.', [
            'Use run_project to start a Godot project first',
            'Ensure the RuntimeHelper autoload is injected (inject_helpers, default true)',
          ]);
        }

        // Per-type required fields (structured spec validation).
        switch (condition.type) {
          case 'node_exists':
            if (!condition.node_path) {
              return toolError("wait_for: 'node_path' is required for node_exists", []);
            }
            break;
          case 'property':
            if (!condition.node_path) {
              return toolError("wait_for: 'node_path' is required for property conditions", []);
            }
            if (!condition.property || !PROPERTY_PATH_RE.test(condition.property)) {
              return toolError(
                'wait_for: property must be an identifier or colon-separated subpath ' +
                  '(structured params only; expression strings are not accepted)',
                ['Pass the property path alone, e.g. property: "position:x"'],
              );
            }
            if (condition.value === undefined) {
              return toolError("wait_for: 'value' is required for property conditions", []);
            }
            break;
          case 'group_count':
            if (!condition.group) {
              return toolError("wait_for: 'group' is required for group_count", []);
            }
            if (condition.value === undefined) {
              return toolError("wait_for: 'value' is required for group_count", []);
            }
            break;
          case 'elapsed_frames':
            if (condition.frames === undefined) {
              return toolError("wait_for: 'frames' is required for elapsed_frames", []);
            }
            break;
        }

        const timeoutMs = timeout_ms ?? WAIT_FOR_DEFAULT_TIMEOUT_MS;
        const pollMs = poll_interval_ms ?? WAIT_FOR_POLL_INTERVAL_MS;
        const startTime = Date.now();
        let sinceFrame: number | null = null;
        let lastObserved: unknown = null;
        let polls = 0;

        for (;;) {
          const spec: Record<string, unknown> = { ...condition };
          if (condition.type === 'elapsed_frames' && sinceFrame !== null) {
            spec.since_frame = sinceFrame;
          }

          let result: Record<string, unknown>;
          try {
            result = await triggerAndPoll(project_path, 'check_condition', { condition: spec });
          } catch (error: unknown) {
            if (error instanceof Error && error.message === 'timeout') {
              return toolError(
                'wait_for: the RuntimeHelper did not respond within 5 seconds.',
                HELPER_TIMEOUT_SUGGESTIONS,
              );
            }
            throw error;
          }
          polls += 1;

          if (typeof result.error === 'string') {
            return toolError(`wait_for condition error: ${result.error}`, [
              'Check the condition spec (type, op, value shapes)',
            ]);
          }

          lastObserved = result.observed ?? null;

          if (condition.type === 'elapsed_frames' && sinceFrame === null) {
            // Baseline poll: anchor the frame window at the first response.
            sinceFrame = Number(result.observed ?? 0);
          } else if (result.passed === true) {
            return textResult(
              JSON.stringify(
                {
                  passed: true,
                  observed: lastObserved,
                  polls,
                  elapsed_ms: Date.now() - startTime,
                },
                null,
                2,
              ),
            );
          }

          if (Date.now() - startTime >= timeoutMs) {
            return toolError(
              `wait_for timed out after ${timeoutMs}ms; condition never became true. ` +
                `Last observed value: ${JSON.stringify(lastObserved)}`,
              [
                'Increase timeout_ms if the condition simply needs more time',
                'Verify the condition spec (node path, property name, expected value)',
                'Use inspect_node to check the current property value directly',
              ],
            );
          }

          await new Promise((resolve) => setTimeout(resolve, pollMs));
        }
      },
    ),
  );
}
