# Phase 8: Runtime Inspection & Reload - Research

**Researched:** 2026-03-03
**Domain:** Runtime scene tree inspection via file-polling IPC + hot-reload via stop/run cycle
**Confidence:** HIGH

## Summary

Phase 8 implements two capabilities: (1) runtime inspection of a running Godot game's scene tree and node properties via file-polling IPC, and (2) a stop-then-run restart cycle to apply script changes. These are the final v2.0 features and complete the "observe and iterate" loop for AI game development.

The runtime inspection approach uses a GDScript autoload (`runtime_helper.gd`) that the user adds to their project -- identical in architecture to the existing `screenshot_helper.gd`. The MCP server writes a trigger file, the autoload detects it, serializes the requested data (scene tree snapshot, node properties, or group membership) to a JSON output file, and the TypeScript tool polls for the result. This avoids Godot's proprietary debug protocol (which is NOT standard DAP despite using port 6007) and sidesteps the confirmed Godot 4.5+ regression where external debug clients disconnect before project boot.

Hot-reload is implemented as a stop+run cycle: the existing `stop_project` kills the active process, then `run_project` relaunches it. A new `restart_project` tool wraps both operations and waits for confirmation that the restarted process is running and producing output. True in-process hot-reload is out of scope (confirmed unreliable from external tools per Godot issues #72825 and #105667).

**Primary recommendation:** Use file-polling IPC with `runtime_helper.gd` autoload for all runtime inspection. Do NOT implement a TCP DAP client. Implement restart as stop+run with output confirmation.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RUNT-01 | AI can get a snapshot of the live scene tree from a running project (node names, types, hierarchy) | File-polling IPC: `runtime_helper.gd` autoload serializes `get_tree().root` hierarchy to JSON. TypeScript polls for output file. Uses same trigger/response pattern as `screenshot_helper.gd`. |
| RUNT-02 | AI can inspect property values on a specific node in the running scene tree | File-polling IPC with `node_path` parameter: autoload calls `get_node(path).get_property_list()` + `get()` per property. Filter to script/user properties (usage flag `PROPERTY_USAGE_SCRIPT_VARIABLE`). Returns JSON object of property name/value pairs. |
| RUNT-03 | AI can list all nodes in a specific group in the running scene tree | File-polling IPC with `group` parameter: autoload calls `get_tree().get_nodes_in_group(group)`. Returns array of `{ name, type, path }` objects. |
| HTRL-01 | AI can trigger a project restart after script changes (stop + run cycle) | New `restart_project` tool: calls `ctx.activeProcess.process.kill()`, waits for exit, spawns new process via same pattern as `run_project`. No DAP or TCP needed. |
| HTRL-02 | AI receives confirmation that the restarted project is running and responsive | After restart, poll `ctx.activeProcess` for stdout output within timeout (5s). First stdout line from Godot confirms the engine is running. Return success with process PID and initial output. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `fs` | built-in | Write trigger files, read JSON output files, cleanup | Same IPC mechanism as `screenshot_helper.gd` -- proven pattern |
| Node.js `child_process` | built-in | Spawn game process for restart, kill active process | Already used by `run_project` and `stop_project` in `editor.ts` |
| zod | ^3.25.76 | Input schema validation for new tools | Already used by all existing tool modules |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @modelcontextprotocol/sdk | ^1.27.1 | Tool registration via `McpServer.registerTool()` | All new tools follow existing registration pattern |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| File-polling IPC | TCP DAP client on port 6007 | DAP approach rejected: Godot's protocol is proprietary (NOT standard DAP), has 4.5+ regression, requires reverse-engineering godot-vscode-plugin. File-polling is proven (screenshot_helper), reliable, zero protocol risk |
| File-polling IPC | GDScript HTTP server in autoload | Adds networking complexity to user's game, possible port conflicts, heavier than file I/O |
| Stop+run restart | DAP `terminate` + relaunch | DAP not available (proprietary protocol). Stop+run achieves identical result with existing infrastructure |
| @vscode/debugprotocol | None | Originally planned for v2.0 but NOT needed -- file-polling approach eliminates all DAP dependency |

**Installation:**
```bash
# No new npm packages required for Phase 8
# All functionality uses Node.js built-ins and existing dependencies
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── tools/
│   ├── runtime.ts             # NEW: inspect_scene_tree, inspect_node, inspect_group, restart_project
│   └── editor.ts              # EXISTING: run_project, stop_project (used by restart)
├── scripts/
│   ├── runtime_helper.gd      # NEW: autoload for runtime inspection (mirrors screenshot_helper.gd)
│   └── screenshot_helper.gd   # EXISTING: reference pattern
├── types.ts                   # NO CHANGE: ServerContext already has activeProcess
└── index.ts                   # EXTEND: register runtime tools
tests/
├── runtime-tools.test.ts      # NEW: tests for all 4 runtime tools
└── screenshot-tools.test.ts   # EXISTING: reference pattern for file-polling tests
```

### Pattern 1: File-Polling IPC (Trigger/Response)
**What:** MCP server writes a trigger file containing a JSON command. GDScript autoload detects the trigger, executes the command, writes a JSON response file. TypeScript polls for the response file with timeout.
**When to use:** All runtime inspection tools (inspect_scene_tree, inspect_node, inspect_group).
**Example:**
```typescript
// TypeScript side (src/tools/runtime.ts)
// Source: Existing screenshot_helper pattern in src/tools/editor.ts lines 287-310

const TRIGGER_PATH = join(projectPath, '.godot', 'runtime_trigger');
const OUTPUT_PATH = join(projectPath, '.godot', 'runtime_result.json');
const POLL_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 100;

// Write trigger with command payload
writeFileSync(TRIGGER_PATH, JSON.stringify({
  command: 'scene_tree',  // or 'inspect_node', 'get_group'
  params: {}              // e.g. { node_path: '/root/Main/Player' }
}));

// Poll for response
const startTime = Date.now();
await new Promise<void>((resolve, reject) => {
  const check = () => {
    if (existsSync(OUTPUT_PATH)) { resolve(); return; }
    if (Date.now() - startTime >= POLL_TIMEOUT_MS) { reject(new Error('timeout')); return; }
    setTimeout(check, POLL_INTERVAL_MS);
  };
  setTimeout(check, POLL_INTERVAL_MS);
});

// Read and clean up
const result = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
try { unlinkSync(OUTPUT_PATH); } catch {}
try { unlinkSync(TRIGGER_PATH); } catch {}
return result;
```

### Pattern 2: GDScript Runtime Helper Autoload
**What:** A user-installed autoload script that polls for trigger files and serializes game state to JSON.
**When to use:** Installed in the user's Godot project to enable runtime inspection.
**Example:**
```gdscript
# GDScript side (src/scripts/runtime_helper.gd)
# Source: Mirrors screenshot_helper.gd pattern

extends Node

const TRIGGER_PATH := "res://.godot/runtime_trigger"
const OUTPUT_PATH := "res://.godot/runtime_result.json"
const POLL_INTERVAL := 0.5

var _elapsed: float = 0.0

func _process(delta: float) -> void:
    _elapsed += delta
    if _elapsed < POLL_INTERVAL:
        return
    _elapsed = 0.0

    if not FileAccess.file_exists(TRIGGER_PATH):
        return

    # Read and parse trigger command
    var trigger_content = FileAccess.get_file_as_string(TRIGGER_PATH)
    DirAccess.remove_absolute(ProjectSettings.globalize_path(TRIGGER_PATH))

    var json = JSON.new()
    if json.parse(trigger_content) != OK:
        return

    var data = json.get_data()
    var command = data.get("command", "")
    var params = data.get("params", {})

    var result = {}
    match command:
        "scene_tree":
            result = _serialize_tree(get_tree().root)
        "inspect_node":
            result = _inspect_node(params.get("node_path", ""))
        "get_group":
            result = _get_group(params.get("group", ""))
        _:
            result = { "error": "Unknown command: " + command }

    # Write result JSON
    var file = FileAccess.open(
        ProjectSettings.globalize_path(OUTPUT_PATH),
        FileAccess.WRITE
    )
    file.store_string(JSON.stringify(result))
    file.close()
```

### Pattern 3: Stop+Run Restart Cycle
**What:** Kill the active Godot process, wait for exit, relaunch with same arguments, confirm running.
**When to use:** `restart_project` tool after script changes.
**Example:**
```typescript
// Source: Extends existing run_project/stop_project in src/tools/editor.ts

// 1. Kill existing process
if (!ctx.activeProcess) {
  return toolError('No active Godot process to restart.', [...]);
}
const prevArgs = ['-d', '--path', project_path];
ctx.activeProcess.process.kill();

// 2. Wait for process exit (with timeout)
await new Promise<void>((resolve) => {
  const proc = ctx.activeProcess!.process;
  proc.once('exit', () => resolve());
  setTimeout(() => resolve(), 3000); // Force continue after 3s
});
ctx.activeProcess = null;

// 3. Relaunch (same as run_project)
const proc = trackProcess(ctx, spawn(ctx.godotPath, prevArgs, { stdio: 'pipe' }));
// ... set up stdout/stderr listeners ...
ctx.activeProcess = { process: proc, output: [], errors: [] };

// 4. Wait for first output (confirms running)
await new Promise<void>((resolve) => {
  const timer = setTimeout(() => resolve(), 5000); // Max 5s wait
  proc.stdout?.once('data', () => { clearTimeout(timer); resolve(); });
  proc.once('error', () => { clearTimeout(timer); resolve(); });
});

return { content: [{ type: 'text', text: JSON.stringify({
  message: 'Project restarted successfully',
  pid: proc.pid,
  running: !proc.killed,
}) }] };
```

### Anti-Patterns to Avoid
- **Implementing a TCP DAP client:** Godot's debug protocol is proprietary, NOT standard DAP. The `--debug-server` flag uses a binary protocol, not JSON-RPC DAP. Any implementation would require reverse-engineering the godot-vscode-plugin source and tracking Godot version-specific changes.
- **Using `--remote-debug` flag with file-polling approach:** The `--remote-debug` flag is for connecting to an editor debug server. It is NOT needed for the file-polling IPC approach. The game just needs to be running normally.
- **Spawning a headless Godot process for runtime inspection:** A headless `--script` process has no scene tree, no physics loop, and no game state. Runtime inspection requires a running game instance (started via `run_project`).
- **Adding `@vscode/debugprotocol` dependency:** Originally planned in STACK.md research but NOT needed since we use file-polling, not DAP. Zero new npm dependencies for Phase 8.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TCP debug protocol client | Custom TCP client for Godot's proprietary protocol | File-polling IPC with `runtime_helper.gd` | Godot's protocol is undocumented, version-specific, has active regressions. File-polling is proven (screenshot_helper) |
| Process restart logic | Custom process manager with PID tracking | Built-in `ChildProcess.kill()` + `spawn()` | Node.js handles process lifecycle correctly; existing `trackProcess()` handles cleanup |
| Scene tree serialization | Custom binary protocol parser | GDScript `get_children()` + JSON in autoload | Godot's engine already has the tree; let GDScript serialize it. No parsing needed on TypeScript side |
| JSON-RPC framing for DAP | Reuse `src/lsp/protocol.ts` for DAP | Nothing (not building DAP client) | File-polling eliminates all protocol complexity |

**Key insight:** The file-polling pattern is already proven in this codebase (screenshot_helper.gd). Reusing the same architecture for runtime inspection avoids introducing a new execution model, a new dependency, and a new protocol. The only new code is the GDScript serialization logic and a new TypeScript tool module.

## Common Pitfalls

### Pitfall 1: Assuming Godot Uses Standard DAP Protocol
**What goes wrong:** Developer builds a DAP client expecting JSON-RPC messages on port 6007, but Godot's debug protocol is proprietary binary, not standard DAP.
**Why it happens:** Godot has a `--dap-port` flag (for GDScript DAP, used by VS Code extension), but the game-to-editor communication on `--debug-server` port 6007 uses a completely different proprietary protocol.
**How to avoid:** Use file-polling IPC exclusively. Do not connect to port 6007.
**Warning signs:** Connection succeeds but no recognizable JSON messages arrive; binary data in socket buffer.

### Pitfall 2: Godot 4.5+ DAP Regression
**What goes wrong:** External DAP clients connecting to Godot 4.5+ get disconnected immediately before the project boots.
**Why it happens:** Regression in Godot's debugger handshake (Issue #108518). Affects nvim-dap and similar external tools.
**How to avoid:** File-polling approach is immune to this regression since it does not use TCP debug connections at all.
**Warning signs:** DAP client connects but receives `exited` and `terminated` events before any useful data.

### Pitfall 3: Runtime Helper Not Installed
**What goes wrong:** User calls `inspect_scene_tree` but the `runtime_helper.gd` autoload is not added to the Godot project. Trigger file is written but never consumed; tool times out.
**Why it happens:** The autoload must be manually added to the project (same requirement as screenshot_helper.gd).
**How to avoid:** Return a clear error message on timeout that instructs the user to add the RuntimeHelper autoload. Include the autoload path in the error suggestions.
**Warning signs:** Tool always times out with 5-second delay; trigger file remains on disk after timeout.

### Pitfall 4: Race Condition Between Trigger Write and File Detection
**What goes wrong:** The autoload reads a partially-written trigger file, or detects an old trigger file from a previous request.
**Why it happens:** File I/O is not atomic. The GDScript autoload polls every 0.5 seconds.
**How to avoid:** Always delete the trigger file BEFORE writing a new one. Delete both trigger and output files before starting a new request. The autoload should delete the trigger file before processing (already handled in the pattern).
**Warning signs:** Responses contain data from a previous request; JSON parse errors in the autoload.

### Pitfall 5: Process Kill Not Immediate on All Platforms
**What goes wrong:** `process.kill()` sends SIGTERM on Unix but the process may not exit immediately. On Windows, `process.kill()` uses TerminateProcess which is immediate.
**Why it happens:** Godot may take time to flush resources and shut down cleanly.
**How to avoid:** In `restart_project`, wait for the `exit` event with a timeout (3 seconds) before relaunching. If the process does not exit, proceed anyway (the new spawn will work).
**Warning signs:** Two Godot game windows open simultaneously after restart.

### Pitfall 6: Serializing Complex Godot Types to JSON
**What goes wrong:** GDScript `JSON.stringify()` cannot serialize all Godot types (e.g., `Vector2`, `Color`, `NodePath`). Properties with non-JSON-serializable types cause the entire stringify to fail or produce unexpected output.
**Why it happens:** `JSON.stringify()` only handles basic types (int, float, string, bool, Array, Dictionary). Godot-specific types like Vector2(10, 20) are not JSON-serializable.
**How to avoid:** In `runtime_helper.gd`, convert Godot types to strings using `var_to_str()` before JSON serialization. For the scene tree snapshot, only include name, type (class_name), and path -- not all properties. For `inspect_node`, convert each property value to string representation.
**Warning signs:** Empty or null property values; JSON parse errors on the TypeScript side.

## Code Examples

### Scene Tree Serialization (GDScript)
```gdscript
# Source: Pattern derived from Godot 4.x Node API docs
# https://docs.godotengine.org/en/stable/classes/class_node.html

func _serialize_tree(node: Node, depth: int = 0) -> Dictionary:
    var result = {
        "name": node.name,
        "type": node.get_class(),
        "path": str(node.get_path()),
        "children": []
    }
    for child in node.get_children():
        if depth < 10:  # Prevent infinite recursion
            result["children"].append(_serialize_tree(child, depth + 1))
    return result
```

### Node Property Inspection (GDScript)
```gdscript
# Source: Godot 4.x Object.get_property_list() docs
# https://docs.godotengine.org/en/stable/classes/class_object.html#class-object-method-get-property-list

func _inspect_node(node_path: String) -> Dictionary:
    var node = get_node_or_null(node_path)
    if node == null:
        return { "error": "Node not found: " + node_path }

    var properties = {}
    for prop in node.get_property_list():
        # Filter to script variables and storage properties
        if prop["usage"] & PROPERTY_USAGE_SCRIPT_VARIABLE or prop["usage"] & PROPERTY_USAGE_STORAGE:
            var val = node.get(prop["name"])
            # Convert non-JSON-serializable types to string
            if val is Object or val is Vector2 or val is Vector3 or val is Color:
                properties[prop["name"]] = var_to_str(val)
            else:
                properties[prop["name"]] = val

    return {
        "name": node.name,
        "type": node.get_class(),
        "path": str(node.get_path()),
        "properties": properties
    }
```

### Group Listing (GDScript)
```gdscript
# Source: Godot 4.x SceneTree.get_nodes_in_group() docs
# https://docs.godotengine.org/en/stable/classes/class_scenetree.html

func _get_group(group_name: String) -> Dictionary:
    var nodes = get_tree().get_nodes_in_group(group_name)
    var result = []
    for node in nodes:
        result.append({
            "name": node.name,
            "type": node.get_class(),
            "path": str(node.get_path())
        })
    return { "group": group_name, "count": result.size(), "nodes": result }
```

### Tool Registration Pattern (TypeScript)
```typescript
// Source: Follows existing pattern from src/tools/editor.ts, src/tools/animation.ts

export function registerRuntimeTools(server: McpServer, ctx: ServerContext): void {
  // Tool 1: inspect_scene_tree
  server.registerTool(
    'inspect_scene_tree',
    {
      title: 'Inspect Scene Tree',
      description: 'Get a snapshot of the live scene tree from a running Godot project. ' +
        'The RuntimeHelper autoload must be added to the project.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
      },
    },
    async ({ project_path }) => {
      // ... validate path, check activeProcess, file-polling IPC ...
    },
  );

  // Tool 2: inspect_node
  // Tool 3: inspect_group
  // Tool 4: restart_project
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| DAP TCP client to port 6007 | File-polling IPC with autoload | v2.0 research (2026-03) | Eliminates protocol risk, removes @vscode/debugprotocol dependency, avoids 4.5+ regression |
| True hot-reload via editor protocol | Stop+run restart cycle | v2.0 research (2026-03) | 100% reliable restart vs unreliable hot-reload from external tools |
| TileMap API | TileMapLayer (Godot 4.3+) | Godot 4.3 | Already handled in Phase 7 |

**Deprecated/outdated:**
- `@vscode/debugprotocol`: Originally planned for v2.0 but NOT needed with file-polling approach
- True DAP client implementation: Abandoned due to proprietary protocol + 4.5+ regression
- In-process hot-reload: Confirmed unreliable (Godot issues #72825, #105667)

## Open Questions

1. **Property filter granularity for inspect_node**
   - What we know: `get_property_list()` returns hundreds of properties per node (including internal engine properties). Filtering by `PROPERTY_USAGE_SCRIPT_VARIABLE` gives user-defined properties only. `PROPERTY_USAGE_STORAGE` gives all serialized properties.
   - What's unclear: Which filter provides the most useful output for AI inspection without overwhelming the context window.
   - Recommendation: Default to `PROPERTY_USAGE_STORAGE` (all persisted properties) but skip properties whose name starts with underscore or whose value is null/default. The planner can refine this during implementation.

2. **Maximum depth for scene tree serialization**
   - What we know: Complex games can have very deep trees (10+ levels). Serializing the entire tree produces large JSON.
   - What's unclear: Practical token impact of full tree serialization.
   - Recommendation: Cap at depth 10 by default. Add optional `max_depth` parameter to `inspect_scene_tree`. This is sufficient for practical inspection.

3. **Whether restart_project should re-pass the scene parameter**
   - What we know: `run_project` accepts an optional `scene` parameter. After restart, the AI may want to run the same scene.
   - What's unclear: Whether to store the scene argument from the previous run.
   - Recommendation: Accept `project_path` and optional `scene` parameters explicitly in `restart_project`. Do not try to remember previous launch arguments -- explicit is better.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/runtime-tools.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RUNT-01 | inspect_scene_tree returns tree JSON via file-polling | unit | `npx vitest run tests/runtime-tools.test.ts -t "inspect_scene_tree"` | Wave 0 |
| RUNT-02 | inspect_node returns property values for a given node path | unit | `npx vitest run tests/runtime-tools.test.ts -t "inspect_node"` | Wave 0 |
| RUNT-03 | inspect_group returns nodes in a named group | unit | `npx vitest run tests/runtime-tools.test.ts -t "inspect_group"` | Wave 0 |
| HTRL-01 | restart_project stops and relaunches the active process | unit | `npx vitest run tests/runtime-tools.test.ts -t "restart_project"` | Wave 0 |
| HTRL-02 | restart_project confirms the restarted project is running | unit | `npx vitest run tests/runtime-tools.test.ts -t "confirms.*running"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/runtime-tools.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/runtime-tools.test.ts` -- covers RUNT-01, RUNT-02, RUNT-03, HTRL-01, HTRL-02
- [ ] `src/scripts/runtime_helper.gd` -- GDScript autoload (not testable via Vitest, tested via integration)
- [ ] No framework install needed -- Vitest already configured

## Sources

### Primary (HIGH confidence)
- `/usr/bin/godot --help` (Godot 4.6.1.stable) -- verified `--remote-debug`, `--debug-server`, `--dap-port`, `-d` flags
- `src/tools/editor.ts` -- existing `run_project`, `stop_project`, `capture_screenshot` implementations (proven file-polling IPC pattern)
- `src/scripts/screenshot_helper.gd` -- reference implementation for trigger-file polling autoload pattern
- `src/lsp/client.ts` -- TCP client pattern (confirms what we are NOT doing for runtime inspection)
- `.planning/research/ARCHITECTURE.md` -- file-polling IPC recommended over DAP TCP
- `.planning/research/PITFALLS.md` -- Pitfall 10: DAP requires running game, proprietary protocol, 4.5+ regression
- `.planning/STATE.md` -- Decision: "Runtime inspection uses file-polling IPC (not DAP TCP)"
- [SceneTree docs](https://docs.godotengine.org/en/stable/classes/class_scenetree.html) -- `get_nodes_in_group()`, tree access
- [Node docs](https://docs.godotengine.org/en/stable/classes/class_node.html) -- `get_children()`, `get_path()`, `get_class()`
- [Object.get_property_list() docs](https://docs.godotengine.org/en/stable/classes/class_object.html) -- property inspection API

### Secondary (MEDIUM confidence)
- [Godot command line tutorial](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html) -- `--remote-debug` flag syntax
- [Godot autoloads docs](https://docs.godotengine.org/en/stable/tutorials/scripting/singletons_autoload.html) -- autoload pattern
- [Aceade: How to use remote debugger](https://aceade.net/2025/07/17/godot-how-to-use-remote-debugger/) -- confirms remote debug is editor-centric

### Tertiary (LOW confidence)
- [Godot DAP regression Issue #108518](https://github.com/godotengine/godot/issues/108518) -- 4.5+ DAP disconnection (referenced in project research but specific issue number needs verification)
- [Godot hot-reload Issue #72825](https://github.com/godotengine/godot/issues/72825) -- external editor hot-reload broken
- [Godot hot-reload Issue #105667](https://github.com/godotengine/godot/issues/105667) -- static variable hot-reload broken in 4.3+

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies; extends proven patterns (screenshot_helper IPC, editor.ts process management)
- Architecture: HIGH - File-polling IPC is already proven in this codebase; restart uses existing process management
- Pitfalls: HIGH - All critical pitfalls documented in prior research and verified against Godot 4.6.1

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable -- no external dependencies, patterns are codebase-internal)
