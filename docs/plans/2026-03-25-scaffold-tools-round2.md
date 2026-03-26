# Scaffold Tools Round 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 4 scaffold tools to godot-mcp that generate common GDScript boilerplate patterns (ConfigFile persistence, custom Resource classes, GUT test skeletons, health components).

**Architecture:** All 4 tools are registered in the existing `src/tools/scaffold.ts` alongside `scaffold_event_bus`. They follow the same pattern: validate paths, generate GDScript strings, write files, optionally call the GDScript backend for autoload registration. Tests extend `tests/scaffold-tools.test.ts`.

**Tech Stack:** TypeScript, Zod schemas, Vitest, MCP SDK

---

## Task 1: scaffold_config_manager — Tests

**Files:**
- Modify: `tests/scaffold-tools.test.ts` (add `readFileSync` to fs mock + import, add describe block)

Add `readFileSync: vi.fn()` to the fs mock return object (line 12-19).
Add `readFileSync` to the fs import (line 36).

Add test describe block before the final `});` with these tests:
- Registers the tool
- Returns toolError when validatePath fails
- Generates ConfigFile load/save with typed vars and setters (assert writeFileSync content contains `SAVE_PATH`, typed vars, setters, `config.get_value`, `config.set_value`)
- Supports multiple sections (assert both section names appear in get_value/set_value calls)
- Registers autoload when requested (assert `executeOperation` called with section='autoload')

Run: `npx vitest run tests/scaffold-tools.test.ts` — expect FAIL (handler not found)

---

## Task 2: scaffold_config_manager — Implementation

**Files:**
- Modify: `src/tools/scaffold.ts` (add tool before closing `}` of registerScaffoldTools)

**Generated GDScript structure:**
```
extends Node
const SAVE_PATH := "user://settings.cfg"
var sfx_enabled: bool = true

func _ready() -> void:
    load_data()

func set_sfx_enabled(value: bool) -> void:
    sfx_enabled = value
    save_data()

func load_data() -> void:
    var config := ConfigFile.new()
    if config.load(SAVE_PATH) == OK:
        sfx_enabled = config.get_value("audio", "sfx_enabled", true)

func save_data() -> void:
    var config := ConfigFile.new()
    config.set_value("audio", "sfx_enabled", sfx_enabled)
    config.save(SAVE_PATH)
```

**Input schema:** project_path, script_path, save_path (string), sections (array of {name, fields: [{name, type, default}]}), register_autoload (bool), autoload_name (string)

**Logic:**
1. Validate paths, check project.godot exists
2. Generate: doc comment, extends Node, SAVE_PATH const, var declarations with defaults, _ready calling load_data, set_X setters that assign+save, load_data with ConfigFile.get_value per section/field, save_data with ConfigFile.set_value per section/field
3. Create parent dirs, write file
4. Optional autoload registration via modify_project_setting

Run: `npm run build && npx vitest run tests/scaffold-tools.test.ts` — expect PASS

Commit: `feat: add scaffold_config_manager tool for ConfigFile persistence`

---

## Task 3: scaffold_resource_class — Tests

**Files:**
- Modify: `tests/scaffold-tools.test.ts` (add describe block)

Tests:
- Registers the tool
- Returns toolError when validatePath fails
- Generates class_name Resource with @export fields (assert `class_name AvatarData`, `extends Resource`, `@export var id: String`, fields with defaults)
- Does NOT call backend when no instances provided
- Returns success JSON with field_count and class_name

Run: `npx vitest run tests/scaffold-tools.test.ts` — expect FAIL

---

## Task 4: scaffold_resource_class — Implementation

**Files:**
- Modify: `src/tools/scaffold.ts` (add tool)

**Generated GDScript structure:**
```
class_name AvatarData
extends Resource

@export var id: String
@export var display_name: String
@export var ability_id: String = ""
```

**Input schema:** project_path, script_path, class_name (string), fields (array of {name, type, default?})

**Logic:**
1. Validate paths, check project.godot exists
2. Generate: doc comment, class_name, extends Resource, @export lines with optional defaults
3. Create parent dirs, write file

Run: `npm run build && npx vitest run tests/scaffold-tools.test.ts` — expect PASS

Commit: `feat: add scaffold_resource_class tool for custom Resource types`

---

## Task 5: scaffold_tests — Tests

**Files:**
- Modify: `tests/scaffold-tools.test.ts` (add describe block)

