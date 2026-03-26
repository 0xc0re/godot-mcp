---
phase: quick
plan: 260326-fkr
type: execute
wave: 1
depends_on: []
files_modified:
  - src/scripts/godot_operations.gd
autonomous: true
requirements: []

must_haves:
  truths:
    - "create_tileset returns actionable error message when texture is null in headless mode"
    - "create_tileset returns actionable error when texture has zero size and no columns/rows provided"
    - "create_tileset succeeds when columns/rows are explicitly provided even if texture size is zero"
  artifacts:
    - path: "src/scripts/godot_operations.gd"
      provides: "Headless-aware create_tileset with improved error messages"
      contains: "headless"
  key_links: []
---

<objective>
Improve create_tileset headless mode resilience in godot_operations.gd.

Purpose: The ballz CLAUDE.md documents three godot-mcp issues. Investigation reveals:
- **create_tileset ordering** (Issue 2): Already correct -- `atlas_source.texture` is set on line 2472, before `create_tile()` on line 2503. No fix needed.
- **validate_scene completeness** (Issue 3): Already complete -- all three checks (missing collision shapes, duplicate sibling names, autoload-referencing root scripts) are implemented in `src/tools/diagnostics.ts` lines 264-397 with full test coverage. No fix needed.
- **TileSet texture loading in headless mode** (Issue 1): Needs improvement. The null texture case returns a generic "Failed to load texture" error that doesn't mention headless mode as the likely cause. The zero-size texture case similarly lacks guidance. Users should be told to provide explicit `columns` and `rows` parameters to bypass texture size detection in headless mode.

Output: Updated godot_operations.gd with headless-aware error handling in create_tileset.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/scripts/godot_operations.gd (lines 2438-2522 — create_tileset function)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add headless-aware error handling to create_tileset</name>
  <files>src/scripts/godot_operations.gd</files>
  <action>
In the `create_tileset` function (starts at line 2438), make these targeted changes:

1. **Detect headless mode** at the top of the function, after parameter parsing (after line 2448):
   ```gdscript
   var is_headless = DisplayServer.get_name() == "headless"
   ```

2. **Improve the null texture error message** (lines 2459-2462). Replace the current error with a headless-aware message:
   - If `is_headless`: Error message should say: `"Failed to load texture in headless mode: {texture_path}. Textures may not load without a display server. Provide explicit 'columns' and 'rows' parameters to skip texture size detection."`
   - If NOT headless: Keep the current message as-is ("Failed to load texture: " + texture_path)

3. **Improve the zero-size texture error** (lines 2487-2490). When `texture.get_size()` returns zero and no columns/rows were provided:
   - If `is_headless`: Error message should say: `"Texture has zero size in headless mode. Provide explicit 'columns' and 'rows' parameters to bypass texture size detection."`
   - If NOT headless: Keep current message as-is

4. **Add a headless warning to success output** (line 2522). When `is_headless` is true, add `"warning": "Created in headless mode — texture data may be incomplete. Verify tileset visually in editor."` to the success JSON alongside existing fields.

Do NOT change the create_tile ordering or any other logic. Only touch error messages and the success JSON.
  </action>
  <verify>
    <automated>cd /home/cstory/src/godot-mcp && grep -n "headless" src/scripts/godot_operations.gd | head -20 && grep -c "DisplayServer" src/scripts/godot_operations.gd</automated>
  </verify>
  <done>
    - create_tileset detects headless mode via DisplayServer.get_name()
    - Null texture error includes headless guidance when running without display server
    - Zero-size texture error includes headless guidance when running without display server
    - Success JSON includes headless warning when applicable
    - No changes to tile creation ordering or other logic
  </done>
</task>

</tasks>

<verification>
- `grep -n "headless" src/scripts/godot_operations.gd` shows new headless detection and messages in create_tileset
- `grep -n "DisplayServer" src/scripts/godot_operations.gd` shows headless mode detection
- `npm run build` succeeds (copies updated GDScript to build/)
- No existing tests break: `npx vitest run` passes
</verification>

<success_criteria>
- create_tileset provides actionable headless mode guidance in error messages
- Existing create_tileset behavior unchanged for non-headless mode
- Build succeeds, existing tests pass
</success_criteria>

<output>
After completion, create `.planning/quick/260326-fkr-fix-ballz-claude-md-documented-issues-ti/260326-fkr-SUMMARY.md`
</output>
