# Phase 5: Scene Composition - Research

**Researched:** 2026-03-03
**Domain:** Godot 4.x scene composition -- signals, scene instances, groups, batch properties
**Confidence:** HIGH

## Summary

Phase 5 adds five new MCP tools (plus one parser enhancement) that enable AI to compose complete game scenes: connecting and disconnecting signals between nodes, instancing subscenes, managing group membership, and setting multiple node properties in a single subprocess call. All operations follow the existing dual-execution pattern: new GDScript operations in `godot_operations.gd` dispatched via `executeOperation()`, with TypeScript tool handlers in a new `src/tools/composition.ts` module.

The critical technical insight is that Godot 4.x signals require the `CONNECT_PERSIST` flag (integer value 2) to serialize into the `[connection]` section of `.tscn` files when using `PackedScene.pack()`. Without this flag, connections exist only at runtime and are lost on save. For scene instancing, the child scene must be loaded via `load("res://child.tscn").instantiate()` and added with `child.owner = scene_root` so that `PackedScene.pack()` preserves the `instance=ExtResource(...)` reference rather than inlining all child nodes. Groups persist automatically through `Node.add_to_group("name", true)` when the node's owner is set correctly before `pack()`.

**Primary recommendation:** Create a new tool domain file `src/tools/composition.ts` with `registerCompositionTools()` containing 5 new tools (`connect_signal`, `disconnect_signal`, `instance_scene`, `batch_set_properties`, `manage_groups`), plus corresponding GDScript operation handlers. This keeps the existing `src/tools/scene.ts` (already 807 lines, 9 tools) from growing further.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COMP-01 | AI can connect a signal between two nodes in a scene (with CONNECT_PERSIST for .tscn serialization) | Signal connection via `source_node.signal_name.connect(Callable(target_node, method), CONNECT_PERSIST)` in GDScript, packed and saved. Connection appears in `[connection]` section of .tscn. |
| COMP-02 | AI can disconnect an existing signal connection between two nodes in a scene | Load scene, instantiate, find source node, call `source_node.disconnect(signal_name, Callable(target_node, method))`, re-pack and save. Connection removed from .tscn. |
| COMP-03 | AI can add an instance of a .tscn scene as a child node in another scene (with proper set_owner for pack) | Load child scene via `load()`, `instantiate()`, `parent.add_child(child_instance)`, `child_instance.owner = scene_root`, pack and save. Results in `instance=ExtResource(...)` in .tscn. |
| COMP-04 | AI can set multiple properties on multiple nodes in a single operation (batch, one subprocess) | New GDScript operation accepting array of `{node_path, property_name, value, value_type}` entries, all applied in one scene load/pack/save cycle. |
| COMP-05 | AI can add a node to one or more groups | `node.add_to_group("group_name", true)` with persistent=true, then pack and save. Groups appear as `groups=["name"]` in node header of .tscn. |
| COMP-06 | AI can remove a node from a group | `node.remove_from_group("group_name")`, then pack and save. Group removed from .tscn. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.27.1 | MCP server framework | Already in use, all tools register through `McpServer` |
| `zod` | ^3.25.76 | Input schema validation | Already in use, every tool parameter uses Zod schemas |
| TypeScript | 5.3.3 | Tool handler implementation | Already in use, strict mode enabled |
| GDScript (Godot 4.x) | N/A | Headless engine operations | Already in use, `godot_operations.gd` dispatch pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | ^4.0.18 | Test runner | All new test files for composition tools |
| `fs` (built-in) | N/A | File existence checks in tool handlers | Pre-validation before subprocess calls |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `composition.ts` domain | Extend existing `scene.ts` | scene.ts is already 807 lines with 9 tools; adding 5 more would make it unwieldy. Separate module is cleaner. |
| GDScript subprocess for disconnect | TypeScript tscn text manipulation | Direct text manipulation is fragile (must handle edge cases in .tscn format). GDScript approach uses Godot engine's own serializer, which is always correct. |

**Installation:**
No new dependencies needed. All required libraries are already in the project.

