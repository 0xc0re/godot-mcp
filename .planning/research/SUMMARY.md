# Project Research Summary

**Project:** godot-mcp v2.0 Enhancements
**Domain:** MCP server for Godot 4.x — autonomous AI game development tooling
**Researched:** 2026-03-03
**Confidence:** HIGH (stack verified against live codebase and Godot 4.6.1 binary; architecture confirmed against live project files; pitfalls cross-referenced with official Godot issue tracker)

## Executive Summary

This is a v2.0 expansion of an already-shipped MCP server that enables Claude to autonomously build Godot 4.x games. The v1.0 baseline (27 tools) is validated and stable. The v2.0 work adds 11 new capability areas: signal connections, scene instancing, batch property operations, node groups, input action management, animation tools, TileMap/TileSet operations, shader file management, DAP runtime inspection, headless export, and hot-reload. The existing architecture — TypeScript tool handlers dispatching to a GDScript headless subprocess via `executeOperation()` — is sound and extends cleanly to all new features with one exception: runtime inspection requires a different execution model (TCP connection or file-polling IPC to a running game, not a headless subprocess).

The recommended implementation order follows dependency depth and risk. Seven features (signal connections, scene instancing, batch properties, node groups, input actions, shader management, headless export) are P1: they extend existing patterns directly and have HIGH confidence. Three features (animation tools, TileMap/TileSet, DAP runtime inspection) are P2: they follow established patterns but involve more complex Godot subsystems or headless edge cases that need validation. Hot-reload is P3: Godot 4.x hot-reload from external tools is unreliable by design — confirmed across multiple open Godot issues — and the recommended approach is "write file + restart project" rather than true live script injection.

The single most important constraint discovered: Godot 4's runtime debug protocol is proprietary (NOT standard DAP), and a DAP regression in Godot 4.5+ disconnects external clients before the project boots. The file-polling pattern (mirroring `screenshot_helper.gd`) is the lower-risk implementation path for runtime scene inspection. Additionally, `TileMap` is deprecated in Godot 4.3+ — all tilemap tools must target `TileMapLayer` exclusively from the start. Two Godot-specific serialization traps — the `CONNECT_PERSIST` flag for signal persistence and `GEN_EDIT_STATE_INSTANCE` for scene instancing — will cause silent data loss if missed during implementation.

## Key Findings

### Recommended Stack

The v2.0 expansion requires only **one new npm dependency**: `@vscode/debugprotocol@^1.68.0` (TypeScript type declarations for the DAP wire protocol, maintained by Microsoft, zero runtime overhead). Every other v2.0 feature extends existing patterns without new packages. The existing stack — `@modelcontextprotocol/sdk ^1.27.1`, `zod ^3.25.76`, `TypeScript ^5.3.3`, `@fernforestgames/godot-resource-parser 0.1.3`, `vitest ^4.0.18` — covers all new functionality. Attempts to find purpose-built Godot TypeScript libraries for animation or tilemap manipulation found none; GDScript via `godot_operations.gd` is the only viable path for all Godot-native operations.

**Core technologies (existing — do not change):**
- `@modelcontextprotocol/sdk ^1.27.1`: MCP server, tool registration — established, working
- `zod ^3.25.76`: Input schema validation — all new tools follow existing zod schema pattern
- `GDScript (godot_operations.gd)`: Headless write operations — extend with ~8 new `match` cases
- `@fernforestgames/godot-resource-parser 0.1.3`: .tscn/.tres read parsing — extend tscn-parser.ts to surface connections[]

**New addition:**
- `@vscode/debugprotocol@^1.68.0`: TypeScript DAP type definitions — types only, no runtime; models `src/dap/client.ts` after `src/lsp/client.ts`

**Critical version notes:**
- `TileMapLayer` requires Godot 4.3+ — document as minimum version for tilemap tools
- `--dap-port` flag available in Godot 4.1+; verified present in Godot 4.6.1
- DAP regression in Godot 4.5+/master affects external client connections — target Godot 4.4.x for DAP features

### Expected Features

