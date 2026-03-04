# Phase 7: Animation & TileMap - Research

**Researched:** 2026-03-03
**Domain:** Godot 4.x Animation (Animation, AnimationLibrary, AnimationPlayer) and TileMap (TileSet, TileSetAtlasSource, TileMapLayer) APIs via headless GDScript
**Confidence:** HIGH

## Summary

Phase 7 adds two distinct tool domains to the MCP server: animation creation/management (ANIM-01 through ANIM-04) and tile-based level painting (TILE-01 through TILE-04). Both domains follow the established dual-execution pattern -- GDScript headless operations for writes, with results returned as JSON via stdout.

The Animation domain requires creating Animation resources with value tracks and keyframes, wrapping them in AnimationLibrary containers, and assigning libraries to AnimationPlayer nodes in scenes. Godot 4.x changed the animation architecture significantly from 3.x: animations must live inside an AnimationLibrary before they can be used by an AnimationPlayer. The key GDScript APIs are `Animation.new()`, `Animation.add_track()`, `Animation.track_set_path()`, `Animation.track_insert_key()`, `AnimationLibrary.new()`, `AnimationLibrary.add_animation()`, and `AnimationPlayer.add_animation_library()`.

The TileMap domain targets TileMapLayer exclusively (TileMap was deprecated in Godot 4.3+, per existing project decision in STATE.md). Creating a TileSet resource with a TileSetAtlasSource requires careful ordering: texture must be set before calling `create_tile()`. The `set_cell()` method uses three IDs (source_id, atlas_coords, alternative_tile). A critical concern flagged in STATE.md is whether texture loading works in headless mode -- research indicates textures DO load in headless mode (they just have zero-sized pixel data), but the TileSet resource structure only needs the texture reference path, not actual pixel data, so this is a non-issue for resource creation and saving.

**Primary recommendation:** Create two new tool domain files (`src/tools/animation.ts` and `src/tools/tilemap.ts`) following the composition/config/shader pattern, with corresponding GDScript operation handlers in `godot_operations.gd`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ANIM-01 | Create Animation resource with value tracks (property animation) | Animation.new() + add_track(TYPE_VALUE) + track_set_path() + track_insert_key() + ResourceSaver.save() |
| ANIM-02 | Create AnimationLibrary resource containing named animations | AnimationLibrary.new() + add_animation(name, anim) + ResourceSaver.save() |
| ANIM-03 | Add keyframes to existing animation track (time + value pairs) | Load existing .tres, find track by path, track_insert_key() for each keyframe, ResourceSaver.save() |
| ANIM-04 | Assign AnimationLibrary to AnimationPlayer node in a scene | Load scene, find AnimationPlayer node, load library resource, add_animation_library(name, lib), pack + save scene |
| TILE-01 | Create TileSet resource with TileSetAtlasSource (texture + tile size) | TileSet.new() + TileSetAtlasSource.new() + set texture THEN create_tile() + add_source() + ResourceSaver.save() |
| TILE-02 | Paint cells on TileMapLayer (set_cell with source_id and atlas_coords) | Load scene, find TileMapLayer, call set_cell(coords, source_id, atlas_coords, alternative_tile), pack + save |
| TILE-03 | Paint rectangular region of tiles in single operation (bulk fill) | Loop over x/y range calling set_cell() for each coordinate in the rectangle |
| TILE-04 | Clear cells on TileMapLayer | erase_cell(coords) for specific cells or clear() for all cells |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.3.3 | Tool handler implementation | Existing project language |
| Zod | 3.25.76+ | Input schema validation | Used by all existing tools |
| MCP SDK | 1.27.1+ | Tool registration (registerTool) | Existing server framework |
| GDScript (Godot 4.x) | 4.3+ | Headless operation dispatch | Existing execution pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `Animation` (Godot) | 4.x | Animation resource with tracks/keyframes | ANIM-01, ANIM-03 |
| `AnimationLibrary` (Godot) | 4.x | Named animation container | ANIM-02, ANIM-04 |
| `AnimationPlayer` (Godot) | 4.x | Scene node for playing animations | ANIM-04 |
| `TileSet` (Godot) | 4.x | Tile definitions resource | TILE-01 |
| `TileSetAtlasSource` (Godot) | 4.x | Atlas-based tile source | TILE-01 |
| `TileMapLayer` (Godot) | 4.3+ | Individual tile layer node (replaces TileMap) | TILE-02, TILE-03, TILE-04 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TileMapLayer | TileMap | TileMap is deprecated in Godot 4.3+; TileMapLayer is the replacement (locked decision in STATE.md) |
| GDScript headless ops | Direct .tres file writing | Would avoid Godot subprocess but Animation/TileSet resources have complex nested structures -- GDScript ResourceSaver ensures correct serialization |
| Separate animation + tilemap tool files | Single combined file | Two files is cleaner -- animation and tilemap are distinct Godot concepts with different API surfaces |

