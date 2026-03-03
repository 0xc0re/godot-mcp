# Phase 3: Project & Script Intelligence - Research

**Researched:** 2026-03-03
**Domain:** Godot project configuration parsing, GDScript introspection, ClassDB reflection, MCP resources
**Confidence:** HIGH

## Summary

Phase 3 adds five capabilities: reading project.godot settings as structured JSON, modifying project settings programmatically, listing all scripts with their structure (exports, signals, methods), querying Godot's ClassDB for engine class metadata, and exposing MCP resources for @mention context in Claude Code.

The project.godot file is INI-format text that can be parsed in TypeScript (fast, same read/write split pattern from Phase 2) using a simple section+key=value parser. The existing tscn-parser proves this pattern works well. For writes, Godot's ConfigFile class or ProjectSettings API via headless GDScript provides correctness guarantees for complex values (like input maps with Object(...) syntax). For ClassDB and script introspection, GDScript headless operations are required since these APIs are only available inside the Godot runtime. MCP resources use the SDK's `registerResource()` API with `ResourceTemplate` for dynamic parameterized resources -- the SDK auto-wires handler registration when resources are registered, but the server capabilities declaration in `index.ts` must be updated to include `resources: {}`.

**Primary recommendation:** Use the TypeScript-reads / GDScript-writes split for project.godot (proven pattern), GDScript headless for ClassDB + script introspection (runtime-only APIs), and MCP SDK `registerResource` with `ResourceTemplate` for @mention resources.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROJ-01 | Read project.godot settings (autoloads, input maps, render config, features) | TypeScript INI parser extracts sections and key=value pairs into structured JSON; handles multi-line values with bracket balancing (same as tscn-parser) |
| PROJ-02 | Modify project.godot settings programmatically (add autoloads, change settings) | GDScript ConfigFile.load/set_value/save or ProjectSettings.set_setting/save for write-back correctness; TypeScript parser for validation |
| PROJ-03 | MCP resources exposed so users can @mention scenes and scripts as context | MCP SDK `registerResource` with `ResourceTemplate` for dynamic `godot://scene/{path}` and `godot://script/{path}` URIs; `list` callback enumerates project files |
| SCRI-02 | List all project scripts with structure summary (exported functions, variables, signals) | GDScript headless operation: load each script, call get_script_method_list/get_script_property_list/get_script_signal_list, extract class_name; return structured JSON |
| SCRI-04 | Query Godot's ClassDB for class properties, methods, and signals | GDScript headless operation: ClassDB.class_get_property_list/class_get_method_list/class_get_signal_list; return structured JSON per class |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | ^1.27.1 | MCP server with resource support | Already installed; registerResource + ResourceTemplate API |
| zod | ^3.25.76 | Schema validation for tool inputs | Already installed; used by all existing tools |
| TypeScript (Node.js) | ES2022 | TypeScript INI parser for project.godot reads | Proven pattern from tscn-parser; fast, no process spawn |
| Godot 4.x headless | 4.4+ | ClassDB introspection, script introspection, project writes | Runtime APIs only available inside Godot engine |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fs (Node.js built-in) | n/a | Read project.godot, enumerate .gd/.tscn files | File discovery for resource listing |
| path (Node.js built-in) | n/a | Path manipulation for resource URIs | Building file paths from project_path + relative paths |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom INI parser | npm ini package | project.godot has Godot-specific value types like `Object(...)`, `PackedStringArray(...)`, `Vector2(...)` that standard INI parsers choke on; custom parser preserves raw values like tscn-parser does |
| ConfigFile (GDScript) for project reads | TypeScript parser | ConfigFile requires spawning Godot (~200ms); TypeScript parser is ~1ms for an 80-line file |
| ProjectSettings API for writes | ConfigFile API | ProjectSettings.save() has known issues (doesn't save values equal to defaults); ConfigFile.load/set_value/save is more reliable for targeted edits |

## Architecture Patterns

### Recommended Project Structure
```
src/
  parsers/
    project-parser.ts       # NEW: TypeScript INI parser for project.godot
    project-types.ts        # NEW: Types for parsed project settings
    tscn-parser.ts          # Existing
    tscn-types.ts           # Existing
  tools/
    project.ts              # MODIFY: Add read_project_settings, modify_project_setting
    script.ts               # MODIFY: Add list_scripts, query_class
  resources/
    godot-resources.ts      # NEW: MCP resource registrations for @mention
  scripts/
    godot_operations.gd     # MODIFY: Add list_scripts, query_class, modify_project_setting operations
  index.ts                  # MODIFY: Add resources capability, register resource handlers
```

### Pattern 1: TypeScript Read / GDScript Write (Proven)
**What:** Read operations parse text files in TypeScript for speed; write operations delegate to Godot headless for type correctness.
**When to use:** Any operation on Godot text-format files (project.godot, .tscn, .tres).
**Example:**
```typescript
// Read: TypeScript parser (~1ms)
import { parseProjectSettings } from '../parsers/project-parser.js';
const content = readFileSync(join(project_path, 'project.godot'), 'utf-8');
const settings = parseProjectSettings(content);

// Write: GDScript via headless Godot (~200ms, but correct)
const { stdout } = await executeOperation(ctx, project_path, 'modify_project_setting', {
  section: 'autoload',
  key: 'GameManager',
  value: '*res://scripts/core/game_manager.gd',
});
```

### Pattern 2: GDScript Headless Introspection
**What:** Operations that require Godot runtime APIs (ClassDB, Script reflection) run as headless GDScript operations.
**When to use:** ClassDB queries, script method/property/signal introspection.
**Example:**
```gdscript
# In godot_operations.gd
func list_scripts(params):
    var base_path = params.get("path_filter", "res://")
    var gd_files = find_gd_files(base_path)
    var scripts_info = []
    for file_path in gd_files:
        var script = load(file_path) as GDScript
        if script == null:
            continue
        var info = {
            "path": file_path,
            "class_name": script.get_global_name(),  # class_name keyword value
            "methods": [],
            "properties": [],
            "signals": []
        }
        for m in script.get_script_method_list():
            if not m.name.begins_with("_"):  # skip private/virtual
                info.methods.append({"name": m.name, "args": m.args.size()})
        for p in script.get_script_property_list():
            if p.usage & PROPERTY_USAGE_SCRIPT_VARIABLE:
                info.properties.append({"name": p.name, "type": p.type})
        for s in script.get_script_signal_list():
            info.signals.append({"name": s.name, "args": s.args.size()})
        scripts_info.append(info)
    print(JSON.stringify({"scripts": scripts_info, "total": scripts_info.size()}))
```

### Pattern 3: MCP Resource Registration with ResourceTemplate
**What:** Dynamic MCP resources that let Claude Code users @mention Godot project files.
**When to use:** Exposing scenes and scripts as context via @mention.
**Example:**
```typescript
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

// Dynamic resource: godot://project/{project_path}/scene/{scene_path}
server.registerResource(
  'godot-scene',
  new ResourceTemplate('godot://scene/{path}', {
    list: async () => {
      // Enumerate all .tscn files in discovered projects
      const scenes = findFiles(projectPath, '.tscn');
      return {
        resources: scenes.map(s => ({
          uri: `godot://scene/${s}`,
          name: basename(s),
          mimeType: 'text/plain',
        })),
      };
    },
  }),
  {
    title: 'Godot Scene',
    description: 'A Godot scene file (.tscn)',
    mimeType: 'text/plain',
  },
  async (uri, { path }) => {
    const content = readFileSync(path, 'utf-8');
    return { contents: [{ uri: uri.href, text: content }] };
  },
);
```

### Anti-Patterns to Avoid
- **Parsing project.godot with a generic INI library:** Godot values contain `Object(InputEventKey,...)`, `PackedStringArray(...)`, `Vector2(...)` and other non-standard types. Generic INI parsers will fail or corrupt these values. Store values as raw strings, same as tscn-parser.
- **Using ProjectSettings.save() for writes:** Known to skip values equal to defaults, causing silent data loss. Use ConfigFile for targeted edits instead.
- **Filtering ClassDB output in TypeScript:** The ClassDB API returns hundreds of properties/methods per class (including inherited). Filter in GDScript before serializing to JSON to avoid massive stdout.
- **Registering static resources for every file:** Use ResourceTemplate with a list callback instead. Static resources require knowing all files at startup, which breaks for newly created files.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| INI value type parsing | Custom Godot value deserializer | Store raw strings, let consumers interpret | Godot values have infinite variant types (Object, Vector2, Color, etc.); parsing them all is a rabbit hole |
| ClassDB method enumeration | TypeScript web scraper for docs | GDScript ClassDB.class_get_method_list() at runtime | The engine's own reflection is authoritative and complete |
| Script export detection | Regex-based GDScript parser | GDScript Script.get_script_property_list() with PROPERTY_USAGE_SCRIPT_VARIABLE flag | Regex misses @export_enum, @export_range, computed properties, and inherited exports |
| MCP resource auto-discovery | Custom file watcher + polling | ResourceTemplate with list callback | The MCP SDK handles resource enumeration; list callback is called when client requests resource list |

**Key insight:** GDScript introspection APIs are the only reliable source for script structure and ClassDB data. Regex or static analysis will always be incomplete because GDScript features (annotations, inheritance, tool scripts) make static parsing fragile.

## Common Pitfalls

### Pitfall 1: project.godot Multi-Line Values
**What goes wrong:** Input map entries span multiple lines with complex `Object(InputEventKey,...)` syntax. Naive line-by-line parsing breaks.
**Why it happens:** Godot stores input events as multi-line dictionaries with nested Object constructors.
**How to avoid:** Reuse the bracket-balancing multi-line accumulator from tscn-parser. The `isBalanced()` function already handles this exact pattern.
**Warning signs:** Truncated or corrupted input_map values, JSON parse errors on project settings output.

### Pitfall 2: ClassDB Returns Inherited Properties
**What goes wrong:** `ClassDB.class_get_property_list()` returns ALL properties including inherited ones from Object, Node, etc. For Node2D this is 100+ properties.
**Why it happens:** ClassDB reflects the full class hierarchy.
**How to avoid:** Filter by `no_inheritance` parameter (ClassDB.class_get_property_list takes a `no_inheritance: bool` parameter) or filter in GDScript before returning. Provide the `no_inheritance` parameter as a tool option.
**Warning signs:** Massive JSON output for simple classes, context budget blow-up.

### Pitfall 3: Script Load Failures in Headless Mode
**What goes wrong:** `load()` returns null for scripts that depend on editor-only features or have autoload dependencies.
**Why it happens:** Headless mode doesn't load autoloads or editor plugins.
**How to avoid:** Handle null gracefully -- report the script path with an error message rather than crashing. The validate_scripts operation already demonstrates this pattern.
**Warning signs:** Incomplete script listings, null pointer errors in GDScript.

### Pitfall 4: Resource URI Must Be Valid RFC 3986
**What goes wrong:** File paths with spaces, special characters, or backslashes break URI parsing.
**Why it happens:** MCP resource URIs must conform to RFC 3986. Windows paths use backslashes.
**How to avoid:** Normalize paths to forward slashes, URI-encode special characters, use a custom URI scheme (`godot://`) rather than `file://`.
**Warning signs:** Resource not found errors, URI parse failures in Claude Code.