**Must have — P1 (table stakes, extend existing patterns):**
- Signal connections (`connect_signal`, `disconnect_signal`) — game logic wiring; `CONNECT_PERSIST` flag required for .tscn persistence or connection is silently discarded
- Scene instancing (`instance_scene`) — core Godot reuse pattern; `PackedScene.instantiate(GEN_EDIT_STATE_INSTANCE)` + `set_owner()` required
- Batch property operations (`batch_set_properties`) — eliminate 200ms-per-property subprocess overhead; single GDScript invocation for N changes
- Node groups (`add_node_to_group`, `remove_node_from_group`) — game tagging system; `groups=[]` in .tscn node header
- Input action management (`manage_input_action`) — essential for game scaffolding; must use `ProjectSettings.save()`, NOT runtime InputMap (runtime-only, not persisted)
- Shader file management (`create_shader_file`, `create_shader_material`) — .gdshader is plain text (TypeScript `fs.writeFileSync`); ShaderMaterial .tres via existing `create_resource` pattern
- Headless export (`export_project`) — `--export-release` CLI invocation; 180s timeout; pre-flight validation of export_presets.cfg and templates required

**Should have — P2 (higher complexity, need validation):**
- Animation tools (`create_animation_library`, `add_animation_track`) — AnimationPlayer/AnimationLibrary API; headless AnimationPlayer node lifecycle needs testing
- TileMap/TileSet operations (`configure_tileset`, `set_tile_cell`) — `TileMapLayer` API (Godot 4.3+); headless texture loading for TileSet needs validation
- DAP runtime inspection (`inspect_runtime_scene`) — file-polling approach preferred over raw TCP (Godot debug protocol is proprietary, NOT standard DAP)

**Defer to v2.x+:**
- Hot-reload GDScript — implement as "write file + stop/run cycle"; true in-process reload not reliably achievable from external tools
- AnimationTree/StateMachine — too complex for autonomous operation; editor-only visual work
- Full tilemap painting for large maps — needs bulk `set_tile_region()` operation to be token-efficient

### Architecture Approach

The architecture is an extension of the existing pattern: TypeScript tool modules dispatch operations to `godot_operations.gd` via `executeOperation()`, which spawns a headless Godot subprocess. Four new tool modules (`animation.ts`, `tilemap.ts`, `runtime.ts`, `export.ts`) join the existing `scene.ts` and `project.ts` (each extended with new tools). The GDScript backend gains ~8 new `match` cases. Runtime inspection breaks the pattern by using file-polling IPC (mirroring `screenshot_helper.gd`) rather than a headless subprocess — Godot's runtime debug protocol is proprietary and has an active regression. Export also breaks the pattern by calling `execGodot` directly with `--export-release` flags and a 180s timeout (no GDScript script needed).

**Major components:**
1. `src/tools/scene.ts` (EXTEND) — add connect_signal, instance_scene, set_node_groups, batch_set_properties (4 new tools)
2. `src/tools/project.ts` (EXTEND) — add manage_input_action (1 new tool)
3. `src/tools/animation.ts` (NEW) — create_animation_library, add_animation_track via executeOperation
4. `src/tools/tilemap.ts` (NEW) — configure_tileset, set_tile_cell via executeOperation
5. `src/tools/runtime.ts` (NEW) — inspect_runtime_scene via file-polling IPC (runtime_helper.gd autoload)
6. `src/tools/export.ts` (NEW) — export_project via execGodot with 180s timeout and pre-flight checks
7. `src/parsers/tscn-parser.ts` (EXTEND) — surface connections[] in ParsedScene (data already in .tscn files, just not exposed)
8. `src/scripts/godot_operations.gd` (EXTEND) — ~8 new operation functions in match block

**Key patterns by execution model:**
- All write operations: `executeOperation()` → GDScript match block → load scene → modify → `ResourceSaver.save()` → return JSON
- Shader .gdshader files: TypeScript `fs.writeFileSync` directly (plain text, no GDScript needed)
- Export: `execGodot(['--export-release', preset, output], { timeout: 180_000 })` (no GDScript script involved)
- Runtime inspection: file-polling trigger/response pattern — NOT TCP to undocumented Godot protocol

