# Roadmap: Godot MCP Server

## Overview

Starting from a broken v0.1.1 (tools invisible in Claude Code due to SDK mismatch), this roadmap rebuilds the server into the definitive Godot 4.x MCP integration. Phase 1 fixes the blocking SDK incompatibility and refactors the monolith — nothing else matters until Claude Code can see the tools. Phase 2 closes the biggest competitive gap by adding headless scene read/modify capabilities. Phase 3 adds project-level configuration and script intelligence. Phase 4 delivers the two high-complexity external integrations: LSP diagnostics and screenshot capture.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - SDK upgrade + architectural refactor + process hardening; zero tools visible in Claude Code until this ships
- [ ] **Phase 2: Scene Intelligence** - Headless scene read/modify/inspect + GDScript parse error scanning; closes the biggest functional gap vs. competitors
- [ ] **Phase 3: Project & Script Intelligence** - Project settings read/modify, resource files, script structure summary, MCP resources for @mention
- [ ] **Phase 4: Diagnostics & Runtime** - GDScript LSP diagnostics, ClassDB introspection, screenshot capture for AI visual inspection

## Phase Details

### Phase 1: Foundation
**Goal**: All 14 existing tools are discoverable and working in Claude Code; codebase is modular and safe to extend
**Depends on**: Nothing (first phase)
**Requirements**: FOUN-01, FOUN-02, FOUN-03, FOUN-04, FOUN-05, FOUN-06, FOUN-07, FOUN-08
**Success Criteria** (what must be TRUE):
  1. Claude Code connects to the server and lists all 14 tools without any configuration workaround
  2. Every tool call returns a structured error with a suggested next step when it fails, not raw Godot stderr
  3. The server starts and shuts down cleanly — no zombie Godot processes left behind after SIGINT or SIGTERM
  4. No console.log output appears on stdout in the server process under any code path
  5. src/index.ts is under 100 lines; each tool domain lives in its own module under src/tools/
**Plans:** 3 plans

Plans:
- [ ] 01-01-PLAN.md — SDK upgrade to 1.27.1+, Zod dependency, migrate all 14 tools to McpServer.registerTool()
- [ ] 01-02-PLAN.md — Refactor monolithic index.ts into domain modules (types, errors, godot, tools/)
- [ ] 01-03-PLAN.md — Process hardening (maxBuffer/timeout), signal handlers (SIGINT/SIGTERM), error audit

### Phase 2: Scene Intelligence
**Goal**: An AI can read any scene tree, modify node properties, restructure scenes, and catch GDScript parse errors — all without opening the Godot editor
**Depends on**: Phase 1
**Requirements**: SCEN-01, SCEN-02, SCEN-03, SCEN-04, SCEN-05, SCEN-06, SCRI-01
**Success Criteria** (what must be TRUE):
  1. User can call read_scene and receive the full node hierarchy with types and properties as JSON
  2. User can modify a node's position, scale, or custom property by path and the change persists in the .tscn file
  3. User can remove a node from a scene and attach a GDScript file to a node in a single session
  4. User can create and read back a .tres resource file (material, curve, atlas)
  5. User can run a batch GDScript parse check and receive a list of files with errors and line numbers
**Plans:** 3 plans

Plans:
- [ ] 02-01-PLAN.md — TDD: .tscn/.tres text format parser (types + parser + tests)
- [ ] 02-02-PLAN.md — Scene tools: read_scene, modify_node_property, remove_node, attach_script (GDScript ops + MCP tools)
- [ ] 02-03-PLAN.md — Resource tools + script validation: create_resource, read_resource, validate_scripts (GDScript ops + MCP tools + wiring)

### Phase 3: Project & Script Intelligence
**Goal**: An AI can scaffold and configure a Godot project, read script structure without reading full files, and reference scenes/scripts as Claude Code @mentions
**Depends on**: Phase 2
**Requirements**: PROJ-01, PROJ-02, PROJ-03, SCRI-02, SCRI-04
**Success Criteria** (what must be TRUE):
  1. User can read project.godot and receive autoloads, input maps, and render config as structured JSON
  2. User can add an autoload or change a project setting programmatically without opening the editor
  3. User can list all project scripts and see each script's class name, exported variables, signals, and public methods
  4. User can query ClassDB for a Godot class and receive its properties, methods, and signals to verify API correctness
  5. User can @mention a scene or script in Claude Code and receive it as inline context
**Plans:** 3 plans

Plans:
- [ ] 03-01-PLAN.md — Project settings parser (TDD) + read_project_settings and modify_project_setting tools
- [ ] 03-02-PLAN.md — Script introspection: list_scripts and query_class GDScript operations + MCP tools
- [ ] 03-03-PLAN.md — MCP resources: scene and script @mention via ResourceTemplate registration

### Phase 4: Diagnostics & Runtime
**Goal**: An AI can get type-aware GDScript diagnostics from the live LSP and capture a screenshot of the running game for visual inspection
**Depends on**: Phase 3
**Requirements**: SCRI-03, RUNT-01
**Success Criteria** (what must be TRUE):
  1. User can request GDScript diagnostics for a file and receive type errors and undefined variable warnings from Godot's LSP
  2. User can capture a screenshot of the running game and the image is available for AI visual inspection
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete | 2026-03-03 |
| 2. Scene Intelligence | 3/3 | Complete | 2026-03-03 |
| 3. Project & Script Intelligence | 0/3 | Not started | - |
| 4. Diagnostics & Runtime | 0/TBD | Not started | - |