## Architecture Patterns

### Recommended Project Structure
```
src/tools/
├── animation.ts         # registerAnimationTools() - ANIM-01..04
├── tilemap.ts           # registerTileMapTools() - TILE-01..04
src/scripts/
└── godot_operations.gd  # Add new operation functions + match entries
tests/
├── animation-tools.test.ts
└── tilemap-tools.test.ts
```

### Pattern 1: GDScript Operation Handler (Write Path)
**What:** Each MCP tool calls `executeOperation()` which spawns Godot headless with the operation name and JSON params.
**When to use:** All animation and tilemap write operations.
**Example:**
```typescript
// TypeScript tool handler (following composition.ts pattern)
const params = {
  animationName: animation_name,
  length: length,
  loopMode: loop_mode,
  tracks: tracks,
  outputPath: output_path,
};

const { stdout, stderr } = await executeOperation(
  ctx,
  project_path,
  'create_animation',
  params,
);
```

```gdscript
# GDScript operation (in godot_operations.gd)
func create_animation(params):
    var anim = Animation.new()
    anim.length = params.get("length", 1.0)
    # ... add tracks and keyframes
    ResourceSaver.save(anim, output_path)
    print(JSON.stringify({"success": true, "path": output_path}))
```

### Pattern 2: Scene Node Modification (AnimationPlayer + TileMapLayer)
**What:** Load scene, find target node, modify it, repack and save.
**When to use:** ANIM-04 (assign library to AnimationPlayer) and TILE-02/03/04 (paint/clear tiles on TileMapLayer).
**Example:**
```gdscript
# Load and modify scene pattern (same as connect_signal, batch_set_properties)
var scene = load(full_scene_path)
var scene_root = scene.instantiate()
var target = find_node_by_path(scene_root, node_path)

# Modify the node...
target.add_animation_library(library_name, library)

# Repack and save
var packed = PackedScene.new()
scene_root.set_owner_recursive(scene_root)  # Ensure ownership
packed.pack(scene_root)
ResourceSaver.save(packed, full_scene_path)
```

### Pattern 3: Resource Creation and Saving
**What:** Create a new Godot Resource, configure it, save with ResourceSaver.
**When to use:** ANIM-01, ANIM-02, TILE-01.
**Example:**
```gdscript
# Same pattern as create_shader_material
var output_path = ensure_res_prefix(params.get("output_path", ""))

# Create resource
var library = AnimationLibrary.new()
# ... configure ...

# Ensure directory exists (standard pattern from create_shader_material)
var dir_path = output_path.get_base_dir()
if not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(dir_path)):
    var dir = DirAccess.open("res://")
    if dir:
        var relative_dir = dir_path.substr(6)
        if not relative_dir.is_empty():
            dir.make_dir_recursive(relative_dir)

var error = ResourceSaver.save(library, output_path)
```

