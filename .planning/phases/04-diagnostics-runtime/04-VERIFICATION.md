---
phase: 04-diagnostics-runtime
verified: 2026-03-03T19:34:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
---

# Phase 4: Diagnostics & Runtime Verification Report

**Phase Goal:** LSP diagnostics client and runtime screenshot capture for AI visual inspection
**Verified:** 2026-03-03T19:34:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

All must-haves are drawn from the `must_haves.truths` fields in the three PLAN frontmatters (04-01, 04-02, 04-03).

#### Plan 01: LSP JSON-RPC Message Framing

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `encodeMessage` produces a valid Content-Length header followed by CRLF CRLF and JSON body | VERIFIED | `src/lsp/protocol.ts:32-36`; test "produces a valid Content-Length header..." passes |
| 2 | `parseMessages` correctly extracts one or more JSON-RPC messages from a raw TCP buffer | VERIFIED | `src/lsp/protocol.ts:47-77`; tests for single and two-message extraction pass |
| 3 | `parseMessages` returns the unconsumed remainder when a message is partially buffered | VERIFIED | `src/lsp/protocol.ts:68,76`; "returns the unconsumed remainder..." test passes |
| 4 | `parseMessages` handles zero messages when buffer contains only a partial header | VERIFIED | `src/lsp/protocol.ts:57`; "handles zero messages..." test passes |

#### Plan 02: Screenshot Capture

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 5 | User can call `capture_screenshot` with a project path and receive a base64-encoded PNG image | VERIFIED | `src/tools/editor.ts:339-347`; success-path test returns `{type:'image', data:base64, mimeType:'image/png'}` |
| 6 | Screenshot helper GDScript captures the viewport after `frame_post_draw` to avoid blank frames | VERIFIED | `src/scripts/screenshot_helper.gd:36`: `await RenderingServer.frame_post_draw` |
| 7 | The tool returns an MCP image content type with `mimeType image/png` | VERIFIED | `src/tools/editor.ts:342-344`: `type: 'image' as const, mimeType: 'image/png'` |
| 8 | The tool returns a clear error if no game is running or if the screenshot file is not produced | VERIFIED | `src/tools/editor.ts:280-285` (no-process error), `:349-357` (timeout error); both test cases pass |
| 9 | Returned image is resized to stay under Claude Desktop's 1MB content limit | VERIFIED | `src/tools/editor.ts:313-319` (800KB threshold check + `resizeScreenshot` call); resize test passes |

#### Plan 03: LSP Client and Diagnostics Tool

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 10 | User can call `get_diagnostics` with a file path and receive syntax errors/type warnings from Godot's LSP | VERIFIED | `src/tools/diagnostics.ts:67-176`; "returns diagnostics array for a file with errors" test passes |
| 11 | LSP client connects to Godot's language server on a configurable TCP port | VERIFIED | `src/lsp/client.ts:52`; `connect(port, host='localhost')` with `new Socket()` |
| 12 | LSP client performs the initialize handshake before sending any other requests | VERIFIED | `src/lsp/client.ts:91-109`; "sends initialize request with correct params" test passes |
| 13 | If no LSP server is running, the tool spawns a headless Godot editor and connects to it | VERIFIED | `src/tools/diagnostics.ts:128-144`; ECONNREFUSED triggers `spawn(ctx.godotPath, ['--editor','--headless','--lsp-port',...])` |
| 14 | LSP connection and headless editor process are cleaned up on server shutdown | VERIFIED | `src/index.ts:56-63`: `ctx.lspClient.disconnect()` + `ctx.lspProcess.kill('SIGTERM')` in shutdown handler |
| 15 | Diagnostics are collected asynchronously after `textDocument/didOpen` with a timeout | VERIFIED | `src/lsp/client.ts:120-152`; 5s timeout returning `[]` on expiry; "times out after 5s" test passes |

**Score:** 10/10 truths groups verified (all 15 individual truth statements verified)

