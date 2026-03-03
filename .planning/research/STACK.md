# Stack Research

**Domain:** MCP server for game engine integration (Godot 4.x)
**Researched:** 2026-03-03
**Confidence:** HIGH (MCP SDK and Godot verified against installed binaries and official sources)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| @modelcontextprotocol/sdk | 1.27.1 | MCP protocol implementation | Current stable; 0.6.0 is 21+ major/minor versions behind; Claude Code tool-discovery failure is caused by outdated SDK versions that fail protocol handshake with spec version "2025-11-25" |
| zod | 3.25.x or 4.x | Schema validation for tool inputs | Required peer dependency of MCP SDK 1.x; SDK internally imports from zod/v4 but supports both v3.25+ and v4 APIs; tool input schemas are defined with z.object() |
| TypeScript | 5.9.3 | Type safety, transpilation | Latest stable; existing codebase uses 5.3.3 which still works but upgrade is cheap and adds newer type features |
| Node.js | >=18.0.0 (20 LTS recommended) | Runtime | Existing constraint; Node 20 LTS has globalThis.crypto built-in which MCP SDK auth helpers require; Node 18 needs a polyfill for those |
| Godot Engine | 4.6.1 (host-installed) | Game engine being controlled | Current stable as of February 2026; server must support any 4.x version the user has installed |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @fernforestgames/godot-resource-parser | 0.1.3 | Parse .tscn and .tres files in Node.js | Use when implementing scene/resource read and inspection tools; zero dependencies, TypeScript-native, full Godot 4 type support including Vector2/3/4, Color, Transform2D/3D |
| fs-extra | 11.2.0 | Enhanced filesystem utilities | Already present; keep for build scripts; do NOT use in the runtime server code where native fs is sufficient |
| @modelcontextprotocol/inspector | 0.21.1 | Development debugging of MCP servers | Dev only; run with `npx @modelcontextprotocol/inspector build/index.js` to interactively test tools and verify Claude Code protocol compatibility |

Libraries to remove:
| Library | Current Version | Why Remove |
|---------|----------------|------------|
| axios | 1.7.9 | Imported but unused in current codebase; adds 50KB+ to package; native fetch (Node 18+) handles any HTTP needs |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| TypeScript compiler (tsc) | Transpile TypeScript to JavaScript | Target ES2022, module ESNext; existing tsconfig is correct |
| @types/node | 25.3.3 | Node.js type definitions | Upgrade from 20.11.24 to 25.x for accuracy with Node 20+ APIs |
| MCP Inspector | Interactive testing of server tools | `npm run inspector` — essential for verifying Claude Code compatibility before deployment |

## Installation

