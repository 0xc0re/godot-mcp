# Architecture Research

**Domain:** MCP Server — Godot 4.x v2.0 Feature Integrations
**Researched:** 2026-03-03
**Confidence:** HIGH (live codebase + verified Godot project file inspection)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    MCP Client (Claude Code)                       │
│                   stdio JSON-RPC protocol                         │
└──────────────────────────┬───────────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────────┐
│                  src/index.ts  (< 100 lines)                      │
│            McpServer bootstrap + tool registration                 │
└──┬──────────┬──────────┬──────────┬──────────┬───────────────────┘
   │          │          │          │          │
   ▼          ▼          ▼          ▼          ▼
┌──────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────────────────┐
│scene │ │project │ │animat- │ │tilemap │ │runtime / export /  │
│.ts   │ │.ts     │ │ion.ts  │ │.ts     │ │shader (NEW modules)│
│+4 new│ │+1 new  │ │(NEW)   │ │(NEW)   │ │                    │
│tools │ │tool    │ │        │ │        │ │                    │
└──┬───┘ └───┬────┘ └───┬────┘ └───┬────┘ └──────────┬─────────┘
   │         │          │          │                  │
   └─────────┴──────────┴──────────┴──────────────────┘
                           │
         ┌─────────────────▼──────────────────────────┐
         │           Shared Infrastructure              │
         │  godot.ts  types.ts  errors.ts              │
         │  (executeOperation, execGodot, validatePath) │
         └───────────────┬────────────────┬────────────┘
                         │                │
            ┌────────────▼──────┐  ┌──────▼──────────────────────┐
            │ Parsers (reads)   │  │ GDScript bridge (writes)     │
            │ tscn-parser.ts    │  │ godot_operations.gd          │
            │ EXTEND: surface   │  │ EXTEND match block:          │
            │ connections[] and │  │ connect_signal               │
            │ instance= fields  │  │ instance_scene               │
            │ already parsed    │  │ set_node_groups              │
            │                   │  │ batch_set_properties         │
            └───────────────────┘  │ add_input_action             │
                                   │ create_animation             │
                                   │ configure_tileset            │
                                   │ create_shader_material       │
                                   └──────────────────────────────┘
                                              │
                            ┌─────────────────▼──────────────────┐
                            │  Godot headless subprocess          │
                            │  godot --headless --path <proj>     │
                            │  --script godot_operations.gd       │
                            │  <operation> <json_params>          │
                            └────────────────────────────────────┘

NEW: Runtime Inspection Path
┌──────────────────────────────┐
│  src/tools/runtime.ts        │
│  inspect_runtime_scene tool  │
└──────────┬───────────────────┘
           │  TCP on port 6007 (Godot debug server)
           ▼
┌──────────────────────────────┐
│  Running Godot game process  │
│  (launched via run_project   │
│  with --remote-debug flag)   │
└──────────────────────────────┘

NEW: Export Path
┌──────────────────────────────┐
│  src/tools/export.ts         │
│  export_project tool         │
└──────────┬───────────────────┘
           │  execGodot(..., ['--export-release', preset, output])
           ▼  (180s timeout)
┌──────────────────────────────┐
│  Godot headless export       │
│  Writes to output path       │
└──────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | v2.0 Change |
|-----------|----------------|-------------|
| `src/index.ts` | Bootstrap, register all tools | Add 3–4 new `registerXxx(server, ctx)` calls |
| `src/types.ts` | Shared `ServerContext` interface | Add `dapProcess?: ChildProcess` for runtime tool cleanup on shutdown |
| `src/godot.ts` | Process utilities, `executeOperation`, `execGodot` | No change — existing API covers all new operations |
| `src/tools/scene.ts` | Scene manipulation tools | EXTEND: add `connect_signal`, `instance_scene`, `set_node_groups`, `batch_set_properties` |
| `src/tools/project.ts` | Project settings tools | EXTEND: add `manage_input_action` |
| `src/tools/animation.ts` | NEW — AnimationPlayer/AnimationLibrary | New module following `executeOperation` pattern |
| `src/tools/tilemap.ts` | NEW — TileMap/TileSet tools | New module following `executeOperation` pattern |
| `src/tools/runtime.ts` | NEW — Runtime scene inspection | New module with TCP client (like LSP pattern) |
| `src/tools/export.ts` | NEW — Headless project export | New module using `execGodot` with export flags |
| `src/parsers/tscn-parser.ts` | Parse .tscn files | EXTEND: expose `connections[]` in `ParsedScene` (data is in files already) |
| `src/scripts/godot_operations.gd` | GDScript backend | EXTEND: add ~8 new cases to `match` block + implement functions |

