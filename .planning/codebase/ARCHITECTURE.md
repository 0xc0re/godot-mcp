# Architecture

**Analysis Date:** 2026-03-03

## Pattern Overview

**Overall:** Monolithic MCP Server with External Process Control

The codebase follows a **single-class server pattern** where a centralized `GodotServer` class manages all interactions between the Model Context Protocol (MCP) and the Godot game engine. The server acts as a middleware that translates MCP tool calls into Godot operations by executing headless Godot processes with custom GDScript operations.

**Key Characteristics:**
- Single-file monolithic TypeScript server (`src/index.ts`)
- Request/response middleware pattern for MCP protocol
- Subprocess management for spawning Godot headless processes
- State management through instance variables (active process, validated paths, Godot path)
- Parameter transformation layer (camelCase ↔ snake_case conversion)

## Layers

**MCP Protocol Layer:**
- Purpose: Handle incoming tool requests from Claude/Cline and format responses according to MCP specification
- Location: `src/index.ts` (lines 656-958)
- Contains: Tool handler registration, request routing, error formatting
- Depends on: @modelcontextprotocol/sdk
- Used by: External MCP clients (Claude, Cline, etc.)

**Server Configuration Layer:**
- Purpose: Manage Godot executable path detection, validation, and caching
- Location: `src/index.ts` (lines 224-356)
- Contains: Path validation logic, platform-specific path detection, path caching
- Depends on: Node.js fs, child_process, path modules
- Used by: ExecutionLayer

**Execution Layer:**
- Purpose: Execute Godot operations by spawning headless processes and managing their lifecycle
- Location: `src/index.ts` (lines 474-533)
- Contains: Parameter conversion, argument building, process spawning via execFile
- Depends on: Child_process.execFile (security-hardened against shell injection)
- Used by: Tool handler methods

**Tool Handler Layer:**
- Purpose: Implement specific Godot operations as callable MCP tools
- Location: `src/index.ts` (lines 920-2143)
- Contains: 12 handler methods (launch_editor, run_project, create_scene, etc.)
- Depends on: Execution layer, validation logic
- Used by: MCP Protocol Layer

**File System & Validation Layer:**
- Purpose: Validate paths, scan project structures, prevent path traversal attacks
- Location: `src/index.ts` (lines 207-215, 540-655)
- Contains: Path traversal validation, directory scanning, project detection logic
- Depends on: Node.js fs module
- Used by: Tool handlers, configuration layer

## Data Flow

**Tool Request → Response:**

1. MCP client sends `CallToolRequest` with tool name and arguments (camelCase)
2. `setupToolHandlers()` routes request to specific handler method (line 920-957)
3. Handler method validates parameters and normalizes them:
   - Validates paths against traversal attacks
   - Converts camelCase to snake_case for GDScript compatibility (line 447-472)
4. Handler calls `executeOperation()` with operation name and parameters
5. `executeOperation()` spawns headless Godot process via `execFile`:
   ```
   godot --headless --path <project> --script godot_operations.gd <operation> <params_json>
   ```
6. `godot_operations.gd` (GDScript) executes the operation and outputs results
7. Results captured as stdout/stderr and formatted into MCP response
8. Response sent back to client with `content` array and `isError` flag

**Godot Path Detection → Execution:**

1. Server instantiation optionally accepts `godotPath` in config
2. On `server.run()`, if no path set, `detectGodotPath()` executes (line 270-356)
3. Detection order:
   - If config.godotPath provided: validate and use
   - Check GODOT_PATH environment variable
   - Platform-specific paths (OS-dependent common installation locations)
   - Fallback to default path (with warning in non-strict mode)
4. Each candidate path validated via `isValidGodotPath()` which runs `godot --version`
5. Valid paths cached in `this.validatedPaths` Map
6. If no valid path found and strictPathValidation enabled: throw error; else fallback with warning

**Process Lifecycle:**

1. Tool handler calls `spawn()` or `execFile()` to start Godot process
2. Process runs with `--headless` flag for no GUI
3. If `run_project` tool: process stored in `this.activeProcess` for later retrieval
4. Output captured continuously into `output[]` and `errors[]` arrays
5. `get_debug_output()` retrieves accumulated output from active process
6. `stop_project()` kills active process and clears reference
7. On SIGINT (Ctrl+C): `cleanup()` kills any active process and closes server