### Pitfall 5: Capabilities Declaration Missing
**What goes wrong:** Resources are registered but Claude Code doesn't show them in @mention autocomplete.
**Why it happens:** The MCP SDK auto-registers resource handlers when registerResource is called, but if the server constructor doesn't declare the `resources` capability, some clients may not request resource listings.
**How to avoid:** Update the McpServer constructor in `index.ts`: `{ capabilities: { tools: {}, resources: {} } }`.
**Warning signs:** Tools work but @mention shows no resources.

### Pitfall 6: get_script_property_list Includes Categories/Groups
**What goes wrong:** Property list includes entries of type Category, Group, and SubGroup that are not real properties.
**Why it happens:** Godot 4 changed property list behavior to include inspector metadata.
**How to avoid:** Filter by `usage & PROPERTY_USAGE_SCRIPT_VARIABLE` flag to get only user-defined script variables, or check property `usage` bitfield.
**Warning signs:** Properties list includes entries like "" (empty names) or group markers.

## Code Examples

Verified patterns from official sources and existing codebase:

### project.godot INI Parser (TypeScript)
```typescript
// Source: Based on existing tscn-parser.ts pattern
// project.godot is INI-format: [section]\nkey=value

interface ParsedProjectSettings {
  sections: Record<string, Record<string, string>>;
  configVersion: number;
}

function parseProjectSettings(content: string): ParsedProjectSettings {
  const result: ParsedProjectSettings = { sections: {}, configVersion: 0 };
  if (!content.trim()) return result;

  const lines = content.split('\n');
  let currentSection = ''; // root section (before any [section] header)
  let multiLineKey: string | null = null;
  let multiLineValue = '';

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed === '' || trimmed.startsWith(';')) continue;

    // Handle multi-line values (bracket-balanced, reuse isBalanced from tscn-parser)
    if (multiLineKey !== null) {
      multiLineValue += '\n' + trimmed;
      if (isBalanced(multiLineValue)) {
        if (!result.sections[currentSection]) result.sections[currentSection] = {};
        result.sections[currentSection][multiLineKey] = multiLineValue;
        multiLineKey = null;
        multiLineValue = '';
      }
      continue;
    }

    // Section header: [section_name]
    const sectionMatch = trimmed.match(/^\[(\w+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!result.sections[currentSection]) result.sections[currentSection] = {};
      continue;
    }

    // Key=value (note: project.godot uses = not " = " like .tscn)
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.substring(0, eqIdx);
      const value = trimmed.substring(eqIdx + 1);
      if (key === 'config_version') {
        result.configVersion = parseInt(value, 10);
        continue;
      }
      if (isBalanced(value)) {
        if (!result.sections[currentSection]) result.sections[currentSection] = {};
        result.sections[currentSection][key] = value;
      } else {
        multiLineKey = key;
        multiLineValue = value;
      }
    }
  }

  return result;
}
```

