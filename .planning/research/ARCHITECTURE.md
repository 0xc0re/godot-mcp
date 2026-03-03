# Architecture Research

**Domain:** MCP server for a native application (Godot Engine)
**Researched:** 2026-03-03
**Confidence:** HIGH (MCP SDK patterns), MEDIUM (Godot headless integration specifics)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                      MCP Clients                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Claude Code │  │    Cline     │  │    Cursor    │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
└─────────┼─────────────────┼─────────────────┼───────────────────┘
          │ stdio JSON-RPC  │                 │
          ▼                 ▼                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                   godot-mcp (Node.js process)                     │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │               MCP Protocol Layer (index.ts)                  │  │
│  │   McpServer + StdioServerTransport + tool registration       │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
│                             │ calls                                │
│  ┌──────────────────────────▼──────────────────────────────────┐  │
│  │                   Tool Modules (src/tools/)                   │  │
│  │  ┌───────────┐ ┌─────────────┐ ┌──────────┐ ┌───────────┐  │  │
│  │  │  project/ │ │   scene/    │ │ script/  │ │  asset/   │  │  │
│  │  └─────┬─────┘ └──────┬──────┘ └────┬─────┘ └─────┬─────┘  │  │
│  └────────┼──────────────┼─────────────┼──────────────┼────────┘  │
│           │              │             │              │            │
│  ┌────────▼──────────────▼─────────────▼──────────────▼────────┐  │
│  │               Shared Infrastructure (src/core/)              │  │
│  │  ┌─────────────────┐  ┌──────────────┐  ┌───────────────┐   │  │
│  │  │  GodotProcess   │  │   Validator  │  │  PathManager  │   │  │
│  │  │  (exec + state) │  │ (path/param) │  │ (detect/cache)│   │  │
│  │  └────────┬────────┘  └──────────────┘  └───────────────┘   │  │
│  └───────────┼────────────────────────────────────────────────┘  │
└──────────────┼────────────────────────────────────────────────────┘
               │ execFile (security-hardened, no shell injection)
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Godot Engine (external process)                   │
│  godot --headless --path <project> --script godot_operations.gd  │
│  godot --headless --path <project>  (run mode)                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              src/scripts/godot_operations.gd              │    │
│  │    Receives operation name + JSON params via CLI args     │    │
│  │    Outputs results as text to stdout                      │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| `src/index.ts` | Entry point: create McpServer, connect transport, import tool modules | ~50 lines after refactor |
| `src/tools/<domain>/` | Register tools on McpServer instance; own handler logic | One file per tool group |
| `src/core/godot-process.ts` | Spawn Godot headless, capture stdout/stderr, manage active process lifecycle | Class wrapping execFile/spawn |
| `src/core/path-manager.ts` | Detect Godot executable, validate paths, cache results | Pure functions + Map cache |
| `src/core/validator.ts` | Path traversal prevention, parameter normalization | Pure functions |
| `src/scripts/godot_operations.gd` | GDScript-side executor; receives operation+params, performs Godot API calls | GDScript dispatch script |

## Recommended Project Structure

```
src/
├── index.ts                    # Server entry: McpServer + transport + tool registration
├── core/
│   ├── godot-process.ts        # Godot process abstraction + active process state
│   ├── path-manager.ts         # Godot path detection, validation, caching
│   ├── validator.ts            # Path traversal prevention, param normalization
│   └── types.ts                # Shared interfaces: GodotProcess, ServerConfig, etc.
├── tools/
│   ├── index.ts                # Re-exports: registerAllTools(server, core)
│   ├── project/
│   │   └── index.ts            # run_project, stop_project, get_debug_output,
│   │                           #   launch_editor, list_files, get_project_info
│   ├── scene/
│   │   └── index.ts            # create_scene, add_node, read_scene,
│   │                           #   modify_node, inspect_scene_tree
│   ├── script/
│   │   └── index.ts            # create_script, update_script, analyze_script,
│   │                           #   lint_script
│   └── asset/
│       └── index.ts            # manage resources, inspect .tres/.tscn,
│                               #   handle sprites and asset pipeline
└── scripts/
    └── godot_operations.gd     # GDScript executor (existing, extend in place)
```

### Structure Rationale

- **`src/core/`:** Shared infrastructure used by all tool modules. Extracted from the monolith first — this is the foundation everything else depends on. No tool-specific logic here.
- **`src/tools/<domain>/`:** Each domain directory owns all tools in that category. The tool module receives the McpServer instance and core dependencies, calls `server.registerTool()` for each tool it owns. This is the pattern the official SDK and community frameworks (mcp-framework, FastMCP, aashari boilerplate) converge on.
- **`src/scripts/`:** GDScript files live here to keep them co-located with the TypeScript that invokes them. One script handles all operations via dispatch on the first CLI argument.

