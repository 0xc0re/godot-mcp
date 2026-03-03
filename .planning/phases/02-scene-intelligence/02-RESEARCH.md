# Phase 2: Scene Intelligence - Research

**Researched:** 2026-03-03
**Domain:** Godot 4 scene/resource file manipulation, GDScript validation, MCP tool development
**Confidence:** MEDIUM-HIGH

## Summary

Phase 2 adds the ability for an AI to read scene trees, modify node properties, restructure scenes, manage .tres resource files, and batch-validate GDScript -- all headlessly. The existing codebase already provides a solid foundation: a GDScript operations runner (`godot_operations.gd`) invoked via `executeOperation()`, plus existing scene tools (`create_scene`, `add_node`, `load_sprite`, `save_scene`). Phase 2 extends this with read/inspect operations and new manipulation capabilities.

The critical architectural decision is **how to read .tscn/.tres files**: (a) via Godot headless API (load scene, walk tree, serialize to JSON) or (b) via direct text parsing in TypeScript. Research finds a **hybrid approach** is optimal: use **TypeScript-side text parsing for read-only operations** (fast, no Godot process spawn, preserves fidelity) and **Godot headless API for write operations** (correct type handling, resource resolution, existing pattern). This avoids the key risk identified in STATE.md about ExtResource/SubResource ID corruption while keeping read operations fast and dependency-free.

For GDScript batch validation, `--check-only` is limited to single-file checking and has known issues with autoloads. The recommended approach is a **custom GDScript operation** that iterates project files and uses `load()` + `reload()` to detect parse errors, collecting results into structured JSON.

**Primary recommendation:** Add 5 new MCP tools (read_scene, modify_node_property, remove_node, create_resource, read_resource) plus enhance the existing GDScript operations runner with corresponding operations. Add a validate_scripts tool that uses a custom GDScript batch checker. Parse .tscn/.tres text format directly in TypeScript for read operations.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCEN-01 | Read/inspect a scene tree as structured JSON (nodes, types, properties, hierarchy) | TypeScript-side .tscn text parser for fast, accurate reading. Validated format spec via Godot docs. |
| SCEN-02 | Modify node properties headlessly (position, scale, visibility, custom properties) | Godot headless API via new `modify_node_property` operation in godot_operations.gd. Existing pattern from add_node. |
| SCEN-03 | Remove a node from a scene by path | Godot headless API via new `remove_node` operation. Uses get_node() + remove_child() + queue_free() pattern. |
| SCEN-04 | Attach a GDScript file to a node in a scene | Godot headless API via new `attach_script` operation. Uses load() + set_script() pattern. |
| SCEN-05 | Create Godot resource files (.tres) for materials, curves, atlases | Godot headless API via new `create_resource` operation. Uses ClassDB.instantiate() + property setting + ResourceSaver.save(). |
| SCEN-06 | Read/inspect Godot resource files (.tres) as structured data | TypeScript-side .tres text parser (same format as .tscn). Fast, no Godot process needed. |
| SCRI-01 | Batch-validate all GDScript files for parse errors | Custom GDScript operation that iterates .gd files, uses load() + reload() to detect errors, returns structured JSON. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | ^1.27.1 | MCP server framework | Already in use; registerTool API for new tools |
| zod | ^3.25.76 | Input schema validation | Already in use; required by MCP SDK |
| vitest | ^4.0.18 | Test framework | Already in use from Phase 1 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | -- | -- | No new npm dependencies required for Phase 2 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom .tscn parser | @fernforestgames/godot-resource-parser | Archived (Jan 2026), read-only, would add dependency. Custom parser is small (~200 lines) and can include write support. |
| Custom .tscn parser | tscn2json (npm) | PEG.js-based, read-only, no write support. Extra dependency for something simple. |
| Godot headless for reads | TypeScript text parsing | Godot headless spawns a process per read (~200ms). Text parsing is instant. For read-only operations, direct parsing is strictly better. |
| GDScript batch via custom operation | --check-only flag per file | --check-only is one file at a time, has autoload issues, non-structured output. Custom operation is one Godot invocation for all files. |

