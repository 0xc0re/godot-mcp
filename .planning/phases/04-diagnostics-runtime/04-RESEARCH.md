# Phase 4: Diagnostics & Runtime - Research

**Researched:** 2026-03-03
**Domain:** Godot LSP (Language Server Protocol) diagnostics + runtime screenshot capture
**Confidence:** MEDIUM

## Summary

Phase 4 addresses two distinct integrations: (1) connecting to Godot's built-in LSP server over TCP to retrieve GDScript diagnostics (type errors, undefined variable warnings), and (2) capturing screenshots from a running Godot game for AI visual inspection.

The LSP integration requires opening a raw TCP socket to Godot's language server (default port 6005), implementing LSP message framing (Content-Length headers + JSON-RPC), sending `initialize` and `textDocument/didOpen` requests, and receiving `textDocument/publishDiagnostics` notifications. The Godot editor must be running (or launched in headless mode with `--editor --headless --lsp-port <port>`) for the LSP server to be available. This is a significant architectural difference from all prior phases, which used one-shot `godot --headless --script` invocations.

Screenshot capture requires a running game instance (already supported via `run_project`). The approach is to launch the game with `--write-movie` pointing at a PNG output path combined with `--fixed-fps` for deterministic frame capture. Alternatively, a GDScript autoload can be injected to capture the viewport on demand. The MCP SDK supports returning images as base64 content with `type: "image"` and `mimeType: "image/png"`.

**Primary recommendation:** Use raw `net.Socket` for LSP communication (no heavy dependencies), launch a headless editor instance for LSP on demand, and use a GDScript helper autoload for screenshot capture from the already-running game process.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCRI-03 | User can get real-time GDScript diagnostics via Godot's LSP (syntax errors, type warnings) | LSP TCP connection pattern, JSON-RPC message framing, `textDocument/publishDiagnostics` notification handling, headless editor LSP launch |
| RUNT-01 | User can capture a screenshot of the running game for AI visual inspection | Viewport capture via GDScript autoload, MCP SDK image content type (`type: "image"`, base64), file-based coordination between game process and MCP server |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `net` | built-in | TCP socket to Godot LSP | Zero dependencies; LSP is just JSON-RPC over TCP with Content-Length framing |
| Node.js `fs` | built-in | Read screenshot PNG from disk | Already used throughout project |
| zod | ^3.25.76 | Input schema validation | Already a project dependency |
| @modelcontextprotocol/sdk | ^1.27.1 | MCP tool registration with image content | Already a project dependency; supports `type: "image"` responses |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `child_process` | built-in | Spawn headless Godot editor for LSP | When no existing Godot editor/LSP is detected on the target port |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `net.Socket` | `vscode-languageserver-protocol` npm | Adds ~500KB dependency; overkill when we only need `initialize` + `didOpen` + `publishDiagnostics` |
| GDScript autoload screenshot | `--write-movie` PNG output | Movie mode requires game to be started with the flag; can't retrofit to already-running game |
| File-based screenshot trigger | TCP/UDP server in GDScript | Adds networking complexity to the game; file polling is simpler and reliable |

**Installation:**
```bash
# No new dependencies needed -- all capabilities come from Node.js built-ins and existing deps
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  tools/
    diagnostics.ts      # get_diagnostics tool (LSP client)
    editor.ts            # existing: run_project, stop_project (extended for screenshot)
  lsp/
    client.ts            # LSP TCP client: connect, initialize, request diagnostics
    protocol.ts          # JSON-RPC message framing (Content-Length encode/decode)
  scripts/
    godot_operations.gd  # existing operations (no changes needed)
    screenshot_helper.gd # autoload script injected into running game
```

### Pattern 1: LSP TCP Client with JSON-RPC Framing
**What:** Connect to Godot's LSP via raw TCP, frame messages with `Content-Length` headers per LSP spec, send/receive JSON-RPC 2.0 messages.
**When to use:** For all LSP communication (SCRI-03).
**Example:**
```typescript
// Source: LSP 3.17 specification + godot-lsp-bridge pattern
import { Socket } from 'net';

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

function encodeMessage(msg: JsonRpcMessage): Buffer {
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  return Buffer.from(header + body);
}

function parseMessages(buffer: Buffer): { messages: JsonRpcMessage[]; remainder: Buffer } {
  const messages: JsonRpcMessage[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const headerEnd = buffer.indexOf('\r\n\r\n', offset);
    if (headerEnd === -1) break;
    const header = buffer.subarray(offset, headerEnd).toString();
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) break;
    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (bodyStart + contentLength > buffer.length) break;
    const body = buffer.subarray(bodyStart, bodyStart + contentLength).toString();
    messages.push(JSON.parse(body));
    offset = bodyStart + contentLength;
  }
  return { messages, remainder: buffer.subarray(offset) };
}
```

