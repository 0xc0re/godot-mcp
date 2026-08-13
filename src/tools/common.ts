/**
 * Shared preamble/response helpers for tool handlers.
 *
 * withProject() collapses the duplicated per-tool preamble (validate paths,
 * check project.godot exists) and the standard catch-all error triad into a
 * single wrapper. opSuccess() standardizes the "<message>\n\nOutput: <json>"
 * success shape so `undefined` payloads can never leak into responses.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { validatePath } from '../godot.js';
import { toolError, type ToolResult } from '../errors.js';

/**
 * Standard catch-block suggestions for tools that shell out to Godot.
 */
export const GODOT_ENV_SUGGESTIONS: string[] = [
  'Ensure Godot is installed correctly',
  'Check if the GODOT_PATH environment variable is set correctly',
  'Verify the project path is accessible',
];

/**
 * Validate that `projectPath` is a safe, existing Godot project directory.
 *
 * Returns a standard toolError() response if the path is invalid or doesn't
 * contain a project.godot file, or null when the project is valid.
 */
export function ensureProject(projectPath: string): ToolResult | null {
  if (!validatePath(projectPath)) {
    return toolError('Invalid path', [
      'Provide valid paths without ".." or other potentially unsafe characters',
    ]);
  }

  const projectFile = join(projectPath, 'project.godot');
  if (!existsSync(projectFile)) {
    return toolError(`Not a valid Godot project: ${projectPath}`, [
      'Ensure the path points to a directory containing a project.godot file',
      'Use list_projects to find valid Godot projects',
    ]);
  }

  return null;
}

export interface WithProjectOptions<Args> {
  /** Catch-block error prefix, rendered as `${catchPrefix}: ${message}`. */
  catchPrefix: string;
  /** Catch-block suggestions. Defaults to GODOT_ENV_SUGGESTIONS. */
  catchSuggestions?: string[];
  /**
   * Additional path-like arg values (besides project_path) validated with
   * validatePath() before the project.godot check. `undefined` entries
   * (optional params) are skipped.
   */
  extraPaths?: (args: Args) => Array<string | undefined>;
}

/**
 * Wrap a tool handler with the standard project preamble and catch triad:
 *
 * 1. validatePath() on project_path and any extraPaths -> 'Invalid path' error
 * 2. project.godot existence check -> 'Not a valid Godot project' error
 * 3. handler() inside try/catch -> `${catchPrefix}: ${message}` error
 *
 * Response shapes are byte-identical to the preambles this replaces.
 */
export function withProject<Args extends { project_path: string }>(
  opts: WithProjectOptions<Args>,
  handler: (args: Args) => Promise<ToolResult> | ToolResult,
): (args: Args) => Promise<ToolResult> {
  return async (args: Args): Promise<ToolResult> => {
    const paths = [args.project_path, ...(opts.extraPaths?.(args) ?? [])];
    for (const path of paths) {
      if (path !== undefined && !validatePath(path)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }
    }

    try {
      const projectFile = join(args.project_path, 'project.godot');
      if (!existsSync(projectFile)) {
        return toolError(`Not a valid Godot project: ${args.project_path}`, [
          'Ensure the path points to a directory containing a project.godot file',
          'Use list_projects to find valid Godot projects',
        ]);
      }

      return await handler(args);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return toolError(
        `${opts.catchPrefix}: ${errorMessage}`,
        opts.catchSuggestions ?? GODOT_ENV_SUGGESTIONS,
      );
    }
  };
}

/**
 * Standard error for a relative path that resolveWithinProject() rejected.
 */
export function outsideProjectError(paramName: string): ToolResult {
  return toolError(`Invalid ${paramName}: path resolves outside the project directory`, [
    'Use a path relative to the project root',
    'Do not use "..", absolute paths, or symlinks that escape the project',
  ]);
}

/**
 * Cap on retained stdout/stderr lines for a spawned game process
 * (run_project / restart_project). The buffers behave as a bounded window:
 * once the cap is reached the OLDEST lines are dropped, so get_debug_output
 * and stop_project always return the most recent MAX_PROCESS_OUTPUT_LINES
 * lines. Prevents unbounded memory growth from chatty games.
 */
export const MAX_PROCESS_OUTPUT_LINES = 1000;

/**
 * Append lines to a process output buffer, enforcing the bounded window.
 * Mutates `buffer` in place (the buffer is shared via ctx.activeProcess).
 */
export function appendCapped(
  buffer: string[],
  lines: string[],
  cap: number = MAX_PROCESS_OUTPUT_LINES,
): void {
  buffer.push(...lines);
  if (buffer.length > cap) {
    buffer.splice(0, buffer.length - cap);
  }
}

/**
 * Plain text success response.
 */
export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * Standard operation success response: message plus the op's JSON payload.
 *
 * Always pretty-prints and falls back to {} so "Output: undefined" can never
 * be rendered for legacy no-verdict operations (ok:true with no data).
 */
export function opSuccess(message: string, data: unknown): ToolResult {
  return textResult(`${message}\n\nOutput: ${JSON.stringify(data ?? {}, null, 2)}`);
}
