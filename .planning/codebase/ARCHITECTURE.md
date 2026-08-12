# Architecture

**Analysis Date:** 2026-03-03

## Pattern Overview

**Overall:** MCP Server with dual-execution bridge pattern

**Key Characteristics:**
- An MCP (Model Context Protocol) server exposing Godot engine capabilities as LLM-callable tools
- Two execution paths: TypeScript parsers for fast read-only operations (~1ms), headless GDScript subprocess for write/engine operations (~200ms+)
- Shared `ServerContext` object injected into every tool domain at startup, carrying process handles and the Godot executable path
- Tool domains are organized by Godot concept (editor, scene, script, project, etc.) and registered onto a single `McpServer` instance

## Layers

**Entry Point / Bootstrap:**
- Purpose: Creates the MCP server, initializes shared context, registers all tool domains, and connects stdio transport
- Location: `src/index.ts`
- Contains: Server instantiation, tool registration calls, signal handler registration, transport connection
- Depends on: `src/server.ts`, all `src/tools/*.ts` modules, `src/resources/godot-resources.ts`
- Used by: Node.js runtime (invoked as CLI binary)

**Server Context:**
- Purpose: Detects Godot executable path and constructs the shared `ServerContext` passed to all tools
- Location: `src/server.ts`
- Contains: `createServerContext()` factory function
- Depends on: `src/godot.ts` (path detection), `src/types.ts`
- Used by: `src/index.ts`

**Type Definitions:**
- Purpose: Central TypeScript interfaces shared across all modules
- Location: `src/types.ts`
- Contains: `ServerContext`, `GodotProcess`, `OperationParams` interfaces
- Depends on: `src/lsp/client.ts` (for `LspClient` type reference)
- Used by: All tool and utility modules

**Godot Process Utilities:**
- Purpose: All interaction with the Godot executable — path detection, process execution, path validation, process tracking
- Location: `src/godot.ts`
- Contains: `detectGodotPath()`, `execGodot()`, `executeOperation()`, `validatePath()`, `trackProcess()`, `isGodot44OrLater()`
- Depends on: Node.js `child_process`, `fs`, `path`
- Used by: All tool modules that invoke Godot operations

**Tool Domains:**
- Purpose: Register MCP tools onto the server, implement per-tool business logic
- Location: `src/tools/` — one file per domain
  - `src/tools/editor.ts` — `launch_editor`, `run_project`, `get_debug_output`, `stop_project`, `capture_screenshot`
  - `src/tools/project.ts` — `get_godot_version`, `list_projects`, `get_project_info`, `read_project_settings`, `modify_project_setting`
  - `src/tools/scene.ts` — `create_scene`, `add_node`, `load_sprite`, `export_mesh_library`, `save_scene`, `read_scene`, `modify_node_property`, `remove_node`, `attach_script`
  - `src/tools/script.ts` — `validate_scripts`, `list_scripts`, `query_class`
  - `src/tools/resource.ts` — `read_resource`, `create_resource`
  - `src/tools/uid.ts` — `get_uid`, `update_project_uids`
  - `src/tools/diagnostics.ts` — `get_diagnostics`
- Depends on: `src/godot.ts`, `src/errors.ts`, `src/types.ts`, `src/parsers/*.ts`, `src/lsp/client.ts`
- Used by: `src/index.ts` (registration only)

**File Parsers:**
- Purpose: Fast TypeScript-native parsing of Godot file formats, avoiding subprocess overhead for read-only operations
- Location: `src/parsers/`
  - `src/parsers/tscn-parser.ts` — Parses `.tscn` (scene) and `.tres` (resource) text-format files
  - `src/parsers/tscn-types.ts` — Type definitions for parsed scene/resource data
  - `src/parsers/project-parser.ts` — Parses `project.godot` INI-format settings
  - `src/parsers/project-types.ts` — Type definitions for parsed project settings
- Depends on: Node.js `fs`
- Used by: `src/tools/scene.ts`, `src/tools/resource.ts`, `src/tools/project.ts`