## Architectural Patterns

### Pattern 1: Tool Module Registration

**What:** Each domain creates a `registerXxxTools(server, core)` function that calls `server.registerTool()` for all tools it owns. The entry point calls each registration function.

**When to use:** Always — this is the correct way to split a monolith while keeping tool registration readable and independently testable.

**Trade-offs:** Slightly more files than a single monolith, but each module is independently testable and the server entry point becomes a clean manifest of what exists.

**Example:**
```typescript
// src/tools/project/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CoreServices } from "../../core/types.js";

export function registerProjectTools(server: McpServer, core: CoreServices): void {
  server.registerTool(
    "run_project",
    {
      title: "Run Godot Project",
      description: "Launch a Godot project in headless or display mode",
      inputSchema: {
        projectPath: z.string().describe("Absolute path to the Godot project directory"),
        scene: z.string().optional().describe("Scene file to run (optional)"),
      },
    },
    async ({ projectPath, scene }) => {
      const validated = core.validator.validateProjectPath(projectPath);
      const process = await core.godotProcess.spawn(validated, scene);
      return { content: [{ type: "text", text: `Project started: PID ${process.pid}` }] };
    }
  );

  server.registerTool("stop_project", /* ... */);
  server.registerTool("get_debug_output", /* ... */);
}
```

```typescript
// src/index.ts
const server = new McpServer({ name: "godot-mcp", version: "0.2.0" });
const core = createCoreServices();

registerProjectTools(server, core);
registerSceneTools(server, core);
registerScriptTools(server, core);
registerAssetTools(server, core);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Pattern 2: Core Services Container

**What:** A single `CoreServices` object groups the shared infrastructure (GodotProcess, PathManager, Validator) and is passed to all tool registration functions.

**When to use:** When multiple tool modules need access to the same stateful services (e.g., the active Godot process reference, the validated Godot path).

**Trade-offs:** Slightly couples modules to the container shape, but avoids global singletons and makes dependencies explicit. A simple factory function is sufficient — no DI framework needed at this scale.

**Example:**
```typescript
// src/core/types.ts
export interface CoreServices {
  godotProcess: GodotProcessManager;
  pathManager: PathManager;
  validator: Validator;
}

// src/core/index.ts
export function createCoreServices(config: ServerConfig): CoreServices {
  const pathManager = new PathManager(config.godotPath);
  const validator = new Validator();
  const godotProcess = new GodotProcessManager(pathManager, validator);
  return { godotProcess, pathManager, validator };
}
```

### Pattern 3: GDScript Dispatch on CLI Arguments

**What:** A single `godot_operations.gd` script receives an operation name and JSON-encoded parameters as command-line arguments, dispatches to a handler function, and prints results to stdout. Godot is invoked via `execFile` (not `exec`) to prevent shell injection.

**When to use:** For all headless Godot operations that require Godot's own API (scene manipulation, resource loading, GDScript parsing). Do NOT spawn a new Godot process for operations that can be done purely in Node.js (reading .tscn as text, directory listing).

**Trade-offs:** Each operation spawns a full Godot process (~200-400ms startup on modern hardware). Acceptable for editor-integration tools where latency is not critical. Avoid for tight loops or real-time queries.

**Example (GDScript side):**
```gdscript
# src/scripts/godot_operations.gd
extends SceneTree

func _initialize() -> void:
    var args := OS.get_cmdline_args()
    var operation := args[0] if args.size() > 0 else ""
    var params := JSON.parse_string(args[1]) if args.size() > 1 else {}

    match operation:
        "create_scene": _create_scene(params)
        "add_node":     _add_node(params)
        "read_scene":   _read_scene(params)
        _:
            printerr("Unknown operation: " + operation)
            quit(1)
    quit(0)
```

## Data Flow

### Tool Call Request Flow

```
Claude Code
    │ JSON-RPC over stdio
    ▼
McpServer (SDK handles protocol framing)
    │ routes by tool name
    ▼
