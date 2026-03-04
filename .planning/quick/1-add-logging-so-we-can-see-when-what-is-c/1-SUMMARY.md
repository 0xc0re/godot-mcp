---
phase: quick
plan: 1
subsystem: observability
tags: [logging, stderr, mcp, instrumentation]

# Dependency graph
requires: []
provides:
  - Structured logger utility (src/logger.ts)
  - Automatic tool-call instrumentation via registerTool wrapper
affects: [all-tool-modules]

# Tech tracking
tech-stack:
  added: []
  patterns: [monkey-patch registerTool for cross-cutting concerns, structured stderr logging]

key-files:
  created: [src/logger.ts]
  modified: [src/index.ts]

key-decisions:
  - "Logger is a plain object (no class) for simplicity and tree-shaking"
  - "LOG_LEVEL env var defaults to info; DEBUG=true treated as debug level for backward compat"
  - "Tool args logged at debug level only to avoid noisy default output"
  - "Monkey-patch approach via wrapServerWithLogging avoids touching any tool files"

patterns-established:
  - "Logging wrapper pattern: wrapServerWithLogging intercepts registerTool before tool registration"
  - "Log format: [GODOT-MCP] [LEVEL] [ISO-TIMESTAMP] message"

requirements-completed: [LOGGING-01]

# Metrics
duration: 1min
completed: 2026-03-04
---

# Quick Task 1: Add Logging Summary

**Structured stderr logging with automatic tool-call instrumentation via LOG_LEVEL-controlled logger and registerTool monkey-patch**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-04T19:55:53Z
- **Completed:** 2026-03-04T19:57:17Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created structured logger module with debug/info/warn/error levels controlled by LOG_LEVEL env var
- Instrumented all tool calls automatically via registerTool wrapper (logs tool name, args at debug, duration, success/error)
- Replaced ad-hoc console.error calls in index.ts with structured logger
- All 331 existing tests pass unchanged, zero tool files modified

## Task Commits

Each task was committed atomically:

1. **Task 1: Create logger module with McpServer logging wrapper** - `545b416` (feat)
2. **Task 2: Integrate logging wrapper into server entry point** - `67c572b` (feat)

## Files Created/Modified
- `src/logger.ts` - Logger utility with debug/info/warn/error levels and wrapServerWithLogging function
- `src/index.ts` - Import logger, apply wrapServerWithLogging before tool registration, replace console.error calls

## Decisions Made
- Logger is a plain object with methods (not a class) -- simplest approach for a utility
- LOG_LEVEL env var defaults to info; also respects existing DEBUG=true convention by mapping it to debug level
- Tool arguments logged at debug level only to keep default output clean
- Monkey-patch via wrapServerWithLogging chosen to avoid modifying any of the 14 tool registration files
- Used `as any` casts on the registerTool override intentionally since SDK generics are complex and the wrapper is transparent

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. Logging is opt-in via LOG_LEVEL env var (defaults to info).

## Self-Check: PASSED

- src/logger.ts: FOUND
- src/index.ts: FOUND
- Commit 545b416: FOUND
- Commit 67c572b: FOUND

---
*Quick Task: 1*
*Completed: 2026-03-04*
