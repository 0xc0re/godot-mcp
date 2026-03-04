# Feature Research

**Domain:** MCP server for Godot Engine game development (v2.0 enhancements)
**Researched:** 2026-03-03
**Confidence:** HIGH (Godot 4.x APIs), MEDIUM (DAP integration complexity), HIGH (existing architecture fit)

---

## Scope

This document covers the **new capabilities** for the v2.0 milestone only. The v1.0 features (27 existing tools) are already shipped and validated. Research focuses on what's needed for:
- Signal connections (connect/disconnect)
- Scene instancing (add .tscn as child)
- Batch property operations
- Node groups
- Input action management
- Animation tools (AnimationPlayer/AnimationLibrary)
- TileMap/TileSet operations
- Shader file management
- DAP runtime inspection
- Headless export
- Hot-reload GDScript

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that are non-negotiable for a "fully autonomous Godot AI" positioning.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Signal connections (connect/disconnect) | Game logic is wired via signals; no autonomous AI can build games without wiring them | MEDIUM | Godot 4: use `CONNECT_PERSIST` flag to persist in .tscn via `PackedScene.pack()`. Already readable in `read_scene`; write path needs GDScript op |
| Scene instancing (add .tscn as child) | Prefabs/scenes are the primary reuse pattern; every real game uses instancing | MEDIUM | GDScript: `load("res://child.tscn").instantiate()` then `add_child()` + `set_owner()`. .tscn format stores as `instance=ExtResource(...)` on [node] entry |
| Batch property operations | AI makes many property changes per scene; one subprocess per change is 200ms × N = unacceptably slow | MEDIUM | Pass array of `{node_path, property_name, value, value_type}` operations to a single GDScript dispatch; already within existing `executeOperation` pattern |
| Node groups | Groups are how Godot games tag enemies, collectibles, interactables; AI must read and write group membership | LOW | GDScript: `node.add_to_group("enemies")`, `node.remove_from_group("enemies")`, `node.get_groups()`. Stored in [node] header as `groups=["enemies"]` in .tscn |
| Input action management | Every game needs input bindings; project scaffolding is incomplete without them | MEDIUM | Input actions live in project.godot under `[input]` section with INI format. `InputMap.add_action()`, `action_add_event()` with `InputEventKey.new()` (keycode, not scancode). Must use `ProjectSettings.save()` to persist |

### Differentiators (Competitive Advantage)

