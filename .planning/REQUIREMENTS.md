# Requirements: Godot MCP Server

**Defined:** 2026-03-03
**Core Value:** An AI assistant connected via this server can perform any Godot development operation that a human developer would do

## v2.0 Requirements

Requirements for v2.0 Enhancements milestone. Each maps to roadmap phases.

### Scene Composition

- [x] **COMP-01**: AI can connect a signal between two nodes in a scene (with CONNECT_PERSIST for .tscn serialization)
- [x] **COMP-02**: AI can disconnect an existing signal connection between two nodes in a scene
- [x] **COMP-03**: AI can add an instance of a .tscn scene as a child node in another scene (with proper set_owner for pack)
- [x] **COMP-04**: AI can set multiple properties on multiple nodes in a single operation (batch, one subprocess)
- [x] **COMP-05**: AI can add a node to one or more groups
- [x] **COMP-06**: AI can remove a node from a group

### Project Configuration

- [ ] **CONF-01**: AI can add an input action with keyboard key binding to project.godot
- [ ] **CONF-02**: AI can add an input action with joypad button/axis binding to project.godot
- [ ] **CONF-03**: AI can remove an input action from project.godot
- [ ] **CONF-04**: AI can list all configured input actions with their bindings

### Shader Management

- [ ] **SHDR-01**: AI can create a .gdshader file with specified shader_type and source code
- [ ] **SHDR-02**: AI can create a ShaderMaterial resource (.tres) referencing a .gdshader file
- [ ] **SHDR-03**: AI can set shader parameters on an existing ShaderMaterial resource

### Animation

- [ ] **ANIM-01**: AI can create an Animation resource with value tracks (property animation)
- [ ] **ANIM-02**: AI can create an AnimationLibrary resource containing named animations
- [ ] **ANIM-03**: AI can add keyframes to an existing animation track (time + value pairs)
- [ ] **ANIM-04**: AI can assign an AnimationLibrary to an AnimationPlayer node in a scene

### TileMap

- [ ] **TILE-01**: AI can create a TileSet resource with a TileSetAtlasSource (texture + tile size)
- [ ] **TILE-02**: AI can paint cells on a TileMapLayer node (set_cell with source_id and atlas_coords)
- [ ] **TILE-03**: AI can paint a rectangular region of tiles in a single operation (bulk fill)
- [ ] **TILE-04**: AI can clear cells on a TileMapLayer node

### Runtime Inspection

- [ ] **RUNT-01**: AI can get a snapshot of the live scene tree from a running project (node names, types, hierarchy)
- [ ] **RUNT-02**: AI can inspect property values on a specific node in the running scene tree
- [ ] **RUNT-03**: AI can list all nodes in a specific group in the running scene tree

### Export

- [ ] **EXPT-01**: AI can export a project headlessly for a named preset (Web, Linux, Windows, macOS)
- [ ] **EXPT-02**: AI can validate export prerequisites before attempting (presets exist, templates installed)
- [ ] **EXPT-03**: AI can list available export presets from export_presets.cfg

### Hot-Reload

- [ ] **HTRL-01**: AI can trigger a project restart after script changes (stop + run cycle)
- [ ] **HTRL-02**: AI receives confirmation that the restarted project is running and responsive

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Animation

- **ANIM-05**: AI can create AnimationTree with state machine transitions
- **ANIM-06**: AI can create blend space animations

### Advanced TileMap

- **TILE-05**: AI can configure physics layers on a TileSet (collision shapes per tile)
- **TILE-06**: AI can configure navigation layers on a TileSet
- **TILE-07**: AI can configure terrain sets for auto-tiling

### Advanced Runtime

- **RUNT-04**: AI can set breakpoints in running project
- **RUNT-05**: AI can evaluate GDScript expressions in running context (with safety constraints)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Free-form GDScript expression evaluation at runtime | Shell injection vector; can crash or corrupt live game state |
| Full tilemap painting for large maps (100x100+) | Token budget explosion; 10,000 operations per map |
| Arbitrary shader compilation checking | Requires GPU context; unavailable in headless mode |
| True hot-reload without editor | Godot 4.x limitation -- unreliable without editor running (issues #72825, #109677) |
| AnimationTree/StateMachine visual editing | Deeply complex nested resources; editor-only workflow |
| C# script support | Different ecosystem; GDScript is the primary target |
| Godot 3.x compatibility | APIs incompatible; Godot 4.x is current standard |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| COMP-01 | Phase 5 | Complete |
| COMP-02 | Phase 5 | Complete |
| COMP-03 | Phase 5 | Complete |
| COMP-04 | Phase 5 | Complete |
| COMP-05 | Phase 5 | Complete |
| COMP-06 | Phase 5 | Complete |
| CONF-01 | Phase 6 | Pending |
| CONF-02 | Phase 6 | Pending |
| CONF-03 | Phase 6 | Pending |
| CONF-04 | Phase 6 | Pending |
| SHDR-01 | Phase 6 | Pending |
| SHDR-02 | Phase 6 | Pending |
| SHDR-03 | Phase 6 | Pending |
| ANIM-01 | Phase 7 | Pending |
| ANIM-02 | Phase 7 | Pending |
| ANIM-03 | Phase 7 | Pending |
| ANIM-04 | Phase 7 | Pending |
| TILE-01 | Phase 7 | Pending |
| TILE-02 | Phase 7 | Pending |
| TILE-03 | Phase 7 | Pending |
| TILE-04 | Phase 7 | Pending |
| RUNT-01 | Phase 8 | Pending |
| RUNT-02 | Phase 8 | Pending |
| RUNT-03 | Phase 8 | Pending |
| EXPT-01 | Phase 6 | Pending |
| EXPT-02 | Phase 6 | Pending |
| EXPT-03 | Phase 6 | Pending |
| HTRL-01 | Phase 8 | Pending |
| HTRL-02 | Phase 8 | Pending |

**Coverage:**
- v2.0 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0

---
*Requirements defined: 2026-03-03*
*Last updated: 2026-03-03 after roadmap creation*
