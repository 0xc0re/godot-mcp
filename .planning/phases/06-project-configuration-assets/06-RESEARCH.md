# Phase 6: Project Configuration & Assets - Research

**Researched:** 2026-03-03
**Domain:** Godot 4.x project configuration (input bindings), shader management (.gdshader + ShaderMaterial), headless export
**Confidence:** HIGH

## Summary

Phase 6 covers three distinct feature domains: (1) input action management via `project.godot` manipulation, (2) shader file and material creation, and (3) headless project export. All three follow established patterns in this codebase: input actions use the existing `modify_project_setting` GDScript operation + a new GDScript operation for structured input event creation; shaders use plain text `fs.writeFileSync` for `.gdshader` files + the existing `create_resource` GDScript pattern for ShaderMaterial `.tres` files; export uses direct `execGodot` CLI invocation (no GDScript dispatch) with `--export-release` / `--export-debug` flags.

The project's existing infrastructure covers most needs. Input actions are stored in `project.godot` under the `[input]` section, where each action maps to a dictionary containing `deadzone` and an `events` array of serialized InputEvent objects. The key insight is that adding input actions requires creating properly constructed InputEvent objects (InputEventKey, InputEventJoypadButton, InputEventJoypadMotion) in GDScript and saving them via `ProjectSettings` -- raw string manipulation of project.godot would be fragile due to Godot's Object serialization format. Shader files are plain text and can be written directly. Export requires pre-flight validation of `export_presets.cfg` existence and preset name matching, plus an extended timeout (180s vs the default 30s).

**Primary recommendation:** Create two new tool domain files (`src/tools/config.ts` for input actions, `src/tools/shader.ts` for shader management) and one new file (`src/tools/export.ts` for export tools). Add corresponding GDScript operations to `godot_operations.gd` for input action CRUD and shader material creation. Use the existing `parseProjectSettings` parser for reading `export_presets.cfg` (same INI format). Extend `execGodot` to accept an optional timeout override for export operations.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONF-01 | AI can add an input action with keyboard key binding to project.godot | GDScript `add_input_action` operation using ProjectSettings API + InputEventKey |
| CONF-02 | AI can add an input action with joypad button/axis binding to project.godot | Same GDScript operation with InputEventJoypadButton / InputEventJoypadMotion |
| CONF-03 | AI can remove an input action from project.godot | GDScript operation using ProjectSettings.set_setting() with null + save |
| CONF-04 | AI can list all configured input actions with their bindings | TypeScript parser reads `[input]` section from project.godot via `parseProjectSettings` |
| SHDR-01 | AI can create a .gdshader file with specified shader_type and source code | Direct `fs.writeFileSync` -- .gdshader is plain text |
| SHDR-02 | AI can create a ShaderMaterial resource (.tres) referencing a .gdshader file | GDScript operation using ShaderMaterial + Shader.new() + ResourceSaver |
| SHDR-03 | AI can set shader parameters on an existing ShaderMaterial resource | GDScript operation loading existing .tres, calling set_shader_parameter() + save |
| EXPT-01 | AI can export a project headlessly for a named preset | `execGodot` with `--headless --export-release` flags, 180s timeout |
| EXPT-02 | AI can validate export prerequisites before attempting | Pre-flight checks: export_presets.cfg exists, preset name matches, templates dir check |
| EXPT-03 | AI can list available export presets from export_presets.cfg | TypeScript parser reads export_presets.cfg (INI format), extracts preset names + platforms |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | ^1.27.1 | MCP server, tool registration | Existing -- all tools use this |
| zod | ^3.25.76 | Input schema validation | Existing -- all tool params use Zod |
| vitest | ^4.0.18 | Test runner | Existing -- 184 tests passing |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js fs | built-in | Write .gdshader files, read export_presets.cfg | Shader file creation, export preset listing |
| project-parser.ts | existing | Parse project.godot and export_presets.cfg | Both use INI format; parser already handles sections and multi-line values |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| GDScript ProjectSettings for input actions | Raw string manipulation of project.godot | Godot's Object() serialization format is complex -- GDScript handles it natively |
| GDScript for ShaderMaterial creation | fs.writeFileSync for .tres | .tres format includes ext_resource IDs and uid -- letting Godot generate these via ResourceSaver is safer |
| Direct execGodot for export | executeOperation via godot_operations.gd | Export uses Godot CLI flags (--export-release), not a GDScript script -- no dispatch needed |

