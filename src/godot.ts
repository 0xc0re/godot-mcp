/**
 * Godot process execution wrappers.
 *
 * Provides functions for detecting the Godot executable, validating paths,
 * and executing GDScript operations via headless Godot.
 */

import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { normalize } from 'path';
import { promisify } from 'util';
import type { ServerContext, OperationParams } from './types.js';

const execFileAsync = promisify(execFile);

// Check if debug mode is enabled
const DEBUG_MODE: boolean = process.env.DEBUG === 'true';
const GODOT_DEBUG_MODE: boolean = true; // Always use GODOT DEBUG MODE

function logDebug(message: string): void {
  if (DEBUG_MODE) {
    console.error(`[DEBUG] ${message}`);
  }
}

/**
 * Validate a path to prevent path traversal attacks.
 */
export function validatePath(path: string): boolean {
  if (!path || path.includes('..')) {
    return false;
  }
  return true;
}

/**
 * Check if a given path is a valid Godot executable.
 * Uses the validatedPaths cache from context when available.
 */
export async function isValidGodotPath(
  path: string,
  cache?: Map<string, boolean>,
): Promise<boolean> {
  if (cache?.has(path)) {
    return cache.get(path)!;
  }

  try {
    logDebug(`Validating Godot path: ${path}`);

    if (path !== 'godot' && !existsSync(path)) {
      logDebug(`Path does not exist: ${path}`);
      cache?.set(path, false);
      return false;
    }

    await execFileAsync(path, ['--version']);

    logDebug(`Valid Godot path: ${path}`);
    cache?.set(path, true);
    return true;
  } catch {
    logDebug(`Invalid Godot path: ${path}`);
    cache?.set(path, false);
    return false;
  }
}

/**
 * Detect the Godot executable path based on the operating system.
 * Checks GODOT_PATH env var, then platform-specific common locations.
 */
export async function detectGodotPath(
  cache?: Map<string, boolean>,
): Promise<string> {
  // Check environment variable first
  if (process.env.GODOT_PATH) {
    const normalizedPath = normalize(process.env.GODOT_PATH);
    logDebug(`Checking GODOT_PATH environment variable: ${normalizedPath}`);
    if (await isValidGodotPath(normalizedPath, cache)) {
      logDebug(`Using Godot path from environment: ${normalizedPath}`);
      return normalizedPath;
    }
    logDebug(`GODOT_PATH environment variable is invalid`);
  }

  // Auto-detect based on platform
  const osPlatform = process.platform;
  logDebug(`Auto-detecting Godot path for platform: ${osPlatform}`);

  const possiblePaths: string[] = ['godot'];

  if (osPlatform === 'darwin') {
    possiblePaths.push(
      '/Applications/Godot.app/Contents/MacOS/Godot',
      '/Applications/Godot_4.app/Contents/MacOS/Godot',
      `${process.env.HOME}/Applications/Godot.app/Contents/MacOS/Godot`,
      `${process.env.HOME}/Applications/Godot_4.app/Contents/MacOS/Godot`,
      `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Godot Engine/Godot.app/Contents/MacOS/Godot`,
    );
  } else if (osPlatform === 'win32') {
    possiblePaths.push(
      'C:\\Program Files\\Godot\\Godot.exe',
      'C:\\Program Files (x86)\\Godot\\Godot.exe',
      'C:\\Program Files\\Godot_4\\Godot.exe',
      'C:\\Program Files (x86)\\Godot_4\\Godot.exe',
      `${process.env.USERPROFILE}\\Godot\\Godot.exe`,
    );
  } else if (osPlatform === 'linux') {
    possiblePaths.push(
      '/usr/bin/godot',
      '/usr/local/bin/godot',
      '/snap/bin/godot',
      `${process.env.HOME}/.local/bin/godot`,
    );
  }

  for (const p of possiblePaths) {
    const normalizedPath = normalize(p);
    if (await isValidGodotPath(normalizedPath, cache)) {
      logDebug(`Found Godot at: ${normalizedPath}`);
      return normalizedPath;
    }
  }

  // Fallback to platform default
  console.error(`[SERVER] Could not find Godot in common locations for ${osPlatform}`);
  console.error(
    `[SERVER] Set GODOT_PATH=/path/to/godot environment variable to specify the correct path.`,
  );

  let fallback: string;
  if (osPlatform === 'win32') {
    fallback = normalize('C:\\Program Files\\Godot\\Godot.exe');
  } else if (osPlatform === 'darwin') {
    fallback = normalize('/Applications/Godot.app/Contents/MacOS/Godot');
  } else {
    fallback = normalize('/usr/bin/godot');
  }

  console.error(`[SERVER] Using default path: ${fallback}, but this may not work.`);
  return fallback;
}

/**
 * Execute a simple Godot command (e.g. --version).
 */
export async function execGodot(
  godotPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(godotPath, args);
  return { stdout: stdout ?? '', stderr: stderr ?? '' };
}

/**
 * Convert camelCase keys to snake_case for GDScript interop.
 */
function convertCamelToSnakeCase(params: OperationParams): OperationParams {
  const result: OperationParams = {};

  for (const key in params) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      const val = params[key];

      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        result[snakeKey] = convertCamelToSnakeCase(val as OperationParams);
      } else {
        result[snakeKey] = val;
      }
    }
  }

  return result;
}

/**
 * Execute a GDScript operation via headless Godot.
 *
 * Builds the command: godot --headless --path <project> --script <gd_script> <operation> <params_json>
 */
export async function executeOperation(
  ctx: ServerContext,
  projectPath: string,
  operation: string,
  params: OperationParams,
): Promise<{ stdout: string; stderr: string }> {
  logDebug(`Executing operation: ${operation} in project: ${projectPath}`);
  logDebug(`Original operation params: ${JSON.stringify(params)}`);

  const snakeCaseParams = convertCamelToSnakeCase(params);
  logDebug(`Converted snake_case params: ${JSON.stringify(snakeCaseParams)}`);

  const paramsJson = JSON.stringify(snakeCaseParams);

  const args = [
    '--headless',
    '--path',
    projectPath,
    '--script',
    ctx.operationsScriptPath,
    operation,
    paramsJson,
  ];

  if (GODOT_DEBUG_MODE) {
    args.push('--debug-godot');
  }

  logDebug(`Executing: ${ctx.godotPath} ${args.join(' ')}`);

  try {
    const { stdout, stderr } = await execFileAsync(ctx.godotPath, args);
    return { stdout: stdout ?? '', stderr: stderr ?? '' };
  } catch (error: unknown) {
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      const execError = error as Error & { stdout: string; stderr: string };
      return {
        stdout: execError.stdout ?? '',
        stderr: execError.stderr ?? '',
      };
    }
    throw error;
  }
}

/**
 * Check if a Godot version string is 4.4 or later.
 */
export function isGodot44OrLater(version: string): boolean {
  const match = version.match(/^(\d+)\.(\d+)/);
  if (match) {
    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    return major > 4 || (major === 4 && minor >= 4);
  }
  return false;
}
