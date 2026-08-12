# External Integrations

**Analysis Date:** 2026-03-03

## APIs & External Services

**Model Context Protocol (MCP):**
- The server implements the MCP specification — it IS an integration point for AI clients (Claude Desktop, Claude Code, Cline, etc.)
- SDK/Client: `@modelcontextprotocol/sdk` ^1.27.1
- Transport: stdio (reads from stdin, writes to stdout per MCP spec)
- Inspector: `npx @modelcontextprotocol/inspector build/index.js` (dev tool)
- Configuration example in `.mcp.json`: `{ "mcpServers": { "godot-mcp": { "command": "node", "args": ["/path/to/build/index.js"] } } }`

**Godot Game Engine (local process):**
- The primary external integration — all tools shell out to the Godot executable
- Auth: None (local binary, path resolved from `GODOT_PATH` env or auto-detected)
- Interaction modes:
  1. `execFile` (sync, 30s timeout, 10MB buffer) — `--version`, `--headless --script` operations
  2. `spawn` (async, long-running) — editor launch, project run, screenshot resize
  3. TCP socket to LSP port — diagnostics tool connects to Godot's language server on port 6014

## Data Storage

**Databases:**
- None. No database of any kind.

**File Storage:**
- Local filesystem only. Reads and writes Godot project files directly:
  - `.tscn` (scene files) — read by `src/parsers/tscn-parser.ts`, written via Godot headless
  - `.tres` (resource files) — read by `src/parsers/tscn-parser.ts` (`parseResource`), written via Godot headless
  - `project.godot` (INI-format settings) — read by `src/parsers/project-parser.ts`, written via Godot headless
  - `.gd` (GDScript files) — read directly for LSP diagnostics
  - `.godot/screenshot_trigger` — temp trigger file for screenshot IPC
  - `.godot/screenshot.png` — temp output file for screenshot capture

**Caching:**
- In-memory path validation cache only (`Map<string, boolean>` in `ServerContext.validatedPaths`)

## Authentication & Identity

**Auth Provider:**
- None. The server runs as a local stdio process with no auth, users, or sessions.

## Monitoring & Observability

**Error Tracking:**
- None. No external error tracking service.

**Logs:**
- All logging uses `console.error()` (safe for stdio transport — stdout is reserved for MCP protocol)
- Log prefixes: `[MCP Error]`, `[SERVER]`, `[DEBUG]`
- Debug mode: set `DEBUG=true` env var to enable `[DEBUG]` messages in `src/godot.ts` and `src/tools/editor.ts`

## CI/CD & Deployment

**Hosting:**
- Published to npm as `godot-mcp` package (homepage: https://github.com/Coding-Solo/godot-mcp)
- No cloud hosting — runs entirely on user's local machine

**CI Pipeline:**
- No CI configuration found. Only `.github/FUNDING.yml` exists; no workflow files.

## Environment Configuration

**Required env vars:**
- None strictly required. The server starts with fallback Godot paths if nothing is set.

**Optional env vars:**
- `GODOT_PATH` — Path to Godot executable. Without this, auto-detection runs platform-specific common paths:
  - Linux: `godot`, `/usr/bin/godot`, `/usr/local/bin/godot`, `/snap/bin/godot`, `~/.local/bin/godot`
  - macOS: `/Applications/Godot.app/Contents/MacOS/Godot`, Steam path, etc.
  - Windows: `C:\Program Files\Godot\Godot.exe`, etc.
- `GODOT_PROJECT_PATH` — Root path for MCP resource listing (godot://scene/ and godot://script/ resources). Falls back to `process.cwd()` if not set.
- `DEBUG=true` — Enables verbose stderr logging

**Secrets location:**
- No secrets. No API keys, tokens, or credentials of any kind.

## Webhooks & Callbacks

**Incoming:**
- None. The server does not expose any HTTP endpoints.

**Outgoing:**
- None. The server makes no HTTP calls.

## LSP Integration (Godot Language Server)

**Protocol:** Language Server Protocol 3.17 over TCP (JSON-RPC 2.0 with `Content-Length` framing)
- Implementation: `src/lsp/client.ts` (TCP client), `src/lsp/protocol.ts` (message framing)
- Default port: 6014 (non-default to avoid conflict with user's Godot editor on port 6005)
- Connection lifecycle:
  1. Try connecting to existing LSP server on port 6014
  2. If `ECONNREFUSED`, spawn headless Godot editor: `godot --editor --headless --lsp-port 6014 --path <project>`
  3. Wait up to 10 seconds for port to accept connections
  4. Send LSP `initialize` + `initialized` handshake
  5. Send `textDocument/didOpen`, collect `textDocument/publishDiagnostics` notifications
  6. Reuse `ctx.lspClient` across tool calls (persistent connection per server session)

## GDScript Operations Bridge

**Pattern:** TypeScript -> Godot headless subprocess -> stdout JSON
- The bridge script `src/scripts/godot_operations.gd` (copied to `build/scripts/godot_operations.gd` at build time) is invoked as:
  ```
  godot --headless --path <project> --script godot_operations.gd <operation> <json_params>
  ```
- Operations supported: `create_scene`, `add_node`, `load_sprite`, `export_mesh_library`, `save_scene`, `modify_node_property`, `remove_node`, `attach_script`, `validate_scripts`, `list_scripts`, `query_class`, `modify_project_setting`, `get_uid`, `resave_resources`
- Parameter encoding: camelCase keys converted to snake_case before JSON serialization (in `src/godot.ts` `convertCamelToSnakeCase`)
- Result parsing: TypeScript tools scan stdout lines for the first `{`-prefixed JSON line

## Screenshot IPC

**Pattern:** File-system trigger/response between Node.js and running Godot game
- Trigger: write empty file to `<project>/.godot/screenshot_trigger`
- Response: Godot's `screenshot_helper.gd` autoload detects trigger, captures viewport, writes `<project>/.godot/screenshot.png`
- Timeout: 5 seconds, 100ms polling interval
- Post-processing: if PNG > 800KB, resize to 960x540 via second headless Godot invocation
- Output: base64-encoded PNG returned as MCP image content

---

*Integration audit: 2026-03-03*
