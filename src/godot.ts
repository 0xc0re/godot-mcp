/**
 * Godot process execution wrappers.
 *
 * Provides functions for detecting the Godot executable, validating paths,
 * and executing GDScript operations via headless Godot.
 */

import { existsSync, realpathSync } from 'fs';
import { execFile, type ChildProcess } from 'child_process';
import { normalize, resolve, relative, isAbsolute, dirname } from 'path';
import { promisify } from 'util';
import type { ServerContext, OperationParams } from './types.js';

const execFileAsync = promisify(execFile);

/** 10 MB max buffer for Godot process output */
const MAX_BUFFER = 10 * 1024 * 1024;

/** 30 second timeout for Godot process execution */
const EXEC_TIMEOUT = 30_000;

// Check if debug mode is enabled
const DEBUG_MODE: boolean = process.env.DEBUG === 'true';
const GODOT_DEBUG_MODE: boolean = process.env.GODOT_DEBUG === 'true';

function logDebug(message: string): void {
  if (DEBUG_MODE) {
    console.error(`[DEBUG] ${message}`);
  }
}

/**
 * Validate a path to prevent path traversal attacks.
 *
 * Rejects non-string/empty input, null bytes, and ".." segments.
 */
export function validatePath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) {
    return false;
  }
  if (path.includes('\0') || path.includes('..')) {
    return false;
  }
  return true;
}

/**
 * Check whether `candidate` is equal to or nested inside `root`.
 * Uses path.relative so it works regardless of trailing slashes/casing quirks.
 */
function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Resolve `relPath` against `projectRoot`, guaranteeing the result stays inside
 * the project directory. Defends against ".." traversal and symlink escapes.
 *
 * Accepts Godot's `res://` convention by stripping the prefix before resolving.
 * Returns the resolved absolute path, or null if the path is unsafe.
 */
export function resolveWithinProject(projectRoot: string, relPath: string): string | null {
  if (
    typeof relPath !== 'string' ||
    relPath.length === 0 ||
    relPath.includes('\0') ||
    typeof projectRoot !== 'string' ||
    projectRoot.includes('\0')
  ) {
    return null;
  }

  const strippedRelPath = relPath.startsWith('res://') ? relPath.slice('res://'.length) : relPath;

  const candidate = resolve(projectRoot, strippedRelPath);

  let realRoot: string;
  try {
    realRoot = realpathSync(projectRoot);
  } catch {
    realRoot = resolve(projectRoot);
  }

  if (!isWithinRoot(realRoot, candidate)) {
    return null;
  }

  if (existsSync(candidate)) {
    // Path exists: realpath it to defend against symlinks pointing outside the root.
    let realCandidate: string;
    try {
      realCandidate = realpathSync(candidate);
    } catch {
      return null;
    }
    return isWithinRoot(realRoot, realCandidate) ? realCandidate : null;
  }

  // Path doesn't exist yet (e.g. an output file about to be created): realpath the
  // nearest existing ancestor directory to catch symlink escapes further up the tree.
  let ancestor = dirname(candidate);
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      // Reached filesystem root without finding an existing ancestor.
      return null;
    }
    ancestor = parent;
  }

  try {
    const realAncestor = realpathSync(ancestor);
    if (!isWithinRoot(realRoot, realAncestor)) {
      return null;
    }
  } catch {
    return null;
  }

  return candidate;
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
 *
 * Hardened with maxBuffer (10MB) and timeout (30s) to prevent
 * crashes from large output and runaway processes.
 */
export async function execGodot(
  godotPath: string,
  args: string[],
  options?: { timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  const timeout = options?.timeout ?? EXEC_TIMEOUT;
  try {
    const { stdout, stderr } = await execFileAsync(godotPath, args, {
      maxBuffer: MAX_BUFFER,
      timeout,
    });
    return { stdout: stdout ?? '', stderr: stderr ?? '' };
  } catch (error: unknown) {
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      const execError = error as Error & { stdout: string; stderr: string; killed?: boolean };
      if (execError.killed) {
        throw new Error(`Godot process timed out after ${timeout / 1000} seconds`);
      }
      // Non-zero exit code still has output
      return { stdout: execError.stdout ?? '', stderr: execError.stderr ?? '' };
    }
    throw error;
  }
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
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
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

  const execPromise = execFileAsync(ctx.godotPath, args, {
    maxBuffer: MAX_BUFFER,
    timeout: EXEC_TIMEOUT,
  });

  try {
    const { stdout, stderr } = await execPromise;
    return {
      stdout: stdout ?? '',
      stderr: stderr ?? '',
      exitCode: execPromise.child?.exitCode ?? null,
    };
  } catch (error: unknown) {
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      const execError = error as Error & { stdout: string; stderr: string; killed?: boolean };
      if (execError.killed) {
        throw new Error('Godot operation timed out after 30 seconds');
      }
      return {
        stdout: execError.stdout ?? '',
        stderr: execError.stderr ?? '',
        exitCode: execPromise.child?.exitCode ?? null,
      };
    }
    throw error;
  }
}