## Recommended Project Structure

```
src/
├── index.ts                   # EXTEND: add 4 new registerXxx(...) calls
├── types.ts                   # EXTEND: add dapProcess? field to ServerContext
├── tools/
│   ├── scene.ts               # EXTEND: connect_signal, instance_scene,
│   │                          #         set_node_groups, batch_set_properties
│   ├── project.ts             # EXTEND: manage_input_action
│   ├── animation.ts           # NEW: create_animation_library, add_animation_track
│   ├── tilemap.ts             # NEW: configure_tileset, set_tile_cell
│   ├── runtime.ts             # NEW: inspect_runtime_scene (TCP to running game)
│   └── export.ts              # NEW: export_project (--export-release flag)
├── parsers/
│   ├── tscn-parser.ts         # EXTEND: surface connections[] in ParsedScene
│   └── tscn-types.ts          # EXTEND: add Connection type to ParsedScene
└── scripts/
    └── godot_operations.gd    # EXTEND: ~8 new GDScript operation functions
```

### Structure Rationale

- **Extending `scene.ts`:** Signal connections, scene instancing, node groups, and batch property operations all operate on `.tscn` files and follow the identical `executeOperation` → GDScript dispatch pattern as existing scene tools. Grouping them with scene tools avoids fragmentation.
- **Extending `project.ts`:** Input action management writes to the `[input]` section of `project.godot` — the same file and conceptual domain as `modify_project_setting`. It belongs in project tools.
- **New `animation.ts`:** AnimationPlayer tools operate on a distinct Godot subsystem (Animation resources, AnimationLibrary, track types) with enough complexity to warrant separation from scene manipulation.
- **New `tilemap.ts`:** TileMap/TileSet involves its own resource type hierarchy (`TileSetAtlasSource`, `TileMapLayer`) distinct from general scene nodes.
- **New `runtime.ts`:** Requires a persistent TCP connection lifecycle (mirroring the LSP client pattern) rather than the one-shot headless subprocess pattern. Keeping it separate makes the architecture difference explicit.
- **New `export.ts`:** Clean separation of the export concern (different Godot flags, much longer timeout, pre-condition checks for export presets and templates).

## Architectural Patterns

### Pattern 1: Extend GDScript Match Block (Standard Write Operations)

**What:** Add new operation name to the `match operation:` block in `godot_operations.gd`, implement the GDScript function, add a TypeScript handler in the appropriate tool module.
**When to use:** Any operation that modifies a Godot project file and requires the Godot engine to produce correct serialization. Covers: signal connections, scene instancing, node groups, batch properties, animation tracks, tileset configuration, shader material creation, input actions.
**Trade-offs:** Each subprocess invocation costs ~200ms (Godot startup + scene load + save). Always accept arrays of changes in one call to amortize this cost.

