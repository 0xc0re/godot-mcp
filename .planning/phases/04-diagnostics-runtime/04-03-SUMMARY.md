---
phase: 04-diagnostics-runtime
plan: 03
subsystem: lsp
tags: [lsp, diagnostics, tcp, gdscript, language-server, headless-editor]

# Dependency graph
requires:
  - phase: 04-diagnostics-runtime
    provides: LSP JSON-RPC message framing (encodeMessage + parseMessages)
provides:
  - LspClient class (TCP connect, initialize handshake, getDiagnostics, disconnect)
  - get_diagnostics MCP tool with auto-spawn headless Godot editor
  - LSP client and process lifecycle management in ServerContext
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [LSP TCP client with event-based notification dispatch, auto-spawn headless editor for LSP, port probing with timeout]

key-files:
  created:
    - src/lsp/client.ts
    - src/tools/diagnostics.ts
    - tests/lsp-client.test.ts
    - tests/diagnostics-tools.test.ts
  modified:
    - src/types.ts
    - src/index.ts

key-decisions:
  - "Port 6014 default for MCP-spawned LSP (avoids conflict with user's editor on 6005)"
  - "LSP client stored on ServerContext for reuse across multiple get_diagnostics calls"
  - "Notification listener pattern for publishDiagnostics with per-URI matching and timeout"
  - "Graceful degradation: 5s timeout returns empty diagnostics rather than error"

patterns-established:
  - "LSP client lifecycle: connect -> initialize handshake -> getDiagnostics (reusable) -> disconnect on shutdown"
  - "Auto-spawn headless editor: try connect first, ECONNREFUSED triggers spawn + port wait"
  - "Notification dispatch map: listeners keyed by method name, cleaned up after match or timeout"

requirements-completed: [SCRI-03]

# Metrics
duration: 4min
completed: 2026-03-04
---

# Phase 4 Plan 3: LSP Client and Diagnostics Tool Summary

**LSP TCP client with auto-spawn headless Godot editor providing get_diagnostics MCP tool for real-time GDScript type errors and warnings**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-04T01:24:51Z
- **Completed:** 2026-03-04T01:29:35Z
- **Tasks:** 2 (both TDD: RED + GREEN)
- **Files modified:** 6

## Accomplishments
- LspClient class: TCP connect with initialize handshake, getDiagnostics via didOpen + publishDiagnostics, graceful disconnect
- get_diagnostics MCP tool: validates .gd files, reads content, returns structured diagnostics from Godot's LSP
- Auto-spawns headless Godot editor (`--editor --headless --lsp-port 6014`) when no LSP server is running
- LSP client and headless editor process cleaned up on server shutdown
- 13 new tests (7 LSP client + 6 diagnostics tool), all 143 project tests passing

## Task Commits

Each task was committed atomically (TDD RED + GREEN):

1. **Task 1 RED: LSP client failing tests** - `fbc1d5e` (test)
2. **Task 1 GREEN: LSP client implementation** - `14c9097` (feat)
3. **Task 2 RED: Diagnostics tool failing tests** - `f488ab4` (test)
4. **Task 2 GREEN: Diagnostics tool + index.ts wiring** - `a76533e` (feat)

## Files Created/Modified
- `src/lsp/client.ts` - LspClient class: TCP connect, initialize handshake, getDiagnostics, disconnect, notification dispatch
- `src/tools/diagnostics.ts` - get_diagnostics MCP tool with auto-spawn headless editor and port probing
- `src/types.ts` - Added optional lspClient and lspProcess fields to ServerContext
- `src/index.ts` - Import/register diagnosticsTools, LSP cleanup in shutdown handler
- `tests/lsp-client.test.ts` - 7 unit tests for LspClient (connect, ECONNREFUSED, diagnostics, timeout, disconnect)
- `tests/diagnostics-tools.test.ts` - 6 unit tests for get_diagnostics (registration, validation, diagnostics, clean file)

## Decisions Made
- Used port 6014 as default for MCP-spawned headless editor to avoid conflict with user's Godot editor on default port 6005
- LSP client stored on ServerContext (`ctx.lspClient`) for reuse across multiple get_diagnostics calls within a session
- Notification listener pattern: listeners map keyed by method name with per-URI matching for publishDiagnostics
- 5s timeout for diagnostics returns empty array (graceful degradation) rather than throwing an error
- Port probing with 10s timeout and 500ms intervals for headless editor startup detection

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- vi.mock for `net.Socket` required class constructor pattern (not plain function) -- fixed in test infrastructure during RED phase

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 04 is now complete: LSP protocol (Plan 01), screenshot capture (Plan 02), and diagnostics tool (Plan 03)
- All 143 tests pass, project builds cleanly
- The get_diagnostics tool provides semantic GDScript analysis (type errors, undefined variables) complementing validate_scripts (syntax-only)

## Self-Check: PASSED

- FOUND: src/lsp/client.ts
- FOUND: src/tools/diagnostics.ts
- FOUND: tests/lsp-client.test.ts
- FOUND: tests/diagnostics-tools.test.ts
- FOUND: fbc1d5e (Task 1 RED commit)
- FOUND: 14c9097 (Task 1 GREEN commit)
- FOUND: f488ab4 (Task 2 RED commit)
- FOUND: a76533e (Task 2 GREEN commit)

---
*Phase: 04-diagnostics-runtime*
*Completed: 2026-03-04*
