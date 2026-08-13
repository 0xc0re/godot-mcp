# Codebase Concerns

**Analysis Date:** 2026-08-13 (regenerated after v2.1-hardening Tracks A-C; supersedes the 2026-03-03 audit, which described the pre-refactor monolith)

Status of the 2026-03-03 concerns: most are **resolved** by the v2.1-hardening branch — silent false-success (three-tier runOperation verdicts + GDScript fail() sweep), hardcoded debug mode (GODOT_DEBUG env gate), path validation bypass (validatePath hardening + resolveWithinProject containment incl. symlink realpath), GDScript injection in screenshot resize (static resize_image.gd), duplicated error preambles (withProject()), process output growth (1000-line bounded windows), sequential collision-op spawns (batched), scaffold clobbering (overwrite flag, default deny), missing tests/CI (736 tests, 33 files, GitHub Actions on Node 20+22), version drift (0.2.0 single-sourced from package.json). Items below are what actually remains.

## Still Live

### validatePath is a shallow gate, not a sandbox

**Issue:** `validatePath()` (src/godot.ts:31) rejects only empty/non-string, null bytes, and `..`. Any absolute path passes — by design, since `project_path` may legitimately point anywhere on disk. Real containment is enforced one level down by `resolveWithinProject()` for project-relative parameters, and MCP resource reads are containment-checked.

**Residual risk:** the server will operate on any directory containing a project.godot the host user can read; there is no allowlist of permitted project roots. Acceptable for a local single-user stdio tool; revisit if the server ever gains a remote transport.

### Debug logging can leak paths and parameters

**Issue:** With `LOG_LEVEL=debug` (or `DEBUG=true`), logger.debug output includes absolute paths and full operation parameter JSON on stderr. `GODOT_DEBUG=true` additionally passes `--debug-godot` to Godot spawns.

**Status:** Both are now opt-in (resolved vs. the old always-on `--debug-godot`), but there is no redaction. Do not enable debug logging where stderr is captured by CI or log aggregators.

### validatedPaths cache grows without bound

**Issue:** `ServerContext.validatedPaths` (src/server.ts:21) is a Map that accumulates an entry per Godot-executable path checked and is never evicted.

**Impact:** Negligible in practice (entries are Godot install paths, not project files), but it is the one remaining unbounded collection. LRU/TTL if it ever matters.

### list_projects recursive search has no depth limit

**Issue:** `findGodotProjects(directory, recursive=true)` (src/tools/project.ts) recurses the full directory tree (dot-dirs skipped). Running it against `/` or a huge tree is slow and file-descriptor hungry.

**Fix approach:** max-depth parameter with a sane default, or a file-count circuit breaker.

### Single active process only

**Issue:** `ctx.activeProcess` holds exactly one running game; `run_project` kills any previous process. Multiple concurrent projects are not supported (scaling limit carried from the original design; fine for the single-assistant use case).

### Helper autoload install is permanent

**Issue:** `run_project`/`restart_project` auto-install RuntimeHelper/ScreenshotHelper into the user's project (addons/godot_mcp/ + project.godot autoload entries) and never remove them. Documented in README; Track E1 (v2.1-PLAN) plans a temporary inject-and-restore lifecycle that supersedes this.

### Stale in-source description for capture_screenshot

**Issue:** The `capture_screenshot` tool description (src/tools/editor.ts:~230) still says the ScreenshotHelper autoload "must be added to the Godot project" manually — obsolete since auto-registration landed (T12). Doc-only, src-frozen during Track D; fix with the next src change (likely subsumed by Track E1).

### EXPECTED_TOOLS module grouping drift (comment-level)

**Issue:** In tests/tool-registration.test.ts, `batch_set_properties` is listed under the `runtime` group and `inspect_group` under `composition`, but the source modules register them the other way around (composition.ts registers batch_set_properties; runtime.ts registers inspect_group). The test only asserts the union, so it passes; the grouping is misleading to readers. One-line swap next time tests are open.

### appendCapped counts split artifacts toward the cap

**Issue:** Process output is split on `\n` before `appendCapped()`, so empty-string artifacts from chunk boundaries count toward the 1000-line window — the effective window of real lines can be slightly smaller than documented (T12 ledger, minor).

### Headless texture loading guidance, not validation

**Issue:** Texture-dependent operations (create_tileset, load_sprite, create_shader_material, etc.) can behave differently under `--headless` (textures may load as null without a display server). v2.1 added headless-awareness guidance in godot_operations.gd rather than hard validation; results for texture-heavy operations in headless CI environments should still be treated with suspicion.

### GDScript backend is a single 2.5k-line file

**Issue:** src/scripts/godot_operations.gd concentrates all ~40 write operations in one file with a match dispatcher. Deliberate (single bundled payload, no temp files), but it is the largest single maintenance surface and has no unit-test harness of its own — coverage comes from the TypeScript verdict tests plus live smokes.

## Test Coverage Gaps

- **No automated E2E against a real Godot binary** — the suite fully mocks Godot; live smokes are manual (CONTRIBUTING.md documents the scratch-project pattern). A CI job with an actual Godot download would catch GDScript regressions the mocks cannot.
- **runtime_helper.gd / screenshot_helper.gd logic untested** — the file-polling IPC helpers are only exercised indirectly through mocked triggerAndPoll tests.

---

*Concerns regenerated: 2026-08-13 (v2.1-hardening Track D)*
