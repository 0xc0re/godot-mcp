# Godot MCP

[![](https://badge.mcpx.dev?type=server 'MCP Server')](https://modelcontextprotocol.io/introduction)
[![Made with Godot](https://img.shields.io/badge/Made%20with-Godot-478CBF?style=flat&logo=godot%20engine&logoColor=white)](https://godotengine.org)
[![](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white 'Node.js')](https://nodejs.org/en/download/)
[![](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white 'TypeScript')](https://www.typescriptlang.org/)
[![](https://img.shields.io/badge/License-MIT-red.svg 'MIT License')](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server for the Godot game engine: **68 tools across 16 domains** that let an AI assistant create, modify, run, debug, and export Godot 4.x projects.

> This is a hardened fork of [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp), maintained at [0xc0re/godot-mcp](https://github.com/0xc0re/godot-mcp). It extends the upstream server with a much larger tool surface, a test suite with CI, path-traversal hardening, and reliable failure reporting.

## Introduction

Godot MCP gives AI assistants (Claude Code, Cline, Cursor, and any other MCP client) a direct feedback loop with real Godot projects: compose scenes, wire signals, configure input maps, create shaders and animations, paint tilemaps, run the game, inspect the live scene tree, capture screenshots, run GUT tests, and export builds — all through a standardized interface.

## Tool Catalog

68 tools, grouped by source module (`src/tools/*.ts`). The authoritative roster is asserted by the registry smoke test in `tests/tool-registration.test.ts`.

### Editor & Process (`editor.ts`) — 5 tools

| Tool | Description |
|------|-------------|
| `launch_editor` | Open the Godot editor for a project |
| `run_project` | Run the project in debug mode and capture output (temporarily injects the runtime helper autoload — see [Runtime helper autoloads](#runtime-helper-autoloads)) |
| `get_debug_output` | Return the running process's captured stdout/stderr (bounded to the most recent 1000 lines). Optional `since_line` cursor fetches only new lines (responses carry `next_line`/`total_lines`/`truncated`), and `format: "structured"` returns parsed entries (script_error / push_error / push_warning / print / engine, with script, line, and stack). Default `format: "text"` with no cursor is byte-for-byte the legacy shape |
| `stop_project` | Stop the running project and return its final output |
| `capture_screenshot` | Capture the running game's viewport as a base64 PNG (auto-resized to 960×540) |

### Project (`project.ts`) — 5 tools

| Tool | Description |
|------|-------------|
| `get_godot_version` | Report the installed Godot version |
| `list_projects` | Find Godot projects in a directory (optionally recursive) |
| `get_project_info` | Project metadata: name, version, scene/script/asset structure |
| `read_project_settings` | Read project.godot as structured JSON |
| `modify_project_setting` | Set or update a project.godot setting |

### Scene (`scene.ts`) — 9 tools

| Tool | Description |
|------|-------------|
| `create_scene` | Create a new .tscn with a specified root node type |
| `add_node` | Add a node to an existing scene, with optional properties |
| `load_sprite` | Load a texture into a Sprite2D node |
| `export_mesh_library` | Export a 3D scene as a MeshLibrary resource for GridMap |
| `save_scene` | Save a scene, optionally to a new path (variant) |
| `read_scene` | Parse a .tscn headlessly into structured JSON |
| `modify_node_property` | Set a property on a node in a scene |
| `remove_node` | Remove a node from a scene by path |
| `attach_script` | Attach a GDScript file to a node |

### Resource (`resource.ts`) — 3 tools

| Tool | Description |
|------|-------------|
| `read_resource` | Parse a .tres resource headlessly into structured JSON |
| `create_resource` | Create a typed .tres resource with properties |
| `modify_resource` | Modify properties on an existing .tres resource |

### Script Intelligence (`script.ts`) — 3 tools

| Tool | Description |
|------|-------------|
| `validate_scripts` | Batch-validate GDScript files via `godot --check-only --headless` |
| `list_scripts` | List project scripts with their methods, properties, and signals |
| `query_class` | Query Godot's ClassDB for a class's API (methods, properties, signals, constants) |

### UID (`uid.ts`) — 2 tools (Godot 4.4+)

| Tool | Description |
|------|-------------|
| `get_uid` | Get the UID for a specific project file |
| `update_project_uids` | Update UID references by resaving project resources |

### Diagnostics (`diagnostics.ts`) — 2 tools

| Tool | Description |
|------|-------------|
| `get_diagnostics` | GDScript errors/warnings via the Godot LSP (auto-spawned headless editor) |
| `validate_scene` | Structural scene validation: missing resources, broken script/autoload references |

### Scene Composition (`composition.ts`) — 5 tools

| Tool | Description |
|------|-------------|
| `connect_signal` | Connect a signal between two nodes (persisted in the .tscn) |
| `disconnect_signal` | Remove a signal connection |
| `instance_scene` | Add a .tscn as an instanced child of another scene |
| `batch_set_properties` | Set multiple properties on multiple nodes in one Godot spawn |
| `manage_groups` | Add/remove nodes from groups (persisted in the .tscn) |

### Project Configuration (`config.ts`) — 9 tools

| Tool | Description |
|------|-------------|
| `add_input_action` | Add an input action with key/joypad bindings to project.godot |
| `remove_input_action` | Remove an input action |
| `list_input_actions` | List all configured input actions and bindings |
| `get_collision_layer_names` | Read named collision layers from project.godot |
| `set_collision_layer_names` | Name collision layers (all layers written in a single batched Godot spawn) |
| `set_node_collision` | Set a node's collision layer and mask (one batched scene save) |
| `list_autoloads` | List configured autoload singletons |
| `add_autoload` | Register an autoload singleton |
| `remove_autoload` | Remove an autoload singleton |

### Shader (`shader.ts`) — 3 tools

| Tool | Description |
|------|-------------|
| `create_shader` | Create a .gdshader file with a given shader_type and source |
| `create_shader_material` | Create a ShaderMaterial .tres referencing a shader |
| `set_shader_params` | Set shader parameters on a ShaderMaterial |

### Export (`export.ts`) — 3 tools

| Tool | Description |
|------|-------------|
| `export_project` | Headless export for a named preset, with pre-flight validation |
| `list_export_presets` | List presets from export_presets.cfg |
| `check_export_readiness` | Pre-flight check: presets, templates, and common export blockers |

### Animation (`animation.ts`) — 4 tools

| Tool | Description |
|------|-------------|
| `create_animation` | Create an Animation resource with value tracks and keyframes |
| `create_animation_library` | Create an AnimationLibrary containing named animations |
| `add_keyframes` | Add keyframes to an existing animation track |
| `assign_animation_library` | Assign an AnimationLibrary to an AnimationPlayer node |

### TileMap (`tilemap.ts`) — 2 tools

| Tool | Description |
|------|-------------|
| `create_tileset` | Create a TileSet resource with a TileSetAtlasSource (texture + tile size) |
| `paint_tilemap` | Paint, rectangle-fill, or clear cells on a TileMapLayer node |

### Runtime Interaction (`runtime.ts`) — 7 tools

| Tool | Description |
|------|-------------|
| `inspect_scene_tree` | Snapshot of the live scene tree from the running game |
| `inspect_node` | Property values of a node in the running game |
| `inspect_group` | All members of a group in the running game |
| `restart_project` | Stop-and-rerun cycle after script changes, with running confirmation |
| `send_input` | Inject a parameterized input event into the running game: an InputMap action press/release, a key event, or a mouse button event (structured params only — no free-form event data). Works headless: events flow through the Input singleton (action states update, `_input` fires); only window-dependent behavior (focus, mouse capture, position hit-testing) is inert |
| `invoke_runtime` | Call a method or set a property on a node in the running game — plain-identifier method + typed args array, or property path (e.g. `position:x`) + typed value; expression strings and script source are rejected by design (not an eval surface). `set_property` reads the value back as the engine accepted it |
| `wait_for` | Poll the running game until a structured condition spec is true or a timeout elapses (replaces guess-timing sleeps): `node_exists`, `property` comparison (eq/ne/gt/lt/ge/le, optional float tolerance), `group_count`, or `elapsed_frames`. Returns the observed value and poll count |

### Testing (`testing.ts`) — 1 tool

| Tool | Description |
|------|-------------|
| `run_tests` | Run the project's GUT (Godot Unit Test) suite headlessly |

### Scaffolding (`scaffold.ts`) — 5 tools

| Tool | Description |
|------|-------------|
| `scaffold_event_bus` | Generate an EventBus autoload singleton |
| `scaffold_config_manager` | Generate a ConfigFile-based settings/persistence autoload |
| `scaffold_resource_class` | Generate a custom Resource class |
| `scaffold_tests` | Generate GUT test skeletons |
| `scaffold_health_component` | Generate a reusable health component |

All scaffold tools refuse to overwrite existing files unless `overwrite: true` is passed.

## Requirements

- [Godot Engine](https://godotengine.org/download) 4.x installed on your system
- Node.js >= 18 and npm
- An MCP-capable AI assistant (Claude Code, Cline, Cursor, ...)

## Installation and Configuration

### Step 1: Install and Build

```bash
git clone https://github.com/0xc0re/godot-mcp.git
cd godot-mcp
npm install
npm run build
```

### Step 2: Configure Your AI Assistant

#### Option A: Claude Code (`.mcp.json`)

Create a `.mcp.json` file in the project where you want to use the server (this repo gitignores its own `.mcp.json` because the file contains machine-specific absolute paths):

```json
{
  "mcpServers": {
    "godot-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/godot-mcp/build/index.js"]
    }
  }
}
```

Or register it globally:

```bash
claude mcp add godot-mcp -- node /absolute/path/to/godot-mcp/build/index.js
```

#### Option B: Cline

Add to your Cline MCP settings file (`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "godot": {
      "command": "node",
      "args": ["/absolute/path/to/godot-mcp/build/index.js"],
      "env": {
        "DEBUG": "true"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

#### Option C: Cursor

**Using the Cursor UI:**

1. Go to **Cursor Settings** > **Features** > **MCP**
2. Click **+ Add New MCP Server**
3. Name: `godot`, Type: `command`, Command: `node /absolute/path/to/godot-mcp/build/index.js`
4. Click "Add", then refresh the MCP server card to populate the tool list

**Using project-specific configuration** — create `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "godot": {
      "command": "node",
      "args": ["/absolute/path/to/godot-mcp/build/index.js"]
    }
  }
}
```

### Environment Variables

| Variable | Effect |
|----------|--------|
| `GODOT_PATH` | Path to the Godot executable (overrides automatic detection) |
| `GODOT_DEBUG` | Set to `true` to pass `--debug-godot` to Godot operation spawns (verbose engine output) |
| `LOG_LEVEL` | Server log level: `debug`, `info` (default), `warn`, or `error` |
| `DEBUG` | Set to `true` for `debug`-level server logging (legacy alias for `LOG_LEVEL=debug`) |

## Running the Server

- `./start.sh` (or `npm start`) — rebuild and (re)launch the server, replacing any previous instance from this checkout
- `npm run inspector` — interactive tool debugging via the MCP Inspector

## Development

```bash
npm test          # run the full Vitest suite once
npm run test:watch  # watch mode
npm run typecheck # tsc --noEmit over src/ and tests/
npm run build     # compile to build/ and copy the GDScript payloads
```

CI (GitHub Actions) runs typecheck → build → test on Node 20 and 22 for every push and pull request. See [CONTRIBUTING.md](CONTRIBUTING.md) for test conventions.

## Architecture

The server is a thin TypeScript layer (stdio MCP transport) over headless Godot invocations, organized as 16 tool modules under `src/tools/` registered against a shared `ServerContext`.

**Reads in TypeScript, writes through Godot.** Reading scenes, resources, and project settings uses bundled parsers (`src/parsers/`) — fast, no subprocess. Mutations run through a single bundled GDScript file (`src/scripts/godot_operations.gd`) invoked headlessly with the operation name and JSON parameters, so Godot itself serializes every write with correct types. No temporary script files are ever generated.

**Three-tier operation verdicts.** Every GDScript operation's outcome is judged by `runOperation()` in priority order:

1. **Trailing JSON** (authoritative) — the last stdout line parsing as JSON with a `success`/`error` key
2. **Exit code** — non-zero exit fails the operation, using the last stderr line as the error
3. **Stderr markers** — `[ERROR]` / `SCRIPT ERROR:` / `Failed to` lines fail an otherwise clean exit

All failure paths inside `godot_operations.gd` go through a shared `fail()` helper that prints failure JSON *and* exits 1, so failures are visible both to this server and to anything scripting the CLI directly.

**Path hardening.** All path parameters are validated (`validatePath`: rejects empty, null bytes, `..`), and project-relative file parameters are additionally resolved through `resolveWithinProject()`, which realpaths the project root, resolves the candidate against it, and rejects anything that escapes — including via symlinks. MCP resource reads (`godot://...`) are containment-checked the same way.

**Shared tool preamble.** Every project-scoped tool handler is wrapped in `withProject()`, which validates paths, verifies `project.godot` exists, and standardizes catch-all error responses — one implementation instead of ~50 copies.

**Process hygiene.** Operation spawns get a 10MB output buffer and a 30s timeout (with per-operation overrides for known-slow operations like `update_project_uids` and `export_mesh_library`). Spawned game processes are tracked and cleaned up on server shutdown, and their captured stdout/stderr are bounded windows: only the most recent 1000 lines are retained. Multi-write operations (collision layer names, node collision layer+mask) are batched into a single Godot spawn to avoid partial writes.

### Runtime helper autoloads

The runtime interaction tools (`inspect_scene_tree`, `inspect_node`, `inspect_group`, `send_input`, `invoke_runtime`, `wait_for`) and `capture_screenshot` talk to the running game through a single helper autoload (`RuntimeHelper`) using file-polling IPC. Screenshot capture is one more command on the same channel — there is no separate screenshot helper.

`run_project` (and `restart_project`) **temporarily injects this helper**: it copies `runtime_helper.gd` into `.godot/mcp/` inside your project (the `.godot/` directory is Godot's own cache territory and is never committed) and adds the `RuntimeHelper` autoload entry to `project.godot`. On `stop_project` — or when the game process exits or errors — the previous `project.godot` state is **restored automatically**: the entry is removed, or if your project already had its own `RuntimeHelper` autoload, that value is put back. No manual setup, no permanent footprint.

If the server dies without cleanup (e.g. `kill -9`), the stale entry is harmless and self-heals: the next `run_project` detects an entry pointing at `.godot/mcp/runtime_helper.gd` as its own leftover, refreshes it, and removes it on the next stop — a duplicate is never written. To opt out entirely, pass `inject_helpers: false` to `run_project` (the runtime tools then require the game to provide its own `RuntimeHelper`).

Note: `capture_screenshot` needs a rendering surface — a game launched headless returns a structured "not supported in headless mode" error instead of an image.

## Behavior Changes in 0.2.0

If you are upgrading from 0.1.x or scripting the server/CLI directly, note these intentional changes:

- **Failures now exit 1.** Previously, many GDScript operations (`modify_node_property`, `remove_node`, `attach_script`, `save_scene`, `load_sprite`, `create_scene`, `add_node`, and others) reported failure only on stderr and exited 0 — some tools reported *success* on failed operations. All failure paths now print `{"success": false, "error": ...}` JSON and exit 1. Anything invoking `godot_operations.gd` directly and checking `$?` will now see failures it previously missed.
- **`export_mesh_library` with no valid meshes now fails** (exit 1) instead of silently writing nothing and reporting success.
- **`get_debug_output` is bounded**: it returns the most recent 1000 lines of output/errors rather than the full unbounded history. New optional params are additive: `since_line` (incremental cursor; responses gain `next_line`/`total_lines`/`truncated`) and `format: "structured"` (parsed error/warning entries) — a call with neither returns the legacy shape byte-for-byte.
- **`capture_screenshot`** resize now runs a static, packaged GDScript (`resize_image.gd`) instead of generating a temp script at runtime, and the runtime helper is injected temporarily on `run_project` (see above) instead of requiring manual autoload setup.
- **Debug flags are opt-in**: the `--debug-godot` engine flag is only added when `GODOT_DEBUG=true` (it was previously always on), and server debug logging is gated by `LOG_LEVEL`/`DEBUG`.
- **`save_scene` with `new_path: ""`** (empty string) now returns an `Invalid path` error instead of silently saving to the original path. Omit `new_path` entirely to save in place.
- **Version is single-sourced**: the server reports the version from `package.json` (0.2.0).

## Example Prompts

```text
"Launch the Godot editor for my project at /path/to/project"

"Run my Godot project and show me any errors"

"Create a Player scene with a CharacterBody2D root, add a Sprite2D and a CollisionShape2D, and attach player.gd"

"Connect the body_entered signal from Spike to the player's _on_spike_hit method"

"Add a 'jump' input action bound to Space and the A button on a gamepad"

"Create a 16x16 tileset from atlas.png and paint a floor across the bottom of Level1"

"Create a walk animation cycling the sprite's frame property, and assign it to the AnimationPlayer"

"Run the project, then show me the live scene tree and the player's velocity"

"Take a screenshot of the running game"

"Run my GUT tests and summarize the failures"

"Check export readiness and export the Linux build"
```

## Troubleshooting

- **Godot Not Found**: Set the `GODOT_PATH` environment variable to your Godot executable
- **Connection Issues**: Ensure the server is running (`./start.sh`) and restart your AI assistant
- **Invalid Project Path**: Ensure the path points to a directory containing a `project.godot` file
- **Build Issues**: Run `npm install` then `npm run build`; verify `build/scripts/` contains the three `.gd` files
- **Runtime inspection times out**: The helper autoload is injected by `run_project` — the game process must be started via `run_project` (not externally, and not with `inject_helpers: false`) for `inspect_*`/`capture_screenshot` to respond
- **Cursor specifically**: Ensure the server is enabled in Settings > MCP; MCP tools require the Agent chat profile

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

Forked from [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp) (MIT).