### Anti-Patterns to Avoid
- **Using deprecated TileMap class:** Always use TileMapLayer (Godot 4.3+ replacement). The TileMap class is deprecated.
- **Creating tiles before setting texture on TileSetAtlasSource:** Must call `set_texture()` BEFORE `create_tile()` -- Godot will emit `!room_for_tile` errors otherwise.
- **Using Animation.TYPE_ANIMATION for property tracks:** Use `Animation.TYPE_VALUE` for animating node properties. TYPE_ANIMATION is for referencing other animations.
- **Skipping AnimationLibrary:** In Godot 4.x, animations MUST be in an AnimationLibrary before they can be assigned to AnimationPlayer. Cannot add animations directly.
- **Not setting node ownership before packing:** When modifying scenes, all child nodes must have their `owner` set to the scene root for `PackedScene.pack()` to include them.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Animation resource serialization | Custom .tres writer | `ResourceSaver.save()` via GDScript | Animation tracks have complex binary-compatible format |
| TileSet resource serialization | Custom .tres writer | `ResourceSaver.save()` via GDScript | TileSet has nested sub-resources (atlas sources, tile data) |
| Scene modification with node lookup | Direct .tscn text manipulation | `load()` + `instantiate()` + `find_node_by_path()` + `pack()` | Existing pattern handles ownership, resources, signals correctly |
| Value type conversion | Per-tool type handling | `convert_json_to_godot_type()` helper | Already handles Vector2, Vector3, Color, bool, int, float |
| Directory creation before save | Inline directory logic | Copy directory-creation block from `create_shader_material` | Same 5-line pattern used in create_resource and create_shader_material |

**Key insight:** Both Animation and TileSet resources have complex nested structures that Godot's ResourceSaver handles correctly. Hand-writing .tres files for these would be extremely error-prone.

## Common Pitfalls

### Pitfall 1: TileSetAtlasSource Texture Order Dependency
**What goes wrong:** Calling `create_tile()` before `set_texture()` on a TileSetAtlasSource causes `!room_for_tile` errors.
**Why it happens:** Godot calculates the tile grid dimensions from the texture size. Without a texture, the grid has zero dimensions.
**How to avoid:** Always set texture first: `atlas_source.texture = load(texture_path)` then `atlas_source.create_tile(coords)`.
**Warning signs:** `!room_for_tile` error in Godot output.

### Pitfall 2: AnimationLibrary Requirement in Godot 4.x
**What goes wrong:** Trying to add an Animation directly to AnimationPlayer without wrapping in AnimationLibrary.
**Why it happens:** Godot 4.x changed the architecture. In 3.x, animations could be added directly; in 4.x, they must be in a library.
**How to avoid:** Always create AnimationLibrary first, add animations to it, then add library to AnimationPlayer.
**Warning signs:** Method not found errors if trying non-existent `AnimationPlayer.add_animation()`.

### Pitfall 3: Headless Texture Loading for TileSets
**What goes wrong:** Concern that textures return null in headless mode, breaking TileSet creation.
**Why it happens:** Godot headless mode has a dummy display server -- textures load but with zero-size pixel data.
**How to avoid:** This is actually a NON-ISSUE for our use case. `load()` on an already-imported texture returns a valid Texture2D reference even in headless mode. The TileSet only needs the reference path, not pixel data. ResourceSaver.save() serializes the resource path correctly.
**Warning signs:** If the texture has never been imported by the editor (no `.import` file), `load()` will fail. But this would fail in non-headless mode too.

### Pitfall 4: Node Ownership When Modifying Scenes
**What goes wrong:** Adding nodes or modifying node properties in a scene, but changes are lost when saving.
**Why it happens:** `PackedScene.pack()` only includes nodes whose `owner` is set to the root node.
**How to avoid:** After adding new nodes, set `node.owner = scene_root`. The existing `connect_signal` and `instance_scene` operations already handle this correctly -- follow the same pattern.
**Warning signs:** Saved scene is missing nodes that were added programmatically.

### Pitfall 5: TileMapLayer set_cell Parameter Confusion
**What goes wrong:** Passing wrong parameter order or missing alternative_tile parameter.
**Why it happens:** `set_cell()` takes 4 parameters: `Vector2i coords, int source_id, Vector2i atlas_coords, int alternative_tile`. The alternative_tile defaults to 0 but must be considered.
**How to avoid:** Always pass all 4 parameters explicitly. Use 0 for alternative_tile unless rotation/flipping is needed.
**Warning signs:** Tiles not appearing or wrong tiles showing.