**Installation:**
```bash
# No new dependencies needed for Phase 6
# All features use existing stack
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  tools/
    config.ts          # NEW: add_input_action, remove_input_action, list_input_actions
    shader.ts          # NEW: create_shader, create_shader_material, set_shader_params
    export.ts          # NEW: export_project, list_export_presets
  scripts/
    godot_operations.gd  # EXTEND: add_input_action, remove_input_action, create_shader_material, set_shader_params
  parsers/
    project-parser.ts    # EXISTING: already parses [input] section; reuse for export_presets.cfg
  godot.ts               # EXTEND: add timeout parameter to execGodot
tests/
  config-tools.test.ts   # NEW
  shader-tools.test.ts   # NEW
  export-tools.test.ts   # NEW
  fixtures/
    sample.export_presets.cfg  # NEW fixture
```

### Pattern 1: GDScript Operations for Input Actions (CONF-01, CONF-02, CONF-03)
**What:** New `add_input_action` and `remove_input_action` operations in godot_operations.gd that use Godot's ProjectSettings API to persist input bindings to project.godot.
**When to use:** Any write operation that involves Godot's typed serialization format (InputEventKey Object() serialization).
**Why not raw text:** Input events in project.godot are serialized as `Object(InputEventKey,"resource_local_to_scene":false,..."physical_keycode":65,...)` -- constructing this string manually is fragile and version-dependent. GDScript creates the InputEvent objects natively and ProjectSettings.save() serializes them correctly.

**GDScript implementation approach:**
```gdscript
# In godot_operations.gd
func add_input_action(params):
    var action_name = params.get("action_name", "")
    var events_data = params.get("events", [])
    var deadzone = params.get("deadzone", 0.5)

    # Build the events array from params
    var events = []
    for event_data in events_data:
        var event_type = event_data.get("type", "")
        match event_type:
            "key":
                var ev = InputEventKey.new()
                ev.physical_keycode = event_data.get("physical_keycode", 0)
                ev.keycode = event_data.get("keycode", 0)
                events.append(ev)
            "joypad_button":
                var ev = InputEventJoypadButton.new()
                ev.button_index = event_data.get("button_index", 0)
                events.append(ev)
            "joypad_motion":
                var ev = InputEventJoypadMotion.new()
                ev.axis = event_data.get("axis", 0)
                ev.axis_value = event_data.get("axis_value", 1.0)
                events.append(ev)

    # Set via ProjectSettings and save
    ProjectSettings.set_setting("input/" + action_name, {
        "deadzone": deadzone,
        "events": events
    })
    ProjectSettings.save()
```

### Pattern 2: Direct fs.writeFileSync for .gdshader Files (SHDR-01)
**What:** Write shader source code directly to disk as a plain text file.
**When to use:** `.gdshader` files are plain text with no binary or Object-serialized content.
**Example .gdshader content:**
```
shader_type canvas_item;

uniform vec4 color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float intensity : hint_range(0.0, 1.0) = 0.5;

void fragment() {
    COLOR = color * intensity;
}
```

**TypeScript handler (no GDScript subprocess needed):**
```typescript
// In src/tools/shader.ts
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// Write the .gdshader file directly
const shaderDir = dirname(join(project_path, shader_path));
if (!existsSync(shaderDir)) {
  mkdirSync(shaderDir, { recursive: true });
}
writeFileSync(join(project_path, shader_path), shader_code, 'utf-8');
```

### Pattern 3: GDScript for ShaderMaterial .tres Creation (SHDR-02, SHDR-03)
**What:** Use `godot_operations.gd` to create ShaderMaterial resources and set shader parameters.
**When to use:** Creating .tres files that reference external resources (ext_resource) -- Godot generates UIDs and resource IDs correctly.
**Why:** A ShaderMaterial .tres file looks like:
```
[gd_resource type="ShaderMaterial" load_steps=2 format=3 uid="uid://xyz"]
[ext_resource type="Shader" path="res://shaders/my_shader.gdshader" id="1_abc"]
[resource]
shader = ExtResource("1_abc")
shader_parameter/color = Color(1, 0, 0, 1)
shader_parameter/intensity = 0.5
```
The UIDs and ext_resource IDs must be generated by Godot. GDScript handles this via ResourceSaver.