### Pattern 2: On-Demand Headless Editor for LSP
**What:** If no LSP server is detected on the target port, spawn `godot --editor --headless --lsp-port <port> --path <project>` and wait for it to be ready.
**When to use:** When the user hasn't opened the Godot editor manually.
**Example:**
```typescript
// Spawn headless editor for LSP
const lspProcess = spawn(ctx.godotPath, [
  '--editor', '--headless', '--lsp-port', String(port), '--path', projectPath
], { stdio: 'pipe' });
trackProcess(ctx, lspProcess);
// Wait for TCP port to become available before connecting
```

### Pattern 3: Screenshot via GDScript Autoload
**What:** Inject a GDScript autoload into the running game that monitors a trigger file. When the MCP tool writes the trigger file, the autoload captures the viewport and saves a PNG.
**When to use:** For RUNT-01 screenshot capture.
**Example:**
```gdscript
# screenshot_helper.gd - Injected as autoload when running game
extends Node

var trigger_path := ""
var output_path := ""
var _check_timer := 0.0

func _ready() -> void:
    # Paths passed via command line or env
    var args = OS.get_cmdline_args()
    for i in range(args.size()):
        if args[i] == "--screenshot-trigger" and i + 1 < args.size():
            trigger_path = args[i + 1]
        elif args[i] == "--screenshot-output" and i + 1 < args.size():
            output_path = args[i + 1]

func _process(delta: float) -> void:
    if trigger_path.is_empty():
        return
    _check_timer += delta
    if _check_timer < 0.5:  # Poll every 500ms
        return
    _check_timer = 0.0
    if FileAccess.file_exists(trigger_path):
        DirAccess.remove_absolute(trigger_path)
        await RenderingServer.frame_post_draw
        var image = get_viewport().get_texture().get_image()
        image.save_png(output_path)
```

### Pattern 4: MCP Image Content Response
**What:** Return screenshot as base64-encoded PNG in MCP tool response with `type: "image"`.
**When to use:** Returning screenshot data to the AI for visual inspection.
**Example:**
```typescript
// Source: MCP specification + SDK discussion
import { readFileSync } from 'fs';

const imageData = readFileSync(screenshotPath);
const base64 = imageData.toString('base64');

return {
  content: [
    {
      type: 'image' as const,
      data: base64,
      mimeType: 'image/png',
    },
  ],
};
```

### Anti-Patterns to Avoid
- **Bundling vscode-languageserver-protocol:** Massive dependency for three JSON-RPC messages; use raw TCP instead
- **Requiring editor to be open:** User may not have editor running; spawn headless editor automatically
- **Using --headless without --editor for LSP:** The LSP server is part of the editor, not the game runtime; `--headless` alone won't expose LSP
- **Polling LSP for diagnostics:** LSP pushes diagnostics via `publishDiagnostics` notification; don't poll, listen
- **Returning raw file paths for screenshots:** The AI can't access local file paths; must return base64 image data via MCP

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LSP message framing | Custom binary parser | Standard Content-Length header parsing (simple string ops) | LSP framing is trivially simple -- just `Content-Length: N\r\n\r\n{json}` |
| JSON-RPC protocol | Full JSON-RPC library | Minimal encode/decode functions (< 50 lines) | We only need 3 message types: initialize, didOpen, publishDiagnostics |
| Screenshot file format | Custom image encoder | Godot's built-in `Image.save_png()` | Godot handles all image encoding natively |
| Base64 encoding | Custom encoder | Node.js `Buffer.toString('base64')` | Built-in, zero overhead |

**Key insight:** Both integrations are thin wrappers around existing capabilities (Godot's LSP server, Godot's viewport capture). The MCP tool layer just coordinates and translates formats.

## Common Pitfalls

### Pitfall 1: LSP Server Not Available
**What goes wrong:** Connecting to port 6005 fails because no Godot editor is running.
**Why it happens:** The LSP server is embedded in the Godot editor process; it's not a standalone service.
**How to avoid:** Try connecting first; if connection fails, spawn `godot --editor --headless --lsp-port <port> --path <project>`. Use a configurable port to avoid conflicts with an already-open editor.
**Warning signs:** `ECONNREFUSED` on TCP connect.

### Pitfall 2: LSP Port Conflict
**What goes wrong:** Headless editor fails to bind because the user has the editor open on the same port.
**Why it happens:** Default port 6005 is shared between headless and GUI editor instances.
**How to avoid:** Use a non-default port (e.g., 6014) for the MCP-spawned headless editor via `--lsp-port`. Check if port is in use before spawning.
**Warning signs:** Editor process exits immediately or port bind error in stderr.