**Installation:**
```bash
# No new packages needed - all dependencies already present
npm install  # existing deps suffice
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  tools/
    scene.ts          # EXISTING - extend with read_scene, modify_node, remove_node, attach_script
    resource.ts        # NEW - create_resource, read_resource tools
    script.ts          # NEW - validate_scripts tool
  parsers/
    tscn-parser.ts     # NEW - TypeScript .tscn/.tres text format parser
    tscn-types.ts      # NEW - Type definitions for parsed scene/resource data
  scripts/
    godot_operations.gd  # EXISTING - add new operations
  errors.ts           # EXISTING
  godot.ts            # EXISTING
  types.ts            # EXISTING
```

### Pattern 1: TypeScript Text Parser for Read Operations (SCEN-01, SCEN-06)
**What:** Parse .tscn/.tres files directly in TypeScript, returning structured JSON without spawning Godot.
**When to use:** All read/inspect operations where we don't need Godot runtime behavior.
**Why:** Instant response (~1ms vs ~200ms), no Godot dependency for reads, preserves exact file structure.

The .tscn/.tres text format is line-based with bracketed section headers:
```
[gd_scene load_steps=4 format=3 uid="uid://cecaux1sm7mo0"]

[ext_resource type="Script" uid="uid://abc123" path="res://player.gd" id="1_abc"]

[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_xyz"]
albedo_color = Color(1, 0.64, 0.31, 1)

[node name="Ball" type="RigidBody3D"]

[node name="CollisionShape3D" type="CollisionShape3D" parent="."]
shape = SubResource("SphereShape3D_tj6p1")

[node name="Camera3D" type="Camera3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 3, 5)

[connection signal="body_entered" from="." to="." method="_on_body_entered"]
```

Parser design:
```typescript
// src/parsers/tscn-types.ts
interface ParsedScene {
  format: number;
  uid?: string;
  loadSteps?: number;
  extResources: ExtResource[];
  subResources: SubResource[];
  nodes: SceneNode[];
  connections: Connection[];
}

interface SceneNode {
  name: string;
  type?: string;
  parent?: string;  // "." for root's children, path for deeper
  instance?: string; // ExtResource ref for instanced scenes
  properties: Record<string, string>; // raw string values from file
}

interface ExtResource {
  type: string;
  uid?: string;
  path: string;
  id: string;
}

// src/parsers/tscn-parser.ts
export function parseScene(content: string): ParsedScene { ... }
export function parseResource(content: string): ParsedResource { ... }
```

### Pattern 2: Godot Headless API for Write Operations (SCEN-02, SCEN-03, SCEN-04, SCEN-05)
**What:** Extend `godot_operations.gd` with new operations; invoke via existing `executeOperation()`.
**When to use:** Any operation that modifies a .tscn/.tres file.
**Why:** Godot handles type serialization correctly (Vector2, Color, Transform3D, etc.), resolves resource paths, and maintains SubResource/ExtResource ID consistency.

```gdscript
# In godot_operations.gd - new operation for modifying node properties
func modify_node_property(params):
    var scene = load(full_scene_path)
    var scene_root = scene.instantiate()
    var target_node = scene_root.get_node(node_path)

    # Set the property value with proper type conversion
    target_node.set(property_name, converted_value)

    # Re-pack and save
    var packed = PackedScene.new()
    packed.pack(scene_root)
    ResourceSaver.save(packed, full_scene_path)
```

### Pattern 3: Batch GDScript Validation (SCRI-01)
**What:** A GDScript operation that finds all .gd files, loads each, checks for parse errors using `reload()`, and returns structured results.
**When to use:** The validate_scripts tool.
**Why:** Single Godot invocation for entire project. The `--check-only` CLI flag is limited to single files and has known autoload issues.

```gdscript
# In godot_operations.gd
func validate_scripts(params):
    var gd_files = find_files("res://", ".gd")
    var results = []
    for file_path in gd_files:
        var script = load(file_path)
        if script == null:
            results.append({"file": file_path, "valid": false, "error": "Failed to load"})
            continue
        var reload_result = script.reload()
        if reload_result != OK:
            results.append({"file": file_path, "valid": false, "error": "Parse error (code: " + str(reload_result) + ")"})
        else:
            results.append({"file": file_path, "valid": true})
    print(JSON.stringify({"results": results, "total": gd_files.size()}))
```