## Architecture Patterns

### Recommended Project Structure
```
src/
  tools/
    scene.ts              # Existing 9 scene tools (unchanged)
    composition.ts        # NEW: 5 composition tools
    ...                   # Other existing tool domains
  scripts/
    godot_operations.gd   # Add 5 new operation handlers
  parsers/
    tscn-parser.ts        # Enhancement: parse groups= attribute
    tscn-types.ts         # Enhancement: add groups field to SceneNode
  index.ts                # Add registerCompositionTools() call
```

### Pattern 1: Standard Tool Handler (same as all existing tools)
**What:** Each MCP tool follows the exact same structure: validate paths, check project.godot exists, check scene exists, build camelCase params, call `executeOperation()`, check stderr for failures, return success.
**When to use:** Every new tool in this phase.
**Example:**
```typescript
// Source: existing pattern in src/tools/scene.ts
server.registerTool(
  'connect_signal',
  {
    title: 'Connect Signal',
    description: 'Connect a signal between two nodes in a scene...',
    inputSchema: {
      project_path: z.string().describe('Path to the Godot project directory'),
      scene_path: z.string().describe('Path to scene file (relative to project)'),
      source_node_path: z.string().describe('Path to the node emitting the signal'),
      signal_name: z.string().describe('Name of the signal (e.g., "pressed")'),
      target_node_path: z.string().describe('Path to the receiving node'),
      method_name: z.string().describe('Name of the method to call'),
    },
  },
  async ({ project_path, scene_path, source_node_path, signal_name,
           target_node_path, method_name }) => {
    // ... standard validation pattern ...
    const params = {
      scenePath: scene_path,
      sourceNodePath: source_node_path,
      signalName: signal_name,
      targetNodePath: target_node_path,
      methodName: method_name,
    };
    const { stdout, stderr } = await executeOperation(
      ctx, project_path, 'connect_signal', params,
    );
    // ... standard error check and return ...
  },
);
```

### Pattern 2: GDScript Operation Handler (load/modify/pack/save cycle)
**What:** Every GDScript operation that modifies a scene follows the same cycle: load scene, instantiate, find nodes, modify, pack, save.
**When to use:** All 5 new GDScript operations.
**Example:**
```gdscript
# Source: existing pattern in godot_operations.gd (modify_node_property, remove_node)
func connect_signal(params):
    var full_scene_path = ensure_res_prefix(params.scene_path)

    # Load and instantiate
    var scene = load(full_scene_path)
    if not scene:
        log_error("Failed to load scene: " + full_scene_path)
        quit(1)
    var scene_root = scene.instantiate()

    # Find nodes (using shared helper)
    var source = find_node_by_path(scene_root, params.source_node_path)
    var target = find_node_by_path(scene_root, params.target_node_path)

    # Connect with CONNECT_PERSIST (value 2) for .tscn serialization
    source[params.signal_name].connect(
        Callable(target, params.method_name), CONNECT_PERSIST
    )

    # Pack and save
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(scene_root)
    if result != OK:
        log_error("Failed to pack scene: " + str(result))
        quit(1)
    var save_error = ResourceSaver.save(packed_scene, full_scene_path)
    if save_error != OK:
        log_error("Failed to save scene: " + str(save_error))
        quit(1)
    print(JSON.stringify({"success": true, ...}))
```

### Pattern 3: Batch Operation (COMP-04)
**What:** Accept an array of operations, apply all in a single scene load/pack/save cycle.
**When to use:** `batch_set_properties` tool.
**Example:**
```gdscript
func batch_set_properties(params):
    var full_scene_path = ensure_res_prefix(params.scene_path)
    var scene = load(full_scene_path)
    var scene_root = scene.instantiate()

    # params.operations is an array of {node_path, property_name, value, value_type}
    # Validate ALL paths first (fail-fast before any modifications)
    for op in params.operations:
        var target = find_node_by_path(scene_root, op.node_path)
        if not target:
            log_error("Node not found: " + op.node_path)
            quit(1)

    # Apply all changes
    for op in params.operations:
        var target = find_node_by_path(scene_root, op.node_path)
        var type_hint = op.value_type if op.has("value_type") else ""
        var converted = convert_json_to_godot_type(op.value, type_hint)
        target.set(op.property_name, converted)

    # Single pack and save
    var packed_scene = PackedScene.new()
    packed_scene.pack(scene_root)
    ResourceSaver.save(packed_scene, full_scene_path)
```