```bash
# Upgrade MCP SDK and add zod as explicit dependency
npm install @modelcontextprotocol/sdk@^1.27.1 zod@^3.25.0

# Add Godot resource parser for .tscn/.tres support
npm install @fernforestgames/godot-resource-parser@^0.1.3

# Remove unused dependency
npm uninstall axios

# Upgrade dev dependencies
npm install -D typescript@^5.9.3 @types/node@^25.3.3
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| @modelcontextprotocol/sdk 1.27.1 | Stay on 0.6.0 | Never — 0.6.0 is the direct cause of Claude Code tool-discovery failures; upgrading the SDK is the first and most critical task |
| McpServer class (high-level) | Server class (low-level) | Use low-level Server only if you need to intercept raw protocol messages or implement custom protocol extensions; for standard tool serving, McpServer is simpler and better maintained |
| registerTool() method | server.tool() method | server.tool() is marked @deprecated in 1.27.1 type definitions; use registerTool() for all new code going forward |
| zod 3.25+ (peer dep) | Write JSON Schema manually | MCP SDK 1.x requires zod; manual schemas bypass type safety and break SDK validation helpers |
| @fernforestgames/godot-resource-parser | Custom .tscn parser | Build a custom parser only if you need write support (the library is read-only); for read/inspect use cases, the library is correct |
| execFile for process spawning | exec for process spawning | execFile is already used and prevents shell injection; do not regress to exec |
| gdtoolkit (Python CLI) | Custom GDScript parser in TS | gdlint and gdformat are Python-only (PyPI: gdtoolkit 4.5.0); invoke via execFile if they are available on the host; no Node.js equivalent exists |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| server.tool() (old API) | Marked @deprecated in SDK 1.27.1; will be removed in v2; all overloads log deprecation warnings | McpServer.registerTool() |
| console.log() for debug output | Writing to stdout corrupts the JSON-RPC protocol stream for stdio transport; this is a hard protocol failure, not a subtle bug | console.error() or process.stderr.write() for all debug and log output |
| SSE transport | Legacy transport deprecated in MCP spec 2025-11-25; Claude Code uses stdio for local servers | StdioServerTransport |
| Streamable HTTP transport | Adds network stack complexity with no benefit for a locally-installed tool server | StdioServerTransport |
| zod@<3.25 | SDK 1.27.1 peer dependency explicitly requires ^3.25 || ^4.0; older zod versions cause runtime failures | zod@^3.25.0 or zod@^4.0.0 |
| axios | Already in the codebase but unused; fetching remote resources is not a current requirement | Native fetch (Node 18+) if HTTP is ever needed |

## Stack Patterns by Variant

**For tool modules (scene tools, script tools, project tools, etc.):**
- Export a function that accepts an `McpServer` instance and registers tools onto it
- Keep tool registration separate from tool implementation (handler logic in separate files)
- Because this enables the modular refactor of the monolithic index.ts without changing the external API

**For Godot process interaction:**
- Use execFile (already in codebase via the existing execFileNoThrow pattern) — not the shell exec variant
- Because execFile prevents shell injection; the existing security-hardened pattern is correct

**For .tscn and .tres file operations:**
- Use `@fernforestgames/godot-resource-parser` for reading scenes and resources
- Write modifications back as strings following the Godot text scene format specification
- Because Godot's text scene format has enough quirks (ExtResource refs, SubResource IDs, property ordering) that a tested parser beats regex

**For GDScript static analysis:**
- Invoke `gdlint` and `gdformat` (from Python `gdtoolkit` 4.5.0) via execFile if they are available on the host
- Fall back gracefully if not installed — these are optional developer tools
- Because there is no Node.js GDScript parser; the Python CLI tools are the ecosystem standard

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| @modelcontextprotocol/sdk@1.27.1 | zod@^3.25 OR zod@^4.0 | SDK internally uses zod/v4 but accepts either in user schemas; do NOT use zod@<3.25 |
| @modelcontextprotocol/sdk@1.27.1 | Node.js >=18 | Node 18 works; Node 20 LTS preferred (no globalThis.crypto polyfill needed for optional auth features) |
| @modelcontextprotocol/sdk@0.6.0 | Claude Code (current) | INCOMPATIBLE — protocol version mismatch causes tool list to never be sent to Claude Code; this is the primary bug to fix |
| TypeScript@5.9.3 | Node.js 18/20 | Fully compatible; tsconfig targeting ES2022 with ESNext modules is correct for this setup |
| @fernforestgames/godot-resource-parser@0.1.3 | Godot 4.x .tscn/.tres files | Read-only; supports all Godot 4 value types; does NOT support Godot 3.x format |
| Godot 4.6.1 (on this machine) | All existing MCP server logic | Confirmed installed at /usr/bin/godot; --headless flag confirmed available; -s/--script flag available in editor builds |

## Key Godot 4.6 CLI Flags (Verified Against Installed Binary at /usr/bin/godot)

These are the flags the MCP server uses or should use, verified directly from `godot --help` (v4.6.1.stable):

| Flag | Category | Notes |
|------|----------|-------|
| `--headless` | Run options | Shorthand for `--display-driver headless --audio-driver Dummy`; use for all background execution |
| `-s, --script <script>` | Standalone tools | Run a GDScript file; requires X (editor or export template with path overrides) build |
| `--check-only` | Standalone tools | Parse script for errors and quit without running; combine with `--script` for GDScript validation |
| `--path <directory>` | Run options | Set project path; directory must contain `project.godot` |
| `--scene <path>` | Run options | Launch a specific scene by file path or UID |
| `--quit` | Run options | Quit after first iteration; use for one-shot operations |
| `--quit-after <int>` | Run options | Quit after N iterations; more reliable than `--quit` for import operations (Godot 4.2 bug: use `--quit-after 2` minimum) |
| `--editor` | Run options | Start editor mode (E: editor builds only) |
| `--import` | Standalone tools | Start editor, wait for all resources to import, then quit (E: editor builds only) |
| `--gdscript-docs <path>` | Standalone tools | Generate API reference from GDScript inline docs |
| `-d, --debug` | Debug options | Enable local stdout debugger |
| `-b, --breakpoints` | Debug options | Set breakpoints as source::line comma-separated pairs |
| `--lsp-port <port>` | Run options | GDScript Language Server Protocol port |
| `--dap-port <port>` | Run options | GDScript Debug Adapter Protocol port |

**Important constraint:** The `-s/--script` flag is marked `X` — available in editor builds and export templates compiled with `disable_path_overrides=false`. Standard Godot desktop downloads are editor builds, so this works for the MCP use case. Dedicated server builds distributed without editor components may lack this flag.

**Known issue:** The interactive debugger activates on GDScript parse/compile errors in headless mode, blocking process exit. When using `--script --check-only` for validation, a proposal exists (#13048) for structured error output mode, but it is not yet implemented. Mitigation: pipe stderr and apply a timeout to the execFile call.

## Sources

- npm registry `npm info @modelcontextprotocol/sdk` — confirmed 1.27.1 is latest, 76 versions published since 0.4.0
- MCP SDK 1.27.1 package extracted locally — confirmed `registerTool()` is current API; `server.tool()` all overloads are @deprecated
- MCP SDK README (v1.27.1 via tar extract) — confirmed McpServer is recommended high-level class; Server is low-level for advanced use; zod is required peer dep
- Godot 4.6.1 binary at /usr/bin/godot — all CLI flags verified directly from `godot --help` output
- npm: `npm info zod version` — confirmed zod latest is 4.3.6; peer dep range ^3.25 || ^4.0 covers both
- npm: `npm info typescript version` — confirmed TypeScript latest is 5.9.3
- npm: `npm info @types/node version` — confirmed @types/node latest is 25.3.3
- WebSearch verification: Claude Code MCP tools-not-appearing issue — confirmed root cause is protocol version mismatch from old SDK; SDK 1.x resolves this
- GitHub: fernforestgames/godot-resource-parser — confirmed @fernforestgames/godot-resource-parser v0.1.3, TypeScript-native, zero dependencies, released 2026-01-01
- WebSearch: MCP stdio transport best practices — confirmed console.log to stdout corrupts JSON-RPC stream; all logs must go to stderr
- WebSearch: gdtoolkit PyPI — confirmed Python-only, latest 4.5.0; no Node.js equivalent

---
*Stack research for: MCP server for Godot Engine (godot-mcp upgrade)*
*Researched: 2026-03-03*