**State Management:**
- `this.activeProcess`: Tracks single running Godot project (null when idle)
- `this.validatedPaths`: Map<string, boolean> caches path validation results
- `this.godotPath`: String (nullable) stores detected/configured Godot executable path
- `this.parameterMappings` + `this.reverseParameterMappings`: Bidirectional parameter case conversion

## Key Abstractions

**GodotProcess Interface:**
- Purpose: Represent a running Godot instance
- Location: `src/index.ts` (lines 38-42)
- Pattern: Data class holding process reference and output buffers
- Used by: `run_project`, `stop_project`, `get_debug_output` handlers

**GodotServerConfig Interface:**
- Purpose: Configuration passed to server constructor
- Location: `src/index.ts` (lines 47-52)
- Properties: godotPath, debugMode, godotDebugMode, strictPathValidation
- Pattern: Optional configuration object

**OperationParams Type:**
- Purpose: Type-safe parameter object for Godot operations
- Location: `src/index.ts` (line 57-59)
- Pattern: `Record<string, any>` allowing flexible operation-specific parameters

**Tool Handler Pattern:**
All tool handlers follow similar structure:
```typescript
private async handleXxxOperation(args: any) {
  try {
    // 1. Validate and normalize parameters
    // 2. Call executeOperation() with GDScript operation name
    // 3. Parse stdout/stderr for errors
    // 4. Return formatted MCP response
  } catch (error) {
    return this.createErrorResponse(message, solutions);
  }
}
```

## Entry Points

**CLI Entry Point:**
- Location: `src/index.ts` (lines 2190-2196)
- Triggers: `npm run build && node ./build/index.js` or via MCP client configuration
- Responsibilities: Instantiate GodotServer, call `run()`, exit on error

**MCP Server Runtime:**
- Location: `src/index.ts` (lines 2149-2187)
- Triggers: Invoked by MCP transport layer (stdio)
- Responsibilities:
  - Detect Godot path
  - Validate executable
  - Connect to stdio transport
  - Begin listening for requests

**Tool Registration & Request Dispatch:**
- Location: `src/index.ts` (lines 656-958)
- Triggers: MCP handshake and tool calls
- Responsibilities:
  - Register 12 available tools with schemas
  - Route incoming calls to correct handler
  - Maintain request/response contract with MCP spec

## Error Handling

**Strategy:** Defensive layering with user-friendly error messages

**Patterns:**

1. **Path Validation Errors:**
   - Invalid paths caught early via `validatePath()` (prevents traversal)
   - Missing/bad Godot path caught during `detectGodotPath()`
   - Non-existent project paths rejected by handlers

2. **Execution Errors:**
   - `execFile()` catches command failures
   - stderr from Godot process parsed for "Failed to" patterns
   - Both stdout/stderr returned even on non-zero exit (no throw)

3. **MCP Error Format:**
   - `createErrorResponse()` builds standardized error with optional solutions
   - Sets `isError: true` flag
   - Includes "Possible solutions" section for debugging

4. **Logging Strategy:**
   - Debug output goes to stderr (not stdout which is reserved for JSON-RPC)
   - Production errors use `console.error()` with `[SERVER]` prefix
   - DEBUG_MODE env var controls verbosity

## Cross-Cutting Concerns

**Logging:**
- Private `logDebug()` method (line 168-172) controlled by DEBUG_MODE
- All logs go to stderr to avoid interfering with JSON-RPC stdout communication
- Godot operations can include `--debug-godot` flag for additional logging

**Validation:**
- Path validation prevents directory traversal via `validatePath()` (line 207-215)
- Parameter schema defined in tool handlers (lines 663-915)
- MCP schema validation happens at protocol layer via @modelcontextprotocol/sdk

**Authentication:**
- Not applicable (local MCP server, no network auth)
- Godot path detection handles environment variable override

**Parameter Transformation:**
- Bidirectional mapping between camelCase (JavaScript/MCP) and snake_case (GDScript)
- `normalizeParameters()` handles null values
- `convertCamelToSnakeCase()` transforms for Godot compatibility (lines 447-472)

---

*Architecture analysis: 2026-03-03*
