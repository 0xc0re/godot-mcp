# Coding Conventions

**Analysis Date:** 2026-03-03

## Naming Patterns

**Files:**
- Single monolithic source file: `src/index.ts`
- Supporting scripts: `src/scripts/[name].gd` (GDScript files)
- No separate component/module files

**Functions:**
- camelCase for all function names: `logDebug()`, `handleLaunchEditor()`, `normalizeParameters()`
- Private methods prefixed with `private`: `private async detectGodotPath()`
- Public methods prefixed with `public`: `public async setGodotPath()`
- Async functions use `async` keyword: `private async executeOperation()`
- Handler functions use `handle` prefix: `handleLaunchEditor()`, `handleRunProject()`, `handleCreateScene()`

**Variables:**
- camelCase for all variable names: `godotPath`, `activeProcess`, `debugMode`, `projectPath`
- Constants use UPPER_SNAKE_CASE: `DEBUG_MODE`, `GODOT_DEBUG_MODE`
- Private class properties use camelCase with `private` visibility: `private godotPath: string | null = null`
- Interface fields use camelCase: `godotPath?: string`, `debugMode?: boolean`

**Types:**
- PascalCase for interfaces: `GodotProcess`, `GodotServerConfig`, `OperationParams`
- Generic type parameters use single uppercase letters: `Promise<{ stdout: string; stderr: string }>`
- Union types use `|` operator: `string | null`, `string[]`

**Interfaces:**
- Descriptive names with "Config" suffix for configuration: `GodotServerConfig`
- Descriptive names with "Params" suffix for operation parameters: `OperationParams`
- JSDoc comments explaining purpose: `interface GodotProcess { ... }`

## Code Style

**Formatting:**
- TypeScript compiler (tsc) used for compilation, no explicit formatter enforced
- tsconfig.json specifies target ES2022, module ESNext
- Indentation: 2 spaces (evident from code samples)
- Line length: No enforced limit observed
- Strict TypeScript: `"strict": true` enables all strict checking

**Linting:**
- No eslint or prettier configuration found in repository
- Conventions appear to be adhered to manually

## Import Organization

**Order:**
1. Standard library imports (Node.js built-ins): `import { ... } from 'url'`, `import { ... } from 'path'`
2. External packages: `import { ... } from '@modelcontextprotocol/sdk/...'`
3. Local imports: None present (monolithic structure)

**Example from `src/index.ts` (lines 10-23):**
```typescript
import { fileURLToPath } from 'url';
import { join, dirname, basename, normalize } from 'path';
import { existsSync, readdirSync, mkdirSync } from 'fs';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
```

**Path Aliases:**
- None used - direct imports from node_modules and SDK

## Error Handling

**Pattern: Try-Catch with Structured Responses:**
```typescript
try {
  // Operation logic
  if (!condition) {
    return this.createErrorResponse(
      'User-facing error message',
      ['Possible solution 1', 'Possible solution 2']
    );
  }
  // Success logic
  return { content: [...] };
} catch (error: unknown) {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  return this.createErrorResponse(
    `Failed to [operation]: ${errorMessage}`,
    ['Ensure X is configured', 'Check Y is accessible']
  );
}
```

**Error Response Construction:**
- Use `createErrorResponse(message, possibleSolutions)` method for consistency
- Returns structured response with `content` array and `isError: true` flag
- Includes actionable solutions array as secondary content block
- Examples: `src/index.ts` lines 177-196, 964-1043

**Validation Errors:**
- Input validation returns early with `createErrorResponse()`
- Never throws; always returns error response object
- Path validation uses dedicated `validatePath()` method (line 207)

**Async Error Handling:**
- Type-guard for unknown errors: `error instanceof Error ? error.message : 'Unknown error'`
- Special handling for execFile errors: `if (error instanceof Error && 'stdout' in error && 'stderr' in error)`
- Logs errors to stderr using `console.error()` with `[SERVER]` prefix

**Logging Pattern:**
- Debug logs use `logDebug()` method (line 168): writes to stderr with `[DEBUG]` prefix
- Error logs use `console.error()` with context prefix: `[SERVER]`, `[MCP Error]`
- No stdout logging for operational messages (only info in tool responses)

## Logging

**Framework:** console (built-in Node.js)

**Debug Logging:**
- Controlled by `DEBUG` environment variable (`process.env.DEBUG === 'true'`)
- Uses `stderr` to avoid interfering with JSON-RPC communication (see line 167 comment)
- Prefix: `[DEBUG]`
- Called via `this.logDebug(message)` private method