Tool Handler (e.g., registerSceneTools → "create_scene" handler)
    │
    ├── Validator.validatePath(projectPath)     [sync, throws on traversal]
    │
    ├── PathManager.getGodotPath()              [async on first call, cached after]
    │
    └── GodotProcessManager.execute(
    │       operation: "create_scene",
    │       params: { projectPath, scenePath, rootNodeType }
    │   )
    │   │
    │   └── execFile(godotPath, [
    │           "--headless", "--path", projectPath,
    │           "--script", operationsScriptPath,
    │           "create_scene", JSON.stringify(params)
    │       ])
    │       │
    │       └── godot_operations.gd executes, prints result to stdout, exits
    │
    └── Parse stdout → format MCP response
        { content: [{ type: "text", text: "..." }], isError: false }
    ▼
Claude Code receives result
```

### Active Process Flow (run_project / get_debug_output)

```
"run_project" handler
    │
    └── spawn(godotPath, ["--path", projectPath, scene?])
        → returns ChildProcess, stored in GodotProcessManager.activeProcess
        → stdout/stderr streamed into output[] and errors[] buffers

"get_debug_output" handler
    │
    └── GodotProcessManager.getOutput()
        → returns buffered output[], clears buffer

"stop_project" handler
    │
    └── GodotProcessManager.stop()
        → kills activeProcess, clears reference
```

### Godot Path Detection Flow

```
Server startup
    │
    └── PathManager.initialize(config)
        │
        ├── If config.godotPath provided: validate → cache → done
        ├── If GODOT_PATH env set: validate → cache → done
        ├── Platform-specific search paths (Linux/macOS/Windows)
        │   └── For each candidate: run godot --version via execFile
        │       → success: cache → done
        └── Fallback: warn and store null (non-strict mode)
            OR throw error (strict mode)
