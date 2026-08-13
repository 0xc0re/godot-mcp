# Milestones

## v1.0 MVP (Shipped: 2026-03-04)

**Phases completed:** 4 phases, 12 plans
**Lines of code:** 7,141 TypeScript + 3,586 GDScript = 10,727 total
**Timeline:** 2026-03-03 (~7 hours)
**Git range:** docs(01) → test(04)

**Delivered:** Complete Godot 4.x MCP server rebuild — from broken v0.1.1 (tools invisible) to 22 working tools covering scene management, project settings, script intelligence, LSP diagnostics, and screenshot capture.

**Key accomplishments:**
1. Upgraded MCP SDK from 0.6.0 to 1.27.1+ — all tools discoverable in Claude Code
2. Refactored monolithic 2200-line index.ts into modular architecture (tools/, parsers, shared infrastructure)
3. Built headless .tscn/.tres parsers and scene read/modify/inspect tools
4. Added project settings management, script introspection, and ClassDB queries
5. Implemented GDScript LSP diagnostics via TCP with auto-spawned headless editor
6. Added screenshot capture with auto-resize for AI visual inspection

---

## v2.0 Enhancements (Shipped: 2026-03-04)

**Phases completed:** 4 phases (5-8), 10 plans
**Requirements:** 29/29 satisfied (COMP, CONF, SHDR, ANIM, TILE, RUNT, EXPT, HTRL) — audited PASSED (.planning/v2.0-MILESTONE-AUDIT.md)
**Timeline:** 2026-03-04 (~27 min of plan execution)
**Tests at ship:** 331 passing

**Delivered:** Closed the gap to an autonomous Godot development AI — scene composition (signals, instancing, groups, batch properties), project configuration (input actions), shaders, headless export with pre-flight validation, animation (Animation/AnimationLibrary/keyframes), TileMap painting on TileMapLayer, live runtime inspection via file-polling IPC, and a stop+run hot-reload cycle. 23 new tools across the composition, config, shader, export, animation, tilemap, and runtime domains.

**Key accomplishments:**
1. Signal wiring, subscene instancing, and group management persisted correctly in .tscn files
2. Input action management writing durable project.godot bindings (keyboard + joypad)
3. Shader pipeline: .gdshader creation → ShaderMaterial .tres → parameter setting
4. Headless export with preset listing and pre-flight validation (presets/templates checked before running)
5. Animation stack using the AnimationLibrary pattern (Godot 4.x current API)
6. TileMap tools targeting TileMapLayer exclusively (TileMap deprecated in 4.3+)
7. Runtime inspection via runtime_helper.gd autoload + file-polling IPC (DAP rejected due to Godot 4.5+ regression)

**Tech debt at ship (subsequently addressed in v2.1-hardening):** pollForResult stale-delete ordering (fixed by triggerAndPoll); manual runtime_helper autoload setup (replaced by auto-registration on run_project); headless TileSet texture loading unvalidated (headless guidance added).

### Post-v2.0 tool additions (consolidation note — no retro-fitted requirement IDs)

Between the v2.0 audit and the v2.1-hardening branch, 14 tools were added via quick tasks outside the phase/requirement system (both rounds pattern-mined from the ballz game project; design docs in docs/plans/):

- **Round 1 (10 tools):** `get_collision_layer_names`, `set_collision_layer_names`, `set_node_collision`, `list_autoloads`, `add_autoload`, `remove_autoload`, `run_tests` (GUT runner), `check_export_readiness`, `validate_scene`, `scaffold_event_bus`
- **Round 2 (4 tools):** `scaffold_config_manager`, `scaffold_resource_class`, `scaffold_tests`, `scaffold_health_component`

These carry no COMP/CONF-style requirement IDs by decision: they were delivered without phase plans, VERIFICATION.md files, or per-requirement traceability, so minting IDs retroactively would fabricate an audit trail that never existed. This note is their permanent record; any future milestone that extends these domains should define requirement IDs for the new work as usual. Tool surface after these additions: **65 tools / 16 modules** (asserted by tests/tool-registration.test.ts).

---

