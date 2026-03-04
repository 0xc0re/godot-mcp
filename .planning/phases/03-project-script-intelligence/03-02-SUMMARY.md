---
phase: 03-project-script-intelligence
plan: 02
subsystem: api
tags: [godot, gdscript, classdb, script-introspection, mcp-tools]

# Dependency graph
requires:
  - phase: 03-project-script-intelligence
    provides: "validate_scripts tool pattern, find_gd_files helper, executeOperation dispatch"
provides:
  - "list_scripts MCP tool for project script introspection"
  - "query_class MCP tool for ClassDB metadata queries"
  - "list_scripts GDScript operation (method/property/signal extraction)"
  - "query_class GDScript operation (ClassDB reflection)"
affects: [03-project-script-intelligence]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Script introspection via get_script_method_list/property_list/signal_list", "ClassDB reflection via class_get_method_list/property_list/signal_list with no_inheritance flag"]

key-files:
  created: []
  modified:
    - src/tools/script.ts
    - src/scripts/godot_operations.gd
    - tests/script-tools.test.ts

key-decisions:
  - "list_scripts filters methods starting with _ (private/virtual) and properties by PROPERTY_USAGE_SCRIPT_VARIABLE"
  - "query_class returns raw JSON.stringify(result, null, 2) for maximum flexibility rather than formatted text"
  - "Both tools reuse existing find_gd_files helper and JSON-from-mixed-output parsing pattern"

patterns-established:
  - "Script introspection: load GDScript, extract methods/properties/signals via reflection API"
  - "ClassDB queries: class_exists check, parent_class lookup, property/method/signal enumeration with inheritance control"

requirements-completed: [SCRI-02, SCRI-04]

# Metrics
duration: 3min
completed: 2026-03-04
---

# Phase 03 Plan 02: Script Introspection and ClassDB Query Summary

**list_scripts tool for per-script method/property/signal introspection and query_class tool for ClassDB metadata with optional inheritance filtering**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-04T00:46:11Z
- **Completed:** 2026-03-04T00:48:45Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 3

## Accomplishments
- list_scripts tool introspects all project GDScripts returning class name, public methods, exported properties, and signals per script
- query_class tool queries Godot ClassDB for any engine class's properties, methods, and signals with optional no_inheritance filtering
- Both operations handle edge cases gracefully (missing class returns error JSON, failed script load is skipped)
- 9 new tests for list_scripts and query_class, 110 total tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add list_scripts and query_class GDScript operations and MCP tools (TDD)**
   - `71b89f2` (test) - RED: failing tests for list_scripts and query_class
   - `e663fe1` (feat) - GREEN: implement list_scripts and query_class tools

_Note: TDD tasks have multiple commits (test -> feat)_

## Files Created/Modified
- `src/tools/script.ts` - Added list_scripts and query_class MCP tool registrations with JSON parsing and error handling
- `src/scripts/godot_operations.gd` - Added list_scripts operation (script reflection) and query_class operation (ClassDB reflection) with dispatch entries
- `tests/script-tools.test.ts` - Extended with 9 new tests for list_scripts (5) and query_class (4)

## Decisions Made
- list_scripts filters out methods starting with `_` (private/virtual) and only includes properties with `PROPERTY_USAGE_SCRIPT_VARIABLE` flag to show user-relevant members
- query_class returns `JSON.stringify(result, null, 2)` as raw JSON for maximum AI flexibility rather than formatted text summary
- Both tools reuse existing `find_gd_files` helper and the "find first line starting with {" JSON extraction pattern from validate_scripts

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Script introspection and ClassDB query capabilities complete
- AI can now understand project script structure and verify Godot API correctness
- Ready for Plan 03 (project intelligence analysis)

## Self-Check: PASSED

- All 3 modified files exist on disk
- All 2 task commits verified in git history (71b89f2, e663fe1)
- All key links verified (list_scripts and query_class in script.ts and godot_operations.gd)
- Min_lines threshold met (script-tools.test.ts: 303 lines, min 100)
- 110/110 tests pass, TypeScript compiles cleanly

---
*Phase: 03-project-script-intelligence*
*Completed: 2026-03-04*
