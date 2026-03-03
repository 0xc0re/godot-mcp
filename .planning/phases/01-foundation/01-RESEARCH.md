# Phase 1: Foundation - Research

**Researched:** 2026-03-03
**Domain:** MCP SDK migration, TypeScript module refactoring, Node.js process management
**Confidence:** HIGH

## Summary

Phase 1 transforms a broken v0.1.1 MCP server (tools invisible in Claude Code due to SDK 0.6.0 protocol mismatch) into a working, modular codebase. The existing `src/index.ts` is a 2,196-line monolith containing a `GodotServer` class with 14 tool definitions, inline JSON schemas, process management, and all handler logic. The SDK upgrade from 0.6.0 to 1.27.1 is the critical fix -- without it, Claude Code cannot discover any tools.

The migration path is well-defined: replace the low-level `Server` class (manual `setRequestHandler` with `ListToolsRequestSchema`/`CallToolRequestSchema`) with the high-level `McpServer` class that provides `registerTool()` with Zod schemas for automatic validation. This eliminates ~250 lines of hand-rolled schema JSON and the manual dispatch switch statement. The refactoring into domain modules is straightforward since the existing tools already cluster into clear categories.

**Primary recommendation:** Upgrade SDK first (FOUN-01/02/03), then refactor into modules (FOUN-06), then harden process management (FOUN-04/08), then audit logging (FOUN-05/07). This order ensures the build works at every step.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUN-01 | MCP SDK upgraded from 0.6.0 to latest (1.27.1+) | SDK 1.27.1 verified on npm; import paths documented; peer dep on zod ^3.25 or ^4.0 |
| FOUN-02 | All tool handlers migrated from `server.setRequestHandler()` to `McpServer.registerTool()` API | `registerTool()` API fully typed from SDK .d.ts; replaces ListToolsRequestSchema/CallToolRequestSchema pattern |
| FOUN-03 | Zod added as explicit dependency (^3.25.0+) per SDK 1.x requirements | SDK peer dep is `zod: ^3.25 \|\| ^4.0`; recommend zod@^3.25.76 for stability |
| FOUN-04 | Process execution hardened with `maxBuffer`, `timeout`, and zombie process prevention | Node.js `execFile` supports `maxBuffer` and `timeout` options; `spawn` needs explicit kill-on-exit tracking |
| FOUN-05 | Every tool returns actionable error messages with suggested next steps | Existing `createErrorResponse()` pattern is good; needs consistency audit and structured format |
| FOUN-06 | Monolithic src/index.ts refactored into domain modules | 14 tools cluster into 4-5 domains; McpServer allows registering tools from separate modules |
| FOUN-07 | Stdout/stderr separation enforced -- zero console.log in server code | Current code has zero `console.log` already; one `console.warn` (goes to stderr, safe); build script has `console.log` (runs at build time, safe) |
| FOUN-08 | SIGINT and SIGTERM handlers registered for reliable cleanup of child processes | Current code only handles SIGINT, not SIGTERM; needs both; needs to track ALL spawned processes, not just `activeProcess` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | 1.27.1 | MCP protocol implementation | Official SDK; required for Claude Code tool discovery |
| zod | ^3.25.76 | Schema validation for tool inputs | Peer dependency of SDK 1.x; provides runtime validation + TypeScript types |
| typescript | ^5.3.3 | Type checking and compilation | Already in project; compatible with SDK |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fs-extra | ^11.2.0 | File operations in build script | Already in project; used by build.js for copying GDScript |

### Remove
| Library | Reason |
|---------|--------|
| axios | ^1.7.9 | Not imported anywhere in src/index.ts; unused dependency |

**Installation:**
```bash
npm install @modelcontextprotocol/sdk@latest zod@^3.25.76
npm uninstall axios
```