**Example — batch_set_properties TypeScript handler:**
```typescript
// In src/tools/scene.ts (new tool added to existing register function)
server.registerTool(
  'batch_set_properties',
  {
    title: 'Batch Set Properties',
    description: 'Set multiple node properties in one engine call (avoids per-property subprocess overhead)',
    inputSchema: {
      project_path: z.string().describe('Path to the Godot project directory'),
      scene_path: z.string().describe('Path to the scene file (relative to project)'),
      changes: z.array(z.object({
        node_path: z.string(),
        property_name: z.string(),
        value: z.any(),
        value_type: z.string().optional(),
      })).describe('Array of property changes to apply atomically'),
    },
  },
  async ({ project_path, scene_path, changes }) => {
    if (!validatePath(project_path) || !validatePath(scene_path)) {
      return toolError('Invalid path', ['Provide paths without ".."']);
    }
    try {
      const { stdout, stderr } = await executeOperation(
        ctx, project_path, 'batch_set_properties',
        { scenePath: scene_path, changes }
      );
      if (stderr?.includes('Failed to')) return toolError(`Failed: ${stderr}`, []);
      return { content: [{ type: 'text' as const, text: stdout }] };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return toolError(`Failed to batch set properties: ${msg}`, []);
    }
  }
);
```

**Example — connect_signal GDScript handler:**
```gdscript
# In godot_operations.gd match block:
"connect_signal":
    connect_signal_op(params)

func connect_signal_op(params):
    var scene_path = "res://" + params.scene_path
    var packed = load(scene_path) as PackedScene
    if not packed:
        log_error("Failed to load scene: " + scene_path)
        return
    var root = packed.instantiate()
    var from_node = root.get_node(NodePath(params.from_node_path))
    var to_node = root.get_node(NodePath(params.to_node_path))
    if not from_node or not to_node:
        log_error("Node path not found")
        root.free()
        return
    from_node.connect(params.signal_name, Callable(to_node, params.method_name))
    var result_packed = PackedScene.new()
    result_packed.pack(root)
    ResourceSaver.save(result_packed, scene_path)
    root.free()
    print(JSON.stringify({"success": true, "signal": params.signal_name}))
```

### Pattern 2: TypeScript-Side Fast Write (Shader Files Only)

**What:** Write `.gdshader` text files directly from TypeScript using `writeFileSync`. Only applies to the raw shader code file — the `ShaderMaterial` resource that references it still goes through GDScript.
**When to use:** Creating a new `.gdshader` file, since it is plain GLSL-like text with no Godot-specific serialization.
**Trade-offs:** Instantly fast (<1ms), but the `.tres` ShaderMaterial file that references the shader must still be created via `create_resource` in GDScript to get correct UIDs and resource format.

**Example:**
```typescript
// In src/tools/shader (or extend resource.ts)
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const shaderContent = `shader_type canvas_item;\n\nvoid fragment() {\n    COLOR = texture(TEXTURE, UV);\n}\n`;
const shaderFilePath = join(project_path, shader_path);
mkdirSync(dirname(shaderFilePath), { recursive: true });
writeFileSync(shaderFilePath, shaderContent, 'utf-8');
// Then call executeOperation('create_shader_material', { shaderPath, outputTresPath })
// to create the ShaderMaterial .tres referencing this file
```

### Pattern 3: TCP Client for Runtime Inspection

**What:** Connect to a running Godot game's debug server via TCP to request the live scene tree.
**When to use:** `inspect_runtime_scene` tool — inspecting the node tree of a game that `run_project` has started.
**Trade-offs:** Requires Godot to have been launched with `--remote-debug tcp://127.0.0.1:6007`. The protocol is Godot's proprietary debug protocol (NOT standard DAP). Mirror the `src/lsp/client.ts` lifecycle pattern: connect on first use, hold in `ctx`, disconnect on shutdown.

**Critical constraint:** Godot 4's remote debug protocol is proprietary and undocumented. The VS Code plugin's `ServerController` uses message `"scene:request_scene_tree()"` for Godot 4 runtime inspection. As an alternative implementation path: embed a `@tool` autoload in the user's project that writes scene tree JSON to a polling file (same pattern as `screenshot_helper.gd`) — more reliable and requires no protocol reverse-engineering.

