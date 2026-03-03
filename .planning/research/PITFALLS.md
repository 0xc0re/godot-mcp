# Pitfalls Research

**Domain:** MCP server for Godot Engine development (TypeScript/Node.js)
**Researched:** 2026-03-03
**Confidence:** HIGH (verified across multiple sources including official docs, GitHub issues, community reports)

---

## Critical Pitfalls

### Pitfall 1: stdout Pollution Breaks the JSON-RPC Protocol Silently

**What goes wrong:**
Any `console.log()` or third-party library that writes to stdout corrupts the MCP stdio transport. The client receives malformed JSON-RPC and drops the connection. This can manifest as the server appearing to connect but then silently failing, tools not appearing, or intermittent disconnects.

**Why it happens:**
Developers naturally reach for `console.log()` for debugging. The stdio transport is stream-based and treats stdout as an exclusive JSON-RPC channel — any non-protocol bytes are fatal. Third-party libraries imported at startup (e.g., for version banners or warnings) can pollute stdout before the protocol handshake even starts.

The existing codebase is already hardened on this point (`logDebug()` uses `console.error()`), but new tool handlers added during expansion are at risk if developers slip up. The `GODOT_DEBUG_MODE = true` hardcode in `src/index.ts` line 27 may also produce unexpected output via Godot's `--debug-godot` flag going to the wrong stream.

**How to avoid:**
- Enforce in code review: `console.log` is banned in server code; lint rule preferred
- Redirect all debug output to `console.error()` exclusively
- When importing new dependencies, verify they do not print to stdout on import
- Use `DEBUG=true` env variable gating so debug output only appears when intentional
- Set up a test that pipes the server's stdout and validates every line is valid JSON-RPC

**Warning signs:**
- MCP client connects but tools don't appear
- "Invalid JSON" or "Unexpected token" errors in the MCP client logs
- Works in inspector but not in Claude Code
- Server appears connected (`claude mcp list` shows green) but no tools callable

**Phase to address:**
Phase 1 (SDK upgrade). The refactor is the right moment to add a lint rule and audit all imports. New tool additions in every subsequent phase must enforce this.

---

### Pitfall 2: MCP SDK Upgrade Breaks Protocol Handshake with Claude Code

**What goes wrong:**
The server is on SDK 0.6.0, which speaks protocol version `2024-11-05`. Claude Code expects a newer protocol version. The mismatch means the initialize handshake fails before tools are ever listed. This is the root cause of the known "tools don't appear in Claude Code" bug.

**Why it happens:**
The MCP protocol uses date-based version strings (`2024-11-05`, `2025-03-26`). The client sends its supported version in the `initialize` request; if the server responds with an incompatible version, the connection is aborted. SDK 0.6.0 locks the protocol version to `2024-11-05`. SDK 1.x (current stable) implements `2025-03-26`.

Upgrading to SDK 1.x is not a simple dependency bump. The API surface changed:
- `server.setRequestHandler(ListToolsRequestSchema, ...)` still works but is the "low-level" pattern
- The new preferred pattern uses `McpServer` class with `registerTool()` method instead of the `Server` class
- `server.tool()` in SDK 1.0 was the original high-level API, then deprecated in favor of `registerTool()` in later 1.x releases
- Zod was added as a first-class dependency for schema validation; multiple Zod versions in the dependency tree cause TypeScript `TS2589` recursion errors

**How to avoid:**
- Upgrade directly to the latest stable 1.x (currently ~1.27.x), not an intermediate version
- After upgrade, run `npm ls zod` to verify only one Zod version is installed
- Keep using the low-level `Server` + `setRequestHandler` pattern for this codebase (less churn than migrating to `McpServer`/`registerTool`); it is still fully supported
- Test the protocol handshake with `npx @modelcontextprotocol/inspector` before declaring the upgrade done
- Check that `protocolVersion` in the initialize response matches what Claude Code expects

**Warning signs:**
- Tools still don't appear in Claude Code after upgrade
- TypeScript errors: `TS2589: Type instantiation is excessively deep and possibly infinite`
- Server connects in Claude Desktop but not Claude Code
- Inspector shows tools correctly but Claude Code does not

**Phase to address:**
Phase 1 (SDK upgrade). This is the primary objective of the first phase.

---

### Pitfall 3: Claude Code Strict Schema Validation Silently Breaks Tool Registration

