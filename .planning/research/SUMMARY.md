# Project Research Summary

**Project:** godot-mcp — MCP server for Godot Engine
**Domain:** MCP server / game engine integration (TypeScript/Node.js + Godot 4.x)
**Researched:** 2026-03-03
**Confidence:** HIGH

## Executive Summary

The godot-mcp project is a Model Context Protocol server that lets AI assistants (Claude Code, Cline, Cursor) interact with the Godot 4.x game engine. The current implementation has a critical blocking bug: it uses MCP SDK v0.6.0 which speaks protocol version `2024-11-05`, but Claude Code expects `2025-03-26`. This protocol mismatch causes all tools to be invisible in Claude Code — zero functionality works for Claude Code users today. Fixing this is not optional and is the mandatory first action. The upgrade to SDK 1.27.1 is the unlock that makes every other improvement matter.

Beyond the SDK fix, the current server has 12 working tools but is behind every significant competitor in scene inspection and manipulation. Competitors like tugcantopaloglu (149 tools) and GoPeak (95 tools) all implement headless scene tree read/modify — features that are absent here. The competitive gap is bridgeable in a focused v1 push: add read_scene, modify node properties, remove node, attach script to node, and GDScript parse error scanning. The target tool count is ~30 focused tools, not 100+. The competitor with 149 tools destroys context budget and degrades LLM accuracy; quality beats quantity here.

The architecture requires a simultaneous refactor: the current 2000+ line monolithic `index.ts` cannot be safely extended without turning into an unmaintainable ball of mud. The refactor to domain-based tool modules (`src/tools/project/`, `src/tools/scene/`, `src/tools/script/`, `src/tools/asset/`) is not a luxury — it is the prerequisite for adding any new tools cleanly. The recommended approach is to do the SDK upgrade and architectural refactor together in Phase 1, migrate existing tools into the new structure, then build new capabilities on the clean foundation.

## Key Findings

### Recommended Stack

The stack upgrade is small in scope but large in impact. The only mandatory package change is upgrading `@modelcontextprotocol/sdk` from 0.6.0 to 1.27.1 and adding `zod@^3.25` as an explicit peer dependency. The new SDK's `McpServer` class replaces the old `Server` class; `registerTool()` replaces the deprecated `server.tool()` and the manual `setRequestHandler(ListToolsRequestSchema)` / `setRequestHandler(CallToolRequestSchema)` split. Adding `@fernforestgames/godot-resource-parser@0.1.3` enables TypeScript-native `.tscn`/`.tres` parsing without writing a custom parser. Removing `axios` (unused, 50KB+) is a free win. All Godot CLI interactions use the existing `execFile` security pattern; that is correct and should not be changed.

**Core technologies:**
- `@modelcontextprotocol/sdk@1.27.1`: MCP protocol — mandatory upgrade; v0.6.0 is the direct cause of Claude Code tool invisibility
- `zod@^3.25`: Schema validation — required peer dep of SDK 1.x; needed for `registerTool()` input schemas
- `TypeScript@5.9.3`: Type safety — minor upgrade from 5.3.3; cheap and adds recent type features
- `Node.js >=18 (20 LTS preferred)`: Runtime — existing constraint; Node 20 avoids `globalThis.crypto` polyfill for optional auth features
- `@fernforestgames/godot-resource-parser@0.1.3`: `.tscn`/`.tres` parsing — TypeScript-native, zero dependencies, read-only, Godot 4 format only
- `Godot 4.6.1` (host-installed at `/usr/bin/godot`): Target engine — all `--headless`, `--script`, `--check-only` flags verified against installed binary

### Expected Features

The feature research identifies a clear P1 set that makes the product competitive, a P2 set that adds depth, and a P3 set to defer. The SDK fix is a prerequisite for all features — without it, the tool count is irrelevant.

**Must have (table stakes / P1):**
- SDK upgrade to 1.27.1 — blocks every other feature; zero tools visible without it
- Read scene tree as JSON (headless) — every competitor has this; its absence is the biggest functional gap
- Modify node properties headlessly — required for iterative scene building
- Remove node from scene — required for scene refactoring
- Attach script to node — required to wire up game logic during AI-directed scene creation
- Scan for GDScript parse errors (`godot --check-only --headless`) — low cost, high signal
- Read project.godot settings — enables AI to understand autoloads, input maps, rendering config
- Improved error messages — actionable guidance instead of raw Godot stderr

**Should have (competitive / P2):**
- Modify project.godot settings — needed for project scaffolding
- Create/read resource files (.tres) — needed for real game work with materials and atlases
- List scripts with structure summary — reduces AI back-and-forth on project orientation
- MCP resources (`godot://scene/current` for `@mention` context) — ee0pdt implements this
- GDScript diagnostics via LSP — high value but requires editor running; add as optional enhancement