**Recommended implementation path:** The file-polling alternative is lower risk. Store as `runtime_helper.gd` alongside `screenshot_helper.gd`.

**ServerContext extension needed:**
```typescript
// In src/types.ts
export interface ServerContext {
  // ... existing fields ...
  dapProcess?: ChildProcess;  // for cleanup on shutdown
}
```

**Shutdown cleanup needed:**
```typescript
// In src/index.ts shutdown handler:
if (ctx.dapProcess && !ctx.dapProcess.killed) {
  ctx.dapProcess.kill('SIGTERM');
  ctx.dapProcess = undefined;
}
```

### Pattern 4: Direct `execGodot` for Project Export

**What:** Invoke Godot with export flags instead of `--script`. No GDScript dispatch needed.
**When to use:** `export_project` tool.
**Trade-offs:** Export duration varies widely (30s–180s+). Default 30-second timeout will fail. Must extend timeout. Requires export presets configured in `export_presets.cfg` and Godot export templates installed.

**Exact command format (verified from Godot docs):**
```
# Release export:
godot --headless --path /project/dir --export-release "Web" /output/index.html

# Debug export:
godot --headless --path /project/dir --export-debug "Linux/X11" /output/game.x86_64
```

**Implementation in src/tools/export.ts:**
```typescript
// Check prerequisites before calling Godot
const presetsFile = join(project_path, 'export_presets.cfg');
if (!existsSync(presetsFile)) {
  return toolError('No export presets found', [
    'Open the Godot editor and configure export presets via Project > Export',
    'Export templates must also be installed via Editor > Manage Export Templates',
  ]);
}
// Use execGodot with extended timeout (not executeOperation — no GDScript script needed)
const { stdout, stderr } = await execGodot(
  ctx,
  ['--headless', '--path', project_path, '--export-release', preset_name, output_path],
  { timeout: 180_000 }  // 3 minutes
);
```

### Pattern 5: Hot-Reload via File Write + Process Signal