/** Max length for an error message extracted from stderr, to keep responses readable. */
const MAX_ERROR_MESSAGE_LENGTH = 500;

function truncateError(message: string): string {
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...`
    : message;
}

/**
 * Result of running (and interpreting the output of) a GDScript operation.
 */
export interface OperationResult {
  ok: boolean;
  error?: string;
  /** Parsed JSON payload when the operation printed a trailing JSON verdict. */
  data?: unknown;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Interpret the stdout/stderr/exit code of a Godot operation into a verdict.
 *
 * Verdict tiers, in priority order:
 * 1. Trailing JSON on stdout (authoritative): scanned last -> first for the first line that
 *    parses as JSON and carries a `success` or `error` key. Debug/info noise lines that don't
 *    parse as JSON are skipped.
 * 2. Exit code: no JSON verdict found and the process exited non-zero -> failure, using the
 *    last non-empty stderr line as the error message.
 * 3. Stderr marker: exit 0, no JSON, but stderr contains an `[ERROR]` marker or a
 *    "Failed to " line -> failure.
 * 4. Otherwise: success (stderr warnings with exit 0 and no markers are OK).
 */
export function parseOperationOutput(
  stdout: string,
  stderr: string,
  exitCode: number | null,
): OperationResult {
  // Tier 1: trailing JSON verdict, scanned last -> first.
  const stdoutLines = stdout.split('\n');
  for (let i = stdoutLines.length - 1; i >= 0; i--) {
    const line = stdoutLines[i].trim();
    if (!line) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // Not JSON (debug noise, [INFO]/[DEBUG] lines, etc.) - keep scanning.
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      continue;
    }

    const obj = parsed as Record<string, unknown>;
    if (!('success' in obj) && !('error' in obj)) {
      continue;
    }

    if (obj.success === true) {
      return { ok: true, data: obj, stdout, stderr, exitCode };
    }

    // success === false, or an `error` key present with no `success` key.
    const errorMessage =
      typeof obj.error === 'string'
        ? obj.error
        : typeof obj.message === 'string'
          ? obj.message
          : 'Operation failed';
    return { ok: false, error: errorMessage, data: obj, stdout, stderr, exitCode };
  }

  // Tier 2: non-zero exit code.
  if (exitCode !== 0 && exitCode !== null) {
    const stderrLines = stderr
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const lastLine = stderrLines[stderrLines.length - 1];
    const error = truncateError(lastLine ?? `Godot exited with code ${exitCode}`);
    return { ok: false, error, stdout, stderr, exitCode };
  }

  // Tier 3: stderr error markers with a clean (or null) exit code.
  const stderrLines = stderr.split('\n');
  for (const rawLine of stderrLines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.includes('[ERROR]') || line.includes('Failed to ')) {
      return { ok: false, error: truncateError(line), stdout, stderr, exitCode };
    }
  }

  // Tier 4: no failure signal found.
  return { ok: true, stdout, stderr, exitCode };
}

/**
 * Run a GDScript operation and interpret its output into a verdict.
 *
 * Thin wrapper around executeOperation + parseOperationOutput. If executeOperation itself
 * throws (spawn failure, timeout), returns a failure OperationResult instead of throwing.
 */
export async function runOperation(
  ctx: ServerContext,
  projectPath: string,
  operation: string,
  params: OperationParams,
  options?: { timeout?: number },
): Promise<OperationResult> {
  void options; // Reserved for future use (e.g. per-operation timeout overrides).
  try {
    const { stdout, stderr, exitCode } = await executeOperation(ctx, projectPath, operation, params);
    return parseOperationOutput(stdout, stderr, exitCode);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, stdout: '', stderr: '', exitCode: null };
  }
}

/**
 * Track a spawned child process for cleanup on server shutdown.
 *
 * Adds the process to ctx.trackedProcesses and registers exit/error
 * listeners to automatically remove it when it terminates.
 * Returns the process for chaining.
 */
export function trackProcess(ctx: ServerContext, proc: ChildProcess): ChildProcess {
  ctx.trackedProcesses.add(proc);
  proc.once('exit', () => ctx.trackedProcesses.delete(proc));
  proc.once('error', () => ctx.trackedProcesses.delete(proc));
  return proc;
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
