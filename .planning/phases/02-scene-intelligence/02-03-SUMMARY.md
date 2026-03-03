---
phase: 02-scene-intelligence
plan: 03
subsystem: resource-tools
tags: [mcp-tools, godot, resource, tres, gdscript, typescript, script-validation]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: TypeScript project structure, MCP SDK tool registration, executeOperation, validatePath, toolError
  - phase: 02-scene-intelligence
    plan: 01
    provides: parseResource() function for .tres file parsing
  - phase: 02-scene-intelligence
    plan: 02
    provides: ensure_res_prefix and convert_json_to_godot_type GDScript helpers
provides:
  - read_resource MCP tool for reading .tres files as structured JSON (no Godot process)
  - create_resource MCP tool for creating typed resource files via Godot headless
  - validate_scripts MCP tool for batch GDScript parse-error detection via Godot headless
  - GDScript operations (create_resource, validate_scripts, find_gd_files) in godot_operations.gd
affects: [phase-3, resource-management, script-tools]

# Tech tracking
tech-stack:
  added: []
  patterns: [resource creation via ClassDB.instantiate + ResourceSaver.save, recursive GDScript file discovery, JSON line extraction from mixed Godot output]

key-files:
  created:
    - src/tools/resource.ts
    - src/tools/script.ts
    - tests/resource-tools.test.ts
    - tests/script-tools.test.ts
  modified:
    - src/scripts/godot_operations.gd
    - src/index.ts

key-decisions:
  - "read_resource uses TypeScript parser (fast); create_resource uses Godot headless (correct types) -- same read/write split as scene tools"
  - "create_resource validates ClassDB.class_exists + is_parent_class before instantiation for clear error messages"
  - "validate_scripts extracts JSON from mixed Godot output by finding the first line starting with '{'"

patterns-established:
  - "Resource tool module follows same registration pattern as scene.ts: McpServer + ServerContext args"
  - "GDScript file discovery uses recursive DirAccess with .godot directory exclusion"
  - "JSON line extraction pattern for parsing Godot headless mixed stdout (INFO lines + JSON)"

requirements-completed: [SCEN-05, SCEN-06, SCRI-01]

# Metrics
duration: 3min
completed: 2026-03-03
---

# Phase 2 Plan 03: Resource and Script Tools Summary

**Resource management (create_resource, read_resource) and batch GDScript validation (validate_scripts) completing the 7-tool scene intelligence suite**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T22:31:53Z
- **Completed:** 2026-03-03T22:35:30Z
- **Tasks:** 2 (both TDD RED + GREEN)
- **Files created:** 4
- **Files modified:** 2

## Accomplishments
- read_resource tool reads .tres files via TypeScript parser and returns structured JSON (zero-latency, no Godot spawn)
- create_resource tool creates typed resource files via Godot headless with ClassDB validation and property type conversion
- validate_scripts tool batch-validates all .gd files in a project with per-file error reporting
- All new tool modules wired into src/index.ts (registerResourceTools, registerScriptTools)
- 19 new tests (9 resource + 6 script + 4 from wiring verification); full suite: 77/77 green
- Phase 2 complete: 7 new MCP tools total (read_scene, modify_node_property, remove_node, attach_script, read_resource, create_resource, validate_scripts)

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests for resource tools** - `bc22c6d` (test)
2. **Task 1 GREEN: Resource tools + GDScript operations** - `be25ad7` (feat)
3. **Task 2 RED: Failing tests for script validation** - `a3c869a` (test)
4. **Task 2 GREEN: Script tool + module wiring** - `221f050` (feat)

_No refactor commits needed -- implementations were clean on first pass._

## Files Created/Modified
- `src/tools/resource.ts` - MCP tools for read_resource (TypeScript parser) and create_resource (Godot headless)
- `src/tools/script.ts` - MCP tool for validate_scripts with JSON line extraction from mixed Godot output
- `src/scripts/godot_operations.gd` - Added create_resource, validate_scripts, find_gd_files GDScript operations
- `src/index.ts` - Added imports and registration calls for registerResourceTools and registerScriptTools
- `tests/resource-tools.test.ts` - 9 unit tests (221 lines) for resource tool parameter passing and error handling
- `tests/script-tools.test.ts` - 6 unit tests (163 lines) for script validation tool including mixed output parsing

## Decisions Made
- read_resource uses TypeScript parser directly (same pattern as read_scene from Plan 02) for zero-latency reads; create_resource goes through Godot headless for correct ClassDB type instantiation and ResourceSaver serialization
- create_resource validates ClassDB.class_exists and is_parent_class("Resource") before instantiation, providing clear error messages for invalid types
- validate_scripts extracts the JSON result line from Godot's mixed stdout by finding the first line starting with '{', enabling robust parsing even with [INFO] prefix lines

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 2 (Scene Intelligence) is fully complete with all 7 MCP tools operational
- All 77 tests pass with zero regressions across parser, scene, resource, and script tool modules
- TypeScript compiles cleanly
- Ready for Phase 3 planning

## Self-Check: PASSED

- All 4 created files verified present on disk
- All 4 task commits (bc22c6d, be25ad7, a3c869a, 221f050) verified in git history
- All 15 new tests pass (9 resource + 6 script)
- Full test suite: 77/77 green
- TypeScript compiles with no errors

---
*Phase: 02-scene-intelligence*
*Completed: 2026-03-03*