### Pattern 4: Scene Instancing (COMP-03)
**What:** Load a child .tscn scene, instantiate it, add as child with correct ownership so it saves as `instance=ExtResource(...)`.
**When to use:** `instance_scene` tool.
**Example:**
```gdscript
func instance_scene(params):
    var full_scene_path = ensure_res_prefix(params.scene_path)
    var child_scene_path = ensure_res_prefix(params.child_scene_path)

    var scene = load(full_scene_path)
    var scene_root = scene.instantiate()
    var parent = find_node_by_path(scene_root, params.parent_node_path)

    # Load and instantiate child scene
    var child_packed = load(child_scene_path) as PackedScene
    if not child_packed:
        log_error("Failed to load child scene: " + child_scene_path)
        quit(1)
    var child_instance = child_packed.instantiate()

    if params.has("node_name") and not params.node_name.is_empty():
        child_instance.name = params.node_name

    # Add to parent and set owner (CRITICAL for instance reference persistence)
    parent.add_child(child_instance)
    child_instance.owner = scene_root
    # Do NOT set owner on the instanced scene's own children

    var packed_scene = PackedScene.new()
    packed_scene.pack(scene_root)
    ResourceSaver.save(packed_scene, full_scene_path)
```

### Anti-Patterns to Avoid
- **Setting owner to null or wrong node:** Without `child.owner = scene_root`, the child will not be included in `PackedScene.pack()`. This is the number one cause of "my node disappeared after save."
- **Connecting signals without CONNECT_PERSIST:** The connection works at runtime but is lost when the scene is saved and reloaded. The `[connection]` section in the .tscn will be missing the entry.
- **Text-manipulating .tscn files directly for write operations:** The .tscn format is complex (multi-line values, ext_resource IDs, uid references). Direct text manipulation is fragile. Always use GDScript with Godot engine for writes.
- **Instantiating child scenes with GEN_EDIT_STATE flags in headless mode:** `GEN_EDIT_STATE_INSTANCE` and `GEN_EDIT_STATE_MAIN_INHERITED` are documented as editor-only features. In headless mode, use the default `instantiate()` with proper owner setting.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Signal connection serialization | Manual .tscn `[connection]` text insertion | `node.signal.connect(callable, CONNECT_PERSIST)` then `PackedScene.pack()` | Godot handles ext_resource IDs, node path resolution, flag serialization |
| Scene instance references | Manual `instance=ExtResource(...)` text insertion | `load().instantiate()` then `add_child()` then `set_owner()` then `pack()` | Godot auto-manages ext_resource numbering, uid references, load_steps |
| Group serialization | Manual `groups=["..."]` text insertion in node headers | `node.add_to_group("name", true)` then `pack()` | Godot handles the array syntax, sorted order, persistence flag |
| Property type conversion | Custom type parsing for each Godot type | Existing `convert_json_to_godot_type()` helper | Already handles Vector2, Vector3, Color, bool, int, float |
| Node path resolution | Custom path parsing with "/" splitting | Existing pattern: strip "root/" prefix, call `get_node()` | Handles nested paths, edge cases with root node |

**Key insight:** Every write operation MUST go through GDScript plus Godot engine to ensure correct .tscn serialization. The engine manages ext_resource IDs, sub_resource references, uid generation, and load_steps counts -- all of which are impossible to get right with text manipulation.

## Common Pitfalls