**What goes wrong:**
Claude Code v2.0.21+ introduced strict JSON Schema validation for MCP tool `inputSchema` definitions. Schemas using `oneOf`, `allOf`, or `anyOf` at the root level are rejected with an error that may not clearly identify which tool is problematic. The entire Claude Code session can fail to start, not just the affected MCP server.

**Why it happens:**
The MCP protocol requires `inputSchema` to be JSON Schema draft 2020-12 compliant. Claude Code added stricter enforcement of this, blocking schema composition keywords at the top level. The error is thrown server-side during the `tools/list` response processing, before the user's session starts.

The current 12 tools in this codebase use plain `{ type: "object", properties: {...} }` schemas which are safe. However, as new tools are added for features like GDScript analysis or scene queries, developers may be tempted to use complex schemas with discriminated unions or optional/required variations that trigger this validation.

**How to avoid:**
- Keep all `inputSchema` at the root level as `{ type: "object", properties: {...}, required: [...] }`
- Avoid `oneOf`/`anyOf`/`allOf` at the root of any tool's `inputSchema`
- If complex schemas are needed, flatten them or use an `additionalProperties: true` fallback
- Add a CI test that validates all tool schemas against JSON Schema draft 2020-12 rules
- As a temporary escape hatch while debugging: Claude Code supports `"skipSchemaValidation": true` in MCP config

**Warning signs:**
- Claude Code fails to start with a `400 invalid_request_error` mentioning `input_schema`
- Error message references a numbered tool (`tools.7.custom.input_schema`)
- New tools added in a PR cause all existing tools to disappear

**Phase to address:**
Phase 1 (SDK upgrade) for auditing existing schemas; every subsequent phase when adding new tools.

---

### Pitfall 4: Godot Headless Process Output Buffer Overflow Causes Hangs

**What goes wrong:**
Node.js `execFile()` has an implicit stdout/stderr buffer limit (default 1MB in Node.js, but the underlying stream buffer is 8-64KB for pipes). If a Godot headless process produces output exceeding the buffer — which is easy with verbose GDScript errors, import messages, or large scene dumps — the child process blocks waiting for the parent to drain the buffer. The parent is waiting for the process to exit. Deadlock. The MCP tool call hangs indefinitely.

**Why it happens:**
`execFile` (and `exec`) accumulate all output in memory before resolving. When a Godot project loads, it generates import logs, scene tree validation messages, and potential error traces. Adding `--debug-godot` (hardcoded to `true` in line 27 of `src/index.ts`) significantly increases output volume. The current `execFileAsync` usage in `executeOperation()` is vulnerable to this.

**How to avoid:**
- Pass `{ maxBuffer: 10 * 1024 * 1024 }` (10MB) to `execFileAsync` calls as an explicit option — do not rely on defaults
- For long-running or high-output operations (e.g., exporting, running tests), switch to `spawn()` with streaming output consumption rather than `execFile`
- Remove or make optional the `GODOT_DEBUG_MODE = true` hardcode; verbose output from `--debug-godot` can easily overwhelm buffers
- Add timeout parameter to `execFileAsync` to prevent infinite hangs: `{ timeout: 30000 }`

**Warning signs:**
- Tool calls that work with small projects hang with larger ones
- Tool call never resolves, eventually times out at the MCP client level
- `maxBuffer exceeded` error in Node.js output
- Processes accumulate in `ps aux` as zombie states

**Phase to address:**
Phase 1 (SDK upgrade/refactor) — fix the `executeOperation()` function. Any phase adding GDScript analysis or scene inspection tools is especially at risk.

---

### Pitfall 5: Godot Headless Script Must Call `get_tree().quit()` or It Hangs Forever

**What goes wrong:**
GDScript files running via `godot --headless --script` do not automatically exit when the script's `_ready()` finishes. If `get_tree().quit()` is not called (or if the script crashes before reaching it), the Godot process hangs indefinitely. From Node.js, `execFile` will wait forever (or until the timeout). Without a timeout, the MCP server stalls.

**Why it happens:**
Godot runs a full engine loop even in headless mode. A script is a node in the scene tree; when it finishes executing, the engine continues running the idle/physics loop until explicitly told to quit. Any exception or error in the GDScript that bypasses `quit()` creates a zombie Godot process.

The `godot_operations.gd` script must be audited to ensure all code paths — including error paths — call `get_tree().quit()`. New operations added to this file are at risk of missing exit calls.

