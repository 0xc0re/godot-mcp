/**
 * Server context creation and configuration.
 *
 * Creates the shared ServerContext used by all tool modules.
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import type { ServerContext } from './types.js';
import { detectGodotPath } from './godot.js';

/**
 * Create and initialize a ServerContext.
 *
 * Detects the Godot executable path and resolves the operations script path.
 */
export async function createServerContext(): Promise<ServerContext> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const validatedPaths = new Map<string, boolean>();
  const godotPath = await detectGodotPath(validatedPaths);
  const operationsScriptPath = join(__dirname, 'scripts', 'godot_operations.gd');

  console.error(`[SERVER] Using Godot at: ${godotPath}`);

  return {
    godotPath,
    operationsScriptPath,
    activeProcess: null,
    trackedProcesses: new Set(),
    validatedPaths,
  };
}