---

### Required Artifacts

| Artifact | Expected | Lines | Exists | Substantive | Wired | Status |
|----------|----------|-------|--------|-------------|-------|--------|
| `src/lsp/protocol.ts` | LSP JSON-RPC framing (encode + parse) | 77 | Yes | Yes — full encode/parse impl | Yes — imported by client.ts | VERIFIED |
| `tests/lsp-protocol.test.ts` | Unit tests for protocol framing | 164 (min 50) | Yes | Yes — 10 test cases | N/A (test file) | VERIFIED |
| `src/scripts/screenshot_helper.gd` | GDScript autoload for viewport capture | 40 (min 20) | Yes | Yes — `_process` loop, trigger polling, `frame_post_draw`, `save_png` | Yes — build.js copies to dist | VERIFIED |
| `src/tools/editor.ts` | `capture_screenshot` MCP tool | 414 | Yes | Yes — full tool implementation with trigger/poll/resize/base64 | Yes — registered in `registerEditorTools` | VERIFIED |
| `tests/screenshot-tools.test.ts` | Unit tests for screenshot tool | 337 (min 40) | Yes | Yes — 8 test cases covering all behaviors | N/A (test file) | VERIFIED |
| `src/lsp/client.ts` | LspClient TCP client class | 228 (min 80) | Yes | Yes — full connect/handshake/getDiagnostics/disconnect | Yes — imported by diagnostics.ts | VERIFIED |
| `src/tools/diagnostics.ts` | `get_diagnostics` MCP tool | 176 (min 50) | Yes | Yes — full tool with path validation, auto-spawn, LSP reuse | Yes — registered in index.ts | VERIFIED |
| `tests/lsp-client.test.ts` | Unit tests for LSP client | 345 (min 50) | Yes | Yes — 7 test cases | N/A (test file) | VERIFIED |
| `tests/diagnostics-tools.test.ts` | Unit tests for diagnostics tool | 218 (min 40) | Yes | Yes — 6 test cases | N/A (test file) | VERIFIED |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/lsp/client.ts` | `src/lsp/protocol.ts` | `import { encodeMessage, parseMessages }` | WIRED | Line 10: `import { encodeMessage, parseMessages, type JsonRpcMessage } from './protocol.js'` |
| `src/tools/diagnostics.ts` | `src/lsp/client.ts` | `LspClient` instance creation | WIRED | Line 17 import + lines 121, 142 `new LspClient()` instantiation |
| `src/index.ts` | `src/tools/diagnostics.ts` | `registerDiagnosticsTools(server, ctx)` | WIRED | Line 17 import + line 37 call |
| `src/lsp/client.ts` | `net.Socket` | TCP connection on configurable port | WIRED | Line 9 `import { Socket } from 'net'`; line 53 `new Socket()` |
| `src/index.ts` | `src/lsp/client.ts` | Shutdown handler disconnects LSP + kills headless editor | WIRED | Lines 56-63: `ctx.lspClient.disconnect()` + `ctx.lspProcess.kill('SIGTERM')` |
| `src/tools/editor.ts` | `src/scripts/screenshot_helper.gd` | Trigger file at `{project_path}/.godot/screenshot_trigger` | WIRED | Lines 287-288 write trigger; GDScript polls the same path (`TRIGGER_PATH`) |
| `src/tools/editor.ts` | MCP SDK | Returns `type: 'image'` content with base64 and `mimeType` | WIRED | Lines 340-347: `{type:'image' as const, data:base64, mimeType:'image/png'}` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SCRI-03 | 04-01, 04-03 | User can get real-time GDScript diagnostics via Godot's LSP (syntax errors, type warnings) | SATISFIED | `src/lsp/protocol.ts` (wire framing) + `src/lsp/client.ts` (TCP client) + `src/tools/diagnostics.ts` (MCP tool registered in index.ts); all tests pass |
| RUNT-01 | 04-02 | User can capture a screenshot of the running game for AI visual inspection | SATISFIED | `src/scripts/screenshot_helper.gd` (GDScript autoload) + `src/tools/editor.ts` `capture_screenshot` tool returning `type:'image'` base64 PNG; all tests pass |

REQUIREMENTS.md traceability confirms both SCRI-03 and RUNT-01 are mapped to Phase 4 and marked Complete. No orphaned requirements.

---

### Test Results

All 31 phase-04 tests pass:

- `tests/lsp-protocol.test.ts` — 10 tests (encodeMessage: 3, parseMessages: 7)
- `tests/lsp-client.test.ts` — 7 tests (connect: 2, getDiagnostics: 3, disconnect: 2)
- `tests/diagnostics-tools.test.ts` — 6 tests
- `tests/screenshot-tools.test.ts` — 8 tests

Build: `npm run build` succeeds with zero TypeScript errors. `screenshot_helper.gd` is copied to `build/scripts/` by `scripts/build.js`.

---

### Anti-Patterns Found

No anti-patterns detected. Specifically:

- No TODO/FIXME/HACK/PLACEHOLDER comments in any implementation file
- No stub return values (`return null`, `return {}`, `return []`) in tool handlers
- No console.log-only implementations (all console.* calls are `console.error` for server-side logging, consistent with FOUN-07)
- No unhandled error paths — all error branches return `toolError(...)` with suggestions

---

### Human Verification Required

The following items cannot be verified programmatically and require human testing:

#### 1. End-to-end Screenshot Capture

**Test:** Start a Godot project with `run_project`, add `screenshot_helper.gd` as an autoload, then call `capture_screenshot` via the MCP server.
**Expected:** An MCP image response containing the game viewport as a base64 PNG is returned within 5 seconds.
**Why human:** Requires a running Godot instance with the autoload registered; cannot be unit-tested.

#### 2. End-to-end LSP Diagnostics

**Test:** Call `get_diagnostics` on a GDScript file with a known syntax error (e.g., `var x = ;`) targeting a real Godot project. No LSP server running initially.
**Expected:** A headless Godot editor is spawned on port 6014, the LSP initializes, and the tool returns at least one diagnostic with `severity:1` and a descriptive message.
**Why human:** Requires Godot 4.x installed and a valid project; port-probing and headless LSP startup cannot be simulated in unit tests.

#### 3. Image Resize Below 1MB

**Test:** Run the game at a high resolution to produce a screenshot larger than 800KB, then call `capture_screenshot`.
**Expected:** The returned base64 image decodes to a 960x540 PNG, and the total MCP content size is under 1MB.
**Why human:** Requires a real running game producing large screenshots; resize correctness depends on Godot headless GDScript execution.

---

## Summary

Phase 4 goal is fully achieved. All three plans executed correctly:

- **Plan 01** (LSP framing): `src/lsp/protocol.ts` provides correct Content-Length framing with UTF-8 byte counting via `Buffer.byteLength`, and buffer-stream reassembly via `subarray` remainder returns.
- **Plan 02** (Screenshot): `src/scripts/screenshot_helper.gd` polls a fixed trigger path and captures after `frame_post_draw`; `capture_screenshot` in `editor.ts` coordinates via the `.godot/` directory, resizes large images via Godot headless, and returns MCP image content.
- **Plan 03** (LSP client + diagnostics): `LspClient` handles the full lifecycle (connect, initialize handshake, `getDiagnostics` via `didOpen` + `publishDiagnostics`, graceful disconnect); `get_diagnostics` auto-spawns a headless editor on ECONNREFUSED, reuses the connection across calls, and cleans up on shutdown.

All key links are wired, all artifacts are substantive, all 31 tests pass, and the build is clean.

---

_Verified: 2026-03-03T19:34:00Z_
_Verifier: Claude (gsd-verifier)_
