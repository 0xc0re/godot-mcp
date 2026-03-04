---
phase: 08-runtime-inspection-reload
plan: 02
subsystem: runtime
tags: [godot, hot-reload, restart, process-management, spawn]

# Dependency graph
requires:
  - phase: 08-runtime-inspection-reload
    provides: runtime.ts inspection tools and registerRuntimeTools function
provides:
  - restart_project tool for stop+run hot-reload cycle
  - Full MCP server registration for all 4 runtime tools
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [process kill+respawn cycle with exit wait and stdout confirmation]

key-files:
  created: []
  modified:
    - src/tools/runtime.ts
    - tests/runtime-tools.test.ts
    - src/index.ts

key-decisions:
  - "restart_project reuses run_project spawn pattern from editor.ts (args, stdio, listeners)"
  - "Exit wait uses 3s timeout to handle processes that don't exit cleanly on kill"
  - "Running confirmation via stdout.once('data') with 5s timeout (engine prints version on startup)"
  - "Scene parameter validated via validatePath before inclusion in spawn args"

patterns-established:
  - "Process restart: kill -> wait for exit -> null activeProcess -> spawn new -> confirm running"

requirements-completed: [HTRL-01, HTRL-02]

# Metrics
duration: 2min
completed: 2026-03-04
---

# Phase 8 Plan 2: Restart Project Tool & Server Registration Summary

**restart_project tool implementing stop+run hot-reload cycle with PID confirmation, wired into MCP server alongside 3 inspection tools**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-04T05:49:01Z
- **Completed:** 2026-03-04T05:51:28Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- restart_project tool kills active Godot process, waits for exit, spawns new process with running confirmation
- Optional scene parameter forwarded to spawn args for targeted scene restart
- All 4 runtime tools registered in MCP server after Phase 7 tools
- 20 unit tests for runtime tools (14 inspection + 6 restart), full suite at 331 tests

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests for restart_project** - `afaa1f0` (test)
2. **Task 1 GREEN: Implement restart_project tool** - `e612b70` (feat)
3. **Task 2: Wire runtime tools into index.ts** - `3c63323` (feat)

_Note: Task 1 followed TDD with RED and GREEN commits._

## Files Created/Modified
- `src/tools/runtime.ts` - Added restart_project tool with kill+spawn cycle, exit wait, stdout running confirmation
- `tests/runtime-tools.test.ts` - 6 new tests for restart_project (registration, no-process error, invalid path, kill+spawn, scene param, running confirmation)
- `src/index.ts` - Import and registration of registerRuntimeTools after Phase 7 tilemap tools

## Decisions Made
- Reused run_project spawn pattern from editor.ts for consistency (args structure, stdio pipe, listeners)
- 3s timeout on process exit wait to handle processes that don't exit cleanly
- Running confirmation via stdout.once('data') with 5s timeout (Godot prints engine version on startup)
- Scene parameter validated with validatePath before inclusion in args

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 8 complete: all runtime inspection and hot-reload tools implemented and registered
- All v2.0 milestone phases (05-08) complete
- 331 tests passing across full suite

## Self-Check: PASSED

All 3 files verified present. All 3 commits verified in git log.

---
*Phase: 08-runtime-inspection-reload*
*Completed: 2026-03-04*