### GDScript ClassDB Query Operation
```gdscript
# Source: Godot ClassDB API docs + existing operation pattern
func query_class(params):
    var class_name_param = params.get("class_name", "")
    var no_inheritance = params.get("no_inheritance", false)

    if not ClassDB.class_exists(class_name_param):
        print(JSON.stringify({"error": "Class not found: " + class_name_param}))
        return

    var result = {
        "class_name": class_name_param,
        "parent_class": ClassDB.get_parent_class(class_name_param),
        "properties": [],
        "methods": [],
        "signals": []
    }

    for p in ClassDB.class_get_property_list(class_name_param, no_inheritance):
        result.properties.append({
            "name": p.name,
            "type": p.type,
            "usage": p.usage
        })

    for m in ClassDB.class_get_method_list(class_name_param, no_inheritance):
        var args = []
        for a in m.args:
            args.append({"name": a.name, "type": a.type})
        result.methods.append({
            "name": m.name,
            "return_type": m.return_val.type,
            "args": args
        })

    for s in ClassDB.class_get_signal_list(class_name_param, no_inheritance):
        var args = []
        for a in s.args:
            args.append({"name": a.name, "type": a.type})
        result.signals.append({"name": s.name, "args": args})

    print(JSON.stringify(result))
```

### GDScript Modify Project Setting Operation
```gdscript
# Source: Godot ConfigFile API docs
func modify_project_setting(params):
    var config = ConfigFile.new()
    var err = config.load("res://project.godot")
    if err != OK:
        printerr("[ERROR] Failed to load project.godot: " + str(err))
        return

    var section = params.get("section", "")
    var key = params.get("key", "")
    var value = params.get("value", "")
    var action = params.get("action", "set")  # "set", "delete"

    if action == "delete":
        config.erase_section_key(section, key)
    else:
        config.set_value(section, key, value)

    err = config.save("res://project.godot")
    if err != OK:
        printerr("[ERROR] Failed to save project.godot: " + str(err))
        return

    print(JSON.stringify({"success": true, "section": section, "key": key, "action": action}))
```

