# Coding Conventions

**Analysis Date:** 2026-03-03

## Naming Patterns

**Files:**
- kebab-case for multi-word files: `tscn-parser.ts`, `project-parser.ts`, `tscn-types.ts`
- Domain-prefixed grouping: `src/tools/scene.ts`, `src/tools/editor.ts`, `src/tools/diagnostics.ts`
- Test files mirror source names with `.test.ts` suffix: `scene-tools.test.ts`, `tscn-parser.test.ts`

**Functions:**
- camelCase: `toolError()`, `validatePath()`, `executeOperation()`, `trackProcess()`, `isValidGodotPath()`
- Boolean predicates prefixed with `is`: `isBalanced()`, `isValidGodotPath()`, `isGodot44OrLater()`
- Registration functions prefixed with `register`: `registerSceneTools()`, `registerEditorTools()`, `registerDiagnosticsTools()`
- Private helpers are local functions (not exported): `logDebug()`, `parseSectionHeader()`, `parsePropertyLine()`, `buildExtResource()`, `buildNode()`

**Variables:**
- camelCase: `godotPath`, `activeProcess`, `trackedProcesses`, `validatedPaths`, `lspClient`
- Constants in SCREAMING_SNAKE_CASE: `MAX_BUFFER`, `EXEC_TIMEOUT`, `SCREENSHOT_SIZE_THRESHOLD`, `SCREENSHOT_TIMEOUT_MS`, `DEFAULT_LSP_PORT`, `PORT_WAIT_TIMEOUT_MS`
- Boolean flags: `DEBUG_MODE`, `GODOT_DEBUG_MODE`

**Types / Interfaces:**
- PascalCase for interfaces: `ServerContext`, `GodotProcess`, `OperationParams`, `ToolResult`, `SectionHeader`
- PascalCase for type aliases and imported types: `ParsedScene`, `ParsedResource`, `SceneNode`, `ExtResource`
- Interface-first, no `I` prefix

**MCP Tool Parameters:**
- snake_case in Zod inputSchema (matching MCP convention): `project_path`, `scene_path`, `node_type`, `root_node_type`
- camelCase when building internal params object passed to `executeOperation`: `scenePath`, `rootNodeType`, `nodeName`

## Code Style

**Formatting:**
- No Prettier or ESLint config detected — formatting is manually applied and consistent
- 2-space indentation throughout
- Single quotes for string literals in TypeScript source
- `as const` type assertions on string literals in content arrays: `type: 'text' as const`
- Trailing commas in multi-line function calls and array/object literals
- Semicolons throughout

**TypeScript Strictness:**
- `strict: true` in `tsconfig.json` — all strict checks enabled
- `error: unknown` in catch blocks, always narrowed with `error instanceof Error ? error.message : 'Unknown error'`
- Non-null assertions (`!`) used only where logically guaranteed (e.g., handler Map lookups in tests)
- Explicit `type` keyword for type-only imports: `import type { ServerContext } from './types.js'`
- `.js` extensions on all internal imports (required by `module: "nodenext"`)

**Linting:**
- No ESLint config present — convention enforced by code review and TypeScript strict mode
- Unused parameters prefixed with `_`: `_config`, `_options`, `_path`

## Import Organization

**Order:**
1. Node built-in modules: `child_process`, `fs`, `path`, `url`, `util`, `events`, `net`
2. External packages: `@modelcontextprotocol/sdk/...`, `zod`
3. Internal project imports: `../types.js`, `../godot.js`, `../errors.js`, `../parsers/tscn-parser.js`

**Path Aliases:**
- None — relative imports with `.js` extension used everywhere

**Import Style:**
- Named imports preferred: `import { existsSync, readFileSync } from 'fs'`
- `import type` for type-only imports
- Default imports only where required by external API

## Error Handling

**Primary Pattern:**
All tool handlers use `toolError()` from `src/errors.ts`. This is **required** — tests enforce it by scanning source for ad-hoc `isError:` usage.