**GDScript implementation:**
```gdscript
func create_shader_material(params):
    var shader_path = ensure_res_prefix(params.shader_path)
    var output_path = ensure_res_prefix(params.output_path)
    var shader_params = params.get("shader_params", {})

    var shader = load(shader_path) as Shader
    if shader == null:
        log_error("Failed to load shader: " + shader_path)
        print(JSON.stringify({"success": false, "error": "Shader not found: " + shader_path}))
        return

    var material = ShaderMaterial.new()
    material.shader = shader

    # Set shader parameters
    for param_name in shader_params:
        var value = shader_params[param_name]
        material.set_shader_parameter(param_name, value)

    var error = ResourceSaver.save(material, output_path)
    if error == OK:
        print(JSON.stringify({"success": true, "path": output_path}))
    else:
        log_error("Failed to save ShaderMaterial: " + str(error))
        print(JSON.stringify({"success": false, "error": "Save failed: " + str(error)}))
```

### Pattern 4: Direct execGodot for Export (EXPT-01)
**What:** Invoke Godot with `--export-release` / `--export-debug` flags directly via execGodot.
**When to use:** Export is a Godot CLI operation, not a GDScript script.
**Critical:** Requires extended timeout (180s) since `execGodot` currently hardcodes 30s. The `execGodot` function signature must be extended to accept an optional timeout.

**TypeScript implementation:**
```typescript
// In src/tools/export.ts -- uses execGodot, NOT executeOperation
const args = [
  '--headless',
  '--path', project_path,
  '--export-release', preset_name, output_path,
];
const { stdout, stderr } = await execGodot(ctx.godotPath, args, { timeout: 180_000 });
```

### Pattern 5: INI Parser Reuse for export_presets.cfg (EXPT-03)
**What:** Read and parse `export_presets.cfg` using the existing project-parser.ts.
**When to use:** `export_presets.cfg` uses the same INI format as `project.godot` -- sections like `[preset.0]`, `[preset.0.options]` with key=value pairs.
**Key extraction logic:**
```typescript
// Parse export_presets.cfg with existing parser
const content = readFileSync(join(project_path, 'export_presets.cfg'), 'utf-8');
const parsed = parseProjectSettings(content);

// Extract preset names and platforms
const presets = [];
for (const section of Object.keys(parsed.sections)) {
  if (section.match(/^preset\.\d+$/) && parsed.sections[section].name) {
    presets.push({
      name: parsed.sections[section].name.replace(/^"|"$/g, ''),
      platform: parsed.sections[section].platform?.replace(/^"|"$/g, ''),
      runnable: parsed.sections[section].runnable === 'true',
    });
  }
}
```

### Anti-Patterns to Avoid
- **Hand-writing project.godot input event serialization:** The Object() serialization format is complex and version-dependent. Always use GDScript ProjectSettings API.
- **Using executeOperation for export:** Export uses Godot CLI flags, not a GDScript script. Use execGodot directly.
- **Hardcoding shader UIDs:** Let Godot generate UIDs via ResourceSaver.save(). Never write .tres files manually for resources that reference other files.
- **Assuming export succeeds based on exit code:** Godot exits 0 even when export fails. Always verify the output file exists after export.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Input event serialization in project.godot | String builder for Object(InputEventKey,...) format | GDScript ProjectSettings.set_setting() + .save() | Object serialization format includes 15+ fields per event, varies by Godot version |
| ShaderMaterial .tres file creation | Template string for gd_resource format | GDScript ShaderMaterial.new() + ResourceSaver.save() | UIDs, ext_resource IDs, and format version must be generated by Godot |
| export_presets.cfg parser | Custom parser for export presets format | Existing parseProjectSettings() from project-parser.ts | Same INI format; sections are [preset.N] instead of [application] |
| Shader parameter type conversion | Manual type parsing in TypeScript | GDScript set_shader_parameter() handles type inference | Godot resolves uniform types from the shader's declared types |

**Key insight:** All write operations that touch Godot's serialization format should go through GDScript. Only plain text files (.gdshader) can be safely written from TypeScript.

## Common Pitfalls

### Pitfall 1: Headless Export Silent Failures
**What goes wrong:** `godot --headless --export-release "Preset Name" output.exe` exits 0 even when export fails -- no error is raised to Node.js.
**Why it happens:** Godot does not always exit non-zero on export failure. Missing presets produce "Preset not found" in stdout with exit code 0. Missing export templates produce "No export template found" with exit code 0.
**How to avoid:**
1. Pre-flight: check `export_presets.cfg` exists
2. Pre-flight: verify the preset name matches (case-sensitive) a name in the cfg file
3. Post-export: verify the output file exists and has non-zero size
4. Parse stdout for error strings: "Preset not found", "No export template found", "Failed to"
**Warning signs:** Tool returns success but output file is missing or zero bytes.