**How to avoid:**
- Use a try/finally equivalent in GDScript: wrap all operations in error handling, call `get_tree().quit()` in both success and failure paths
- Add `{ timeout: 30000 }` to `execFileAsync` calls as a backstop
- In the cleanup handler, `kill()` any active `execFile` processes that exceed a timeout
- Test each new GDScript operation with a deliberately broken project to confirm the process exits

**Warning signs:**
- `ps aux | grep godot` shows accumulating Godot processes
- Tool calls that previously returned results start hanging
- Memory/CPU usage grows over a session as zombie Godots accumulate

**Phase to address:**
Phase 1 (refactor) for the existing script; every phase adding new GDScript operations.

---

### Pitfall 6: Single `activeProcess` State Prevents Multiple Run Sessions and Loses Godot Output

**What goes wrong:**
The server tracks exactly one running Godot project in `this.activeProcess`. If a user runs two projects, the second overwrites the first, leaking the first process. If the server restarts (Claude Code sends SIGINT to MCP servers between sessions), `activeProcess` is reset to null but the underlying Godot process may still be running, becoming a zombie.

Additionally, when Claude Code exits, it does not reliably terminate child MCP server processes (documented bug: `anthropics/claude-code#1935`). The MCP server's `SIGINT` handler calls `cleanup()`, but SIGINT is not always sent.

**Why it happens:**
The current design supports exactly one long-running Godot process. The `run_project` handler sets `this.activeProcess` unconditionally. The state is instance-level, not request-scoped. MCP servers are stateful processes, but Claude Code's lifecycle management is inconsistent across platforms.

**How to avoid:**
- Use a `Map<string, GodotProcess>` keyed by project path instead of a single `activeProcess` reference
- Register both `SIGINT` and `SIGTERM` handlers for cleanup
- When `run_project` is called and a process is already running for the same path, kill the old one first
- Write PIDs to a temporary file so that a restarted server can clean up orphaned Godot processes from previous sessions
- Add `process.on('exit', cleanup)` as a backstop for ungraceful shutdowns

**Warning signs:**
- `ps aux | grep godot` shows multiple Godot processes after using `run_project` several times
- `get_debug_output` returns stale output from a previous session
- Memory usage grows unbounded over a multi-hour session