### Pitfall 1: Missing CONNECT_PERSIST Flag on Signal Connection
**What goes wrong:** Signal connects successfully at runtime but the `[connection]` section is empty in the saved .tscn file. The connection is lost on scene reload.
**Why it happens:** `CONNECT_PERSIST` (value 2) is not the default. The default flag is 0 (no persistence).
**How to avoid:** Always pass `CONNECT_PERSIST` as the flags argument: `source.signal_name.connect(Callable(target, method), CONNECT_PERSIST)`
**Warning signs:** Test verifies connection works but reading the .tscn file shows no `[connection]` entry.

### Pitfall 2: Scene Instance Saves as Inlined Nodes Instead of ExtResource Reference
**What goes wrong:** Instead of `[node name="Enemy" instance=ExtResource("2_abc")]`, the .tscn file contains all the child scene's nodes inlined.
**Why it happens:** The child instance's `owner` was not set to the parent scene's root, OR the child was instantiated incorrectly.
**How to avoid:** After `parent.add_child(child_instance)`, always do `child_instance.owner = scene_root`. Do NOT set owner on the child instance's own children -- they already have their owner from the child scene.
**Warning signs:** The saved .tscn file is much larger than expected, containing duplicate node definitions.

### Pitfall 3: Disconnect Fails Because Callable Does Not Match
**What goes wrong:** `source.disconnect(signal_name, Callable(target, method))` throws "not connected" error.
**Why it happens:** In Godot 4, Callables are compared by (object, method_name). If the target node reference is wrong (e.g., a different instance than the one connected), the disconnect fails.
**How to avoid:** Use `is_connected()` to verify the connection exists before attempting disconnect. Provide a clear error message if not found.
**Warning signs:** Error message in Godot stderr about "signal not connected."

### Pitfall 4: Groups Not Parsed Back by read_scene
**What goes wrong:** After adding a node to a group via `manage_groups` tool, calling `read_scene` does not show the group membership.
**Why it happens:** The current `tscn-parser.ts` `parseSectionHeader()` regex does not handle the `groups=["foo", "bar"]` array syntax. It uses `(\w+)=(?:"([^"]*?)"|(\S+))` which stops at the first space inside the array.
**How to avoid:** Enhance `parseSectionHeader()` to handle array-valued attributes (square bracket enclosed values). Add a `groups?: string[]` field to the `SceneNode` interface.
**Warning signs:** `read_scene` returns nodes with no groups even though the .tscn file has `groups=[...]` in the node header.

### Pitfall 5: Batch Operation Partial Failure
**What goes wrong:** In `batch_set_properties`, one operation in the middle fails (bad node path or invalid property), but earlier operations have already been applied.
**Why it happens:** All operations modify the in-memory scene tree before packing/saving. If we abort partway through, the save may contain partial changes.
**How to avoid:** Validate ALL node paths exist before applying any changes. If any path is invalid, fail fast with a descriptive error listing which path was bad, before modifying anything.
**Warning signs:** Partial property changes visible in the .tscn after a failed batch operation.

### Pitfall 6: Node Path Resolution Inconsistency
**What goes wrong:** Tool uses "root/Player" but GDScript `get_node()` expects "Player" (relative to scene_root).
**Why it happens:** The MCP tools use "root/" prefix convention to denote the scene root, but Godot's `get_node()` is relative to the calling node.
**How to avoid:** Extract a shared `find_node_by_path()` helper (from the repeated pattern in modify_node_property, remove_node, etc.) that strips "root/" prefix before calling `get_node()`. All 5 new operations should use this shared helper.
**Warning signs:** "Node not found" errors when the node clearly exists in the scene.

## Code Examples

Verified patterns from the existing codebase and Godot documentation:

### Signal Connection with Persistence (COMP-01)
```gdscript
# Source: Godot Forum verified pattern
# https://forum.godotengine.org/t/saving-signal-connections-programmatically/98722
var source = find_node_by_path(scene_root, params.source_node_path)
var target = find_node_by_path(scene_root, params.target_node_path)

# CONNECT_PERSIST = 2, ensures [connection] section in .tscn
source[params.signal_name].connect(
    Callable(target, params.method_name),
    CONNECT_PERSIST
)
```