**Note on Zod version:** The SDK accepts `^3.25 || ^4.0`. Use Zod 3.25.x (not 4.x) for maximum stability. Zod 4 is newer and has had compatibility issues reported with some SDK versions (GitHub issue #925, #1380). The REQUIREMENTS.md specifies `^3.25.0+` which aligns with this recommendation.

## Architecture Patterns

### Recommended Project Structure
```
src/
  index.ts              # Entry point: create McpServer, register tools, connect transport (<100 lines)
  server.ts             # Server creation, configuration, Godot path detection
  types.ts              # Shared interfaces (GodotProcess, GodotServerConfig, OperationParams)
  errors.ts             # Structured error response helpers
  godot.ts              # Godot process execution (executeOperation, execFileAsync wrappers)
  tools/
    editor.ts           # launch_editor, run_project, stop_project, get_debug_output
    project.ts          # list_projects, get_project_info, get_godot_version
    scene.ts            # create_scene, add_node, load_sprite, save_scene
    asset.ts            # export_mesh_library, load_sprite (or merge with scene)
    uid.ts              # get_uid, update_project_uids
  scripts/
    godot_operations.gd # GDScript operations script (unchanged)
```

### Pattern 1: Tool Registration with McpServer.registerTool()
**What:** Each tool module exports a function that registers tools on a shared McpServer instance.
**When to use:** Every tool definition in Phase 1 and beyond.
**Example:**
```typescript
// src/tools/project.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerProjectTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'list_projects',
    {
      title: 'List Projects',
      description: 'List Godot projects in a directory',
      inputSchema: {
        directory: z.string().describe('Directory to search for Godot projects'),
        recursive: z.boolean().optional().describe('Whether to search recursively (default: false)'),
      },
    },
    async ({ directory, recursive }) => {
      // Handler logic here
      // Return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  );
}
```

### Pattern 2: Slim Entry Point
**What:** `src/index.ts` only creates the server, imports tool registrations, and connects transport.
**When to use:** The index.ts file.
**Example:**
```typescript
// src/index.ts
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerEditorTools } from './tools/editor.js';
import { registerProjectTools } from './tools/project.js';
import { registerSceneTools } from './tools/scene.js';
import { registerUidTools } from './tools/uid.js';
import { createServerContext } from './server.js';
import { setupProcessHandlers } from './process.js';

const server = new McpServer(
  { name: 'godot-mcp', version: '0.2.0' },
  { capabilities: { tools: {} } }
);

const ctx = await createServerContext();
setupProcessHandlers(ctx);

registerEditorTools(server, ctx);
registerProjectTools(server, ctx);
registerSceneTools(server, ctx);
registerUidTools(server, ctx);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Godot MCP server running on stdio');
```

### Pattern 3: Structured Error Responses
**What:** Every tool error returns a consistent JSON structure with message, code, and suggested next steps.
**When to use:** All error paths in all tool handlers.
**Example:**
```typescript
function toolError(message: string, suggestions: string[]): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: message,
        suggestions,
      }),
    }],
    isError: true,
  };
}
```

### Pattern 4: Process Tracking for Cleanup
**What:** Track all spawned child processes in a Set for reliable SIGINT/SIGTERM cleanup.
**When to use:** Every `spawn()` and `execFile()` call.
**Example:**
```typescript
const activeProcesses = new Set<ChildProcess>();

function trackProcess(proc: ChildProcess): void {
  activeProcesses.add(proc);
  proc.on('exit', () => activeProcesses.delete(proc));
}

function cleanupAll(): void {
  for (const proc of activeProcesses) {
    proc.kill('SIGTERM');
  }
  activeProcesses.clear();
}

process.on('SIGINT', cleanupAll);
process.on('SIGTERM', cleanupAll);
```

### Anti-Patterns to Avoid
- **Do not keep the GodotServer class:** The McpServer replaces it. Tool handlers should be standalone functions, not methods on a God-class.
- **Do not use `server.tool()` (deprecated):** Use `server.registerTool()` instead. The `tool()` method is marked deprecated in SDK 1.27.1.
- **Do not pass raw `any` args:** Use Zod schemas with `registerTool()` for automatic validation and type inference.
- **Do not use `console.log()` anywhere in server code:** It writes to stdout, corrupting the JSON-RPC stdio transport stream.
- **Do not use `console.warn()` for new code:** While it goes to stderr (safe), prefer `console.error()` for consistency with existing patterns.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tool input validation | Manual `if (!args.projectPath)` checks | Zod schemas via `registerTool()` inputSchema | SDK validates automatically; returns proper MCP error codes |
| Tool listing / dispatch | `ListToolsRequestSchema` handler + switch statement | `McpServer.registerTool()` | McpServer handles listing and routing internally |
| JSON schema generation | Hand-written `inputSchema: { type: 'object', properties: {...} }` | Zod schemas (auto-converted by SDK) | Less code, type-safe, fewer bugs |
| Parameter case conversion | `normalizeParameters()` / `convertCamelToSnakeCase()` | Zod schemas with snake_case keys directly | Define schemas matching what Godot expects; no conversion needed |
| Signal handling boilerplate | Custom signal handler code | Node.js `process.on('SIGINT'/'SIGTERM', ...)` | Standard Node.js pattern; keep it simple |

**Key insight:** The SDK 1.x `McpServer` class eliminates roughly half the boilerplate in the current codebase. The manual `ListToolsRequestSchema`/`CallToolRequestSchema` pattern, the hand-written JSON schemas, and the switch-case dispatcher all become unnecessary.

## Common Pitfalls

### Pitfall 1: SDK Import Path Changes
**What goes wrong:** Code imports from old paths (`@modelcontextprotocol/sdk/server/index.js`, `@modelcontextprotocol/sdk/types.js`) that either don't exist or export different things in 1.x.
**Why it happens:** The SDK restructured its exports between 0.6.0 and 1.x.
**How to avoid:** Use these import paths:
- `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`
- `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`
- `Server` (low-level, deprecated) from `@modelcontextprotocol/sdk/server/index.js`
- Types like `CallToolResult` from `@modelcontextprotocol/sdk/types.js` (still valid)
**Warning signs:** TypeScript compilation errors about missing exports.

### Pitfall 2: registerTool() Must Be Called Before connect()
**What goes wrong:** Tools registered after `server.connect(transport)` are silently ignored or throw an error about capability registration.
**Why it happens:** The SDK locks capabilities after the handshake.
**How to avoid:** Register ALL tools before calling `server.connect(transport)`.
**Warning signs:** Tools not appearing in Claude Code despite being registered.

### Pitfall 3: Zod v3 vs v4 Compatibility
**What goes wrong:** Using Zod 4.x can cause `Schema method literal must be a string` errors during `new McpServer()` initialization.
**Why it happens:** The SDK internally uses `zod/v4` imports but has had compatibility issues with certain Zod 4 releases.
**How to avoid:** Use `zod@^3.25.76` (latest 3.x). The SDK peer dep accepts `^3.25 || ^4.0` and the 3.25.x path is most battle-tested.
**Warning signs:** Runtime errors at server startup mentioning Zod or schema methods.

### Pitfall 4: console.log Corrupting stdio Transport
**What goes wrong:** Any `console.log()` call writes to stdout, which is the JSON-RPC transport channel. This injects non-JSON data into the protocol stream, causing parse errors on the client side.
**Why it happens:** Easy to accidentally add during debugging.
**How to avoid:** Use `console.error()` for all logging (goes to stderr). Add a lint rule or grep check in CI.
**Warning signs:** Claude Code shows connection errors or garbled tool responses.

### Pitfall 5: Zombie Godot Processes After SIGTERM
**What goes wrong:** The server exits on SIGTERM but leaves Godot child processes running.
**Why it happens:** Current code only handles SIGINT, not SIGTERM. Also only tracks `this.activeProcess` (the run_project process), not processes spawned by `launch_editor` or `executeOperation`.
**How to avoid:** Handle both SIGINT and SIGTERM. Track ALL spawned processes in a Set. Kill them all on exit.
**Warning signs:** `ps aux | grep godot` shows orphaned processes after stopping the MCP server.

### Pitfall 6: execFile Without maxBuffer
**What goes wrong:** Godot can produce large stdout output (especially with `--debug-godot` flag). The default `execFile` maxBuffer is 1MB. If exceeded, the process is killed with `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`.
**Why it happens:** Godot debug output can be verbose, and scene operations on large projects produce substantial JSON.
**How to avoid:** Set `maxBuffer: 10 * 1024 * 1024` (10MB) on all `execFileAsync` calls. Also set reasonable `timeout` values (30s for normal ops, 60s for large operations).
**Warning signs:** Truncated tool responses or "maxBuffer length exceeded" errors.

### Pitfall 7: tsconfig moduleResolution
**What goes wrong:** The new SDK's package.json uses `exports` map with conditional `import`/`require` entries. With `moduleResolution: "node"` (the old setting), TypeScript may not resolve the `.js` subpath imports correctly.
**Why it happens:** The `moduleResolution: "node"` setting doesn't understand package.json `exports`.
**How to avoid:** Update tsconfig.json to `"moduleResolution": "nodenext"` and `"module": "nodenext"`. This enables proper package.json exports resolution.
**Warning signs:** TypeScript errors like "Cannot find module '@modelcontextprotocol/sdk/server/mcp.js'".

## Code Examples

### New SDK Server Setup (verified from SDK 1.27.1 type definitions)
```typescript
// Source: @modelcontextprotocol/sdk@1.27.1 dist/esm/server/mcp.d.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer(
  { name: 'godot-mcp', version: '0.2.0' },
  { capabilities: { tools: {} } }
);

// registerTool signature (from mcp.d.ts):
// registerTool<OutputArgs, InputArgs>(
//   name: string,
//   config: {
//     title?: string;
//     description?: string;
//     inputSchema?: InputArgs;    // ZodRawShapeCompat or AnySchema
//     outputSchema?: OutputArgs;
//     annotations?: ToolAnnotations;
//     _meta?: Record<string, unknown>;
//   },
//   cb: ToolCallback<InputArgs>
// ): RegisteredTool;

server.registerTool(
  'get_godot_version',
  {
    title: 'Get Godot Version',
    description: 'Get the installed Godot version',
  },
  async (extra) => {
    // zero-arg tool: callback receives (extra) not (args, extra)
    const version = await getGodotVersion();
    return {
      content: [{ type: 'text', text: version }],
    };
  }
);

server.registerTool(
  'launch_editor',
  {
    title: 'Launch Editor',
    description: 'Launch Godot editor for a specific project',
    inputSchema: {
      project_path: z.string().describe('Path to the Godot project directory'),
    },
  },
  async ({ project_path }) => {
    // args are automatically validated by SDK; typed from Zod schema
    return {
      content: [{ type: 'text', text: `Editor launched for ${project_path}` }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Process Hardening Pattern
```typescript
// Source: Node.js child_process documentation
import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Hardened execFile with limits
async function execGodot(godotPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(godotPath, args, {
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 30_000,              // 30 seconds
    });
  } catch (error: unknown) {
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      const execError = error as Error & { stdout: string; stderr: string; killed?: boolean };
      if (execError.killed) {
        throw new Error('Godot process timed out after 30 seconds');
      }
      // Non-zero exit code still has output
      return { stdout: execError.stdout ?? '', stderr: execError.stderr ?? '' };
    }
    throw error;
  }
}
```

### Signal Handler Pattern
```typescript
// Track all child processes for cleanup
const trackedProcesses = new Set<ChildProcess>();

