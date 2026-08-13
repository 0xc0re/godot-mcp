/**
 * Temporary injection lifecycle for the MCP runtime helper autoload.
 *
 * The runtime inspection tools (inspect_scene_tree, inspect_node,
 * inspect_group) and capture_screenshot depend on runtime_helper.gd being
 * registered as an autoload in the target project while the game runs.
 *
 * injectRuntimeHelper() copies runtime_helper.gd into the project's
 * .godot/mcp/ directory (Godot-ignored territory, never committed) and
 * TEMPORARILY adds the RuntimeHelper autoload entry to project.godot via the
 * same modify_project_setting machinery add_autoload uses, following the
 * T7-hardened res:// convention: the value is built from a clean
 * project-relative constant so a corrupt "res://res://..." entry can never
 * be written.
 *
 * restoreHelperInjection() undoes the project.godot change — deleting the
 * entry when it was absent before, or restoring the previous value when the
 * project already had a RuntimeHelper autoload of its own. It is hooked into
 * stop_project and run_project/restart_project's exit/error handlers, and is
 * guarded so concurrent callers (stop + exit event) restore exactly once.
 *
 * If the server dies without cleanup (kill -9), the stale entry still points
 * at .godot/mcp/runtime_helper.gd: the next injectRuntimeHelper() detects it
 * as our own leftover and self-heals (refreshes the script copy, adopts the
 * entry, no duplicate is ever written).
 */

import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import type { ServerContext } from './types.js';
import { runOperation } from './godot.js';
import { parseProjectSettings } from './parsers/project-parser.js';
import { logger } from './logger.js';

/** Autoload name the runtime tools talk to. */
export const HELPER_AUTOLOAD_NAME = 'RuntimeHelper';

/** Helper script filename (source lives next to godot_operations.gd). */
export const HELPER_FILENAME = 'runtime_helper.gd';

/** Project-relative directory the helper script is copied into. */
export const HELPER_DEST_DIR = '.godot/mcp';

/** Full autoload value written to project.godot ("*" = enabled). */
export const HELPER_AUTOLOAD_VALUE = `*res://${HELPER_DEST_DIR}/${HELPER_FILENAME}`;

/**
 * Record of one temporary injection, kept on ctx.helperInjection while the
 * game runs so the previous project.godot state can be restored afterwards.
 */
export interface HelperInjection {
  /** Project whose project.godot was modified. */
  projectPath: string;
  /**
   * Previous value of the RuntimeHelper autoload entry (surrounding quotes
   * stripped), or null when the entry was absent before injection.
   */
  previousValue: string | null;
}

export interface InjectHelpersResult {
  /** True when the autoload entry is in place (freshly written or adopted). */
  injected: boolean;
  /**
   * True when an entry pointing at our .godot/mcp copy already existed —
   * a leftover from a run that died without cleanup (kill -9) or an
   * idempotent re-run. The entry is adopted without spawning Godot.
   */
  selfHealed: boolean;
  /** Failure reason when injection could not complete (never thrown). */
  failed: string | null;
  /** Restoration record; null when project.godot was not touched. */
  injection: HelperInjection | null;
}

/** Strip one pair of surrounding double quotes from a raw parser value. */
function stripQuotes(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  return raw;
}

/**
 * Copy runtime_helper.gd into <project>/.godot/mcp/ and temporarily register
 * it as the RuntimeHelper autoload, recording the previous project.godot
 * state on ctx.helperInjection for later restoration.
 *
 * Best-effort: failures are reported in the result (and logged), never
 * thrown — a failed injection should not block running the project.
 * Fast path: when the entry already points at our copy (self-heal), no
 * Godot process is spawned at all.
 */