### Signal Disconnection (COMP-02)
```gdscript
# Source: Godot 4 API pattern
var source = find_node_by_path(scene_root, params.source_node_path)
var target = find_node_by_path(scene_root, params.target_node_path)

# Verify connection exists before disconnecting
if source.is_connected(params.signal_name, Callable(target, params.method_name)):
    source.disconnect(params.signal_name, Callable(target, params.method_name))
else:
    log_error("Signal '" + params.signal_name + "' not connected from " +
              params.source_node_path + " to " + params.method_name)
    quit(1)
```

### Scene Instancing (COMP-03)
```gdscript
# Source: Godot docs and forum patterns
var child_packed = load(child_scene_path) as PackedScene
var child_instance = child_packed.instantiate()

if params.has("node_name") and not params.node_name.is_empty():
    child_instance.name = params.node_name

parent.add_child(child_instance)
# CRITICAL: set owner to scene root, not parent
child_instance.owner = scene_root

# Do NOT set owner on the instanced scene's own children
# They are internal to the instance and should not be owned by the parent scene
```

### Group Management (COMP-05, COMP-06)
```gdscript
# Source: Godot 4 Node API
var target = find_node_by_path(scene_root, params.node_path)

# Add to groups -- second param 'true' means persistent (saved with scene)
if params.has("add_groups"):
    for group_name in params.add_groups:
        target.add_to_group(group_name, true)

# Remove from groups
if params.has("remove_groups"):
    for group_name in params.remove_groups:
        if target.is_in_group(group_name):
            target.remove_from_group(group_name)
```

### Shared Node Path Resolution Helper
```gdscript
# Extract from the repeated pattern in modify_node_property, remove_node, etc.
func find_node_by_path(scene_root: Node, node_path: String) -> Node:
    if node_path == "root" or node_path == "":
        return scene_root

    var target = scene_root
    if node_path.begins_with("root/"):
        var relative_path = node_path.substr(5)  # Remove "root/" prefix
        if relative_path != "":
            target = scene_root.get_node(relative_path)
    else:
        target = scene_root.get_node(node_path)

    return target
```

### Enhanced tscn-parser for Groups
```typescript
// Enhancement to parseSectionHeader() in src/parsers/tscn-parser.ts
// Current regex: /(\w+)=(?:"([^"]*?)"|(\S+))/g
// Problem: groups=["foo", "bar"] breaks because (\S+) stops at space

// New approach: handle array attributes separately
const attrRegex = /(\w+)=(?:\[([^\]]*)\]|"([^"]*?)"|(\S+))/g;
// Group 2 captures array contents: ["foo", "bar"] -> "foo", "bar"
// Group 3 captures quoted string: "value"
// Group 4 captures unquoted value: 123
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Object.connect("signal", target, "method", [], flags)` | `source.signal_name.connect(Callable(target, "method"), CONNECT_PERSIST)` | Godot 4.0 | Signal API redesigned; uses Callables instead of string method names |
| `node.connect("signal", target, "method", [], CONNECT_PERSIST)` | `node.signal_name.connect(Callable(target, "method"), CONNECT_PERSIST)` | Godot 4.0 | Must use typed signal access and Callable wrapper |
| String-based node groups | Same API (`add_to_group`, `remove_from_group`) | Unchanged | Groups API is stable across Godot 4.x versions |

**Deprecated/outdated:**
- Godot 3.x signal syntax (`connect("signal", target, "method")`) -- replaced by Callable-based API in Godot 4.x
- `CONNECT_PERSIST` as a named constant still works in Godot 4.x (value = 2)

## Open Questions

1. **GEN_EDIT_STATE flags in headless mode for scene instancing**
   - What we know: `GEN_EDIT_STATE_INSTANCE` and `GEN_EDIT_STATE_MAIN_INHERITED` are documented as editor-only. Forum reports say they work in plugins but may not work in `--headless` mode.
   - What's unclear: Whether plain `instantiate()` plus `set_owner()` is sufficient in headless mode to produce `instance=ExtResource(...)` in the saved .tscn, or if the instance will be inlined.
   - Recommendation: Implement with plain `instantiate()` plus `set_owner()` first. If integration testing shows inlined nodes instead of instance references, try `GEN_EDIT_STATE_INSTANCE` as a fallback. The success criteria says "instance reference (not inlined nodes) visible in the saved .tscn" so this MUST be validated.

