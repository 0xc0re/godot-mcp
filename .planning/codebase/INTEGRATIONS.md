# External Integrations

**Analysis Date:** 2026-03-03

## APIs & External Services

**Godot Engine:**
- Godot Editor/Engine executable - Used for launching editor and running projects
  - Invoked via child_process (spawn, execFile) from `src/index.ts`
  - Supports both headless and GUI execution modes
  - Auto-detection for multiple platforms: Windows, macOS, Linux

**Model Context Protocol (MCP):**
- @modelcontextprotocol/sdk 0.6.0 - Provides standardized interface for AI assistants
  - Implements StdioServerTransport for stdio-based communication
  - Defines tool request/response schemas (CallToolRequestSchema, ListToolsRequestSchema)
  - Exception handling via McpError with ErrorCode definitions

## Data Storage

**Databases:**
- None - This is a stateless server

**File Storage:**
- Local filesystem only - Works with existing Godot project files
  - Reads `project.godot` for project configuration
  - Accesses Godot project scenes (.tscn files)
  - Manages GDScript files
  - Handles resources (textures, meshes, etc.)
  - All paths validated against traversal attacks (`src/index.ts` lines 205-215)

**Caching:**
- Godot path validation cache - Map<string, boolean> (`src/index.ts` line 69)
  - Caches validated Godot executable paths to avoid repeated validation

## Authentication & Identity

**Auth Provider:**
- None - No authentication required for MCP server itself
- AI assistants (Cline, Cursor, Claude) handle their own authentication

**Configuration Methods:**
- Cline: Via `~/.../cline_mcp_settings.json` with env vars
- Cursor: Via Cursor Settings UI or `.cursor/mcp.json` project config
- Command-line: Pass GodotServerConfig object to class constructor

## Monitoring & Observability

**Error Tracking:**
- None - No external error tracking service

**Logs:**
- Console-based logging:
  - Debug logs to `console.error()` for DEBUG mode (prevents stdout pollution from JSON-RPC)
  - Error logs to `console.error()` for visibility
  - Info logs to `stdout` for command output
  - `src/index.ts` lines 168-172 for logDebug() implementation
  - Godot operation logs to console via GDScript `log_info()`, `log_error()`, `log_debug()`

**Godot Debug Output:**
- Captures stdout/stderr from running Godot processes
- GodotProcess interface stores output/errors arrays (`src/index.ts` lines 38-42)
- `get_debug_output` tool returns captured output

## CI/CD & Deployment

**Hosting:**
- npm registry (npmjs.org) for package distribution
- GitHub (github.com/Coding-Solo/godot-mcp) for source code
- AI assistant environments (Cline, Cursor, etc.) for runtime

**CI Pipeline:**
- GitHub Actions (not configured - no workflows in `.github/`)
- Manual package publishing to npm

**Deployment Method:**
- npm package installation: `npm install godot-mcp`
- Binary entry point: `node build/index.js`
- Configured in AI assistant MCP settings files

## Environment Configuration

**Required env vars:**
- None - All configurations are optional

**Optional env vars:**
- `GODOT_PATH` - Path to Godot executable (e.g., `/usr/bin/godot` or `C:\Program Files\Godot\Godot.exe`)
- `DEBUG` - Set to `"true"` for detailed logging

**Default Godot Paths (Auto-detection):**
- Linux: `/usr/bin/godot`, `/usr/local/bin/godot`, `/snap/bin/godot`, `$HOME/.local/bin/godot`
- macOS: `/Applications/Godot.app/Contents/MacOS/Godot`, `/Applications/Godot_4.app/Contents/MacOS/Godot`, Steam paths
- Windows: `C:\Program Files\Godot\Godot.exe`, `C:\Program Files (x86)\Godot\Godot.exe`

**Secrets location:**
- Not applicable - No secrets used by this server

## Webhooks & Callbacks

**Incoming:**
- None - Server does not accept incoming webhooks

**Outgoing:**
- None - Server does not send webhooks

## Tool Integration with AI Assistants

**Cline Integration:**
- Configuration: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- Auto-approve list: All 14 tools are listed for automatic approval
- Environment: Pass DEBUG env var for logging

**Cursor Integration:**
- Configuration: Cursor Settings > Features > MCP
- Project-specific: `.cursor/mcp.json` at project root
- Tool discovery: Automatic via MCP protocol

**Claude/Other Assistants:**
- Standard MCP protocol via stdio transport
- Tools exposed: 14 total (launch_editor, run_project, get_debug_output, stop_project, get_godot_version, list_projects, get_project_info, create_scene, add_node, load_sprite, export_mesh_library, save_scene, get_uid, update_project_uids)

## Godot Version Compatibility

**Version Detection:**
- Uses `--version` flag to validate Godot executable (`src/index.ts` line 255)
- Version parsing: Regex match for `(\d+)\.(\d+)` format (`src/index.ts` line 400)
- Godot 4.4+ specific features: UID management (get_uid, update_project_uids)

---

*Integration audit: 2026-03-03*
