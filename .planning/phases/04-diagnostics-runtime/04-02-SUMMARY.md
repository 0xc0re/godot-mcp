---
phase: 04-diagnostics-runtime
plan: 02
subsystem: runtime
tags: [screenshot, viewport-capture, gdscript, base64, mcp-image, autoload]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: editor tools registration pattern, process tracking, validatePath
provides:
  - capture_screenshot MCP tool returning base64 PNG image content
  - screenshot_helper.gd GDScript autoload for viewport capture via trigger file
  - Image resize pipeline via Godot headless for Claude Desktop 1MB limit
affects: [runtime-tools, visual-debugging]

# Tech tracking
tech-stack:
  added: []
  patterns: [file-based trigger coordination between MCP server and GDScript autoload, MCP image content type response, Godot headless image resize]

key-files:
  created:
    - src/scripts/screenshot_helper.gd
    - tests/screenshot-tools.test.ts
  modified:
    - src/tools/editor.ts
    - scripts/build.js

key-decisions:
  - "Fixed project-relative paths (res://.godot/) for trigger/output -- no CLI args needed"
  - "800KB threshold for resize (conservative under Claude Desktop 1MB limit)"
  - "Godot headless resize to 960x540 via spawned GDScript (reuses ctx.godotPath)"

patterns-established:
  - "File-based trigger coordination: MCP writes trigger file, GDScript polls and writes output"
  - "MCP image content: type: 'image', data: base64, mimeType: 'image/png'"

requirements-completed: [RUNT-01]

# Metrics
duration: 3min
completed: 2026-03-04
---

# Phase 4 Plan 2: Screenshot Capture Summary

**capture_screenshot MCP tool with GDScript autoload for viewport capture, file-based trigger coordination, and Godot headless resize for Claude Desktop 1MB limit**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-04T01:19:20Z
- **Completed:** 2026-03-04T01:22:06Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 4

## Accomplishments
- GDScript autoload that polls res://.godot/screenshot_trigger and captures viewport via RenderingServer.frame_post_draw
- capture_screenshot MCP tool returning base64 PNG image content with correct mimeType
- Automatic image resize to 960x540 when screenshot exceeds 800KB threshold
- 8 unit tests covering error cases (no process, timeout, invalid path) and success cases (image return, trigger file, cleanup, resize)

## Task Commits

Each task was committed atomically (TDD workflow):

1. **Task 1 RED: Failing tests for capture_screenshot** - `e057898` (test)
2. **Task 1 GREEN: Implement capture_screenshot tool and GDScript helper** - `026b532` (feat)

## Files Created/Modified
- `src/scripts/screenshot_helper.gd` - GDScript autoload that polls trigger file and captures viewport to PNG
- `src/tools/editor.ts` - Added capture_screenshot tool with trigger, polling, resize, and base64 return
- `tests/screenshot-tools.test.ts` - 8 unit tests for all capture_screenshot behaviors
- `scripts/build.js` - Added screenshot_helper.gd to build copy step

## Decisions Made
- Fixed project-relative paths (res://.godot/) for trigger and output files -- avoids CLI arg parsing in GDScript and works with any running game that has the autoload
- 800KB resize threshold (conservative under Claude Desktop's 1MB content limit)
- Resize via spawned Godot headless with inline GDScript -- reuses existing ctx.godotPath, no new dependencies
- Added screenshot_helper.gd to build script for distribution alongside the MCP server

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added screenshot_helper.gd to build script**
- **Found during:** Task 1 (implementation)
- **Issue:** Build script only copied godot_operations.gd; screenshot_helper.gd would not be distributed
- **Fix:** Added fs.copyFileSync for screenshot_helper.gd in scripts/build.js
- **Files modified:** scripts/build.js
- **Verification:** `npm run build` succeeds and copies both .gd files
- **Committed in:** 026b532 (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Auto-fix ensures screenshot helper is distributed with the package. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Users must add screenshot_helper.gd as an autoload to their Godot project for capture_screenshot to work (documented in tool description).

## Next Phase Readiness
- Screenshot capture tool complete and tested
- Ready for Phase 4 Plan 3 (if applicable) or phase completion verification

## Self-Check: PASSED

- FOUND: src/scripts/screenshot_helper.gd
- FOUND: src/tools/editor.ts
- FOUND: tests/screenshot-tools.test.ts
- FOUND: 04-02-SUMMARY.md
- FOUND: commit e057898
- FOUND: commit 026b532

---
*Phase: 04-diagnostics-runtime*
*Completed: 2026-03-04*