**What:** Write the modified `.gd` file to disk; Godot (if running in editor mode) detects the change and reloads.
**When to use:** `hot_reload_script` — only when the editor is open.
**Trade-offs:** Godot's "Auto Reload Scripts on External Change" is DISABLED by default in editor preferences. Hot-reload of scripts NOT open in the Godot editor's built-in script editor is unreliable in Godot 4 (confirmed by multiple open issues: #72825, #49298, #10946). When launched via `run_project` without the editor, external file changes are NOT reliably picked up.

**Recommended implementation:** Write the file to disk and recommend the user close and re-run the project, rather than promising live reload behavior that Godot does not reliably support outside the editor.

## Data Flow

### New Write Operation Flow (signals, instances, groups, animation, tilemap, shader material)

```
LLM calls tool (e.g., connect_signal)
    ↓
src/tools/scene.ts handler
    ↓ validatePath() + existsSync(project.godot) + existsSync(scene)
    ↓
executeOperation(ctx, project_path, 'connect_signal', { scenePath, fromNodePath, ... })
    ↓ camelCase→snake_case conversion + JSON.stringify
    ↓
godot --headless --path <project> --script godot_operations.gd connect_signal <json>
    ↓
GDScript: load PackedScene → instantiate → node.connect(signal, Callable) → pack → ResourceSaver.save
    ↓ Godot writes [connection signal=... from=... to=... method=...] into .tscn
    ↓
stdout JSON line → TypeScript parses first {-prefixed line → ToolResult returned to LLM
```

### Runtime Inspection Flow (file-polling approach — recommended)

```
LLM calls inspect_runtime_scene
    ↓
src/tools/runtime.ts handler
    ↓ check: ctx.activeProcess != null (project must be running)
    ↓
write trigger file: <project>/.godot/scene_tree_trigger
    ↓
runtime_helper.gd autoload (user installs) detects trigger file
    ↓ serializes get_tree().root hierarchy to JSON
    ↓ writes <project>/.godot/scene_tree.json
    ↓
TypeScript polls for scene_tree.json (5s timeout, 100ms interval)
    ↓
readFileSync, parse, delete trigger+output files → return structured JSON
```

### Export Flow

```
LLM calls export_project { project_path, preset_name, output_path }
    ↓
src/tools/export.ts handler
    ↓ validatePath checks
    ↓ existsSync(export_presets.cfg) — fail early with guidance if missing
    ↓
execGodot(ctx, ['--headless', '--path', project_path,
                 '--export-release', preset_name, output_path],
           { timeout: 180_000 })
    ↓
Godot writes exported game to output_path
    ↓
Return stdout/stderr summary to LLM
```

### Extended Parser Flow (read_scene now surfaces connections + instances)

```
LLM calls read_scene
    ↓ src/tools/scene.ts reads .tscn via readFileSync
    ↓ parseScene(content) → ParsedScene
    ↓
ParsedScene (extended) now includes:
  nodes[]         — all [node ...] entries (existing)
  connections[]   — all [connection signal=... from=... to=... method=...] entries (NEW)
  extResources[]  — all [ext_resource ...] entries (existing, already includes PackedScene refs)
```

The `connections[]` data is already in the .tscn files — the parser just needs to be extended to collect and surface it rather than ignoring those lines.

### Key Data Flows

1. **Signal connection write:** `executeOperation('connect_signal')` → GDScript `node.connect(signal, Callable)` → `ResourceSaver.save` → produces `[connection signal=... from=... to=... method=...]` in .tscn
2. **Scene instance write:** `executeOperation('instance_scene')` → GDScript `load(child.tscn)`, add as `ext_resource`, add instanced node with `instance=ExtResource(...)` → produces `[node name=... parent=... instance=ExtResource("id")]` in .tscn (no `type=` attribute)
3. **Node group write:** `executeOperation('set_node_groups')` → GDScript `node.add_to_group()`, save → produces `groups=["g1","g2"]` attribute in node header
4. **Input action write:** `executeOperation('add_input_action')` → GDScript `ProjectSettings.set("input/action_name", {...})`, `ProjectSettings.save()` → writes complex `Object(InputEventKey,...)` format correctly in `[input]` section
5. **Animation write:** `executeOperation('create_animation')` → GDScript creates `Animation` resource, calls `track_insert_key()` per keyframe, adds to `AnimationLibrary`, assigns to `AnimationPlayer` node, saves scene
6. **Export:** `execGodot(['--export-release', preset, output])` → Godot writes game bundle directly, no stdout JSON needed

## File Format Facts (Verified from Live Projects)

All formats confirmed by reading actual project files. These are authoritative — not documentation guesses.

### Signal Connection in .tscn (verified: `tests/fixtures/sample.tscn`)
```
[connection signal="body_entered" from="Player" to="." method="_on_body_entered"]
```
Appears after all `[node ...]` entries, before end of file. One line per connection.

### Instanced Subscene Node in .tscn (verified: `bfg/scenes/game_scene.tscn`)
```
[ext_resource type="PackedScene" path="res://scenes/heroes/warrior.tscn" id="2_warrior"]

[node name="Warrior" parent="Entities" instance=ExtResource("2_warrior")]
position = Vector2(480, 270)
```
Key: instanced nodes have NO `type=` attribute. They use `instance=ExtResource("id")` instead. The child scene must appear as an `ext_resource` first with `type="PackedScene"`.

### Node Groups in .tscn (verified: `bfg/scenes/game_scene.tscn`)
```
[node name="EnemySpawner" type="Node2D" parent="." groups=["enemy_spawners"]]
```
Groups are an inline attribute on the `[node ...]` header. Multiple groups: `groups=["group_a", "group_b"]`.

### Input Action in project.godot (verified: `bfg/project.godot`)
```
[input]

move_up={
"deadzone": 0.2,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":87,"physical_keycode":0,"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)
]
}
```
`keycode` uses Godot `Key` enum integers (W=87, S=83, A=65, D=68, Space=32, Shift=4194325).
This `Object(...)` format is too complex to emit reliably from TypeScript — must use GDScript `ProjectSettings.set()` API.

### Shader File (.gdshader) — plain text
```glsl
shader_type canvas_item;

void fragment() {
    COLOR = texture(TEXTURE, UV);
}
```
Not a Godot resource format — plain text. Can be created with TypeScript `writeFileSync`. The companion `ShaderMaterial` .tres resource must be created via GDScript to produce correct UIDs.

### Animation Tracks in .tscn (sub_resource format)
```
[sub_resource type="Animation" id="Animation_walk"]
length = 1.0
tracks/0/type = "value"
tracks/0/path = NodePath("Sprite2D:frame")
tracks/0/keys = {
"times": PackedFloat32Array(0, 0.5, 1.0),
"values": [0, 1, 2]
}
```
AnimationPlayer references animations via an `AnimationLibrary`. GDScript API: `animation.add_track(Animation.TYPE_VALUE)`, `animation.track_insert_key(track_idx, time, value)`.

### TileSet Resource (.tres) (verified: `bfg/resources/tiles/dark_fantasy_tileset.tres`)
```
[gd_resource type="TileSet" format=3 uid="uid://de1uw6vtixvan"]
[ext_resource type="Texture2D" path="res://sprites/tiles/dark_fantasy_iso.png" id="1_fd53q"]
[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_pii0u"]
texture = ExtResource("1_fd53q")
texture_region_size = Vector2i(64, 32)
0:0/0 = 0   # col:row/alternative = tile_data
1:0/0 = 0
```

## Integration Points

### Modules That Need Changing

| Module | Change Type | What Changes |
|--------|-------------|--------------|
| `src/index.ts` | EXTEND | Add calls: `registerAnimationTools`, `registerTilemapTools`, `registerRuntimeTools`, `registerExportTools` |
| `src/types.ts` | EXTEND | Add `dapProcess?: ChildProcess` field to `ServerContext` |
| `src/tools/scene.ts` | EXTEND | Add 4 new `server.registerTool()` blocks |
| `src/tools/project.ts` | EXTEND | Add 1 new `server.registerTool()` block |
| `src/parsers/tscn-parser.ts` | EXTEND | Parse `[connection ...]` lines, add to `ParsedScene.connections[]` |
| `src/parsers/tscn-types.ts` | EXTEND | Add `Connection` interface, add `connections: Connection[]` to `ParsedScene` |
| `src/scripts/godot_operations.gd` | EXTEND | Add ~8 new `match` cases + implement each GDScript function |

### New Modules

| Module | Tools It Exposes | Infrastructure Used |
|--------|-----------------|---------------------|
| `src/tools/animation.ts` | `create_animation_library`, `add_animation_track` | `executeOperation` (existing) |
| `src/tools/tilemap.ts` | `configure_tileset`, `set_tile_cell` | `executeOperation` (existing) |
| `src/tools/runtime.ts` | `inspect_runtime_scene` | file-polling IPC (like screenshot_helper) or TCP (Godot debug port 6007) |
| `src/tools/export.ts` | `export_project` | `execGodot` with `--export-release` flag, 180s timeout |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `scene.ts` ↔ `godot_operations.gd` | JSON params via CLI args | Existing pattern — add new operation names |
| `animation.ts` ↔ `godot_operations.gd` | JSON params via CLI args | Same pattern |
| `tilemap.ts` ↔ `godot_operations.gd` | JSON params via CLI args | Same pattern |
| `project.ts` ↔ `godot_operations.gd` | JSON params via CLI args | Same as `modify_project_setting` |
| `runtime.ts` ↔ running Godot game | File polling (trigger file → JSON output file) | Mirrors screenshot_helper.gd pattern — lower risk than TCP protocol |
| `export.ts` ↔ Godot binary | `execGodot` subprocess, longer timeout | No GDScript script involved |
| `tscn-parser.ts` ↔ `scene.ts` | Function return type `ParsedScene` | Add `connections[]` field to existing type |

## Build Order Considerations

Ordered by dependency depth and risk:

1. **`batch_set_properties` in scene.ts** — Zero new infrastructure. Pure extension of `modify_node_property` pattern. Accepts `changes[]` array. Highest immediate ROI — all subsequent multi-property work benefits. Build first.

2. **`connect_signal` + `instance_scene` + `set_node_groups` in scene.ts + `manage_input_action` in project.ts** — Same `executeOperation` path. Core scene composition primitives. Build together in one phase.

3. **tscn-parser.ts extension** — Surface `connections[]` in `ParsedScene`. Small isolated change with its own test coverage. Build alongside step 2 since `read_scene` should show connections to verify what was written.

4. **`export_project` in export.ts** — Uses existing `execGodot`, different flags. Simple new module, no new infrastructure. Export is a standalone capability with no shared state requirements.

5. **`animation.ts` + `tilemap.ts`** — New modules, follow established `executeOperation` pattern. Animation is more complex (track types, keyframe value encoding). Tilemap is straightforward given `TileSetAtlasSource` API. Build together.

6. **Shader management** — Write `.gdshader` with TypeScript `writeFileSync` + create `ShaderMaterial` .tres via `create_resource` (extend existing resource.ts or add to animation.ts). Two-step but both patterns are established.

7. **`runtime.ts` (scene tree inspection)** — Highest technical risk. Implement using file-polling pattern (runtime_helper.gd) rather than Godot's undocumented TCP debug protocol. Build last.

8. **`hot_reload_script`** — Unreliable without editor open (documented Godot bug). Implement as write-to-disk + guidance to restart, not a true live reload. Build last, document limitation prominently.

## Anti-Patterns

### Anti-Pattern 1: One Subprocess Call Per Property

**What people do:** Call `modify_node_property` in a loop for each property to set on a node.
**Why it's wrong:** Each subprocess invokes full Godot startup (~200ms) + scene load + scene save. 5 properties = minimum 1 second, often more. The LLM making tool calls in a loop for routine property setup is a real usage pattern.
**Do this instead:** `batch_set_properties` with a `changes[]` array. One subprocess call handles all modifications atomically — load once, set all, save once.

### Anti-Pattern 2: TypeScript-Side Godot Format Emission

**What people do:** Emit the `Object(InputEventKey,...,keycode:N,...)` input action format from TypeScript string templates.
**Why it's wrong:** The serialization format has many fields with Godot enum values, version-sensitive field ordering, and complex defaults. A single wrong field name or missing default causes silent corruption of `project.godot` that Godot may not detect until project reload.
**Do this instead:** Use GDScript `ProjectSettings.set("input/action_name", {...})` and `ProjectSettings.save()`. Godot writes its own format — guaranteed correct.

### Anti-Pattern 3: Assuming "DAP" Means Standard DAP Protocol

**What people do:** Implement runtime scene inspection using the standard Debug Adapter Protocol (DAP) JSON messages from microsoft.github.io/debug-adapter-protocol.
**Why it's wrong:** Godot 4 does NOT implement standard DAP for its game-to-debugger communication. It uses a proprietary TCP protocol. The VS Code plugin has custom binary protocol handling code for Godot 4. Attempting standard DAP messages against Godot's debug server will fail silently.
**Do this instead:** Use the file-polling pattern (runtime_helper.gd autoload writes scene tree to a trigger-monitored file) — same as `screenshot_helper.gd`. No protocol reverse-engineering required.

### Anti-Pattern 4: Using the Default 30-Second Timeout for Export

**What people do:** Call export via `executeOperation` or `execGodot` with the existing 30-second `EXEC_TIMEOUT`.
**Why it's wrong:** First-time Godot project export (especially Web/HTML5) can take 60–180 seconds on typical hardware. The subprocess times out, the partial export is unusable, and the error message ("Godot operation timed out") provides no guidance about the real issue.
**Do this instead:** Use a dedicated `export_project` invocation with `timeout: 180_000` (3 minutes). Document in the tool's `description` that export can take several minutes and requires pre-installed export templates.

### Anti-Pattern 5: Promising Hot-Reload Without Editor

**What people do:** Implement `hot_reload_script` as "write the file and the running game will pick it up automatically."
**Why it's wrong:** Godot 4's "Auto Reload Scripts on External Change" editor preference is disabled by default. When the project is running via `run_project` (not through the Godot editor), external file changes are NOT detected by the running game. Multiple confirmed open issues in the Godot repository (#72825, #49298, #10946).
**Do this instead:** Write the file to disk, return a result that says the file was updated, and recommend the user stop and restart the project. Document this limitation in the tool description.

## Scaling Considerations

The server is a local single-user tool. Scale means "what breaks as the feature set grows."

| Concern | At v1.0 (22 tools) | At v2.0 (~33 tools) |
|---------|-------------------|---------------------|
| GDScript match block | 15 cases — fine | 23 cases — still fine, no size limit |
| godot_operations.gd file size | ~800 lines | ~1200 lines — manageable, keep single file |
| Index.ts registration | 7 register calls | 11 register calls — stays under 100 lines |
| Subprocess overhead | 200ms per call | Same — batch_set_properties mitigates the impact |
| Context budget (tool count) | 22 tools at ~55k tokens | 33 tools — approaching limit; keep descriptions concise |

At 33+ tools, description quality becomes critical — Claude Code's MCP Tool Search activates when tools approach context limits. Short, precise descriptions with actionable `title` fields are the mitigation.

## Sources

- Verified: `src/scripts/godot_operations.gd` — existing match block, operation dispatch pattern, GDScript API usage
- Verified: `src/tools/scene.ts` — TypeScript handler pattern, `executeOperation` usage, `toolError` pattern
- Verified: `src/types.ts` — `ServerContext` interface structure, `lspClient`/`lspProcess` precedent for DAP fields
- Verified: `src/index.ts` — registration pattern, shutdown cleanup pattern for process tracking
- Verified: `/home/cstory/src/bfg/scenes/game_scene.tscn` — live .tscn with `instance=ExtResource(...)` and `groups=["..."]` examples
- Verified: `/home/cstory/src/godot-mcp/tests/fixtures/sample.tscn` — signal connection format `[connection signal=... from=... to=... method=...]`
- Verified: `/home/cstory/src/bfg/project.godot` — live input action format with `Object(InputEventKey,...)` serialization
- Verified: `/home/cstory/src/bfg/resources/tiles/dark_fantasy_tileset.tres` — TileSet/TileSetAtlasSource resource format
- Verified: `/home/cstory/src/bfg/resources/sprites/warrior_frames.tres` — SpriteFrames animation format
- [Godot command-line export](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html) — MEDIUM confidence (WebFetch truncated; export flag syntax confirmed via search cross-reference)
- [TSCN file format](https://docs.godotengine.org/en/stable/engine_details/file_formats/tscn.html) — format confirmed by live file inspection supersedes documentation
- [Godot debug protocol / DAP](https://deepwiki.com/godotengine/godot-vscode-plugin/4-debugging) — MEDIUM confidence; Godot 4 debug port 6007 confirmed, proprietary protocol confirmed (NOT standard DAP)
- [Hot-reload limitations](https://github.com/godotengine/godot/issues/72825) — HIGH confidence; behavior confirmed by multiple Godot issue reports (#72825, #49298, #10946)

---

*Architecture research for: Godot MCP Server v2.0 — New Feature Integration*
*Researched: 2026-03-03*