**LSP Layer:**
- Purpose: JSON-RPC client for Godot's built-in Language Server Protocol over TCP, used to get GDScript diagnostics
- Location: `src/lsp/`
  - `src/lsp/client.ts` — `LspClient` class: TCP connection lifecycle, initialize handshake, `getDiagnostics()` via `textDocument/didOpen`
  - `src/lsp/protocol.ts` — LSP wire framing: `encodeMessage()`, `parseMessages()` for `Content-Length: N\r\n\r\n{json}` framing
- Depends on: Node.js `net.Socket`
- Used by: `src/tools/diagnostics.ts`, `src/types.ts`

**MCP Resources:**
- Purpose: Expose Godot `.tscn` and `.gd` files as MCP resources so LLMs can `@mention` them for inline context
- Location: `src/resources/godot-resources.ts`
- Contains: `registerGodotResources()` — registers `godot://scene/{path}` and `godot://script/{path}` URI templates
- Depends on: `@modelcontextprotocol/sdk`, Node.js `fs`
- Used by: `src/index.ts`

**Error Utilities:**
- Purpose: Standardized error response format for all tool handlers
- Location: `src/errors.ts`
- Contains: `toolError(message, suggestions)` — returns `ToolResult` with `isError: true` and JSON-encoded suggestions
- Used by: All tool domain modules

**GDScript Operations Script:**
- Purpose: The GDScript "backend" that runs in Godot's headless mode to execute engine-native operations
- Location: `src/scripts/godot_operations.gd` (copied to `build/scripts/` at build time)
- Contains: A `SceneTree`-extending script with a `match` dispatch over operation names: `create_scene`, `add_node`, `load_sprite`, `export_mesh_library`, `save_scene`, `get_uid`, `resave_resources`, `modify_node_property`, `remove_node`, `attach_script`, `create_resource`, `validate_scripts`, `modify_project_setting`, `list_scripts`, `query_class`
- Invoked by: `executeOperation()` in `src/godot.ts`

**Screenshot Helper GDScript:**
- Purpose: Autoload script that users add to their Godot project to enable viewport screenshot capture via polling a trigger file
- Location: `src/scripts/screenshot_helper.gd` (copied to `build/scripts/` at build time)
- Trigger mechanism: Polls `res://.godot/screenshot_trigger` every 0.5 seconds; on detection writes `res://.godot/screenshot.png`

## Data Flow

**Standard Headless Operation (write/engine path):**

1. LLM calls an MCP tool (e.g. `create_scene`) via stdio JSON-RPC
2. `McpServer` dispatches to the registered handler in `src/tools/scene.ts`
3. Handler validates paths with `validatePath()` from `src/godot.ts`
4. Handler calls `executeOperation(ctx, projectPath, 'create_scene', params)` in `src/godot.ts`
5. `executeOperation` converts camelCase params to snake_case (GDScript convention), serializes to JSON
6. Spawns: `godot --headless --path <project> --script godot_operations.gd <operation> <params_json>`
7. GDScript dispatch runs the matching function, outputs results to stdout
8. TypeScript reads stdout, returns `{ content: [{ type: 'text', text: ... }] }` to the MCP SDK

**Fast Read Operation (TypeScript parser path):**

1. LLM calls a read tool (e.g. `read_scene`)
2. Handler reads file from disk with Node.js `fs.readFileSync`
3. Calls `parseScene()` from `src/parsers/tscn-parser.ts`
4. Returns structured JSON without spawning any Godot process

**LSP Diagnostics Flow:**

1. LLM calls `get_diagnostics` with a `.gd` file path
2. `src/tools/diagnostics.ts` checks if `ctx.lspClient` is connected
3. If no connection: attempts TCP connect to port 6014 (default)
4. If `ECONNREFUSED`: spawns `godot --editor --headless --lsp-port 6014 --path <project>`, waits for port, then connects
5. Sends LSP `textDocument/didOpen` notification with file content
6. Listens for `textDocument/publishDiagnostics` notification (5-second timeout)
7. Returns diagnostics array as JSON

