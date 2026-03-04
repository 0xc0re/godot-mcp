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

### Pitfall 7: Signal Connections Missing CONNECT_PERSIST Flag Are Not Saved to .tscn

**What goes wrong:**
When implementing `connect_signal` via `godot_operations.gd`, calling `node.signal_name.connect(target.method)` connects signals at runtime but the connection is never written to the `.tscn` file. The tool reports success, the scene saves, but the next time the scene is opened in Godot or re-loaded, the connection is silently gone.

**Why it happens:**
Godot 4 distinguishes between runtime connections and persisted connections. By default, programmatic signal connections are ephemeral — they exist only in the running scene tree and are not serialized when `ResourceSaver.save()` is called. The `CONNECT_PERSIST` flag (`Object.CONNECT_PERSIST`, value 2) must be passed as the third argument to `.connect()` for the connection to be written to the scene file as a `[connection signal="..." from="..." to="..." method="..."]` entry.

Without this flag, `PackedScene.pack()` and `ResourceSaver.save()` will succeed (the scene saves) but the connections array remains empty in the serialized output. The AI assistant receives a success response and has no indication of data loss.

**How to avoid:**
- Always pass `CONNECT_PERSIST` (value `2` or the constant `Object.CONNECT_PERSIST`) when connecting signals inside `godot_operations.gd` operations intended to persist to disk
- After saving, verify the `.tscn` file contains the expected `[connection ...]` sections using the TypeScript parser
- Write a test fixture that creates a signal connection, saves, re-parses the `.tscn`, and asserts the connection appears in the parsed output

**Warning signs:**
- Signal connection tool returns success but the `.tscn` file has no `[connection ...]` lines
- Signal works immediately after the tool call but is gone after reopening the scene
- `read_scene` output shows `connections: []` immediately after `connect_signal` reports success

**Phase to address:**
Signal connections phase. Must be addressed in the implementation of `connect_signal` in `godot_operations.gd`.

---

### Pitfall 8: Scene Instancing Without `GEN_EDIT_STATE_INSTANCE` Loses Override Data on Save

**What goes wrong:**
When implementing scene instancing (adding a `.tscn` as a child node), calling `load("res://child.tscn").instantiate()` without the `PackedScene.GEN_EDIT_STATE_INSTANCE` parameter creates a "dead" instance. The child scene is added to the tree and appears in the node hierarchy, but when the parent scene is packed and saved, the instance's property overrides are not serialized correctly. Re-opening the scene may produce validation errors or silently lose customizations.

**Why it happens:**
`PackedScene.instantiate()` has an optional `edit_state` parameter:
- `GEN_EDIT_STATE_DISABLED` (default) — no editor state, correct for runtime
- `GEN_EDIT_STATE_INSTANCE` — tracks which properties diverge from the subscene defaults, required for correct `.tscn` serialization of overrides

When this is omitted in a tool script context and `PackedScene.pack()` is called on the parent scene, Godot may not correctly record which properties are scene-level overrides versus subscene defaults, producing a `.tscn` that is structurally correct but semantically wrong.

Additionally, the child instance must have its `owner` set to the scene root immediately after `add_child()`, or the node will not appear in the serialized scene tree at all — it will be a runtime-only child.

**How to avoid:**
- In `godot_operations.gd`, always instantiate subscenes with: `var instance = load(scene_path).instantiate(PackedScene.GEN_EDIT_STATE_INSTANCE)`
- After `add_child(instance)`, immediately call `instance.set_owner(scene_root)` for every node in the subtree recursively (or use `scene_root.add_child(instance, true)` to auto-set owner)
- Verify the `.tscn` file after save: the instanced scene must appear as `[node ... instance=ExtResource("uid://...")]` not as a plain `[node ...]` entry

**Warning signs:**
- Instanced scene appears in scene tree during tool execution but is missing when opening the `.tscn` in Godot editor
- `.tscn` file shows the child nodes inline with full properties instead of as an `instance=ExtResource(...)` reference
- "Scene file is broken" errors when reopening a scene after instancing