### Pitfall 3: LSP Initialization Race
**What goes wrong:** Sending `textDocument/didOpen` before `initialize` response arrives; server ignores or errors.
**Why it happens:** TCP connect succeeds but the LSP server hasn't finished initializing.
**How to avoid:** Wait for the `initialize` response before sending any other requests. The LSP spec requires this handshake.
**Warning signs:** Empty or error responses to didOpen.

### Pitfall 4: Diagnostics Arrive Asynchronously
**What goes wrong:** Tool returns empty diagnostics because `publishDiagnostics` notification hasn't arrived yet after `didOpen`.
**Why it happens:** LSP diagnostics are pushed asynchronously; there's no request/response for "get diagnostics."
**How to avoid:** After sending `didOpen`, wait for `publishDiagnostics` notification with a timeout (e.g., 5 seconds). Multiple notifications may arrive as analysis progresses.
**Warning signs:** Returning zero diagnostics for files that clearly have errors.

### Pitfall 5: Screenshot Capture Timing
**What goes wrong:** Screenshot is blank or shows the wrong frame.
**Why it happens:** Viewport texture captured before rendering completes.
**How to avoid:** Use `await RenderingServer.frame_post_draw` in GDScript before capturing. This signal fires after the frame has been fully rendered.
**Warning signs:** All-black or partially-rendered PNG files.

### Pitfall 6: Screenshot File Size Exceeds MCP Limit
**What goes wrong:** Claude Desktop rejects the image response with a vague error.
**Why it happens:** Claude Desktop has a 1MB limit for tool content. High-resolution screenshots can exceed this.
**How to avoid:** Resize the image before encoding to base64. A 1280x720 PNG is typically 500KB-1MB; resize to 960x540 or use JPEG for smaller sizes.
**Warning signs:** Responses work in MCP Inspector but fail in Claude Desktop.

### Pitfall 7: --lsp-port Argument Format
**What goes wrong:** Headless editor ignores the port override.
**Why it happens:** Godot expects `--lsp-port 6014` (space-separated), not `--lsp-port=6014` (equals).
**How to avoid:** Always pass as two separate arguments: `'--lsp-port', String(port)`.
**Warning signs:** LSP starts on default port 6005 instead of the requested port.

## Code Examples

Verified patterns from official sources:

### LSP Initialize Request
```typescript
// Source: LSP 3.17 specification
const initializeRequest: JsonRpcMessage = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    processId: process.pid,
    capabilities: {
      textDocument: {
        publishDiagnostics: {
          relatedInformation: true,
        },
      },
    },
    rootUri: `file://${projectPath}`,
  },
};
```

### LSP didOpen Notification
```typescript
// Source: LSP 3.17 specification
const didOpenNotification: JsonRpcMessage = {
  jsonrpc: '2.0',
  method: 'textDocument/didOpen',
  params: {
    textDocument: {
      uri: `file://${absoluteFilePath}`,
      languageId: 'gdscript',
      version: 1,
      text: fileContents,
    },
  },
};
```

### Godot 4 Viewport Screenshot (GDScript)
```gdscript
# Source: Godot 4 docs + community verified pattern
# Must await frame_post_draw to ensure rendering is complete
await RenderingServer.frame_post_draw
var image: Image = get_viewport().get_texture().get_image()
# In Godot 4, flip_y() is NOT needed (was needed in 3.x)
image.save_png("/absolute/path/to/screenshot.png")
```

### MCP Image Response
```typescript
// Source: MCP specification, type: "image" content
import { readFileSync } from 'fs';