Features that meaningfully extend beyond what competitors ship.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Animation tools (AnimationPlayer/AnimationLibrary) | Enables AI to build animated characters, cutscenes, UI transitions — core game content | HIGH | `Animation.add_track()`, `track_insert_key()`, `track_set_path()`, `set_length()`. AnimationLibrary contains named Animation resources; AnimationPlayer references libraries. Headless save via `ResourceSaver.save()`. Complex API with many track types (value, position_3d, rotation_3d, scale_3d, blend_shape, method, bezier, audio, animation) |
| TileMap/TileSet operations | 2D games (roguelikes, RPGs, platformers) are tilemap-based; AI cannot build these without tileset tools | HIGH | In Godot 4.3+, TileMap is deprecated in favor of TileMapLayer. TileSet is a Resource; TileSetAtlasSource maps texture → tile grid. `set_cell(layer, Vector2i, source_id, atlas_coords)` paints tiles. Creating TileSets headlessly requires loading textures, which is non-trivial without display |
| Shader file management (create .gdshader + ShaderMaterial) | Visual effects are essential for polished games; AI should be able to scaffold shader code | MEDIUM | `.gdshader` files are plain text (write directly via TypeScript/fs). `ShaderMaterial` is a Resource saved as .tres: load shader, `ResourceSaver.save()`. Parameter setting via `set_shader_parameter()`. Simpler than it looks — shader text file + .tres resource |
| DAP runtime inspection | AI can inspect live scene tree, variable values, and call stack without stopping the game | HIGH | Godot 4 DAP server listens on port 6007 when a project runs via editor debug. Wire protocol follows Debug Adapter Protocol spec. GoPeak (port 6006) implements `get_runtime_scene_structure`, `evaluate_runtime`. Requires game to be running with DAP server active. Complex to implement reliably |
| Export project headlessly | CI/CD and automated build workflows; enables "build for Web/Windows" via MCP | HIGH | `godot --headless --path <project> --export-release "Web" ./build/index.html`. Requires export presets configured in `export_presets.cfg` and export templates downloaded. Export templates must be installed separately. Known issues with Web ZIP in 4.3 |
| Hot-reload GDScript | AI can push script changes without restarting the running game | HIGH | Godot 4 hot-reload requires the Godot editor to be running (not headless). `Script.reload()` exists but is unstable (crashes on invalid source). Static variables do not update on hot-reload (4.3+). GoPeak uses a bridge plugin at port 7777. Without editor running, this is not achievable reliably via headless subprocess |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Free-form GDScript expression evaluation at runtime | Maximally flexible runtime control | Shell injection vector; can crash or corrupt live game state; hard to sandbox meaningfully | Expose specific parameterized operations: inspect variable by name, call named method with typed arguments |
| Full tileset painting (painting every cell for large maps) | AI builds the whole map | Token budget explosion; 100×100 tile map = 10,000 operations; MCP output cap is 25k tokens | Provide `set_tile_region()` (fill rectangle) and `set_tile_pattern()` (paste 2D array) as atomic operations |
| Arbitrary shader compilation checking at MCP level | Validate shader syntax before saving | Shader compilation requires GPU context; unavailable in headless mode | Write the .gdshader file; Godot will report GLSL errors on first load |
| Runtime hot-reload as a first-class feature without editor | Avoid game restart loop | Godot's hot-reload is editor-only and unreliable for static variables | Use `stop_project` + `run_project` cycle; it takes ~2s and is reliable |
| Animation state machine (AnimationTree) via MCP | Complete animation workflow | AnimationTree with StateMachine is deeply complex; many nested resources | Scope to AnimationPlayer only; AnimationTree is editor-configured visual work |

---

## Godot 4.6 API Reference (Implementation Notes)

### Signal Connections

**How connections persist in .tscn:**
```
[connection signal="pressed" from="Button" to="." method="_on_pressed"]
[connection signal="body_entered" from="PlayerDetection" to="." method="_on_player_detection_body_entered"]
```

**GDScript to save a connection:**
```gdscript
# CONNECT_PERSIST flag required for connection to save when PackedScene.pack() is called
source_node.signal_name.connect(target_node.method_name, CONNECT_PERSIST)
```

Optional fields: `flags=` (int bitmask), `binds=[]` (bound arguments). Most connections omit these.

**Confidence:** HIGH — verified via Godot forum + .tscn format docs.

### Scene Instancing

**How instances appear in .tscn:**
```
[ext_resource type="PackedScene" uid="uid://abc123" path="res://enemy.tscn" id="1_xyz"]
[node name="Enemy" parent="." instance=ExtResource("1_xyz")]
```

**GDScript:**
```gdscript
var packed = load("res://enemy.tscn") as PackedScene
var instance = packed.instantiate()
parent_node.add_child(instance)
instance.set_owner(scene_root)  # Required for PackedScene.pack() to include it
```

**Confidence:** HIGH — standard Godot 4 pattern, multiple sources confirm.

### Node Groups

**How groups appear in .tscn:**
```
[node name="Enemy" type="CharacterBody2D" parent="." groups=["enemies", "damageable"]]
```

**GDScript:**
```gdscript
node.add_to_group("enemies")
node.remove_from_group("enemies")
node.get_groups()     # → Array[String]
node.is_in_group("enemies")  # → bool
```

Groups persist when scene is saved. `read_scene` already returns group data from the parser — the write path needs a new GDScript op.

**Confidence:** HIGH — official Godot docs + well-documented API.

### Input Action Management