**Phase to address:**
Scene instancing phase. The `add_node` function in `godot_operations.gd` currently handles property-less nodes; a new `instance_scene` operation must use the `GEN_EDIT_STATE_INSTANCE` pattern from the start.

---

### Pitfall 9: Batch Property Operations Still Spawn N Subprocesses Without Explicit Batching

**What goes wrong:**
"Batch property operations" sounds like one subprocess does multiple things. If implemented naively by calling `executeOperation()` N times in a TypeScript loop (once per property), the batch provides no performance benefit — it still spawns N Godot subprocesses at ~200ms each. An AI asking to set 10 properties on 5 nodes would wait ~10 seconds total.

**Why it happens:**
The temptation is to implement `batch_modify_properties` in TypeScript as a loop over individual `modify_node_property` calls, reusing existing GDScript. This matches the existing pattern but defeats the purpose. The performance gain only materializes if the batch operation is a single new GDScript function that accepts an array of `{node_path, property, value}` tuples and processes them all within one Godot process invocation.

**How to avoid:**
- Implement `batch_modify_properties` as a new operation in `godot_operations.gd` that accepts a JSON array of operations and processes them all in one Godot process run
- The TypeScript tool handler should accept an array of property changes and pass the whole array as a single JSON parameter to `executeOperation()` as one call
- Verify that N property changes result in exactly 1 Godot subprocess, not N subprocesses

**Warning signs:**
- Batch operation takes N × ~200ms instead of ~200ms for N properties
- Multiple Godot processes appear simultaneously in `ps aux` during a batch call
- The batch tool invocation takes longer than calling individual property tools sequentially

**Phase to address:**
Batch operations phase. Design the GDScript `batch_modify_properties` function to accept an array before writing any TypeScript glue code.

---

### Pitfall 10: DAP Runtime Inspection Requires a Running Game — Not a Headless Process

**What goes wrong:**
Implementing DAP-based runtime scene tree inspection by spawning a headless Godot process will not work. DAP debugging in Godot requires a running game instance launched with `--remote-debug` or via the editor's "Run" function. A headless `--script` process has no scene tree, no physics, and no remote debugger endpoint to connect to.