function imageResponse(pngPath: string) {
  const data = readFileSync(pngPath);
  return {
    content: [
      {
        type: 'image' as const,
        data: data.toString('base64'),
        mimeType: 'image/png',
      },
    ],
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WebSocket LSP (Godot 3.x) | TCP LSP (Godot 4.x) | Godot 4.0 (PR #35864) | External clients can connect via standard TCP socket |
| Fixed port 6005 only | `--lsp-port` CLI override | Godot 4.2 (PR #81844, Sep 2023) | Multiple LSP instances can coexist on different ports |
| `get_texture().get_data()` + `flip_y()` (3.x) | `get_texture().get_image()` (4.x) | Godot 4.0 | No flip needed; API renamed for clarity |
| No headless LSP | `--editor --headless` LSP support | Godot 4.2+ | LSP works without GUI; enables CI/server use |

**Deprecated/outdated:**
- WebSocket LSP transport: Replaced by TCP in Godot 4.0
- `Directory` class (3.x): Replaced by `DirAccess` in 4.0
- `get_data()` on Texture2D (3.x): Replaced by `get_image()` in 4.0
- `Image.flip_y()` for viewport captures: No longer needed in 4.0+

## Open Questions

1. **LSP connection lifecycle management**
   - What we know: The headless editor LSP process must persist across multiple diagnostic requests
   - What's unclear: Should we store the LSP connection in `ServerContext` and reuse it, or reconnect per request?
   - Recommendation: Store the socket connection and headless editor process in `ServerContext`; reconnect on error. Add LSP cleanup to the shutdown handler.

2. **Godot version compatibility for --lsp-port**
   - What we know: `--lsp-port` was added in Godot 4.2 (merged Sep 2023)
   - What's unclear: How to handle Godot 4.0/4.1 users who don't have this flag
   - Recommendation: Document minimum Godot 4.2 requirement for LSP diagnostics. Fall back to default port 6005 if `--lsp-port` is not supported (detect via version check with `isGodot44OrLater` pattern).

3. **Screenshot trigger mechanism reliability**
   - What we know: File-based polling works but has latency (~500ms poll interval)
   - What's unclear: Whether Godot's `_process` is reliable enough for file polling in all game states
   - Recommendation: File polling is pragmatic and avoids adding networking to the game. 500ms latency is acceptable for AI screenshot inspection. Consider using OS.execute or file watching as alternatives if polling proves unreliable.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCRI-03 | get_diagnostics tool registers and handles LSP responses | unit | `npx vitest run tests/diagnostics-tools.test.ts -x` | No -- Wave 0 |
| SCRI-03 | LSP message framing encodes/decodes correctly | unit | `npx vitest run tests/lsp-protocol.test.ts -x` | No -- Wave 0 |
| SCRI-03 | LSP client handles connection errors gracefully | unit | `npx vitest run tests/lsp-client.test.ts -x` | No -- Wave 0 |
| RUNT-01 | capture_screenshot tool registers and returns image content | unit | `npx vitest run tests/screenshot-tools.test.ts -x` | No -- Wave 0 |
| RUNT-01 | Screenshot image is returned as base64 with correct mimeType | unit | `npx vitest run tests/screenshot-tools.test.ts -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/lsp-protocol.test.ts` -- covers SCRI-03 message framing
- [ ] `tests/lsp-client.test.ts` -- covers SCRI-03 connection/initialization
- [ ] `tests/diagnostics-tools.test.ts` -- covers SCRI-03 MCP tool registration and handler
- [ ] `tests/screenshot-tools.test.ts` -- covers RUNT-01 MCP tool registration and image response

## Sources

### Primary (HIGH confidence)
- [LSP 3.17 Specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) - Message framing, initialize handshake, textDocument/didOpen, publishDiagnostics
- [Godot PR #81844](https://github.com/godotengine/godot/pull/81844) - `--lsp-port` CLI argument, merged into 4.2
- [Godot PR #35864](https://github.com/godotengine/godot/pull/35864) - LSP switched from WebSocket to TCP
- [MCP Specification - Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) - Image content type for tool responses

### Secondary (MEDIUM confidence)
- [godot-lsp-bridge](https://github.com/nguyenchiencong/godot-lsp-bridge) - Reference implementation of TCP-to-stdio LSP bridge for Godot (zero deps, Node.js 18+)
- [minimal-godot-mcp](https://github.com/ryanmazzolini/minimal-godot-mcp) - Reference MCP server with LSP diagnostics (get_diagnostics, scan_workspace_diagnostics)
- [opencode-godot-lsp](https://github.com/MasuRii/opencode-godot-lsp) - LSP bridge that auto-spawns headless editor
- [Godot Proposals #11056](https://github.com/godotengine/godot-proposals/issues/11056) - LSP refactoring proposal (current limitations documented)
- [VSCode plugin issue #473](https://github.com/godotengine/godot-vscode-plugin/issues/473) - Default LSP port is 6005 in Godot 4
- [Shaggy Dev - Screenshots](https://shaggydev.com/2025/02/05/godot-screenshots/) - Godot 4 viewport screenshot pattern
- [MCP Discussion #199](https://github.com/orgs/modelcontextprotocol/discussions/199) - Image content in tool responses, 1MB Claude Desktop limit

### Tertiary (LOW confidence)
- [Godot Forum - Headless LSP](https://forum.godotengine.org/t/connecting-gdscript-language-server-without-editor-headless-godot/6269) - Community reports on `--editor --headless` for LSP (may be version-specific)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies; all Node.js built-ins and existing project deps
- Architecture (LSP): MEDIUM - TCP connection pattern is well-documented by reference implementations, but Godot's LSP has known spec compliance issues and the headless mode behavior may vary by version
- Architecture (Screenshot): MEDIUM - Viewport capture API is stable and well-documented, but the trigger mechanism (file polling) is pragmatic rather than proven at scale
- Pitfalls: HIGH - Multiple reference implementations document the same issues; well-understood failure modes

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (30 days; Godot LSP is stable but under active refactoring proposal)