Tests:
- Registers the tool
- Returns toolError when source script does not exist (mock existsSync: true for project.godot, false for script)
- Generates test stubs for public methods (mock readFileSync with GDScript containing `func check_best_score`, `func reset`, `func _private_method`; assert test file has `test_check_best_score`, `test_reset`, NO `test__private_method`)
- Generates signal assertions (mock readFileSync with `signal player_died`, `signal score_updated`; assert `test_has_signal_player_died`, `has_signal("player_died")`)
- Defaults test_path to `tests/test_<filename>.gd`

Run: `npx vitest run tests/scaffold-tools.test.ts` — expect FAIL

---

## Task 6: scaffold_tests — Implementation

**Files:**
- Modify: `src/tools/scaffold.ts` (add `readFileSync` to fs import, add tool)

**Generated GUT test structure:**
```
extends GutTest

var _sut  # system under test

func before_each() -> void:
    _sut = autofree(ScoreManager.new())

func test_check_best_score() -> void:
    # TODO: test check_best_score
    pending("Not implemented")

func test_has_signal_player_died() -> void:
    assert_true(_sut.has_signal("player_died"), "Should have signal player_died")
```

**Input schema:** project_path, script_path (existing .gd), test_path (optional, defaults to tests/test_<filename>.gd)

**Logic:**
1. Validate paths, check project.godot + source script exist
2. Read source script with readFileSync
3. Parse public methods: regex `^func\s+([a-zA-Z][a-zA-Z0-9_]*)\s*\(` excluding _ prefix
4. Parse signals: regex `^signal\s+([a-zA-Z_][a-zA-Z0-9_]*)`
5. Derive class name via toPascalCase(filenameWithoutExtension())
6. Generate: extends GutTest, _sut var, before_each with autofree, test_ stubs with pending(), signal assertion funcs
7. Create parent dirs, write file

Run: `npm run build && npx vitest run tests/scaffold-tools.test.ts` — expect PASS

Commit: `feat: add scaffold_tests tool for GUT test skeleton generation`

---

## Task 7: scaffold_health_component — Tests

**Files:**
- Modify: `tests/scaffold-tools.test.ts` (add describe block)

Tests:
- Registers the tool
- Returns toolError when validatePath fails
- Generates health component with signals and methods (assert: `signal health_changed`, `signal damage_taken`, `signal healed`, `signal died`, `func take_damage`, `func heal`, `@export var max_health`, `is_invincible`)
- Uses custom max_health and invincibility_duration values
- Returns success JSON

Run: `npx vitest run tests/scaffold-tools.test.ts` — expect FAIL

---

## Task 8: scaffold_health_component — Implementation

**Files:**
- Modify: `src/tools/scaffold.ts` (add tool)

**Generated GDScript structure:**
```
extends Node

signal health_changed(current: int, maximum: int)
signal damage_taken(amount: int)
signal healed(amount: int)
signal died

@export var max_health: int = 100
@export var invincibility_duration: float = 0.3

var current_health: int
var is_invincible: bool = false

func _ready() -> void:
    current_health = max_health

func take_damage(amount: int) -> void:
    if is_invincible or current_health <= 0:
        return
    current_health = maxi(current_health - amount, 0)
    damage_taken.emit(amount)
    health_changed.emit(current_health, max_health)
    if current_health <= 0:
        died.emit()
    else:
        _start_invincibility()

func heal(amount: int) -> void:
    if current_health <= 0:
        return
    var old_health := current_health
    current_health = mini(current_health + amount, max_health)
    var actual := current_health - old_health
    if actual > 0:
        healed.emit(actual)
        health_changed.emit(current_health, max_health)

func _start_invincibility() -> void:
    is_invincible = true
    await get_tree().create_timer(invincibility_duration).timeout
    is_invincible = false
```

**Input schema:** project_path, script_path, max_health (int, default 100), invincibility_duration (float, default 0.3)

**Logic:**
1. Validate paths, check project.godot exists
2. Generate the health component GDScript using provided max_health and invincibility_duration
3. Create parent dirs, write file

Run: `npm run build && npx vitest run tests/scaffold-tools.test.ts` — expect PASS

Commit: `feat: add scaffold_health_component tool for combat/damage systems`

---

## Task 9: Final verification

1. Run full test suite: `npx vitest run` — all tests PASS
2. Verify tool count: `grep -c "server.registerTool" src/tools/scaffold.ts` — expect 5
3. Build clean: `npm run build` — no errors