```typescript
// Correct pattern: always use toolError()
return toolError('Invalid path', [
  'Provide valid paths without ".." or other potentially unsafe characters',
]);
```

**Catch Block Pattern:**
```typescript
} catch (error: unknown) {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  return toolError(`Failed to create scene: ${errorMessage}`, [
    'Ensure Godot is installed correctly',
    'Check if the GODOT_PATH environment variable is set correctly',
    'Verify the project path is accessible',
  ]);
}
```

**Error Response Shape:**
- `toolError()` returns `{ content: [{ type: 'text', text: JSON.stringify({ error, suggestions }) }], isError: true }`
- Always includes `suggestions` array even when empty
- Logs to `console.error` (safe for stdio transport) — never `console.log`

**Stderr Inspection:**
- After `executeOperation()`, check `stderr.includes('Failed to')` before assuming success
- Non-zero exits are recoverable — `execFileAsync` returns stdout/stderr even on failure

## Logging

**Framework:** `console.error` only (stdout is the MCP transport channel — writing to it corrupts messages)

**Patterns:**
- Server events: `console.error('[SERVER] ...')`
- Debug logs: `console.error('[DEBUG] ...')` — gated by `DEBUG_MODE` flag (env `DEBUG=true`)
- MCP errors: `console.error('[MCP Error]', error)` via `server.server.onerror`
- Process output: `console.error('[Godot stdout] ...')` / `console.error('[Godot stderr] ...')`
- Never use `console.log` anywhere in source code

**Debug Guard:**
```typescript
const DEBUG_MODE: boolean = process.env.DEBUG === 'true';

function logDebug(message: string): void {
  if (DEBUG_MODE) {
    console.error(`[DEBUG] ${message}`);
  }
}
```

## Comments

**When to Comment:**
- Every exported function has a JSDoc block
- Private helpers have JSDoc blocks if their purpose is non-obvious
- Module-level JSDoc at top of every file describing the domain
- Inline comments for non-obvious constants: `/** 10 MB max buffer for Godot process output */`
- Tool registration blocks labeled with their tool number: `// Tool 8: create_scene`

**JSDoc Style:**
```typescript
/**
 * Create a structured error response for a tool invocation.
 *
 * Logs to stderr (safe for stdio transport) and returns a JSON body
 * that the LLM can parse for recovery suggestions.
 */
export function toolError(message: string, suggestions: string[] = []): ToolResult {
```

## Function Design

**Size:** Functions are focused — tool handlers follow a consistent ~30-line pattern; parser helpers are single-responsibility

**Parameters:**
- Context (`ServerContext`) passed explicitly to all tool registration functions and `executeOperation`
- Optional parameters use TypeScript optional syntax (`param?: string`) or default values (`suggestions: string[] = []`)
- Zod-destructured parameters use snake_case from MCP input

**Return Values:**
- Tool handlers always return `{ content: Array<{ type: 'text'; text: string }> }` or `toolError(...)`
- The `toolError` return type `ToolResult` satisfies the MCP SDK `CallToolResult` shape
- Async functions return `Promise<T>` — all tool handlers are `async`

## Module Design

**Exports:**
- Tool modules export a single `register*Tools(server, ctx)` function
- Parser modules export named parsing functions: `parseScene()`, `parseResource()`, `parseProjectSettings()`
- Types defined in separate `*-types.ts` files alongside their parsers
- `src/errors.ts` exports `toolError` and `ToolResult` — used uniformly across all tool modules

**Barrel Files:**
- None — direct imports throughout

## Path Safety

All user-supplied paths are validated with `validatePath()` before use:

```typescript
export function validatePath(path: string): boolean {
  if (!path || path.includes('..')) {
    return false;
  }
  return true;
}
```

All tool handlers call `validatePath()` as the first check, returning `toolError()` immediately on failure.

---

*Convention analysis: 2026-03-03*