**How actions appear in project.godot:**
```ini
[input]

ui_accept={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,...,"keycode":4194310,...)]
}

move_left={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,...,"keycode":65,...)]
}
```

**GDScript (runtime, but can save via ProjectSettings):**
```gdscript
InputMap.add_action("move_left", 0.5)  # name, deadzone
var ev = InputEventKey.new()
ev.keycode = KEY_A
InputMap.action_add_event("move_left", ev)
ProjectSettings.save()  # Writes to project.godot
```

Key distinction: `InputMap` runtime API vs. `ProjectSettings` persistence. Must call `ProjectSettings.save()` to persist. `keycode` (not `scancode` — that was Godot 3).

**Confidence:** MEDIUM — verified approach via kidscancode recipe + API docs; project.godot format confirmed by community; exact serialization format may vary.

### Animation Tools

**Architecture:**
- `Animation` — Resource containing tracks + keyframes
- `AnimationLibrary` — Resource containing named Animations (dictionary)
- `AnimationPlayer` — Node that references AnimationLibraries and plays animations

**GDScript to create an animation:**
```gdscript
var anim = Animation.new()
anim.length = 1.0

# Add a property track
var track_idx = anim.add_track(Animation.TYPE_VALUE)
anim.track_set_path(track_idx, "Sprite2D:position")
anim.track_insert_key(track_idx, 0.0, Vector2(0, 0))     # time=0, value
anim.track_insert_key(track_idx, 1.0, Vector2(100, 0))   # time=1

# Save via AnimationLibrary
var library = AnimationLibrary.new()
library.add_animation("walk", anim)

# Assign to AnimationPlayer
var player = get_node("AnimationPlayer")
player.add_animation_library("", library)  # "" = default library

# Save as resource
ResourceSaver.save(library, "res://animations/walk.tres")
```

Track types: `TYPE_VALUE` (any property), `TYPE_POSITION_3D`, `TYPE_ROTATION_3D`, `TYPE_SCALE_3D`, `TYPE_BLEND_SHAPE`, `TYPE_METHOD` (call method), `TYPE_BEZIER`, `TYPE_AUDIO`, `TYPE_ANIMATION`.

**Complexity note:** The AnimationPlayer node must exist in the scene tree before library assignment in headless mode. Creating animations for nodes not yet in the scene is done by saving the AnimationLibrary as a .tres resource and then assigning it to the AnimationPlayer's `libraries` property.

**Confidence:** MEDIUM — verified from official Animation/AnimationPlayer docs; headless specifics inferred from existing patterns.

### TileMap/TileSet Operations

**Architecture (Godot 4.3+):**
- `TileSet` — Resource defining tile shapes, sources, physics/navigation layers
- `TileSetAtlasSource` — Source that maps a Texture2D to a grid of tiles
- `TileMapLayer` — Node (replaces deprecated `TileMap`) that references a TileSet and paints tiles

**GDScript to paint tiles (tile data must already exist in TileSet):**
```gdscript
var layer = get_node("TileMapLayer")
layer.set_cell(Vector2i(x, y), source_id, atlas_coords, alternative_tile)
# atlas_coords = Vector2i(column, row) within atlas texture
# alternative_tile = 0 for base tile
```

**Creating TileSet programmatically (complex):**
```gdscript
var tileset = TileSet.new()
var source = TileSetAtlasSource.new()
source.texture = load("res://tiles.png")
source.texture_region_size = Vector2i(16, 16)
source.create_tile(Vector2i(0, 0))  # Create tile at atlas position
tileset.add_source(source)
ResourceSaver.save(tileset, "res://tileset.tres")
```

**Complexity warning:** TileSet creation headlessly requires loaded textures. Loading image textures without a display server may fail or produce null textures in headless mode. Painting cells assumes the TileSet is already configured. Scope MCP operations to **paint existing tiles** (set_cell) and **create TileSet skeleton** (source + texture path reference); defer physics/navigation layer config to editor.

**Confidence:** MEDIUM — API verified from official docs + forum examples; headless texture loading is an open question.