### Pattern 4: Tool Registration Pattern (all tools)
**What:** Follow existing registerTool pattern with Zod schemas and toolError responses.
**When to use:** Every new MCP tool.
```typescript
server.registerTool(
  'read_scene',
  {
    title: 'Read Scene',
    description: 'Read a Godot scene file and return its structure as JSON',
    inputSchema: {
      project_path: z.string().describe('Path to the Godot project directory'),
      scene_path: z.string().describe('Path to the scene file (relative to project)'),
    },
  },
  async ({ project_path, scene_path }) => {
    // validate paths, check project exists, read file, parse, return JSON
  },
);
```

### Anti-Patterns to Avoid
- **Spawning Godot for read-only operations:** Adds ~200ms latency per call. Parse .tscn text directly.
- **Building a custom type serializer in TypeScript:** For writes, let Godot handle type serialization. Do NOT try to emit Vector2(x,y) strings from TypeScript.
- **Using --check-only in a loop:** One Godot process per script file is O(n) process spawns. Use a single operation that checks all files.
- **Editing .tscn text directly for writes:** Risk of corrupting ExtResource/SubResource IDs, breaking type serialization, or omitting required properties. This is the specific concern noted in STATE.md.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Type serialization for .tscn writes | Custom Vector2/Color/Transform serializer in TS | Godot's ResourceSaver via headless API | Dozens of types, each with specific format. Godot already knows the format. |
| Resource path resolution | Custom res:// path resolver | Godot's ResourceLoader and ProjectSettings | Godot handles import paths, UID resolution, and path normalization |
| Scene ownership tracking | Manual owner assignment logic | Godot's PackedScene.pack() | Ownership rules are complex (owner must be set for pack to include nodes) |
| GDScript parse error detection | Regex on .gd files | Godot's load() + reload() mechanism | Only Godot's parser understands GDScript fully |

**Key insight:** The .tscn text format is simple enough to READ but complex enough that WRITING requires Godot. Reading is line-based key-value pairs. Writing requires correct type serialization, resource ID management, and ownership tracking.

## Common Pitfalls

### Pitfall 1: ExtResource/SubResource ID Corruption on Write
**What goes wrong:** Editing .tscn files as text can break resource ID references, causing "Failed to load resource" errors.
**Why it happens:** IDs are strings like "1_abc" that must be consistent between the `[ext_resource]` header and `ExtResource("1_abc")` references in node properties.
**How to avoid:** Use Godot's own PackedScene.pack() + ResourceSaver.save() for ALL write operations. Never edit .tscn text for writes.
**Warning signs:** "Failed to load resource" or "Invalid ext_resource" errors when opening scenes after modification.

### Pitfall 2: Node Ownership Not Set for PackedScene
**What goes wrong:** Nodes added to a scene are not saved because their `owner` property is not set to the scene root.
**Why it happens:** PackedScene.pack() only serializes nodes whose owner is the root node.
**How to avoid:** Always set `new_node.owner = scene_root` after adding a child. The existing `add_node` operation already does this correctly.
**Warning signs:** Saved scene has fewer nodes than expected; nodes "disappear" after save.

### Pitfall 3: .godot Import Cache Missing
**What goes wrong:** Godot headless operations fail with "Make sure resources have been imported" errors when the project's `.godot/` directory doesn't exist.
**Why it happens:** The `.godot/` directory contains import cache and isn't committed to version control. Projects never opened in the editor lack this cache.
**How to avoid:** Before any operation that loads resources, check if `.godot/` exists. If not, run `godot --headless --import --quit` first. Document this as a prerequisite or auto-detect and handle it.
**Warning signs:** "Failed to load resource" or import-related errors on first run against a fresh project.