### Critical Pitfalls

1. **CONNECT_PERSIST flag missing in signal connections** — `node.signal_name.connect(target.method)` creates a runtime-only connection that is silently discarded when `ResourceSaver.save()` serializes the scene. Always pass `CONNECT_PERSIST` (constant value 2) in godot_operations.gd. Verify the saved .tscn contains `[connection signal=...]` lines after save. Tool returns "success" even when the connection is silently lost.

2. **GEN_EDIT_STATE_INSTANCE missing in scene instancing** — `load(path).instantiate()` without this flag creates an instance whose property overrides are not serialized correctly. Always use `load(path).instantiate(PackedScene.GEN_EDIT_STATE_INSTANCE)` and call `set_owner(scene_root)` on every child node recursively. Verify .tscn shows `instance=ExtResource(...)` not inlined node definitions.

3. **Batch operations implemented as TypeScript loop** — Calling `executeOperation()` N times in TypeScript defeats the purpose; each call spawns a Godot subprocess at ~200ms. The `batch_set_properties` operation must be a single new GDScript function that accepts an array of `{node_path, property, value}` tuples and processes all of them in one subprocess invocation. One subprocess for N properties — not N subprocesses.

4. **DAP runtime inspection using headless subprocess** — A headless `--script` Godot process has no scene tree and no remote debugger endpoint. DAP inspection requires connecting to a running game launched with `--remote-debug`. Additionally, Godot's debug protocol is proprietary (not standard DAP despite using port 6007); use the file-polling approach (runtime_helper.gd) instead of attempting TCP protocol implementation. Godot 4.5+ has a confirmed regression where external DAP clients disconnect before project boots.

5. **Headless export silent failures** — Godot often exits code 0 even when export fails. Always validate preconditions before invoking export (export_presets.cfg exists, preset name matches exactly, export templates installed in `~/.local/share/godot/export_templates/`), parse stdout for known error strings, and verify the output file exists with non-zero size after export completes.

6. **TileMap vs TileMapLayer API** — `TileMap` is deprecated in Godot 4.3+; the API changed significantly (`set_cell` signature is different; data serialization changed from int32 to PackedByteArray). All tilemap tools must target `TileMapLayer` exclusively from the start. Document Godot 4.3+ as minimum version for tilemap features.

7. **Input action persistence via runtime InputMap** — `InputMap.add_action()` modifies the runtime singleton only; it is NOT persisted when the headless Godot process exits. Must use `ProjectSettings.set("input/action_name", {...})` followed by `ProjectSettings.save()` in GDScript to write the `Object(InputEventKey,...)` format correctly into project.godot. The format is too complex to emit safely from TypeScript string templates.

## Implications for Roadmap

Based on combined research, the natural phase structure follows dependency depth, risk level, and grouping by execution model. Phases 1-2 cover all P1 features using familiar patterns. Phase 3 covers P2 features requiring deeper Godot subsystem knowledge. Phase 4 is the highest-risk feature (runtime inspection). Phase 5 is documentation of a known limitation.

### Phase 1: Core Scene Composition Primitives

**Rationale:** Signal connections, scene instancing, node groups, and batch property operations all extend existing `scene.ts` + `godot_operations.gd` patterns with HIGH confidence. They are the fundamental game-building primitives that unlock all downstream AI-assisted content creation. These are table-stakes features — competitors (GoPeak, tugcantopaloglu) all have them. The tscn-parser.ts extension for connections[] is a natural companion (read what you write).

**Delivers:** Complete scene wiring capability — AI can connect nodes, instantiate subscenes, tag nodes with groups, and set multiple properties efficiently in a single subprocess call.

**Addresses:** signal connections (P1), scene instancing (P1), batch property operations (P1), node groups (P1)

**Avoids:** CONNECT_PERSIST omission (Pitfall 7), GEN_EDIT_STATE_INSTANCE omission (Pitfall 8), batch-as-TypeScript-loop anti-pattern (Pitfall 9)

**Architecture:** Extends scene.ts + godot_operations.gd + tscn-parser.ts (surface connections[]). No new modules needed.