### Pitfall 6: Animation Track Path Format
**What goes wrong:** Keyframe animations don't affect the target node.
**Why it happens:** Track paths are relative to the AnimationPlayer's node in the scene tree. Wrong path format means the track can't find its target.
**How to avoid:** Track paths use the format `"NodePath:property"` relative to the AnimationPlayer's parent. For example, `"Sprite2D:position"` if the Sprite2D is a sibling of the AnimationPlayer. Accept full node paths from the user and document the path convention.
**Warning signs:** Animation plays but properties don't change.

## Code Examples

### Create Animation with Value Tracks (ANIM-01)
```gdscript
# GDScript operation handler
func create_animation(params):
    var output_path = ensure_res_prefix(params.get("output_path", ""))
    var length = float(params.get("length", 1.0))
    var loop_mode_str = params.get("loop_mode", "none")
    var step = float(params.get("step", 0.1))
    var tracks = params.get("tracks", [])

    var anim = Animation.new()
    anim.length = length
    anim.step = step

    # Set loop mode
    match loop_mode_str:
        "linear":
            anim.loop_mode = Animation.LOOP_LINEAR
        "pingpong":
            anim.loop_mode = Animation.LOOP_PINGPONG
        _:
            anim.loop_mode = Animation.LOOP_NONE

    # Add tracks with keyframes
    for track_data in tracks:
        var track_idx = anim.add_track(Animation.TYPE_VALUE)
        anim.track_set_path(track_idx, track_data.get("path", ""))

        var keyframes = track_data.get("keyframes", [])
        for kf in keyframes:
            var time = float(kf.get("time", 0.0))
            var value = kf.get("value")
            var type_hint = kf.get("type", "")
            var typed_value = convert_json_to_godot_type(value, type_hint)
            anim.track_insert_key(track_idx, time, typed_value)

    # Save resource
    # ... standard directory creation + ResourceSaver.save() pattern ...

    print(JSON.stringify({"success": true, "path": output_path, "track_count": tracks.size()}))
```

### Create AnimationLibrary (ANIM-02)
```gdscript
func create_animation_library(params):
    var output_path = ensure_res_prefix(params.get("output_path", ""))
    var animations = params.get("animations", {})

    var library = AnimationLibrary.new()

    for anim_name in animations:
        var anim_path = ensure_res_prefix(animations[anim_name])
        var anim = load(anim_path) as Animation
        if anim == null:
            log_error("Failed to load animation: " + anim_path)
            print(JSON.stringify({"success": false, "error": "Failed to load animation: " + anim_path}))
            return
        library.add_animation(anim_name, anim)

    # Save with ResourceSaver
    ResourceSaver.save(library, output_path)
    print(JSON.stringify({"success": true, "path": output_path, "animation_count": animations.size()}))
```

### Create TileSet with TileSetAtlasSource (TILE-01)
```gdscript
func create_tileset(params):
    var output_path = ensure_res_prefix(params.get("output_path", ""))
    var texture_path = ensure_res_prefix(params.get("texture_path", ""))
    var tile_size = Vector2i(
        int(params.get("tile_width", 16)),
        int(params.get("tile_height", 16))
    )
    var separation = Vector2i(
        int(params.get("separation_x", 0)),
        int(params.get("separation_y", 0))
    )
    var margins = Vector2i(
        int(params.get("margin_x", 0)),
        int(params.get("margin_y", 0))
    )

    # Load the texture (MUST be done before create_tile)
    var texture = load(texture_path) as Texture2D
    if texture == null:
        log_error("Failed to load texture: " + texture_path)
        print(JSON.stringify({"success": false, "error": "Failed to load texture: " + texture_path}))
        return

    var tileset = TileSet.new()
    tileset.tile_size = tile_size

    var atlas_source = TileSetAtlasSource.new()
    atlas_source.texture = texture  # MUST set before create_tile()
    atlas_source.texture_region_size = tile_size
    atlas_source.separation = separation
    atlas_source.margins = margins

    # Auto-create tiles from the texture grid
    var tex_size = texture.get_size()
    var grid_w = int((tex_size.x - margins.x) / (tile_size.x + separation.x))
    var grid_h = int((tex_size.y - margins.y) / (tile_size.y + separation.y))
    for y in range(grid_h):
        for x in range(grid_w):
            atlas_source.create_tile(Vector2i(x, y))

    var source_id = tileset.add_source(atlas_source)

    # Save
    ResourceSaver.save(tileset, output_path)
    print(JSON.stringify({
        "success": true,
        "path": output_path,
        "source_id": source_id,
        "grid_size": {"x": grid_w, "y": grid_h},
        "tile_count": grid_w * grid_h
    }))
```