### Shader File Management

**Two distinct operations:**

1. **Create .gdshader file** — Plain text, writeable directly via TypeScript `fs.writeFileSync`. No Godot subprocess needed.

```glsl
// Example: res://shaders/outline.gdshader
shader_type canvas_item;

uniform vec4 outline_color : source_color = vec4(1.0, 0.0, 0.0, 1.0);
uniform float outline_width = 2.0;

void fragment() {
    vec4 color = texture(TEXTURE, UV);
    COLOR = color;
}
```

2. **Create ShaderMaterial .tres** — Requires GDScript headless subprocess to load shader and save resource.

```gdscript
var shader = load("res://shaders/outline.gdshader") as Shader
var mat = ShaderMaterial.new()
mat.shader = shader
mat.set_shader_parameter("outline_color", Color(1, 0, 0, 1))
ResourceSaver.save(mat, "res://materials/outline_mat.tres")
```

**Key insight:** .gdshader file creation is the same as any file write — just TypeScript `fs.writeFileSync`. ShaderMaterial creation reuses the existing `create_resource` pattern.

**Confidence:** HIGH — shader files are plain text; ResourceSaver pattern is already established in codebase.

### DAP Runtime Inspection

**Protocol:** Godot 4 Debug Adapter Protocol (DAP) server runs on port 6007 when project is launched from editor with debug enabled.

**What's available via DAP:**
- Pause/resume execution
- Set breakpoints
- Get stack trace
- Get scopes and variables at current stack frame
- Evaluate expressions in current context
- Get scene tree snapshot (Godot-specific extension to DAP)

**GoPeak approach (port 6006, confirmed from research):**
- `get_runtime_scene_structure` — walks live scene tree
- `evaluate_runtime` — evaluates GDScript expression
- Requires game running with DAP server + editor bridge plugin

**Implementation considerations:**
- DAP requires game running via `run_project` with `--remote-debug` or editor play button
- Headless mode does NOT enable DAP — needs display server
- Connection is to a running Godot game process, not headless subprocess
- Protocol is JSON over TCP with DAP envelope format
- The existing `LspClient` TCP pattern in `src/lsp/client.ts` is directly reusable as a template

**Recommended scope:** Read-only scene tree snapshot + variable inspection at current breakpoint. Do NOT implement expression evaluation (injection risk).

**Confidence:** MEDIUM — DAP port 6007 confirmed; GoPeak existence confirms feasibility; specific Godot DAP message formats need verification via godot-vscode-plugin source.

### Headless Export

**Command:**
```bash
godot --headless --path /path/to/project --export-release "Web" ./build/index.html
```

**Prerequisites (user must have):**
1. Export presets configured in `export_presets.cfg` (created via Project > Export in editor)
2. Export templates downloaded for target platform (managed via editor > Editor > Manage Export Templates)

**Preset name examples:** "Web", "Linux/X11", "Windows Desktop", "macOS"