**State Management:**
- `ServerContext` holds all mutable server state: `activeProcess` (currently running project), `trackedProcesses` (all spawned processes for cleanup), `validatedPaths` (cache), `lspClient` (persistent LSP connection), `lspProcess` (headless editor for LSP)
- State is created once at startup via `createServerContext()` and passed by reference to all tool registrations (closure capture)

## Key Abstractions

**ServerContext:**
- Purpose: Single shared context object threading Godot path, process handles, and LSP client across all tool domains
- Example: `src/types.ts` (definition), `src/server.ts` (creation), every `src/tools/*.ts` (consumption)
- Pattern: Dependency injection via function parameter; context is captured in handler closures at `registerXxxTools(server, ctx)` call time

**Tool Domain Modules:**
- Purpose: Each file groups a cohesive set of tools for one Godot concept area
- Examples: `src/tools/scene.ts`, `src/tools/editor.ts`, `src/tools/script.ts`
- Pattern: Each module exports a single `registerXxxTools(server: McpServer, ctx: ServerContext): void` function; no classes, no side effects at module load time

**Dual Execution Strategy:**
- Purpose: Read-only operations use in-process TypeScript parsers for speed; write/engine operations use headless Godot subprocess for correctness
- Examples: `read_scene` uses `src/parsers/tscn-parser.ts`; `create_scene` uses `executeOperation()` → `godot_operations.gd`
- Pattern: Explicit branching in each tool handler — no abstraction layer, the choice is visible per-handler

**ToolResult / toolError:**
- Purpose: Standardized return type for all MCP tool handlers, ensuring consistent error structure for LLM recovery
- Example: `src/errors.ts`
- Pattern: Every error path returns `toolError(message, suggestions[])` which includes actionable recovery hints in the `suggestions` array

## Entry Points

**MCP Server CLI:**
- Location: `src/index.ts` (built to `build/index.js`, made executable)
- Triggers: Invoked by MCP clients (e.g. Claude Desktop) via stdio JSON-RPC; also via `start.sh` for manual invocation
- Responsibilities: Bootstrap server, register all tools and resources, handle SIGINT/SIGTERM for graceful shutdown (killing all tracked Godot processes and LSP client)

**GDScript Operation Dispatcher:**
- Location: `src/scripts/godot_operations.gd`
- Triggers: Spawned by `executeOperation()` in `src/godot.ts` with `--headless --script` flags
- Responsibilities: Parse operation name and JSON params from CLI args, dispatch to the matching GDScript function, quit after completion

## Error Handling

**Strategy:** Errors are caught at the tool handler boundary and converted to structured `ToolResult` objects with `isError: true`. Errors are never thrown across module boundaries in tool handlers — all errors are caught, logged to stderr, and returned as JSON with recovery suggestions.

**Patterns:**
- Path validation always runs first: `if (!validatePath(path)) return toolError(...)`
- Project file existence checked before any operation: `if (!existsSync(join(project_path, 'project.godot'))) return toolError(...)`
- All `executeOperation` calls are wrapped in `try/catch`; caught errors call `toolError()`
- Process timeouts (30s) result in `'Godot operation timed out'` errors surfaced to the LLM
- `toolError()` logs to stderr (safe for stdio transport) and returns a JSON body with `{ error, suggestions }`

## Cross-Cutting Concerns

**Logging:** All logging goes to stderr via `console.error()` (stdout is reserved for MCP protocol). Debug logging gated on `process.env.DEBUG === 'true'` via per-module `logDebug()` functions. The `GODOT_DEBUG_MODE` constant in `src/godot.ts` is hardcoded `true`, appending `--debug-godot` to all headless operations.

**Validation:** Path traversal prevention via `validatePath()` in `src/godot.ts` (rejects paths containing `..`). Input schemas validated by Zod at MCP SDK layer before handlers run.

**Authentication:** None — MCP servers run locally, no auth required.

---

*Architecture analysis: 2026-03-03*