2. **Signal connection on instance nodes**
   - What we know: Connecting signals between nodes that belong to the same scene works fine with CONNECT_PERSIST.
   - What's unclear: If source or target node is inside an instanced subscene, does the connection serialize correctly?
   - Recommendation: Restrict COMP-01/COMP-02 to nodes at the current scene level (not nodes inside instanced subscenes). This matches how the Godot editor works -- you connect signals between nodes in the same scene.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/composition-tools.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COMP-01 | connect_signal tool passes correct params to executeOperation with signal details | unit | `npx vitest run tests/composition-tools.test.ts -t "connect_signal"` | No -- Wave 0 |
| COMP-02 | disconnect_signal tool passes correct params to executeOperation | unit | `npx vitest run tests/composition-tools.test.ts -t "disconnect_signal"` | No -- Wave 0 |
| COMP-03 | instance_scene tool passes child_scene_path and parent_node_path to executeOperation | unit | `npx vitest run tests/composition-tools.test.ts -t "instance_scene"` | No -- Wave 0 |
| COMP-04 | batch_set_properties tool passes operations array to executeOperation | unit | `npx vitest run tests/composition-tools.test.ts -t "batch_set_properties"` | No -- Wave 0 |
| COMP-05 | manage_groups tool passes add_groups array to executeOperation | unit | `npx vitest run tests/composition-tools.test.ts -t "manage_groups" -t "add"` | No -- Wave 0 |
| COMP-06 | manage_groups tool passes remove_groups array to executeOperation | unit | `npx vitest run tests/composition-tools.test.ts -t "manage_groups" -t "remove"` | No -- Wave 0 |
| PARSER | tscn-parser correctly parses groups=["a","b"] from node headers | unit | `npx vitest run tests/tscn-parser.test.ts -t "groups"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/composition-tools.test.ts tests/tscn-parser.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/composition-tools.test.ts` -- covers COMP-01 through COMP-06 (tool handler tests)
- [ ] Additional tests in `tests/tscn-parser.test.ts` -- covers groups parsing enhancement
- [ ] `tests/fixtures/sample-with-groups.tscn` -- fixture with groups and connections for parser tests

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/tools/scene.ts`, `src/scripts/godot_operations.gd`, `src/godot.ts` -- established patterns
- Existing codebase: `src/parsers/tscn-parser.ts`, `src/parsers/tscn-types.ts` -- parser structure
- [Godot Forum: Saving Signal Connections Programmatically](https://forum.godotengine.org/t/saving-signal-connections-programmatically/98722) -- CONNECT_PERSIST pattern verified
- [Godot Forum: Saving Instantiated Child Scene Programmatically](https://forum.godotengine.org/t/saving-instantiated-child-scene-programmatically/100712) -- scene instancing pattern

### Secondary (MEDIUM confidence)
- [Godot PR #52284: Write node groups on single line](https://github.com/godotengine/godot/pull/52284) -- groups format `groups=["a","b"]`
- [TSCN File Format Documentation](https://docs.godotengine.org/en/4.4/contributing/development/file_formats/tscn.html) -- .tscn structure reference
- [PackedScene Documentation](https://docs.godotengine.org/en/stable/classes/class_packedscene.html) -- pack() behavior, ownership requirements

### Tertiary (LOW confidence)
- GEN_EDIT_STATE behavior in headless mode -- forum reports only, needs validation during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, extends existing patterns exactly
- Architecture: HIGH -- follows established tool domain pattern, well-understood codebase
- Pitfalls: HIGH -- signal persistence and scene instancing pitfalls are well-documented in Godot community
- Scene instancing in headless mode: MEDIUM -- GEN_EDIT_STATE behavior in headless needs validation
- Parser enhancement: HIGH -- straightforward regex improvement with clear test cases

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable domain, Godot 4.x API unlikely to change)