export async function injectRuntimeHelper(
  ctx: ServerContext,
  projectPath: string,
): Promise<InjectHelpersResult> {
  const result: InjectHelpersResult = {
    injected: false,
    selfHealed: false,
    failed: null,
    injection: null,
  };

  try {
    // 1. Copy the helper into the project if missing or stale.
    const srcPath = join(dirname(ctx.operationsScriptPath), HELPER_FILENAME);
    if (!existsSync(srcPath)) {
      result.failed = `helper script missing: ${srcPath}`;
      logger.debug(`Helper injection failed: ${result.failed}`);
      return result;
    }

    const destAbs = join(projectPath, HELPER_DEST_DIR, HELPER_FILENAME);
    const source = readFileSync(srcPath, 'utf-8');
    let needsCopy = true;
    if (existsSync(destAbs)) {
      try {
        needsCopy = readFileSync(destAbs, 'utf-8') !== source;
      } catch {
        needsCopy = true;
      }
    }
    if (needsCopy) {
      mkdirSync(join(projectPath, HELPER_DEST_DIR), { recursive: true });
      writeFileSync(destAbs, source, 'utf-8');
    }

    // 2. Read the current autoload entry (best-effort).
    let autoloadSection: Record<string, string> = {};
    try {
      const content = readFileSync(join(projectPath, 'project.godot'), 'utf-8');
      autoloadSection = parseProjectSettings(content).sections['autoload'] ?? {};
    } catch {
      // Unreadable project.godot: treat as "no entry" and let the
      // registration below surface any real failure.
    }
    const rawValue = autoloadSection[HELPER_AUTOLOAD_NAME];

    // 3. Self-heal / idempotent fast path: an entry already pointing at our
    //    .godot/mcp copy is our own leftover (previous run died without
    //    cleanup) — adopt it as "previously absent" so restoration removes
    //    it, and skip the Godot spawn entirely.
    if (rawValue !== undefined && rawValue.includes(HELPER_AUTOLOAD_VALUE)) {
      result.injected = true;
      result.selfHealed = true;
      result.injection = { projectPath, previousValue: null };
      ctx.helperInjection = result.injection;
      return result;
    }

    // 4. Temporarily set the autoload entry, recording the previous state.
    //    HELPER_AUTOLOAD_VALUE is built from a clean relative constant, so
    //    the T7-hardened res:// convention holds (no res://res:// possible).
    const previousValue = rawValue !== undefined ? stripQuotes(rawValue) : null;
    const opResult = await runOperation(ctx, projectPath, 'modify_project_setting', {
      section: 'autoload',
      key: HELPER_AUTOLOAD_NAME,
      value: HELPER_AUTOLOAD_VALUE,
      action: 'set',
    });

    if (!opResult.ok) {
      result.failed = opResult.error ?? 'autoload registration failed';
      logger.debug(`Helper injection failed: ${result.failed}`);
      return result;
    }

    result.injected = true;
    result.injection = { projectPath, previousValue };
    ctx.helperInjection = result.injection;
    return result;
  } catch (error: unknown) {
    result.failed = error instanceof Error ? error.message : String(error);
    logger.debug(`Helper injection failed: ${result.failed}`);
    return result;
  }
}

/**
 * Restore the project.godot autoload state recorded by injectRuntimeHelper.
 *
 * Guarded against double restoration: the record is claimed synchronously
 * (ctx.helperInjection cleared) before any async work, so of the several
 * callers that may race — stop_project, run_project's pre-run cleanup, and
 * the spawned process's exit/error handlers — exactly one performs the
 * restore and the rest no-op. Passing a stale record (no longer the current
 * ctx.helperInjection) is also a no-op.
 *
 * Best-effort: on failure the record is re-armed so a later run/stop can
 * retry (and the next injectRuntimeHelper self-heals regardless).
 *
 * Returns true when the previous state was successfully restored.
 */
export async function restoreHelperInjection(
  ctx: ServerContext,
  injection: HelperInjection | null | undefined,
): Promise<boolean> {
  if (!injection || ctx.helperInjection !== injection) {
    return false;
  }
  // Claim the record synchronously so concurrent callers no-op.
  ctx.helperInjection = null;

  const params =
    injection.previousValue === null
      ? { section: 'autoload', key: HELPER_AUTOLOAD_NAME, action: 'delete' }
      : {
          section: 'autoload',
          key: HELPER_AUTOLOAD_NAME,
          value: injection.previousValue,
          action: 'set',
        };

  const opResult = await runOperation(ctx, injection.projectPath, 'modify_project_setting', params);

  if (!opResult.ok) {
    logger.debug(
      `Failed to restore autoload state for ${injection.projectPath}: ${opResult.error ?? 'unknown error'}`,
    );
    // Re-arm for a later retry unless a newer injection took over meanwhile.
    if (ctx.helperInjection === null) {
      ctx.helperInjection = injection;
    }
    return false;
  }

  return true;
}