### Pitfall 2: Input Action Key Constants Must Be Integer Enums
**What goes wrong:** Passing string key names like "KEY_SPACE" to GDScript fails -- Godot expects integer constants.
**Why it happens:** InputEventKey.physical_keycode is an int (Key enum). The value 32 = KEY_SPACE, 65 = KEY_A, etc.
**How to avoid:** The TypeScript tool should accept human-readable key names (e.g., "space", "a", "escape") and the GDScript operation should map them to Godot Key enum constants. Alternatively, accept the integer keycode directly. The GDScript side should use `OS.find_keycode_from_string()` for string-to-keycode conversion.
**Warning signs:** Input action is created but pressing the key does nothing.

### Pitfall 3: execGodot 30-Second Timeout for Exports
**What goes wrong:** Export operations are killed after 30 seconds because `execGodot` has a hardcoded `EXEC_TIMEOUT = 30_000`.
**Why it happens:** The timeout constant was set for quick operations (--version, --script). Exports can take 30-180+ seconds.
**How to avoid:** Extend `execGodot` signature to accept an optional `options` parameter with `timeout` field. Default remains 30s; export tool passes 180s.
**Warning signs:** Export always fails with "Godot process timed out after 30 seconds".

### Pitfall 4: Shader Parameter Types Need Conversion
**What goes wrong:** Setting shader parameters with JSON values (e.g., `{"r": 1.0, "g": 0.0, "b": 0.0, "a": 1.0}`) doesn't convert to Godot Color automatically.
**Why it happens:** GDScript `set_shader_parameter()` expects native Godot types (Color, Vector2, Vector3, float). JSON doesn't encode these types.
**How to avoid:** Reuse the existing `convert_json_to_godot_type()` helper in godot_operations.gd (already used by `create_resource`). The TypeScript tool should accept a `param_types` map to hint conversion: `{"color": "Color", "speed": "float"}`.
**Warning signs:** Shader parameters show as null or wrong type in Godot editor.

### Pitfall 5: export_presets.cfg Quote Stripping
**What goes wrong:** Parsed preset names include surrounding quotes (e.g., `"Web"` instead of `Web`).
**Why it happens:** The existing project parser stores values as raw strings including quotes: `name="Web"` -> value is `"Web"`.
**How to avoid:** Strip surrounding quotes when extracting preset names from the parsed output.
**Warning signs:** Export fails with "Preset not found" because the name `"Web"` (with quotes) doesn't match.

## Code Examples

### Tool Handler Pattern (config.ts)
```typescript
// Source: matches existing composition.ts pattern exactly
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ServerContext } from '../types.js';
import { executeOperation, validatePath } from '../godot.js';
import { toolError } from '../errors.js';

export function registerConfigTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'add_input_action',
    {
      title: 'Add Input Action',
      description: 'Add an input action with keyboard or joypad bindings to project.godot.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        action_name: z.string().describe('Name of the input action (e.g., "jump", "move_left")'),
        events: z.array(z.object({
          type: z.enum(['key', 'joypad_button', 'joypad_motion']),
          physical_keycode: z.number().optional(),
          keycode: z.number().optional(),
          key: z.string().optional().describe('Human-readable key name (e.g., "space", "a")'),
          button_index: z.number().optional(),
          axis: z.number().optional(),
          axis_value: z.number().optional(),
        })).min(1).describe('Input event bindings for this action'),
        deadzone: z.number().optional().default(0.5).describe('Deadzone for the action (0.0-1.0)'),
      },
    },
    async ({ project_path, action_name, events, deadzone }) => {
      // Standard validation pattern...
    },
  );
}
```

### export_presets.cfg Fixture
```ini
[preset.0]

name="Web"
platform="Web"
runnable=true
export_path="build/web/index.html"

[preset.0.options]

html/export_icon=true

[preset.1]

name="Linux"
platform="Linux"
runnable=true
export_path="build/linux/game.x86_64"

[preset.1.options]

binary_format/embed_pck=true
```

