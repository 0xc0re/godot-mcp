# Codebase Structure

**Analysis Date:** 2026-03-03

## Directory Layout

```
godot-mcp/
├── src/                        # TypeScript source (compiled to build/)
│   ├── index.ts                # Entry point: MCP server bootstrap
│   ├── server.ts               # ServerContext factory
│   ├── types.ts                # Shared TypeScript interfaces
│   ├── godot.ts                # Godot process utilities (exec, detect, track)
│   ├── errors.ts               # Structured error response helpers
│   ├── tools/                  # MCP tool domain modules (one file per concept)
│   │   ├── editor.ts           # launch_editor, run_project, stop_project, get_debug_output, capture_screenshot
│   │   ├── project.ts          # get_godot_version, list_projects, get_project_info, read_project_settings, modify_project_setting
│   │   ├── scene.ts            # create_scene, add_node, load_sprite, export_mesh_library, save_scene, read_scene, modify_node_property, remove_node, attach_script
│   │   ├── script.ts           # validate_scripts, list_scripts, query_class
│   │   ├── resource.ts         # read_resource, create_resource
│   │   ├── uid.ts              # get_uid, update_project_uids
│   │   └── diagnostics.ts      # get_diagnostics (LSP-based)
│   ├── parsers/                # In-process parsers for Godot file formats
│   │   ├── tscn-parser.ts      # .tscn and .tres file parser
│   │   ├── tscn-types.ts       # Types: ParsedScene, ParsedResource, SceneNode, etc.
│   │   ├── project-parser.ts   # project.godot INI-format parser
│   │   └── project-types.ts    # Types: ParsedProjectSettings
│   ├── lsp/                    # Language Server Protocol TCP client
│   │   ├── client.ts           # LspClient class: connect, getDiagnostics, disconnect
│   │   └── protocol.ts         # JSON-RPC framing: encodeMessage, parseMessages
│   ├── resources/              # MCP resource registrations
│   │   └── godot-resources.ts  # godot://scene/{path} and godot://script/{path} templates
│   └── scripts/                # GDScript files bundled with the server
│       ├── godot_operations.gd # Headless Godot dispatch script (all write operations)
│       └── screenshot_helper.gd# User autoload for viewport screenshot capture
├── build/                      # Compiled output (generated, committed for distribution)
│   ├── index.js                # Compiled entry point (executable)
│   ├── server.js
│   ├── godot.js
│   ├── errors.js
│   ├── types.js
│   ├── tools/                  # Compiled tool modules
│   ├── parsers/                # Compiled parser modules
│   ├── lsp/                    # Compiled LSP modules
│   ├── resources/              # Compiled resource modules
│   └── scripts/                # Copied (not compiled) GDScript files
│       ├── godot_operations.gd
│       └── screenshot_helper.gd
├── tests/                      # Vitest test suite
│   ├── *.test.ts               # One test file per src module/domain
│   └── fixtures/               # Static test fixture files
│       ├── sample.tscn         # Minimal Godot scene file
│       ├── sample.tres         # Minimal Godot resource file
│       └── sample.project.godot# Minimal project.godot file
├── scripts/                    # Build utility scripts
│   └── build.js                # Post-tsc: chmod index.js, copy .gd files to build/
├── .planning/                  # GSD planning artifacts (not shipped)
│   ├── codebase/               # Codebase analysis documents
│   ├── milestones/             # Milestone definitions
│   ├── phases/                 # Phase execution documents
│   └── research/               # Research notes
├── .github/                    # GitHub Actions workflows
├── package.json                # NPM manifest; bin: godot-mcp → build/index.js
├── tsconfig.json               # TypeScript: ES2022, nodenext, rootDir=src, outDir=build
├── vitest.config.ts            # Vitest test configuration
├── start.sh                    # Dev convenience: npm run build && node build/index.js
├── .mcp.json                   # Local MCP server config (points to build/index.js)
└── .gitignore                  # Ignores node_modules, .env files
```

## Directory Purposes

**`src/`:**
- Purpose: All TypeScript source code
- Contains: Entry point, utilities, tool domains, parsers, LSP client, MCP resources, GDScript scripts
- Key files: `src/index.ts` (bootstrap), `src/types.ts` (shared interfaces), `src/godot.ts` (process utilities)

**`src/tools/`:**
- Purpose: One file per Godot concept domain, each registering 1–9 MCP tools
- Contains: Tool handler functions, Zod schema definitions, domain-specific helpers
- Key files: `src/tools/scene.ts` (largest, 9 tools), `src/tools/editor.ts` (process management)

**`src/parsers/`:**
- Purpose: Fast, in-process TypeScript parsers that avoid spawning Godot processes for read-only file operations
- Contains: Parsers for `.tscn`, `.tres`, and `project.godot` formats; type definitions for parsed output
- Key files: `src/parsers/tscn-parser.ts`, `src/parsers/project-parser.ts`

**`src/lsp/`:**
- Purpose: TCP-based Language Server Protocol client for Godot's built-in GDScript language server
- Contains: Connection management, initialize handshake, diagnostics retrieval, JSON-RPC wire framing
- Key files: `src/lsp/client.ts` (primary interface), `src/lsp/protocol.ts` (message codec)

**`src/resources/`:**
- Purpose: MCP resource registrations exposing Godot project files for `@mention` context in LLM sessions
- Contains: `godot://scene/{path}` and `godot://script/{path}` URI template handlers
- Key files: `src/resources/godot-resources.ts`