**Defer (v2+):**
- ClassDB introspection — reduces hallucination on property names; complex to implement cleanly
- Runtime scene tree inspection via DAP — high complexity, requires debugger protocol
- Screenshot capture — window management complexity; niche use case
- Export project headlessly — CI/CD use case; valuable but niche for MCP workflow
- Tool search / pagination — only needed if tool count exceeds ~30

**Anti-features to avoid:**
- 100+ tools in one server — destroys context budget; target ~30 focused tools
- Arbitrary GDScript eval — shell injection vector; expose parameterized operations instead
- Godot 3.x support — incompatible APIs; document 4.x requirement and move on
- HTTP transport — local tool; stdio is correct

### Architecture Approach

The target architecture is a domain-modular Node.js process communicating via MCP stdio JSON-RPC. The key structural change is splitting the monolithic `src/index.ts` into a thin entry point plus domain-scoped tool modules (`src/tools/project/`, `src/tools/scene/`, `src/tools/script/`, `src/tools/asset/`). Shared infrastructure (Godot process management, path detection, parameter validation) lives in `src/core/` and is injected into tool modules via a `CoreServices` container. GDScript-side operations remain in a single dispatch script (`src/scripts/godot_operations.gd`) that receives operation name + JSON params as CLI args. File operations that do not require Godot's scene API (directory listing, raw file reads) are handled directly in Node.js to avoid the 200-400ms per-spawn overhead.

**Major components:**
1. `src/index.ts` (~50 lines after refactor) — entry point: create `McpServer`, connect `StdioServerTransport`, call each tool registration function
2. `src/core/` — `GodotProcessManager` (execFile/spawn wrapper + active process state), `PathManager` (Godot binary detection + caching), `Validator` (path traversal prevention), `CoreServices` interface
3. `src/tools/<domain>/` — one file per domain; each exports `registerXxxTools(server, core)` that calls `server.registerTool()` for all tools it owns
4. `src/scripts/godot_operations.gd` — GDScript dispatcher; receives operation + JSON params from CLI args, executes Godot API calls, prints results to stdout, calls `get_tree().quit()` in all exit paths

### Critical Pitfalls

1. **stdout pollution breaks JSON-RPC silently** — Any `console.log()` to stdout corrupts the MCP stdio transport; symptoms are tools not appearing or intermittent disconnects. Prevention: use `console.error()` everywhere; add ESLint rule banning `console.log` in server code; verify no imported library prints to stdout on import.

2. **SDK 0.6.0 protocol mismatch with Claude Code** — This is the current live bug. SDK 0.6.0 sends `protocolVersion: "2024-11-05"`; Claude Code expects `"2025-03-26"`. All tools are invisible. Fix: upgrade to SDK 1.27.1, switch to `McpServer` + `registerTool()`, verify with Claude Code (not just Inspector — Inspector has different version requirements).

3. **Godot headless buffer overflow causes hangs** — `execFile` with default buffer limits hangs when Godot produces large output (import logs, verbose errors). Prevention: always set `{ maxBuffer: 10 * 1024 * 1024, timeout: 30000 }` on all `execFileAsync` calls; remove the hardcoded `GODOT_DEBUG_MODE = true` constant.

4. **GDScript operations script hangs if `quit()` is not called** — Godot's engine loop does not exit when a script finishes. Every code path in `godot_operations.gd` including error paths must call `get_tree().quit()`. New operations added to this file are at risk.

5. **Claude Code strict schema validation breaks tool registration** — Claude Code v2.0.21+ rejects `inputSchema` with `oneOf`/`anyOf`/`allOf` at root level. Keep all schemas as flat `{ type: "object", properties: {...}, required: [...] }`. Validate all tool schemas in CI.

## Implications for Roadmap

Based on research, the dependency graph dictates a clear 4-phase structure. The SDK fix and architectural refactor are coupled: doing them together in Phase 1 reduces total work and risk compared to doing them sequentially.

### Phase 1: Foundation — SDK Upgrade + Architectural Refactor

**Rationale:** The SDK version mismatch is a hard blocker: zero tools work in Claude Code until it is fixed. The monolithic architecture cannot safely accommodate the new tools needed in Phase 2 without first being split into modules. These two concerns are coupled — upgrading the SDK requires changing the registration API, which is the same work as the modular refactor. Do them together.

**Delivers:**
- All 12 existing tools working correctly in Claude Code (tool discovery fixed)
- Modular codebase ready for extension
- Core infrastructure (`GodotProcessManager`, `PathManager`, `Validator`) extracted and testable
- `execFileAsync` hardened with `maxBuffer`, `timeout`, and `SIGTERM` cleanup
- `GODOT_DEBUG_MODE` converted from hardcoded constant to env variable
- ESLint rule banning `console.log` in server code
- All `godot_operations.gd` exit paths audited for `get_tree().quit()`