### MCP Resource Registration Pattern
```typescript
// Source: MCP SDK TypeScript docs + local type definitions
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerGodotResources(server: McpServer, ctx: ServerContext): void {
  // Scenes as resources
  server.registerResource(
    'godot-scene',
    new ResourceTemplate('godot://scene/{path}', {
      list: async () => {
        // Return available scenes -- requires project_path context
        return { resources: [] }; // populated dynamically
      },
    }),
    {
      title: 'Godot Scene',
      description: 'Read a Godot scene file (.tscn) as context',
      mimeType: 'text/plain',
    },
    async (uri, { path }) => {
      const content = readFileSync(path as string, 'utf-8');
      return { contents: [{ uri: uri.href, text: content }] };
    },
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| McpServer.resource() | McpServer.registerResource() | SDK 1.x | Old method deprecated; must use registerResource |
| Manual resource handler setup | ResourceTemplate with list callback | SDK 1.x | SDK auto-wires handlers when registerResource called |
| Static resource registration | Dynamic ResourceTemplate | MCP spec 2025-06-18 | Templates enable parameterized URIs with enumeration |
| ProjectSettings.save() | ConfigFile.load/set_value/save | Always (known bug) | ProjectSettings.save() silently skips default-equal values |
| Object.get_property_list() | Script.get_script_property_list() + usage filter | Godot 4.0 | Property list includes Category/Group entries that must be filtered |

**Deprecated/outdated:**
- `McpServer.resource()`: Deprecated in SDK 1.x, replaced by `registerResource()`
- `ProjectSettings.save()` for headless writes: Known to not persist values equal to defaults

## Open Questions

1. **Resource project_path context**
   - What we know: MCP resources need to know where the Godot project is to enumerate files. Current tools receive `project_path` as a parameter.
   - What's unclear: Resources don't take parameters from the user -- they're listed/read by URI. How does the resource registration know which project to enumerate?
   - Recommendation: Use an environment variable (`GODOT_PROJECT_PATH`) or auto-detect from cwd. Alternatively, use the `project_path` from the most recent tool call. Simplest: require `GODOT_PROJECT_PATH` env var or first `project_path` used in any tool call, cached in ServerContext.

2. **ConfigFile.set_value type handling**
   - What we know: ConfigFile.set_value takes a Variant. For simple strings like autoload paths, passing a string works. For complex values like input maps, the Variant type must match exactly.
   - What's unclear: Whether passing string representations of complex values (like `PackedStringArray(...)`) works with ConfigFile.set_value, or if we need to construct the actual Godot type.
   - Recommendation: For autoloads and simple string settings, pass strings directly. For complex types (input maps, physics layers), construct the actual Godot type in GDScript. Start with simple settings (autoloads, display, rendering) and defer complex input map editing.

3. **Script.get_global_name() availability**
   - What we know: `class_name` keyword registers a global name. `Script.get_global_name()` should return it.
   - What's unclear: Whether this method exists in all Godot 4.x versions or was added in 4.1+.
   - Recommendation: Use `get_global_name()` with a fallback to parsing the script file's first lines for `class_name` if the method doesn't exist.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROJ-01 | Parse project.godot into structured JSON | unit | `npx vitest run tests/project-parser.test.ts -x` | No - Wave 0 |
| PROJ-01 | read_project_settings tool returns autoloads, input maps, render config | unit | `npx vitest run tests/project-tools.test.ts -x` | No - Wave 0 |
| PROJ-02 | modify_project_setting tool delegates to GDScript operation | unit | `npx vitest run tests/project-tools.test.ts -x` | No - Wave 0 |
| PROJ-03 | MCP resources registered for scenes and scripts | unit | `npx vitest run tests/resource-registration.test.ts -x` | No - Wave 0 |
| SCRI-02 | list_scripts tool returns structured script info | unit | `npx vitest run tests/script-tools.test.ts -x` | Exists (extend) |
| SCRI-04 | query_class tool returns ClassDB info | unit | `npx vitest run tests/script-tools.test.ts -x` | Exists (extend) |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/project-parser.test.ts` -- covers PROJ-01 parser logic (sections, multi-line values, autoloads, input maps)
- [ ] `tests/project-tools.test.ts` -- covers PROJ-01 read tool and PROJ-02 modify tool (mock-based like existing tool tests)
- [ ] `tests/resource-registration.test.ts` -- covers PROJ-03 MCP resource registration
- [ ] `tests/fixtures/sample.project.godot` -- realistic project.godot fixture file for parser tests
- [ ] Extend `tests/script-tools.test.ts` -- add list_scripts and query_class test cases

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/parsers/tscn-parser.ts`, `src/tools/project.ts`, `src/tools/script.ts` -- established patterns
- Existing codebase: `src/scripts/godot_operations.gd` -- operation dispatch pattern, GDScript API usage
- Real project.godot from ~/src/bfg/project.godot -- verified INI format with sections: application, autoload, display, input, input_devices, layer_names, rendering
- MCP SDK local types: `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` -- registerResource, ResourceTemplate, ResourceMetadata signatures verified
- [MCP Resources specification](https://modelcontextprotocol.io/docs/concepts/resources) -- URI schemes, static vs dynamic, ResourceTemplate, capabilities declaration

### Secondary (MEDIUM confidence)
- [Godot ProjectSettings docs](https://docs.godotengine.org/en/stable/classes/class_projectsettings.html) -- ProjectSettings API, known save() limitations
- [Godot ClassDB docs](https://docs.godotengine.org/en/stable/classes/class_classdb.html) -- class_get_method_list, class_get_property_list, class_get_signal_list methods
- [Godot Script class docs](https://docs.godotengine.org/en/stable/classes/class_script.html) -- get_script_method_list, get_script_property_list, get_script_signal_list
- [Godot ConfigFile docs](https://docs.godotengine.org/en/stable/classes/class_configfile.html) -- load, save, set_value, get_value, get_sections, get_section_keys
- [Claude Code MCP resources](https://stevekinney.com/courses/ai-development/referencing-files-in-claude-code) -- @mention autocomplete for MCP resources
- [MCP SDK TypeScript server docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) -- registerResource examples

### Tertiary (LOW confidence)
- [Godot Issue #68780](https://github.com/godotengine/godot/issues/68780) -- get_script_property_list includes Category/Group entries (may be fixed in later versions)
- [Godot Issue #46358](https://github.com/godotengine/godot/issues/46358) -- ProjectSettings.save() does nothing (behavior may vary by version)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and proven in Phase 1-2
- Architecture: HIGH -- follows established read/write split pattern from Phase 2; MCP resource API verified from local SDK types
- Pitfalls: HIGH -- multi-line values tested with real project.godot; ClassDB inheritance filtering verified from Godot docs; property list filtering from known Godot 4 issue
- Code examples: MEDIUM -- ClassDB and Script introspection API signatures come from docs, not tested in this project yet

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable -- all technologies are established)
