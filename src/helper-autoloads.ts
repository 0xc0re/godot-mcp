/**
 * Auto-registration of the MCP runtime helper autoloads.
 *
 * The runtime inspection tools (inspect_scene_tree, inspect_node,
 * inspect_group) and capture_screenshot depend on runtime_helper.gd /
 * screenshot_helper.gd being registered as autoloads in the target project.
 * Historically that was a manual setup step (v2.0 audit tech-debt item).
 *
 * ensureRuntimeHelperAutoloads() copies the helper scripts into the project
 * (addons/godot_mcp/) and registers them via the same modify_project_setting
 * machinery add_autoload uses, following the T7-hardened res:// convention:
 * the value is built from a clean project-relative path so a corrupt
 * "res://res://..." entry can never be written.
 *
 * Deliberately a plain helper function called by run_project /
 * restart_project — not a subsystem. (Track E1 later folds helper injection
 * into run_project proper; this stays minimal and compatible.)
 */

import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import type { ServerContext } from './types.js';
import { runOperation } from './godot.js';
import { parseProjectSettings } from './parsers/project-parser.js';
import { logger } from './logger.js';

/** Helper autoloads the runtime tools depend on. */
export const HELPER_AUTOLOADS = [
  { name: 'RuntimeHelper', filename: 'runtime_helper.gd' },
  { name: 'ScreenshotHelper', filename: 'screenshot_helper.gd' },
] as const;

/** Project-relative directory the helper scripts are copied into. */
export const HELPER_DEST_DIR = 'addons/godot_mcp';

export interface EnsureHelpersResult {
  /** Autoloads newly registered in project.godot by this call. */
  registered: string[];
  /** Autoloads already registered (no Godot spawn needed). */
  alreadyRegistered: string[];
  /** Helpers that could not be copied or registered (with reason). */
  failed: string[];
}

/**
 * Ensure runtime_helper.gd / screenshot_helper.gd exist inside the project
 * and are registered as enabled autoloads.
 *
 * Best-effort: failures are reported in the result (and logged), never
 * thrown — a failed registration should not block running the project.
 * Fast path: when both autoloads are already registered, no Godot process
 * is spawned at all.
 */
export async function ensureRuntimeHelperAutoloads(
  ctx: ServerContext,
  projectPath: string,
): Promise<EnsureHelpersResult> {
  const result: EnsureHelpersResult = { registered: [], alreadyRegistered: [], failed: [] };

  // Read the current autoload section once (best-effort).
  let autoloadSection: Record<string, string> = {};
  try {
    const content = readFileSync(join(projectPath, 'project.godot'), 'utf-8');
    autoloadSection = parseProjectSettings(content).sections['autoload'] ?? {};
  } catch {
    // Unreadable project.godot: treat as "nothing registered" and let the
    // per-helper registration surface any real failure.
  }

  for (const helper of HELPER_AUTOLOADS) {
    try {
      const srcPath = join(dirname(ctx.operationsScriptPath), helper.filename);
      if (!existsSync(srcPath)) {
        result.failed.push(`${helper.name} (helper script missing: ${srcPath})`);
        continue;
      }

      // Copy the helper into the project if missing or stale.
      const destRel = `${HELPER_DEST_DIR}/${helper.filename}`;
      const destAbs = join(projectPath, destRel);
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
        mkdirSync(dirname(destAbs), { recursive: true });
        writeFileSync(destAbs, source, 'utf-8');
      }

      // Already registered as an enabled autoload pointing at our copy?
      // Raw values look like "*res://addons/godot_mcp/runtime_helper.gd"
      // (with surrounding quotes in project.godot).
      const rawValue = autoloadSection[helper.name];
      if (rawValue !== undefined && rawValue.includes(`*res://${destRel}`)) {
        result.alreadyRegistered.push(helper.name);
        continue;
      }

      // Register via the same machinery add_autoload uses. destRel is a
      // clean project-relative constant, so prefixing res:// here matches
      // the T7-hardened normalization (no res://res:// possible).
      const opResult = await runOperation(ctx, projectPath, 'modify_project_setting', {
        section: 'autoload',
        key: helper.name,
        value: `*res://${destRel}`,
        action: 'set',
      });

      if (opResult.ok) {
        result.registered.push(helper.name);
      } else {
        result.failed.push(`${helper.name} (${opResult.error ?? 'registration failed'})`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push(`${helper.name} (${message})`);
    }
  }

  if (result.failed.length > 0) {
    logger.debug(`Helper autoload registration issues: ${result.failed.join('; ')}`);
  }

  return result;
}