### GDScript add_input_action Operation
```gdscript
# Source: follows existing modify_project_setting pattern
func add_input_action(params):
    var action_name = params.get("action_name", "")
    var events_data = params.get("events", [])
    var deadzone = params.get("deadzone", 0.5)

    if action_name == "":
        log_error("Missing required parameter: action_name")
        print(JSON.stringify({"success": false, "error": "Missing action_name"}))
        return

    var events = []
    for event_data in events_data:
        var ev = null
        var event_type = event_data.get("type", "key")
        match event_type:
            "key":
                ev = InputEventKey.new()
                if event_data.has("key"):
                    ev.physical_keycode = OS.find_keycode_from_string(event_data.key)
                elif event_data.has("physical_keycode"):
                    ev.physical_keycode = event_data.physical_keycode
                if event_data.has("keycode"):
                    ev.keycode = event_data.keycode
            "joypad_button":
                ev = InputEventJoypadButton.new()
                ev.button_index = event_data.get("button_index", 0)
            "joypad_motion":
                ev = InputEventJoypadMotion.new()
                ev.axis = event_data.get("axis", 0)
                ev.axis_value = event_data.get("axis_value", 1.0)
        if ev != null:
            events.append(ev)

    ProjectSettings.set_setting("input/" + action_name, {
        "deadzone": deadzone,
        "events": events
    })
    ProjectSettings.save()

    print(JSON.stringify({
        "success": true,
        "action": action_name,
        "event_count": events.size()
    }))
```