function trackProcess(proc: ChildProcess): ChildProcess {
  trackedProcesses.add(proc);
  proc.once('exit', () => trackedProcesses.delete(proc));
  proc.once('error', () => trackedProcesses.delete(proc));
  return proc;
}

async function shutdown(server: McpServer): Promise<void> {
  console.error('[SERVER] Shutting down...');
  for (const proc of trackedProcesses) {
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }
  }
  trackedProcesses.clear();
  await server.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown(server));
process.on('SIGTERM', () => shutdown(server));
```

## State of the Art

| Old Approach (SDK 0.6.0) | Current Approach (SDK 1.27.1) | When Changed | Impact |
|---------------------------|-------------------------------|--------------|--------|
| `new Server({name, version}, {capabilities})` | `new McpServer({name, version}, {capabilities})` | SDK 1.0+ | High-level API handles tool listing/dispatch |
| `server.setRequestHandler(ListToolsRequestSchema, ...)` | `server.registerTool(name, config, handler)` | SDK 1.0+ | No manual tool listing needed |
| `server.setRequestHandler(CallToolRequestSchema, ...)` + switch | Automatic dispatch by McpServer | SDK 1.0+ | No manual routing |
| Hand-written JSON Schema objects | Zod schemas auto-converted | SDK 1.0+ | Type-safe, less code |
| `Server` class (now deprecated) | `McpServer` class (recommended) | SDK 1.0+ | `Server` still exists for advanced use cases |
| `server.tool()` (deprecated in 1.27) | `server.registerTool()` | ~SDK 1.25+ | Cleaner config-object API |

**Deprecated/outdated:**
- `Server` class: Deprecated in favor of `McpServer`. Still works but marked with `@deprecated`.
- `server.tool()`: Deprecated in SDK 1.27.1 in favor of `server.registerTool()`. All 7 overloads are marked `@deprecated`.
- `CallToolRequestSchema` / `ListToolsRequestSchema` manual handlers: Unnecessary with McpServer.
- `McpError` / `ErrorCode` direct usage: Still available but `registerTool` handles validation errors automatically.

## Existing Code Inventory

### Current Tool Count: 14 (not 12)
The roadmap mentions "12 existing tools" but the codebase contains 14:

| # | Tool Name | Domain | Lines (approx) |
|---|-----------|--------|----------------|
| 1 | launch_editor | Editor | 60 |
| 2 | run_project | Editor | 100 |
| 3 | get_debug_output | Editor | 25 |
| 4 | stop_project | Editor | 30 |
| 5 | get_godot_version | Project | 35 |
| 6 | list_projects | Project | 45 |
| 7 | get_project_info | Project | 80 |
| 8 | create_scene | Scene | 55 |
| 9 | add_node | Scene | 75 |
| 10 | load_sprite | Scene | 80 |
| 11 | export_mesh_library | Scene/Asset | 65 |
| 12 | save_scene | Scene | 70 |
| 13 | get_uid | UID | 75 |
| 14 | update_project_uids | UID | 50 |

### Domain Groupings for Modules
- **editor** (4 tools): launch_editor, run_project, stop_project, get_debug_output
- **project** (3 tools): get_godot_version, list_projects, get_project_info
- **scene** (5 tools): create_scene, add_node, load_sprite, export_mesh_library, save_scene
- **uid** (2 tools): get_uid, update_project_uids

### Shared Infrastructure to Extract
- `GodotServer` class state: godotPath, operationsScriptPath, activeProcess, validatedPaths, parameterMappings
- `detectGodotPath()` and `isValidGodotPath()`: Godot binary detection
- `executeOperation()`: Run GDScript operations via headless Godot
- `createErrorResponse()`: Structured error formatting
- `validatePath()`: Path traversal prevention
- `normalizeParameters()` / `convertCamelToSnakeCase()`: Can be eliminated with proper Zod schemas using snake_case keys

### tsconfig.json Changes Needed
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

Key changes: `module` from `ESNext` to `nodenext`, `moduleResolution` from `node` to `nodenext`, remove `allowJs` (not needed).

## Open Questions

1. **Tool count discrepancy: 14 vs 12**
   - What we know: The codebase has 14 tools; the roadmap says 12.
   - What's unclear: Whether 2 tools should be removed or the count was just wrong.
   - Recommendation: Keep all 14 tools. The count in the roadmap was likely approximate. All tools should be migrated.

2. **Parameter naming convention: camelCase vs snake_case**
   - What we know: Current code accepts both via normalizeParameters(), but the GDScript expects snake_case.
   - What's unclear: Whether Claude Code sends camelCase or snake_case.
   - Recommendation: Define Zod schemas with snake_case keys (matching what Godot expects). This eliminates the normalizeParameters/convertCamelToSnakeCase functions entirely. Claude will see the schema and send the right format.

3. **fs-extra dependency for build script**
   - What we know: `fs-extra` is only used in `scripts/build.js` for `ensureDirSync` and `copyFileSync`.
   - What's unclear: Whether it's worth keeping as a dependency.
   - Recommendation: Keep for now. Low priority to remove. Could replace with Node.js built-in `fs.mkdirSync({recursive: true})` + `fs.copyFileSync()` in a future cleanup.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (to be installed) |
| Config file | none -- see Wave 0 |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUN-01 | SDK version is 1.27.1+ in package.json | unit | `npx vitest run tests/sdk-version.test.ts -t "sdk version"` | No -- Wave 0 |
| FOUN-02 | McpServer registers all 14 tools, tool list matches expected names | unit | `npx vitest run tests/tool-registration.test.ts` | No -- Wave 0 |
| FOUN-03 | Zod is in dependencies, version ^3.25+ | unit | `npx vitest run tests/sdk-version.test.ts -t "zod"` | No -- Wave 0 |
| FOUN-04 | execFileAsync calls include maxBuffer and timeout options | unit | `npx vitest run tests/process-hardening.test.ts` | No -- Wave 0 |
| FOUN-05 | Tool errors return { error, suggestions } structure with isError: true | unit | `npx vitest run tests/error-responses.test.ts` | No -- Wave 0 |
| FOUN-06 | src/index.ts under 100 lines; src/tools/ has domain modules | smoke | `wc -l src/index.ts && ls src/tools/` | No -- manual |
| FOUN-07 | No console.log in src/**/*.ts | smoke | `grep -r "console.log" src/ && echo FAIL \|\| echo PASS` | No -- script |
| FOUN-08 | Both SIGINT and SIGTERM handlers registered; tracked processes cleaned up | unit | `npx vitest run tests/signal-handlers.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run && grep -r "console.log" src/ && test $(wc -l < src/index.ts) -lt 100`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest` -- install as devDependency: `npm install -D vitest`
- [ ] `vitest.config.ts` -- basic config for TypeScript ESM project
- [ ] `tests/tool-registration.test.ts` -- verify all 14 tools register on McpServer
- [ ] `tests/process-hardening.test.ts` -- verify maxBuffer/timeout on exec calls
- [ ] `tests/error-responses.test.ts` -- verify error structure
- [ ] `tests/signal-handlers.test.ts` -- verify SIGINT/SIGTERM handlers exist