### Pitfall 4: --check-only Autoload False Positives
**What goes wrong:** GDScript validation reports false errors for scripts using autoloaded singletons.
**Why it happens:** `--check-only` doesn't load the project configuration, so autoload identifiers are undefined.
**How to avoid:** Use in-project validation via a custom GDScript operation (which runs within the project context and has access to autoloads) rather than `--check-only`.
**Warning signs:** Errors mentioning undefined identifiers that are actually autoload names.

### Pitfall 5: Godot Headless Output Parsing
**What goes wrong:** Tool fails to extract structured data from Godot stdout because of mixed info/debug/error lines.
**Why it happens:** Godot prints startup messages, warnings, and debug info alongside operation output.
**How to avoid:** Use a clear delimiter pattern. The existing operations use `[INFO]` prefix. For structured data, use `print(JSON.stringify(result))` and parse only lines that are valid JSON.
**Warning signs:** JSON.parse failures on stdout that contains mixed Godot logging.

### Pitfall 6: Property Type Conversion for modify_node_property
**What goes wrong:** Setting a property with the wrong type causes silent failures or runtime errors.
**Why it happens:** GDScript is dynamically typed but node properties have specific types. Setting `position` requires a Vector2, not a string.
**How to avoid:** In the GDScript operation, convert incoming JSON values to proper Godot types before calling `node.set()`. Build a type conversion helper that handles Vector2, Vector3, Color, bool, int, float, String, etc.
**Warning signs:** "Invalid type for property" errors, or property values that don't persist after save.

## Code Examples

### Example 1: .tscn Text Parser (TypeScript)
```typescript
// src/parsers/tscn-parser.ts
// Parses the line-based .tscn/.tres format into structured data.
// Source: Godot docs tscn format specification

interface SectionHeader {
  type: string;
  attributes: Record<string, string>;
}

function parseSectionHeader(line: string): SectionHeader | null {
  const match = line.match(/^\[(\w+)(.*)?\]$/);
  if (!match) return null;
  const type = match[1];
  const attrStr = match[2]?.trim() || '';
  const attributes: Record<string, string> = {};

  // Parse key="value" or key=value pairs
  const attrRegex = /(\w+)=(?:"([^"]*?)"|(\S+))/g;
  let attrMatch;
  while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
    attributes[attrMatch[1]] = attrMatch[2] ?? attrMatch[3];
  }
  return { type, attributes };
}

function parsePropertyLine(line: string): [string, string] | null {
  const eqIdx = line.indexOf(' = ');
  if (eqIdx === -1) return null;
  return [line.substring(0, eqIdx).trim(), line.substring(eqIdx + 3).trim()];
}
```

### Example 2: GDScript Modify Node Property Operation
```gdscript
# In godot_operations.gd
func modify_node_property(params):
    var full_scene_path = ensure_res_prefix(params.scene_path)
    var scene = load(full_scene_path)
    if not scene:
        log_error("Failed to load scene: " + full_scene_path)
        quit(1)

    var scene_root = scene.instantiate()
    var node_path = params.node_path
    if node_path.begins_with("root/"):
        node_path = node_path.substr(5)

    var target = scene_root if node_path == "" or node_path == "root" else scene_root.get_node(node_path)
    if not target:
        log_error("Node not found: " + params.node_path)
        quit(1)

    var property = params.property_name
    var value = convert_json_to_godot_type(params.value, params.get("value_type", ""))
    target.set(property, value)

    var packed = PackedScene.new()
    packed.pack(scene_root)
    ResourceSaver.save(packed, full_scene_path)
    print(JSON.stringify({"success": true, "node": params.node_path, "property": property}))

func convert_json_to_godot_type(value, type_hint: String):
    match type_hint:
        "Vector2":
            return Vector2(value.x, value.y)
        "Vector3":
            return Vector3(value.x, value.y, value.z)
        "Color":
            return Color(value.r, value.g, value.b, value.get("a", 1.0))
        "bool":
            return bool(value)
        "int":
            return int(value)
        "float":
            return float(value)
        _:
            return value  # Pass through for strings, etc.
```