### execGodot Extended Signature
```typescript
// Source: extends existing src/godot.ts execGodot
export async function execGodot(
  godotPath: string,
  args: string[],
  options?: { timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  const timeout = options?.timeout ?? EXEC_TIMEOUT;
  try {
    const { stdout, stderr } = await execFileAsync(godotPath, args, {
      maxBuffer: MAX_BUFFER,
      timeout,
    });
    return { stdout: stdout ?? '', stderr: stderr ?? '' };
  } catch (error: unknown) {
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      const execError = error as Error & { stdout: string; stderr: string; killed?: boolean };
      if (execError.killed) {
        throw new Error(`Godot process timed out after ${timeout / 1000} seconds`);
      }
      return { stdout: execError.stdout ?? '', stderr: execError.stderr ?? '' };
    }
    throw error;
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| InputMap.add_action() at runtime only | ProjectSettings.set_setting("input/...") + .save() for persistence | Always (ProjectSettings is the persistence mechanism) | Actions persist across project restarts |
| --export flag (Godot 3.x) | --export-release / --export-debug (Godot 4.x) | Godot 4.0 | Old --export flag removed |
| "Linux/X11" platform name | "Linux" platform name | Godot 4.3 | Preset names must match current Godot version |
| TileMap node for tilemaps | TileMapLayer node (TileMap deprecated) | Godot 4.3 | Not directly relevant but documents version awareness |

**Deprecated/outdated:**
- `--export` CLI flag: replaced by `--export-release` and `--export-debug` in Godot 4.0+
- `InputMap.add_action()` for persistence: runtime-only, does not write to project.godot
- Manual .tres file writing: fragile due to UID generation requirements in Godot 4.x

## Open Questions

1. **OS.find_keycode_from_string() availability in headless mode**
   - What we know: The function exists in Godot 4.x and maps string names like "Space" to Key enum values
   - What's unclear: Whether it works identically in headless mode (no display server)
   - Recommendation: Test during implementation; fall back to integer keycodes if string lookup fails in headless

2. **ProjectSettings.save() in headless mode reliability**
   - What we know: `modify_project_setting` already uses ConfigFile API to write project.godot in headless mode and works. ProjectSettings.save() is a different code path.
   - What's unclear: Whether ProjectSettings.save() correctly serializes InputEvent objects in headless mode
   - Recommendation: If ProjectSettings.save() fails in headless, fall back to ConfigFile API with manual event serialization

3. **Export template validation path cross-platform**
   - What we know: Linux path is `~/.local/share/godot/export_templates/<version>/`
   - What's unclear: Exact paths on macOS and Windows for template validation
   - Recommendation: Skip template existence validation in v1; focus on checking `export_presets.cfg` and post-export output file verification. Template path discovery is complex and platform-specific.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONF-01 | add_input_action with key binding passes params to executeOperation | unit | `npx vitest run tests/config-tools.test.ts -x` | Wave 0 |
| CONF-02 | add_input_action with joypad binding passes params to executeOperation | unit | `npx vitest run tests/config-tools.test.ts -x` | Wave 0 |
| CONF-03 | remove_input_action calls executeOperation with correct action name | unit | `npx vitest run tests/config-tools.test.ts -x` | Wave 0 |
| CONF-04 | list_input_actions parses project.godot [input] section | unit | `npx vitest run tests/config-tools.test.ts -x` | Wave 0 |
| SHDR-01 | create_shader writes .gdshader file to disk | unit | `npx vitest run tests/shader-tools.test.ts -x` | Wave 0 |
| SHDR-02 | create_shader_material calls executeOperation with shader_path | unit | `npx vitest run tests/shader-tools.test.ts -x` | Wave 0 |
| SHDR-03 | set_shader_params calls executeOperation with param_name/value | unit | `npx vitest run tests/shader-tools.test.ts -x` | Wave 0 |
| EXPT-01 | export_project calls execGodot with --export-release flag | unit | `npx vitest run tests/export-tools.test.ts -x` | Wave 0 |
| EXPT-02 | export_project returns toolError when export_presets.cfg missing | unit | `npx vitest run tests/export-tools.test.ts -x` | Wave 0 |
| EXPT-03 | list_export_presets parses preset names from export_presets.cfg | unit | `npx vitest run tests/export-tools.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/config-tools.test.ts` -- covers CONF-01 through CONF-04
- [ ] `tests/shader-tools.test.ts` -- covers SHDR-01 through SHDR-03
- [ ] `tests/export-tools.test.ts` -- covers EXPT-01 through EXPT-03
- [ ] `tests/fixtures/sample.export_presets.cfg` -- fixture for export preset parsing tests

*(Framework and config already exist -- vitest.config.ts and vitest are installed)*

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/tools/project.ts`, `src/tools/composition.ts`, `src/tools/resource.ts` -- established patterns for tool handlers
- Existing codebase: `src/scripts/godot_operations.gd` -- `modify_project_setting`, `create_resource` functions as templates
- Existing codebase: `src/parsers/project-parser.ts` -- INI format parser already handles project.godot; same format as export_presets.cfg
- Existing codebase: `tests/fixtures/sample.project.godot` -- shows project.godot [input] section format with Object() serialization
- [Godot Command Line Tutorial](https://docs.godotengine.org/en/latest/tutorials/editor/command_line_tutorial.html) -- `--export-release`, `--export-debug`, `--export-pack` syntax
- [Godot InputMap docs](https://docs.godotengine.org/en/stable/classes/class_inputmap.html) -- `add_action()`, `action_add_event()`, `has_action()` API

### Secondary (MEDIUM confidence)
- [Godot InputEventKey docs](https://docs.godotengine.org/en/stable/classes/class_inputeventkey.html) -- physical_keycode, keycode properties
- [Godot InputEventJoypadButton docs](https://docs.godotengine.org/en/stable/classes/class_inputeventjoypadbutton.html) -- button_index property
- [Godot InputEventJoypadMotion docs](https://docs.godotengine.org/en/stable/classes/class_inputeventjoypadmotion.html) -- axis, axis_value properties
- [Godot ShaderMaterial docs](https://docs.godotengine.org/en/stable/classes/class_shadermaterial.html) -- set_shader_parameter(), shader property
- [Godot ProjectSettings docs](https://docs.godotengine.org/en/stable/classes/class_projectsettings.html) -- set_setting(), save() methods
- Prior v2.0 research: `.planning/research/STACK.md`, `.planning/research/PITFALLS.md` -- headless export pitfalls, input action approach

### Tertiary (LOW confidence)
- [Godot export_presets.cfg format](https://github.com/DarkeyPro/godot_game_template/blob/master/export_presets.cfg) -- example file structure (may differ by Godot version)
- [Godot Issue #95287](https://github.com/godotengine/godot/issues/95287) -- headless export freezing in 4.3 RC2 (fixed in 4.4+)
- [Godot Issue #71521](https://github.com/godotengine/godot/issues/71521) -- export in headless mode requires project to have been opened before

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all features use existing codebase patterns with no new dependencies
- Architecture: HIGH - three distinct tool modules following exact existing composition.ts / resource.ts patterns
- Pitfalls: HIGH - verified from prior research, official Godot issues, and codebase analysis
- Input action GDScript API: MEDIUM - ProjectSettings.set_setting for input actions verified in docs; headless mode behavior needs testing
- Export timeout extension: HIGH - straightforward signature change to existing execGodot

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable domain -- Godot 4.x APIs are frozen for minor versions)