```

### State Management

The only shared mutable state in the server is:

| State | Owner | Access |
|-------|-------|--------|
| `activeProcess` | `GodotProcessManager` | set by `spawn()`, cleared by `stop()`, read by `getOutput()` |
| `godotPath` | `PathManager` | set once during initialization, read-only after |
| `validatedPaths` | `PathManager` | Map cache, written during detection, read during execution |

No global state. All state lives in class instances inside `CoreServices`.

## Scaling Considerations

This is a local tool server, not a web service. "Scaling" means handling more tools and more concurrent requests from a single AI session.

| Concern | At current scale (12 tools) | At target scale (30+ tools) |
|---------|----------------------------|-----------------------------|
| Tool registration | Single file works | Split into domain modules — this is the refactor goal |
| Context window usage | All tool descriptions loaded upfront | Claude Code auto-enables MCP Tool Search when tools exceed 10% of context; write good `description` fields to help search work |
| Process spawning overhead | ~200-400ms per Godot operation; acceptable | Consider batching multiple operations into one GDScript invocation |
| Concurrent tool calls | AI clients call tools sequentially; not a concern | Still not a concern — MCP clients do not parallelize calls |

## Anti-Patterns

### Anti-Pattern 1: SDK Version Lag

**What people do:** Pin to an old SDK version (like 0.6.0) and never update.

**Why it's wrong:** The MCP protocol evolved significantly from 0.x to 1.x. SDK 0.6.0 uses the old `Server` class with `setRequestHandler(ListToolsRequestSchema, ...)` and `setRequestHandler(CallToolRequestSchema, ...)` patterns. SDK 1.x introduces `McpServer` with `server.registerTool()` which handles capability negotiation, `protocolVersion` in the initialize handshake, and the `list_changed` notification correctly. Claude Code expects modern protocol semantics; SDK 0.6.0 likely sends an incompatible `protocolVersion`, causing tools to not appear.

**Do this instead:** Upgrade to `@modelcontextprotocol/sdk@^1.27.1`. The new `McpServer` class eliminates manual `ListToolsRequestSchema` registration entirely.

### Anti-Pattern 2: Monolithic Tool Handler File

**What people do:** Put all 12+ tool definitions, their schemas, and handler logic in a single 2000+ line file.

**Why it's wrong:** Adding a new tool means editing the same file that handles process management, validation, and protocol registration. Merge conflicts multiply. No clean boundary for unit testing individual tools.

**Do this instead:** One file per tool domain (`project/`, `scene/`, `script/`, `asset/`). Each exports a `registerXxxTools(server, core)` function. The entry point becomes a clean 30-line manifest.

### Anti-Pattern 3: Spawning Godot for Pure File Operations

**What people do:** Route all operations through GDScript just for consistency, including things like listing files or reading `.tscn` as raw text.

**Why it's wrong:** Godot startup takes 200-400ms even headless. Reading a directory in Node.js takes under 1ms. Operations like `list_files` and reading `.tscn` file contents as text don't need Godot's scene parser.

**Do this instead:** Separate tools into two categories:
- **Godot-native:** Anything requiring scene instantiation, ResourceLoader, or GDScript evaluation goes through `godot_operations.gd`
- **Filesystem-native:** Directory listing, raw file reads, text-based .tscn parsing — handled directly in Node.js

### Anti-Pattern 4: Logging to stdout

**What people do:** Use `console.log()` for debug output in stdio MCP servers.

**Why it's wrong:** The MCP stdio transport uses stdout exclusively for JSON-RPC messages. Any `console.log()` call corrupts the protocol stream and causes parse errors on the client side. The existing codebase already got this right.

**Do this instead:** All logging goes to `console.error()` (writes to stderr). Controlled by a `DEBUG_MODE` environment variable. Never write arbitrary text to stdout.

### Anti-Pattern 5: Active Process State in a Single Tool Module

**What people do:** Store the running Godot process reference inside one tool's handler closure or module scope.

**Why it's wrong:** Multiple tools need to interact with the same running Godot process — `run_project` starts it, `get_debug_output` reads from it, `stop_project` kills it. If the reference lives in one module, the others cannot reach it without coupling.

**Do this instead:** The active process reference lives in `GodotProcessManager` within `CoreServices`, which is passed to all tool modules at registration time. Shared state lives in shared infrastructure.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Godot Engine (headless ops) | `execFile` with args array (one-shot, no shell) | Each operation is a fresh process; ~200-400ms overhead |
| Godot Engine (running project) | `spawn` with streaming stdout/stderr | One active process at a time; output buffered in memory |
| Claude Code | stdio JSON-RPC via MCP protocol (SDK 1.x) | SDK handles handshake; `protocolVersion: "2024-11-05"` |
| Cline / Cursor | Same stdio JSON-RPC | Same protocol; any MCP-compliant client works |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `index.ts` → tool modules | Function call: `registerXxxTools(server, core)` | Tool modules do not import each other |
| Tool modules → core | Via `CoreServices` container passed at registration | No globals; dependencies are explicit |
| Core → Godot | `execFile` / `spawn` (both non-shell) | All process I/O is async |
| TypeScript → GDScript | CLI args: operation name + JSON string | One-way invocation; results via stdout |
| GDScript → TypeScript | stdout text (parsed by handler); exit code signals success/error | Structured output recommended (JSON lines) |

### Build Order (Phase Dependencies)

The natural build order follows the dependency graph:

1. **Core infrastructure first** (`src/core/`) — `GodotProcessManager`, `PathManager`, `Validator`, `CoreServices` type. Nothing else can be built until these exist. This is also the SDK upgrade milestone: swap `Server` → `McpServer`, swap `setRequestHandler` → `registerTool`. This phase directly fixes the Claude Code tool discovery bug.

2. **Existing tools migrated** (`src/tools/project/`) — Port the 12 existing tools from the monolith into the new module structure. This validates the architecture before adding new capabilities. The run/stop/debug/launch/list tools are the known-working baseline.

3. **Extended Godot operations** (`src/scripts/godot_operations.gd` + new tool modules) — Scene read/modify, script analysis, project scaffolding. Each new tool module follows the same registration pattern established in step 2.

4. **Asset and resource tools** — These depend on understanding the extended GDScript API established in step 3.

## Sources

- [MCP TypeScript SDK official docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) — HIGH confidence (official), shows `McpServer` + `registerTool` API
- [Official MCP build-server guide](https://modelcontextprotocol.io/docs/develop/build-server) — HIGH confidence (official)
- [MCP SDK on npm (v1.27.1)](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — current latest, published ~7 days ago as of 2026-03-03
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) — HIGH confidence (Anthropic official), explains tool discovery scopes, `list_changed`, MCP Tool Search auto-activation at 10% context threshold
- [aashari boilerplate-mcp-server](https://github.com/aashari/boilerplate-mcp-server) — MEDIUM confidence (community), layered `src/tools/` architecture
- [mcp-framework auto-discovery](https://github.com/QuantGeekDev/mcp-framework) — MEDIUM confidence (community), directory-based tool auto-discovery
- [Claude Code issue tracker: tools not appearing](https://github.com/anthropics/claude-code/issues/11175) — MEDIUM confidence, real-world incompatibility documentation
- [Godot headless proposals/discussion](https://github.com/godotengine/godot-proposals/discussions/8664) — MEDIUM confidence, confirms `--headless --script` execution model for editor scripts

---
*Architecture research for: Godot MCP Server modular refactor*
*Researched: 2026-03-03*