**`src/scripts/`:**
- Purpose: GDScript files that ship with the MCP server and are executed in Godot's headless mode
- Contains: `godot_operations.gd` (main dispatch script for all engine operations), `screenshot_helper.gd` (user autoload)
- Note: These files are NOT compiled by TypeScript; they are copied verbatim to `build/scripts/` by `scripts/build.js`

**`build/`:**
- Purpose: Compiled and bundled distribution output
- Generated: Yes (by `npm run build` = `tsc && node scripts/build.js`)
- Committed: Yes (the `"files": ["build"]` in `package.json` ships this via npm)

**`tests/`:**
- Purpose: Vitest test suite covering all tool domains, parsers, LSP client, and error handling
- Contains: One test file per area, fixtures for file-parsing tests
- Key files: `tests/fixtures/sample.tscn`, `tests/fixtures/sample.project.godot`

**`scripts/`:**
- Purpose: Build infrastructure scripts run after TypeScript compilation
- Contains: `build.js` — makes `build/index.js` executable and copies `.gd` scripts to `build/scripts/`

## Key File Locations

**Entry Points:**
- `src/index.ts`: MCP server bootstrap (compiled to `build/index.js`, the npm binary)
- `src/scripts/godot_operations.gd`: GDScript entry point invoked by all headless operations

**Configuration:**
- `tsconfig.json`: TypeScript compiler config (ES2022, NodeNext modules, strict mode)
- `vitest.config.ts`: Test runner configuration
- `package.json`: NPM manifest, dependencies, bin entry, engine requirements
- `.mcp.json`: Local MCP server registration for development use

**Core Logic:**
- `src/godot.ts`: All Godot process interaction (path detection, execution, tracking)
- `src/types.ts`: Shared `ServerContext`, `GodotProcess`, `OperationParams` interfaces
- `src/errors.ts`: `toolError()` — the standard error response pattern

**Tool Implementations:**
- `src/tools/scene.ts`: Scene manipulation tools (9 tools, largest file)
- `src/tools/editor.ts`: Editor/process lifecycle tools
- `src/tools/diagnostics.ts`: GDScript diagnostics via LSP

**Parsers:**
- `src/parsers/tscn-parser.ts`: Parses `.tscn`/`.tres` files into `ParsedScene`/`ParsedResource`
- `src/parsers/project-parser.ts`: Parses `project.godot` into `ParsedProjectSettings`

**Testing:**
- `tests/*.test.ts`: All tests, co-located in one `tests/` directory (not co-located with source)
- `tests/fixtures/`: Static file fixtures for parser and tool tests

## Naming Conventions

**Files:**
- Tool domains: `kebab-case.ts` matching the Godot concept (e.g. `scene.ts`, `project.ts`, `diagnostics.ts`)
- Parsers: `{format}-parser.ts` and `{format}-types.ts` pairs (e.g. `tscn-parser.ts`, `tscn-types.ts`)
- Tests: `{domain}-{area}.test.ts` (e.g. `scene-tools.test.ts`, `lsp-client.test.ts`, `project-parser.test.ts`)
- GDScript: `snake_case.gd` (e.g. `godot_operations.gd`, `screenshot_helper.gd`)

**Directories:**
- Lowercase, singular: `tools/`, `parsers/`, `lsp/`, `resources/`, `scripts/`

**Exports:**
- Tool registration functions: `registerXxxTools(server, ctx)` pattern (e.g. `registerSceneTools`, `registerEditorTools`)
- Parsers: `parseScene()`, `parseResource()`, `parseProjectSettings()` — named exports, no classes
- LSP: `LspClient` class, `encodeMessage()`, `parseMessages()` named exports

**MCP Tool Names:**
- `snake_case` verbs: `create_scene`, `add_node`, `read_project_settings`, `get_diagnostics`
- Follow the pattern `{verb}_{noun}` or `{verb}_{noun}_{qualifier}`

## Where to Add New Code

**New MCP Tool:**
- Add handler to the appropriate existing domain file in `src/tools/` (e.g. `src/tools/scene.ts` for scene operations)
- If it's a genuinely new domain, create `src/tools/{domain}.ts` with a `registerXxxTools(server, ctx)` export
- Register in `src/index.ts` by calling `registerXxxTools(server, ctx)`
- If the tool requires Godot engine execution, add the GDScript handler to `src/scripts/godot_operations.gd` and add the operation name to the `match` block
- Add test file `tests/{domain}-tools.test.ts`

**New File Parser:**
- Create `src/parsers/{format}-parser.ts` and `src/parsers/{format}-types.ts`
- Export a `parse{Format}()` function; no classes
- Add test file `tests/{format}-parser.test.ts`
- Add fixture files to `tests/fixtures/`

**New Utility:**
- Shared process utilities: add to `src/godot.ts`
- New shared type: add to `src/types.ts`
- Error handling helper: add to `src/errors.ts`

**New LSP Capability:**
- Extend `src/lsp/client.ts` with new methods on `LspClient`
- If new message types are needed, update `src/lsp/protocol.ts`

## Special Directories

**`build/`:**
- Purpose: Compiled JavaScript output + copied GDScript files; this is what npm ships
- Generated: Yes, by `npm run build`
- Committed: Yes — needed for npm distribution and `.mcp.json` local dev usage

**`tests/fixtures/`:**
- Purpose: Static sample Godot files for parser and tool tests
- Generated: No — hand-crafted minimal valid files
- Committed: Yes

**`.planning/`:**
- Purpose: GSD planning system artifacts — phase plans, research notes, codebase analysis
- Generated: Partially (by GSD planning commands)
- Committed: Yes

---

*Structure analysis: 2026-03-03*
