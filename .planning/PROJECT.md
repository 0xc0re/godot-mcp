# Godot MCP Server

## What This Is

The definitive MCP (Model Context Protocol) server for Godot Engine development. A TypeScript server that enables AI assistants — Claude Code, Cline, Cursor, and others — to create, modify, run, debug, and manage Godot 4.x projects through a comprehensive set of MCP tools. Currently at v0.1.1 with 12 tools and an older MCP SDK (0.6.0); the goal is to upgrade, expand, and polish it into the best Godot MCP server available.

## Core Value

An AI assistant connected via this server can perform any Godot development operation that a human developer would do — from creating scenes and writing GDScript to running the project and inspecting runtime state.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ MCP server connects via stdio transport — existing
- ✓ Godot path auto-detection across platforms — existing
- ✓ Create and manage scenes (create_scene, add_node) — existing
- ✓ Run and stop Godot projects (run_project, stop_project) — existing
- ✓ Get debug output from running projects — existing
- ✓ Create and update GDScript files — existing
- ✓ Launch Godot editor — existing
- ✓ List project files and scan project structure — existing
- ✓ Path traversal attack prevention — existing
- ✓ Parameter case conversion (camelCase ↔ snake_case) — existing
- ✓ Security-hardened process execution via execFile — existing
- ✓ Cross-platform Godot path detection (Linux, macOS, Windows) — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] Upgrade MCP SDK to latest version for Claude Code compatibility
- [ ] Fix tool discovery so tools appear in Claude Code
- [ ] Scene management: read, modify, inspect, and query scene structure
- [ ] GDScript analysis: parse, lint, and understand script structure
- [ ] Node tree inspection: walk and query scene trees at runtime
- [ ] Project scaffolding: generate structure, add autoloads, configure project settings
- [ ] Asset management: handle sprites, resources, shaders, and the asset pipeline
- [ ] Enhanced run/debug: richer debug output, breakpoint-like inspection, log streaming
- [ ] Resource tools: inspect and modify Godot resources (.tres, .tscn)
- [ ] Comprehensive error handling with actionable guidance

### Out of Scope

- Godot 3.x support — Godot 4.x is the current standard, no reason to support legacy
- Built-in game logic / AI — this server enables development, it doesn't play the game
- Visual editor replacement — augments the workflow, doesn't replace Godot's editor UI

## Context

- **Existing codebase:** ~2200 lines in `src/index.ts` (monolithic), plus `godot_operations.gd` for GDScript-side operations
- **Current architecture:** Single-class `GodotServer` handles everything — MCP protocol, tool dispatch, Godot process management, validation
- **MCP SDK:** Currently on 0.6.0, significantly behind current releases
- **Known issue:** Tools don't appear when connected from Claude Code — likely related to SDK version or protocol handshake differences
- **Primary use case:** Developing BFG (Best Friend Game) — an isometric roguelike built in Godot 4.6 at ~/src/bfg
- **Published on npm:** as godot-mcp, version 0.1.1

## Constraints

- **Runtime:** Node.js >= 18.0.0
- **External dependency:** Requires Godot Engine installed on the host system

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Upgrade MCP SDK to latest | Current 0.6.0 likely causes Claude Code incompatibility | — Pending |
| Keep TypeScript | Existing codebase, good MCP SDK support, no reason to switch | — Pending |
| General-purpose server | BFG is the first use case but server should work with any Godot project | — Pending |
| Refactor monolithic index.ts | 2200 lines in one file is unmaintainable as tool count grows | — Pending |

---
*Last updated: 2026-03-03 after initialization*