## Sources

### Primary (HIGH confidence)
- `@modelcontextprotocol/sdk@1.27.1` npm package -- inspected `dist/esm/server/mcp.d.ts` type definitions directly
- `@modelcontextprotocol/sdk@1.27.1` `package.json` -- verified exports map, peer dependencies, version
- `@modelcontextprotocol/sdk@0.6.0` (installed in project) -- compared import paths and API surface
- `/home/cstory/src/godot-mcp/src/index.ts` -- full 2,196-line source analysis
- npm registry -- verified SDK version 1.27.1 is latest, Zod 3.25.76 is latest 3.x

### Secondary (MEDIUM confidence)
- [TypeScript SDK GitHub repo](https://github.com/modelcontextprotocol/typescript-sdk) -- verified `registerTool()` replaces `tool()` (deprecated)
- [TypeScript SDK server docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) -- confirms McpServer as recommended high-level API
- [SDK GitHub Issue #925](https://github.com/modelcontextprotocol/typescript-sdk/issues/925) -- Zod v4 compatibility issues
- [SDK GitHub Issue #1380](https://github.com/modelcontextprotocol/typescript-sdk/issues/1380) -- Schema method literal errors with some Zod 4 versions

### Tertiary (LOW confidence)
- None -- all findings verified with primary or secondary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Verified SDK version, peer deps, and API from actual package type definitions
- Architecture: HIGH -- Derived from inspecting all 2,196 lines of existing code and mapping to new SDK API
- Pitfalls: HIGH -- Import paths verified by installing SDK 1.27.1; process management from Node.js docs; Zod issues from GitHub issues
- Validation: MEDIUM -- vitest recommended but not yet set up; test patterns are standard

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (SDK stable; 30-day validity)