**Research flag:** Standard patterns — skip research-phase. Implementation is HIGH confidence; patterns verified against live .tscn files and existing codebase.

### Phase 2: Project Configuration and Asset Management

**Rationale:** Input action management (project.godot write), shader file management (fs write + create_resource), and headless export (execGodot with flags) are independent of Phase 1 features and complete the "project scaffolding" capability set. Headless export is uniquely valuable — neither GoPeak nor tugcantopaloglu implements it, making it a genuine competitive differentiator.

**Delivers:** Complete project configuration — AI can define input bindings, create shader files and materials, and build exportable game artifacts.

**Addresses:** input action management (P1), shader file management (P1), headless export (P1)

**Avoids:** Runtime InputMap persistence trap (Pitfall 14), export silent failure (Pitfall 11), 30s timeout for export operations (Architecture anti-pattern 4)

**Architecture:** Extends project.ts (input actions via ProjectSettings.save()); extends scene.ts or resource.ts (shader file TypeScript write + ShaderMaterial via create_resource); new export.ts module with 180s timeout and pre-flight validation.

**Research flag:** Standard patterns — skip research-phase. Input action format verified against live bfg/project.godot file. Export CLI syntax confirmed in Godot 4.6.1 binary help output. Shader files are plain text.

### Phase 3: Complex Godot Subsystems (Animation + TileMap)

**Rationale:** Animation tools and TileMap/TileSet operations follow the same `executeOperation()` pattern as Phases 1-2 but involve more complex Godot resource hierarchies: AnimationLibrary → Animation → typed tracks, and TileSet → TileSetAtlasSource → TileMapLayer. These are P2 features with HIGH user value but MEDIUM implementation confidence due to unresolved headless edge cases — specifically, whether textures load correctly when creating TileSets without a display server.

**Delivers:** Game content creation — AI can create animated characters (AnimationPlayer with typed keyframe tracks) and build tile-based levels (TileMapLayer with TileSet atlas sources).

**Addresses:** animation tools (P2), TileMap/TileSet operations (P2)

**Avoids:** TileMap deprecation trap (Pitfall 13); headless texture loading edge case (needs validation)

**Architecture:** New animation.ts and tilemap.ts modules; extend godot_operations.gd with create_animation, add_animation_track, configure_tileset, set_tile_cell operations.

**Research flag:** Needs `/gsd:research-phase`. Two open questions: (1) headless AnimationPlayer node lifecycle — does the AnimationPlayer need to exist in the scene tree before library assignment in headless mode? (2) TileSet texture loading without display server — does `load("res://tiles.png")` return a valid Texture2D in headless Godot? If textures fail, scope tilemap to "paint cells on a pre-existing TileSet" only.

### Phase 4: Runtime Inspection

**Rationale:** DAP-based runtime scene inspection is the highest-risk feature in the entire v2.0 scope. It requires a fundamentally different execution model (connecting to a running game process, not spawning a headless subprocess), Godot's debug protocol is proprietary, and there is a confirmed regression in Godot 4.5+ that disconnects external clients before the project boots. Build last, after all file-system-based features are stable and the implementation approach is validated.

**Delivers:** Live game observability — AI can inspect the running scene tree and variable state without stopping the game, enabling debugging and verification of game behavior.

**Addresses:** DAP runtime inspection (P2)

**Avoids:** Headless subprocess for DAP (Architecture anti-pattern 3), proprietary protocol implementation risk (Pitfall 10), Godot 4.5+ DAP regression impact

**Architecture:** New runtime.ts module using file-polling IPC (runtime_helper.gd autoload writes scene_tree.json when trigger file is written); extend ServerContext with optional dapProcess field; add cleanup in index.ts shutdown handler.

**Research flag:** Needs `/gsd:research-phase`. Must verify: (1) Godot 4.5+ DAP regression status as of implementation time (if fixed, TCP approach becomes viable), (2) file-polling approach feasibility — does `get_tree().root` provide sufficient scene data in a running game autoload?, (3) godot-vscode-plugin source for proprietary protocol details if TCP approach is reconsidered. Treat as a feasibility spike — be prepared to scope down or defer if neither approach is reliable.

