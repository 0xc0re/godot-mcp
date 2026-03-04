# Stack Research

**Domain:** MCP server for Godot 4.x — v2.0 Enhancements (signal connections, scene instancing, batch operations, node groups, input actions, animation tools, tilemap operations, shader management, DAP runtime inspection, headless export, hot-reload)
**Researched:** 2026-03-03
**Confidence:** HIGH for Godot CLI flags (verified against /usr/bin/godot 4.6.1); MEDIUM for DAP client approach (no purpose-built Godot DAP TypeScript library exists — VSCode plugin pattern is best reference); LOW for hot-reload mechanism (confirmed unreliable with external editors in Godot 4.x)

---

## Existing Stack (Do Not Change)

These are already present and validated. Listing them only to establish integration points for new additions.

| Technology | Version | Role |
|------------|---------|------|
| @modelcontextprotocol/sdk | ^1.27.1 | MCP server, tool registration |
| zod | ^3.25.76 | Input schema validation for all tools |
| TypeScript | ^5.3.3 | Language |
| Node.js | >=18.0.0 | Runtime |
| GDScript (godot_operations.gd) | Godot 4.x | Headless write operations |
| @fernforestgames/godot-resource-parser | 0.1.3 | .tscn/.tres read parsing |
| vitest | ^4.0.18 | Tests |

---

## New Stack Additions for v2.0

### Core New Libraries

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| @vscode/debugprotocol | 1.68.0 | TypeScript type definitions for DAP wire protocol | The only maintained TypeScript DAP type package — defines all request/response/event interfaces. Does not include a runtime client; we implement our own TCP client (same pattern as the existing LSP client in src/lsp/). Used only for type safety on DAP messages. |

That is the only new npm dependency needed for v2.0.

### No New Libraries for Most Features

The following v2.0 features require NO new npm packages — they extend existing patterns:

| Feature | Implementation Approach | Why No New Library |
|---------|------------------------|-------------------|
| Signal connections | Extend tscn-parser.ts to read [connection] sections; write via godot_operations.gd | Signal connections are `[connection signal="X" from="A" to="B" method="C"]` entries appended to .tscn files — the existing parser handles nodes, the same pattern extends to connections |
| Scene instancing | Write via godot_operations.gd using `load("res://...").instantiate()` then `save_scene()` | PackedScene.instantiate() is a standard headless-compatible GDScript operation |
| Batch property operations | Extend godot_operations.gd `modify_node_property` to accept a `properties: Array[Dictionary]` param | Already one subprocess per property — batch version loops in GDScript, one subprocess total |
| Node groups | Extend tscn-parser.ts to read `groups` array in [node] headers; write via godot_operations.gd | Node groups are stored as `groups=["groupname"]` in the [node] header — existing parser structure handles this |
| Input action management | Modify project.godot via existing `modify_project_setting` pattern; keys use `input/action_name` format | Input map is stored in project.godot as `input/jump = {...}` — existing project settings write path handles this |
| Shader file management | Use Node.js `fs.writeFileSync` for .gdshader content; create ShaderMaterial .tres via godot_operations.gd | .gdshader files are plain text; ShaderMaterial .tres creation follows existing `create_resource` pattern |
| Headless export | Invoke `godot --headless --export-release <preset> <path>` via existing `execFile` in src/godot.ts | Export is a Godot CLI flag — same subprocess pattern as all other headless operations |
| Animation tools | Implement in godot_operations.gd using Animation + AnimationLibrary + AnimationPlayer GDScript API | AnimationLibrary.add_animation() and Animation.add_track() are headless-compatible; no external library needed |
| TileMap/TileSet operations | Implement in godot_operations.gd using TileMapLayer + TileSet + TileSetAtlasSource API | All tilemap classes are available in headless Godot; GDScript handles the complexity |

### DAP Integration Details

DAP (Debug Adapter Protocol) is Godot's runtime inspection mechanism. The approach mirrors the existing LSP client.