### Example 3: GDScript Remove Node Operation
```gdscript
func remove_node(params):
    var full_scene_path = ensure_res_prefix(params.scene_path)
    var scene = load(full_scene_path)
    var scene_root = scene.instantiate()

    var node_path = params.node_path
    if node_path.begins_with("root/"):
        node_path = node_path.substr(5)

    var target = scene_root.get_node(node_path)
    if not target:
        log_error("Node not found: " + params.node_path)
        quit(1)

    if target == scene_root:
        log_error("Cannot remove root node")
        quit(1)

    target.get_parent().remove_child(target)
    target.queue_free()

    var packed = PackedScene.new()
    packed.pack(scene_root)
    ResourceSaver.save(packed, full_scene_path)
    print(JSON.stringify({"success": true, "removed": params.node_path}))
```

### Example 4: GDScript Attach Script Operation
```gdscript
func attach_script(params):
    var full_scene_path = ensure_res_prefix(params.scene_path)
    var script_path = ensure_res_prefix(params.script_path)

    var scene = load(full_scene_path)
    var scene_root = scene.instantiate()

    var node_path = params.node_path
    if node_path.begins_with("root/"):
        node_path = node_path.substr(5)

    var target = scene_root if node_path == "" or node_path == "root" else scene_root.get_node(node_path)
    if not target:
        log_error("Node not found: " + params.node_path)
        quit(1)

    var script = load(script_path)
    if not script:
        log_error("Failed to load script: " + script_path)
        quit(1)

    target.set_script(script)

    var packed = PackedScene.new()
    packed.pack(scene_root)
    ResourceSaver.save(packed, full_scene_path)
    print(JSON.stringify({"success": true, "node": params.node_path, "script": params.script_path}))
```

### Example 5: GDScript Create Resource Operation
```gdscript
func create_resource(params):
    var resource_type = params.resource_type  # e.g. "StandardMaterial3D", "Curve2D"
    var output_path = ensure_res_prefix(params.output_path)

    var resource = instantiate_class(resource_type)
    if not resource:
        log_error("Failed to create resource of type: " + resource_type)
        quit(1)

    if not resource is Resource:
        log_error("Type is not a Resource: " + resource_type)
        quit(1)

    # Set properties from params
    if params.has("properties"):
        for prop_name in params.properties:
            var value = convert_json_to_godot_type(
                params.properties[prop_name],
                params.get("property_types", {}).get(prop_name, "")
            )
            resource.set(prop_name, value)

    var error = ResourceSaver.save(resource, output_path)
    if error == OK:
        print(JSON.stringify({"success": true, "path": output_path, "type": resource_type}))
    else:
        log_error("Failed to save resource: " + str(error))
        quit(1)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Integer-based resource IDs | String-based UIDs (uid://...) | Godot 4.0 | .tscn format=3; parser must handle string IDs |
| --check-only for validation | --check-only (still limited) | Ongoing | No batch support; custom GDScript validation preferred |
| Binary .scn default | Text .tscn default | Godot 4.0 | Makes text parsing viable for read operations |
| load_steps integer count | load_steps=N format=3 header | Godot 4.0 | Parser must handle gd_scene/gd_resource headers |

**Deprecated/outdated:**
- Integer resource IDs (Godot 3.x): Replaced by string-based IDs like "1_7bt6s" in Godot 4.x
- XML resource format: Replaced by current .tscn/.tres text format long ago
- `--check-only` for batch validation: Still single-file; use custom GDScript operation instead

## Open Questions

1. **Property type inference for modify_node_property**
   - What we know: Godot properties have specific types. JSON doesn't distinguish Vector2 from an object with x,y.
   - What's unclear: Whether we should require an explicit `value_type` parameter or attempt to auto-detect based on the node's property metadata.
   - Recommendation: Require explicit `value_type` for complex types (Vector2, Vector3, Color), auto-detect for primitives (string, int, float, bool). This keeps the API explicit while being convenient.

2. **Stderr parsing for GDScript validation errors**
   - What we know: Godot prints parse errors to stderr. The `load()` + `reload()` approach returns error codes but not error messages/line numbers.
   - What's unclear: Whether stderr contains parseable error messages with file paths and line numbers in headless mode.
   - Recommendation: Capture stderr during validation and regex-parse for `res://path:line:col: message` patterns. If not available, at minimum report which files have errors.