### Phase 5: Hot-Reload (Documentation + Controlled Restart)

**Rationale:** True in-process hot-reload from an external tool is not reliably achievable in Godot 4.x — confirmed by multiple open official issues (#72825, #49298, #10946, #105667). The correct scoping is "write file + stop_project + run_project" with clear documentation of what this does and does not do. The value is in the documentation and user guidance, not in new technical implementation.

**Delivers:** Documented hot-reload workflow — "write + restart" cycle with actionable user guidance on what Godot can and cannot do with external file changes.

**Addresses:** hot-reload GDScript (P3)

**Avoids:** Promising hot-reload behavior Godot cannot reliably deliver (Architecture anti-pattern 5), LSP timestamp race condition (Pitfall 12)

**Architecture:** Minimal — the write and stop/run operations already exist. Add tool documentation and return guidance in tool descriptions.

**Research flag:** Standard patterns — no research needed. Limitation is definitively documented in Godot issue tracker.

### Phase Ordering Rationale

- **Phase 1 before Phase 2:** Both are P1 features but scene primitives unblock AI content creation workflows immediately. In practice, Phases 1 and 2 could be tackled concurrently by different contributors since they touch different modules.
- **Phase 1+2 before Phase 3:** Animation and TileMap tools depend on `add_node` (existing), `create_resource` (existing), and the `batch_set_properties` pattern from Phase 1 for efficient multi-property scene setup.
- **Phase 3 before Phase 4:** Runtime inspection is the highest-risk feature. Build it after all file-system-based tools are validated and the project's patterns are fully established.
- **Phase 5 last:** Lowest implementation value, well-understood limitation, minimal code change.
- **Groupings by execution model:** Phases 1-3 all use the headless subprocess pattern. Phase 4 introduces the file-polling/TCP model. Keeping them separate makes the architectural difference explicit and keeps testing scope manageable per phase.

### Research Flags

Phases needing `/gsd:research-phase` during planning:
- **Phase 3 (Animation + TileMap):** Headless AnimationPlayer node lifecycle not validated — does AnimationPlayer need to exist in the instantiated scene, or can AnimationLibrary be saved as a standalone .tres? TileSet texture loading without display server is an unresolved question — may need to scope tilemap to "paint cells on pre-existing TileSet" if `load()` returns null textures in headless mode.
- **Phase 4 (Runtime Inspection):** Godot 4.5+ DAP regression status is unknown at research time. File-polling vs TCP approach needs a feasibility spike. Proprietary Godot debug protocol requires study of godot-vscode-plugin source before implementation decisions.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Scene Composition):** All patterns verified against live .tscn files and live codebase. CONNECT_PERSIST and GEN_EDIT_STATE_INSTANCE flags documented clearly — implementation risk is known, not unknown.
- **Phase 2 (Project Config + Export):** Input action format verified against live project.godot. Export CLI syntax confirmed against Godot 4.6.1 binary. Shader files are plain text with no Godot-specific serialization.
- **Phase 5 (Hot-Reload):** Well-documented limitation; minimal implementation. No research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | One new dependency (@vscode/debugprotocol types only). All others verified in existing codebase. Godot 4.6.1 flags verified against installed binary. No npm alternatives exist for Godot animation/tilemap — GDScript is confirmed only path. |
| Features | HIGH | API verification from official Godot docs + live project file inspection (bfg game project). Feature scope clearly bounded by v1.0 baseline. Competitor comparison from live GitHub repos. DAP and headless animation are MEDIUM confidence. |
| Architecture | HIGH | Live codebase inspection confirms all extension points. Data flow verified against actual .tscn, .tres, project.godot files from bfg project. Anti-patterns documented with specific pitfall references. |
| Pitfalls | HIGH | Cross-referenced with official Godot issue tracker. Critical serialization traps (CONNECT_PERSIST, GEN_EDIT_STATE_INSTANCE) confirmed via official docs and community forum. DAP regression confirmed via issue reports. |

**Overall confidence:** HIGH for Phases 1, 2, 5. MEDIUM for Phase 3 (headless texture loading unresolved). MEDIUM-LOW for Phase 4 (proprietary protocol + active regression in Godot 4.5+).