### Paint Cells on TileMapLayer (TILE-02)
```gdscript
func paint_tilemap_cells(params):
    var full_scene_path = ensure_res_prefix(params.scene_path)
    var node_path = params.node_path

    var scene = load(full_scene_path)
    if not scene:
        log_error("Failed to load scene: " + full_scene_path)
        quit(1)

    var scene_root = scene.instantiate()
    var target = find_node_by_path(scene_root, node_path)

    if not target or not target is TileMapLayer:
        log_error("Node is not a TileMapLayer: " + node_path)
        quit(1)

    var cells = params.get("cells", [])
    for cell in cells:
        var coords = Vector2i(int(cell.x), int(cell.y))
        var source_id = int(cell.get("source_id", 0))
        var atlas_coords = Vector2i(
            int(cell.get("atlas_x", 0)),
            int(cell.get("atlas_y", 0))
        )
        var alternative = int(cell.get("alternative_tile", 0))
        target.set_cell(coords, source_id, atlas_coords, alternative)

    # Repack and save
    var packed = PackedScene.new()
    packed.pack(scene_root)
    ResourceSaver.save(packed, full_scene_path)

    print(JSON.stringify({"success": true, "cells_painted": cells.size()}))
```

### Fill Rectangular Region (TILE-03)
```gdscript
func fill_tilemap_region(params):
    # ... scene load + node find same as paint_tilemap_cells ...

    var x_start = int(params.get("x_start", 0))
    var y_start = int(params.get("y_start", 0))
    var x_end = int(params.get("x_end", 0))
    var y_end = int(params.get("y_end", 0))
    var source_id = int(params.get("source_id", 0))
    var atlas_x = int(params.get("atlas_x", 0))
    var atlas_y = int(params.get("atlas_y", 0))
    var alternative = int(params.get("alternative_tile", 0))

    var count = 0
    for y in range(y_start, y_end + 1):
        for x in range(x_start, x_end + 1):
            target.set_cell(
                Vector2i(x, y),
                source_id,
                Vector2i(atlas_x, atlas_y),
                alternative
            )
            count += 1

    # Repack and save...
    print(JSON.stringify({"success": true, "cells_filled": count}))
```