3. **Import cache initialization**
   - What we know: Projects never opened in editor lack `.godot/` directory. This can cause resource loading failures.
   - What's unclear: Whether our read operations (text parsing) are affected (they should not be, since they read .tscn directly), and whether write operations always need the cache.
   - Recommendation: Text-based reads bypass this entirely (a major advantage). For write operations, detect missing `.godot/` and suggest running `godot --headless --import --quit` or handle automatically.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCEN-01 | read_scene returns JSON hierarchy from .tscn text | unit | `npx vitest run tests/tscn-parser.test.ts -x` | Wave 0 |
| SCEN-02 | modify_node_property tool calls executeOperation with correct params | unit | `npx vitest run tests/scene-tools.test.ts -x` | Wave 0 |
| SCEN-03 | remove_node tool calls executeOperation with correct params | unit | `npx vitest run tests/scene-tools.test.ts -x` | Wave 0 |
| SCEN-04 | attach_script tool calls executeOperation with correct params | unit | `npx vitest run tests/scene-tools.test.ts -x` | Wave 0 |
| SCEN-05 | create_resource tool calls executeOperation with correct params | unit | `npx vitest run tests/resource-tools.test.ts -x` | Wave 0 |
| SCEN-06 | read_resource returns structured JSON from .tres text | unit | `npx vitest run tests/tscn-parser.test.ts -x` | Wave 0 |
| SCRI-01 | validate_scripts tool calls executeOperation and parses JSON results | unit | `npx vitest run tests/script-tools.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/tscn-parser.test.ts` -- covers SCEN-01, SCEN-06 (parser unit tests with sample .tscn/.tres content)
- [ ] `tests/scene-tools.test.ts` -- covers SCEN-02, SCEN-03, SCEN-04 (tool registration and parameter validation)
- [ ] `tests/resource-tools.test.ts` -- covers SCEN-05 (resource tool registration)
- [ ] `tests/script-tools.test.ts` -- covers SCRI-01 (validate_scripts tool)
- [ ] `tests/fixtures/sample.tscn` -- sample .tscn file for parser tests
- [ ] `tests/fixtures/sample.tres` -- sample .tres file for parser tests

## Sources

### Primary (HIGH confidence)
- Godot 4.4 TSCN file format documentation: https://docs.godotengine.org/en/4.4/contributing/development/file_formats/tscn.html - format spec, header, sections, property serialization
- Godot 4.4 PackedScene documentation: https://docs.godotengine.org/en/4.4/classes/class_packedscene.html - pack/instantiate API, ownership rules
- Godot 4.4 ResourceSaver documentation: https://docs.godotengine.org/en/stable/classes/class_resourcesaver.html - save API, .tres format
- Existing codebase: src/tools/scene.ts, src/scripts/godot_operations.gd - established patterns

### Secondary (MEDIUM confidence)
- Godot proposals #13048 (structured error output): https://github.com/godotengine/godot-proposals/issues/13048 - error format limitations
- Godot issue #96065 (load returns GDScript with parse errors): https://github.com/godotengine/godot/issues/96065 - reload() detection method
- Godot issue #20513 (GDScript CLI checking): https://github.com/godotengine/godot/issues/20513 - --check-only limitations
- Godot issue #77508 (headless import): https://github.com/godotengine/godot/issues/77508 - .godot cache issues
- @fernforestgames/godot-resource-parser: https://github.com/fernforestgames/godot-resource-parser - Archived; confirms parser approach is viable, validates type definitions

### Tertiary (LOW confidence)
- Batch validation stderr format: Unverified whether headless GDScript validation outputs parseable error messages with line numbers to stderr. Needs empirical testing.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, extends existing patterns
- Architecture (read ops / text parser): HIGH - tscn format is well-documented, text parsing is straightforward
- Architecture (write ops / Godot API): HIGH - extends existing executeOperation pattern already proven in Phase 1
- Architecture (GDScript validation): MEDIUM - load()+reload() approach is documented but stderr parsing is unverified
- Pitfalls: HIGH - specific concerns from STATE.md researched and addressed

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable domain, Godot 4.x tscn format unlikely to change)