**Addresses from FEATURES.md:** SDK compatibility (P1 blocker), improved error messages (P1)

**Stack changes:** `@modelcontextprotocol/sdk` 0.6.0 → 1.27.1, add `zod@^3.25`, remove `axios`, upgrade `typescript` and `@types/node`

**Avoids:** Pitfalls 1 (stdout pollution), 2 (protocol mismatch), 3 (schema validation), 4 (buffer overflow), 5 (GDScript hangs)

**Research flag:** Standard patterns — well-documented SDK migration path; no additional research needed.

---

### Phase 2: Scene Intelligence — Headless Scene Read/Modify

**Rationale:** Scene inspection and manipulation is the single largest functional gap versus competitors. Every alternative implementation has headless scene read. Without it, the AI cannot safely modify what it cannot read. These features have clear, well-defined Godot API operations (ResourceLoader, PackedScene, Node manipulation) and the `godot_operations.gd` dispatch pattern is ready to receive them.

**Delivers:**
- `read_scene` — return scene tree as JSON (node names, types, properties)
- `modify_node` — set properties on named nodes headlessly
- `remove_node` — remove a node from scene by path
- `attach_script` — attach a GDScript file to a named node
- `read_project_settings` — parse `project.godot` and return key settings
- `scan_scripts` — batch GDScript parse error check via `godot --check-only --headless`
- `@fernforestgames/godot-resource-parser` integrated for Node.js-side `.tscn` inspection

**Addresses from FEATURES.md:** All P1 features remaining after Phase 1

**Uses from STACK.md:** `@fernforestgames/godot-resource-parser`, `godot --check-only --headless --script` flags

**Implements from ARCHITECTURE.md:** Extended `godot_operations.gd` dispatch; `src/tools/scene/` module; distinction between Godot-native ops (use execFile) and filesystem-native ops (use Node.js directly)

**Avoids:** Pitfall 4 (buffer overflow on scene dumps), Pitfall 5 (GDScript quit() in new operations)

**Research flag:** Needs phase research — headless scene manipulation via GDScript has edge cases (import cache, ExtResource ID management, property path syntax). Research `godot_operations.gd` implementation patterns and `.tscn` write-back format before implementation.

---

### Phase 3: Project Scaffolding + Script Intelligence

**Rationale:** With scene tools working, the natural next expansion is project-level configuration and script-level intelligence. These enable the AI to scaffold new projects from scratch (project settings, autoloads) and to understand script structure (exports, signals) without reading entire files. These features are additive — they do not depend on each other.

**Delivers:**
- `modify_project_settings` — configure autoloads, input maps, render mode via `project.godot`
- `create_resource` / `read_resource` — create and inspect `.tres` material/resource files
- `list_scripts_summary` — return script files with their class name, exports, signals, and methods
- MCP resources (`godot://scene/current`, `godot://script/<path>`) for Claude Code `@mention` support

**Addresses from FEATURES.md:** All P2 features

**Research flag:** Needs phase research — MCP Resources protocol (`resources/list`, `resources/read`) is separate from Tools; implementation pattern needs verification against SDK 1.27.1 `McpServer` API.

---

### Phase 4: Diagnostics + Advanced Integration

**Rationale:** High-complexity features that require external services (Godot LSP) or introduce new integration surfaces (DAP debugger protocol). These are v2+ features deferred until P1/P2 prove stable.

**Delivers:**
- GDScript diagnostics via LSP (type errors, undefined variables) — requires Godot editor running with LSP on port 6005
- ClassDB introspection ("what properties does CharacterBody2D have?") — reduces AI hallucination on Godot API
- Runtime scene tree inspection via DAP — walk live scene tree during running game

**Addresses from FEATURES.md:** P3 features

**Research flag:** Needs phase research — LSP and DAP protocol integration are complex external integrations with sparse community documentation. Verify Godot LSP wire protocol and Claude Code session lifecycle before committing to implementation approach.

---

### Phase Ordering Rationale