**Error Logging:**
- Direct `console.error()` calls with context prefixes
- Prefixes: `[SERVER]`, `[MCP Error]`, `[DEBUG]`
- Examples: lines 155, 179, 336-337

**Patterns:**
```typescript
// Debug logging (example from line 136)
if (debugMode) console.error(`[DEBUG] Operations script path: ${this.operationsScriptPath}`);

// Error response logging (line 179)
console.error(`[SERVER] Error response: ${message}`);

// MCP error handler (line 155)
this.server.onerror = (error) => console.error('[MCP Error]', error);
```

## Comments

**When to Comment:**
- JSDoc comments required for all interfaces and public methods
- Inline comments for non-obvious logic or workarounds
- Comments explain WHY not WHAT (code is self-documenting)

**JSDoc/TSDoc Pattern:**
- All interfaces documented: `/** Interface representing a running Godot process */`
- All major methods documented with purpose and parameters
- Format: `/** [Description]\n * @param [name] [description]\n * @returns [description] */`

**Examples from codebase:**
```typescript
/**
 * Interface representing a running Godot process
 */
interface GodotProcess {
  process: any;
  output: string[];
  errors: string[];
}

/**
 * Log debug messages if debug mode is enabled
 * Using stderr instead of stdout to avoid interfering with JSON-RPC communication
 */
private logDebug(message: string): void {
  if (DEBUG_MODE) {
    console.error(`[DEBUG] ${message}`);
  }
}

/**
 * Validate if a Godot path is valid and executable
 */
private async isValidGodotPath(path: string): Promise<boolean> {
  // Check cache first
  if (this.validatedPaths.has(path)) {
    return this.validatedPaths.get(path)!;
  }
  // ... implementation
}
```

## Function Design

**Size:** Functions range from 10-50 lines; handler functions longer due to parameter validation and error handling chains

**Parameters:**
- Explicit typed parameters preferred
- Use object/interface parameters for multiple related values: `config?: GodotServerConfig`
- Avoid long parameter lists; use `args: any` for tool handlers that normalize internally

**Return Values:**
- Async operations return `Promise<T>`
- Error handling functions return union type with error responses: `Promise<any>` (catches both error and success)
- Tool handlers return: `{ content: [...], isError?: boolean }`
- Internal operations return specific types: `Promise<{ stdout: string; stderr: string }>`

**Example function signature (line 474-475):**
```typescript
private async executeOperation(
  operation: string,
  params: OperationParams,
  projectPath: string
): Promise<{ stdout: string; stderr: string }>
```

## Module Design

**Exports:**
- No explicit exports; single class `GodotServer` instantiated and server started
- Entry point creates server instance and connects stdin/stdout (line 2196+)
- Singleton pattern: single server instance manages all state

**Class Organization:**
- Single `GodotServer` class in `src/index.ts`
- Private properties for state: `godotPath`, `activeProcess`, `server`
- Private helper methods for internal logic: `detectGodotPath()`, `validatePath()`, `logDebug()`
- Private handler methods for each tool: `handleLaunchEditor()`, `handleRunProject()`, etc.
- Constructor takes optional `GodotServerConfig`

**Constructor Pattern (lines 100-157):**
```typescript
constructor(config?: GodotServerConfig) {
  this.server = new Server({...});
  // Initialize from config
  if (config) {
    if (config.debugMode !== undefined) {
      DEBUG_MODE = config.debugMode;
    }
    if (config.godotPath) {
      if (!this.isValidGodotPathSync(this.godotPath)) {
        console.warn(`[SERVER] Invalid custom Godot path provided: ${this.godotPath}`);
      }
    }
  }
  // Setup handlers and error handling
  this.setupToolHandlers();
  this.server.onerror = (error) => console.error('[MCP Error]', error);
  process.on('SIGINT', async () => { await this.cleanup(); });
}
```

## Type Safety

**TypeScript Strict Mode:**
- All TypeScript strict checks enabled: `"strict": true`
- No implicit any allowed; handlers use `args: any` with explicit normalization
- Union types preferred: `string | null`, `Promise<T>`
- Type guards used for unknown types: `error instanceof Error`

**Any Escapes:**
- Handler `args: any` parameter normalized via `normalizeParameters()` (line 414)
- Process objects typed as `any` due to Node.js spawn return type limitations (line 39)
- Justified with JSDoc comments explaining the pattern

---

*Convention analysis: 2026-03-03*