**Phase to address:**
Phase 2 (expanded run/debug capabilities) where process management becomes more complex.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| All 12+ tools in one `setRequestHandler` switch statement | Simple to follow the code | Adding each new tool requires editing the same 2000-line function; merge conflicts; hard to test in isolation | Never — refactor to separate files during SDK upgrade |
| `GODOT_DEBUG_MODE = true` hardcoded constant | Verbose output during development | Production users get `--debug-godot` flag on every call, increasing output noise and buffer overflow risk | Never — should be opt-in via env var |
| `OperationParams = Record<string, any>` for all parameters | Quick to implement | No compile-time type checking on tool parameters; runtime bugs that TypeScript could catch | Acceptable short-term; replace with typed interfaces per operation as tools are added |
| Inline parameter validation in each handler | Self-contained handlers | Copy-pasted validation logic diverges; security checks can be missed in new handlers | Never — create shared validators |
| Path traversal check that only rejects `..` | Covers the obvious case | Misses URL-encoded traversals, symlink-based attacks, absolute paths to sensitive locations | Acceptable for local dev tool — add more thorough validation before any production use |
| `godot_operations.gd` as single-file operations script | All operations in one place | Grows without bound; Godot loads the entire script even for simple operations; hard to test individual operations | Refactor when operation count exceeds 10 |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code MCP config | Forgetting to rebuild (`npm run build`) before testing config changes — Claude Code loads the compiled `build/index.js` | Add a `prepare` script and document the build-first requirement clearly; consider a watch mode in dev |
| Claude Code MCP config | Using relative paths in `command` field of `.mcp.json` — breaks when Claude Code starts from a different cwd | Always use absolute paths in MCP server `command` configuration |
| MCP Inspector vs Claude Code | Assumes Inspector parity with Claude Code — Inspector shows tools correctly but Claude Code has stricter schema validation and different protocol version requirements | Always test against actual Claude Code, not just Inspector |
| Godot executable path | Using `godot4` or `godot-4` as the binary name — varies by distro and install method (Flatpak, system package, manual) | Test all common paths; check `GODOT_PATH` env var first; document that Flatpak users need a wrapper script |
| execFile vs exec | Using `exec` allows shell injection; the switch to `execFile` (done in the existing codebase) is correct | Never revert to `exec` or `spawn` with `shell: true` for user-provided paths or parameters |
| Godot headless with `--import` | Running a script against a project that has never been opened in the editor: resources fail to load because `.godot/` import cache doesn't exist | For new projects, run `godot --headless --editor --quit` first to populate the import cache, or use `--import` flag |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| All tool definitions loaded eagerly in `setupToolHandlers()` | Works fine now with 12 tools; each tool description is ~300-600 tokens | Keep descriptions concise; group related operations to reduce tool count | Around 30-40 tools, context window consumption becomes noticeable; at 50+ tools, LLM accuracy degrades |
| Spawning a fresh Godot process for every operation | Acceptable latency for 1-3 ops per minute | Each spawn takes 1-3 seconds on most machines; rapid tool calls feel sluggish | When AI makes 10+ tool calls in quick succession during a complex task |
| No timeout on `execFileAsync` | Unnoticeable if Godot always exits cleanly | A single hung operation blocks the MCP server for all subsequent calls (stdio is sequential) | First time a Godot operation hangs due to a bug or large output |
| Caching Godot path in `validatedPaths` forever | Avoids repeat validation overhead | If user upgrades Godot mid-session, server uses the old (now-invalid) cached path | Low risk for most users; document that server restart is required after Godot upgrade |
| Synchronous `readdirSync` in `getProjectStructure()` | Simple code | Blocks the Node.js event loop; with large project directories (10k+ files), all MCP operations pause | Projects with deeply recursive asset directories |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Path traversal via `..` in tool parameters | Read or execute arbitrary files outside the project | The existing `validatePath()` check covers `..` but should also reject paths that resolve outside the project root using `path.resolve()` comparison |
| Passing user-supplied paths directly to Godot as project path | Godot will execute autoload scripts in any valid project — an attacker could point it at a malicious project | Validate that the path contains `project.godot` before passing to Godot; the existing `detectGodotProject()` does this, but it should be enforced in all handlers |
| Shell injection via execFile | Already fixed by switching from `exec` to `execFile` | Never revert; document why `execFile` is required; add ESLint rule to ban `exec` and `spawn` with `shell: true` |
| Allowing arbitrary GDScript paths as `--script` argument | Could execute arbitrary GDScript outside the operations script | The `operationsScriptPath` is fixed at startup and should never be user-controlled |
| GDScript operations writing to arbitrary paths | Malicious operation parameters could write outside the project | Validate all output paths in `godot_operations.gd` against the project root |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Cryptic error when Godot is not found or wrong version | User has no idea how to fix it; assumes the MCP server is broken | Return actionable error: "Godot not found. Set GODOT_PATH=/path/to/godot4. Current search paths tried: [list]" |
| Returning raw Godot stderr as the error message | Godot error messages are formatted for developers, not AI clients | Parse stderr for known patterns; provide a structured error with the raw output plus a human-readable summary |
| Long tool descriptions that repeat the obvious | Wastes context window tokens | Keep descriptions to one sentence; use parameter `description` fields for detail; avoid restating parameter names |
| Silently succeeding when the project path doesn't exist | AI assistant proceeds as if operations worked | Always verify path existence before operation; return specific error if missing |
| Tool names that don't match Godot terminology | AI assistant may pick wrong tool or chain incorrectly | Use Godot's own vocabulary: `scene`, `node`, `resource`, `script` — not `file`, `object`, `document` |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **SDK Upgrade:** Looks done when `npm install` succeeds — verify by checking protocol version in the initialize handshake; test specifically in Claude Code (not just Inspector)
- [ ] **Tool appears in Claude Code:** Shows in `claude mcp list` with "Connected" status — this does not mean tools are callable; verify by actually invoking a tool from a session
- [ ] **Godot operation succeeds:** Returns no error response — verify the stdout was meaningful output, not just an empty string from a hung process that was killed by timeout
- [ ] **Scene created:** `create_scene` returns success — verify the `.tscn` file is syntactically valid by re-opening it with Godot
- [ ] **New tool added:** Handler code written and registered in the switch statement — verify the tool definition is also in `ListToolsRequestSchema` handler; these are in two separate places and can get out of sync
- [ ] **Process cleanup:** `stop_project` returns success — verify the Godot process is actually dead using `ps aux | grep godot`
- [ ] **Cross-platform paths:** Works on Linux — test that path separators work on Windows and that Godot path detection covers common Windows install locations

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| stdout pollution detected post-ship | MEDIUM | Find all `console.log` calls with grep; replace with `console.error`; add lint rule; release patch |
| SDK upgrade breaks protocol handshake | MEDIUM | Pin to the exact SDK version that worked; document the protocol version mismatch; test each upgrade candidate with Claude Code before releasing |
| Schema validation rejects a tool | LOW | Comment out the tool, fix the schema, re-enable; use `skipSchemaValidation` as temporary workaround while debugging |
| Zombie Godot processes accumulate | LOW | Document `pkill godot` as a reset step; add to README troubleshooting section; implement PID file cleanup in next release |
| Buffer overflow causes server to hang | MEDIUM | Restart the MCP server; add timeout and `maxBuffer` parameters to the `execFileAsync` call; release patch |
| Monolith too large to extend | HIGH | Module extraction is a significant refactor; plan a dedicated refactoring phase; do not add more tools before this work is done |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| stdout pollution | Phase 1 (SDK upgrade + refactor) | Lint rule in CI; pipe stdout in test and validate all lines are JSON-RPC |
| SDK protocol version mismatch | Phase 1 (SDK upgrade) | End-to-end test: invoke a tool from Claude Code |
| Strict schema validation failures | Phase 1 (audit) + all subsequent phases | CI schema validation test runs on every tool definition |
| execFile buffer overflow | Phase 1 (refactor executeOperation) | Test with a Godot project that generates large output |
| GDScript script hangs (no quit) | Phase 1 (audit godot_operations.gd) + every phase adding GDScript ops | Timeout test: every operation must complete within 30s |
| Single activeProcess state leaks | Phase 2 (enhanced run/debug) | Test: run two projects in sequence; verify only one Godot process exists |
| Tool/handler definition out of sync | Every phase | Add assertion that ListToolsRequestSchema count == switch case count |
| Too many tools bloating context | Phase 3+ (tool expansion) | Count tool tokens; stay under 30 tools unless lazy loading is implemented |
| Missing import cache for headless ops | Phase 2 (enhanced operations) | Test with a freshly cloned project that has no .godot directory |
| SIGTERM not triggering cleanup | Phase 1 (refactor) | Test server restart; verify no zombie Godot processes remain |

