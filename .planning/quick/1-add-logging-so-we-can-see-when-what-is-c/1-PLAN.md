---
phase: quick
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/logger.ts
  - src/index.ts
autonomous: true
requirements: [LOGGING-01]
must_haves:
  truths:
    - "Every tool call logs tool name and arguments to stderr on invocation"
    - "Every tool call logs duration and success/error status on completion"
    - "Logging is controlled by LOG_LEVEL env var (debug, info, warn, error) defaulting to info"
    - "Existing tool behavior is completely unchanged"
  artifacts:
    - path: "src/logger.ts"
      provides: "Logger utility and McpServer tool-call logging wrapper"
      exports: ["logger", "wrapServerWithLogging"]
    - path: "src/index.ts"
      provides: "Entry point with logging wrapper applied before tool registration"
  key_links:
    - from: "src/index.ts"
      to: "src/logger.ts"
      via: "wrapServerWithLogging(server) call before registerXxxTools calls"
      pattern: "wrapServerWithLogging"
---

<objective>
Add structured logging to the Godot MCP server so that every tool call logs what tool was called, with what arguments, how long it took, and whether it succeeded or failed.

Purpose: Observability -- currently there is no way to see which tools are being called or debug issues in production. All logging goes to stderr (safe for stdio MCP transport).
Output: A logger module and a thin wrapper that intercepts all registerTool callbacks to add automatic logging.
</objective>

<execution_context>
@/home/cstory/.claude/get-shit-done/workflows/execute-plan.md
@/home/cstory/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/index.ts
@src/types.ts
@src/server.ts
@src/godot.ts
@src/errors.ts

<interfaces>
<!-- Key types and contracts the executor needs -->

From src/index.ts:
- McpServer is created via `new McpServer({ name, version }, { capabilities })`
- Tools are registered via `server.registerTool(name, config, callback)`
- All register calls happen BEFORE `server.connect(transport)`

From @modelcontextprotocol/sdk:
```typescript
// registerTool signature (from mcp.d.ts):
registerTool<OutputArgs, InputArgs>(
  name: string,
  config: { title?: string; description?: string; inputSchema?: InputArgs; outputSchema?: OutputArgs; annotations?: ToolAnnotations; _meta?: Record<string, unknown> },
  cb: ToolCallback<InputArgs>
): RegisteredTool;
```

Existing logging pattern:
- All logging uses `console.error()` (required: MCP uses stdio, stdout is reserved for protocol)
- Tags: `[SERVER]`, `[DEBUG]`, `[MCP Error]`
- DEBUG_MODE in godot.ts is controlled by `process.env.DEBUG === 'true'`
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create logger module with McpServer logging wrapper</name>
  <files>src/logger.ts</files>
  <action>
Create `src/logger.ts` with two exports:

1. **`logger`** -- a lightweight structured logger that writes to stderr (console.error).
   - Supports levels: `debug`, `info`, `warn`, `error`
   - Reads `LOG_LEVEL` env var (default: `info`). Also respects existing `DEBUG=true` env var by treating it as `debug` level.
   - Each log line formatted as: `[GODOT-MCP] [LEVEL] [TIMESTAMP] message`
   - Timestamp should be ISO string (compact, e.g. `2026-03-04T12:00:00.000Z`)
   - Methods: `logger.debug(msg)`, `logger.info(msg)`, `logger.warn(msg)`, `logger.error(msg)`
   - Keep it simple -- no classes, just a plain object with methods.

2. **`wrapServerWithLogging(server: McpServer): void`** -- monkey-patches `server.registerTool` to wrap every tool callback:
   - Save a reference to the original `server.registerTool` method
   - Replace `server.registerTool` with a new function that:
     a. Wraps the provided callback (`cb`) in a logging wrapper
     b. The wrapper logs BEFORE the call: `logger.info('Tool called: {toolName}')` and `logger.debug('Tool args: {JSON.stringify(args)}')` -- args at debug level to avoid noisy default output
     c. Records `Date.now()` start time
     d. Calls the original callback with all original arguments (args, extra)
     e. On success: `logger.info('Tool completed: {toolName} ({duration}ms)')`
     f. On error: `logger.error('Tool failed: {toolName} ({duration}ms) - {error.message}')` then re-throws
     g. Calls the original `registerTool` with the same name, config, and the wrapped callback
   - The wrapper must preserve the callback signature exactly -- it receives `(args, extra)` where extra is the RequestHandlerExtra from the SDK. Use a generic passthrough approach: `(...callArgs: any[]) => { ... originalCb(...callArgs) }` to avoid TypeScript generics complexity.
   - Use `as any` casts on the registerTool override since we are monkey-patching and the SDK types are complex generics. This is intentional -- the wrapper is transparent.

Important: Do NOT use any external dependencies. This is pure Node.js/TypeScript.
  </action>
  <verify>
    <automated>cd /home/cstory/src/godot-mcp && npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>src/logger.ts exists, exports logger and wrapServerWithLogging, TypeScript compiles cleanly</done>
</task>

<task type="auto">
  <name>Task 2: Integrate logging wrapper into server entry point</name>
  <files>src/index.ts</files>
  <action>
Modify `src/index.ts` to apply the logging wrapper:

1. Add import: `import { logger, wrapServerWithLogging } from './logger.js';`

2. After `const server = new McpServer(...)` and BEFORE any `registerXxxTools` calls, add:
   ```
   wrapServerWithLogging(server);
   ```

3. Replace the existing `console.error('Godot MCP server running on stdio');` at the bottom with:
   ```
   logger.info('Server started on stdio transport');
   ```

4. Replace `server.server.onerror = (error: unknown) => console.error('[MCP Error]', error);` with:
   ```
   server.server.onerror = (error: unknown) => logger.error(`MCP protocol error: ${error}`);
   ```

5. In the `shutdown` function, replace `console.error('[SERVER] Shutting down...');` with:
   ```
   logger.info('Server shutting down...');
   ```

Do NOT modify any of the registerXxxTools calls or any tool files -- the wrapper handles logging transparently.
  </action>
  <verify>
    <automated>cd /home/cstory/src/godot-mcp && npx tsc --noEmit 2>&1 | head -20 && node build/index.js --help 2>&1 || true</automated>
  </verify>
  <done>Server entry point uses logger, wrapServerWithLogging is called before tool registration, `tsc --noEmit` passes with no errors</done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes with zero errors
2. `npm run build` succeeds
3. Running with `LOG_LEVEL=debug node build/index.js` shows debug-level startup messages on stderr
4. All existing tests still pass: `npx vitest run`
</verification>

<success_criteria>
- Every tool invocation automatically logs tool name and duration to stderr
- Arguments are logged at debug level (not shown by default to avoid noise)
- LOG_LEVEL env var controls verbosity (debug/info/warn/error, default: info)
- Zero changes to any tool file -- logging is entirely via the registerTool wrapper
- All existing tests pass unchanged
</success_criteria>

<output>
After completion, create `.planning/quick/1-add-logging-so-we-can-see-when-what-is-c/1-SUMMARY.md`
</output>