### Gaps to Address

- **Headless TileSet texture loading:** Creating a TileSet programmatically in headless mode requires loading image textures — which may return null without a display server. Needs a spike: attempt `TileSetAtlasSource` creation with a real texture path in headless Godot 4.6.1 before committing to Phase 3 tilemap scope. If textures fail, scope tilemap to "paint cells on an existing TileSet" only.
- **Godot 4.5+ DAP regression:** A confirmed disconnection regression exists in Godot 4.5+ for external DAP clients. Phase 4 planning must verify the regression status against the Godot version available at implementation time. If unresolved, file-polling is the only viable approach.
- **Export templates detection path:** The `export_project` tool must verify export templates are installed before invoking Godot. The detection path `~/.local/share/godot/export_templates/<version>/` needs to be confirmed against Godot 4.6.1's actual storage location on this Linux machine before the Phase 2 implementation.
- **Input action keycode mapping:** The `Object(InputEventKey,...)` format uses Godot `Key` enum integer values (W=87, A=65, D=68, Space=32). Exposing friendly key names (e.g., "W", "Space") requires a lookup table. Decide during Phase 2 planning whether to include a keycode map or document raw keycode usage only.

## Sources

### Primary (HIGH confidence)

- `/usr/bin/godot --help` (Godot 4.6.1.stable, installed on this machine) — verified `--dap-port`, `--export-release`, `--export-debug`, `--export-pack`, `--headless` flags exist
- `/home/cstory/src/godot-mcp/tests/fixtures/sample.tscn` — confirmed `[connection signal=... from=... to=... method=...]` format
- `/home/cstory/src/bfg/scenes/game_scene.tscn` — confirmed `instance=ExtResource(...)` and `groups=["..."]` format in live bfg game project
- `/home/cstory/src/bfg/project.godot` — confirmed `Object(InputEventKey,...)` input action serialization format
- `/home/cstory/src/bfg/resources/tiles/dark_fantasy_tileset.tres` — confirmed TileSet/TileSetAtlasSource .tres format
- Godot official docs: Signal.connect() + CONNECT_PERSIST flag, PackedScene.GEN_EDIT_STATE_INSTANCE, InputMap API, AnimationLibrary API, TileMapLayer API, command-line export flags (4.4 docs)

### Secondary (MEDIUM confidence)

- [godot-vscode-plugin DAP DeepWiki](https://deepwiki.com/godotengine/godot-vscode-plugin/4-debugging) — DAP protocol pattern; proprietary protocol confirmed
- [Godot Forum: AnimationPlayer via code](https://forum.godotengine.org/t/adding-an-animation-to-the-animationplayer-via-code/50043) — GDScript Animation API examples
- [@vscode/debugprotocol on npm](https://www.npmjs.com/package/@vscode/debugprotocol) — version 1.68.0, maintained by Microsoft, TypeScript-only
- [GoPeak/godot-mcp](https://github.com/HaD0Yun/godot-mcp) — competitor DAP implementation reference (port 6006)
- [kidscancode InputMap recipe](https://kidscancode.org/godot_recipes/4.x/input/custom_actions/index.html) — InputEventKey.keycode pattern confirmed

### Tertiary (HIGH confidence — official issue tracker)

- [Godot hot-reload Issue #72825](https://github.com/godotengine/godot/issues/72825) — external editor hot-reload does not work (open as of 2026-03)
- [Godot hot-reload Issue #105667](https://github.com/godotengine/godot/issues/105667) — static variable hot-reload broken in 4.3+
- [Godot DAP Issue #94227](https://github.com/godotengine/godot/issues/94227) — DAP port 6007, TCP address confirmed
- [Godot TileMap deprecation Issue #89012](https://github.com/godotengine/godot/issues/89012) — platform name change Linux/X11 → Linux in export presets (4.3)
- [Web export Issue #97841](https://github.com/godotengine/godot/issues/97841) — Web export ZIP broken in Godot 4.3, fixed in 4.4+

---
*Research completed: 2026-03-03*
*Ready for roadmap: yes*