---

## Sources

- [MCP stdio pollution — Stainless MCP Portal](https://www.stainless.com/mcp/error-handling-and-debugging-mcp-servers)
- [MCP server stdio corruption — claude-flow issue #835](https://github.com/ruvnet/claude-flow/issues/835)
- [Claude Code strict schema validation — anthropics/claude-code #10606](https://github.com/anthropics/claude-code/issues/10606)
- [Claude Code MCP tools not exposed — anthropics/claude-code #12164](https://github.com/anthropics/claude-code/issues/12164)
- [Claude Code MCP tools not callable — anthropics/claude-code #25440](https://github.com/anthropics/claude-code/issues/25440)
- [MCP server orphaned processes — anthropics/claude-code #1935](https://github.com/anthropics/claude-code/issues/1935)
- [protocolVersion validation error — anthropics/claude-code #768](https://github.com/anthropics/claude-code/issues/768)
- [McpServer deprecated methods — typescript-sdk #1284](https://github.com/modelcontextprotocol/typescript-sdk/issues/1284)
- [Node.js execFile buffer limits — nodejs/node #4236](https://github.com/nodejs/node/issues/4236)
- [Godot headless import cache required — godotengine/godot #83449](https://github.com/godotengine/godot/issues/83449)
- [Godot 4 headless script execution pitfalls — godotengine/godot-proposals #8664](https://github.com/godotengine/godot-proposals/discussions/8664)
- [MCP TypeScript SDK FAQ — modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/faq.md)
- [Too many tools problem — demiliani.com](https://demiliani.com/2025/09/04/model-context-protocol-and-the-too-many-tools-problem/)
- [MCP context window token costs — deploystack.io](https://deploystack.io/blog/how-mcp-servers-use-your-context-window)
- [MCP protocol versioning — hexdocs.pm/hermes_mcp](https://hexdocs.pm/hermes_mcp/0.7.0/protocol_upgrade_2025_03_26.html)

---
*Pitfalls research for: MCP server for Godot Engine (TypeScript/Node.js)*
*Researched: 2026-03-03*
