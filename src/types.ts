import { ChildProcess } from 'child_process';

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
}

/**
 * Interface for operation parameters sent to GDScript
 */
export interface OperationParams {
  [key: string]: unknown;
}