**Known issues:**
- Web export ZIP format was broken in Godot 4.3 (issue #97841); fixed in 4.4+
- Headless export without `.godot/` import cache requires `--import` first (or Godot reimports automatically)
- Export templates must match the Godot version exactly

**MCP tool design:** Accept `project_path`, `preset_name`, `output_path`. Validate that `export_presets.cfg` exists before attempting. Wrap `godot --headless --export-release` — no new GDScript operation needed, this is a direct CLI invocation.

**Confidence:** HIGH — official Godot 4.4 docs confirm syntax; prerequisite constraints well-documented.

### Hot-Reload GDScript

**Current Godot 4 reality (as of 4.4):**
- Hot-reload = "Synchronize Script Changes" in editor settings
- Works when: Godot editor is running, project is running in editor (F5), script file changes on disk
- Does NOT work with: external editors via VSCode without editor running, headless mode, `godot --headless`
- `Script.reload()` API exists but crashes on invalid source (issue #109677)
- Static variables do not update on hot-reload (issue #105667, Godot 4.3+)

**Feasible approach:** Trigger reload via the editor's remote debug connection. When a project runs via `run_project` (with editor), modifying the script file on disk triggers automatic reload if "Synchronize Script Changes" is enabled. MCP can write the file (already done via filesystem) and optionally send a "reload" signal via the debug port.

**Alternative (GoPeak bridge):** GoPeak uses an addon plugin (port 7777) to receive reload commands. This requires users to install an addon — adds friction.

**Recommended scope:** Document that "hot-reload" for MCP means: write the script file (already possible via any file write) + restart the project via `stop_project` + `run_project`. True in-process hot-reload without restarting requires editor running and is outside reliable MCP control.

**Confidence:** MEDIUM — Godot hot-reload limitations are well-documented in multiple issues; the "write + restart" approach is the reliable path.

---

## Feature Dependencies

```
[Signal Connections]
    └──depends on──> [read_scene] (already exists: confirms nodes/paths before connecting)
    └──depends on──> [add_node] (already exists: nodes must exist to wire signals)

[Scene Instancing]
    └──depends on──> [create_scene] (already exists: parent scene must exist)
    └──depends on──> [read_scene] (already exists: verify parent scene structure)

[Batch Property Operations]
    └──extends──> [modify_node_property] (already exists: single-property version)
    └──required by──> Animation setup (setting anim player properties efficiently)

[Node Groups]
    └──depends on──> [add_node] (already exists: node must exist to group it)
    └──enhances──> [read_scene] (groups already readable; write path is new)

[Input Action Management]
    └──depends on──> [modify_project_setting] (already exists: same project.godot file)
    └──enhances──> [read_project_settings] (already exists: input/* section readable)

[Animation Tools]
    └──depends on──> [add_node] (already exists: AnimationPlayer must exist in scene)
    └──depends on──> [create_resource] (already exists: AnimationLibrary saved as .tres)
    └──requires──> [Scene Instancing] (scenes with AnimationPlayer need to be wired)

[TileMap/TileSet Operations]
    └──depends on──> [add_node] (already exists: TileMapLayer node must exist in scene)
    └──depends on──> [create_resource] (already exists: TileSet saved as .tres)

[Shader File Management]
    └──write .gdshader──> [no dependency] (plain file write via TypeScript fs)
    └──create ShaderMaterial──> [create_resource] (already exists: same ResourceSaver pattern)

[DAP Runtime Inspection]
    └──requires──> [run_project] (already exists: game must be running)
    └──requires──> DAP server connection (new: TCP client, similar to existing LSP client)

[Headless Export]
    └──requires──> [run_project] pattern (already exists: same subprocess + path detection)
    └──no dependency on──> write operations (read-only CLI invocation)

[Hot-Reload]
    └──requires──> [run_project] (already exists: game must be running)
    └──file write──> [no new dependency] (TypeScript fs write already possible)
```

### Dependency Notes

- **Signal connections depend on read_scene being trustworthy:** The AI uses `read_scene` to confirm node paths before connecting. Already implemented.
- **Batch property is an extension of modify_node_property:** Same GDScript backend, different dispatch handler accepting an array.
- **Animation tools are the most dependency-heavy:** Require node creation (AnimationPlayer exists), resource creation (AnimationLibrary .tres), and property modification (assign library to player).
- **DAP runtime inspection mirrors LSP pattern:** The existing `LspClient` (TCP socket, message framing, async response) is directly reusable as a template for a `DapClient`.
- **Shader file management is simpler than it appears:** .gdshader is just a text file. ShaderMaterial reuses `create_resource`.

---

## MVP Definition

### Launch With (v2.0 — this milestone)

Core scene-wiring and game-logic capabilities. Ordered by dependency and value.

- [ ] **Signal connections (connect_signal, disconnect_signal)** — Cannot wire game logic without this. Direct dependency on existing `read_scene` + GDScript backend. High confidence implementation.
- [ ] **Scene instancing (instance_scene)** — Core Godot reuse pattern. `PackedScene.instantiate()` + `set_owner()`. Single new GDScript op.
- [ ] **Batch property operations (batch_modify_properties)** — Eliminates the 200ms-per-property bottleneck. Extension of existing `modify_node_property` GDScript op.
- [ ] **Node groups (add_node_to_group, remove_node_from_group)** — Tags for game logic. Low complexity. Two new GDScript ops.
- [ ] **Input action management (set_input_action, remove_input_action)** — Essential for game scaffolding. Reuses `modify_project_setting` pattern.
- [ ] **Shader file management (create_shader_file, create_shader_material)** — `.gdshader` is a TypeScript file write; ShaderMaterial reuses `create_resource`.
- [ ] **Headless export (export_project)** — CLI invocation, no new GDScript needed. High confidence.

### Add After Validation (v2.x)

Features that require working core + more research/validation.

- [ ] **Animation tools (create_animation, add_animation_track)** — High value, higher complexity. Needs careful testing of headless AnimationPlayer node lifecycle.
- [ ] **TileMap/TileSet operations (set_tileset, paint_tiles)** — Essential for 2D games but headless texture loading needs validation.
- [ ] **DAP runtime inspection (get_runtime_scene, inspect_variable)** — Read-only, high value. Needs DAP protocol implementation similar to LSP client.

### Future Consideration (v2.x+)

Features that are lower confidence or require user setup.

- [ ] **Hot-reload GDScript** — Currently means "write file + restart"; true hot-reload requires editor running. Document the stop/run cycle as the reliable pattern.
- [ ] **AnimationTree/StateMachine operations** — Highly complex visual editor work; out of scope for autonomous AI operations.
- [ ] **Full tilemap painting for large maps** — Needs `set_tile_region()` bulk operation to be usable.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Depends On |
|---------|------------|---------------------|----------|------------|
| Signal connections | HIGH | LOW | P1 | existing read_scene |
| Scene instancing | HIGH | LOW | P1 | existing patterns |
| Batch property operations | HIGH | LOW | P1 | existing modify_node_property |
| Node groups | HIGH | LOW | P1 | existing add_node |
| Input action management | HIGH | MEDIUM | P1 | existing modify_project_setting |
| Shader file management | MEDIUM | LOW | P1 | existing create_resource + TypeScript fs |
| Headless export | MEDIUM | LOW | P1 | existing run_project pattern |
| Animation tools | HIGH | HIGH | P2 | add_node + create_resource |
| TileMap/TileSet operations | HIGH | HIGH | P2 | add_node + headless texture validation |
| DAP runtime inspection | MEDIUM | HIGH | P2 | run_project + new TCP client |
| Hot-reload GDScript | LOW | HIGH | P3 | editor running (out of MCP control) |

**Priority key:**
- P1: Implement in this milestone (v2.0)
- P2: Implement after P1 is stable and validated
- P3: Evaluate after P2; likely document workaround instead

---

## Competitor Feature Analysis

| Feature | This repo (v1.0) | GoPeak (95 tools) | tugcantopaloglu (149 tools) | Our v2.0 Approach |
|---------|-----------------|-------------------|-----------------------------|-------------------|
| Signal connections | Read-only in read_scene | Yes | Yes | Write path: CONNECT_PERSIST + pack() |
| Scene instancing | No | Yes | Yes | PackedScene.instantiate() + set_owner() |
| Batch property ops | No | No | No | New: array of ops in single subprocess |
| Node groups | Read-only in read_scene | Yes | Yes | Write path: add_to_group / remove_from_group |
| Input actions | Read-only in read_project_settings | Yes | Yes | Write path: InputMap API + ProjectSettings.save() |
| Animation tools | No | Yes | Yes | AnimationLibrary + Animation + ResourceSaver |
| TileMap operations | No | Yes | Yes | set_cell() + TileSetAtlasSource |
| Shader management | No | Yes | Yes | Plain file write + ShaderMaterial .tres |
| DAP runtime inspection | No | Yes (port 6006) | No (uses runtime code exec instead) | TCP client on port 6007, read-only |
| Headless export | No | No | No | Direct CLI: --export-release |
| Hot-reload | No | Yes (addon bridge) | No | Document stop/run as reliable alternative |

---

## Sources

- [Godot 4 Signal class documentation](https://docs.godotengine.org/en/stable/classes/class_signal.html) — Signal.connect(), CONNECT_PERSIST flag
- [Saving signal connections programmatically (Godot Forum 2024)](https://forum.godotengine.org/t/saving-signal-connections-programmatically/98722) — CONNECT_PERSIST required for .tscn persistence
- [Godot 4 Using signals documentation](https://docs.godotengine.org/en/stable/getting_started/step_by_step/signals.html) — Signal connection patterns
- [PackedScene documentation](https://docs.godotengine.org/en/4.4/classes/class_packedscene.html) — instantiate(), set_owner() pattern
- [Groups documentation (Godot 4.4)](https://docs.godotengine.org/en/4.4/tutorials/scripting/groups.html) — add_to_group(), get_groups()
- [InputMap documentation (Godot 4.4)](https://docs.godotengine.org/en/4.4/classes/class_inputmap.html) — add_action(), action_add_event()
- [Adding Input Actions in code (kidscancode)](https://kidscancode.org/godot_recipes/4.x/input/custom_actions/index.html) — InputEventKey.keycode pattern
- [AnimationPlayer documentation](https://docs.godotengine.org/en/stable/classes/class_animationplayer.html) — AnimationLibrary integration
- [Animation class documentation](https://docs.godotengine.org/en/stable/classes/class_animation.html) — add_track(), track_insert_key(), track_set_path()
- [Animation Track types documentation](https://docs.godotengine.org/en/stable/tutorials/animation/animation_track_types.html) — TYPE_VALUE, TYPE_METHOD, etc.
- [Using TileSets documentation](https://docs.godotengine.org/en/stable/tutorials/2d/using_tilesets.html) — TileSetAtlasSource, TileMapLayer
- [TileSet class documentation](https://docs.godotengine.org/en/stable/classes/class_tileset.html) — add_source(), source architecture
- [Shader class documentation](https://docs.godotengine.org/en/stable/classes/class_shader.html) — .gdshader format
- [ShaderMaterial documentation](https://docs.godotengine.org/en/stable/classes/class_shadermaterial.html) — set_shader_parameter(), ResourceSaver
- [Godot 4 Command Line Tutorial (4.4)](https://docs.godotengine.org/en/4.4/tutorials/editor/command_line_tutorial.html) — --export-release flags
- [Web export CLI broken in 4.3 (GitHub issue #97841)](https://github.com/godotengine/godot/issues/97841) — known export issue
- [Hot-reload limitations in Godot 4.4 (forum)](https://forum.godotengine.org/t/does-godot-has-any-kind-of-hot-reloading-or-hot-module-refresh/74838) — current state
- [GDScript static variables hot-reload bug (GitHub #105667)](https://github.com/godotengine/godot/issues/105667) — hot-reload limitations
- [Script.reload() crash on invalid source (GitHub #109677)](https://github.com/godotengine/godot/issues/109677) — stability concern
- [GoPeak/godot-mcp (DAP on port 6006)](https://github.com/HaD0Yun/godot-mcp) — DAP implementation reference
- [DAP port 6007 in Godot 4 (GitHub issue #3563)](https://github.com/godotengine/godot/issues/3563) — DAP port confirmation
- [godot-vscode-plugin DAP debugging (DeepWiki)](https://deepwiki.com/godotengine/godot-vscode-plugin/4-debugging) — DAP protocol reference
- [TSCN file format documentation (Godot 4.4)](https://docs.godotengine.org/en/4.4/contributing/development/file_formats/tscn.html) — [connection] and [node] entry format

---

*Feature research for: Godot MCP Server v2.0 Enhancements*
*Researched: 2026-03-03*
