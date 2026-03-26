# Scaffold Tools Round 2: Design

## Context

The first round of ballz-inspired tools added 10 MCP tools (collision layers, autoloads, GUT runner, EventBus scaffold, export pre-flight, scene validator). This round adds 4 more scaffold tools that generate common GDScript boilerplate patterns observed in the ballz game project.

All tools extend the existing `scaffold.ts` domain. All are pure TypeScript file generation (no GDScript backend changes).

## Tools

### 1. scaffold_config_manager

Generates a ConfigFile-based persistence autoload. Covers both simple patterns (ScoreManager: single section, few fields) and complex patterns (SettingsManager: multiple sections, typed setters).

**Input:**
- `project_path: string` — Godot project directory
- `script_path: string` — where to write .gd file (e.g. "scripts/autoloads/settings_manager.gd")
- `save_path: string` — ConfigFile path (e.g. "user://settings.cfg")
- `sections: [{name: string, fields: [{name: string, type: string, default: string}]}]` — data schema
- `register_autoload?: boolean` — register in project.godot (default false)
- `autoload_name?: string` — PascalCase name (derived from filename if omitted)

**Generates:** extends Node with SAVE_PATH const, typed vars with defaults, `load_data()`/`save_data()` using ConfigFile, public `set_<field>()` setters that assign+save, `_ready()` calling `load_data()`.

### 2. scaffold_resource_class

Generates a class_name Resource subclass with @export fields. Follows the AvatarData pattern from ballz.

**Input:**
- `project_path: string`
- `script_path: string` — where to write .gd file
- `class_name: string` — PascalCase resource class name
- `fields: [{name: string, type: string, default?: string}]` — @export properties
- `instances?: [{filename: string, values: Record<string, string>}]` — optional .tres instances to create via create_resource operation

**Generates:** class_name declaration, extends Resource, @export var lines with optional defaults.

### 3. scaffold_tests

Reads an existing .gd file, parses public methods and signals, generates a GUT test skeleton.

**Input:**
- `project_path: string`
- `script_path: string` — existing .gd file to generate tests for
- `test_path?: string` — where to write test file (default: "tests/test_<filename>.gd")

**Parsing:** TypeScript regex finds `func <name>(` without `_` prefix (public methods) and `signal <name>` (signal declarations).

**Generates:** extends GutTest, `var _sut` for system under test, `before_each()` with autofree, `test_<method>()` stubs with `pending("Not implemented")`, signal presence assertions.

### 4. scaffold_health_component

Generates a reusable health/damage Node with invincibility frames.

**Input:**
- `project_path: string`
- `script_path: string` — where to write .gd file
- `max_health?: int` — default 100
- `invincibility_duration?: float` — default 0.3

**Generates:** extends Node with signals (health_changed, damage_taken, healed, died), @export vars (max_health, invincibility_duration), current_health/is_invincible state, take_damage() with iframe gating, heal() with clamping, _start_invincibility() with timer.

## Architecture

All 4 tools are registered in `src/tools/scaffold.ts` alongside the existing `scaffold_event_bus`. They reuse the existing `toPascalCase()` and `filenameWithoutExtension()` helpers. The `scaffold_resource_class` tool optionally calls `executeOperation` for .tres instance creation; all others are pure file writes.

## Verification

- Vitest unit tests in `tests/scaffold-tools.test.ts` (extend existing file)
- `npm run build` for TypeScript compilation
- Test against ballz project patterns via MCP Inspector
