# Godot MCP Server

## What This Is

The definitive MCP (Model Context Protocol) server for Godot Engine 4.x development. A TypeScript server that enables AI assistants — Claude Code, Cline, Cursor, and others — to create, modify, run, debug, and manage Godot 4.x projects through 22 MCP tools covering scene management, project settings, script intelligence, LSP diagnostics, and screenshot capture.

## Core Value

An AI assistant connected via this server can perform any Godot development operation that a human developer would do — from creating scenes and writing GDScript to running the project and inspecting runtime state.

## Requirements

### Validated

- ✓ MCP SDK upgraded to 1.27.1+ with registerTool() API — v1.0
- ✓ All tools discoverable in Claude Code — v1.0
- ✓ Modular architecture: src/index.ts < 100 lines, domain modules under src/tools/ — v1.0
- ✓ Process hardening: maxBuffer, timeout, zombie prevention, signal handlers — v1.0
- ✓ Structured error responses with actionable guidance on all tools — v1.0
- ✓ Scene management: read/modify/inspect scene trees headlessly — v1.0
- ✓ Resource tools: create and read .tres files (materials, curves, atlases) — v1.0
- ✓ GDScript batch validation via godot --check-only --headless — v1.0
- ✓ Project settings: read/modify project.godot as structured JSON — v1.0
- ✓ Script introspection: list_scripts with methods, properties, signals — v1.0
- ✓ ClassDB queries: query_class for API correctness verification — v1.0
- ✓ MCP resources: @mention scenes and scripts in Claude Code — v1.0
- ✓ GDScript LSP diagnostics via TCP with auto-spawned headless editor — v1.0
- ✓ Screenshot capture with auto-resize for AI visual inspection — v1.0
- ✓ Stdio transport, cross-platform Godot path detection — existing
- ✓ Path traversal attack prevention — existing
- ✓ Run/stop Godot projects with debug output — existing

### Active

- [ ] Runtime scene tree inspection via DAP (Debug Adapter Protocol)
- [ ] Export project headlessly for Web/Windows/Linux builds
- [ ] Tool search/pagination for when tool count exceeds ~30
- [ ] Hot-reload GDScript changes in running project

### Out of Scope

- Godot 3.x support — Godot 4.x is the current standard; APIs are incompatible
- 100+ tools approach — destroys context budget (~55k tokens); target ~30 focused tools
- Runtime arbitrary code execution — shell injection vector; expose parameterized operations instead
- Replace Godot editor — augments the workflow, doesn't replace it
- Built-in asset generation (AI art/audio) — handled by dedicated tools
- HTTP transport / remote access — Godot is a local tool; stdio transport is correct
- Full-project AI analysis — token budget explosion; provide targeted tools and let AI compose

## Context

Shipped v1.0 with 10,727 LOC (7,141 TypeScript + 3,586 GDScript).
Tech stack: TypeScript, MCP SDK 1.27.1+, Zod, Vitest, GDScript.
Architecture: Modular tools (src/tools/), TypeScript parsers for reads, GDScript headless for writes.
Published on npm as godot-mcp.
Primary use case: Developing BFG (Best Friend Game) — an isometric roguelike in Godot 4.6.

## Constraints

- **Runtime:** Node.js >= 18.0.0
- **External dependency:** Requires Godot Engine installed on the host system

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Upgrade MCP SDK to 1.27.1+ | Current 0.6.0 caused Claude Code incompatibility | ✓ Good — tools now discoverable |
| Keep TypeScript + stdio transport | Existing codebase, good SDK support, correct for local tool | ✓ Good — stable foundation |
| General-purpose server (not BFG-specific) | Server should work with any Godot project | ✓ Good — npm-publishable |
| Refactor monolithic index.ts | 2200 lines unmaintainable as tool count grows | ✓ Good — index.ts now < 100 lines |
| TypeScript reads / GDScript writes | TS parser is fast; Godot headless ensures correct types | ✓ Good — consistent pattern across scene/resource/project |
| Properties as raw strings in parser | No type conversion needed; Godot handles types | ✓ Good — simpler parser, fewer bugs |
| LSP on port 6014 (not 6005) | Avoid conflict with user's Godot editor | ✓ Good — no user-visible issues |
| Graceful degradation (empty results on timeout) | Better UX than hard errors for LSP/diagnostics | ✓ Good — non-blocking workflow |

---
*Last updated: 2026-03-04 after v1.0 milestone*