**Why it happens:**
The existing pattern for all write operations is "spawn headless Godot, run GDScript, quit." Developers naturally assume the same pattern applies to runtime inspection. The DAP protocol requires connecting to port 6007 (Godot's remote debugger port) on a running game process. That game must have been launched in debug mode. The DAP connection provides scene tree snapshots, variable inspection, and expression evaluation — none of which exist in a headless subprocess.

Additionally, Godot's DAP implementation has a known regression in 4.5 and current master (as of March 2026): the debugger disconnects immediately before the project boots when external DAP clients connect. This affects nvim-dap and similar tools. Godot 4.4.x is unaffected.

**How to avoid:**
- Implement DAP inspection as a connection to an already-running game (via `run_project` with debug mode), not a new headless invocation
- Use the existing `ctx.activeProcess` tracking to know whether a debuggable game is running
- Connect to port 6007 over TCP for the DAP session; reuse the TCP pattern from the LSP client (`src/lsp/client.ts`) as a model
- Test against Godot 4.4.x specifically — the 4.5+ DAP regression means the target Godot version for this feature should be pinned in documentation
- Treat DAP inspection as "HIGH COMPLEXITY, MEDIUM CONFIDENCE" — research the current regression status before implementation

**Warning signs:**
- DAP connection attempt to a headless process returns ECONNREFUSED immediately
- DAP client connects but receives `exited` and `terminated` events before any scene data
- Scene tree inspection returns empty results even when the game appears to be running

**Phase to address:**
DAP inspection phase. This is the highest-risk feature in the milestone. Plan for a feasibility spike before committing to the implementation approach.

---

### Pitfall 11: Headless Export Requires Pre-existing Export Presets and Imported Resources

**What goes wrong:**
Calling `godot --headless --export-release "Preset Name" output/game.exe` fails with one of two silent failure modes: (1) the export preset does not exist in `export_presets.cfg`, producing "Preset not found" with exit code 0 (no error raised to Node.js), or (2) the `.godot/imported/` directory is missing because the project has never been opened in the editor, causing all resource imports to fail silently during export.

**Why it happens:**
Export presets are defined interactively in the Godot editor and saved to `export_presets.cfg`. A project freshly cloned from git (where `.gitignore` excludes the `.godot/` directory) has neither the import cache nor the export presets unless they were explicitly committed. Additionally, platform-specific export templates must be installed separately in `~/.local/share/godot/export_templates/` (Linux) — Godot does not bundle them in the engine binary.

An MCP `export_project` tool that wraps `--export-release` will appear to succeed (Godot exits 0) even when it has silently failed to produce output, because Godot does not always exit non-zero on export failure.

**How to avoid:**
- Before attempting export, verify: (a) `export_presets.cfg` exists at the project root, (b) the requested preset name exists in that file, (c) the export templates are installed for the target platform, (d) the `.godot/imported/` directory exists and is non-empty
- Run `godot --headless --import --quit --path <project>` first if the import cache is missing — this populates `.godot/imported/` without requiring the full editor
- Parse the export output for known error strings ("No export template found", "Failed to save") since Godot's exit code is unreliable for export failures
- Document that the user must configure presets in the Godot editor before the tool can be used

**Warning signs:**
- `export_project` tool returns success but no output file is created at the expected path
- Godot stdout contains "No export template found at the expected path"
- Resource import errors during export: "Unable to open file: res://.godot/imported/..."
- Exported binary crashes on launch due to missing imported resources

**Phase to address:**
Headless export phase. The tool must include a pre-flight checklist validation before invoking export. Treat as HIGH complexity.

---

### Pitfall 12: Hot-Reload via File-Write Does Not Trigger Editor Reload Due to LSP Timestamp Collision

**What goes wrong:**
Writing a modified `.gd` file to disk and expecting Godot's built-in hot-reload to pick it up does not work reliably when the LSP is active. The file write triggers a `textDocument/didSave` LSP event, which causes Godot to reload the script via `GDScript::load_source_code` — this updates the script's `last_modified_time`. When the editor's own change detection subsequently checks the file timestamp, it matches the already-updated timestamp and concludes "no change needed," skipping the hot-reload.

**Why it happens:**
This is a documented Godot bug (issue #72825, open as of March 2026). The LSP-triggered reload races with the editor's change detection, and the LSP reload always wins the timestamp comparison, causing the editor's reload mechanism to see a false "no change" state. The net result: static variable values are stale, existing scene instances continue using old method implementations, and the "hot" part of hot-reload silently fails.

Additionally, the existing LSP client in `src/lsp/client.ts` is already connected on port 6014. Any hot-reload feature that writes `.gd` files will trigger LSP `didSave` events through the same connection, which may produce unexpected `publishDiagnostics` notifications that the current LSP client is not designed to handle concurrently.

**How to avoid:**
- Implement hot-reload by sending the LSP `workspace/didChangeWatchedFiles` notification after writing, rather than relying on Godot's file system watcher — this gives the correct reload path
- Alternatively, avoid the LSP path entirely: disconnect the LSP client, write the file, wait 500ms, then reconnect — this forces the editor's file-system poller to see the change without the LSP race
- For the running game case: hot-reload of a running game instance requires the game to be running with the `--remote-debug` flag and Godot to be in editor mode (not standalone export) — document this constraint clearly
- For GDScript files with `static var`, document that hot-reload is unreliable (known issue #105667 in Godot 4.3+)

**Warning signs:**
- Tool reports "file written" but game behavior is unchanged after hot-reload
- LSP client receives unexpected `publishDiagnostics` notifications immediately after a hot-reload write
- `static var` values remain at their initial values after editing and hot-reloading
- Hot-reload works once but silently stops working on subsequent saves

**Phase to address:**
Hot-reload phase. Research the exact Godot version status of issue #72825 before designing the approach. If the bug persists on the target Godot 4.x version, document hot-reload as "best-effort, not guaranteed."

---

### Pitfall 13: TileMap Is Deprecated in Godot 4.3+ — Tools Must Target TileMapLayer

**What goes wrong:**
Implementing TileMap/TileSet operations targeting the `TileMap` node class will produce deprecation warnings in Godot 4.3+ and will fail completely in future versions. The `TileMap` class was deprecated in 4.3 and replaced with `TileMapLayer` as the correct API going forward. A tool that calls `TileMap` methods works in Godot 4.2 but silently produces degraded behavior in 4.3.

**Why it happens:**
In Godot 4.3, the TileMap layers concept was refactored: instead of one `TileMap` node with multiple `layers` properties, each layer is now a standalone `TileMapLayer` node. The API for painting tiles changed from `TileMap.set_cell(layer_index, coords, source_id, atlas_coords)` to `TileMapLayer.set_cell(coords, source_id, atlas_coords)` (no layer index needed). The data serialization format also changed from `int32` arrays to `PackedByteArray`.

**How to avoid:**
- Target `TileMapLayer` exclusively in `godot_operations.gd` implementations
- Use `ClassDB.class_exists("TileMapLayer")` to detect Godot version capability before proceeding
- Do not use `TileMap.set_cell()` — use `TileMapLayer.set_cell()`
- Document that TileMap tools require Godot 4.3 or later
- For TileSet configuration (shared between TileMapLayer nodes), the API is on the `TileSet` resource itself and has not changed significantly

**Warning signs:**
- Godot prints "TileMap is deprecated, use TileMapLayer instead" during headless script execution
- Tile painting calls succeed (no error) but no tiles appear in the scene
- Scene file shows a `TileMap` node but the Godot editor shows a deprecation badge

**Phase to address:**
TileMap operations phase. Start with `TileMapLayer` from the beginning — do not implement with `TileMap` intending to migrate later.

---

### Pitfall 14: Input Action Management Must Use `modify_project_setting` — Not Runtime `InputMap`

**What goes wrong:**
Implementing input action management by calling `InputMap.add_action()` and `InputMap.action_add_event()` in `godot_operations.gd` modifies the runtime input map in the headless process but does not persist anything to `project.godot`. The headless process exits, the runtime InputMap is destroyed, and the user's project has no new input actions. The tool reports success.

**Why it happens:**
`InputMap` is a runtime singleton that loads actions from `project.godot`'s `[input]` section at startup and allows runtime modification. These runtime modifications are not automatically written back to `project.godot`. The `modify_project_setting` tool already handles writing to `project.godot`, but the `[input]` section has a complex nested format for input events that is not a simple string value — it requires serializing `InputEventKey`, `InputEventMouseButton`, and other event objects into Godot's serialization format.

Additionally, the known constraint that `modify_project_setting` only supports string values (from the milestone context) means it cannot currently write the nested `InputEvent` structures that the `[input]` section requires.

**How to avoid:**
- Write input actions directly to `project.godot` using direct file manipulation in `godot_operations.gd` via `ProjectSettings.set()` followed by `ProjectSettings.save()` — this correctly serializes `InputEvent` objects
- Alternatively, construct the INI-format `[input]` entries manually in GDScript and write them to `project.godot`
- Do NOT use `InputMap.add_action()` as the persistence mechanism — it is runtime-only
- Test that the written `project.godot` file loads correctly when the Godot editor opens the project

**Warning signs:**
- `add_input_action` tool returns success but the action does not appear in the Godot editor's Input Map
- `project.godot` file does not contain the expected `[input]` section changes after the tool call
- The action works if the project is run immediately (runtime InputMap has it) but disappears after restart

**Phase to address:**
Input action management phase. Research the exact `project.godot` serialization format for `InputEvent` objects before implementation.

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
| Implementing batch operations as a TypeScript loop over individual `executeOperation()` calls | Reuses existing GDScript functions immediately | Each iteration is ~200ms; 10 properties = 2 seconds; defeats the purpose of "batch" | Never — batch means one GDScript invocation for N operations |
| DAP inspection reusing headless subprocess pattern | Consistent architecture | A headless `--script` process has no scene tree or debugger endpoint; DAP requires a running game | Never — DAP requires a different execution model entirely |

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
| Signal connections via code | Calling `.connect()` without `CONNECT_PERSIST` — connection exists at runtime but never reaches the `.tscn` file | Always use `signal.connect(target, CONNECT_PERSIST)` in tool scripts that save scene files |
| Scene instancing via code | Calling `.instantiate()` without `GEN_EDIT_STATE_INSTANCE` and without `set_owner()` — instance is invisible in the serialized scene | Use `load(path).instantiate(PackedScene.GEN_EDIT_STATE_INSTANCE)` and `set_owner(root)` for all child nodes |
| Headless export | Assuming Godot exits non-zero on export failure — Godot often exits 0 even when export produces no output | Parse stdout/stderr for known error strings; verify the output file exists at the expected path |
| DAP debugging connection | Connecting to the DAP port (6007) before the game is running and in debug mode | Check `ctx.activeProcess` is running before attempting DAP connection; the game must have been launched with debug flags |
| LSP + hot-reload | Writing `.gd` files while LSP is connected causes `publishDiagnostics` notifications that the current client does not handle | Disconnect LSP before file-write hot-reload; reconnect after; or send `workspace/didChangeWatchedFiles` instead of relying on file-system detection |

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
| Headless export spawning a full import pass without `.godot/imported/` | Export "works" on developer's machine (which has the cache) | On CI or fresh clone, import pass takes 30-120 seconds before export begins | Any headless export on a machine that has never opened the project in the editor |
| AnimationPlayer track creation via headless running in `_init()` | Works for simple animations | Animation resources that reference nodes by path fail if the node tree is not instantiated in headless mode | Any animation track that uses `NodePath` targeting a node not present in the headless process |

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
| Signal target method names from untrusted input | A malformed method name in a `connect_signal` call could invoke unintended GDScript methods at runtime | Validate method names against the target node's actual method list using `has_method()` before connecting |
| Shader source code injection | A ShaderMaterial tool that accepts raw shader source could be used to execute arbitrary shader code (low risk in local dev, but worth noting) | Treat shader source as opaque data; validate that shader files live within the project root |

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
| Signal connection tool that doesn't verify source/target nodes exist | AI calls `connect_signal` with a typo in node path; tool reports success; connection is silently invalid | Check both source and target node paths exist in the scene before attempting connection |
| Hot-reload success message when reload silently failed | AI assumes its changes are live; continues building on stale state | After writing and signaling reload, wait for an LSP diagnostics response confirming the new file was processed |
| Export tool that doesn't verify the output file was created | AI reports build success; user tries to distribute a file that doesn't exist | After `--export-release` completes, verify the output path exists and has non-zero size |

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
- [ ] **Signal connection:** `connect_signal` returns success — verify the `.tscn` file contains a `[connection signal="..." ...]` section; open in Godot editor and confirm the connection appears in the Node panel
- [ ] **Scene instancing:** `instance_scene` returns success — verify the `.tscn` shows the child as `instance=ExtResource(...)` not as inlined nodes; verify owner is set correctly
- [ ] **Batch operations:** `batch_modify_properties` returns success for 10 properties — verify it invoked exactly 1 Godot subprocess (not 10) by timing the call
- [ ] **Input actions:** `add_input_action` returns success — open `project.godot` and verify the `[input]` section contains the new action; open Godot editor and confirm it appears in Project Settings > Input Map
- [ ] **Export project:** `export_project` returns success — verify the output file exists at the specified path and has non-zero file size
- [ ] **Hot-reload:** `hot_reload_script` returns success — change a visible game behavior in the script and verify the running game reflects it without restarting
- [ ] **TileMap operations:** `paint_tiles` returns success — open the scene in Godot and confirm tiles appear at the expected positions with the correct TileMapLayer node (not TileMap)
- [ ] **DAP inspection:** `inspect_scene_tree` returns data — verify the data reflects the actual running game state, not a cached or empty snapshot

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
| Signal connections not persisted | LOW | Re-implement the GDScript operation with `CONNECT_PERSIST`; the fix is a one-line change in `godot_operations.gd` |
| Scene instancing creates orphan nodes | MEDIUM | Re-implement with `GEN_EDIT_STATE_INSTANCE` and recursive `set_owner()`; may need to manually edit affected `.tscn` files |
| Batch operations implemented as a loop | MEDIUM | Refactor `godot_operations.gd` to accept an array; update the TypeScript handler; no user-visible API change needed |
| Export tool silently produces no output | MEDIUM | Add pre-flight validation for preset existence, import cache, and template installation; surface these as actionable errors |
| Hot-reload silently fails | LOW | Document as a known limitation; link to Godot issue #72825; provide restart-game as a reliable fallback |
| TileMap deprecation warnings at runtime | MEDIUM | Refactor all `TileMap` references to `TileMapLayer`; update test fixtures; bump minimum supported Godot version documentation to 4.3 |
| DAP connection fails due to Godot version regression | HIGH | Pin DAP feature to Godot 4.4.x in documentation; implement fallback to screenshot-based inspection; track upstream fix status |

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
| Signal connections missing CONNECT_PERSIST | Signal connections phase | Parse `.tscn` after connect_signal; assert `[connection ...]` entries exist |
| Scene instancing missing GEN_EDIT_STATE_INSTANCE | Scene instancing phase | Open saved `.tscn` in Godot editor; verify subscene appears as `instance=ExtResource` |
| Batch operations are still N subprocesses | Batch operations phase | Time a 10-property batch; assert it completes in <500ms (one subprocess) |
| DAP requires running game not headless | DAP inspection phase (spike first) | Attempt DAP connection with no game running; confirm correct error; attempt with game running and confirm data |
| Headless export missing presets/templates | Export phase | Test export with missing preset; assert actionable error; test with valid preset on clean project |
| Hot-reload LSP timestamp race | Hot-reload phase | Write a file, verify diagnostics are updated, verify game behavior changes |
| TileMap deprecated in 4.3+ | TileMap phase | Run TileMapLayer-based test against Godot 4.3 and 4.4; verify no deprecation warnings |
| Input actions need ProjectSettings not InputMap | Input actions phase | After `add_input_action`, open `project.godot` in text editor and verify `[input]` section contains the action |

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
- [Signal CONNECT_PERSIST required for tscn persistence — Godot Forum](https://forum.godotengine.org/t/saving-signal-connections-programmatically/98722)
- [PackedScene GEN_EDIT_STATE_INSTANCE required — godotengine/godot-docs #8801](https://github.com/godotengine/godot-docs/issues/8801)
- [Godot 4.3 TileMap deprecated, replaced by TileMapLayer — Godot 4.3 dev 6 release](https://godotengine.org/article/dev-snapshot-godot-4-3-dev-6/)
- [DAP disconnects immediately in Godot 4.5+ regression — godotengine/godot #108518](https://github.com/godotengine/godot/issues/108518)
- [Hot-reload fails with external editors via LSP timestamp race — godotengine/godot #72825](https://github.com/godotengine/godot/issues/72825)
- [Static variables not updated during hot-reload — godotengine/godot #105667](https://github.com/godotengine/godot/issues/105667)
- [Headless export fails due to missing .godot directory — godotengine/godot #72360](https://github.com/godotengine/godot/issues/72360)
- [Headless export does not import files — godotengine/godot #73782](https://github.com/godotengine/godot/issues/73782)
- [InputMap is runtime-only, not editor-persistent — Godot Forum](https://forum.godotengine.org/t/inputmap-not-available-in-editor/109161)
- [TSCN file format documentation — godotengine/godot-docs](https://github.com/godotengine/godot-docs/blob/master/engine_details/file_formats/tscn.rst)

---
*Pitfalls research for: MCP server for Godot Engine (TypeScript/Node.js)*
*Researched: 2026-03-03*
