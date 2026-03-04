# Requirements: Godot MCP Server

**Defined:** 2026-03-03
**Core Value:** An AI assistant connected via this server can perform any Godot development operation that a human developer would do

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Foundation

- [x] **FOUN-01**: MCP SDK upgraded from 0.6.0 to latest (1.27.1+) so tools are discoverable by Claude Code
- [x] **FOUN-02**: All tool handlers migrated from deprecated `server.tool()` to `McpServer.registerTool()` API
- [x] **FOUN-03**: Zod added as explicit dependency (^3.25.0+) per SDK 1.x requirements
- [x] **FOUN-04**: Process execution hardened with `maxBuffer`, `timeout`, and zombie process prevention
- [x] **FOUN-05**: Every tool returns actionable error messages with suggested next steps, not raw Godot stderr
- [x] **FOUN-06**: Monolithic `src/index.ts` refactored into domain modules (one module per tool category)
- [x] **FOUN-07**: Stdout/stderr separation enforced — zero `console.log` in server code (all logs to stderr)
- [x] **FOUN-08**: SIGINT and SIGTERM handlers registered for reliable cleanup of child processes

### Scene Management

- [x] **SCEN-01**: User can read/inspect a scene tree as structured JSON (nodes, types, properties, hierarchy)
- [x] **SCEN-02**: User can modify node properties headlessly (position, scale, visibility, custom properties)
- [x] **SCEN-03**: User can remove a node from a scene by path
- [x] **SCEN-04**: User can attach a GDScript file to a node in a scene
- [x] **SCEN-05**: User can create Godot resource files (.tres) for materials, curves, atlases
- [x] **SCEN-06**: User can read/inspect Godot resource files (.tres) as structured data

### Script & Code Intelligence

- [x] **SCRI-01**: User can batch-validate all GDScript files for parse errors via `godot --check-only --headless`
- [x] **SCRI-02**: User can list all project scripts with structure summary (exported functions, variables, signals)
- [ ] **SCRI-03**: User can get real-time GDScript diagnostics via Godot's LSP (syntax errors, type warnings)
- [x] **SCRI-04**: User can query Godot's ClassDB for class properties, methods, and signals to prevent AI hallucination

### Project Management

- [x] **PROJ-01**: User can read project.godot settings (autoloads, input maps, render config, features)
- [x] **PROJ-02**: User can modify project.godot settings programmatically (add autoloads, change settings)
- [ ] **PROJ-03**: MCP resources exposed so users can @mention scenes and scripts as context in Claude Code

### Runtime & Debug

- [ ] **RUNT-01**: User can capture a screenshot of the running game for AI visual inspection

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Runtime & Debug

- **RUNT-02**: Runtime scene tree inspection via DAP (Debug Adapter Protocol)
- **RUNT-03**: Export project headlessly for Web/Windows/Linux builds

### Advanced Integration

- **ADVN-01**: Tool search / pagination for when tool count exceeds ~30
- **ADVN-02**: Hot-reload GDScript changes in running project

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Godot 3.x support | Godot 4.x is the current standard; APIs are incompatible |
| 100+ tools approach | Destroys context budget (~55k tokens); target ~30 focused tools |
| Runtime arbitrary code execution | Shell injection vector; exposes specific parameterized operations instead |
| Replace Godot editor | AI augments the editor workflow, doesn't replace it |
| Built-in asset generation (AI art/audio) | Out of scope for engine integration; handled by dedicated tools |
| HTTP transport / remote access | Godot is a local tool; stdio transport is correct |
| Full-project AI analysis | Token budget explosion; provide targeted tools and let AI compose |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUN-01 | Phase 1 | Complete |
| FOUN-02 | Phase 1 | Complete |
| FOUN-03 | Phase 1 | Complete |
| FOUN-04 | Phase 1 | Complete |
| FOUN-05 | Phase 1 | Complete |
| FOUN-06 | Phase 1 | Complete |
| FOUN-07 | Phase 1 | Complete |
| FOUN-08 | Phase 1 | Complete |
| SCEN-01 | Phase 2 | Complete |
| SCEN-02 | Phase 2 | Complete |
| SCEN-03 | Phase 2 | Complete |
| SCEN-04 | Phase 2 | Complete |
| SCEN-05 | Phase 2 | Complete |
| SCEN-06 | Phase 2 | Complete |
| SCRI-01 | Phase 2 | Complete |
| SCRI-02 | Phase 3 | Complete |
| SCRI-03 | Phase 4 | Pending |
| SCRI-04 | Phase 3 | Complete |
| PROJ-01 | Phase 3 | Complete |
| PROJ-02 | Phase 3 | Complete |
| PROJ-03 | Phase 3 | Pending |
| RUNT-01 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-03*
*Last updated: 2026-03-03 after 02-01 parser plan completion*