- **Phase 1 before everything:** The SDK mismatch is a complete functional blocker. Nothing else ships to Claude Code users until Phase 1 is done.
- **Phase 1 includes architecture refactor:** Adding new tools to the monolith causes technical debt to compound faster than features are added. Doing the refactor now costs less than doing it later with 20 tools to migrate.
- **Phase 2 before Phase 3:** Scene tools are the highest-value gap and have clear implementation paths. Project scaffolding and script intelligence build on the scene foundation.
- **Phase 4 deferred:** LSP/DAP integration introduces new external service dependencies and operational complexity. Deferring until Phases 1-3 are stable reduces risk.
- **Tool count discipline throughout:** Target ~30 focused tools total. Stop before context budget becomes a problem. Tool Search can be added if count justifies it.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** Headless scene manipulation via GDScript has edge cases (import cache requirement, ExtResource/SubResource ID management when modifying .tscn files, property path syntax for nested nodes). Research the `godot_operations.gd` patterns and `.tscn` write-back format before sprint planning.
- **Phase 4:** LSP and DAP protocol integration with Godot 4.x are complex integrations. The GoPeak/HaD0Yun implementation is the primary reference but documentation is sparse. Research Godot LSP wire protocol and JSON-RPC over TCP before committing to scope.

Phases with standard patterns (skip research-phase):
- **Phase 1:** SDK migration is well-documented; `McpServer` + `registerTool()` migration path is clear from SDK README and type definitions. No unknowns.
- **Phase 3:** MCP Resources protocol needs a quick lookup but is straightforward; project.godot is a well-documented text format; `.tres` creation follows the same pattern as `.tscn`.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | SDK versions verified via npm registry; Godot CLI flags verified directly against `/usr/bin/godot --help` on this machine; `@fernforestgames/godot-resource-parser` confirmed on npm and GitHub |
| Features | HIGH (competitors), MEDIUM (Claude Code expectations) | Competitor analysis based on actual GitHub repos; Claude Code tool discovery behavior based on community issue tracker reports, not Anthropic official docs |
| Architecture | HIGH (MCP SDK patterns), MEDIUM (Godot headless specifics) | MCP `McpServer`/`registerTool` pattern is from official SDK docs; GDScript dispatch pattern is well-established but specific edge cases (ExtResource ID stability) need Phase 2 research |
| Pitfalls | HIGH | All major pitfalls verified across multiple sources: official GitHub issues, community reports, official MCP documentation |

**Overall confidence:** HIGH

### Gaps to Address

- **Headless scene write-back stability:** Reading `.tscn` as text and writing back modifications risks corrupting ExtResource/SubResource ID references. The `@fernforestgames/godot-resource-parser` is read-only; write-back must use `godot_operations.gd`. The exact format Godot expects when a node's properties are modified needs Phase 2 research validation.
- **Import cache requirement for headless ops:** Running `godot --headless --script` against a project that has never been opened in the editor will fail because the `.godot/` import cache does not exist. Phase 2 must handle this by running `godot --headless --editor --quit` or `--import` first. This is a known Godot issue (#83449) with no workaround in the CLI.
- **Claude Code MCP Resources support:** MCP Resources (`resources/list`, `resources/read`) are a separate protocol surface from Tools. Confirm Claude Code supports subscribing to MCP resources before building Phase 3's `@mention` feature.
- **Godot process lifecycle across Claude Code sessions:** Claude Code does not reliably terminate child MCP server processes on exit (documented issue #1935). The server must implement PID file tracking to clean up orphaned Godot processes from previous sessions. Design this in Phase 1, implement robustly in Phase 2.

## Sources

### Primary (HIGH confidence)
- `npm info @modelcontextprotocol/sdk` — confirmed 1.27.1 is current stable
- MCP SDK 1.27.1 package (local tar extract) — confirmed `McpServer`, `registerTool()`, zod peer dep, deprecated `server.tool()`
- `/usr/bin/godot --help` (v4.6.1.stable, installed on this machine) — all CLI flags verified directly
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) — transport requirements, Tool Search, project-scope config
- [MCP TypeScript SDK official docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) — `McpServer` pattern

### Secondary (MEDIUM confidence)
- [anthropics/claude-code GitHub issues](https://github.com/anthropics/claude-code/issues) — tool discovery bugs (#11175, #12164, #25440), orphaned processes (#1935), schema validation (#10606)
- [tugcantopaloglu/godot-mcp](https://github.com/tugcantopaloglu/godot-mcp), [HaD0Yun/godot-mcp](https://github.com/HaD0Yun/godot-mcp), [ee0pdt/Godot-MCP](https://github.com/ee0pdt/Godot-MCP) — competitor feature analysis
- [godotengine/godot-proposals #8664](https://github.com/godotengine/godot-proposals/discussions/8664) — headless `--script` execution model
- [godotengine/godot #83449](https://github.com/godotengine/godot/issues/83449) — import cache requirement for headless ops

### Tertiary (LOW confidence)
- [GoPeak/GDAI MCP feature claims](https://gdaimcp.com/) — screenshot capture, DAP runtime inspection; not independently verified
- [MCP Tool Search auto-activation at 10% context threshold](https://code.claude.com/docs/en/mcp) — mentioned in Claude Code docs but threshold not numerically confirmed in official source

---
*Research completed: 2026-03-03*
*Ready for roadmap: yes*
