# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-03-04
**Phases:** 4 | **Plans:** 12 | **Sessions:** ~3

### What Was Built
- Complete MCP server rebuild: 22 tools covering scene, project, script, diagnostics, and runtime
- TypeScript parsers for .tscn, .tres, and project.godot formats (fast reads)
- GDScript operations for headless writes (correct types)
- LSP TCP client for real-time GDScript diagnostics
- Screenshot capture with auto-resize pipeline
- MCP resource templates for @mention support in Claude Code

### What Worked
- TDD approach: failing tests first, then implementation — caught type mismatches early
- Read/write split pattern (TS parser for reads, GDScript headless for writes) scaled perfectly across scene, resource, and project tools
- Research-first planning: each phase had dedicated research before plan creation
- Wave-based parallel execution kept total time to ~7 hours for 12 plans
- Vitest + mocking strategy made testing Godot interactions fast without real processes

### What Was Inefficient
- ROADMAP.md had phases 1-3 marked as `[ ]` even after completion — only phase 4 was properly checked off
- Some decisions were duplicated in STATE.md (e.g., "GODOT_PROJECT_PATH env var" appeared twice)
- Initial concern about .tscn corruption turned out to be unfounded — the read/write split avoided it entirely

### Patterns Established
- **Read/write split**: TypeScript parsers for reads, GDScript headless for writes — use everywhere
- **JSON-from-mixed-output**: Extract JSON by finding first `{` line in Godot output
- **find_gd_files helper**: Reusable GDScript file discovery across tools
- **toolError() for all failures**: Consistent structured error responses with suggested next steps
- **Port separation**: MCP-spawned services on different ports than user's editor (6014 vs 6005)

### Key Lessons
1. The MCP SDK upgrade was the highest-leverage fix — everything else was blocked until tools were visible
2. TypeScript text parsers for Godot formats are fast and reliable; avoid Godot headless for reads
3. Graceful degradation (empty results on timeout) is better UX than hard errors for optional features
4. LSP integration is straightforward once you handle the JSON-RPC framing — the protocol is well-specified

### Cost Observations
- Model mix: ~80% sonnet (execution), ~15% haiku (verification), ~5% opus (planning)
- Sessions: ~3
- Notable: 12 plans in ~7 hours total — average 35 min/plan including research and verification

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~3 | 4 | Established TDD + read/write split pattern |

### Cumulative Quality

| Milestone | Tests | Coverage | UAT Pass Rate |
|-----------|-------|----------|---------------|
| v1.0 | 143+ | N/A | 15/15 (100%) |

### Top Lessons (Verified Across Milestones)

1. TDD catches integration issues early — especially with external tool (Godot) interactions
2. Read/write split (fast parser for reads, authoritative tool for writes) scales across domains