**Godot 4 DAP specifics (verified):**
- Default port: 6007 (Godot's editor debugger uses this port to communicate with the running project)
- Launch flag: `godot --dap-port <port>` — available in Godot 4.x editor builds (verified in /usr/bin/godot 4.6.1 --help)
- The game process listens on the DAP port when launched with `--debug-server tcp://127.0.0.1:6007` OR when launched by the editor's debug session
- Protocol: DAP over TCP, JSON framing (uses `Content-Length: N\r\n\r\n{json}` — identical to LSP)
- Capabilities: variable inspection, call stack, scene tree nodes (via custom Godot extensions to DAP), breakpoints
- Runtime inspection (not edit-mode) — scene tree data comes from the RUNNING game, not from .tscn files

**Implementation pattern:** Create `src/dap/client.ts` modeled after `src/lsp/client.ts`:
- TCP Socket (Node.js built-in `net`)
- Same Content-Length framing (reuse or extract `src/lsp/protocol.ts`)
- Connect to running game's DAP port
- Send `initialize` request, then query variables/scenetree
- Reuse `@vscode/debugprotocol` types for type-safe message construction

**@vscode/debugprotocol vs alternatives:**

| Option | Version | Verdict |
|--------|---------|---------|
| @vscode/debugprotocol | 1.68.0 | USE — actively maintained (2025), TypeScript types only, zero runtime overhead, published by Microsoft |
| node-debugprotocol-client | 0.5.1 | AVOID — last published 2023, no active maintenance, single author |
| vscode-debugprotocol (old name) | deprecated | AVOID — renamed to @vscode/debugprotocol |
| Roll own types | — | Acceptable but wasteful — @vscode/debugprotocol is small (type declarations only, ~50KB) |

---

## Hot-Reload: Research Finding (Significant Constraint)

**Finding:** Hot-reload of GDScript in a RUNNING game is NOT reliably achievable from an external tool in Godot 4.x. This affects the v2.0 feature scope.

**What Godot 4 actually does:**
- When Godot's EDITOR detects a changed .gd file on disk, it hot-reloads scripts into the running game via its internal editor-debugger protocol (port 6007)
- This works only when the game is launched FROM the Godot editor (not via `godot --path <project>` directly)
- External editors (VSCode, external tools) cannot reliably trigger this reload via any documented API

**Confirmed limitations (from official issue tracker):**
- `Synchronize Script Changes` does not work with external editors (Issue #72825)
- GDScript static variables do not update during hot-reload in 4.3+ (Issue #105667)
- No public signal or notification is emitted when hot-reload occurs (Proposal #9620 — open as of 2026-03)

**What IS achievable from this MCP server:**
- Write a new .gd file to disk (already works via fs.writeFileSync)
- Trigger the running Godot process to reload via the DAP `restartFrame` or `terminate` + relaunch pattern
- Full restart: stop the running project (existing `stop_project` tool) and restart it (existing `run_project` tool)

**Recommendation:** Implement hot-reload as "write file + restart project" rather than true in-process script injection. A true in-process hot-reload requires hooking into Godot's internal editor-debugger channel, which has no stable public API and changes between minor versions. Flag this in the roadmap as "soft hot-reload (restart) not live injection."

---

## TileMap API: Deprecation Notice

**Critical for implementation:** `TileMap` is deprecated in Godot 4.3+. New projects use `TileMapLayer` nodes directly.

| API | Status | Use |
|-----|--------|-----|
| TileMap | Deprecated (Godot 4.3+) | Read existing scenes; do not create new |
| TileMapLayer | Current | Use for all new tilemap creation |
| TileSet | Current (unchanged) | Shared resource referenced by TileMapLayer |
| TileSetAtlasSource | Current | Defines tile atlas; use for atlas-based tilesets |

**Impact:** The `add_tilemap_layer` and `configure_tileset` tools in v2.0 should target `TileMapLayer`, not `TileMap`. The tools must document this requirement so users know to use Godot 4.3+ projects.

---

## Headless Export: Requirements

**Exact CLI syntax (MEDIUM confidence — from official docs, not locally verified):**
```bash
# Export release build to a specific output path
godot --headless --path /path/to/project --export-release "Web" /output/game.html

# Export debug build
godot --headless --path /path/to/project --export-debug "Linux/X11" /output/game.x86_64

# Export PCK/ZIP only
godot --headless --path /path/to/project --export-pack "Windows Desktop" /output/game.pck
```

**Prerequisites (the tool must validate these before exporting):**
1. `export_presets.cfg` must exist in the project root — created when a user adds an export preset in the Godot editor. Without it, export fails with no useful error.
2. Export templates must be installed on the host machine — Godot downloads these separately from the engine binary. Location: `~/.local/share/godot/export_templates/<version>/` on Linux.
3. Preset name in the command must EXACTLY match the name in `export_presets.cfg` — case-sensitive.
4. Platform names changed between Godot versions: "Linux/X11" (4.2) → "Linux" (4.3+). Issue #89012.

**Implementation pattern:** The export tool reads `export_presets.cfg` to enumerate available presets (it is an INI file parseable with the existing project-parser.ts logic), then invokes `godot --headless --export-release <preset> <output>` via `execFile` with a longer timeout (exports can take 30-120 seconds for large projects vs the current 30s timeout).

---

## Animation API: GDScript Only (No TypeScript Library)

There is no npm library for Godot animation manipulation. All animation operations must go through `godot_operations.gd`.

**Verified GDScript API (MEDIUM confidence — from official Godot docs and forum examples):**
```gdscript
# Create an animation
var animation = Animation.new()
animation.length = 2.0  # seconds
animation.loop_mode = Animation.LOOP_LINEAR

# Add a property track
var track_index = animation.add_track(Animation.TYPE_VALUE)
animation.track_set_path(track_index, "Sprite2D:position")
animation.track_insert_key(track_index, 0.0, Vector2(0, 0))  # time, value
animation.track_insert_key(track_index, 1.0, Vector2(100, 0))

# Add to AnimationLibrary
var library = AnimationLibrary.new()
library.add_animation("walk", animation)

# Add library to AnimationPlayer
var player = get_node("AnimationPlayer")
player.add_animation_library("", library)  # "" is the default library
```

**Track types supported:** `TYPE_VALUE` (property), `TYPE_POSITION_3D`, `TYPE_ROTATION_3D`, `TYPE_SCALE_3D`, `TYPE_BLEND_SHAPE`, `TYPE_METHOD`, `TYPE_BEZIER`, `TYPE_AUDIO`, `TYPE_ANIMATION`

---

## Recommended Installation

```bash
# Only one new runtime dependency for v2.0
npm install @vscode/debugprotocol@^1.68.0

# No other new npm packages needed for v2.0 features
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| @vscode/debugprotocol (types only) | node-debugprotocol-client | Only if you want a pre-built client; but it's unmaintained (last 2023), making the existing LSP client pattern a better model |
| Custom TCP DAP client (mirror LSP client) | vscode-debugadapter npm package | vscode-debugadapter includes a full server-side implementation framework — wrong direction for us; we need a CLIENT |
| Write .gdshader as plain text via fs.writeFileSync | GDScript shader creation | GDScript can also create Shader resources; but plain text write is simpler and .gdshader files ARE plain text |
| export_presets.cfg parsing via project-parser.ts (INI) | New parser for export presets | export_presets.cfg is the same INI format as project.godot; existing parser handles it |
| "Restart" hot-reload (stop + start) | True DAP-based script injection | DAP script injection has no stable public API in Godot 4; restart approach is 100% reliable |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| node-debugprotocol-client | Unmaintained (2023), no other users on npm, 0.5.1 is the last version | @vscode/debugprotocol types + custom TCP client |
| chokidar or fs.watch for hot-reload | File watching is the wrong direction — Godot must be told to reload, not just detect the file changed; and Godot's internal reload from external changes is unreliable | Stop + restart the project process |
| Dedicated tilemap npm library | None exist for Godot; tilemap manipulation is GDScript-native | godot_operations.gd |
| Dedicated animation npm library | None exist for Godot; animation objects are headless-compatible GDScript resources | godot_operations.gd |
| @vscode/debugadapter | This is the SERVER-SIDE DAP implementation framework for building debug adapters — wrong role; we are a DAP CLIENT | @vscode/debugprotocol (types) + custom net.Socket client |
| puppeteer or playwright | These are browser automation tools; no relevance to Godot | None |
| gdtoolkit (Python) for new features | Already identified as dev-tool dependency; none of the v2.0 features require it specifically | godot_operations.gd for engine operations |

---

## Stack Patterns for v2.0

**For signal connections (read):**
- Extend `src/parsers/tscn-parser.ts` to parse `[connection ...]` entries at the end of .tscn files
- Return array of `{ signal, from, to, method, flags?, binds? }` objects
- `from` and `to` are node paths relative to scene root

**For signal connections (write):**
- Add `connect_signal` and `disconnect_signal` operations to `godot_operations.gd`
- Godot handles updating the .tscn file when `save_scene()` is called after `node.connect(signal, callable)`

**For DAP runtime inspection:**
- Create `src/dap/client.ts` and `src/dap/protocol.ts` (mirror `src/lsp/`)
- `src/dap/protocol.ts` — reuse or adapt the Content-Length framing from `src/lsp/protocol.ts` (DAP uses identical framing)
- `src/dap/client.ts` — TCP connect to port 6007 (use a non-conflicting alternate like 6008 for MCP server DAP to avoid editor conflict), send DAP `initialize`, then `threads` / `stackTrace` / `scopes` / `variables` requests
- Add `DapClient` to `ServerContext` alongside `LspClient`

**For headless export:**
- New tool module `src/tools/export.ts`
- Read `export_presets.cfg` to enumerate presets before calling export
- Validate export templates exist before attempting (check `~/.local/share/godot/export_templates/`)
- Use 120-second timeout (not the default 30s) for `execFile` — large projects take time

**For TileMapLayer operations:**
- New operations in `godot_operations.gd`: `create_tileset`, `add_tilemap_layer`, `set_tile`, `get_tileset_info`
- Always use `TileMapLayer` node type (never `TileMap` — deprecated)
- TileSet is a separate .tres resource; create with `create_resource` pattern then reference from TileMapLayer

**For batch property operations:**
- Extend `modify_node_property` operation in `godot_operations.gd` to accept `properties: Array[Dictionary]`
- No TypeScript changes needed — the existing `executeOperation` pass-through handles array params via JSON
- Reduces subprocess overhead from N subprocesses to 1 for N property changes

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| @vscode/debugprotocol@1.68.0 | TypeScript ^5.3.3 | Type declarations only; no runtime incompatibility possible |
| @vscode/debugprotocol@1.68.0 | Godot 4.6.1 DAP server | DAP spec 1.68 aligns with Godot's implementation; Godot implements a subset of DAP (not all requests) |
| Godot 4.6.1 --dap-port | All Godot 4.x versions | --dap-port was added in Godot 4.1 (PR #92336); verified present in 4.6.1 |
| Godot 4.6.1 --export-release | export_presets.cfg | Preset name in CLI must match cfg file exactly; platform names differ by Godot version (Linux vs Linux/X11) |
| TileMapLayer API | Godot 4.3+ | TileMapLayer added in 4.3; tool should document minimum Godot version 4.3 for tilemap features |

---

## Sources

- `/usr/bin/godot --help` (Godot 4.6.1.stable) — verified `--dap-port`, `--export-release`, `--export-debug`, `--export-pack`, `--headless` flags
- [Godot DAP Debug Server Issue #94227](https://github.com/godotengine/godot/issues/94227) — confirmed DAP port 6007, TCP address `127.0.0.1:6007`, `--debug-server` flag
- [Godot VSCode Plugin DAP DeepWiki](https://deepwiki.com/godotengine/godot-vscode-plugin/4-debugging) — TypeScript DAP implementation pattern (src/debugger/godot4/debug_session.ts), VariablesManager, scene tree inspection
- [@vscode/debugprotocol on npm](https://www.npmjs.com/package/@vscode/debugprotocol) — version 1.68.0, maintained by Microsoft, TypeScript declarations for DAP wire protocol
- [node-debugprotocol-client on npm](https://www.npmjs.com/package/node-debugprotocol-client) — confirmed unmaintained (last 2023, v0.5.1); rejected
- [Godot command line tutorial](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html) — export CLI syntax
- [Godot hot-reload Issue #72825](https://github.com/godotengine/godot/issues/72825) — confirmed external editor hot-reload does not work
- [Godot hot-reload Issue #105667](https://github.com/godotengine/godot/issues/105667) — confirmed static variable hot-reload broken in 4.3+
- [Godot TileMap deprecation — GameFromScratch](https://gamefromscratch.com/godot-tilemap-replaced-with-tilelayers/) — TileMap deprecated in 4.3, replaced by TileMapLayer
- [Godot TileMap Issue #89012](https://github.com/godotengine/godot/issues/89012) — platform name change "Linux/X11" → "Linux" in export presets (Godot 4.3)
- [Godot Forum: AnimationPlayer via code](https://forum.godotengine.org/t/adding-an-animation-to-the-animationplayer-via-code/50043) — GDScript Animation/AnimationLibrary API examples (MEDIUM confidence)
- [Godot InputMap docs](https://docs.godotengine.org/en/stable/classes/class_inputmap.html) — confirmed `add_action()`, `action_add_event()`, `has_action()` API; input map stored in project.godot as `input/action_name`
- [Godot AnimationLibrary docs](https://docs.godotengine.org/en/stable/classes/class_animationlibrary.html) — confirmed `add_animation()` API

---

*Stack research for: godot-mcp v2.0 new features*
*Researched: 2026-03-03*