### Clear Cells (TILE-04)
```gdscript
func clear_tilemap_cells(params):
    # ... scene load + node find ...

    var cells = params.get("cells", [])
    if cells.size() == 0:
        # Clear all cells
        target.clear()
        print(JSON.stringify({"success": true, "cleared": "all"}))
    else:
        # Clear specific cells
        for cell in cells:
            target.erase_cell(Vector2i(int(cell.x), int(cell.y)))
        print(JSON.stringify({"success": true, "cells_cleared": cells.size()}))

    # Repack and save...
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| AnimationPlayer.add_animation() | AnimationLibrary + AnimationPlayer.add_animation_library() | Godot 4.0 | Must create library wrapper for all animations |
| TileMap node (single class) | TileMapLayer (separate node per layer) | Godot 4.3 | Use TileMapLayer exclusively; TileMap deprecated |
| TileMap.set_cell(layer, coords, ...) | TileMapLayer.set_cell(coords, ...) | Godot 4.3 | No layer parameter needed; each layer is its own node |
| Animation loop property (bool) | Animation.loop_mode (enum) | Godot 4.0 | Use LOOP_NONE/LOOP_LINEAR/LOOP_PINGPONG |

**Deprecated/outdated:**
- `TileMap` class: Deprecated in Godot 4.3+, replaced by individual `TileMapLayer` nodes
- `AnimationPlayer.add_animation()`: Does not exist in Godot 4.x, replaced by AnimationLibrary pattern
- `Animation.loop` (bool): Replaced by `Animation.loop_mode` (enum) in Godot 4.0

## Open Questions

1. **Headless texture.get_size() accuracy**
   - What we know: Textures load in headless mode but return (0,0) for pixel dimensions in server builds. However, this appears to be for server/export builds, not `--headless` mode during development.
   - What's unclear: Whether `texture.get_size()` returns the real dimensions in `--headless` flag mode (which IS a display server, just invisible) vs true server builds.
   - Recommendation: The auto-tile-grid calculation in `create_tileset` should handle the case where texture size is (0,0) by accepting explicit `columns` and `rows` parameters as fallback. But this is likely not needed since `--headless` is different from server builds. Validate during implementation.

2. **Animation track paths relative to what?**
   - What we know: Track paths are NodePaths relative to the AnimationPlayer's parent node. e.g., if AnimationPlayer is at `/root/Player/AnimationPlayer`, a track path of `"Sprite2D:position"` targets `/root/Player/Sprite2D.position`.
   - What's unclear: Whether users will understand this convention or need guidance.
   - Recommendation: The tool description should document that track paths are relative to the AnimationPlayer's root node (its parent in the scene tree). Accept paths like `"Sprite2D:position"` or `".:position"` for the parent itself.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/animation-tools.test.ts tests/tilemap-tools.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ANIM-01 | Create animation with value tracks | unit | `npx vitest run tests/animation-tools.test.ts -t "create_animation"` | Wave 0 |
| ANIM-02 | Create animation library | unit | `npx vitest run tests/animation-tools.test.ts -t "create_animation_library"` | Wave 0 |
| ANIM-03 | Add keyframes to existing track | unit | `npx vitest run tests/animation-tools.test.ts -t "add_keyframes"` | Wave 0 |
| ANIM-04 | Assign library to AnimationPlayer | unit | `npx vitest run tests/animation-tools.test.ts -t "assign_animation_library"` | Wave 0 |
| TILE-01 | Create TileSet with atlas source | unit | `npx vitest run tests/tilemap-tools.test.ts -t "create_tileset"` | Wave 0 |
| TILE-02 | Paint cells on TileMapLayer | unit | `npx vitest run tests/tilemap-tools.test.ts -t "paint_tilemap"` | Wave 0 |
| TILE-03 | Fill rectangular region | unit | `npx vitest run tests/tilemap-tools.test.ts -t "fill_tilemap"` | Wave 0 |
| TILE-04 | Clear cells on TileMapLayer | unit | `npx vitest run tests/tilemap-tools.test.ts -t "clear_tilemap"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/animation-tools.test.ts tests/tilemap-tools.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/animation-tools.test.ts` -- covers ANIM-01, ANIM-02, ANIM-03, ANIM-04
- [ ] `tests/tilemap-tools.test.ts` -- covers TILE-01, TILE-02, TILE-03, TILE-04

## MCP Tool Design

### Proposed Tools (8 requirements -> 6 tools)

| Tool Name | Requirement | Domain File | Description |
|-----------|-------------|-------------|-------------|
| `create_animation` | ANIM-01, ANIM-03 | animation.ts | Create Animation .tres with tracks + keyframes |
| `create_animation_library` | ANIM-02 | animation.ts | Create AnimationLibrary .tres from animation paths |
| `add_keyframes` | ANIM-03 | animation.ts | Add keyframes to existing animation track |
| `assign_animation_library` | ANIM-04 | animation.ts | Assign AnimationLibrary to AnimationPlayer in scene |
| `create_tileset` | TILE-01 | tilemap.ts | Create TileSet .tres with atlas source |
| `paint_tilemap` | TILE-02, TILE-03, TILE-04 | tilemap.ts | Paint, fill, or clear cells on TileMapLayer |

**Rationale for 6 tools (not 8):**
- `create_animation` handles both ANIM-01 (create with tracks) and the "create new track" aspect of ANIM-03.
- `add_keyframes` is a separate tool for ANIM-03's "add to existing" case.
- `paint_tilemap` unifies TILE-02 (individual cells), TILE-03 (fill region), and TILE-04 (clear) into one tool with a `mode` parameter (`paint`, `fill`, `clear`). This reduces tool count while keeping all operations accessible through a single tool with clear parameter variations.

### Tool Parameter Schemas (Key Details)

**create_animation:**
- `project_path`, `output_path` (standard)
- `length` (float, default 1.0)
- `loop_mode` ("none" | "linear" | "pingpong", default "none")
- `step` (float, default 0.1)
- `tracks` (array of {path: string, keyframes: [{time: number, value: any, type?: string}]})

**create_animation_library:**
- `project_path`, `output_path` (standard)
- `animations` (record: animation_name -> animation_path)

**add_keyframes:**
- `project_path`, `animation_path` (path to existing .tres)
- `track_index` (int) or `track_path` (string) to identify the track
- `keyframes` (array of {time: number, value: any, type?: string})

**assign_animation_library:**
- `project_path`, `scene_path` (standard)
- `node_path` (path to AnimationPlayer node)
- `library_name` (string, e.g., "" for default library)
- `library_path` (path to .tres AnimationLibrary resource)

**create_tileset:**
- `project_path`, `output_path` (standard)
- `texture_path` (path to atlas texture)
- `tile_width`, `tile_height` (int, tile size in pixels)
- `separation_x`, `separation_y` (int, optional, default 0)
- `margin_x`, `margin_y` (int, optional, default 0)
- `columns`, `rows` (int, optional -- explicit grid size, overrides auto-detection)

**paint_tilemap:**
- `project_path`, `scene_path` (standard)
- `node_path` (path to TileMapLayer)
- `mode` ("paint" | "fill" | "clear")
- For "paint": `cells` array [{x, y, source_id, atlas_x, atlas_y, alternative_tile?}]
- For "fill": `x_start, y_start, x_end, y_end, source_id, atlas_x, atlas_y, alternative_tile?`
- For "clear": `cells` array [{x, y}] (optional -- if empty, clear all)

## Sources

### Primary (HIGH confidence)
- Godot 4.4 Animation class docs: https://docs.godotengine.org/en/4.4/classes/class_animation.html
- Godot 4.4 AnimationLibrary docs: https://docs.godotengine.org/en/4.4/classes/class_animationlibrary.html
- Godot 4.4 TileMapLayer docs: https://docs.godotengine.org/en/4.3/classes/class_tilemaplayer.html
- Godot 4.4 TileSetAtlasSource docs: https://docs.godotengine.org/en/4.4/classes/class_tilesetatlassource.html
- Existing codebase: `src/tools/composition.ts`, `src/tools/shader.ts`, `src/tools/config.ts` (implementation patterns)
- Existing codebase: `src/scripts/godot_operations.gd` (GDScript operation dispatch pattern)
- Existing codebase: `tests/config-tools.test.ts` (test pattern)

### Secondary (MEDIUM confidence)
- Godot Forum: Adding animations via code (Godot 4.2 pattern): https://forum.godotengine.org/t/adding-an-animation-to-the-animationplayer-via-code/50043
- Godot Forum: TileMapLayer usage: https://forum.godotengine.org/t/how-to-use-tilemaplayer-in-gdscript/102334
- ROKOJORI Labs Godot 4.4 docs (TileMapLayer methods): https://rokojori.com/en/labs/godot/docs/4.4/tilemaplayer-class
- DeepWiki TileMap System: https://deepwiki.com/godotengine/godot/4.10-tilemap-system
- GitHub issue godotengine/godot-docs#10784 (TileSetAtlasSource creation order): https://github.com/godotengine/godot-docs/issues/10784

### Tertiary (LOW confidence)
- GitHub issue #57067 (headless texture loading): https://github.com/godotengine/godot/issues/57067 -- relates to server builds, likely not applicable to `--headless` flag mode

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Uses exact same TypeScript + GDScript dual-execution pattern as Phases 5-6
- Architecture: HIGH - Follows established tool domain pattern (composition.ts, config.ts, shader.ts)
- GDScript APIs: HIGH - Animation.add_track/track_insert_key/track_set_path verified via official docs and community examples
- TileMapLayer API: HIGH - set_cell/erase_cell/clear verified via official docs
- Headless texture concern: MEDIUM - Evidence suggests `--headless` flag (not server build) loads textures with valid size; minor risk
- Pitfalls: HIGH - All identified pitfalls come from official docs or confirmed community issues

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable APIs, Godot 4.x mature)
