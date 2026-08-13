/**
 * Shared preamble helpers for tool handlers.
 *
 * Currently used by restart_project (runtime.ts); later tasks will collapse
 * the remaining ~54 duplicated "validate project path + check project.godot
 * exists" preambles onto this.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { validatePath } from '../godot.js';
import { toolError, type ToolResult } from '../errors.js';

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
