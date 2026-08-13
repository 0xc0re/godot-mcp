import { ChildProcess } from 'child_process';
import type { LspClient } from './lsp/client.js';
import type { HelperInjection } from './helper-autoloads.js';

/**
 * Interface representing a running Godot process
 */
export interface GodotProcess {
  process: ChildProcess;
  output: string[];
  errors: string[];
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
}

/**
 * Interface for operation parameters sent to GDScript
 */
export interface OperationParams {
  [key: string]: unknown;
}
