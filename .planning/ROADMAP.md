# Roadmap: Godot MCP Server

## Milestones

- ✅ **v1.0 MVP** -- Phases 1-4 (shipped 2026-03-04)
- **v2.0 Enhancements** -- Phases 5-8 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-4) -- SHIPPED 2026-03-04</summary>

- [x] Phase 1: Foundation (3/3 plans) -- completed 2026-03-03
- [x] Phase 2: Scene Intelligence (3/3 plans) -- completed 2026-03-03
- [x] Phase 3: Project & Script Intelligence (3/3 plans) -- completed 2026-03-04
- [x] Phase 4: Diagnostics & Runtime (3/3 plans) -- completed 2026-03-04

</details>

### v2.0 Enhancements

**Milestone Goal:** Close every major gap between the current server and a fully autonomous Godot game development AI -- an AI connected via this server can compose complete game scenes, wire game logic, configure game systems, inspect runtime state, and export builds.

- [ ] **Phase 5: Scene Composition** - AI can wire complete game scenes with signals, instanced subscenes, groups, and batch property operations
- [ ] **Phase 6: Project Configuration & Assets** - AI can configure input actions, create shaders, and export builds headlessly
- [ ] **Phase 7: Animation & TileMap** - AI can create animated characters and build tile-based levels
- [ ] **Phase 8: Runtime Inspection & Reload** - AI can inspect a running game's scene tree and restart after changes

## Phase Details

### Phase 5: Scene Composition
**Goal**: AI can compose complete game scenes by connecting signals between nodes, instancing subscenes, tagging nodes with groups, and setting multiple properties efficiently in a single subprocess call
**Depends on**: Phase 4 (v1.0 baseline -- scene read/modify/inspect tools exist)
**Requirements**: COMP-01, COMP-02, COMP-03, COMP-04, COMP-05, COMP-06
**Success Criteria** (what must be TRUE):
  1. AI can connect a signal between two nodes in a .tscn scene and the connection persists after save (visible in [connection] section of the .tscn file)
  2. AI can disconnect an existing signal connection between two nodes in a scene
  3. AI can add a .tscn scene as an instanced child node in another scene, with the instance reference (not inlined nodes) visible in the saved .tscn
  4. AI can set properties on multiple nodes in a single tool call that completes in one Godot subprocess invocation
  5. AI can add and remove nodes from groups, and group membership persists in the saved .tscn file
**Plans**: 2 plans

Plans:
- [ ] 05-01-PLAN.md -- Parser groups enhancement + GDScript operations backend
- [ ] 05-02-PLAN.md -- TypeScript composition tool handlers + tests

### Phase 6: Project Configuration & Assets
**Goal**: AI can scaffold complete game projects by configuring input bindings, creating shader files and materials, and exporting distributable builds
**Depends on**: Phase 5
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04, SHDR-01, SHDR-02, SHDR-03, EXPT-01, EXPT-02, EXPT-03
**Success Criteria** (what must be TRUE):
  1. AI can add input actions with keyboard and joypad bindings that persist in project.godot (not runtime-only)
  2. AI can remove input actions and list all configured input actions with their bindings
  3. AI can create a .gdshader file and a ShaderMaterial .tres that references it, with configurable shader parameters
  4. AI can export a project headlessly for a named preset, with pre-flight validation that catches missing presets or templates before the export runs
  5. AI can list available export presets from export_presets.cfg
**Plans**: 3 plans

Plans:
- [ ] 06-01-PLAN.md -- GDScript backend operations + execGodot timeout extension
- [ ] 06-02-PLAN.md -- Config + Shader TypeScript tool handlers + tests
- [ ] 06-03-PLAN.md -- Export tool handlers + tests + index.ts wiring

### Phase 7: Animation & TileMap
**Goal**: AI can create animated characters with keyframed property tracks and build tile-based game levels with atlas-based tilesets
**Depends on**: Phase 6
**Requirements**: ANIM-01, ANIM-02, ANIM-03, ANIM-04, TILE-01, TILE-02, TILE-03, TILE-04
**Success Criteria** (what must be TRUE):
  1. AI can create an Animation resource with value tracks containing time+value keyframes, and wrap it in an AnimationLibrary
  2. AI can add keyframes to an existing animation track and assign an AnimationLibrary to an AnimationPlayer node in a scene
  3. AI can create a TileSet resource with a TileSetAtlasSource referencing a texture and specifying tile size
  4. AI can paint individual cells, fill rectangular regions, and clear cells on a TileMapLayer node
**Plans**: 3 plans

Plans:
- [ ] 07-01-PLAN.md -- GDScript backend operations for animation and tilemap domains
- [ ] 07-02-PLAN.md -- Animation TypeScript tool handlers + tests
- [ ] 07-03-PLAN.md -- TileMap TypeScript tool handlers + tests + index.ts wiring

### Phase 8: Runtime Inspection & Reload
**Goal**: AI can observe a running game's live scene tree and node properties without stopping it, and trigger a restart cycle after making script changes
**Depends on**: Phase 7
**Requirements**: RUNT-01, RUNT-02, RUNT-03, HTRL-01, HTRL-02
**Success Criteria** (what must be TRUE):
  1. AI can get a snapshot of the live scene tree from a running project showing node names, types, and hierarchy
  2. AI can inspect property values on a specific node and list all nodes in a specific group in the running scene tree
  3. AI can trigger a stop-then-run cycle after script changes and receive confirmation that the restarted project is running
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 5 -> 6 -> 7 -> 8

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 3/3 | Complete | 2026-03-03 |
| 2. Scene Intelligence | v1.0 | 3/3 | Complete | 2026-03-03 |
| 3. Project & Script Intelligence | v1.0 | 3/3 | Complete | 2026-03-04 |
| 4. Diagnostics & Runtime | v1.0 | 3/3 | Complete | 2026-03-04 |
| 5. Scene Composition | v2.0 | 0/2 | Planning complete | - |
| 6. Project Configuration & Assets | v2.0 | 0/3 | Planning complete | - |
| 7. Animation & TileMap | v2.0 | 0/3 | Planning complete | - |
| 8. Runtime Inspection & Reload | v2.0 | 0/? | Not started | - |
