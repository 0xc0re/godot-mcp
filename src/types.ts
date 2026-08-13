import { ChildProcess } from 'child_process';
import type { LspClient } from './lsp/client.js';
import type { HelperInjection } from './helper-autoloads.js';

/**
 * One captured line of process output, tagged with its source stream.
 */
export interface CapturedLine {
  stream: 'stdout' | 'stderr';
  text: string;
}

/**
 * Interface representing a running Godot process
 */
export interface GodotProcess {
  process: ChildProcess;
  output: string[];
  errors: string[];
  /**
   * Chronological interleave of stdout+stderr lines. Same bounded window
   * as output/errors (appendCapped drops the OLDEST entries at the cap).
   * Optional for backward compatibility with hand-built records; the
   * appendProcessOutput helper creates it on first append.
   */
  combined?: CapturedLine[];
  /**
   * Monotonic count of every line ever appended to `combined`. Never
   * decreases when the bounded window evicts old lines, so
   * get_debug_output's since_line cursor can detect eviction
   * (cursor < totalLines - combined.length -> truncated).
   */
  totalLines?: number;
}

/**
 * Shared server context passed to all tool modules
 */
export interface ServerContext {
  godotPath: string;
  operationsScriptPath: string;
  activeProcess: GodotProcess | null;
  trackedProcesses: Set<ChildProcess>;
  validatedPaths: Map<string, boolean>;
  /** Reusable LSP client connection to Godot's language server */
  lspClient?: LspClient;
  /** Headless Godot editor process spawned for LSP, if any */
  lspProcess?: ChildProcess;
  /**
   * Restoration record for the temporarily injected RuntimeHelper autoload
   * (see helper-autoloads.ts). Non-null only while an injection is live.
   */
  helperInjection?: HelperInjection | null;
  /**
   * In-flight restore write, tracked so injectRuntimeHelper can wait it out
   * before reading project.godot (a spontaneous game exit fires an
   * unawaited restore from the exit handler). Cleared when the write lands.
   */
  helperRestoreInFlight?: Promise<boolean> | null;
}

/**
 * Interface for operation parameters sent to GDScript
 */
export interface OperationParams {
  [key: string]: unknown;
}
